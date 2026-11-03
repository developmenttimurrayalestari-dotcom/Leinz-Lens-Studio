import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../dist/lens-viewer.js', import.meta.url), 'utf8');
let drawCalls = 0;
const recordedGradients = [];
const recordedLabels = [], recordedShadows = [];
const numeric = (...args) => {
  for (const a of args) if (typeof a === 'number') assert.ok(Number.isFinite(a), 'Drawing coordinates must be finite.');
};
const gradient = () => {
  const stops = [];
  recordedGradients.push(stops);
  return { addColorStop(position, value) {
    assert.ok(Number.isFinite(position) && position >= 0 && position <= 1);
    assert.ok(typeof value === 'string' && !value.includes('NaN'));
    stops.push([position, value]);
  } };
};
const ctx = new Proxy({}, {
  get(target, key) {
    if (key === 'fillText') return (text, x, y) => { numeric(x, y); recordedLabels.push({ text, x, y }); };
    if (key === 'measureText') return text => ({ width: String(text).length * 6 });
    if (key === 'translate') return (x, y) => { numeric(x, y); recordedShadows.push({ x, y }); };
    if (key === 'createLinearGradient' || key === 'createRadialGradient') return (...args) => { numeric(...args); return gradient(); };
    return target[key] ?? ((...args) => { numeric(...args); if (key === 'fill') drawCalls++; });
  },
  set(target, key, value) { if (typeof value === 'number') numeric(value); target[key] = value; return true; }
});
function canvas() {
  const listeners = new Map();
  return {
    width: 0, height: 0, clientWidth: 480, clientHeight: 360, style: {}, listeners,
    getContext: () => ctx,
    getBoundingClientRect: () => ({ width: 480, height: 360 }),
    hasAttribute: () => false, setAttribute() {},
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type) { listeners.delete(type); },
    toDataURL: () => 'data:image/png;base64,TEST'
  };
}
const sandbox = { module: { exports: {} } };
vm.runInNewContext(source, sandbox);
const LensViewer = sandbox.module.exports;
const meshMinimum = mesh => {
  const v = mesh.vertices, per = v.length / 2;
  return Math.min(...v.slice(0, per).map((p, i) => p.z - v[i + per].z));
};
const surfaceMinimum = viewer => meshMinimum(viewer.mesh);
let callbacks = 0;
const c = canvas();
const v = new LensViewer(c, {
  shapePoints: [[-.5, -.35], [-.3, -.5], [.4, -.4], [.5, .1], [.25, .5], [-.35, .4]],
  colorHex: '#5f707f', bottomColorHex: '#eff3f5', kind: 'Gradient',
  onChange() { callbacks++; }
});
assert.equal(callbacks, 0);
assert.ok(v.mesh.faces.some(f => f.kind === 'side'));
assert.ok(v.mesh.faces.some(f => f.kind === 'front'));
assert.ok(v.mesh.faces.some(f => f.kind === 'back'));
assert.ok(surfaceMinimum(v) >= 1.49);
v.setOptions({ camera: { yaw: .8, pitch: .3, zoom: 1.2 } });
assert.equal(callbacks, 0, 'Synchronization updates must not emit another camera event.');
for (const view of ['front', 'side', 'perspective']) v.setView(view);
assert.equal(callbacks, 3);

for (const options of [
  { sph: -20, cyl: -7, axis: 37, index: 1.50, widthMm: 72, heightMm: 50 },
  { sph: 12, cyl: -4, axis: 120, index: 1.74, widthMm: 52, heightMm: 38 },
  { sph: 0, cyl: 0, index: 1.60, kind: 'Solid', colorHex: null },
  { sph: -2, cyl: 3, axis: 55, showFrame: true, colorHex: '#AF8F48', kind: 'Gradient' },
  { shapePoints: [[0, 0], [0, 0], [0, 0]], widthMm: 0, heightMm: 0, index: null }
]) {
  v.setOptions(options);
  assert.ok(surfaceMinimum(v) >= .49, 'All generated front/back surfaces must retain positive thickness.');
  for (const point of v.mesh.vertices) numeric(point.x, point.y, point.z, point.g);
  v.setOptions({ camera: { yaw: Math.PI, pitch: -.9 } });
  v.render();
}
assert.ok(drawCalls > 100, 'The render exercise should draw the surface and visible 3D edges.');

// A distinct PDF midpoint must not be replaced by the average of top/bottom.
recordedGradients.length = 0;
v.setOptions({ colorHex: '#0000FF', midColorHex: '#FF0000', bottomColorHex: '#00FF00', kind: 'Gradient', camera: { yaw: -0.6, pitch: .1 } });
const threeStopSurface = recordedGradients.find(stops => stops.length === 3 && stops[0][1] === 'rgba(0,0,255,1)' && stops[1][0] === .5 && stops[1][1] === 'rgba(255,0,0,1)' && stops[2][1] === 'rgba(0,255,0,1)');
assert.ok(threeStopSurface, 'The continuous surface must preserve all three supplied display colors.');
recordedGradients.length = 0;
v.setOptions({ midColorHex: null });
assert.ok(recordedGradients.some(stops => stops.length === 2 && stops[0][1] === 'rgba(0,0,255,1)' && stops[1][1] === 'rgba(0,255,0,1)'), 'Absent midpoint must retain a two-stop gradient.');
assert.ok(!recordedGradients.some(stops => stops.some(([position]) => position === .5)), 'A cleared midpoint must not persist in later previews.');
assert.ok(v.toDataURL().startsWith('data:image/png'));
v.destroy();
assert.equal(c.listeners.size, 0, 'Destroy must release pointer/wheel/keyboard handlers.');
v.destroy();

const close = (a, b, message, epsilon = 1e-8) => assert.ok(Math.abs(a - b) < epsilon, message);
const shapeCatalog = JSON.parse(fs.readFileSync(new URL('../dist/assets/shapes.json', import.meta.url), 'utf8'));
const shapes = shapeCatalog.items;
const contourModeFor = shape => shape.source === 'user-svg' ? 'vector' : 'raster';
const presetCodes = ['round', 'cat-eye', 'rectangle', 'square'];
assert.equal(shapes.length, 13);
assert.equal(new Set(shapes.map(shape => shape.code)).size, 13, 'Saved selections need stable, unique shape IDs.');
assert.ok(!shapes.some(shape => shape.code === 'browline'), 'The removed Browline must no longer be selectable.');
assert.deepEqual(shapes.slice(0, 9).map(shape => shape.code), ['001', '002', '003', '004', '005', '006', '007', '008', '009']);
assert.equal(createHash('sha256').update(JSON.stringify(shapes.slice(0, 9))).digest('hex'),
  '2a937b8c8baa0b8ed2a5c0cf9c32e311f3f120aad54e028acb4f72b16469a656',
  'The nine source records, including points and provenance, must remain unchanged.');
