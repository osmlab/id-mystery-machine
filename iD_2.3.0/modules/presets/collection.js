import _ from 'lodash';
import { utilEditDistance } from '../util/index';


export function presetCollection(collection) {
    var maxSearchResults = 50,
        maxSuggestionResults = 10;

    var presets = {

        collection: collection,


        item: function(id) {
            return _.find(this.collection, function(d) {
                return d.id === id;
            });
        },


        matchGeometry: function(geometry) {
            return presetCollection(this.collection.filter(function(d) {
                return d.matchGeometry(geometry);
            }));
        },


        search: function(value, geometry) {
            if (!value) return this;

            function leading(a) {
                var index = a.indexOf(value);
                return index === 0 || a[index - 1] === ' ';
            }

            function suggestionName(name) {
                var nameArray = name.split(' - ');
                if (nameArray.length > 1) {
                    name = nameArray.slice(0, nameArray.length - 1).join(' - ');
                }
                return name.toLowerCase();
            }


            value = value.toLowerCase();

            var searchable = _.filter(this.collection, function(a) {
                    return a.searchable !== false && a.suggestion !== true;
                }),
                suggestions = _.filter(this.collection, function(a) {
                    return a.suggestion === true;
                });


            // matches value to preset.name
            var leading_name = _.filter(searchable, function(a) {
                    return leading(a.name().toLowerCase());
                }).sort(function(a, b) {
                    var i;
                    i = b.originalScore - a.originalScore;
                    if (i !== 0) return i;

                    i = a.name().toLowerCase().indexOf(value) -
                        b.name().toLowerCase().indexOf(value);
                    if (i !== 0) return i;

                    return a.name().length - b.name().length;
                });

            // matches value to preset.terms values
            var leading_terms = _.filter(searchable, function(a) {
                    return _.some(a.terms() || [], leading);
                });

            // matches value to preset.tags values
            var leading_tag_values = _.filter(searchable, function(a) {
                    return _.some(
                        _.without(_.values(a.tags || {}), '*'),
                        leading
                    );
                });


            // finds close matches to value in preset.name
            var similar_name = searchable.map(function(a) {
                    return {
                        preset: a,
                        dist: utilEditDistance(value, a.name())
                    };
                }).filter(function(a) {
                    return a.dist +
                        Math.min(value.length - a.preset.name().length, 0) < 3;
                }).sort(function(a, b) {
                    return a.dist - b.dist;
                }).map(function(a) {
                    return a.preset;
                });

            // finds close matches to value in preset.terms
            var similar_terms = _.filter(searchable, function(a) {
                    return _.some(a.terms() || [], function(b) {
                        return utilEditDistance(value, b) +
                            Math.min(value.length - b.length, 0) < 3;
                    });
                });

            var leading_suggestions = _.filter(suggestions, function(a) {
                    return leading(suggestionName(a.name()));
                }).sort(function(a, b) {
                    a = suggestionName(a.name());
                    b = suggestionName(b.name());
                    var i = a.indexOf(value) - b.indexOf(value);
                    if (i === 0) return a.length - b.length;
                    else return i;
                });

            var similar_suggestions = suggestions.map(function(a) {
                    return {
                        preset: a,
                        dist: utilEditDistance(value, suggestionName(a.name()))
                    };
                }).filter(function(a) {
                    return a.dist + Math.min(value.length -
                          suggestionName(a.preset.name()).length, 0) < 1;
                }).sort(function(a, b) {
                    return a.dist - b.dist;
                }).map(function(a) {
                    return a.preset;
                });

            var other = presets.item(geometry);

            var results = leading_name.concat(
                    leading_terms,
                    leading_tag_values,
                    leading_suggestions.slice(0, maxSuggestionResults + 5),
                    similar_name,
                    similar_terms,
                    similar_suggestions.slice(0, maxSuggestionResults)
                ).slice(0, maxSearchResults - 1);

            return presetCollection(_.uniq(results.concat(other)));
        }
    };


    return presets;
}
