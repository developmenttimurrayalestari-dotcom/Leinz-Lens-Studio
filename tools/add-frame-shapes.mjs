// Rebuild additional presets from the user's exact SVG lens apertures.
// Run after prepare-materials-shapes.py. The original nine shapes are untouched.
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const target = new URL('../dist/assets/shapes.json', import.meta.url);
const catalog = JSON.parse(fs.readFileSync(target, 'utf8'));
const pointCount = 256;
const samplesPerCurve = 1024;
const specifications = [
  { code: 'round', name: 'Rounded / Bulat', shortName: 'Rounded', file: 'rounded.svg', width: 50,
    aliases: ['bulat', 'rounded', 'round'],
    description: 'Kontur bukaan lensa membulat mengikuti rounded.svg yang dilampirkan pengguna.' },
  { code: 'cat-eye', name: 'Cat-eye', file: 'cateye.svg', width: 54,
    description: 'Kontur cat-eye mengikuti bukaan lensa pada cateye.svg, dengan sisi luar terangkat.' },
  { code: 'rectangle', name: 'Rectangle', file: 'rectangle.svg', width: 54,
    description: 'Kontur bukaan lensa mengikuti rectangle.svg, termasuk lengkung sisi dan sudutnya.' },
  { code: 'square', name: 'Square', file: 'square.svg', width: 50,
    description: 'Kontur bukaan lensa mengikuti square.svg dengan rasio lebar dan tinggi dari acuan.' }
];

function cubicPoint(curve, t) {
  const s = 1 - t;
  return [0, 1].map(axis => s ** 3 * curve[0][axis]
    + 3 * s ** 2 * t * curve[1][axis]
    + 3 * s * t ** 2 * curve[2][axis] + t ** 3 * curve[3][axis]);
}