assert.deepEqual(shapes.slice(9).map(shape => shape.code), presetCodes, 'Additional presets must not impersonate Lensware numbers.');
assert.equal(shapeCatalog.sources[0].source, 'screenshot');
assert.ok(shapeCatalog.sources.slice(1).every(source => source.source === 'user-svg'));
assert.equal(shapeCatalog.sources[0].sourceSha256, '6f1f4dd3c5d35980c334b28db70729b9a512478e769ec614087ec8ea5237309a');
for (const shape of shapes.slice(9)) {
  assert.equal(shape.source, 'user-svg');
  assert.equal(shape.status, 'illustrative');
  assert.equal(shape.category, 'additional');
  assert.notEqual(shape.synthetic, true, 'Reference-derived apertures must not claim synthetic provenance.');
  assert.equal(shape.geometryRevision, 'svg-reference-v1');
  assert.equal(shape.sourcePathIndex, 1);
  assert.equal(shape.sourceSubpathIndex, 1);
  assert.equal(shape.sourceContour, 'inner-lens-aperture');
  assert.equal(shape.sourceSide, 'left');
  assert.equal(shape.canonicalEye, 'R');
  assert.ok(shape.name && shape.description);
  assert.ok(shape.defaultWidthMm > 0 && shape.defaultHeightMm > 0);
  for (const axis of [0, 1]) {
    close(Math.min(...shape.points.map(point => point[axis])), -.5, 'Preset lower boxing bound must be normalized.');
    close(Math.max(...shape.points.map(point => point[axis])), .5, 'Preset upper boxing bound must be normalized.');
  }
  const signedArea = shape.points.reduce((sum, p, i) => {
    const q = shape.points[(i + 1) % shape.points.length];
    return sum + p[0] * q[1] - q[0] * p[1];
  }, 0) / 2;
  assert.ok(signedArea > .5, 'Preset input follows the catalog clockwise screen winding without degenerate area.');
  assertSimplePolygon(shape.points, `${shape.code} source`);
}
function turningVariation(points) {
  const directions = points.map((p, i) => { const q = points[(i + 1) % points.length]; return Math.atan2(q[1] - p[1], q[0] - p[0]); });
  return directions.reduce((sum, angle, i) => { const d = angle - directions[(i + directions.length - 1) % directions.length]; return sum + Math.abs(Math.atan2(Math.sin(d), Math.cos(d))); }, 0);
}
function assertSimplePolygon(points, label) {
  const cross = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    for (let j = i + 2; j < points.length; j++) {
      if (i === 0 && j === points.length - 1) continue;
      const c = points[j], d = points[(j + 1) % points.length];
      assert.ok(!(cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0),
        `${label}: nonadjacent contour edges must not cross.`);
    }
  }
}
function assertContinuousContour(points, label) {
  const lengths = points.map((p, i) => {
    const before = points[(i + points.length - 1) % points.length], after = points[(i + 1) % points.length];
    const incoming = [p[0] - before[0], p[1] - before[1]], outgoing = [after[0] - p[0], after[1] - p[1]];
    const turn = Math.atan2(incoming[0] * outgoing[1] - incoming[1] * outgoing[0], incoming[0] * outgoing[0] + incoming[1] * outgoing[1]);
    assert.ok(Math.abs(turn) < .16, `${label}: adjacent samples must not create a sharp kink, including at the closing seam.`);
    return Math.hypot(...outgoing);
  });
  assert.ok(Math.min(...lengths) > 1e-6, `${label}: no repeated vertices or broken closing seam.`);
  assert.ok(Math.max(...lengths) / Math.min(...lengths) < 1.03, `${label}: edge sampling remains even around the entire contour.`);
  assertSimplePolygon(points, label);
}
for (const shape of shapes) {
  const smoothed = LensViewer.smoothContour(shape.points, contourModeFor(shape));
  assert.equal(smoothed.length, 256);
  for (const point of smoothed) numeric(...point);
  close(Math.min(...smoothed.map(p => p[0])), -.5, 'Smoothed contour must preserve exact horizontal bounds.');
  close(Math.max(...smoothed.map(p => p[0])), .5, 'Smoothed contour must preserve exact horizontal bounds.');
  close(Math.min(...smoothed.map(p => p[1])), -.5, 'Smoothed contour must preserve exact vertical bounds.');
  close(Math.max(...smoothed.map(p => p[1])), .5, 'Smoothed contour must preserve exact vertical bounds.');
  if (shape.source === 'screenshot') {
    assert.ok(turningVariation(smoothed) < turningVariation(shape.points) * .7, 'Smoothing must remove source raster stair-steps, not merely add vertices.');
  }
  assert.ok(turningVariation(smoothed) < 7, 'The supplied convex-like reference contours must not develop loops or oscillations.');
  assertContinuousContour(smoothed, shape.code);
}

const preset = code => shapes.find(shape => shape.code === code);

// Independently read the supplied compound SVGs and sample their inner lens
// apertures. Dense de Casteljau samples provide a separate geometric reference
// rather than merely comparing the generator with its own saved output.
const svgReferences = {
  round: ['rounded.svg', '3d9e554a5981c75b80f441bf60d4251636dba04afddd39c6a635a3c45b48cc46'],
  'cat-eye': ['cateye.svg', '0bc6e172ca0005cf6bfc5cc4a8327f144ddd40271ee9ae68a67fefd846bde1a9'],
  rectangle: ['rectangle.svg', 'fbf2573581897e43f0269d809e2a84284ffe75e03e21076923f084e82e31b656'],
  square: ['square.svg', '925f1d6b8f5c46886f99da6ab953121aae1f84a98bf2b39e86da32c9ed52c326']
};
function referenceAperture(file) {
  const svg = fs.readFileSync(new URL(`shape-references/${file}`, import.meta.url), 'utf8');
  const paths = [...svg.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].map(match => match[1]);
  assert.equal(paths.length, 2, 'Each supplied frame has two compound paths.');
  const path = paths[1].match(/M[^M]*Z/g)[1];
  const tokens = path.match(/[A-Za-z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g);
  const dense = [];
  let cursor = 0, current, start;
  const pair = () => [Number(tokens[cursor++]), Number(tokens[cursor++])];
  const interpolate = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  while (cursor < tokens.length) {
    const command = tokens[cursor++];
    assert.ok(['M', 'C', 'Z'].includes(command), 'Reference parser supports the observed absolute aperture commands.');
    if (command === 'M') { current = pair(); start = current; }
    if (command === 'C') {
      do {
        const controls = [current, pair(), pair(), pair()];
        for (let step = 0; step < 512; step++) {
          const t = step / 512;
          let level = controls;
          while (level.length > 1) level = level.slice(0, -1).map((point, i) => interpolate(point, level[i + 1], t));
          dense.push(level[0]);
        }
        current = controls[3];
      } while (cursor < tokens.length && !/^[A-Za-z]$/.test(tokens[cursor]));
    }
    if (command === 'Z') {
      assert.ok(Math.hypot(current[0] - start[0], current[1] - start[1]) < .002,
        'The chosen inner aperture must close without adding a frame/bridge segment.');
    }
  }
  const minX = Math.min(...dense.map(p => p[0])), maxX = Math.max(...dense.map(p => p[0]));
  const minY = Math.min(...dense.map(p => p[1])), maxY = Math.max(...dense.map(p => p[1]));
  return { path, sha256: createHash('sha256').update(svg).digest('hex'),
    bounds: { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY },
    points: dense.map(p => [(p[0] - minX) / (maxX - minX) - .5, (p[1] - minY) / (maxY - minY) - .5]) };
}
function contourDistanceMm(a, b, width, height) {
  const scale = points => points.map(p => [p[0] * width, p[1] * height]);
  const directed = (points, contour) => {
    let maximum = 0;
    for (const p of points) {
      let nearest = Infinity;
      for (let i = 0; i < contour.length; i++) {
        const a = contour[i], b = contour[(i + 1) % contour.length];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
        nearest = Math.min(nearest, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy));
      }
      maximum = Math.max(maximum, nearest);
    }
    return maximum;
  };
  const aa = scale(a), bb = scale(b);
  return Math.max(directed(aa, bb), directed(bb, aa));
}
const apertureFidelity = [];
for (const [code, [file, sha256]] of Object.entries(svgReferences)) {
  const shape = preset(code), reference = referenceAperture(file);
  assert.equal(reference.sha256, sha256, 'A reference copy must retain the exact uploaded SVG bytes.');
  assert.equal(shape.sourceFile, file);
  assert.equal(shape.sourceSha256, sha256);
  assert.equal(shape.sourcePathData, reference.path, 'Trace provenance must identify the left inner aperture, not the outer frame rim.');
  for (const key of Object.keys(reference.bounds)) close(shape.sourceBounds[key], reference.bounds[key],
    'Analytic bounding metadata must agree with independently sampled reference extrema.', .001);
  close(shape.referenceAspectRatio, reference.bounds.width / reference.bounds.height,
    'Preset aspect must follow the actual reference aperture.', .00002);
  assert.ok(Math.abs(shape.defaultHeightMm - shape.defaultWidthMm / shape.referenceAspectRatio) <= .0500001,
    'Initial A/B must retain the uploaded reference ratio, rounded only to 0.1 mm.');
  const raw = contourDistanceMm(shape.points, reference.points, shape.defaultWidthMm, shape.defaultHeightMm);
  const rendered = contourDistanceMm(LensViewer.screeningContour(shape.points, shape.defaultWidthMm, shape.defaultHeightMm, contourModeFor(shape)),
    reference.points, shape.defaultWidthMm, shape.defaultHeightMm);
  apertureFidelity.push({ code, rawMm: Number(raw.toFixed(5)), renderedMm: Number(rendered.toFixed(5)) });
  assert.ok(raw < .015, `${code}: raw contour must reproduce the uploaded aperture within 0.015 mm at its initial size (${raw}).`);
  assert.ok(rendered < .1, `${code}: vector contour must stay within 0.1 mm of the reference at its initial size (${rendered}).`);
}
console.log('SVG aperture fidelity (maximum symmetric contour distance):', JSON.stringify(apertureFidelity));

