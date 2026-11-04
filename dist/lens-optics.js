/* LensOptics — spherical-front / toric-back surface geometry in millimetres.
 * The prescribed powers are back-vertex powers. This is a centred, paraxial
 * single-vision model, not a production design or a laboratory certification.
 * See docs/OPTICS_MODEL.md for equations, conventions, sources and limitations.
 */
(function (global) {
  'use strict';

  const MODEL = 'spherical-toric-sag-v1';
  const DEFAULT_PROFILE = Object.freeze({
    minCenterMm: 1.5, minEdgeMm: 1.5, frontPowerD: 4,
    frontCurveBasis: 'material', curveReferenceIndex: 1.53,
    frontConic: 0, backConic: 0, source: 'assumption', reference: ''
  });
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const numeric = value => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value));

  function normalizeProfile(input = {}, legacyMinimum) {
    const errors = [];
    if (!input || typeof input !== 'object' || Array.isArray(input)) return { valid: false, errors: ['Profil optik harus berupa objek.'], profile: { ...DEFAULT_PROFILE } };
    const profile = { ...DEFAULT_PROFILE };
    if (legacyMinimum !== undefined && !Object.keys(input).length) {
      profile.minCenterMm = profile.minEdgeMm = legacyMinimum;
    }
    for (const [key, low, high] of [
      ['minCenterMm', .5, 10], ['minEdgeMm', .5, 10], ['frontPowerD', 0, 20],
      ['curveReferenceIndex', 1.3, 2], ['frontConic', 0, 0], ['backConic', 0, 0]
    ]) {
      const value = input[key] === undefined ? profile[key] : input[key];
      if (!numeric(value) || Number(value) < low || Number(value) > high) {
        errors.push(key.endsWith('Conic') ? 'Koefisien asferik belum didukung; frontConic dan backConic harus 0.' : `${key} harus berupa angka ${low}–${high}.`);
      } else profile[key] = Number(value);
    }
    if (input.frontRadiusMm !== undefined && input.frontRadiusMm !== null && input.frontRadiusMm !== '') {
      if (!numeric(input.frontRadiusMm) || +input.frontRadiusMm < 20 || +input.frontRadiusMm > 5000) errors.push('frontRadiusMm harus 20–5000 mm.');
      else profile.frontRadiusMm = +input.frontRadiusMm;
    }
    if (input.frontCurveBasis !== undefined) profile.frontCurveBasis = input.frontCurveBasis;
    if (!['material', 'reference-index'].includes(profile.frontCurveBasis)) errors.push('Basis kurva depan tidak dikenal.');
    if (input.source !== undefined) profile.source = input.source;
    if (!['assumption', 'lab'].includes(profile.source)) errors.push('Sumber profil harus assumption atau lab.');
    if (input.reference !== undefined) {
      if (typeof input.reference !== 'string' || input.reference.length > 500) errors.push('Referensi profil maksimal 500 karakter.');
      else profile.reference = input.reference.trim();
    }
    if (profile.source === 'lab' && !profile.reference) errors.push('Profil dari lab memerlukan catatan referensi.');
    return { valid: errors.length === 0, errors: [...new Set(errors)], profile };
  }

  // Stable exact sag: c*r²/(1 + sqrt(1 - c²*r²)). Unlike R-sqrt(R²-r²),
  // this retains small values on very flat surfaces and permits signed c.
  function sphericalSag(curvature, radiusSquared) {
    if (!finite(curvature) || !finite(radiusSquared) || radiusSquared < 0) return NaN;
    const radicand = 1 - curvature * curvature * radiusSquared;
    if (radicand <= 1e-12) return NaN;
    return curvature * radiusSquared / (1 + Math.sqrt(radicand));
  }

  // Toroidal patch: the cross meridian v is a circle with curvature cv;
  // its sag shifts the radius of the u-meridian circle. At the vertex,
  // principal curvatures are exactly cu and cv. Equal cu/cv gives a sphere.
  function toricSurface(cu, cv, u, v) {
    const rv = 1 - cv * cv * v * v;
    if (rv <= 1e-12) return null;
    const rootV = Math.sqrt(rv), sagV = cv * v * v / (1 + rootV);
    const denominator = 1 - cu * sagV;
    if (denominator <= 1e-12) return null;
    const shifted = cu / denominator;
    const ru = 1 - shifted * shifted * u * u;
    if (ru <= 1e-12) return null;
    const rootU = Math.sqrt(ru);
    return {
      sag: sagV + shifted * u * u / (1 + rootU),
      du: shifted * u / rootU,
      dv: cv * v / (rootV * rootU)
    };
  }

  function containsPoint(contour, x, y) {
    let inside = false;
    for (let i = 0, j = contour.length - 1; i < contour.length; j = i++) {
      const a = contour[j], b = contour[i], dx = b[0] - a[0], dy = b[1] - a[1], length2 = dx * dx + dy * dy;
      const t = length2 ? clamp(((x - a[0]) * dx + (y - a[1]) * dy) / length2, 0, 1) : 0;
      if (Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy) <= 1e-8) return true;
      if ((a[1] > y) !== (b[1] > y) && x < a[0] + (y - a[1]) * dx / dy) inside = !inside;
    }
    return inside;
  }

  function edgeExtrema(field, contour) {
    let min = null, max = null;
    const consider = (x, y, value) => {
      if (!finite(value)) return false;
      const point = { x, y, value };
      if (!min || value < min.value) min = point;
      if (!max || value > max.value) max = point;
      return true;
    };
    for (let i = 0; i < contour.length; i++) {
      const p = contour[i], q = contour[(i + 1) % contour.length], dx = q[0] - p[0], dy = q[1] - p[1];
      // Bracket derivatives on short physical intervals, then bisect the true
      // non-quadratic derivative. Long imported polygon edges receive more work.
      const steps = Math.max(2, Math.ceil(Math.hypot(dx, dy) / 1.5));
      const sample = t => {
        const x = p[0] + dx * t, y = p[1] + dy * t, f = field(x, y);
        if (!f || !consider(x, y, f.thickness)) return null;
        return { t, derivative: f.dx * dx + f.dy * dy };
      };
      let previous = sample(0);
      if (!previous) return null;
      for (let j = 1; j <= steps; j++) {
        const current = sample(j / steps);
        if (!current) return null;
        if (previous.derivative * current.derivative < 0) {
          let low = previous.t, high = current.t, dlow = previous.derivative;
          for (let iteration = 0; iteration < 38; iteration++) {
            const t = (low + high) / 2, middle = sample(t);
            if (!middle) return null;
            if (Math.abs(middle.derivative) < 1e-12) { low = high = t; break; }
            if (dlow * middle.derivative <= 0) high = t;
            else { low = t; dlow = middle.derivative; }
          }
          if (!sample((low + high) / 2)) return null;
        }
        previous = current;
      }
    }
    return { min, max };
  }

  function invalid(errors, profile) {
    return {
      valid: false, model: MODEL, errors: [...new Set(errors)], warnings: [], profile,
      productionVerified: false, calibrationStatus: 'unverified', metrics: null,
      frontSag: () => NaN, backSag: () => NaN, thickness: () => NaN
    };
  }

  function create(options = {}) {
    const normalized = normalizeProfile(options.profile ?? {}, options.legacyMinimum);
    if (!normalized.valid) return invalid(normalized.errors, normalized.profile);
    const profile = normalized.profile;
    const index = Number(options.index), sph = Number(options.sph), cyl = Number(options.cyl), originalAxis = Number(options.axis);
    const oc = options.opticalCenter || { x: 0, y: 0 }, contour = options.contour;
    if (![options.index, options.sph, options.cyl, options.axis, oc.x, oc.y].every(numeric) || index < 1.3 || index > 2 || Math.abs(sph) > 30 || Math.abs(cyl) > 15) {
      return invalid(['Indeks, resep, axis, atau sentrasi tidak valid untuk model optik.'], profile);
    }
    if (!Array.isArray(contour) || contour.length < 3 || contour.some(p => !Array.isArray(p) || p.length < 2 || !finite(p[0]) || !finite(p[1]))) {
      return invalid(['Kontur lensa belum valid untuk kalkulasi CT/ET.'], profile);
    }
    // Always construct the same physical toric surface after an equivalent
    // plus-/minus-cylinder transposition, rather than swapping torus topology.
    const basePower = cyl > 0 ? sph + cyl : sph;
    const cylinder = cyl > 0 ? -cyl : cyl;
    const axis = ((originalAxis + (cyl > 0 ? 90 : 0)) % 180 + 180) % 180;
    const angle = axis * Math.PI / 180, ca = Math.cos(angle), sa = Math.sin(angle);
    let frontCurvature, curveBasis;
    if (profile.frontRadiusMm !== undefined) {
      frontCurvature = 1 / profile.frontRadiusMm; curveBasis = 'radius-mm';
    } else {
      const basisIndex = profile.frontCurveBasis === 'reference-index' ? profile.curveReferenceIndex : index;
      frontCurvature = profile.frontPowerD / (1000 * (basisIndex - 1)); curveBasis = profile.frontCurveBasis;
    }
    const frontPowerD = 1000 * (index - 1) * frontCurvature;
    const local = (x, y) => {
      const dx = x - Number(oc.x), dy = y - Number(oc.y);
      return { dx, dy, u: dx * ca + dy * sa, v: -dx * sa + dy * ca };
    };
    const frontSag = (x, y) => { const p = local(x, y); return sphericalSag(frontCurvature, p.dx * p.dx + p.dy * p.dy); };
    if (contour.some(p => !finite(frontSag(p[0], p[1])))) return invalid(['Radius depan terlalu kecil untuk kontur/sentrasi ini. Periksa kurva depan dan ukuran frame.'], profile);

    const makeField = center => {
      const denominator = 1 - center / (1000 * index) * frontPowerD;
      if (denominator <= 1e-6) return null;
      const frontEffective = frontPowerD / denominator;
      const cu = (frontEffective - basePower) / (1000 * (index - 1));
      const cv = (frontEffective - basePower - cylinder) / (1000 * (index - 1));
      const field = (x, y) => {
        const p = local(x, y), r2 = p.dx * p.dx + p.dy * p.dy;
        const rf = 1 - frontCurvature * frontCurvature * r2;
        if (rf <= 1e-12) return null;
        const frontRoot = Math.sqrt(rf), sf = frontCurvature * r2 / (1 + frontRoot);
        const rear = toricSurface(cu, cv, p.u, p.v);
        if (!rear) return null;
        return {
          thickness: center + rear.sag - sf, frontSag: sf, backSag: rear.sag,
          dx: rear.du * ca - rear.dv * sa - frontCurvature * p.dx / frontRoot,
          dy: rear.du * sa + rear.dv * ca - frontCurvature * p.dy / frontRoot
        };
      };
      return { field, cu, cv, frontEffective };
    };
    const evaluate = center => {
      const state = makeField(center);
      if (!state) return null;
      const edge = edgeExtrema(state.field, contour);
      return edge ? { ...state, center, edge } : null;
    };
    const satisfies = state => Boolean(state && state.edge.min.value >= profile.minEdgeMm - 1e-9);
    let low = profile.minCenterMm, result = evaluate(low);
    if (!satisfies(result)) {
      // Thickness modifies the rear power, so CT cannot be chosen by adding one
      // thin-lens sag. Solve the monotone CT/edge constraint with the full field.
      let high = low, upper = result;
      for (let iteration = 0; iteration < 120 && !satisfies(upper) && high < 50; iteration++) {
        const deficit = upper ? Math.max(.05, profile.minEdgeMm - upper.edge.min.value) : .5;
        high = Math.min(50, high + Math.max(.25, deficit));
        upper = evaluate(high);
      }
      if (!satisfies(upper)) return invalid(['Kurva dan resep tidak menghasilkan lensa yang memenuhi batas CT/ET pada kontur ini. Periksa profil lab, indeks, sentrasi, dan ukuran frame.'], profile);
      for (let iteration = 0; iteration < 36; iteration++) {
        const midpoint = (low + high) / 2, candidate = evaluate(midpoint);
        if (satisfies(candidate)) { high = midpoint; upper = candidate; }
        else low = midpoint;
      }
      result = upper;
    }
    const { field, cu, cv, frontEffective, center, edge } = result;
    const inside = containsPoint(contour, Number(oc.x), Number(oc.y));
    const centerPoint = { x: Number(oc.x), y: Number(oc.y), value: center };
    // A sphere/torus pair has no isolated interior extremum away from the OC.
    // A coincident principal curve yields a stationary line; it reaches the
    // boundary, whose extrema already include its value.
    const minPoint = inside && center < edge.min.value ? centerPoint : edge.min;
    const maxPoint = inside && center > edge.max.value ? centerPoint : edge.max;
    const warnings = [
      profile.source === 'lab' ? 'Parameter lab dicatat dari referensi pengguna; kesesuaian hasil produksi belum diverifikasi.' : 'Kurva depan dan batas CT/ET masih berupa asumsi; masukkan parameter lab untuk estimasi yang lebih sesuai.',
      'Model single vision dengan permukaan sferis/torik; desain asferik, progresif, prism, dan posisi pakai belum dihitung.'
    ];
    const metrics = {
      centerThicknessMm: inside ? center : null, opticalCenterInside: inside,
      edgeMinMm: edge.min.value, edgeMaxMm: edge.max.value,
      minMm: minPoint.value, maxMm: maxPoint.value,
      minLocation: { ...minPoint }, maxLocation: { ...maxPoint },
      edgeMinLocation: { ...edge.min }, edgeMaxLocation: { ...edge.max }
    };
    const resolved = {
      frontCurveBasis: curveBasis, frontRadiusMm: frontCurvature === 0 ? null : 1 / frontCurvature,
      frontPowerD, backSurfacePowersD: [basePower - frontEffective, basePower + cylinder - frontEffective],
      backRadiiMm: [cu === 0 ? null : 1 / cu, cv === 0 ? null : 1 / cv],
      principalPowersD: [basePower, basePower + cylinder], principalAxisDegrees: axis,
      centerDesignMm: center, minCenterMm: profile.minCenterMm, minEdgeMm: profile.minEdgeMm,
      backVertexPowerResidualD: Math.max(Math.abs(frontEffective - 1000 * (index - 1) * cu - basePower), Math.abs(frontEffective - 1000 * (index - 1) * cv - basePower - cylinder))
    };
    return {
      valid: true, model: MODEL, errors: [], warnings, profile, resolved, metrics,
      productionVerified: false, calibrationStatus: 'unverified',
      manufacturingMode: 'frame-optimized-surfacing',
      measurementAxis: 'model-z-separation',
      frontSag, backSag: (x, y) => field(x, y)?.backSag ?? NaN,
      thickness: (x, y) => field(x, y)?.thickness ?? NaN,
      field
    };
  }

  const api = Object.freeze({ MODEL, DEFAULT_PROFILE, normalizeProfile, sphericalSag, toricSurface, containsPoint, create });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.LensOptics = api;
})(typeof window !== 'undefined' ? window : globalThis);