function parseCubicSubpath(path) {
  const tokens = path.match(/[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?|[A-Za-z]/g) || [];
  const curves = [];
  let cursor = 0, point, start, closed = false;
  const readPoint = () => {
    const result = tokens.slice(cursor, cursor + 2).map(Number);
    cursor += 2;
    if (result.length !== 2 || result.some(v => !Number.isFinite(v))) throw new Error('Invalid SVG coordinate.');
    return result;
  };
  while (cursor < tokens.length) {
    const command = tokens[cursor++];
    if (command === 'M' && !point) point = start = readPoint();
    else if (command === 'C' && point) {
      const control1 = readPoint(), control2 = readPoint(), end = readPoint();
      curves.push([point, control1, control2, end]); point = end;
    } else if (command === 'Z' && point) {
      if (Math.hypot(point[0] - start[0], point[1] - start[1]) > 1e-8) {
        const between = t => point.map((v, axis) => v + t * (start[axis] - v));
        curves.push([point, between(1 / 3), between(2 / 3), start]);
      }
      closed = true;
      if (cursor !== tokens.length) throw new Error('Only one closed aperture is expected.');
    } else throw new Error(`Unsupported aperture command ${command}; review the SVG before tracing.`);
  }
  if (!closed || curves.length < 3) throw new Error('A closed cubic lens aperture is required.');
  return curves;
}

function cubicBounds(curves) {
  const points = [];
  for (const curve of curves) {
    const ts = [0, 1];
    for (const axis of [0, 1]) {
      const [p0, p1, p2, p3] = curve.map(point => point[axis]);
      const a = 3 * (-p0 + 3 * p1 - 3 * p2 + p3);
      const b = 2 * (3 * p0 - 6 * p1 + 3 * p2);
      const c = -3 * p0 + 3 * p1;
      if (Math.abs(a) < 1e-12) {
        if (Math.abs(b) > 1e-12) ts.push(-c / b);
      } else {
        const discriminant = b * b - 4 * a * c;
        if (discriminant >= 0) {
          ts.push((-b + Math.sqrt(discriminant)) / (2 * a));
          ts.push((-b - Math.sqrt(discriminant)) / (2 * a));
        }
      }
    }
    for (const t of ts) if (t >= 0 && t <= 1) points.push(cubicPoint(curve, t));
  }
  const minX = Math.min(...points.map(p => p[0])), maxX = Math.max(...points.map(p => p[0]));
  const minY = Math.min(...points.map(p => p[1])), maxY = Math.max(...points.map(p => p[1]));
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function normalizedContour(curves) {
  const dense = curves.flatMap(curve => Array.from({ length: samplesPerCurve }, (_, i) => cubicPoint(curve, i / samplesPerCurve)));
  const lengths = dense.map((p, i) => Math.hypot(p[0] - dense[(i + 1) % dense.length][0], p[1] - dense[(i + 1) % dense.length][1]));
  const perimeter = lengths.reduce((sum, value) => sum + value, 0);
  let edge = 0, travelled = 0;
  const sampled = Array.from({ length: pointCount }, (_, i) => {
    const distance = i * perimeter / pointCount;
    while (edge < dense.length - 1 && travelled + lengths[edge] < distance) travelled += lengths[edge++];
    const next = dense[(edge + 1) % dense.length], t = (distance - travelled) / lengths[edge];
    return dense[edge].map((v, axis) => v + t * (next[axis] - v));
  });
  const minimum = [0, 1].map(axis => Math.min(...sampled.map(p => p[axis])));
  const maximum = [0, 1].map(axis => Math.max(...sampled.map(p => p[axis])));
  const normalized = sampled.map(p => p.map((v, axis) => Number(((v - minimum[axis]) / (maximum[axis] - minimum[axis]) - .5).toFixed(9))));
  const area = normalized.reduce((sum, p, i) => {
    const q = normalized[(i + 1) % normalized.length]; return sum + p[0] * q[1] - q[0] * p[1];
  }, 0);
  if (area < 0) normalized.reverse();
  return normalized;
}

const presets = specifications.map(spec => {
  const svg = fs.readFileSync(new URL(`shape-references/${spec.file}`, import.meta.url), 'utf8');
  if (/\btransform\s*=/.test(svg)) throw new Error(`${spec.file}: transform requires explicit handling.`);
  const paths = [...svg.matchAll(/<path\b[^>]*\bd="([^"]+)"[^>]*>/g)].map(match => match[1]);
  if (paths.length !== 2) throw new Error(`${spec.file}: expected the two supplied compound frame paths.`);
  const apertures = paths.map((path, pathIndex) => {
    const subpaths = path.match(/M[^M]*?Z/g);
    if (subpaths?.length !== 2) throw new Error(`${spec.file}: expected an outer rim and an inner aperture.`);
    const curves = parseCubicSubpath(subpaths[1]);
    return { pathIndex, subpathIndex: 1, pathData: subpaths[1], curves, bounds: cubicBounds(curves) };
  });
  // Left in the front-facing SVG: temporal edge is at negative X for canonical R.
  // The viewer mirrors this contour for L and applies its wearer-side display.
  const aperture = apertures.reduce((left, next) => next.bounds.minX < left.bounds.minX ? next : left);
  const ratio = aperture.bounds.width / aperture.bounds.height;
  return {
    code: spec.code, name: spec.name, ...(spec.shortName ? { shortName: spec.shortName } : {}),
    ...(spec.aliases ? { aliases: spec.aliases } : {}),
    description: spec.description,
    defaultWidthMm: spec.width, defaultHeightMm: Math.round(spec.width / ratio * 10) / 10,
    referenceAspectRatio: Number(ratio.toFixed(10)), geometryRevision: 'svg-reference-v1',
    points: normalizedContour(aperture.curves),
    source: 'user-svg', status: 'illustrative', category: 'additional', synthetic: false,
    sourceFile: spec.file, sourceSha256: createHash('sha256').update(svg).digest('hex'),
    sourcePathIndex: aperture.pathIndex, sourceSubpathIndex: aperture.subpathIndex, sourceIndexBase: 0,
    sourceContour: 'inner-lens-aperture', sourceSide: 'left', canonicalEye: 'R',
    sourceBounds: Object.fromEntries(Object.entries(aperture.bounds).map(([key, value]) => [key, Number(value.toFixed(9))])),
    sourcePathData: aperture.pathData,
    contourSampling: { method: 'cubic-bezier-uniform-arc-length', points: pointCount, samplesPerCurve }
  };
});

const retiredCodes = new Set(['round', 'browline', 'cat-eye', 'rectangle', 'square']);
const retained = catalog.items.filter(shape => !retiredCodes.has(shape.code));
const screenshotCodes = retained.filter(shape => shape.source === 'screenshot').map(shape => shape.code);
const screenshotSource = catalog.sources?.find(source => source.source === 'screenshot');
const { sourceFile, sourceSha256, sources, items, note, ...metadata } = catalog;
if (screenshotCodes.join(',') !== '001,002,003,004,005,006,007,008,009') {
  throw new Error('The nine screenshot-derived records must remain in their original order.');
}
const next = {
  ...metadata,
  sources: [
    { source: 'screenshot', sourceFile: screenshotSource?.sourceFile ?? sourceFile,
      sourceSha256: screenshotSource?.sourceSha256 ?? sourceSha256, shapeCodes: screenshotCodes },
    ...presets.map(shape => ({ source: 'user-svg', sourceFile: shape.sourceFile,
      sourceSha256: shape.sourceSha256, shapeCodes: [shape.code], sourceContour: 'inner-lens-aperture',
      generator: 'tools/add-frame-shapes.mjs', referencePath: `tools/shape-references/${shape.sourceFile}` }))
  ],
  note: 'Shapes 001–009 retain their supplied screenshot-derived contours. The four named shapes follow the inner lens apertures in the user-supplied SVG references; browline is removed. SVG pixels are not manufacturing units. Editable default A/B dimensions retain each reference aperture aspect ratio, rounded to 0.1 mm. Canonical R uses the left aperture in the front-facing SVG (temporal side at negative x), and L is mirrored. All shapes remain consultation illustrations rather than physical frame traces.',
  items: [...retained, ...presets]
};
fs.writeFileSync(target, JSON.stringify(next));
console.log(`Preserved ${retained.length} existing shapes; traced ${presets.length} SVG apertures (${next.items.length} total).`);
for (const shape of presets) console.log(`${shape.code}: ${shape.defaultWidthMm} × ${shape.defaultHeightMm} mm; ${shape.sourceFile} path ${shape.sourcePathIndex}, subpath ${shape.sourceSubpathIndex}.`);