const catEye = LensViewer.smoothContour(preset('cat-eye').points, 'vector');
const upperTemporal = Math.min(...catEye.filter(point => point[0] < -.2).map(point => point[1]));
const upperNasal = Math.min(...catEye.filter(point => point[0] > .2).map(point => point[1]));
assert.ok(upperTemporal < upperNasal - .1, 'The canonical R cat-eye upsweep must point toward negative-X temporal, away from the nose.');
assert.equal(new Set(shapes.slice(9).map(shape => JSON.stringify(LensViewer.smoothContour(shape.points, 'vector')))).size, 4,
  'Named references must provide four distinct outlines, not aliases of one contour.');

// The mode is part of the geometry cache key. Switching between raster denoising
// and faithful vector sampling must rebuild both eyes even when points are equal.
const modeShape = preset('cat-eye');
const modeViewer = new LensViewer(canvas(), { pairMode: true, shapePoints: modeShape.points,
  widthMm: modeShape.defaultWidthMm, heightMm: modeShape.defaultHeightMm, contourMode: 'vector' });
const vectorContours = JSON.stringify([modeViewer.mesh.contour, modeViewer.leftMesh.contour]);
modeViewer.setOptions({ contourMode: 'raster' });
assert.notEqual(JSON.stringify([modeViewer.mesh.contour, modeViewer.leftMesh.contour]), vectorContours,
  'Changing contour mode must rebuild R and L instead of leaving a stale geometry cache.');
modeViewer.setOptions({ contourMode: 'vector' });
assert.equal(JSON.stringify([modeViewer.mesh.contour, modeViewer.leftMesh.contour]), vectorContours,
  'Restoring vector mode must restore the same source-faithful geometry.');
const vectorScreen = LensViewer.screeningContour(modeShape.points, modeShape.defaultWidthMm, modeShape.defaultHeightMm, 'vector');
modeViewer.mesh.contour.forEach((point, i) => {
  close(point[0] / modeShape.defaultWidthMm, vectorScreen[i][0], 'A mode-switched mesh must match vector screening X.');
  close(-point[1] / modeShape.defaultHeightMm, vectorScreen[i][1], 'A mode-switched mesh must match vector screening Y.');
});
modeViewer.destroy();

// Screen and display exactly the same smoothed source or preset outline. The
// engine rescales the helper's normalized points; the viewer receives raw points.
const blankSandbox = { module: { exports: {} } };
vm.runInNewContext(fs.readFileSync(new URL('../dist/blank-engine.js', import.meta.url), 'utf8'), blankSandbox);
const BlankEngine = blankSandbox.module.exports;
const originalShapeData = JSON.stringify(shapes);
const screeningFixtures = [
  { width: 52, height: 38, dbl: 18, pdR: 31.5, pdL: 31.5, heightR: 19, heightL: 19, allowanceDiameter: 2 },
  { width: 70, height: 60, dbl: 28, pdR: 20, pdL: 32, heightR: 18, heightL: 28, allowanceDiameter: 0 },
  { width: 52, height: 38, dbl: 10, pdR: 45, pdL: 20, heightR: 38, heightL: 0, allowanceDiameter: 2 },
  { width: 35, height: 25, dbl: 10, pdR: 20, pdL: 24, heightR: 8, heightL: 17, allowanceDiameter: 1.5 }
];
for (const shape of shapes) for (const dimensions of [
  ...screeningFixtures,
  ...(shape.source === 'user-svg' ? [{
    width: shape.defaultWidthMm, height: shape.defaultHeightMm, dbl: 18,
    pdR: (shape.defaultWidthMm + 18) / 2, pdL: (shape.defaultWidthMm + 18) / 2,
    heightR: shape.defaultHeightMm / 2, heightL: shape.defaultHeightMm / 2, allowanceDiameter: 2
  }] : [])
]) {
  const screeningPoints = LensViewer.screeningContour(shape.points, dimensions.width, dimensions.height, contourModeFor(shape));
  assert.equal(screeningPoints.length, 256);
  for (const axis of [0, 1]) {
    close(Math.min(...screeningPoints.map(p => p[axis])), -.5, 'Screening contour must retain its normalized lower boxing bound.');
    close(Math.max(...screeningPoints.map(p => p[axis])), .5, 'Screening contour must retain its normalized upper boxing bound.');
  }
  const fit = BlankEngine.estimateFrame({ ...dimensions, points: screeningPoints });
  assert.equal(fit.valid, true);
  const preview = new LensViewer(canvas(), {
    pairMode: true, shapePoints: shape.points, contourMode: contourModeFor(shape), widthMm: dimensions.width, heightMm: dimensions.height,
    opticalCenters: { R: fit.eyes.R.opticalCenter, L: fit.eyes.L.opticalCenter }
  });
  for (const [eye, mesh] of [['R', preview.mesh], ['L', preview.leftMesh]]) {
    const oc = fit.eyes[eye].opticalCenter;
    const renderedDiameter = 2 * Math.max(...mesh.contour.map(p => Math.hypot(p[0] - oc.x, -p[1] - oc.y)));
    close(fit.eyes[eye].geometricDiameter, renderedDiameter, `Shape ${shape.code} ${eye}: screened MBS must equal the displayed outline's maximum radius twice.`);
    close(fit.eyes[eye].requiredDiameter, renderedDiameter + dimensions.allowanceDiameter, 'Allowance must be added once to the same displayed diameter.');
    mesh.contour.forEach((p, i) => {
      const screened = fit.eyes[eye].contour[eye === 'R' ? i : mesh.contour.length - 1 - i];
      close(p[0], screened.x, 'Screening and rendering must share each contour X without double smoothing.');
      close(-p[1], screened.y, 'Screening and rendering must share each contour Y with one coordinate conversion.');
    });
  }
  preview.destroy();
}
assert.equal(JSON.stringify(shapes), originalShapeData, 'Smoothing must preserve the original source contour data.');

const pair = new LensViewer(canvas(), { pairMode: true, bridgeMm: 18, shapePoints: shapes[2].points, widthMm: 52, heightMm: 38, sph: -4, cyl: -1, axis: 45 });
assert.ok(pair.leftMesh);
assert.equal(pair.dpr, 2, 'A 1× display must still receive a supersampled canvas.');
for (let i = 0; i < pair.mesh.contour.length; i++) {
  const right = pair.mesh.contour[i], left = pair.leftMesh.contour[pair.mesh.contour.length - 1 - i];
  close(right[0], -left[0], 'Left and right contours must be true horizontal mirrors.');
  close(right[1], left[1], 'Mirroring must preserve local vertical placement.');
}
close(pair.mesh.thickness(10, 5), pair.leftMesh.thickness(10, 5), 'Same Rx keeps the same cylinder-axis convention in each eye.');
assert.ok(Math.abs(pair.mesh.thickness(10, 5) - pair.leftMesh.thickness(-10, 5)) > .01, 'The entire optical power field must not be accidentally mirrored at an oblique axis.');
for (const view of ['front', 'back', 'side']) {
  pair.setView(view);
  assert.equal(pair._renderedEyes.length, 2);
  assert.equal(pair._renderedEyes[0].eye, 'R');
  assert.equal(pair._renderedEyes[1].eye, 'L');
  assert.ok(pair._renderedEyes[0].centerX < pair._renderedEyes[1].centerX, 'Eye labels must remain with their own fixed lens positions.');
  if (view === 'side') assert.ok(pair._renderedEyes[0].bounds.maxX < pair._renderedEyes[1].bounds.minX, 'Side views must show both lenses separately.');
}
pair.setOptions({ camera: { yaw: .73, pitch: 2.4, zoom: 1 } });
close(pair.getCamera().pitch, 2.4, 'Pitch must rotate freely past the previous 1.35-radian limit.');
const point = pair.mesh.vertices[pair.mesh.frontRim[37]];
const beforeTurn = pair._transformation().project(point);
pair.setOptions({ camera: { yaw: .73 + Math.PI * 2, pitch: 2.4 + Math.PI * 2 } });
const afterTurn = pair._transformation().project(point);
close(beforeTurn.x, afterTurn.x, 'A full turn must restore projected X.');
close(beforeTurn.y, afterTurn.y, 'A full turn must restore projected Y.');
close(beforeTurn.z, afterTurn.z, 'A full turn must restore projected depth.');
pair.destroy();


