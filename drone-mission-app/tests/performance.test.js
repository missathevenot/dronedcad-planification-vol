'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Performance = require('../performance.js');

test('coefficientDe: returns the coefficient of each known PC type', () => {
  const t = Performance.DEFAULTS.types;
  assert.equal(Performance.coefficientDe(t, 'portable'), 1.00);
  assert.equal(Performance.coefficientDe(t, 'bureau'), 0.65);
  assert.equal(Performance.coefficientDe(t, 'station'), 0.35);
  assert.equal(Performance.coefficientDe(t, 'serveur'), 0.20);
});

test('coefficientDe: falls back to portable (1.00) for an unknown or missing type', () => {
  const t = Performance.DEFAULTS.types;
  assert.equal(Performance.coefficientDe(t, 'inconnu'), 1.00);
  assert.equal(Performance.coefficientDe(t, undefined), 1.00);
  assert.equal(Performance.coefficientDe(t, null), 1.00);
});

test('DEFAULTS.typeSelectionne is a valid key in DEFAULTS.types', () => {
  assert.ok(Performance.DEFAULTS.types[Performance.DEFAULTS.typeSelectionne]);
});

test('every PC type has a nom, config and coefficient', () => {
  Object.values(Performance.DEFAULTS.types).forEach((t) => {
    assert.equal(typeof t.nom, 'string');
    assert.equal(typeof t.config, 'string');
    assert.equal(typeof t.coefficient, 'number');
    assert.ok(t.coefficient > 0 && t.coefficient <= 1);
  });
});
