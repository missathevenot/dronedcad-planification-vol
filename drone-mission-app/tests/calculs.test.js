'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

global.Utils = require('../utils.js');
const Calc = require('../calculs.js');

function baseParams(overrides = {}) {
  return {
    surfaceM2: 500000,
    geometrie: { longueur: 700, largeur: 500 },
    distanceDecollageAuCentre: 100,
    drone: { ...Calc.DEFAULTS.drone, ...overrides.drone },
    camera: { ...Calc.DEFAULTS.camera, ...overrides.camera },
    vol: { ...Calc.DEFAULTS.vol, ...overrides.vol },
    couts: { ...Calc.DEFAULTS.couts, ...overrides.couts },
    limites: { ...Calc.DEFAULTS.limites, ...overrides.limites }
  };
}

test('calculerMission still computes geometry and photogrammetric product fields', () => {
  const r = Calc.calculerMission(baseParams());
  assert.ok(r.gsd > 0);
  assert.ok(r.nombreLignes >= 1);
  assert.ok(r.tempsVolMin > 0);
  assert.ok(r.orthophotoMo > 0);
  assert.ok(r.nuagePointsMo > 0);
  assert.ok(r.mnsMo > 0);
  assert.ok(r.mntMo > 0);
});

test('calculerMission no longer returns battery-derived fields (moved to Batteries)', () => {
  const r = Calc.calculerMission(baseParams());
  assert.equal(r.nbBatteriesParDrone, undefined);
  assert.equal(r.nbBatteriesTotal, undefined);
  assert.equal(r.autonomieUtile, undefined);
  assert.equal(r.tempsChangementsMin, undefined);
  assert.equal(r.tempsTerrainTotalMin, undefined);
  assert.equal(r.nbMissionsParDrone, undefined);
  assert.equal(r.surfaceParBatterieHa, undefined);
  assert.equal(r.rendementHaH, undefined);
});

test('Calc.DEFAULTS.drone no longer carries battery-specific fields', () => {
  assert.equal(Calc.DEFAULTS.drone.autonomie, undefined);
  assert.equal(Calc.DEFAULTS.drone.tempsSecurite, undefined);
  assert.equal(Calc.DEFAULTS.drone.tempsChangementBatterie, undefined);
  assert.equal(Calc.DEFAULTS.drone.batterie, undefined);
});

test('Calc.genererPlanMissions no longer exists (moved to Batteries.genererPlanVols)', () => {
  assert.equal(Calc.genererPlanMissions, undefined);
});

test('validerParametres no longer emits the old battery-specific alertes', () => {
  const params = baseParams({ vol: { altitude: 100 } });
  const alertes = Calc.validerParametres(params);
  assert.ok(!alertes.some((a) => /autonomie de la batterie/.test(a.msg)));
  assert.ok(!alertes.some((a) => /Type de batterie non renseigné/.test(a.msg)));
});

test('validerParametres still flags altitude above the drone maximum', () => {
  const params = baseParams({ vol: { altitude: 500 } });
  const alertes = Calc.validerParametres(params);
  assert.ok(alertes.some((a) => a.type === 'danger' && /Altitude de vol/.test(a.msg)));
});