// Wearer ordering is a presentation change: L belongs on screen-left and R on
// screen-right, while each eye retains its own asymmetric optical geometry.
const layoutOptions = {
  pairMode: true, bridgeMm: 18, shapePoints: shapes[2].points, widthMm: 52, heightMm: 38,
  sph: -6, cyl: -1, axis: 37, index: 1.74,
  opticalCenters: { R: { x: 7, y: 3 }, L: { x: -4, y: -2 } },
  kind: 'Gradient', colorHex: '#0000FF', midColorHex: '#FF0000', bottomColorHex: '#00FF00'
};
const observerCanvas = canvas(), wearerCanvas = canvas();
const observerPair = new LensViewer(observerCanvas, layoutOptions);
const wearerPair = new LensViewer(wearerCanvas, { ...layoutOptions, eyeLayout: 'wearer' });
for (const [eye, observerMesh, wearerMesh] of [
  ['R', observerPair.mesh, wearerPair.mesh], ['L', observerPair.leftMesh, wearerPair.leftMesh]
]) {
  assert.deepEqual(wearerMesh.vertices, observerMesh.vertices, `${eye}: changing screen order must preserve its physical shape, thickness, and tint coordinates.`);
  close(wearerMesh.opticalCenter.x, layoutOptions.opticalCenters[eye].x, `${eye}: the original eye's PD/centration must remain attached.`);
  close(wearerMesh.opticalCenter.y, -layoutOptions.opticalCenters[eye].y, `${eye}: fitting height must remain attached to the original eye.`);
}
for (const view of ['front', 'perspective', 'back', 'side']) {
  observerPair.setView(view);
  recordedLabels.length = 0; recordedShadows.length = 0;
  wearerPair.setView(view);
  const left = wearerPair._renderedEyes.find(e => e.eye === 'L');
  const right = wearerPair._renderedEyes.find(e => e.eye === 'R');
  assert.ok(left.centerX < right.centerX, `${view}: wearer-side L must appear left of R.`);
  assert.equal(recordedLabels.length, 2, 'Each rendered lens must retain one eye label.');
  assert.equal(recordedShadows.length, 2, 'Each lens must retain one positioned shadow.');
  for (const [i, label] of recordedLabels.entries()) {
    const eye = label.text.startsWith('L') ? left : right;
    assert.equal(label.text, eye.eye === 'L' ? 'L · Kiri' : 'R · Kanan');
    close(label.x, (eye.bounds.minX + eye.bounds.maxX) / 2, 'The visible label must follow its own lens outline.');
    close(recordedShadows[i].x, eye.centerX, 'The shadow must follow the corrected eye position.');
  }
  assert.ok(recordedLabels.find(e => e.text === 'L · Kiri').x < recordedLabels.find(e => e.text === 'R · Kanan').x, 'The actual drawn L label must be on the left.');
  for (const [eye, observerMesh, wearerMesh, offset] of [
    ['R', observerPair.mesh, wearerPair.mesh, -35], ['L', observerPair.leftMesh, wearerPair.leftMesh, 35]
  ]) {
    const a = observerPair._renderedEyes.find(e => e.eye === eye);
    const b = wearerPair._renderedEyes.find(e => e.eye === eye);
    close(b.centerX, wearerPair.width - a.centerX, `${eye}: changing layout must move the same eye to the opposite screen position.`);
    close(b.bounds.minX, wearerPair.width - a.bounds.maxX, `${eye}: the entire outline must mirror, not merely its label.`);
    close(b.bounds.maxX, wearerPair.width - a.bounds.minX, `${eye}: the entire outline must mirror, not merely its label.`);
    const observerTransform = observerPair._transformation(observerMesh, offset);
    const wearerTransform = wearerPair._transformation(wearerMesh, offset);
    for (const pointId of [0, observerMesh.frontRim[17], observerMesh.backRim[83]]) {
      const before = observerTransform.project(observerMesh.vertices[pointId]);
      const after = wearerTransform.project(wearerMesh.vertices[pointId]);
      close(after.x, wearerPair.width - before.x, `${view} ${eye}: its optical surface must move with the mirrored contour.`);
      close(after.y, before.y, 'Wearer layout must preserve the displayed vertical position and gradient direction.');
      close(after.z, before.z, 'Wearer layout must preserve camera depth.');
      close(after.g, before.g, 'Wearer layout must preserve tint at corresponding surface points.');
    }
  }
}
recordedGradients.length = 0;
wearerPair.setView('front');
assert.ok(recordedGradients.some(stops => stops.length === 3 && stops[0][1] === 'rgba(0,0,255,1)' && stops[1][1] === 'rgba(255,0,0,1)' && stops[2][1] === 'rgba(0,255,0,1)'), 'Reversing the eye layout must retain the actual three-stop surface tint.');
const screenCenter = viewer => viewer._transformation(viewer.mesh, -35).project(viewer.mesh.vertices[0]);
for (const input of ['keyboard', 'drag']) {
  const moves = [];
  for (const [viewer, target] of [[observerPair, observerCanvas], [wearerPair, wearerCanvas]]) {
    viewer.setView('front');
    const before = screenCenter(viewer);
    if (input === 'keyboard') target.listeners.get('keydown')({ key: 'ArrowRight', preventDefault() {} });
    else {
      target.listeners.get('pointerdown')({ pointerId: 1, button: 0, clientX: 100, clientY: 100, preventDefault() {} });
      target.listeners.get('pointermove')({ pointerId: 1, clientX: 115, clientY: 100, preventDefault() {} });
      target.listeners.get('pointerup')({ pointerId: 1 });
    }
    moves.push(screenCenter(viewer).x - before.x);
  }
  close(moves[0], moves[1], `${input}: the same horizontal gesture must move the visible lens surface in the same direction in either layout.`);
}
wearerPair.setOptions({ camera: { yaw: .73, pitch: 2.4, zoom: 1 } });
const wearerTurnStart = screenCenter(wearerPair);
wearerPair.setOptions({ camera: { yaw: .73 + Math.PI * 2, pitch: 2.4 + Math.PI * 2 } });
const wearerTurnEnd = screenCenter(wearerPair);
for (const axis of ['x','y','z']) close(wearerTurnStart[axis], wearerTurnEnd[axis], 'A full turn must restore the wearer-layout surface.');
observerPair.destroy(); wearerPair.destroy();

// Optical centers come from the frame fit in mm, x right and y down. They move
// the optical field independently for each eye without translating the frame or tint.
const decentered = new LensViewer(canvas(), {
  pairMode: true, shapePoints: shapes[2].points, widthMm: 52, heightMm: 38,
  sph: -6, cyl: 0, index: 1.60, kind: 'Gradient', colorHex: '#305060', bottomColorHex: '#e5eded'
});
const centeredMeshes = [decentered.mesh, decentered.leftMesh];
decentered.setOptions({ opticalCenters: { R: { x: 0, y: 0 }, L: { x: 0, y: 0 } } });
for (const [eye, mesh] of [decentered.mesh, decentered.leftMesh].entries()) {
  assert.deepEqual(mesh.vertices, centeredMeshes[eye].vertices, 'Explicit zero optical centers must preserve the centered mesh.');
  close(mesh.thickness(10, 5), 2.125, 'The centered minus-power model must preserve its previous thickness profile.');
}
const offsets = { R: { x: 5, y: 3 }, L: { x: -7, y: -2 } };
decentered.setOptions({ opticalCenters: offsets });
for (const [eye, mesh] of [decentered.mesh, decentered.leftMesh].entries()) {
  const oc = eye === 0 ? offsets.R : offsets.L;
  close(mesh.opticalCenter.x, oc.x, 'Each eye must keep its independently signed horizontal offset.');
  close(mesh.opticalCenter.y, -oc.y, 'External y-down optical center must convert to local y-up exactly once.');
  close(mesh.thickness(oc.x, -oc.y), 1.5, 'The illustrative minus-lens minimum must follow its optical center.');
  close(mesh.thickness(oc.x + 10, -oc.y), 2, 'A fixed distance from either optical center must preserve the same Rx field.');
  assert.ok(mesh.front(oc.x, -oc.y) > mesh.front(oc.x + 10, -oc.y), 'Front curvature must move with the optical field.');
  assert.ok(Math.abs(mesh.thickness(-20, 0) - centeredMeshes[eye].thickness(-20, 0)) > .1, 'Decentration must visibly change the edge thickness profile.');
  assert.ok(meshMinimum(mesh) >= 1.49, 'Both eyes must retain the illustrative minimum thickness.');
  for (const [i, point] of mesh.vertices.entries()) {
    numeric(point.x, point.y, point.z, point.g);
    close(point.x, centeredMeshes[eye].vertices[i].x, 'Optical offsets must not move the frame horizontally.');
    close(point.y, centeredMeshes[eye].vertices[i].y, 'Optical offsets must not move the frame vertically.');
    close(point.g, centeredMeshes[eye].vertices[i].g, 'Tint gradient must stay tied to frame height rather than fitting height.');
  }
}
const oldRightProfile = decentered.mesh.thickness(-20, 0);
const oldLeftProfile = decentered.leftMesh.thickness(-20, 0);
decentered.setOptions({ opticalCenters: { R: { x: 9, y: 8 }, L: offsets.L } });
assert.ok(Math.abs(decentered.mesh.thickness(-20, 0) - oldRightProfile) > .1, 'A later frame-fit update must rebuild optical geometry.');
close(decentered.leftMesh.thickness(-20, 0), oldLeftProfile, 'Changing R alone must preserve the L optical profile.');
decentered.setOptions({ sph: 6, opticalCenters: null });
const centeredPlusThickness = decentered.mesh.thickness(0, 0);
decentered.setOptions({ opticalCenters: { R: { x: 12, y: 10 }, L: { x: -12, y: 10 } } });
assert.ok(decentered.mesh.thickness(12, -10) > centeredPlusThickness, 'Larger required radius must increase illustrative plus-lens center thickness.');
// Mixed-power cylinders can have minima between the boxing center and perimeter.
for (const prescription of [
  { sph: -20, cyl: -7, axis: 37, index: 1.50 },
  { sph: 12, cyl: -7, axis: 120, index: 1.74 },
  { sph: 2, cyl: -7, axis: 55, index: 1.50 },
  { sph: 0, cyl: 0, axis: 180, index: 1.60 }
]) {
  decentered.setOptions({ ...prescription, camera: { yaw: 1.1, pitch: 2.8 } });
  for (const mesh of [decentered.mesh, decentered.leftMesh]) {
    assert.ok(meshMinimum(mesh) >= 1.49, 'Decentered plus, minus, and mixed-power meshes must remain separated.');
    mesh.vertices.forEach(p => numeric(p.x, p.y, p.z, p.g));
  }
  decentered.render();
}
decentered.destroy();

