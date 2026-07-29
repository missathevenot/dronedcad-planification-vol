'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Meteo = require('../meteo.js');

test('construireUrlOpenMeteo: builds the exact expected Open-Meteo forecast URL', () => {
  const url = Meteo.construireUrlOpenMeteo({ latitude: 5.3364, longitude: -4.0267, date: '2026-08-01' });
  assert.equal(
    url,
    'https://api.open-meteo.com/v1/forecast?latitude=5.3364&longitude=-4.0267' +
    '&hourly=wind_speed_10m,wind_gusts_10m,precipitation,cloud_cover,visibility,relative_humidity_2m,weather_code' +
    '&start_date=2026-08-01&end_date=2026-08-01&wind_speed_unit=kmh&timezone=auto'
  );
});

test('extraireDonneesHeure: extracts and converts the fields for the matching hour', () => {
  const reponseApi = {
    hourly: {
      time: ['2026-08-01T13:00', '2026-08-01T14:00'],
      wind_speed_10m: [15, 25],
      wind_gusts_10m: [20, 35],
      precipitation: [0, 0],
      cloud_cover: [40, 60],
      visibility: [15000, 8000],
      relative_humidity_2m: [55, 70],
      weather_code: [1, 45]
    }
  };
  const donnees = Meteo.extraireDonneesHeure(reponseApi, '2026-08-01', '14:00');
  assert.equal(donnees.ventKmh, 25);
  assert.equal(donnees.rafalesKmh, 35);
  assert.equal(donnees.precipitationMm, 0);
  assert.equal(donnees.couvertureNuageusePct, 60);
  assert.equal(donnees.visibiliteKm, 8);
  assert.equal(donnees.humiditePct, 70);
  assert.equal(donnees.codeTemps, 45);
  assert.equal(donnees.orage, false);
  assert.equal(donnees.brouillard, true);
});

test('extraireDonneesHeure: throws a clear error when the hour is outside the forecast range', () => {
  const reponseApi = {
    hourly: {
      time: ['2026-08-01T13:00'], wind_speed_10m: [15], wind_gusts_10m: [20],
      precipitation: [0], cloud_cover: [40], visibility: [15000],
      relative_humidity_2m: [55], weather_code: [1]
    }
  };
  assert.throws(() => Meteo.extraireDonneesHeure(reponseApi, '2026-08-01', '23:00'), /hors plage de prévision/);
});

test('construireLiensExternes: builds verified deep links for Ventusky/Windy and safe homepage links for the other two', () => {
  const liens = Meteo.construireLiensExternes({ latitude: 5.3364, longitude: -4.0267 });
  assert.equal(liens.ventusky, 'https://www.ventusky.com/5.3364;-4.0267');
  assert.equal(liens.windy, 'https://www.windy.com/?5.3364,-4.0267,10,d:picker');
  assert.equal(liens.zoomEarth, 'https://zoom.earth/');
  assert.equal(liens.uavForecast, 'https://www.uavforecast.com/');
});

function donneesBase(overrides = {}) {
  return {
    ventKmh: 15, rafalesKmh: 20, precipitationMm: 0, couvertureNuageusePct: 40,
    visibiliteKm: 15, humiditePct: 55, codeTemps: 1, orage: false, brouillard: false,
    ...overrides
  };
}

test('analyserFaisabilite: fully OK conditions produce verdict autorisee with no raisons', () => {
  const r = Meteo.analyserFaisabilite(donneesBase());
  assert.equal(r.verdict, 'autorisee');
  assert.deepEqual(r.raisons, []);
});

test('analyserFaisabilite: vent boundary — 20 km/h is OK, 20.1 is alerte, 30 is alerte, 30.1 is annulation', () => {
  assert.equal(Meteo.analyserFaisabilite(donneesBase({ ventKmh: 20 })).verdict, 'autorisee');
  assert.equal(Meteo.analyserFaisabilite(donneesBase({ ventKmh: 20.1 })).verdict, 'deconseillee');
  assert.equal(Meteo.analyserFaisabilite(donneesBase({ ventKmh: 30 })).verdict, 'deconseillee');
  assert.equal(Meteo.analyserFaisabilite(donneesBase({ ventKmh: 30.1 })).verdict, 'annulee');
});

test('analyserFaisabilite: rafales boundary — 30 km/h is OK, 30.1 is alerte (no annulation tier)', () => {
  assert.equal(Meteo.analyserFaisabilite(donneesBase({ rafalesKmh: 30 })).verdict, 'autorisee');
  assert.equal(Meteo.analyserFaisabilite(donneesBase({ rafalesKmh: 30.1 })).verdict, 'deconseillee');
});

test('analyserFaisabilite: any precipitation triggers annulation', () => {
  const r = Meteo.analyserFaisabilite(donneesBase({ precipitationMm: 0.5 }));
  assert.equal(r.verdict, 'annulee');
  assert.ok(r.raisons.some((x) => /Précipitations/.test(x)));
});

test('analyserFaisabilite: thunderstorm (orage) triggers annulation', () => {
  const r = Meteo.analyserFaisabilite(donneesBase({ orage: true }));
  assert.equal(r.verdict, 'annulee');
  assert.ok(r.raisons.some((x) => /Orage/.test(x)));
});

test('analyserFaisabilite: visibilite boundary — 10 km is OK, 9.9 is alerte', () => {
  assert.equal(Meteo.analyserFaisabilite(donneesBase({ visibiliteKm: 10 })).verdict, 'autorisee');
  assert.equal(Meteo.analyserFaisabilite(donneesBase({ visibiliteKm: 9.9 })).verdict, 'deconseillee');
});

test('analyserFaisabilite: fog (brouillard) triggers annulation', () => {
  const r = Meteo.analyserFaisabilite(donneesBase({ brouillard: true }));
  assert.equal(r.verdict, 'annulee');
  assert.ok(r.raisons.some((x) => /Brouillard/.test(x)));
});

test('analyserFaisabilite: worst criterion wins — one annulation overrides multiple alertes', () => {
  const r = Meteo.analyserFaisabilite(donneesBase({ ventKmh: 25, rafalesKmh: 35, visibiliteKm: 8, brouillard: true }));
  assert.equal(r.verdict, 'annulee');
  assert.equal(r.raisons.length, 4);
});

test('analyserFaisabilite: couverture nuageuse and humidite are informational only (never affect verdict)', () => {
  const r = Meteo.analyserFaisabilite(donneesBase({ couvertureNuageusePct: 100, humiditePct: 100 }));
  assert.equal(r.verdict, 'autorisee');
  assert.deepEqual(r.raisons, []);
});
