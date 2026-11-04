/* Frame cutout screening for Leinz Lens Studio.
 * This is a circular-blank fit calculation using an illustrative frame contour.
 * It does not validate surfacing volume, prism, base-curve priority, or stock quantity.
 */
(function (global) {
  'use strict';

  const EPSILON = 1e-7;
  const reasonLabels = Object.freeze({
    'invalid-frame': 'Data frame atau sentrasi belum valid.',
    'invalid-power': 'Resep uji belum valid.',
    'unknown-product': 'Produk bahan tidak ditemukan pada katalog.',
    'index-mismatch': 'Indeks produk bahan berbeda dari indeks yang dipilih.',
    'inactive-product': 'Produk bahan tidak diaktifkan pada simulator.',
    'inactive-blank': 'Blank diarsipkan pada master bahan baku.',
    'inactive-index': 'Indeks tidak tersedia pada simulator.',
    'sku-disabled': 'Varian indeks pada SKU tidak aktif.',
    'sku-index-mismatch': 'Varian SKU tidak sesuai indeks yang dipilih.',
    'sku-range-invalid': 'Rentang power finish SKU belum valid.',
    'sku-power-outside': 'Power berada di luar rentang finish SKU.',
    'sku-blank-unassigned': 'Blank belum di-assign ke SKU untuk supplier dan produk ini.',
    'raw-power-outside': 'Power tidak memenuhi aturan rentang bahan baku.',
    'invalid-blank-diameter': 'Diameter blank pada katalog belum valid.',
    'blank-too-small-r': 'Diameter tidak cukup untuk lensa kanan (R).',
    'blank-too-small-l': 'Diameter tidak cukup untuk lensa kiri (L).'
  });

  function numeric(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string' || value.trim() === '') return null;
    const result = Number(value.trim());
    return Number.isFinite(result) ? result : null;
  }

  function indexLabel(value) {
    const n = numeric(value);
    return n !== null && n > 1 ? n.toFixed(2) : null;
  }

  function error(field, code, message) { return { field, code, message }; }
  function unique(values) { return [...new Set(values)]; }
  function sourceRows(rules) {
    return unique(rules.flatMap(rule => Array.isArray(rule.sourceRows) ? rule.sourceRows : [])
      .filter(row => Number.isInteger(row) && row > 0)).sort((a, b) => a - b);
  }

  function inRange(value, lower, upper, tolerance = EPSILON) {
    const x = numeric(value), lo = numeric(lower), hi = numeric(upper);
    return x !== null && lo !== null && hi !== null && lo <= hi &&
      x >= lo - tolerance && x <= hi + tolerance;
  }

  function estimateFrame(input = {}) {
    const errors = [];
    const values = {};
    for (const field of ['width', 'height', 'dbl', 'pdR', 'pdL', 'heightR', 'heightL']) {
      values[field] = numeric(input[field]);
      if (values[field] === null) errors.push(error(field, 'number-required', 'Isi angka yang valid untuk ' + field + '.'));
    }
    values.allowanceDiameter = numeric(input.allowanceDiameter === undefined ? 2 : input.allowanceDiameter);
    if (values.allowanceDiameter === null) errors.push(error('allowanceDiameter', 'number-required', 'Allowance diameter harus berupa angka.'));
    for (const field of ['width', 'height', 'pdR', 'pdL']) {
      if (values[field] !== null && values[field] <= 0) errors.push(error(field, 'must-be-positive', field + ' harus lebih besar dari nol.'));
    }
    for (const field of ['dbl', 'allowanceDiameter']) {
      if (values[field] !== null && values[field] < 0) errors.push(error(field, 'must-be-nonnegative', field + ' tidak boleh negatif.'));
    }
    for (const field of ['heightR', 'heightL']) {
      if (values[field] !== null && values.height !== null && (values[field] < 0 || values[field] > values.height)) {
        errors.push(error(field, 'height-outside-frame', 'Tinggi pusat optik harus berada antara 0 dan tinggi frame B.'));
      }
    }

    const raw = input.points;
    let points = [];
    if (!Array.isArray(raw) || raw.length < 3) {
      errors.push(error('points', 'contour-required', 'Kontur frame memerlukan sedikitnya tiga titik.'));
    } else {
      raw.forEach((point, i) => {
        const x = Array.isArray(point) ? numeric(point[0]) : null;
        const y = Array.isArray(point) ? numeric(point[1]) : null;
        if (x === null || y === null) errors.push(error('points.' + i, 'invalid-point', 'Titik kontur harus berisi dua angka yang valid.'));
        else points.push({ x, y });
      });
      if (points.length > 3 && Math.hypot(points[0].x - points.at(-1).x, points[0].y - points.at(-1).y) < EPSILON) points.pop();
    }
    const result = {
      valid: false, errors, unit: 'mm', ...values,
      coordinateSystem: 'boxing-center; x-right; y-down; R-original; L-mirrored',
      framePD: null, ed: null, eyes: { R: null, L: null }, requiredDiameter: null,
      method: 'twice-maximum-contour-distance-from-optical-center-plus-diameter-allowance',
      notes: [
        'Kontur berasal dari ilustrasi shape; verifikasi dengan tracing frame aktual sebelum produksi.',
        'Allowance ditambahkan pada diameter total, bukan pada radius; nilai awal 2 mm adalah asumsi yang dapat diubah.',
        'Lingkaran blank dianggap berpusat pada pusat optik; prism dan aturan blocking/desain produksi belum dimodelkan.'
      ]
    };
    if (errors.length) return result;
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    if (maxX - minX <= EPSILON || maxY - minY <= EPSILON) {
      errors.push(error('points', 'degenerate-contour', 'Kontur frame tidak memiliki lebar dan tinggi yang valid.'));
      return result;
    }
    const area = points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p.x * q.y - q.x * p.y; }, 0);
    if (!Number.isFinite(area) || Math.abs(area) <= EPSILON) {
      errors.push(error('points', 'degenerate-contour', 'Kontur frame tidak membentuk bidang tertutup yang valid.'));
      return result;
    }
    // Normalize exact boxing dimensions without smoothing away source-contour peaks.
    points = points.map(p => ({
      x: (p.x - (minX + maxX) / 2) / (maxX - minX) * values.width,
      y: (p.y - (minY + maxY) / 2) / (maxY - minY) * values.height
    }));
    result.framePD = values.width + values.dbl;
    result.ed = 2 * Math.max(...points.map(p => Math.hypot(p.x, p.y)));
    for (const side of ['R', 'L']) {
      const contour = points.map(p => ({ x: side === 'R' ? p.x : -p.x, y: p.y }));
      const pd = values['pd' + side], fittingHeight = values['height' + side];
      const opticalCenter = {
        x: side === 'R' ? result.framePD / 2 - pd : pd - result.framePD / 2,
        y: values.height / 2 - fittingHeight
      };
      let radius = -1, farthestPoint = null;
      for (const p of contour) {
        const distance = Math.hypot(p.x - opticalCenter.x, p.y - opticalCenter.y);
        if (distance > radius) { radius = distance; farthestPoint = { ...p }; }
      }
      result.eyes[side] = {
        pd, fittingHeight, opticalCenter, contour, farthestPoint,
        geometricDiameter: 2 * radius,
        requiredDiameter: 2 * radius + values.allowanceDiameter
      };
    }
    result.requiredDiameter = Math.max(result.eyes.R.requiredDiameter, result.eyes.L.requiredDiameter);
    if (![result.framePD, result.ed, result.requiredDiameter].every(Number.isFinite)) {
      errors.push(error('dimensions', 'overflow', 'Dimensi terlalu besar untuk dihitung.'));
      return result;
    }
    result.valid = true;
    return result;
  }

  function evaluate({ materials, index, productId, skuVariant = null, rx = {}, frame } = {}) {
    const errors = [], warnings = [], commonReasons = [];
    const products = Array.isArray(materials?.products) ? materials.products : [];
    const blanks = Array.isArray(materials?.blanks) ? materials.blanks : [];
    const rules = Array.isArray(materials?.rules) ? materials.rules : [];
    if (!Array.isArray(materials?.products) || !Array.isArray(materials?.blanks) || !Array.isArray(materials?.rules)) {
      errors.push(error('materials', 'catalog-required', 'Katalog bahan baku belum tersedia.'));
    }
    const productMap = new Map(products.map(p => [p.id, p]));
    const blankMap = new Map(blanks.map(b => [b.id, b]));
    const product = productMap.get(productId) || null;
    const chosenIndex = indexLabel(index);
    const activeIndices = Array.isArray(materials?.summary?.activeIndices)
      ? materials.summary.activeIndices.map(indexLabel)
      : unique(products.filter(p => p.activeForSimulator !== false).map(p => indexLabel(p.index)));
    if (!chosenIndex || !activeIndices.includes(chosenIndex)) {
      errors.push(error('index', 'inactive-index', reasonLabels['inactive-index'])); commonReasons.push('inactive-index');
    }
    if (!product) {
      errors.push(error('productId', 'unknown-product', reasonLabels['unknown-product'])); commonReasons.push('unknown-product');
    } else {
      if (indexLabel(product.index) !== chosenIndex) {
        errors.push(error('productId', 'index-mismatch', reasonLabels['index-mismatch'])); commonReasons.push('index-mismatch');
      }
      if (product.activeForSimulator === false || product.active === false) {
        errors.push(error('productId', 'inactive-product', reasonLabels['inactive-product'])); commonReasons.push('inactive-product');
      }
    }
    const prescription = { sph: numeric(rx.sph), cyl: numeric(rx.cyl), add: numeric(rx.add) };
    const rxValid = Object.values(prescription).every(v => v !== null) && prescription.cyl <= 0 && prescription.add >= 0;
    if (!rxValid) {
      errors.push(error('rx', 'invalid-power', 'Isi SPH, CYL minus, dan ADD yang valid. ADD tidak boleh negatif.')); commonReasons.push('invalid-power');
    }
    const frameValid = frame?.valid === true && ['R', 'L'].every(side => {
      const d = numeric(frame.eyes?.[side]?.requiredDiameter); return d !== null && d > 0;
    });
    if (!frameValid) {
      errors.push(error('frame', 'invalid-frame', reasonLabels['invalid-frame'])); commonReasons.push('invalid-frame');
    }

    const skuApplied = skuVariant !== null && skuVariant !== undefined;
    let skuPowerAllowed = true;
    const validAssignments = [];
    if (skuApplied) {
      if (skuVariant.enabled !== true) commonReasons.push('sku-disabled');
      if (indexLabel(skuVariant.index) !== chosenIndex) commonReasons.push('sku-index-mismatch');
      const power = skuVariant.power || {};
      const powerValid = ['sph', 'cyl', 'add'].every(k => {
        const lo = numeric(power[k + 'Min']), hi = numeric(power[k + 'Max']);
        return lo !== null && hi !== null && lo <= hi;
      }) && numeric(power.cylMax) <= 0 && numeric(power.addMin) >= 0;
      if (!powerValid) {
        errors.push(error('skuVariant.power', 'sku-range-invalid', reasonLabels['sku-range-invalid']));
        commonReasons.push('sku-range-invalid');
      }
      skuPowerAllowed = powerValid && rxValid && ['sph', 'cyl', 'add'].every(k => inRange(prescription[k], power[k + 'Min'], power[k + 'Max']));
      if (powerValid && rxValid && !skuPowerAllowed) commonReasons.push('sku-power-outside');
      const assignments = Array.isArray(skuVariant.assignments) ? skuVariant.assignments : [];
      assignments.forEach((assignment, i) => {
        const assignedProduct = productMap.get(assignment?.productId);
        const assignedBlanks = assignment?.blankIds;
        const valid = assignedProduct && assignedProduct.supplier === assignment.supplier &&
          indexLabel(assignedProduct.index) === chosenIndex && assignedProduct.activeForSimulator !== false && assignedProduct.active !== false &&
          Array.isArray(assignedBlanks) && assignedBlanks.length > 0 &&
          assignedBlanks.every(id => blankMap.get(id)?.productId === assignedProduct.id);
        if (valid) validAssignments.push(assignment);
        else warnings.push(error('skuVariant.assignments.' + i, 'invalid-assignment', 'Assignment supplier/produk/blank tidak cocok dengan katalog dan tidak digunakan.'));
      });
    }

    const selectedBlanks = blanks.filter(b => b.productId === productId);
    const rulesByBlank = new Map();
    rules.forEach(rule => { if (!rulesByBlank.has(rule.blankId)) rulesByBlank.set(rule.blankId, []); rulesByBlank.get(rule.blankId).push(rule); });
    const contextAllowed = errors.length === 0 && !commonReasons.length;
    const rows = selectedBlanks.map(blank => {
      const allRules = rulesByBlank.get(blank.id) || [];
      const matchingRules = rxValid ? allRules.filter(rule => rule.active !== false &&
        inRange(prescription.sph, rule.sphFrom, rule.sphTo) &&
        inRange(prescription.cyl, rule.cylFrom, rule.cylTo) &&
        inRange(prescription.add, rule.addFrom, rule.addTo)) : [];
      const rawPowerMatches = matchingRules.length > 0;
      const skuAssignmentMatches = !skuApplied || validAssignments.some(a =>
        a.productId === productId && a.supplier === product?.supplier && a.blankIds.includes(blank.id));
      const diameter = numeric(blank.diameter), diameterValid = diameter !== null && diameter > 0;
      const sizeMarginR = frameValid && diameterValid ? diameter - frame.eyes.R.requiredDiameter : null;
      const sizeMarginL = frameValid && diameterValid ? diameter - frame.eyes.L.requiredDiameter : null;
      const fitsR = sizeMarginR !== null ? sizeMarginR >= -EPSILON : null;
      const fitsL = sizeMarginL !== null ? sizeMarginL >= -EPSILON : null;
      const reasons = [...commonReasons];
      if (blank.active === false) reasons.push('inactive-blank');
      if (!skuAssignmentMatches) reasons.push('sku-blank-unassigned');
      if (rxValid && !rawPowerMatches) reasons.push('raw-power-outside');
      if (!diameterValid) reasons.push('invalid-blank-diameter');
      const reasonsR = [...reasons], reasonsL = [...reasons];
      if (fitsR === false) reasonsR.push('blank-too-small-r');
      if (fitsL === false) reasonsL.push('blank-too-small-l');
      const baseEligible = contextAllowed && blank.active !== false && rawPowerMatches && skuAssignmentMatches && skuPowerAllowed && diameterValid;
      return {
        blank: { ...blank }, allSourceRows: sourceRows(allRules), sourceRows: sourceRows(matchingRules),
        matchingRuleIds: unique(matchingRules.map(r => r.id)), ruleCount: allRules.length, matchingRuleCount: matchingRules.length,
        exactDuplicateExtraRows: matchingRules.reduce((sum, r) => sum + Math.max(0, numeric(r.exactDuplicateCount) || 0), 0),
        rawPowerMatches, skuAssignmentMatches, skuPowerMatches: skuPowerAllowed,
        fitsR, fitsL, sizeMarginR, sizeMarginL,
        eligibleR: baseEligible && fitsR === true, eligibleL: baseEligible && fitsL === true,
        eligibleBoth: baseEligible && fitsR === true && fitsL === true,
        reasons: unique([...reasonsR, ...reasonsL]), reasonsR: unique(reasonsR), reasonsL: unique(reasonsL)
      };
    }).sort((a, b) => (numeric(a.blank.diameter) ?? Infinity) - (numeric(b.blank.diameter) ?? Infinity) ||
      (numeric(a.blank.baseCurve) ?? Infinity) - (numeric(b.blank.baseCurve) ?? Infinity) || String(a.blank.id).localeCompare(String(b.blank.id)));
    const diameters = list => unique(list.map(r => numeric(r.blank.diameter)).filter(d => d !== null && d > 0)).sort((a, b) => a - b);
    const forR = rows.filter(r => r.eligibleR), forL = rows.filter(r => r.eligibleL), forBoth = rows.filter(r => r.eligibleBoth);
    const summary = {
      productBlankCount: rows.length,
      assignedCount: rows.filter(r => r.skuAssignmentMatches).length,
      rawPowerCount: rows.filter(r => r.rawPowerMatches).length,
      eligibleRCount: forR.length, eligibleLCount: forL.length, eligibleBothCount: forBoth.length,
      minDiameterR: diameters(forR)[0] ?? null, minDiameterL: diameters(forL)[0] ?? null,
      minDiameterBoth: diameters(forBoth)[0] ?? null,
      availableDiameters: diameters(rows.filter(r=>r.blank.active!==false)), assignedDiameters: diameters(rows.filter(r => r.blank.active!==false && r.skuAssignmentMatches)),
      powerEligibleDiameters: diameters(rows.filter(r => contextAllowed && r.blank.active!==false && r.rawPowerMatches && r.skuAssignmentMatches && r.skuPowerMatches)),
      requiredDiameterR: frameValid ? frame.eyes.R.requiredDiameter : null,
      requiredDiameterL: frameValid ? frame.eyes.L.requiredDiameter : null
    };
    return {
      valid: errors.length === 0, errors, warnings, product: product ? { ...product } : null,
      index: chosenIndex, prescription, skuApplied, skuPowerAllowed, rows, summary,
      status: errors.length ? 'invalid-input' : forBoth.length ? 'candidates-found' : forR.length || forL.length ? 'partial-eye-candidates' : 'no-candidates',
      assumptions: {
        rawRanges: 'inclusive', zeroCylinder: 'literal-zero', quantityAvailability: 'catalog-and-SKU-configuration-only',
        baseCurvePriority: 'not-supplied', surfacingVolume: 'not-verified', finishedThickness: 'not-calculated'
      }
    };
  }

  const api = Object.freeze({ version: '1.0.0', EPSILON, reasonLabels, estimateFrame, evaluate, inRange });
  global.BlankEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