// Validate ordering only within the clearly labelled illustrative geometry model.
const indices = [1.50, 1.56, 1.57, 1.60, 1.67, 1.74];
const minus = new LensViewer(canvas(), { shapePoints: shapes[0].points, sph: -6, cyl: 0, index: indices[0] });
const plus = new LensViewer(canvas(), { shapePoints: shapes[0].points, sph: 6, cyl: 0, index: indices[0] });
let previousEdge = Infinity, previousCenter = Infinity;
for (const index of indices) {
  minus.setOptions({ index }); plus.setOptions({ index });
  const edge = Math.max(...minus.mesh.contour.map(p => minus.mesh.thickness(...p)));
  const center = plus.mesh.thickness(0, 0);
  assert.ok(edge < previousEdge, 'Higher index must reduce edge thickness for the same minus illustration.');
  assert.ok(center < previousCenter, 'Higher index must reduce center thickness for the same plus illustration.');
  assert.ok(surfaceMinimum(minus) >= 1.49 && surfaceMinimum(plus) >= 1.49);
  previousEdge = edge; previousCenter = center;
}
minus.destroy(); plus.destroy();

// Numeric thickness comes from the same optical field as the preview, never
// supplier blank CT/ET. Test optical and geometric cases that need more than
// sampling the boxing center or simply taking the maximum rim thickness.
const measured = new LensViewer(canvas(), {
  pairMode: true, eyeLayout: 'wearer', shapePoints: shapes[2].points,
  widthMm: 54, heightMm: 40, sph: -6, cyl: 0, index: 1.50,
  opticalCenters: { R: { x: 6, y: 2 }, L: { x: -2, y: -1 } }
});
let metrics = measured.getThicknessMetrics();
assert.equal(metrics.unit, 'mm');
assert.equal(metrics.source, 'illustrative-renderer-model');
assert.equal(metrics.productionVerified, false);
assert.equal(metrics.minimumThicknessAssumptionMm, 1.5);
assert.equal(metrics.pair.eyeCount, 2);
assert.equal(metrics.pair.centerAvailableEyeCount, 2);
for (const eye of ['R', 'L']) {
  close(metrics.eyes[eye].centerThicknessMm, 1.5, 'A minus sphere retains the model CT assumption at each optical center.');
  assert.ok(metrics.eyes[eye].edgeMinMm > metrics.eyes[eye].centerThicknessMm);
  close(metrics.eyes[eye].maxMm, metrics.eyes[eye].edgeMaxMm, 'The widest thickness of a minus sphere is at the edge.');
}
assert.ok(Math.abs(metrics.eyes.R.maxMm - metrics.eyes.L.maxMm) > .1, 'Different R/L optical centers must retain different measured thicknesses.');
close(metrics.pair.maxMm, Math.max(metrics.eyes.R.maxMm, metrics.eyes.L.maxMm), 'Pair maximum must include the thicker eye.');
const metricSnapshot = JSON.stringify(metrics), geometrySnapshot = JSON.stringify(measured.mesh.vertices);
measured.setOptions({ camera: { yaw: 2.3, pitch: -1.8, zoom: 1.7 }, eyeLayout: 'observer', colorHex: '#ff0000', kind: 'Gradient' });
assert.equal(JSON.stringify(measured.getThicknessMetrics()), metricSnapshot, 'Camera, eye presentation and tint cannot change measured thickness.');
assert.equal(JSON.stringify(measured.mesh.vertices), geometrySnapshot, 'Reading metrics must not alter the rendered geometry.');

let previousMinusMetric = Infinity, previousPlusMetric = Infinity;
for (const index of indices) {
  measured.setOptions({ index, sph: -6, cyl: 0, opticalCenters: null });
  const minusMetric = measured.getThicknessMetrics();
  assert.ok(minusMetric.pair.maxMm < previousMinusMetric, 'Reported minus maximum must fall as index rises for identical model inputs.');
  previousMinusMetric = minusMetric.pair.maxMm;
  measured.setOptions({ sph: 6 });
  const plusMetric = measured.getThicknessMetrics();
  assert.ok(plusMetric.pair.maxMm < previousPlusMetric, 'Reported plus maximum must fall as index rises for identical model inputs.');
  close(plusMetric.pair.maxMm, plusMetric.pair.centerMaxMm, 'Plus-lens maximum must include the interior optical center.');
  assert.ok(plusMetric.pair.centerMaxMm > plusMetric.pair.edgeMaxMm, 'An edge-only metric would miss the thickest part of a plus lens.');
  previousPlusMetric = plusMetric.pair.maxMm;
}
measured.setOptions({ sph: 0, cyl: 0 });
metrics = measured.getThicknessMetrics();
for (const value of [metrics.pair.centerMinMm, metrics.pair.centerMaxMm, metrics.pair.edgeMinMm, metrics.pair.edgeMaxMm, metrics.pair.minMm, metrics.pair.maxMm]) close(value, 1.5, 'Plano thickness must remain the same throughout the model.');

// An optical center outside the edged shape is not a physical CT location.
measured.setOptions({ sph: -4, opticalCenters: { R: { x: 100, y: 0 }, L: { x: 0, y: 0 } } });
metrics = measured.getThicknessMetrics();
assert.equal(metrics.eyes.R.opticalCenterInside, false);
assert.equal(metrics.eyes.R.centerThicknessMm, null);
assert.equal(metrics.eyes.L.opticalCenterInside, true);
assert.equal(metrics.pair.centerAvailableEyeCount, 1);
assert.ok(metrics.eyes.R.minMm > 1.5, 'An extrapolated OC thickness must not become the minimum of a lens that does not contain it.');
assert.ok(Number.isFinite(metrics.eyes.R.maxMm));

