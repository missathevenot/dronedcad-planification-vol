'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Batteries = require('../batteries.js');

const defaultBatterie = () => ({ ...Batteries.DEFAULTS });

test('calculerAutonomie: mission fitting in a single flight, defaults produce zero alertes', () => {
  const r = Batteries.calculerAutonomie({
    tempsVolGeometriqueMin: 20,
    surfaceHa: 10,
    batterie: defaultBatterie()
  });
  assert.equal(r.nbVols, 1);
  assert.equal(r.nbPairesMinimales, 1);
  assert.equal(r.nbBatteriesTB65, 2);
  assert.equal(r.nbRotations, 0);
  assert.equal(r.nbMissionsAutomatiques, 1);
  assert.equal(r.nbDecollages, 1);
  assert.equal(r.tempsUtileParPaireMin, 26); // 40*0.8 - 2 - 4
  assert.equal(r.autonomieRestanteMin, 6); // 26 - 20
  assert.deepEqual(r.alertes, []);
});

test('calculerAutonomie: mission requiring multiple flights', () => {
  const r = Batteries.calculerAutonomie({
    tempsVolGeometriqueMin: 60,
    surfaceHa: 25,
    batterie: defaultBatterie()
  });
  assert.equal(r.nbVols, 3); // ceil(60/26)
  assert.equal(r.nbPairesMinimales, 2);
  assert.equal(r.nbBatteriesTB65, 4);
  assert.equal(r.nbRotations, 2);
  assert.equal(r.nbMissionsAutomatiques, 3);
  assert.equal(r.nbDecollages, 3);
  assert.equal(r.autonomieRestanteMin, 18); // 3*26 - 60
  assert.equal(r.tempsChangementsMin, 8); // 2 rotations * 4 min
  assert.equal(r.tempsTerrainTotalMin, 68); // 60 + 8
  assert.ok(Math.abs(r.rendementHaH - (25 / (68 / 60))) < 1e-9);
});

test('calculerAutonomie: décollage + retour + réserve exceeding autonomy raises a danger alerte', () => {
  const b = defaultBatterie();
  b.reserveSecuritePct = 95;
  b.tempsDecollageMin = 10;
  b.tempsRetourMin = 10;
  const r = Batteries.calculerAutonomie({ tempsVolGeometriqueMin: 30, surfaceHa: 5, batterie: b });
  assert.equal(r.nbVols, 0);
  assert.ok(r.alertes.some((a) => a.type === 'danger'));
});

test('calculerAutonomie: retour far above recommended range raises a warning (not a danger)', () => {
  const b = defaultBatterie();
  b.tempsRetourMin = 20;
  const r = Batteries.calculerAutonomie({ tempsVolGeometriqueMin: 10, surfaceHa: 5, batterie: b });
  assert.ok(r.alertes.length > 0);
  assert.ok(r.alertes.every((a) => a.type === 'warning'));
});

test('calculerAutonomie: reserveSecuritePct out of [0,100] raises a danger alerte', () => {
  const b = defaultBatterie();
  b.reserveSecuritePct = 150;
  const r = Batteries.calculerAutonomie({ tempsVolGeometriqueMin: 10, surfaceHa: 5, batterie: b });
  assert.ok(r.alertes.some((a) => a.type === 'danger'));
});

test('calculerAutonomie: negative tempsDecollageMin or tempsRetourMin raises a danger alerte', () => {
  const b = defaultBatterie();
  b.tempsDecollageMin = -1;
  const r = Batteries.calculerAutonomie({ tempsVolGeometriqueMin: 10, surfaceHa: 5, batterie: b });
  assert.ok(r.alertes.some((a) => a.type === 'danger' && /négatifs/.test(a.msg)));
});
