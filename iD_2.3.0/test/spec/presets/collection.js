describe('iD.presetCollection', function() {
    var p = {
        point: iD.presetPreset('point', {
            name: 'Point',
            tags: {},
            geometry: ['point']
        }),
        line: iD.presetPreset('line', {
            name: 'Line',
            tags: {},
            geometry: ['line']
        }),
        area: iD.presetPreset('area', {
            name: 'Area',
            tags: {},
            geometry: ['area']
        }),
        grill: iD.presetPreset('__test/amenity/bbq', {
            name: 'Grill',
            tags: { amenity: 'bbq' },
            geometry: ['point'],
            terms: []
        }),
        sandpit: iD.presetPreset('__test/amenity/grit_bin', {
            name: 'Sandpit',
            tags: { amenity: 'grit_bin' },
            geometry: ['point'],
            terms: []
        }),
        residential: iD.presetPreset('__test/highway/residential', {
            name: 'Residential Area',
            tags: { highway: 'residential' },
            geometry: ['point', 'area'],
            terms: []
        }),
        grass1: iD.presetPreset('__test/landuse/grass1', {
            name: 'Grass',
            tags: { landuse: 'grass' },
            geometry: ['point', 'area'],
            terms: []
        }),
        grass2: iD.presetPreset('__test/landuse/grass2', {
            name: '\u011E\u1E5D\u0201\u00DF',
            tags: { landuse: '\u011F\u1E5D\u0201\u00DF' },
            geometry: ['point', 'area'],
            terms: []
        }),
        park: iD.presetPreset('__test/leisure/park', {
            name: 'Park',
            tags: { leisure: 'park' },
            geometry: ['point', 'area'],
            terms: [ 'grass' ]
        }),
        soccer: iD.presetPreset('__test/leisure/pitch/soccer', {
            name: 'Soccer Field',
            tags: { leisure: 'pitch', sport: 'soccer' },
            geometry: ['point', 'area'],
            terms: ['fu\u00DFball']
        }),
        football: iD.presetPreset('__test/leisure/pitch/american_football', {
            name: 'Football Field',
            tags: { leisure: 'pitch', sport: 'american_football' },
            geometry: ['point', 'area'],
            terms: ['gridiron']
        })
    };


    var c = iD.presetCollection([
        p.point, p.line, p.area, p.grill, p.sandpit, p.residential,
        p.grass1, p.grass2, p.park, p.soccer, p.football
    ]);

    describe('#item', function() {
        it('fetches a preset by id', function() {
            expect(c.item('__test/highway/residential'))
                .to.equal(p.residential);
        });
    });

    describe('#matchGeometry', function() {
        it(
            'returns a new collection only containing presets matching ' +
                'a geometry',
            function() {
                expect(c.matchGeometry('area').collection).to.include.members(
                    [p.area, p.residential, p.park, p.soccer, p.football]
                );
            }
        );
    });

    describe('#search', function() {
        it('matches leading name', function() {
            var col = c.search('resid', 'area').collection;
            // 1. 'Residential' (by name)
            expect(col.indexOf(p.residential)).to.eql(0);
        });

        it('returns alternate matches in correct order', function() {
            var col = c.search('gri', 'point').matchGeometry('point')
                .collection;
            // 1. 'Grill' (leading name)
            expect(col.indexOf(p.grill)).to.eql(0);
            // 2. 'Football' (leading term 'gridiron')
            expect(col.indexOf(p.football)).to.eql(7);
            // 3. 'Sandpit' (leading tag value 'grit_bin')
            expect(col.indexOf(p.sandpit)).to.eql(1);
            // 4. 'Grass' (similar name)
            expect(col.indexOf(p.grass1)).to.be.within(2,3);
            // 5. '\u011E\u1E5D\u0201\u00DF' (similar name)
            expect(col.indexOf(p.grass2)).to.be.within(3,4);
            // 6. 'Park' (similar term 'grass')
            expect(col.indexOf(p.park)).to.eql(4);
        });

        it('considers diacritics on exact matches', function() {
            var col = c.search('\u011F\u1E5D\u0201', 'point')
                .matchGeometry('point').collection;
            // 1. '\u011E\u1E5D\u0201\u00DF'  (leading name)
            expect(col.indexOf(p.grass2)).to.eql(0);
            // 2. 'Grass' (similar name)
            expect(col.indexOf(p.grass1)).to.eql(1);
        });

        it('replaces diacritics on fuzzy matches', function() {
            var col = c.search('gra\u00DF', 'point').matchGeometry('point')
                .collection;
            // 1. 'Grass' (similar name)
            expect(col.indexOf(p.grass1)).to.be.within(0,1);
            // 2. '\u011E\u1E5D\u0201\u00DF'  (similar name)
            expect(col.indexOf(p.grass2)).to.be.within(0,1);
        });

        it('includes the appropriate fallback preset', function() {
            expect(c.search('foo', 'point').collection).to.include(p.point);
            expect(c.search('foo', 'line').collection).to.include(p.line);
            expect(c.search('foo', 'area').collection).to.include(p.area);
        });

        it('excludes presets with searchable: false', function() {
            var excluded = iD.presetPreset('__test/excluded', {
                    name: 'excluded',
                    tags: { amenity: 'excluded' },
                    geometry: ['point'],
                    searchable: false
                }),
                collection = iD.presetCollection([excluded, p.point]);
            expect(collection.search('excluded', 'point').collection)
                .not.to.include(excluded);
        });
    });
});