// Independent dense boundary sampling verifies exact between-vertex extrema for
// sphere, plus and mixed cylinder powers, including a singular power matrix.
for (const prescription of [
  { sph: -6, cyl: 0, axis: 0 },
  { sph: 6, cyl: -3, axis: 37 },
  { sph: 2, cyl: -7, axis: 55 },
  { sph: 0, cyl: -5, axis: 28 }
]) {
  measured.setOptions({ ...prescription, index: 1.50, opticalCenters: { R: { x: 4.2, y: 3.7 }, L: { x: -7.1, y: -2.3 } } });
  metrics = measured.getThicknessMetrics();
  for (const [eye, mesh] of [['R', measured.mesh], ['L', measured.leftMesh]]) {
    const dense = [];
    mesh.contour.forEach((point, i) => {
      const next = mesh.contour[(i + 1) % mesh.contour.length];
      for (let j = 0; j <= 64; j++) {
        const t = j / 64;
        dense.push(mesh.thickness(point[0] * (1 - t) + next[0] * t, point[1] * (1 - t) + next[1] * t));
      }
    });
    const denseMin = Math.min(...dense), denseMax = Math.max(...dense), m = metrics.eyes[eye];
    assert.ok(m.edgeMinMm <= denseMin + 1e-9 && denseMin - m.edgeMinMm < 1e-5, 'Exact ET minimum must match a dense edge check.');
    assert.ok(m.edgeMaxMm >= denseMax - 1e-9 && m.edgeMaxMm - denseMax < 1e-5, 'Exact ET maximum must match a dense edge check.');
    for (const point of mesh.contour) for (let ring = 0; ring <= 20; ring++) {
      const value = mesh.thickness(point[0] * ring / 20, point[1] * ring / 20);
      assert.ok(value >= m.minMm - 1e-8 && value <= m.maxMm + 1e-8, 'Reported whole-lens extrema must enclose interior model samples.');
    }
  }
}
measured.setOptions({ pairMode: false, opticalCenters: null });
metrics = measured.getThicknessMetrics();
assert.equal(metrics.pair.eyeCount, 1);
assert.equal(metrics.eyes.L, null);
measured.destroy();

// Measurement labels stay attached to each pair's viewport while numeric values
// retain true mm under camera rotations. The leader must identify the thickest
// physical location, including an interior plus-lens maximum.
for (const size of [{ width: 440, height: 310 }, { width: 320, height: 290 }]) {
  const annotationCanvas = canvas();
  annotationCanvas.getBoundingClientRect = () => size;
  const annotated = new LensViewer(annotationCanvas, {
    pairMode: true, eyeLayout: 'wearer', showMeasurements: true,
    shapePoints: shapes[0].points, widthMm: 58, heightMm: 40, bridgeMm: 18,
    sph: -4, cyl: -1, index: 1.74,
    opticalCenters: { R: { x: 6.5, y: 1 }, L: { x: -6.5, y: 1 } }
  });
  const geometryBeforeAnnotations = JSON.stringify(annotated.mesh.vertices);
  for (const view of ['front', 'perspective', 'side', 'back']) {
    annotated.setView(view);
    const labels = annotated._measurementAnnotations;
    assert.equal(labels.length, 6);
    assert.equal(labels.find(x => x.kind === 'width').value, '58,0 mm');
    assert.equal(labels.find(x => x.kind === 'height').value, '40,0 mm');
    assert.equal(labels.find(x => x.kind === 'bridge').value, '18,0 mm');
    if (view === 'side') assert.equal(labels.find(x => x.kind === 'width').guideMode, 'leader',
      'An edge-on lens must not use its visible thickness as the A dimension span.');
    for (const label of labels) {
      assert.ok(label.x - label.width / 2 >= 0 && label.x + label.width / 2 <= size.width,
        'Annotation labels must stay horizontally inside the canvas.');
      assert.ok(label.y - label.height / 2 >= 0 && label.y + label.height / 2 <= size.height,
        'Annotation labels must stay vertically inside the canvas.');
    }
    const thickness = labels.find(x => x.kind === 'thickness');
    const leaderX = thickness.leaderRoute[1].x;
    assert.ok(leaderX > thickness.x + thickness.width / 2,
      'The vertical thickness leader must stay outside its callout text, including side views.');
    assert.ok(leaderX > thickness.eyeLabelBounds.maxX,
      'The vertical thickness leader must stay outside the eye label.');
    const mesh = thickness.anchor.eye === 'R' ? annotated.mesh : annotated.leftMesh;
    close(mesh.thickness(thickness.anchor.modelX, thickness.anchor.modelY), annotated.getThicknessMetrics().pair.maxMm,
      'Thickness leader must mark the true maximum from the same model, not an arbitrary rim point.');
    const centers = labels.filter(x => x.kind === 'center');
    assert.equal(centers.length, 2, 'Each eye needs its own CT annotation.');
    for (const center of centers) {
      const eyeMesh = center.anchor.eye === 'R' ? annotated.mesh : annotated.leftMesh;
      const metric = annotated.getThicknessMetrics().eyes[center.anchor.eye];
      assert.equal(center.title, 'CT · ' + center.anchor.eye);
      assert.equal(center.value, metric.centerThicknessMm.toFixed(2).replace('.', ',') + ' mm');
      close(center.anchor.modelX, eyeMesh.opticalCenter.x, 'CT anchor must use that eye’s actual OC X, not the boxing center.');
      close(center.anchor.modelY, eyeMesh.opticalCenter.y, 'CT anchor must use that eye’s actual OC Y, not the boxing center.');
      close(center.anchor.thicknessMm, eyeMesh.thickness(eyeMesh.opticalCenter.x, eyeMesh.opticalCenter.y),
        'CT annotation must retain the value at its own physical optical center.');
    }
  }
  assert.equal(JSON.stringify(annotated.mesh.vertices), geometryBeforeAnnotations, 'Annotations cannot change the optical geometry.');
  annotated.setOptions({ sph: 6, cyl: 0, widthMm: 54, heightMm: 38, bridgeMm: 20 });
  const plusLabels = annotated._measurementAnnotations;
  assert.equal(plusLabels.find(x => x.kind === 'width').value, '54,0 mm');
  assert.equal(plusLabels.find(x => x.kind === 'height').value, '38,0 mm');
  assert.equal(plusLabels.find(x => x.kind === 'bridge').value, '20,0 mm');
  const plusAnchor = plusLabels.find(x => x.kind === 'thickness').anchor;
  const plusMesh = plusAnchor.eye === 'R' ? annotated.mesh : annotated.leftMesh;
  close(plusAnchor.modelX, plusMesh.opticalCenter.x, 'Plus maximum leader must point at the actual optical center X.');
  close(plusAnchor.modelY, plusMesh.opticalCenter.y, 'Plus maximum leader must point at the actual optical center Y.');
  annotated.setOptions({ opticalCenters: { R: { x: 2, y: 1 }, L: { x: -9, y: -3 } } });
  const differentCenters = annotated._measurementAnnotations.filter(x => x.kind === 'center');
  assert.equal(differentCenters.length, 2);
  assert.notEqual(differentCenters[0].value, differentCenters[1].value,
    'Asymmetric plus-lens centration must retain the different CT values for L and R.');
  for (const center of differentCenters) close(center.anchor.thicknessMm,
    annotated.getThicknessMetrics().eyes[center.anchor.eye].centerThicknessMm,
    'Each CT label must agree with the per-eye metric rather than a pair aggregate.');
  annotated.setOptions({ opticalCenters: { R: { x: 100, y: 0 }, L: { x: -9, y: -3 } } });
  const availableCenters = annotated._measurementAnnotations.filter(x => x.kind === 'center');
  assert.equal(availableCenters.length, 1, 'An OC outside the cut outline must not receive a numeric CT annotation.');
  assert.equal(availableCenters[0].anchor.eye, 'L');
  annotated.setOptions({ opticalCenters: { R: { x: 6.5, y: 1 }, L: { x: -6.5, y: 1 } } });
  annotated.setOptions({ sph: -20, cyl: -7, index: 1.50, camera: { yaw: Math.PI / 2, pitch: 0 } });
  assert.equal(annotated._measurementAnnotations.find(x => x.kind === 'width').guideMode, 'leader',
    'Even a thick side silhouette must not become a false A dimension.');
  annotated.setOptions({ camera: { yaw: 0, pitch: Math.PI / 2 } });
  assert.equal(annotated._measurementAnnotations.find(x => x.kind === 'height').guideMode, 'leader',
    'An edge-on height axis must use a leader rather than a false B dimension.');
  annotated.setOptions({ measurementsValid: false });
  assert.equal(annotated._measurementAnnotations.length, 3, 'Invalid fitting inputs must suppress numerical thickness annotations.');
  assert.ok(!annotated._measurementAnnotations.some(x => x.kind === 'thickness'));
  assert.ok(!annotated._measurementAnnotations.some(x => x.kind === 'center'));
  annotated.setOptions({ showMeasurements: false });
  assert.equal(annotated._measurementAnnotations.length, 0);
  annotated.destroy();
}

