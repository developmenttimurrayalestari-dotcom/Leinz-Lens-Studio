import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Optics = require('../dist/lens-optics.js');
const circle = (radius = 25, count = 256) => Array.from({ length: count }, (_, i) => [radius * Math.cos(i * 2 * Math.PI / count), radius * Math.sin(i * 2 * Math.PI / count)]);
const rectangle = (width = 50, height = 36) => [[-width / 2, -height / 2], [width / 2, -height / 2], [width / 2, height / 2], [-width / 2, height / 2]];
const base = { index: 1.60, sph: -4, cyl: -1, axis: 180, contour: circle(), opticalCenter: { x: 0, y: 0 } };
const solve = (options = {}) => Optics.create({ ...base, ...options });
const close = (a, b, tolerance = 1e-8) => assert.ok(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance, `${a} ≠ ${b} (tol ${tolerance})`);
const directSag = (r, x, y = 0) => r === Infinity ? 0 : r - Math.sign(r) * Math.sqrt(r * r - x * x - y * y);

test('exact signed spherical sag uses the circle geometry, including a flat limit', () => {
  close(Optics.sphericalSag(1 / 50, 30 ** 2), 10);
  close(Optics.sphericalSag(-1 / 50, 30 ** 2), -10);
  close(Optics.sphericalSag(0, 400), 0);
  close(Optics.sphericalSag(1e-10, 400), 2e-8, 1e-15);
  assert.ok(Number.isNaN(Optics.sphericalSag(1 / 20, 25 ** 2)), 'An impossible sphere cannot be silently clamped.');
});

test('equal principal toric radii reproduce a sphere, with either curvature sign', () => {
  for (const radius of [60, 150, -60, -150]) for (const [u, v] of [[0, 0], [10, 5], [-21, 14], [12, -20]]) {
    close(Optics.toricSurface(1 / radius, 1 / radius, u, v).sag, directSag(radius, u, v));
  }
});

test('plano-front minus sphere matches an independently calculated exact edge thickness', () => {
  const model = solve({ index: 1.5, sph: -6, cyl: 0, profile: { frontPowerD: 0 } });
  assert.equal(model.valid, true);
  const expected = 1.5 + 500 / 6 - Math.sqrt((500 / 6) ** 2 - 25 ** 2);
  close(model.metrics.centerThicknessMm, 1.5);
  close(model.metrics.edgeMaxMm, expected);
  assert.ok(expected > 1.5 + 25 ** 2 * 6 / 1000, 'Exact sag is not a forced 10–20% discount of the parabola.');
});

test('plus sphere CT solves independent front/back sag and the edge-thickness constraint', () => {
  const n = 1.5, front = 8, prescribed = 6, radius = 25, minimumEdge = 1;
  const atEdge = ct => {
    const rear = prescribed - front / (1 - (ct / 1000) * front / n);
    const rf = 1000 * (n - 1) / front, rb = -1000 * (n - 1) / rear;
    return ct + directSag(rb, radius) - directSag(rf, radius);
  };
  let low = .5, high = 15;
  for (let i = 0; i < 70; i++) { const t = (low + high) / 2; if (atEdge(t) < minimumEdge) low = t; else high = t; }
  const model = solve({ index: n, sph: prescribed, cyl: 0, profile: { frontPowerD: front, minCenterMm: 1.5, minEdgeMm: minimumEdge } });
  assert.equal(model.valid, true);
  close(model.metrics.centerThicknessMm, high, 1e-7);
  close(model.metrics.edgeMinMm, minimumEdge, 1e-7);
  close(model.metrics.maxMm, model.metrics.centerThicknessMm);
});

test('both principal meridians reproduce prescribed back-vertex power after CT is solved', () => {
  for (const [sph, cyl] of [[-8, -2], [6, -2], [2, -5], [0, 0]]) {
    const model = solve({ sph, cyl });
    assert.equal(model.valid, true);
    const r = model.resolved;
    const frontAtBack = r.frontPowerD / (1 - r.centerDesignMm * r.frontPowerD / (1000 * base.index));
    close(frontAtBack + r.backSurfacePowersD[0], sph);
    close(frontAtBack + r.backSurfacePowersD[1], sph + cyl);
    assert.ok(r.backVertexPowerResidualD < 1e-12);
  }
});

