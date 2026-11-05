import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { getAppearance, validateExposure, validateSnapshot } = require('../dist/photochromic.js');

test('photochromic off stays clear at every exposure, and enabled UV zero is clear without disabling the mode', () => {
  for (const uvExposure of [0, .5, 50, 100]) {
    const off = getAppearance(false, uvExposure);
    assert.equal(off.colorHex, null);
    assert.equal(off.visualDarknessPercent, 0);
    assert.equal(off.enabled, false);
    assert.equal(off.uvExposure, uvExposure);
  }
  const clear = getAppearance(true, 0), dark = getAppearance(true, 100);
  assert.equal(clear.enabled, true);
  assert.equal(clear.colorHex, null);
  assert.equal(clear.visualDarknessPercent, 0);
  assert.match(dark.colorHex, /^#[0-9A-F]{6}$/);
  assert.ok(parseInt(dark.colorHex.slice(1, 3), 16) < 80, 'Full visual exposure must produce a visibly dark appearance.');
  assert.equal(dark.visualDarknessPercent, 100);
  assert.equal(dark.simulationOnly, true);
});

test('more exposure never makes the neutral lens lighter; decreasing exposure reverses the same visual response', () => {
  let previousChannel = 255, previousDarkness = 0;
  const ascending = [];
  for (let uvExposure = 1; uvExposure <= 100; uvExposure++) {
    const appearance = getAppearance(true, uvExposure);
    const channels = appearance.colorHex.slice(1).match(/../g).map(value => parseInt(value, 16));
    assert.ok(channels.every(value => value === channels[0]), 'The reference photochromic preview remains neutral gray.');
    assert.ok(channels[0] <= previousChannel);
    assert.ok(appearance.visualDarknessPercent >= previousDarkness);
    ascending.push(appearance);
    previousChannel = channels[0]; previousDarkness = appearance.visualDarknessPercent;
  }
  for (let uvExposure = 100; uvExposure >= 1; uvExposure--) assert.deepEqual(getAppearance(true, uvExposure), ascending[uvExposure - 1]);
});

test('one shared exposure produces independent photochromic and tint-compatible pair modes', () => {
  const a = getAppearance(true, 68.5), b = getAppearance(false, 68.5);
  assert.equal(a.uvExposure, b.uvExposure);
  assert.ok(a.colorHex);
  assert.equal(b.colorHex, null);
  assert.equal(a.visualDarknessPercent, 68.5);
  assert.equal(b.visualDarknessPercent, 0);
  a.colorHex = '#FFFFFF';
  assert.notEqual(getAppearance(true, 68.5).colorHex, a.colorHex, 'Callers cannot mutate later results through a shared object.');
});

test('invalid UV values and non-boolean modes fail validation instead of being silently coerced', () => {
  for (const value of [null, '50', '', true, {}, [], -1, 100.01, NaN, Infinity, -Infinity]) {
    assert.throws(() => validateExposure(value), /0–100/);
    assert.throws(() => getAppearance(true, value), /0–100/);
  }
  assert.throws(() => validateExposure(undefined), /0–100/);
  for (const value of [null, 0, 1, 'true', 'false', [], {}]) assert.throws(() => getAppearance(value, 50), /boolean/);
  assert.equal(getAppearance().enabled, false);
});

test('snapshot validation enforces tint exclusion and one explicit shared exposure', () => {
  const value = getAppearance(true, 60), original = structuredClone(value);
  assert.deepEqual(validateSnapshot(value, { uvExposure: 60, tint: null, required: true }), value);
  assert.deepEqual(value, original);
  for (const tint of [{ code: '09S' }, { code: null }, {}]) assert.throws(() => validateSnapshot(value, { uvExposure: 60, tint }), /tinting/);
  assert.throws(() => validateSnapshot(value, { uvExposure: 30 }), /sama/);
  assert.deepEqual(validateSnapshot(getAppearance(false, 60), { uvExposure: 60, tint: { code: '09S' } }), getAppearance(false, 60));
  assert.deepEqual(validateSnapshot(undefined), getAppearance(false, 0));
  assert.throws(() => validateSnapshot(undefined, { required: true }), /TransActiv/);
});

test('snapshots cannot claim a different darkness or calibrated response than the illustrative UV model', () => {
  for (const patch of [
    { enabled: 'true' }, { enabled: null }, { uvExposure: '60' }, { uvExposure: null },
    { simulationOnly: false }, { simulationOnly: undefined }, { visualDarknessPercent: 61 },
    { visualDarknessPercent: '60' }, { visualDarknessPercent: NaN }, { colorHex: '#ff0000' },
    { colorHex: {} }, { colorHex: '#bad' }, { colorHex: null }
  ]) {
    assert.throws(() => validateSnapshot({ ...getAppearance(true, 60), ...patch }, { uvExposure: 60, required: true }));
  }
  const lowerCase = getAppearance(true, 60); lowerCase.colorHex = lowerCase.colorHex.toLowerCase();
  assert.deepEqual(validateSnapshot(lowerCase, { uvExposure: 60 }), getAppearance(true, 60));
});

test('the identical pure model is available to the browser without Node globals or a DOM', () => {
  const sandbox = { window: {} };
  runInNewContext(readFileSync(new URL('../dist/photochromic.js', import.meta.url), 'utf8'), sandbox);
  assert.equal(typeof sandbox.window.LeinzPhotochromic.getAppearance, 'function');
  assert.deepEqual(JSON.parse(JSON.stringify(sandbox.window.LeinzPhotochromic.getAppearance(true, 75))), getAppearance(true, 75));
});