// Tall presets must keep the orange callout clear of the R/L label after the
// bottom margin clamps its placement (the round 50 x 50 desktop regression).
for (const size of [{ width: 441, height: 310 }, { width: 320, height: 290 }]) {
  const presetCanvas = canvas();
  presetCanvas.getBoundingClientRect = () => size;
  const viewer = new LensViewer(presetCanvas, { pairMode: true, eyeLayout: 'wearer',
    showMeasurements: true, bridgeMm: 18, sph: -4, cyl: -1, axis: 180, index: 1.74 });
  for (const preset of shapes.filter(s => s.source === 'user-svg')) {
    const width = preset.defaultWidthMm, height = preset.defaultHeightMm;
    viewer.setOptions({ shapePoints: preset.points, contourMode: contourModeFor(preset), widthMm: width, heightMm: height,
      opticalCenters: { R: { x: (width + 18) / 2 - 31.5, y: height / 2 - 19 },
        L: { x: -((width + 18) / 2 - 31.5), y: height / 2 - 19 } } });
    for (const view of ['front', 'perspective']) {
      viewer.setView(view);
      const callout = viewer._measurementAnnotations.find(a => a.kind === 'thickness');
      const eye = callout.eyeLabelBounds;
      assert.ok(callout.x + callout.width / 2 <= eye.minX || callout.x - callout.width / 2 >= eye.maxX ||
        callout.y + callout.height / 2 <= eye.minY || callout.y - callout.height / 2 >= eye.maxY,
        `${preset.code} ${view} ${size.width}: thickness callout must not cover the eye label.`);
      assert.equal(viewer._measurementAnnotations.filter(a => a.kind === 'center').length, 2,
        'Both CT labels must remain present for a valid preset.');
    }
  }
  viewer.destroy();
}

// Frame hardware is a display layer. Changing a mount or hiding its temples
// must never alter the edged lens, optical centers, or reported CT/ET values.
const mountStyles = ['full-rim', 'half-rimless', 'rimless'];
const mountCanvas = canvas();
mountCanvas.getBoundingClientRect = () => ({ width: 441, height: 360 });
const mounted = new LensViewer(mountCanvas, {
  pairMode: true, eyeLayout: 'wearer', showMeasurements: true,
  bridgeMm: 18, sph: -4, cyl: -1, axis: 180, index: 1.74,
  opticalCenters: { R: { x: 3.5, y: 2 }, L: { x: -3.5, y: 2 } }
});
const assertFrameOnly = (viewer, before, context) => {
  assert.strictEqual(viewer.mesh, before.right, `${context}: frame controls must not rebuild the R optical mesh.`);
  assert.strictEqual(viewer.leftMesh, before.left, `${context}: frame controls must not rebuild the L optical mesh.`);
  assert.equal(JSON.stringify([viewer.mesh.vertices, viewer.leftMesh.vertices]), before.vertices,
    `${context}: frame controls must not mutate lens surfaces.`);
  assert.equal(JSON.stringify([viewer.mesh.contour, viewer.leftMesh.contour]), before.contours,
    `${context}: frame controls must not change the blank-screening outline.`);
  assert.equal(JSON.stringify(viewer.getThicknessMetrics()), before.metrics,
    `${context}: mount appearance cannot change CT, ET, or lens thickness.`);
};
const opticalSnapshot = viewer => ({ right: viewer.mesh, left: viewer.leftMesh,
  vertices: JSON.stringify([viewer.mesh.vertices, viewer.leftMesh.vertices]),
  contours: JSON.stringify([viewer.mesh.contour, viewer.leftMesh.contour]),
  metrics: JSON.stringify(viewer.getThicknessMetrics()) });
const partsByKind = (viewer, kind) => viewer._frameParts.filter(part => part.kind === kind);
const assertBothEyes = (parts, context) => {
  assert.deepEqual([...new Set(parts.map(part => part.eye))].sort(), ['L', 'R'], context);
};
const assertHardwareFinite = (viewer, context, fit = false) => {
  assert.ok(viewer._frameParts.length, `${context}: visible frame must produce hardware.`);
  for (const part of viewer._frameParts) {
    assert.ok(part.points.length >= 2 && part.screenPoints.length >= 2, `${context}: hardware needs a visible path.`);
    for (const point of part.points) {
      for (const axis of ['x', 'y', 'z']) assert.ok(Number.isFinite(point[axis]), `${context}: model hardware coordinates must be finite.`);
      if (point.offsetX !== undefined) assert.ok(Number.isFinite(point.offsetX));
    }
    for (const point of part.screenPoints) {
      for (const axis of ['x', 'y', 'z']) assert.ok(Number.isFinite(point[axis]), `${context}: projected hardware coordinates must be finite.`);
      if (fit) {
        assert.ok(point.x >= 0 && point.x <= viewer.width && point.y >= 0 && point.y <= viewer.height,
          `${context}: default camera must fit complete ${part.kind} inside the preview.`);
      }
    }
  }
};
for (const shape of shapes) {
  mounted.setOptions({ shapePoints: shape.points, contourMode: contourModeFor(shape),
    widthMm: shape.defaultWidthMm || 52, heightMm: shape.defaultHeightMm || 38,
    showFrame: false, showTemples: true });
  mounted.setView('front');
  const before = opticalSnapshot(mounted);
  for (const frameStyle of mountStyles) {
    mounted.setOptions({ showFrame: true, frameStyle, showTemples: true });
    const context = `${shape.code} ${frameStyle}`;
    assertFrameOnly(mounted, before, context);
    assertHardwareFinite(mounted, context, true);
    assertBothEyes(partsByKind(mounted, 'hinge'), `${context}: both temporal sides need a hinge.`);
    assertBothEyes(partsByKind(mounted, 'temple'), `${context}: visible temples must serve both eyes.`);
    assertBothEyes(partsByKind(mounted, 'ear-tip'), `${context}: each temple needs an ear bend.`);
    assert.equal(partsByKind(mounted, 'bridge').length, 1, `${context}: one bridge joins the pair.`);
    if (frameStyle === 'full-rim') {
      const rims = partsByKind(mounted, 'rim');
      assertBothEyes(rims, `${context}: full rims must surround both lenses.`);
      assert.ok(rims.every(part => part.closed), `${context}: full rims must form closed contours.`);
      assert.equal(partsByKind(mounted, 'upper-rim').length, 0);
    } else if (frameStyle === 'half-rimless') {
      const upper = partsByKind(mounted, 'upper-rim');
      assertBothEyes(upper, `${context}: the upper frame must remain on both lenses.`);
      assert.ok(upper.every(part => !part.closed), `${context}: upper rims must not close across the lower lens.`);
      assert.ok(upper.every(part => part.points.reduce((sum, p) => sum + p.y, 0) / part.points.length > 0),
        `${context}: the solid rim must stay on the upper part of the lens.`);
      assert.equal(partsByKind(mounted, 'rim').length, 0, `${context}: no full rim may remain on a half-rimless lens.`);
    } else {
      assert.equal(mounted._frameParts.filter(part => ['rim', 'upper-rim', 'nylon'].includes(part.kind)).length, 0,
        `${context}: rimless must have no continuous perimeter rim.`);
      assertBothEyes(partsByKind(mounted, 'mount'), `${context}: rimless lenses need discrete attachments.`);
    }
    for (const temple of partsByKind(mounted, 'temple')) {
      const temporalSign = temple.eye === 'R' ? -1 : 1;
      assert.ok(temporalSign * temple.points[0].x > mounted.mesh.width * .25,
        `${context}: temples must attach to the temporal side, not the nose.`);
      assert.ok(Math.min(...temple.points.map(p => p.z)) < temple.points[0].z - mounted.mesh.width * .3,
        `${context}: temples must extend behind the lens plane.`);
    }
    const eyes = [...mounted._renderedEyes].sort((a, b) => a.centerX - b.centerX);
    for (const hinge of partsByKind(mounted, 'hinge')) {
      const eye = eyes.find(e => e.eye === hinge.eye), outerSign = eye === eyes[0] ? -1 : 1;
      assert.ok(outerSign * (hinge.screenPoints[0].x - eye.centerX) > 0,
        `${context}: the displayed hinge must remain on the outside of its own eye.`);
    }
    const bridge = partsByKind(mounted, 'bridge')[0];
    assert.ok([bridge.screenPoints[0], bridge.screenPoints.at(-1)].every(p => p.x > eyes[0].centerX && p.x < eyes[1].centerX),
      `${context}: the bridge must connect nasal sides between the eye centers.`);
    mounted.setOptions({ showTemples: false });
    assert.equal(mounted._frameParts.filter(part => ['temple', 'ear-tip'].includes(part.kind)).length, 0,
      `${context}: hiding temples must remove arms and ear tips.`);
    assert.equal(partsByKind(mounted, 'bridge').length, 1, `${context}: hiding temples must retain the front frame.`);
    assertFrameOnly(mounted, before, context + ' temples hidden');
    mounted.setOptions({ showFrame: false, showTemples: true });
    assert.equal(mounted._frameParts.length, 0, `${context}: hidden frame cannot leave mounts, bridge or temples visible.`);
    assert.equal(mounted._frameLayout, null, `${context}: hidden frame must restore normal lens-only framing.`);
    assertFrameOnly(mounted, before, context + ' all hidden');
  }
}
mounted.destroy();