test('1.530 tooling power and an explicit measured radius resolve to the same surface', () => {
  const tooling = solve({ index: 1.74, profile: { frontPowerD: 4, frontCurveBasis: 'reference-index', curveReferenceIndex: 1.53 } });
  const measured = solve({ index: 1.74, profile: { frontRadiusMm: 132.5 } });
  const actual = solve({ index: 1.74, profile: { frontPowerD: 4 } });
  close(tooling.resolved.frontRadiusMm, 132.5);
  close(tooling.resolved.frontPowerD, 1000 * .74 / 132.5);
  close(measured.metrics.edgeMaxMm, tooling.metrics.edgeMaxMm);
  assert.notEqual(actual.resolved.frontRadiusMm, tooling.resolved.frontRadiusMm);
  close(measured.thickness(18, -12), tooling.thickness(18, -12));
});

test('plus-cylinder transposition preserves the physical toric surface', () => {
  const a = solve({ sph: -2, cyl: 3, axis: 17 });
  const b = solve({ sph: 1, cyl: -3, axis: 107 });
  for (const [x, y] of [[0, 0], [10, 5], [-18, 12], [7, -22]]) close(a.thickness(x, y), b.thickness(x, y));
  close(a.metrics.centerThicknessMm, b.metrics.centerThicknessMm);
  close(a.metrics.edgeMaxMm, b.metrics.edgeMaxMm);
});

test('toric thickness gradients agree with independent finite differences', () => {
  const model = solve({ sph: 2, cyl: -5, axis: 37 });
  assert.equal(model.valid, true);
  const h = 1e-4;
  for (const [x, y] of [[0, 0], [10, 7], [-13, 16], [18, -9]]) {
    const f = model.field(x, y);
    close(f.dx, (model.thickness(x + h, y) - model.thickness(x - h, y)) / (2 * h), 1e-8);
    close(f.dy, (model.thickness(x, y + h) - model.thickness(x, y - h)) / (2 * h), 1e-8);
  }
});

test('continuous edge extrema and interior values enclose dense independent contour samples', () => {
  for (const [sph, cyl, axis] of [[-6, 0, 0], [6, -3, 37], [2, -7, 55], [0, -5, 28]]) {
    const contour = rectangle(), model = solve({ sph, cyl, axis, contour, opticalCenter: { x: 4.2, y: -3.7 } });
    assert.equal(model.valid, true);
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < contour.length; i++) {
      const p = contour[i], q = contour[(i + 1) % contour.length];
      for (let step = 0; step <= 2000; step++) {
        const t = step / 2000, value = model.thickness(p[0] * (1 - t) + q[0] * t, p[1] * (1 - t) + q[1] * t);
        min = Math.min(min, value); max = Math.max(max, value);
      }
    }
    assert.ok(model.metrics.edgeMinMm <= min + 1e-8 && min - model.metrics.edgeMinMm < 2e-5);
    assert.ok(model.metrics.edgeMaxMm >= max - 1e-8 && model.metrics.edgeMaxMm - max < 2e-5);
    for (let x = -25; x <= 25; x += 1) for (let y = -18; y <= 18; y += 1) {
      const value = model.thickness(x, y);
      assert.ok(value >= model.metrics.minMm - 1e-8 && value <= model.metrics.maxMm + 1e-8);
    }
    close(model.thickness(model.metrics.maxLocation.x, model.metrics.maxLocation.y), model.metrics.maxMm);
  }
});

test('decentration changes the optical field without translating the frame contour', () => {
  const contour = rectangle(), original = JSON.stringify(contour);
  const centered = solve({ contour, sph: -6, cyl: 0 });
  const shifted = solve({ contour, sph: -6, cyl: 0, opticalCenter: { x: 5, y: -3 } });
  close(centered.thickness(10, 0), shifted.thickness(15, -3));
  assert.ok(shifted.metrics.edgeMaxMm > centered.metrics.edgeMaxMm);
  assert.equal(JSON.stringify(contour), original);
});

test('an optical center outside the aperture does not invent a measurable CT', () => {
  const model = solve({ sph: -3, cyl: 0, opticalCenter: { x: 30, y: 0 }, contour: rectangle(20, 18) });
  assert.equal(model.valid, true);
  assert.equal(model.metrics.opticalCenterInside, false);
  assert.equal(model.metrics.centerThicknessMm, null);
  assert.ok(model.metrics.minMm > model.resolved.centerDesignMm);
});

