'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Zones = require('../zones.js');

test('mapperZoneVersJs: converts a snake_case row to camelCase', () => {
  const row = {
    id: 'z1', nom: 'Zone Yopougon', commune: 'Yopougon', description: 'Levé prioritaire',
    geometrie: [[5.35, -4.02], [5.36, -4.02], [5.36, -4.01]],
    created_by: 'u1', created_at: '2026-08-01T10:00:00Z', updated_at: '2026-08-01T10:00:00Z'
  };
  const js = Zones.mapperZoneVersJs(row);
  assert.equal(js.id, 'z1');
  assert.equal(js.nom, 'Zone Yopougon');
  assert.equal(js.commune, 'Yopougon');
  assert.equal(js.description, 'Levé prioritaire');
  assert.deepEqual(js.geometrie, [[5.35, -4.02], [5.36, -4.02], [5.36, -4.01]]);
  assert.equal(js.createdBy, 'u1');
  assert.equal(js.createdAt, '2026-08-01T10:00:00Z');
  assert.equal(js.updatedAt, '2026-08-01T10:00:00Z');
});

test('communesDistinctes: returns sorted, de-duplicated, non-empty communes', () => {
  const zones = [
    { commune: 'Yopougon' }, { commune: 'Cocody' }, { commune: 'Yopougon' },
    { commune: '' }, { commune: null }, { commune: 'Abobo' }
  ];
  assert.deepEqual(Zones.communesDistinctes(zones), ['Abobo', 'Cocody', 'Yopougon']);
});

test('communesDistinctes: empty array in, empty array out', () => {
  assert.deepEqual(Zones.communesDistinctes([]), []);
});

test('communesDistinctes: ignores whitespace-only communes', () => {
  const zones = [{ commune: '   ' }, { commune: 'Abobo' }];
  assert.deepEqual(Zones.communesDistinctes(zones), ['Abobo']);
});
