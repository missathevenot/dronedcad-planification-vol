'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Traitement = require('../traitement.js');

function baseParams(overrides = {}) {
  return {
    nombrePhotos: 1000,
    empreintePx: 42000000,
    surfaceM2: 1000000,
    gsd: 100,
    formatCapture: 'both',
    limites: { tailleImageRawMo: 82, tailleImageJpegMo: 38 },
    coefficientPC: 1.00,
    ...overrides
  };
}

test('calculerTraitement: phase times at coefficient 1.00 (portable) split 15/45/10/10/20 %', () => {
  const r = Traitement.calculerTraitement(baseParams());
  assert.ok(Math.abs(r.tempsAlignementH - 1.5) < 1e-9);
  assert.ok(Math.abs(r.tempsNuageH - 4.5) < 1e-9);
  assert.ok(Math.abs(r.tempsMNSH - 1.0) < 1e-9);
  assert.ok(Math.abs(r.tempsMNTH - 1.0) < 1e-9);
  assert.ok(Math.abs(r.tempsOrthophotoH - 2.0) < 1e-9);
  assert.ok(Math.abs(r.tempsTotalH - 10.0) < 1e-9);
});

test('calculerTraitement: phase times scale linearly with coefficientPC', () => {
  const r = Traitement.calculerTraitement(baseParams({ coefficientPC: 0.65 }));
  assert.ok(Math.abs(r.tempsTotalH - 6.5) < 1e-9);
  assert.ok(Math.abs(r.tempsNuageH - (4.5 * 0.65)) < 1e-9);
  assert.ok(Math.abs(r.tempsAlignementH - (1.5 * 0.65)) < 1e-9);
});

test('calculerTraitement: product sizes are independent of coefficientPC', () => {
  const rPortable = Traitement.calculerTraitement(baseParams({ coefficientPC: 1.00 }));
  const rServeur = Traitement.calculerTraitement(baseParams({ coefficientPC: 0.20 }));
  assert.equal(rPortable.orthophotoMo, rServeur.orthophotoMo);
  assert.equal(rPortable.nuagePointsMo, rServeur.nuagePointsMo);
  assert.equal(rPortable.mnsMo, rServeur.mnsMo);
  assert.equal(rPortable.mntMo, rServeur.mntMo);
  assert.equal(rPortable.volumeImagesMo, rServeur.volumeImagesMo);
  assert.notEqual(rPortable.tempsTotalH, rServeur.tempsTotalH);
});

test('calculerTraitement: product sizes match the documented formulas', () => {
  const r = Traitement.calculerTraitement(baseParams());
  const gsdM = 1.0; // gsd=100cm -> 1 m/px
  const pixelsOrtho = 1000000 / (gsdM * gsdM);
  assert.ok(Math.abs(r.orthophotoMo - (pixelsOrtho * 1.5) / (1024 * 1024)) < 1e-9);
  assert.ok(Math.abs(r.nuagePointsMo - (pixelsOrtho * 4 * 18) / (1024 * 1024)) < 1e-9);
  const pixelsMNS = 1000000 / (gsdM * gsdM);
  const pixelsMNT = 1000000 / ((gsdM * 4) * (gsdM * 4));
  assert.ok(Math.abs(r.mnsMo - (pixelsMNS * 4) / (1024 * 1024)) < 1e-9);
  assert.ok(Math.abs(r.mntMo - (pixelsMNT * 4) / (1024 * 1024)) < 1e-9);
});

test('calculerTraitement: raw image size uses formatCapture and limites', () => {
  const rBoth = Traitement.calculerTraitement(baseParams({ formatCapture: 'both' }));
  assert.equal(rBoth.tailleParPhotoMo, 120);
  assert.equal(rBoth.volumeImagesMo, 120000);
  const rJpeg = Traitement.calculerTraitement(baseParams({ formatCapture: 'jpeg' }));
  assert.equal(rJpeg.tailleParPhotoMo, 38);
  assert.equal(rJpeg.volumeImagesMo, 38000);
  const rRaw = Traitement.calculerTraitement(baseParams({ formatCapture: 'raw' }));
  assert.equal(rRaw.tailleParPhotoMo, 82);
  assert.equal(rRaw.volumeImagesMo, 82000);
});

test('calculerTraitement: recommended storage is 1.3x the total product size', () => {
  const r = Traitement.calculerTraitement(baseParams());
  const tailleTotale = r.volumeImagesMo + r.orthophotoMo + r.nuagePointsMo + r.mnsMo + r.mntMo;
  assert.ok(Math.abs(r.tailleTotaleMo - tailleTotale) < 1e-9);
  assert.ok(Math.abs(r.stockageRecommandeMo - tailleTotale * 1.3) < 1e-9);
});

test('DEFAULTS.repartition percentages sum to 1.00 (100%)', () => {
  const rep = Traitement.DEFAULTS.repartition;
  const somme = rep.alignement + rep.nuage + rep.mns + rep.mnt + rep.orthophoto;
  assert.ok(Math.abs(somme - 1.0) < 1e-9);
});
