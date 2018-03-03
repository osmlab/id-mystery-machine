import _ from 'lodash';
import { t } from '../util/locale';
import { behaviorOperation } from '../behavior/index';
import { geoExtent } from '../geo/index';
import { modeRotate } from '../modes/index';


export function operationRotate(selectedIDs, context) {
    var multi = (selectedIDs.length === 1 ? 'single' : 'multiple'),
        extent = selectedIDs.reduce(function(extent, id) {
            return extent.extend(context.entity(id).extent(context.graph()));
        }, geoExtent());


    var operation = function() {
        context.enter(modeRotate(context, selectedIDs));
    };


    operation.available = function() {
        return _.some(selectedIDs, hasArea);

        function hasArea(id) {
            var entity = context.entity(id);
            return (entity.type === 'way' && entity.isClosed()) ||
                (entity.type ==='relation' && entity.isMultipolygon());
        }
    };


    operation.disabled = function() {
        var reason;
        if (extent.area() &&
            extent.percentContainedIn(context.extent()) < 0.8) {
            reason = 'too_large';
        } else if (_.some(selectedIDs, context.hasHiddenConnections)) {
            reason = 'connected_to_hidden';
        } else if (_.some(selectedIDs, incompleteRelation)) {
            reason = 'incomplete_relation';
        }
        return reason;

        function incompleteRelation(id) {
            var entity = context.entity(id);
            return entity.type === 'relation' &&
                !entity.isComplete(context.graph());
        }
    };


    operation.tooltip = function() {
        var disable = operation.disabled();
        return disable ?
            t('operations.rotate.' + disable + '.' + multi) :
            t('operations.rotate.description.' + multi);
    };


    operation.annotation = function() {
        return selectedIDs.length === 1
            ? t('operations.rotate.annotation.' +
                context.geometry(selectedIDs[0]))
            : t('operations.rotate.annotation.multiple');
    };


    operation.id = 'rotate';
    operation.keys = [t('operations.rotate.key')];
    operation.title = t('operations.rotate.title');
    operation.behavior = behaviorOperation(context).which(operation);

    return operation;
}