// Regression: an opaque B-dimension label once hid a temple segment, leaving
// its ear tip apparently detached. Check actual segment/rectangle intersections
// (including stroke width), not just bounding boxes of diagonal segments.
const segmentTouchesRect = (start, end, rect) => {
  let enter = 0, leave = 1;
  for (const axis of ['x', 'y']) {
    const delta = end[axis] - start[axis];
    const minimum = rect[axis === 'x' ? 'left' : 'top'];
    const maximum = rect[axis === 'x' ? 'right' : 'bottom'];
    if (Math.abs(delta) < 1e-12) {
      if (start[axis] < minimum || start[axis] > maximum) return false;
    } else {
      const first = (minimum - start[axis]) / delta, last = (maximum - start[axis]) / delta;
      enter = Math.max(enter, Math.min(first, last));
      leave = Math.min(leave, Math.max(first, last));
      if (enter > leave) return false;
    }
  }
  return true;
};
for (const size of [{ width: 441, height: 360 }, { width: 320, height: 330 }]) {
  const labelCanvas = canvas();
  labelCanvas.getBoundingClientRect = () => size;
  const viewer = new LensViewer(labelCanvas, { pairMode: true, eyeLayout: 'wearer',
    shapePoints: shapes[0].points, contourMode: 'raster', widthMm: 52, heightMm: 38, bridgeMm: 18,
    sph: -4, cyl: -1, axis: 180, showMeasurements: true, showFrame: true, showTemples: true,
    opticalCenters: { R: { x: 3.5, y: 0 }, L: { x: -3.5, y: 0 } },
    camera: { yaw: -.62, pitch: .12, zoom: 1 } });
  for (const frameStyle of mountStyles) for (const index of [1.74, 1.50]) {
    viewer.setOptions({ frameStyle, index });
    const label = viewer._measurementAnnotations.find(item => item.kind === 'height');
    assert.ok(label, 'The B dimension must remain available while avoiding hardware.');
    assert.equal(label.value, '38,0 mm');
    for (const part of viewer._frameParts.filter(item => ['temple', 'ear-tip'].includes(item.kind))) {
      const strokePadding = Math.max(.65, part.widthMm * viewer._frameLayout.scale) / 2;
      const rect = { left: label.x - label.width / 2 - strokePadding,
        right: label.x + label.width / 2 + strokePadding,
        top: label.y - label.height / 2 - strokePadding,
        bottom: label.y + label.height / 2 + strokePadding };
      for (let i = 1; i < part.screenPoints.length; i++) {
        assert.ok(!segmentTouchesRect(part.screenPoints[i - 1], part.screenPoints[i], rect),
          `${size.width} ${frameStyle} ${index}: opaque B label must not cover ${part.eye} ${part.kind}.`);
      }
    }
  }
  viewer.destroy();
}

// Normal view presets must fit the hardware on desktop and narrow previews;
// full yaw/pitch rotations may change its projection, never its optical data.
for (const size of [{ width: 441, height: 360 }, { width: 320, height: 330 }]) {
  const smallCanvas = canvas();
  smallCanvas.getBoundingClientRect = () => size;
  const shape = shapes.find(s => s.code === 'cat-eye');
  const viewer = new LensViewer(smallCanvas, { pairMode: true, eyeLayout: 'wearer',
    shapePoints: shape.points, contourMode: 'vector', widthMm: shape.defaultWidthMm, heightMm: shape.defaultHeightMm,
    showMeasurements: true, showFrame: true, showTemples: true, frameStyle: 'full-rim' });
  const before = opticalSnapshot(viewer);
  for (const frameStyle of mountStyles) {
    viewer.setOptions({ frameStyle });
    for (const view of ['front', 'perspective', 'side', 'back']) {
      viewer.setView(view);
      assertHardwareFinite(viewer, `${size.width} ${frameStyle} ${view}`, true);
      assertFrameOnly(viewer, before, `${size.width} ${frameStyle} ${view}`);
      assert.equal(viewer._measurementAnnotations.filter(a => a.kind === 'center').length, 2,
        'Frame hardware must preserve both CT callouts.');
    }
  }
  for (const eyeLayout of ['wearer', 'observer']) {
    viewer.setOptions({ eyeLayout, frameStyle: 'full-rim' });
    for (let step = 0; step <= 12; step++) {
      for (const camera of [{ yaw: step * Math.PI / 6, pitch: 0, zoom: 1 },
        { yaw: -.62, pitch: step * Math.PI / 6, zoom: 1 }]) {
        viewer.setOptions({ camera });
        assertHardwareFinite(viewer, `${size.width} ${eyeLayout} rotation ${step}`);
        assertFrameOnly(viewer, before, `${size.width} ${eyeLayout} rotation ${step}`);
      }
    }
  }
  viewer.destroy();
}

// Exercise animation scheduling with a controlled clock instead of a real timer.
const queued = new Map(), documentListeners = new Map(), mediaListeners = new Map();
let frameId = 0;
const doc = { hidden: false, visibilityState: 'visible',
  addEventListener: (type, fn) => documentListeners.set(type, fn),
  removeEventListener: type => documentListeners.delete(type) };
const media = { matches: false,
  addEventListener: (type, fn) => mediaListeners.set(type, fn),
  removeEventListener: type => mediaListeners.delete(type) };
const animatedSandbox = {
  module: { exports: {} }, document: doc, matchMedia: () => media,
  requestAnimationFrame(fn) { queued.set(++frameId, fn); return frameId; },
  cancelAnimationFrame(id) { queued.delete(id); }
};
vm.runInNewContext(source, animatedSandbox);
const advance = timestamp => { const frame = [...queued.values()]; queued.clear(); frame.forEach(fn => fn(timestamp)); };
const rotationEvents = [];
const animatedCanvas = canvas();
const animated = new animatedSandbox.module.exports(animatedCanvas, { pairMode: true, onRotationChange: enabled => rotationEvents.push(enabled) });
assert.equal(animated.setAutoRotate(true), true);
const initialYaw = animated.getCamera().yaw;
advance(0); advance(50);
assert.ok(animated.getCamera().yaw > initialYaw);
doc.hidden = true; doc.visibilityState = 'hidden'; documentListeners.get('visibilitychange')();
assert.equal(queued.size, 0, 'A hidden document must not retain an animation loop.');
assert.equal(animated.isAutoRotating(), true, 'Visibility pause should preserve the requested playback state.');
const hiddenYaw = animated.getCamera().yaw;
advance(5000);
close(animated.getCamera().yaw, hiddenYaw, 'Hidden time must not advance the camera.');
doc.hidden = false; doc.visibilityState = 'visible'; documentListeners.get('visibilitychange')();
advance(6000);
close(animated.getCamera().yaw, hiddenYaw, 'Resuming must not jump by elapsed hidden time.');
advance(6050);
assert.ok(animated.getCamera().yaw > hiddenYaw);
media.matches = true; mediaListeners.get('change')();
advance(6100);
assert.equal(animated.isAutoRotating(), false);
assert.equal(queued.size, 0, 'Reduced motion must stop continuous scheduling.');
assert.equal(animated.setAutoRotate(true), false, 'Reduced-motion preference must prevent automatic playback.');
advance(6200);
assert.equal(queued.size, 0);
media.matches = false;
animated.setAutoRotate(true); advance(6300);
assert.ok(queued.size > 0);
animated.destroy();
assert.equal(queued.size, 0, 'Destroy must cancel animation.');
assert.equal(documentListeners.size, 0);
assert.equal(mediaListeners.size, 0);
assert.equal(animatedCanvas.listeners.size, 0);
assert.deepEqual(rotationEvents, [true, false, true]);

console.log('Viewer checks passed: full/half/rimless frame hardware and temple visibility, camera fitting and optical invariance, canvas measurement annotation bounds/true maximum anchors, numeric CT/ET and whole-lens extrema, shared smooth screening/render contours, wearer-side eye ordering with preserved eye data, mirrored eye pair, independent optical-center decentration, frame-anchored tint, full yaw/pitch turns, index ordering, PDF gradients, synchronization, visibility/reduced-motion playback, and cleanup.');
