import * as d3 from 'd3';
import _ from 'lodash';
import * as Validations from '../validations/index';
import { coreDifference } from './difference';
import { coreGraph } from './graph';
import { coreTree } from './tree';
import { osmEntity } from '../osm/entity';
import { uiLoading } from '../ui/index';
import { utilSessionMutex } from '../util/index';
import { utilRebind } from '../util/rebind';


export function coreHistory(context) {
    var imageryUsed = ['Bing'],
        dispatch = d3.dispatch('change', 'undone', 'redone'),
        lock = utilSessionMutex('lock'),
        duration = 150,
        checkpoints = {},
        stack, index, tree;


    // internal _act, accepts list of actions and eased time
    function _act(actions, t) {
        actions = Array.prototype.slice.call(actions);

        var annotation;

        if (!_.isFunction(_.last(actions))) {
            annotation = actions.pop();
        }

        stack[index].transform = context.projection.transform();
        stack[index].selectedIDs = context.selectedIDs();

        var prevGraph = stack[index].graph,
            newGraph = prevGraph;
        for (var i = 0; i < actions.length; i++) {
            newGraph = actions[i](newGraph, t);
        }
        if (context.allowAutoTagging()) {
            newGraph = autoTagging(prevGraph, newGraph);
        }

        return {
            graph: newGraph,
            annotation: annotation,
            imageryUsed: imageryUsed
        };
    }

    // do automatic taggging like edited=true after actions are taken on history
    function autoTagging(prevGraph, newGraph) {
        var difference = coreDifference(prevGraph, newGraph),
            newGraphEnts = newGraph.entities,
            entsForEditedTag = {};
        _.each(difference.changes(), function(chg) {
            if (!chg || !chg.head) return;
            var entity = newGraphEnts[chg.head.id];
            if (entity.id[0] === 'n') {
                // tag parent ways
                _.each(newGraph._parentWays[entity.id], function(wid) {
                    var way = newGraphEnts[wid];
                    if(!('edited' in way.tags)) {
                      entsForEditedTag[wid] = way;
                    }
                });
                // tag positive node
                if (entity.id[1] !== '-' && !('edited' in entity.tags)) {
                    entsForEditedTag[entity.id] = entity;
                }
            } else if (entity.id[0] === 'w' && !('edited' in entity.tags)) {
                entsForEditedTag[entity.id] = entity;
            }
        });

        if (!_.isEmpty(entsForEditedTag)) {
            newGraph = newGraph.updateTagsOnMultiEnts(
                Object.keys(entsForEditedTag), 'edited', 'true');
        }
        return newGraph;
    }

    // internal _perform with eased time
    function _perform(args, t) {
        var previous = stack[index].graph;
        stack = stack.slice(0, index + 1);
        stack.push(_act(args, t));
        index++;
        return change(previous);
    }


    // internal _replace with eased time
    function _replace(args, t) {
        var previous = stack[index].graph;
        // assert(index == stack.length - 1)
        stack[index] = _act(args, t);
        return change(previous);
    }


    // internal _overwrite with eased time
    function _overwrite(args, t) {
        var previous = stack[index].graph;
        if (index > 0) {
            index--;
            stack.pop();
        }
        stack = stack.slice(0, index + 1);
        stack.push(_act(args, t));
        index++;
        return change(previous);
    }


    // determine diffrence and dispatch a change event
    function change(previous) {
        var difference = coreDifference(previous, history.graph());
        dispatch.call('change', this, difference);
        return difference;
    }


    // iD uses namespaced keys so multiple installations do not conflict
    function getKey(n) {
        return 'iD_' + window.location.origin + '_' + n;
    }


    var history = {

        graph: function() {
            return stack[index].graph;
        },


        annotation: function() {
            return stack[index].annotation;
        },


        base: function() {
            return stack[0].graph;
        },


        merge: function(entities, extent) {
            stack[0].graph.rebase(entities, _.map(stack, 'graph'), false);
            tree.rebase(entities, false);

            dispatch.call('change', this, undefined, extent);
        },


        perform: function() {
            // complete any transition already in progress
            d3.select(document).interrupt('history.perform');

            var transitionable = false,
                action0 = arguments[0];

            if (arguments.length === 1 ||
                arguments.length === 2 && !_.isFunction(arguments[1])) {
                transitionable = !!action0.transitionable;
            }

            if (transitionable) {
                var origArguments = arguments;
                d3.select(document)
                    .transition('history.perform')
                    .duration(duration)
                    .ease(d3.easeLinear)
                    .tween('history.tween', function() {
                        return function(t) {
                            if (t < 1) _overwrite([action0], t);
                        };
                    })
                    .on('start', function() {
                        _perform([action0], 0);
                    })
                    .on('end interrupt', function() {
                        _overwrite(origArguments, 1);
                    });

            } else {
                return _perform(arguments);
            }
        },


        replace: function() {
            d3.select(document).interrupt('history.perform');
            return _replace(arguments, 1);
        },


        // Same as calling pop and then perform
        overwrite: function() {
            d3.select(document).interrupt('history.perform');
            return _overwrite(arguments, 1);
        },


        pop: function(n) {
            d3.select(document).interrupt('history.perform');

            var previous = stack[index].graph;
            if (isNaN(+n) || +n < 0) {
                n = 1;
            }
            while (n-- > 0 && index > 0) {
                index--;
                stack.pop();
            }
            return change(previous);
        },


        // Back to the previous annotated state or index = 0.
        undo: function() {
            d3.select(document).interrupt('history.perform');

            var previous = stack[index].graph;
            while (index > 0) {
                index--;
                if (stack[index].annotation) break;
            }

            dispatch.call('undone', this, stack[index]);
            return change(previous);
        },


        // Forward to the next annotated state.
        redo: function() {
            d3.select(document).interrupt('history.perform');

            var previous = stack[index].graph;
            var tryIndex = index;
            while (tryIndex < stack.length - 1) {
                tryIndex++;
                if (stack[tryIndex].annotation) {
                    index = tryIndex;
                    dispatch.call('redone', this, stack[index]);
                    break;
                }
            }

            return change(previous);
        },


        undoAnnotation: function() {
            var i = index;
            while (i >= 0) {
                if (stack[i].annotation) return stack[i].annotation;
                i--;
            }
        },


        redoAnnotation: function() {
            var i = index + 1;
            while (i <= stack.length - 1) {
                if (stack[i].annotation) return stack[i].annotation;
                i++;
            }
        },


        intersects: function(extent) {
            return tree.intersects(extent, stack[index].graph);
        },


        difference: function() {
            var base = stack[0].graph,
                head = stack[index].graph;
            return coreDifference(base, head);
        },


        changes: function(action) {
            var base = stack[0].graph,
                head = stack[index].graph;

            if (action) {
                head = action(head);
            }

            var difference = coreDifference(base, head);

            return {
                modified: difference.modified(),
                created: difference.created(),
                deleted: difference.deleted()
            };
        },


        validate: function(changes) {
            return _(Validations)
                .map(function(fn) { return fn()(changes, stack[index].graph); })
                .flatten()
                .value();
        },


        hasChanges: function() {
            return this.difference().length() > 0;
        },


        imageryUsed: function(sources) {
            if (sources) {
                imageryUsed = sources;
                return history;
            } else {
                return _(stack.slice(1, index + 1))
                    .map('imageryUsed')
                    .flatten()
                    .uniq()
                    .without(undefined, 'Custom')
                    .value();
            }
        },


        // save the current history state
        checkpoint: function(key) {
            checkpoints[key] = {
                stack: _.cloneDeep(stack),
                index: index
            };
            return history;
        },


        // restore history state to a given checkpoint or reset completely
        reset: function(key) {
            if (key !== undefined && checkpoints.hasOwnProperty(key)) {
                stack = _.cloneDeep(checkpoints[key].stack);
                index = checkpoints[key].index;
            } else {
                stack = [{graph: coreGraph(context)}];
                index = 0;
                tree = coreTree(stack[0].graph);
                checkpoints = {};
            }
            dispatch.call('change');
            return history;
        },


        toIntroGraph: function() {
            var nextId = { n: 0, r: 0, w: 0 },
                permIds = {},
                graph = this.graph(),
                baseEntities = {};

            // clone base entities..
            _.forEach(graph.base().entities, function(entity) {
                var copy = _.cloneDeepWith(entity, customizer);
                baseEntities[copy.id] = copy;
            });

            // replace base entities with head entities..
            _.forEach(graph.entities, function(entity, id) {
                if (entity) {
                    var copy = _.cloneDeepWith(entity, customizer);
                    baseEntities[copy.id] = copy;
                } else {
                    delete baseEntities[id];
                }
            });

            // swap temporary for permanent ids..
            _.forEach(baseEntities, function(entity) {
                if (Array.isArray(entity.nodes)) {
                    entity.nodes = entity.nodes.map(function(node) {
                        return permIds[node] || node;
                    });
                }
                if (Array.isArray(entity.members)) {
                    entity.members = entity.members.map(function(member) {
                        member.id = permIds[member.id] || member.id;
                        return member;
                    });
                }
            });

            return JSON.stringify({ dataIntroGraph: baseEntities });


            function customizer(src) {
                var copy = _.omit(_.cloneDeep(src),
                    ['type', 'user', 'v', 'version', 'visible']);
                if (_.isEmpty(copy.tags)) {
                    delete copy.tags;
                }

                if (Array.isArray(copy.loc)) {
                    copy.loc[0] = +copy.loc[0].toFixed(6);
                    copy.loc[1] = +copy.loc[1].toFixed(6);
                }

                var match = src.id.match(/([nrw])-\d*/);  // temporary id
                if (match !== null) {
                    var nrw = match[1], permId;
                    do { permId = nrw + (++nextId[nrw]); }
                    while (baseEntities.hasOwnProperty(permId));

                    copy.id = permIds[src.id] = permId;
                }
                return copy;
            }
        },


        toJSON: function() {
            if (!this.hasChanges()) return;

            var allEntities = {},
                baseEntities = {},
                base = stack[0];

            var s = stack.map(function(i) {
                var modified = [], deleted = [];

                _.forEach(i.graph.entities, function(entity, id) {
                    if (entity) {
                        var key = osmEntity.key(entity);
                        allEntities[key] = entity;
                        modified.push(key);
                    } else {
                        deleted.push(id);
                    }

                    // make sure that the originals of changed or deleted
                    // entities get merged into the base of the stack after
                    // restoring the data from JSON.
                    if (id in base.graph.entities) {
                        baseEntities[id] = base.graph.entities[id];
                    }
                    // get originals of parent entities too
                    _.forEach(base.graph._parentWays[id], function(parentId) {
                        if (parentId in base.graph.entities) {
                            baseEntities[parentId] =
                                base.graph.entities[parentId];
                        }
                    });
                });

                var x = {};

                if (modified.length) x.modified = modified;
                if (deleted.length) x.deleted = deleted;
                if (i.imageryUsed) x.imageryUsed = i.imageryUsed;
                if (i.annotation) x.annotation = i.annotation;

                return x;
            });

            return JSON.stringify({
                version: 3,
                entities: _.values(allEntities),
                baseEntities: _.values(baseEntities),
                stack: s,
                nextIDs: osmEntity.id.next,
                index: index
            });
        },


        fromJSON: function(json, loadChildNodes) {
            var h = JSON.parse(json),
                loadComplete = true;

            osmEntity.id.next = h.nextIDs;
            index = h.index;

            if (h.version === 2 || h.version === 3) {
                var allEntities = {};

                h.entities.forEach(function(entity) {
                    allEntities[osmEntity.key(entity)] = osmEntity(entity);
                });

                if (h.version === 3) {
                    // This merges originals for changed entities into the base
                    // of the stack even if the current stack doesn't have them
                    // (for example when iD has been restarted in a different
                    // region)
                    var baseEntities = h.baseEntities.map(
                        function(d) { return osmEntity(d); }
                    );
                    stack[0].graph.rebase(baseEntities, _.map(stack, 'graph'),
                        true);
                    tree.rebase(baseEntities, true);

                    // When we restore a modified way, we also need to fetch any
                    // missing childnodes that would normally have been
                    // downloaded with it.. #2142
                    if (loadChildNodes) {
                        var missing =  _(baseEntities)
                                .filter({ type: 'way' })
                                .map('nodes')
                                .flatten()
                                .uniq()
                                .reject(function(n) {
                                    return stack[0].graph.hasEntity(n);
                                }).value();

                        if (!_.isEmpty(missing)) {
                            loadComplete = false;
                            context.redrawEnable(false);

                            var loading = uiLoading(context).blocking(true);
                            context.container().call(loading);

                            var childNodesLoaded = function(err, result) {
                                if (!err) {
                                    var visible = _.groupBy(
                                        result.data, 'visible');
                                    if (!_.isEmpty(visible.true)) {
                                        missing = _.difference(missing,
                                            _.map(visible.true, 'id'));
                                        stack[0].graph.rebase(visible.true,
                                            _.map(stack, 'graph'), true);
                                        tree.rebase(visible.true, true);
                                    }

                                    // fetch older versions of nodes that were
                                    // deleted..
                                    _.each(visible.false, function(entity) {
                                        context.connection().loadEntityVersion(
                                            entity.id,
                                            +entity.version - 1,
                                            childNodesLoaded
                                        );
                                    });
                                }

                                if (err || _.isEmpty(missing)) {
                                    loading.close();
                                    context.redrawEnable(true);
                                    dispatch.call('change');
                                }
                            };

                            context.connection().loadMultiple(
                                missing, childNodesLoaded);
                        }
                    }
                }

                stack = h.stack.map(function(d) {
                    var entities = {}, entity;

                    if (d.modified) {
                        d.modified.forEach(function(key) {
                            entity = allEntities[key];
                            entities[entity.id] = entity;
                        });
                    }

                    if (d.deleted) {
                        d.deleted.forEach(function(id) {
                            entities[id] = undefined;
                        });
                    }

                    return {
                        graph: coreGraph(context, stack[0].graph).load(
                            entities),
                        annotation: d.annotation,
                        imageryUsed: d.imageryUsed
                    };
                });

            } else { // original version
                stack = h.stack.map(function(d) {
                    var entities = {};

                    for (var i in d.entities) {
                        var entity = d.entities[i];
                        entities[i] = entity === 'undefined'
                            ? undefined : osmEntity(entity);
                    }

                    d.graph = coreGraph(context, stack[0].graph).load(entities);
                    return d;
                });
            }

            if (loadComplete) {
                dispatch.call('change');
            }

            return history;
        },


        save: function() {
            if (!context.restoreDisabled() && lock.locked())
                context.storage(
                    getKey('saved_history'),
                    history.toJSON() || null
                );
            return history;
        },


        clearSaved: function() {
            context.debouncedSave.cancel();
            if (lock.locked()) context.storage(getKey('saved_history'), null);
            return history;
        },


        lock: function() {
            return lock.lock();
        },


        unlock: function() {
            lock.unlock();
        },


        // is iD not open in another window and it detects that
        // there's a history stored in localStorage that's recoverable?
        restorableChanges: function() {
            return lock.locked() && !!context.storage(getKey('saved_history'));
        },


        // load history from a version stored in localStorage
        restore: function() {
            if (!lock.locked()) return;

            var json = context.storage(getKey('saved_history'));
            if (json) history.fromJSON(json, true);
        },


        _getKey: getKey

    };


    history.reset();

    return utilRebind(history, dispatch, 'on');
}