test('independent center and edge minima change physical surface construction rather than a percentage multiplier', () => {
  const standard = solve({ sph: -4, cyl: 0 });
  const lowerCenter = solve({ sph: -4, cyl: 0, profile: { minCenterMm: 1.2, minEdgeMm: 1.5 } });
  close(lowerCenter.metrics.centerThicknessMm, 1.2);
  close(lowerCenter.metrics.centerThicknessMm / standard.metrics.centerThicknessMm, .8);
  assert.ok(lowerCenter.metrics.edgeMaxMm < standard.metrics.edgeMaxMm);
  assert.ok(Math.abs(lowerCenter.metrics.edgeMaxMm / standard.metrics.edgeMaxMm - .8) > .05, 'ET must not receive the same arbitrary 20% reduction.');
  const plus = solve({ sph: 6, cyl: 0 });
  const lowerEdge = solve({ sph: 6, cyl: 0, profile: { minEdgeMm: 1 } });
  close(lowerEdge.metrics.edgeMinMm, 1, 1e-7);
  assert.ok(lowerEdge.metrics.centerThicknessMm < plus.metrics.centerThicknessMm);
  assert.equal(lowerCenter.productionVerified, false);
});

test('a truly plano parallel plate is uniform; a curved zero-power meniscus includes thickness effect', () => {
  const plate = solve({ sph: 0, cyl: 0, profile: { frontPowerD: 0 } });
  for (const [x, y] of [[0, 0], [10, 15], [-21, 8]]) close(plate.thickness(x, y), 1.5);
  const meniscus = solve({ sph: 0, cyl: 0 });
  assert.ok(meniscus.metrics.edgeMaxMm > meniscus.metrics.centerThicknessMm);
  close(meniscus.resolved.backVertexPowerResidualD, 0);
});

test('all six supported indices retain monotonic thickness for identical spherical inputs', () => {
  let previousMinus = Infinity, previousPlus = Infinity;
  for (const index of [1.50, 1.56, 1.57, 1.60, 1.67, 1.74]) {
    const minus = solve({ index, sph: -6, cyl: 0 }), plus = solve({ index, sph: 6, cyl: 0 });
    assert.equal(minus.valid, true); assert.equal(plus.valid, true);
    assert.ok(minus.metrics.maxMm < previousMinus);
    assert.ok(plus.metrics.maxMm < previousPlus);
    previousMinus = minus.metrics.maxMm; previousPlus = plus.metrics.maxMm;
  }
});

test('raw blank BC/CT/ET metadata cannot silently become finished-lens constraints', () => {
  const model = solve(), raw = solve({ baseCurve: 12, ct: 10, et: 15, blankDiameter: 80 });
  assert.deepEqual(raw.metrics, model.metrics);
  assert.deepEqual(raw.profile, model.profile);
});

test('unsupported aspheric coefficients and malformed optical settings are rejected', () => {
  for (const profile of [{ minCenterMm: .1 }, { minEdgeMm: Infinity }, { frontPowerD: -2 },
    { frontConic: -1 }, { backConic: 1 }, { frontCurveBasis: 'nominal-unverified' },
    { frontRadiusMm: 0 }, { source: 'lab', reference: '' }, { minCenterMm: null }]) {
    const model = solve({ profile });
    assert.equal(model.valid, false, JSON.stringify(profile));
    assert.equal(model.metrics, null);
    assert.ok(model.errors.length);
  }
});

test('impossible radii and apertures return unavailable metrics instead of clipped square roots', () => {
  for (const options of [
    { profile: { frontRadiusMm: 20 }, contour: circle(30) },
    { sph: -24, cyl: -12, index: 1.5, contour: circle(40) },
    { index: 1, sph: NaN }, { contour: [[0, 0], [1, 2]] }
  ]) {
    const model = solve(options);
    assert.equal(model.valid, false);
    assert.equal(model.metrics, null);
    assert.ok(Number.isNaN(model.thickness(0, 0)));
  }
});

test('lab provenance is preserved without claiming independent production calibration', () => {
  const profile = { minCenterMm: 1.3, minEdgeMm: 1.2, frontRadiusMm: 150, source: 'lab', reference: 'Fixture reference: measured radius, no production benchmark' };
  const before = JSON.stringify(profile), model = solve({ profile });
  assert.equal(model.valid, true);
  assert.equal(model.profile.reference, profile.reference);
  assert.equal(model.productionVerified, false);
  assert.equal(model.calibrationStatus, 'unverified');
  assert.equal(model.manufacturingMode, 'frame-optimized-surfacing');
  assert.equal(JSON.stringify(profile), before);
});
