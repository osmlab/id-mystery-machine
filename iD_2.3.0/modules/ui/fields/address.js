import * as d3 from 'd3';
import _ from 'lodash';
import { d3combobox } from '../../lib/d3.combobox.js';
import { dataAddressFormats } from '../../../data/index';

import {
    geoExtent,
    geoChooseEdge,
    geoSphericalDistance
} from '../../geo/index';

import { services } from '../../services/index';
import {
    utilGetSetValue,
    utilNoAuto,
    utilRebind
} from '../../util';


export function uiFieldAddress(field, context) {
    var dispatch = d3.dispatch('init', 'change'),
        nominatim = services.geocoder,
        wrap = d3.select(null),
        isInitialized = false,
        entity;

    function getNearStreets() {
        var extent = entity.extent(context.graph()),
            l = extent.center(),
            box = geoExtent(l).padByMeters(200);

        var streets = context.intersects(box)
            .filter(isAddressable)
            .map(function(d) {
                var loc = context.projection([
                    (extent[0][0] + extent[1][0]) / 2,
                    (extent[0][1] + extent[1][1]) / 2]),
                    choice = geoChooseEdge(
                        context.childNodes(d), loc, context.projection
                    );
                return {
                    title: d.tags.name,
                    value: d.tags.name,
                    dist: choice.distance
                };
            })
            .sort(function(a, b) {
                return a.dist - b.dist;
            });

        return _.uniqBy(streets, 'value');

        function isAddressable(d) {
            return d.tags.highway && d.tags.name && d.type === 'way';
        }
    }


    function getNearCities() {
        var extent = entity.extent(context.graph()),
            l = extent.center(),
            box = geoExtent(l).padByMeters(200);

        var cities = context.intersects(box)
            .filter(isAddressable)
            .map(function(d) {
                return {
                    title: d.tags['addr:city'] || d.tags.name,
                    value: d.tags['addr:city'] || d.tags.name,
                    dist: geoSphericalDistance(
                        d.extent(context.graph()).center(), l
                    )
                };
            })
            .sort(function(a, b) {
                return a.dist - b.dist;
            });

        return _.uniqBy(cities, 'value');


        function isAddressable(d) {
            if (d.tags.name &&
                (d.tags.admin_level === '8' || d.tags.border_type === 'city'))
                return true;

            if (d.tags.place && d.tags.name && (
                    d.tags.place === 'city' ||
                    d.tags.place === 'town' ||
                    d.tags.place === 'village'))
                return true;

            if (d.tags['addr:city']) return true;

            return false;
        }
    }

    function getNearValues(key) {
        var extent = entity.extent(context.graph()),
            l = extent.center(),
            box = geoExtent(l).padByMeters(200);

        var results = context.intersects(box)
            .filter(function hasTag(d) {
                return d.tags[key];
            })
            .map(function(d) {
                return {
                    title: d.tags[key],
                    value: d.tags[key],
                    dist: geoSphericalDistance(
                        d.extent(context.graph()).center(), l
                    )
                };
            })
            .sort(function(a, b) {
                return a.dist - b.dist;
            });

        return _.uniqBy(results, 'value');
    }


    function initCallback(err, countryCode) {
        if (err) return;

        var addressFormat = _.find(dataAddressFormats, function (a) {
            return a && a.countryCodes &&
                _.includes(a.countryCodes, countryCode.toLowerCase());
        }) || _.first(dataAddressFormats);

        var widths = addressFormat.widths || {
            housenumber: 1/3, street: 2/3,
            city: 2/3, state: 1/4, postcode: 1/3
        };

        function row(r) {
            // Normalize widths.
            var total = _.reduce(r, function(sum, field) {
                return sum + (widths[field] || 0.5);
            }, 0);

            return r.map(function (field) {
                return {
                    id: field,
                    width: (widths[field] || 0.5) / total
                };
            });
        }

        wrap.selectAll('div.addr-row')
            .data(addressFormat.format)
            .enter()
            .append('div')
            .attr('class', 'addr-row')
            .selectAll('input')
            .data(row)
            .enter()
            .append('input')
            .property('type', 'text')
            .attr('placeholder', function (d) {
                var localkey = d.id + '!' + countryCode.toLowerCase(),
                    tkey = field.strings.placeholders[localkey]
                        ? localkey
                        : d.id;
                return field.t('placeholders.' + tkey);
            })
            .attr('class', function (d) { return 'addr-' + d.id; })
            .call(utilNoAuto)
            .style('width', function (d) { return d.width * 100 + '%'; });

        // Update

        // setup dropdowns for common address tags
        var dropdowns = addressFormat.dropdowns || [
            'city', 'county', 'country', 'district', 'hamlet',
            'neighbourhood', 'place', 'postcode', 'province',
            'quarter', 'state', 'street', 'subdistrict', 'suburb'
        ];

        // If fields exist for any of these tags, create dropdowns to pick
        // nearby values..
        dropdowns.forEach(function(tag) {
            var nearValues = (tag === 'street') ? getNearStreets
                    : (tag === 'city') ? getNearCities
                    : getNearValues;

            wrap.selectAll('input.addr-' + tag)
                .call(d3combobox()
                    .container(context.container())
                    .minItems(1)
                    .fetcher(function(value, callback) {
                        callback(nearValues('addr:' + tag));
                    })
                );
        });

        wrap.selectAll('input')
            .on('blur', change())
            .on('change', change());

        wrap.selectAll('input:not(.combobox-input)')
            .on('input', change(true));

        dispatch.call('init');
        isInitialized = true;
    }


    function address(selection) {
        isInitialized = false;

        wrap = selection.selectAll('.preset-input-wrap')
            .data([0]);

        wrap = wrap.enter()
            .append('div')
            .attr('class', 'preset-input-wrap')
            .merge(wrap);

        if (nominatim && entity) {
            var center = entity.extent(context.graph()).center();
            nominatim.countryCode(center, initCallback);
        }
    }


    function change(onInput) {
        return function() {
            var tags = {};

            wrap.selectAll('input')
                .each(function (field) {
                    tags['addr:' + field.id] = this.value || undefined;
                });

            dispatch.call('change', this, tags, onInput);
        };
    }


    function updateTags(tags) {
        utilGetSetValue(wrap.selectAll('input'), function (field) {
            return tags['addr:' + field.id] || '';
        });
    }


    address.entity = function(_) {
        if (!arguments.length) return entity;
        entity = _;
        return address;
    };


    address.tags = function(tags) {
        if (isInitialized) {
            updateTags(tags);
        } else {
            dispatch.on('init', function () {
                dispatch.on('init', null);
                updateTags(tags);
            });
        }
    };


    address.focus = function() {
        var node = wrap.selectAll('input').node();
        if (node) node.focus();
    };


    return utilRebind(address, dispatch, 'on');
}
