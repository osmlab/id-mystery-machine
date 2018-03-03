import _ from 'lodash';
import { t } from '../util/locale';
import { actionDeleteMultiple } from '../actions';
import { behaviorOperation } from '../behavior';
import { geoExtent, geoSphericalDistance } from '../geo';
import { modeBrowse, modeSelect } from '../modes';
import { uiCmd } from '../ui';


export function operationDelete(selectedIDs, context) {
    var multi = (selectedIDs.length === 1 ? 'single' : 'multiple'),
        action = actionDeleteMultiple(selectedIDs),
        extent = selectedIDs.reduce(function(extent, id) {
            return extent.extend(context.entity(id).extent(context.graph()));
        }, geoExtent());


    var operation = function() {
        var nextSelectedID;

        if (selectedIDs.length === 1) {
            var id = selectedIDs[0],
                entity = context.entity(id),
                geometry = context.geometry(id),
                parents = context.graph().parentWays(entity),
                parent = parents[0];

            // Select the next closest node in the way.
            if (geometry === 'vertex' && parent.nodes.length > 2) {
                var nodes = parent.nodes,
                    i = nodes.indexOf(id);

                if (i === 0) {
                    i++;
                } else if (i === nodes.length - 1) {
                    i--;
                } else {
                    var a = geoSphericalDistance(entity.loc,
                            context.entity(nodes[i - 1]).loc),
                        b = geoSphericalDistance(entity.loc,
                            context.entity(nodes[i + 1]).loc);
                    i = a < b ? i - 1 : i + 1;
                }

                nextSelectedID = nodes[i];
            }
        }

        context.perform(action, operation.annotation());

        if (nextSelectedID && context.hasEntity(nextSelectedID)) {
            context.enter(modeSelect(context, [nextSelectedID]).follow(true));
        } else {
            context.enter(modeBrowse(context));
        }

    };


    operation.available = function() {
        return true;
    };


    operation.disabled = function() {
        var reason;
        if (extent.area() &&
            extent.percentContainedIn(context.extent()) < 0.8) {
            reason = 'too_large';
        } else if (_.some(selectedIDs, context.hasHiddenConnections)) {
            reason = 'connected_to_hidden';
        } else if (_.some(selectedIDs, protectedMember)) {
            reason = 'part_of_relation';
        } else if (_.some(selectedIDs, incompleteRelation)) {
            reason = 'incomplete_relation';
        } else if (_.some(selectedIDs, isPositiveWayOrRelation) &&
            context.editInBoundsMode() === context.EDIT_IN_BOUNDS_FROM_OSM_XML)
        {
            reason = 'pos_way_relation';
        }
        return reason;

        function incompleteRelation(id) {
            var entity = context.entity(id);
            return entity.type === 'relation' &&
                !entity.isComplete(context.graph());
        }

        function isPositiveWayOrRelation(id) {
            return (id[0] === 'w' || id[0] === 'r') && id[1] !== '-';
        }

        function protectedMember(id) {
            var entity = context.entity(id);
            if (entity.type !== 'way') return false;

            var parents = context.graph().parentRelations(entity);
            for (var i = 0; i < parents.length; i++) {
                var parent = parents[i],
                    type = parent.tags.type,
                    role = parent.memberById(id).role || 'outer';
                if (type === 'route' || type === 'boundary' ||
                    (type === 'multipolygon' && role === 'outer')) {
                    return true;
                }
            }
            return false;
        }

    };


    operation.tooltip = function() {
        var disable = operation.disabled();
        return disable ?
            t('operations.delete.' + disable + '.' + multi) :
            t('operations.delete.description' + '.' + multi);
    };


    operation.annotation = function() {
        return selectedIDs.length === 1
            ? t('operations.delete.annotation.' +
                context.geometry(selectedIDs[0]))
            : t('operations.delete.annotation.multiple',
                { n: selectedIDs.length });
    };


    operation.id = 'delete';
    operation.keys = [
        uiCmd('\u2318\u232B'), // cmd + backspace
        uiCmd('\u2318\u2326'), // cmd + delete
        uiCmd('\u2326'), // delete
        uiCmd('4'),
    ];
    operation.title = t('operations.delete.title');
    operation.behavior = behaviorOperation(context).which(operation);

    return operation;
}
