/* LensViewer — smooth lens display using LensOptics surface geometry.
 * Calculation follows explicit curve/thickness assumptions, not a production design.
 * Input contour: ordered points, x to the right and y down. Units/extent are normalized.
 * opticalCenters: per-eye offsets from the boxing center in mm, x right and y down.
 * eyeLayout: 'wearer' reflects only the paired display: L on the left, R on the right.
 * Canonical per-eye geometry and optical-center inputs are preserved.
 * Camera angles are in radians. PDF colors are displayed RGB, never VLT measurements.
 * photochromicStrength: optional visual blend 0–1; null preserves ordinary tint.
 */
(function (global) {
  'use strict';

  const LensOptics = global.LensOptics || (typeof require === 'function' ? require('./lens-optics.js') : null);
  if (!LensOptics) throw new Error('Load lens-optics.js before lens-viewer.js.');

  const TAU = Math.PI * 2;
  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
  const number = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const wrap = value => Math.atan2(Math.sin(value), Math.cos(value));
  const presets = {
    front: { yaw: 0, pitch: 0, zoom: 1 },
    back: { yaw: Math.PI, pitch: 0, zoom: 1 },
    side: { yaw: -Math.PI / 2, pitch: 0, zoom: 1.1 },
    perspective: { yaw: -0.62, pitch: 0.12, zoom: 1 }
  };

  function rgb(hex, fallback) {
    if (typeof hex !== 'string') return fallback.slice();
    let value = hex.trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(value)) value = value.split('').map(c => c + c).join('');
    if (!/^[0-9a-f]{6}$/i.test(value)) return fallback.slice();
    return [0, 2, 4].map(i => parseInt(value.slice(i, i + 2), 16));
  }

  function mix(a, b, amount) {
    return a.map((v, i) => v + (b[i] - v) * amount);
  }

  function tintAt(top, middle, bottom, fraction) {
    const t = clamp(fraction, 0, 1);
    if (!middle) return mix(top, bottom, t);
    return t <= 0.5 ? mix(top, middle, t * 2) : mix(middle, bottom, (t - 0.5) * 2);
  }

  function color(value, tone, alpha) {
    const c = value.map(v => Math.round(clamp(v * tone, 0, 255)));
    return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
  }

  function normal(a, b, c) {
    const u = [b.x - a.x, b.y - a.y, b.z - a.z];
    const v = [c.x - a.x, c.y - a.y, c.z - a.z];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const d = Math.hypot(...n) || 1;
    return n.map(x => x / d);
  }

  function defaultContour() {
    return Array.from({ length: 80 }, (_, i) => {
      const a = i * TAU / 80;
      return [Math.sign(Math.cos(a)) * Math.pow(Math.abs(Math.cos(a)), 0.65),
        Math.sign(Math.sin(a)) * Math.pow(Math.abs(Math.sin(a)), 0.65)];
    });
  }

  function arcSample(points, count) {
    const lengths = points.map((p, i) => Math.hypot(p[0] - points[(i + 1) % points.length][0], p[1] - points[(i + 1) % points.length][1]));
    const perimeter = lengths.reduce((a, b) => a + b, 0);
    let segment = 0, accumulated = 0;
    return Array.from({ length: count }, (_, i) => {
      const distance = perimeter * i / count;
      while (segment < points.length - 1 && accumulated + lengths[segment] < distance) accumulated += lengths[segment++];
      const next = (segment + 1) % points.length;
      const f = (distance - accumulated) / (lengths[segment] || 1);
      return [points[segment][0] + (points[next][0] - points[segment][0]) * f,
        points[segment][1] + (points[next][1] - points[segment][1]) * f];
    });
  }

  function fitBounds(points, width, height) {
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    if (maxX - minX < 1e-8 || maxY - minY < 1e-8) return null;
    return points.map(p => [(p[0] - (minX + maxX) / 2) / (maxX - minX) * width,
      (p[1] - (minY + maxY) / 2) / (maxY - minY) * height]);
  }

  function prepareContour(input, width, height, contourMode = 'raster') {
    let points = Array.isArray(input) ? input.filter(p => Array.isArray(p) && p.length >= 2 && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1]))).map(p => [Number(p[0]), Number(p[1])]) : [];
    if (points.length < 3) points = defaultContour();
    if (points.length > 3 && Math.hypot(points[0][0] - points.at(-1)[0], points[0][1] - points.at(-1)[1]) < 1e-9) points.pop();
    points = fitBounds(points, width, height);
    if (!points) return prepareContour(defaultContour(), width, height, contourMode);
    points = points.map(p => [p[0], -p[1]]);
    // Screenshot traces need pixel-noise removal. SVG curves are already smooth:
    // retain their corner proportions with dense controls and no Gaussian blur.
    const vector = contourMode === 'vector';
    let controls = arcSample(points, vector ? 256 : 64);
    const weights = [1, 4, 6, 4, 1];
    for (let pass = 0; pass < (vector ? 0 : 3); pass++) {
      controls = controls.map((_, i) => [0, 1].map(axis => weights.reduce((sum, w, j) => sum + w * controls[(i + j - 2 + controls.length) % controls.length][axis], 0) / 16));
    }
    const dense = [];
    for (let i = 0; i < controls.length; i++) {
      for (let step = 0; step < 8; step++) {
        const t = step / 8, t2 = t * t, t3 = t2 * t;
        const basis = [Math.pow(1 - t, 3) / 6, (3 * t3 - 6 * t2 + 4) / 6,
          (-3 * t3 + 3 * t2 + 3 * t + 1) / 6, t3 / 6];
        dense.push([0, 1].map(axis => basis.reduce((sum, w, j) => sum + w * controls[(i + j - 1 + controls.length) % controls.length][axis], 0)));
      }
    }
    // Renormalize after smoothing: the displayed A and B remain exact.
    const sampled = fitBounds(arcSample(dense, 256), width, height);
    const area = sampled.reduce((sum, p, i) => { const q = sampled[(i + 1) % sampled.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0);
    if (area < 0) sampled.reverse();
    return sampled;
  }

  function makeGeometry(options) {
    const width = clamp(number(options.widthMm, 52), 20, 90);
    const height = clamp(number(options.heightMm, 38), 15, 80);
    const index = clamp(number(options.index, 1.60), 1.45, 1.9);
    const sph = clamp(number(options.sph, -4), -24, 16);
    const cyl = clamp(number(options.cyl, -1), -12, 12);
    const axis = number(options.axis, 180);
    let contour = prepareContour(options.shapePoints, width, height, options.contourMode);
    // Mirror the outline, not the optical cylinder axis convention.
    if (options.mirrorContour) contour = contour.map(p => [-p[0], p[1]]).reverse();
    // The frame-fit API uses source-contour coordinates (y down). Convert once;
    // each eye receives its own already-signed offset, including the mirrored L.
    const opticalCenter = {
      x: number(options.opticalCenter?.x, 0),
      y: -number(options.opticalCenter?.y, 0)
    };
    const count = contour.length, rings = 7;
    const surfacePoints = [[0, 0]];
    for (let ring = 1; ring <= rings; ring++) {
      const f = ring / rings;
      contour.forEach(p => surfacePoints.push([p[0] * f, p[1] * f]));
    }
    let opticalModel = LensOptics.create({ index, sph, cyl, axis, contour, opticalCenter,
      profile: options.opticalProfile || {}, legacyMinimum: options.centerThickness });
    if (opticalModel.valid && surfacePoints.some(([x, y]) => !Number.isFinite(opticalModel.thickness(x, y)))) {
      opticalModel = { ...opticalModel, valid: false, metrics: null,
        errors: ['Permukaan optik tidak dapat mencakup seluruh area frame. Periksa kurva, resep, dan sentrasi.'] };
    }
    // An invalid optical construction has a neutral, flat display placeholder;
    // none of its dummy dimensions are returned as calculated CT/ET.
    const center = opticalModel.valid ? opticalModel.resolved.centerDesignMm : 1.5;
    const front = opticalModel.valid ? (x, y) => center / 2 - opticalModel.frontSag(x, y) : () => center / 2;
    const thickness = opticalModel.valid ? opticalModel.thickness : () => center;
    const displaySurface = (x, y, back = false) => {
      const z = front(x, y) - (back ? thickness(x, y) : 0);
      if (Number.isFinite(z)) return z;
      // Reflections or hardware may extend outside the finite optical aperture.
      // Only that visual extension is pinned to the nearest valid rim point.
      const nearest = contour.reduce((best, p) => !best || Math.hypot(p[0] - x, p[1] - y) < best.distance
        ? { point: p, distance: Math.hypot(p[0] - x, p[1] - y) } : best, null).point;
      return front(nearest[0], nearest[1]) - (back ? thickness(nearest[0], nearest[1]) : 0);
    };
    const vertices = [], faces = [];
    const addSurface = side => {
      const start = vertices.length;
      surfacePoints.forEach(([x, y]) => {
        // Tint remains anchored to the frame's top/bottom, not to the optical center.
        vertices.push({ x, y, z: front(x, y) - (side === 'back' ? thickness(x, y) : 0), g: clamp(0.5 - y / height, 0, 1) });
      });
      const add = ids => faces.push({ ids: side === 'front' ? ids : ids.slice().reverse(), kind: side });
      for (let i = 0; i < count; i++) add([start, start + 1 + i, start + 1 + (i + 1) % count]);
      for (let ring = 1; ring < rings; ring++) {
        const inner = start + 1 + (ring - 1) * count, outer = inner + count;
        for (let i = 0; i < count; i++) {
          const next = (i + 1) % count;
          add([inner + i, outer + i, outer + next]);
          add([inner + i, outer + next, inner + next]);
        }
      }
      return Array.from({ length: count }, (_, i) => start + 1 + (rings - 1) * count + i);
    };
    const frontRim = addSurface('front'), backRim = addSurface('back');
    const sidePanels = [];
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count;
      faces.push({ ids: [frontRim[i], backRim[i], backRim[j]], kind: 'side' });
      faces.push({ ids: [frontRim[i], backRim[j], frontRim[j]], kind: 'side' });
      sidePanels.push({ ids: [frontRim[i], backRim[i], backRim[j], frontRim[j]] });
    }
    const zs = vertices.map(v => v.z), offset = (Math.min(...zs) + Math.max(...zs)) / 2;
    vertices.forEach(v => { v.z -= offset; });
    faces.forEach(face => { face.normal = normal(...face.ids.map(i => vertices[i])); });
    sidePanels.forEach(panel => { panel.normal = normal(...panel.ids.slice(0, 3).map(i => vertices[i])); });
    return { width, height, contour, opticalCenter, vertices, faces, sidePanels, frontRim, backRim, front, thickness, offset, opticalModel, displaySurface };
  }

  function meshThicknessMetrics(mesh, includeLocation = false) {
    if (!mesh?.opticalModel?.valid) return null;
    const result = { ...mesh.opticalModel.metrics };
    if (!includeLocation) {
      delete result.minLocation; delete result.maxLocation;
      delete result.edgeMinLocation; delete result.edgeMaxLocation;
    }
    return result;
  }

  class LensViewer {
    constructor(canvas, options = {}) {
      if (!canvas || typeof canvas.getContext !== 'function') throw new TypeError('LensViewer requires a canvas element.');
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: false });
      if (!this.ctx) throw new Error('Canvas 2D is unavailable.');
      this.options = {
        widthMm: 52, heightMm: 38, sph: -4, cyl: -1, axis: 180, index: 1.60,
        centerThickness: 1.5, opticalProfile: null, opticalProfiles: null,
        colorHex: null, midColorHex: null, bottomColorHex: null,
        kind: 'Solid', visualStrength: 1, photochromicStrength: null, showFrame: false, frameStyle: 'full-rim', showTemples: true, background: '#f4f5f2',
        pairMode: false, eyeLayout: 'observer', bridgeMm: 18, opticalCenters: null, autoRotateSpeed: 0.36,
        showMeasurements: false, measurementsValid: true, contourMode: 'raster',
        ...options
      };
      this.camera = { ...presets.perspective, ...(options.camera || {}) };
      this._sanitizeCamera();
      this._rebuildGeometry();
      this.pointers = new Map();
      this._events = [];
      this._frame = null;
      this._autoRotate = false;
      this._lastFrameTime = null;
      this.destroyed = false;
      this.canvas.style.touchAction = 'none';
      this.canvas.style.cursor = 'grab';
      if (!this.canvas.hasAttribute('tabindex')) this.canvas.setAttribute('tabindex', '0');
      this._bindEvents();
      this._bindEnvironment();
      if (typeof ResizeObserver !== 'undefined') {
        this._observer = new ResizeObserver(() => this._resize());
        this._observer.observe(canvas);
      } else if (typeof global.addEventListener === 'function') {
        this._windowResize = () => this._resize();
        global.addEventListener('resize', this._windowResize);
      }
      this._resize();
    }

    _sanitizeCamera() {
      this.camera.yaw = wrap(number(this.camera.yaw, -0.62));
      this.camera.pitch = wrap(number(this.camera.pitch, 0.12));
      this.camera.zoom = clamp(number(this.camera.zoom, 1), 0.55, 2.6);
    }

    _listen(type, callback, options) {
      this.canvas.addEventListener(type, callback, options);
      this._events.push([type, callback, options]);
    }

    _bindEvents() {
      this._listen('pointerdown', e => {
        if (e.button !== undefined && e.button !== 0) return;
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        this._lastFrameTime = null;
        this.canvas.setPointerCapture?.(e.pointerId);
        this.canvas.style.cursor = 'grabbing';
        e.preventDefault();
      });
      this._listen('pointermove', e => {
        const previous = this.pointers.get(e.pointerId);
        if (!previous) return;
        const next = { x: e.clientX, y: e.clientY };
        if (this.pointers.size === 2) {
          const other = [...this.pointers.entries()].find(([id]) => id !== e.pointerId)?.[1];
          if (other) {
            const before = Math.hypot(previous.x - other.x, previous.y - other.y);
            const after = Math.hypot(next.x - other.x, next.y - other.y);
            if (before > 5) this.camera.zoom *= after / before;
          }
        } else {
          this.camera.yaw += (next.x - previous.x) * 0.009 * this._displayDirection();
          this.camera.pitch += (next.y - previous.y) * 0.008;
        }
        this.pointers.set(e.pointerId, next);
        this._cameraChanged();
        e.preventDefault();
      });
      const release = e => {
        this.pointers.delete(e.pointerId);
        if (this.canvas.hasPointerCapture?.(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
        if (!this.pointers.size) this.canvas.style.cursor = 'grab';
        this._lastFrameTime = null;
        this.requestRender();
      };
      this._listen('pointerup', release);
      this._listen('pointercancel', release);
      this._listen('lostpointercapture', release);
      this._listen('wheel', e => {
        e.preventDefault();
        this.camera.zoom *= Math.exp(-clamp(e.deltaY, -140, 140) * 0.0017);
        this._cameraChanged();
      }, { passive: false });
      this._listen('dblclick', () => this.reset());
      this._listen('keydown', e => {
        let handled = true;
        if (e.key === 'ArrowLeft') this.camera.yaw -= 0.08 * this._displayDirection();
        else if (e.key === 'ArrowRight') this.camera.yaw += 0.08 * this._displayDirection();
        else if (e.key === 'ArrowUp') this.camera.pitch -= 0.08;
        else if (e.key === 'ArrowDown') this.camera.pitch += 0.08;
        else if (e.key === '+' || e.key === '=') this.camera.zoom *= 1.1;
        else if (e.key === '-') this.camera.zoom /= 1.1;
        else if (e.key === 'Home') this.camera = { ...presets.perspective };
        else handled = false;
        if (handled) { e.preventDefault(); this._cameraChanged(); }
      });
    }

    _cameraChanged() {
      this._sanitizeCamera();
      this.requestRender();
      if (typeof this.options.onChange === 'function') this.options.onChange(this.getCamera());
    }

    getCamera() { return { ...this.camera }; }

    getThicknessMetrics() {
      const eyes = { R: meshThicknessMetrics(this.mesh), L: meshThicknessMetrics(this.leftMesh) };
      const present = Object.values(eyes).filter(Boolean);
      const centers = present.map(eye => eye.centerThicknessMm).filter(Number.isFinite);
      const opticalModels = { R: this.mesh?.opticalModel, L: this.leftMesh?.opticalModel };
      const models = Object.values(opticalModels).filter(Boolean);
      const valid = models.every(model => model.valid);
      const optical = Object.fromEntries(Object.entries(opticalModels).map(([eye, model]) => [eye, model ? {
        valid: model.valid, model: model.model, profile: { ...model.profile }, resolved: model.resolved ? { ...model.resolved } : null,
        errors: model.errors.slice(), warnings: model.warnings.slice(), calibrationStatus: model.calibrationStatus,
        manufacturingMode: model.manufacturingMode || 'frame-optimized-surfacing'
      } : null]));
      return {
        unit: 'mm', source: 'spherical-toric-sag-model', model: LensOptics.MODEL, valid,
        productionVerified: false, calibrationStatus: 'unverified',
        measurementAxis: 'model-z-separation',
        minimumThicknessAssumptionMm: models[0]?.profile.minCenterMm ?? 1.5,
        errors: [...new Set(models.flatMap(model => model.errors))],
        warnings: [...new Set(models.flatMap(model => model.warnings))],
        opticalProfiles: optical, eyes,
        pair: valid && present.length ? {
          eyeCount: present.length, centerAvailableEyeCount: centers.length,
          centerMinMm: centers.length ? Math.min(...centers) : null,
          centerMaxMm: centers.length ? Math.max(...centers) : null,
          edgeMinMm: Math.min(...present.map(eye => eye.edgeMinMm)),
          edgeMaxMm: Math.max(...present.map(eye => eye.edgeMaxMm)),
          minMm: Math.min(...present.map(eye => eye.minMm)),
          maxMm: Math.max(...present.map(eye => eye.maxMm))
        } : null
      };
    }

    static smoothContour(points, contourMode = 'raster') {
      return prepareContour(points, 1, 1, contourMode).map(p => [p[0], -p[1]]);
    }

    static screeningContour(points, widthMm = 52, heightMm = 38, contourMode = 'raster') {
      const width = clamp(number(widthMm, 52), 20, 90);
      const height = clamp(number(heightMm, 38), 15, 80);
      // This is the same final outline used by makeGeometry, normalized for the
      // blank-fit engine. Pass original source points to the viewer; feeding this
      // result back into the viewer would apply smoothing a second time.
      return prepareContour(points, width, height, contourMode).map(p => [p[0] / width, -p[1] / height]);
    }

    _rebuildGeometry() {
      const profile = eye => this.options.opticalProfiles?.[eye] || this.options.opticalProfile;
      this.mesh = makeGeometry({ ...this.options, opticalProfile: profile('R'), opticalCenter: this.options.opticalCenters?.R });
      this.leftMesh = this.options.pairMode ? makeGeometry({ ...this.options, opticalProfile: profile('L'), mirrorContour: true, opticalCenter: this.options.opticalCenters?.L }) : null;
    }

    _bindEnvironment() {
      this._document = global.document || null;
      this._visibilityChange = () => {
        this._lastFrameTime = null;
        if (this._isVisible()) this.requestRender();
        else this._cancelFrame();
      };
      this._document?.addEventListener?.('visibilitychange', this._visibilityChange);
      this._motionMedia = typeof global.matchMedia === 'function' ? global.matchMedia('(prefers-reduced-motion: reduce)') : null;
      this._motionChange = () => {
        if (this._motionMedia?.matches) this.setAutoRotate(false);
      };
      if (this._motionMedia?.addEventListener) this._motionMedia.addEventListener('change', this._motionChange);
      else this._motionMedia?.addListener?.(this._motionChange);
    }

    _isVisible() {
      if (this._document?.hidden || this._document?.visibilityState === 'hidden') return false;
      const rect = this.canvas.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    _cancelFrame() {
      if (this._frame !== null && typeof global.cancelAnimationFrame === 'function') global.cancelAnimationFrame(this._frame);
      this._frame = null;
      this._lastFrameTime = null;
    }

    setAutoRotate(enabled) {
      if (this.destroyed) return false;
      const next = Boolean(enabled) && !this._motionMedia?.matches && typeof global.requestAnimationFrame === 'function';
      const changed = next !== this._autoRotate;
      this._autoRotate = next;
      this._lastFrameTime = null;
      if (!next) this._cancelFrame();
      this.requestRender();
      if (changed && typeof this.options.onRotationChange === 'function') this.options.onRotationChange(next);
      return next;
    }

    isAutoRotating() { return this._autoRotate; }

    setOptions(partial = {}) {
      if (this.destroyed) return;
      const geometryKeys = ['shapePoints', 'contourMode', 'widthMm', 'heightMm', 'sph', 'cyl', 'axis', 'index', 'centerThickness', 'pairMode', 'opticalCenters', 'opticalProfile', 'opticalProfiles'];
      const rebuild = geometryKeys.some(key => Object.prototype.hasOwnProperty.call(partial, key) && partial[key] !== this.options[key]);
      this.options = { ...this.options, ...partial };
      if (partial.camera) {
        this.camera = { ...this.camera, ...partial.camera };
        this._sanitizeCamera();
      }
      if (rebuild) this._rebuildGeometry();
      this.requestRender();
    }

    setView(view) {
      if (!presets[view] || this.destroyed) return;
      this.camera = { ...presets[view] };
      this._cameraChanged();
    }

    reset() { this.setView('perspective'); }

    _resize() {
      if (this.destroyed) return;
      const rect = this.canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) { this._cancelFrame(); return; }
      this.width = Math.max(1, Math.round(rect.width || this.canvas.clientWidth || 480));
      this.height = Math.max(1, Math.round(rect.height || this.canvas.clientHeight || 360));
      // Supersampling keeps the outline smooth even on a 1× monitor.
      this.dpr = Math.min(3, Math.max(2, global.devicePixelRatio || 1));
      const width = Math.round(this.width * this.dpr), height = Math.round(this.height * this.dpr);
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
      }
      this.requestRender();
    }

    requestRender() {
      if (this.destroyed || this._frame !== null) return;
      if (!this._isVisible()) { this._lastFrameTime = null; return; }
      if (typeof global.requestAnimationFrame === 'function') {
        this._frame = global.requestAnimationFrame(timestamp => {
          this._frame = null;
          if (this.destroyed || !this._isVisible()) { this._lastFrameTime = null; return; }
          if (this._autoRotate && !this.pointers.size) {
            if (this._lastFrameTime !== null) {
              const elapsed = clamp((timestamp - this._lastFrameTime) / 1000, 0, 0.05);
              this.camera.yaw += elapsed * clamp(number(this.options.autoRotateSpeed, 0.36), 0.05, 2);
              this._sanitizeCamera();
              if (typeof this.options.onChange === 'function') this.options.onChange(this.getCamera());
            }
            this._lastFrameTime = timestamp;
          } else this._lastFrameTime = null;
          this.render();
          if (this._autoRotate && !this.pointers.size) this.requestRender();
        });
      } else this.render();
    }

    _displayDirection() {
      return this.options.pairMode && this.options.eyeLayout === 'wearer' ? -1 : 1;
    }

    _transformation(mesh = this.mesh, offsetX = 0) {
      const displayDirection = this._displayDirection();
      const cy = Math.cos(this.camera.yaw), sy = Math.sin(this.camera.yaw);
      const cp = Math.cos(this.camera.pitch), sp = Math.sin(this.camera.pitch);
      const rotate = (x, y, z) => {
        const a = x * cy + z * sy, b = -x * sy + z * cy;
        return { x: a * displayDirection, y: y * cp - b * sp, z: y * sp + b * cp };
      };
      const bridge = clamp(number(this.options.bridgeMm, 18), 0, 40);
      const sceneWidth = this.options.pairMode ? this.mesh.width * 2 + bridge : this.mesh.width;
      const annotated = this.options.showMeasurements && this.options.pairMode;
      // Reserve a narrow gutter for the vertical dimension and space immediately
      // above/below the lenses. Existing unannotated framing remains unchanged.
      let originX = annotated ? (this.width + 32) / 2 : this.width / 2;
      let originY = annotated ? this.height / 2 - 4 : this.height * (this.options.pairMode ? 0.43 : 0.475);
      let scale = (annotated
        ? Math.min(Math.max(80, this.width - 72) / sceneWidth, Math.max(75, this.height - 132) / mesh.height)
        : Math.min(this.width * (this.options.pairMode ? 0.92 : 0.70) / sceneWidth,
          this.height * (this.options.pairMode ? 0.63 : 0.70) / mesh.height)) * this.camera.zoom;
      if (this.options.showFrame && this._frameLayout) {
        ({ originX, originY, scale } = this._frameLayout);
      }
      const project = point => {
        const p = rotate(point.x, point.y, point.z);
        const perspective = 300 / (300 - p.z);
        // Eye positions stay separate. Rotation acts around each lens's own center.
        return { x: originX + offsetX * scale * displayDirection + p.x * scale * perspective,
          y: originY - p.y * scale * perspective, z: p.z, g: point.g };
      };
      return { rotate, project, scale, originX, originY };
    }

    _path(indices, projected) {
      const ctx = this.ctx;
      ctx.beginPath();
      indices.forEach((id, i) => { const p = projected[id]; if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
      ctx.closePath();
    }

    _frameStyle() {
      return ['full-rim', 'half-rimless', 'rimless'].includes(this.options.frameStyle) ? this.options.frameStyle : 'full-rim';
    }

    _frameEdge(mesh, side, height) {
      const intersections = [];
      for (let i = 0; i < mesh.contour.length; i++) {
        const a = mesh.contour[i], b = mesh.contour[(i + 1) % mesh.contour.length];
        if ((a[1] <= height && b[1] >= height) || (a[1] >= height && b[1] <= height)) {
          const t = Math.abs(b[1] - a[1]) < 1e-9 ? 0 : (height - a[1]) / (b[1] - a[1]);
          intersections.push({ x: a[0] + (b[0] - a[0]) * t, y: height });
        }
      }
      return intersections.reduce((best, point) => !best || side * point.x > side * best.x ? point : best, null) ||
        mesh.contour.map(([x, y]) => ({ x, y })).reduce((best, point) => !best || side * point.x > side * best.x ? point : best, null);
    }

    _makeFrameParts(eyes) {
      const style = this._frameStyle(), parts = [], nasal = [];
      const metal = style !== 'full-rim';
      const add = (kind, eye, points, options = {}) => {
        const part = { kind, eye: eye.eye, style, offsetX: eye.offsetX, points,
          closed: false, widthMm: 1, color: '#344047', highlight: '#aeb8b8', ...options };
        parts.push(part); return part;
      };
      for (const eye of eyes) {
        const mesh = eye.mesh, temporal = eye.eye === 'L' ? 1 : -1, nasalSide = -temporal;
        const surfaceZ = (p, back = false) => mesh.displaySurface(p.x, p.y, back) - mesh.offset;
        const outline = mesh.contour.filter((_, i) => i % 2 === 0).map(([x, y]) => ({ x, y }));
        const shell = (p, back = false, inset = false) => {
          const radius = Math.hypot(p.x, p.y) || 1, outward = inset ? 0 : .55;
          return { x: p.x + p.x / radius * outward, y: p.y + p.y / radius * outward,
            z: surfaceZ(p) + (back ? -2.4 : .65) };
        };
        if (style === 'full-rim') {
          add('rim', eye, outline.map(p => shell(p, true)), { closed: true, section: 'back', widthMm: 1.15, color: '#485057', highlight: '#939e9e' });
          add('rim', eye, outline.map(p => shell(p)), { closed: true, section: 'front', widthMm: 1.5, color: '#283437', highlight: '#a0aaaa' });
        } else if (style === 'half-rimless') {
          const left = outline.reduce((best, p, i) => p.x < outline[best].x ? i : best, 0);
          const right = outline.reduce((best, p, i) => p.x > outline[best].x ? i : best, 0);
          const arc = step => {
            const points = [outline[left]]; let index = left;
            while (index !== right && points.length <= outline.length) {
              index = (index + step + outline.length) % outline.length; points.push(outline[index]);
            }
            return points;
          };
          const arcs = [arc(1), arc(-1)];
          arcs.sort((a, b) => b.reduce((sum, p) => sum + p.y, 0) / b.length - a.reduce((sum, p) => sum + p.y, 0) / a.length);
          add('upper-rim', eye, arcs[0].map(p => shell(p, true)), { section: 'back', widthMm: 1.05, color: '#536167' });
          add('upper-rim', eye, arcs[0].map(p => shell(p)), { section: 'front', widthMm: 1.55, color: '#303d42', highlight: '#b7c2c3' });
          add('nylon', eye, arcs[1].map(p => shell(p, false, true)), { widthMm: .18, color: 'rgba(167,179,181,.48)', highlight: null });
        }

        const hinge = this._frameEdge(mesh, temporal, mesh.height * .18);
        const nose = this._frameEdge(mesh, nasalSide, mesh.height * .12);
        const hingeZ = surfaceZ(hinge), noseZ = surfaceZ(nose);
        const hingeEnd = { x: hinge.x + temporal * 3.2, y: hinge.y, z: hingeZ - 2.4 };
        add('hinge', eye, [{ ...hinge, z: hingeZ + .25 }, hingeEnd], {
          widthMm: style === 'full-rim' ? 2 : 1.25, color: metal ? '#596b73' : '#2a3539', highlight: '#bbc5c7' });
        nasal.push({ eye, point: { ...nose, z: noseZ + .55 } });

        if (style === 'rimless') {
          for (const [position, edge, side] of [['nasal', nose, nasalSide], ['temporal', hinge, temporal]]) {
            for (const back of [false, true]) {
              const z = surfaceZ(edge, back) + (back ? -.35 : .55);
              add('mount', eye, [{ x: edge.x - side * 2.3, y: edge.y, z }, { x: edge.x + side * 1.4, y: edge.y, z }], {
                position, section: back ? 'back' : 'front', widthMm: .9, color: '#586c76', highlight: '#e0e7e6' });
              add('screw', eye, Array.from({ length: 14 }, (_, i) => {
                const angle = i * TAU / 14;
                return { x: edge.x - side * 1.4 + Math.cos(angle) * .56, y: edge.y + Math.sin(angle) * .56, z: z + (back ? -.05 : .05) };
              }), { position, section: back ? 'back' : 'front', closed: true, widthMm: .3, color: '#536872', highlight: null });
            }
          }
        }

        if (style !== 'full-rim') {
          const padCenter = { x: nose.x + nasalSide * 3.6, y: nose.y - 6.2, z: noseZ - 3.8 };
          add('pad-arm', eye, [{ ...nose, z: noseZ - 1 }, { x: padCenter.x, y: padCenter.y + 1.8, z: padCenter.z }], {
            widthMm: .45, color: '#8b9b9c', highlight: '#e0e6e3' });
          add('nose-pad', eye, Array.from({ length: 24 }, (_, i) => {
            const angle = i * TAU / 24;
            return { x: padCenter.x + Math.cos(angle) * 1.5, y: padCenter.y + Math.sin(angle) * 2.8, z: padCenter.z };
          }), { closed: true, widthMm: .35, color: 'rgba(158,176,174,.76)', highlight: null });
        }

        if (this.options.showTemples !== false) {
          // Illustration proportions only: this arm does not assert a temple
          // manufacturing length or change any lens/blank dimensions.
          const length = mesh.width * 1.65;
          const arm = Array.from({ length: 41 }, (_, i) => {
            const t = i / 40, bend = Math.max(0, (t - .72) / .28);
            return { x: hingeEnd.x + temporal * (3.3 * Math.sin(Math.PI * t) - t),
              y: hingeEnd.y - bend * bend * mesh.height * .27, z: hingeEnd.z - length * t };
          });
          add('temple', eye, arm.slice(0, 33), { widthMm: metal ? 1 : 1.7,
            color: metal ? '#61737c' : '#303b3e', highlight: metal ? '#d1d9d8' : '#8a999a' });
          add('ear-tip', eye, arm.slice(30), { widthMm: metal ? 2 : 2.45,
            color: '#354347', highlight: '#849496' });
        }
      }
      if (nasal.length === 2) {
        const [a, b] = nasal;
        const bridge = Array.from({ length: 33 }, (_, i) => {
          const t = i / 32, arch = Math.sin(Math.PI * t);
          return { x: a.point.x * (1 - t) + b.point.x * t,
            y: a.point.y * (1 - t) + b.point.y * t + arch * 3.8,
            z: a.point.z * (1 - t) + b.point.z * t + arch * .6,
            offsetX: a.eye.offsetX * (1 - t) + b.eye.offsetX * t };
        });
        add('bridge', { eye: null, offsetX: 0 }, bridge, {
          widthMm: style === 'full-rim' ? 1.9 : style === 'half-rimless' ? 1.2 : .85,
          color: metal ? '#60737d' : '#2d393d', highlight: metal ? '#d7dfdd' : '#a8b3b3',
          endpointEyes: [a.eye.eye, b.eye.eye] });
      }
      return parts;
    }

    _fitFrameLayout(eyes) {
      const all = [], add = (point, mesh, offsetX) => {
        const transform = this._transformation(mesh, offsetX), projected = transform.project(point);
        all.push({ x: (projected.x - transform.originX) / transform.scale,
          y: (projected.y - transform.originY) / transform.scale });
      };
      for (const eye of eyes) for (const i of [...eye.mesh.frontRim, ...eye.mesh.backRim]) add(eye.mesh.vertices[i], eye.mesh, eye.offsetX);
      for (const part of this._frameParts) {
        const mesh = eyes.find(eye => eye.eye === part.eye)?.mesh || this.mesh;
        for (const p of part.points) add(p, mesh, p.offsetX ?? part.offsetX);
      }
      const bounds = { minX: Math.min(...all.map(p => p.x)), maxX: Math.max(...all.map(p => p.x)),
        minY: Math.min(...all.map(p => p.y)), maxY: Math.max(...all.map(p => p.y)) };
      const annotated = this.options.showMeasurements && this.options.pairMode;
      const left = annotated ? 44 : 18, right = 20, top = annotated ? 60 : 24, bottom = annotated ? 78 : 38;
      const base = this._transformation();
      const fitScale = Math.min(base.scale / this.camera.zoom,
        Math.max(60, this.width - left - right) / Math.max(1, bounds.maxX - bounds.minX),
        Math.max(60, this.height - top - bottom) / Math.max(1, bounds.maxY - bounds.minY));
      const scale = fitScale * this.camera.zoom;
      this._frameLayout = { scale, fitScale, bounds,
        originX: (this.width + left - right) / 2 - (bounds.minX + bounds.maxX) * scale / 2,
        originY: (this.height + top - bottom) / 2 - (bounds.minY + bounds.maxY) * scale / 2 };
    }

    _projectFrameParts(eyes) {
      const runs = [];
      for (const part of this._frameParts) {
        const mesh = eyes.find(eye => eye.eye === part.eye)?.mesh || this.mesh;
        part.screenPoints = part.points.map(point => this._transformation(mesh, point.offsetX ?? part.offsetX).project(point));
        const points = part.closed ? [...part.screenPoints, part.screenPoints[0]] : part.screenPoints;
        let run = null;
        for (let i = 1; i < points.length; i++) {
          const a = points[i - 1], b = points[i], depth = (a.z + b.z) / 2;
          const pass = depth < 0 ? 'far' : 'near';
          if (!run || run.pass !== pass) {
            run = { part, pass, points: [a, b], depth, segmentCount: 1 }; runs.push(run);
          } else {
            run.points.push(b); run.depth += depth; run.segmentCount++;
          }
        }
      }
      for (const run of runs) run.depth /= run.segmentCount;
      this._frameDrawRuns = runs.sort((a, b) => a.depth - b.depth);
    }

    _paintFramePass(pass) {
      const ctx = this.ctx, scale = this._frameLayout.scale;
      ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const run of this._frameDrawRuns) {
        if (run.pass !== pass) continue;
        const part = run.part;
        ctx.beginPath(); run.points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
        ctx.strokeStyle = part.color;
        ctx.lineWidth = Math.max(part.kind === 'nylon' ? .4 : .65, part.widthMm * scale);
        ctx.stroke();
        if (part.highlight && ctx.lineWidth > 1.35) {
          ctx.strokeStyle = part.highlight; ctx.lineWidth = Math.max(.35, part.widthMm * scale * .20); ctx.stroke();
        }
      }
      ctx.restore();
    }

    _paintFrameEyeLabels() {
      const ctx = this.ctx;
      ctx.save(); ctx.font = '600 11px Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const eye of this._renderedEyes) {
        if (!eye.label) continue;
        const x = (eye.bounds.minX + eye.bounds.maxX) / 2, y = clamp(eye.bounds.maxY + 24, 24, this.height - 16);
        const width = ctx.measureText(eye.label).width + 8;
        ctx.fillStyle = 'rgba(248,250,247,.94)'; ctx.fillRect(x - width / 2, y - 8, width, 16);
        ctx.fillStyle = '#65705e'; ctx.fillText(eye.label, x, y);
      }
      ctx.restore();
    }

    _facePaint(points, top, middle, bottom, tone, alpha, gradient) {
      if (!gradient) return color(top, tone, alpha);
      // The affine scalar field maps local lens height to projected triangle height.
      // This makes the tint stay attached to the lens when the camera is rotated.
      const [p, q, r] = points;
      const dx1 = q.x - p.x, dy1 = q.y - p.y, dx2 = r.x - p.x, dy2 = r.y - p.y;
      const determinant = dx1 * dy2 - dx2 * dy1;
      if (Math.abs(determinant) < 0.001) return color(tintAt(top, middle, bottom, (p.g + q.g + r.g) / 3), tone, alpha);
      const a = ((q.g - p.g) * dy2 - (r.g - p.g) * dy1) / determinant;
      const b = (dx1 * (r.g - p.g) - dx2 * (q.g - p.g)) / determinant;
      const n = a * a + b * b;
      if (n < 1e-10) return color(tintAt(top, middle, bottom, p.g), tone, alpha);
      const x0 = p.x - p.g * a / n, y0 = p.y - p.g * b / n;
      const fill = this.ctx.createLinearGradient(x0, y0, x0 + a / n, y0 + b / n);
      fill.addColorStop(0, color(top, tone, alpha));
      if (middle) fill.addColorStop(0.5, color(middle, tone, alpha));
      fill.addColorStop(1, color(bottom, tone, alpha));
      return fill;
    }

    render() {
      if (this.destroyed || !this.width || !this.height) return;
      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.width, this.height);
      const bg = this.options.background || '#f4f5f2';
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, this.width, this.height);
      const wash = ctx.createRadialGradient(this.width * 0.45, this.height * 0.3, 2, this.width * 0.5, this.height * 0.5, Math.max(this.width, this.height) * 0.65);
      wash.addColorStop(0, 'rgba(255,255,255,0.86)');
      wash.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = wash;
      ctx.fillRect(0, 0, this.width, this.height);

      const photochromicStrength = typeof this.options.photochromicStrength === 'number' && Number.isFinite(this.options.photochromicStrength)
        ? clamp(this.options.photochromicStrength, 0, 1) : null;
      const tintAmount = /^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(this.options.colorHex || '') ? (photochromicStrength ?? 1) : 0;
      const tinted = tintAmount > 0;
      const strength = clamp(number(this.options.visualStrength, 1), 0, 1.5);
      const neutral = [224, 234, 236];
      let top = rgb(this.options.colorHex, neutral);
      let bottom = rgb(this.options.bottomColorHex, [246, 248, 248]);
      let middle = /^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(this.options.midColorHex || '') ? rgb(this.options.midColorHex, neutral) : null;
      top = mix(neutral, top, Math.min(strength, 1));
      bottom = mix(neutral, bottom, Math.min(strength, 1));
      if (middle) middle = mix(neutral, middle, Math.min(strength, 1));
      if (strength > 1) {
        top = mix(top, [0, 0, 0], (strength - 1) * 0.3);
        bottom = mix(bottom, [0, 0, 0], (strength - 1) * 0.3);
        if (middle) middle = mix(middle, [0, 0, 0], (strength - 1) * 0.3);
      }
      if (photochromicStrength !== null) {
        // Blend from the same clear material used at zero UV; no abrupt change
        // to solid-tint opacity or colour when the first UV step is applied.
        top = mix(neutral, top, photochromicStrength);
        bottom = mix([246, 248, 248], bottom, photochromicStrength);
        if (middle) middle = mix(neutral, middle, photochromicStrength);
      }
      const gradient = String(this.options.kind).toLowerCase() === 'gradient' && tinted;
      const bridge = clamp(number(this.options.bridgeMm, 18), 0, 40);
      const halfSeparation = (this.mesh.width + bridge) / 2;
      const eyes = this.options.pairMode ? [
        { eye: 'R', label: 'R · Kanan', mesh: this.mesh, offsetX: -halfSeparation },
        { eye: 'L', label: 'L · Kiri', mesh: this.leftMesh, offsetX: halfSeparation }
      ] : [{ eye: null, label: null, mesh: this.mesh, offsetX: 0 }];
      // Reflect the actual eye geometry and its slot together; never exchange labels.
      if (this._displayDirection() < 0) eyes.reverse();
      this._frameLayout = null;
      this._frameParts = [];
      this._frameDrawRuns = [];
      if (this.options.showFrame) {
        this._frameParts = this._makeFrameParts(eyes);
        this._fitFrameLayout(eyes);
        this._projectFrameParts(eyes);
        this._paintFramePass('far');
      }
      this._renderedEyes = [];
      eyes.forEach(eye => this._renderLens(eye, { top, middle, bottom, tinted, gradient, tintAmount }));
      if (this.options.showFrame) {
        this._paintFramePass('near');
        this._paintFrameEyeLabels();
      }
      this._measurementAnnotations = [];
      if (this.options.showMeasurements && this.options.pairMode) this._renderMeasurements(eyes);
    }

    _renderLens(eye, material) {
      const ctx = this.ctx;
      const { mesh, offsetX } = eye;
      const { top, middle, bottom, tinted, gradient, tintAmount } = mesh.opticalModel.valid ? material :
        { top: [228, 233, 234], middle: null, bottom: [245, 247, 247], tinted: false, gradient: false, tintAmount: 0 };
      const { rotate, project, scale, originX } = this._transformation(mesh, offsetX);
      const facing = Math.abs(rotate(0, 0, 1).z);
      const index = clamp(number(this.options.index, 1.6), 1.3, 2);
      const fresnel0 = Math.pow((index - 1) / (index + 1), 2);
      const reflectance = fresnel0 + (1 - fresnel0) * Math.pow(1 - facing, 5);
      // Only perimeter vertices are needed for a seam-free continuous surface.
      const projected = [];
      [...mesh.frontRim, ...mesh.backRim].forEach(id => { projected[id] = project(mesh.vertices[id]); });
      const boundary = projected.filter(Boolean);
      const bounds = {
        minX: Math.min(...boundary.map(p => p.x)), maxX: Math.max(...boundary.map(p => p.x)),
        minY: Math.min(...boundary.map(p => p.y)), maxY: Math.max(...boundary.map(p => p.y))
      };
      const centerX = originX + offsetX * scale * this._displayDirection();
      this._renderedEyes.push({ eye: eye.eye, label: eye.label, centerX, bounds });
      // Each lens has its own shadow, so side views remain visually separate.
      ctx.save();
      ctx.translate(centerX, Math.min(this.height * 0.79, bounds.maxY + 20));
      ctx.scale(1, 0.13);
      const shadowRadius = Math.max(12, (bounds.maxX - bounds.minX) * 0.58);
      const shadow = ctx.createRadialGradient(0, 0, 0, 0, 0, shadowRadius);
      shadow.addColorStop(0, 'rgba(42,62,70,0.11)');
      shadow.addColorStop(0.6, 'rgba(42,62,70,0.035)');
      shadow.addColorStop(1, 'rgba(42,62,76,0)');
      ctx.fillStyle = shadow;
      ctx.beginPath(); ctx.arc(0, 0, shadowRadius, 0, TAU); ctx.fill();
      ctx.restore();
      const sorted = mesh.sidePanels.map(panel => {
        const n = rotate(...panel.normal);
        return { panel, n, depth: panel.ids.reduce((sum, i) => sum + projected[i].z, 0) / 4 };
      }).filter(f => f.n.z > -0.00001).sort((a, b) => a.depth - b.depth);
      sorted.forEach(({ panel, n }) => {
        const points = panel.ids.slice(0, 3).map(i => projected[i]);
        const light = clamp(-n.x * 0.30 + n.y * 0.46 + n.z * 0.75, 0, 1);
        // A polished edge carries a little body colour and broad environment
        // reflection. Its opaque composited paint prevents translucent seams
        // where neighbouring antialiased edge strips meet.
        const edgeBase = [193, 210, 212];
        const edgeMix = .14 + .42 * tintAmount;
        const edgeTop = mix(edgeBase, top, edgeMix);
        const edgeMid = middle ? mix(edgeBase, middle, tinted ? edgeMix : .56) : null;
        const edgeBottom = mix(edgeBase, bottom, edgeMix);
        this._path(panel.ids, projected);
        ctx.fillStyle = this._facePaint(points, edgeTop, edgeMid, edgeBottom, .71 + light * .27, 1, gradient);
        ctx.fill();
        // Subpixel overlap closes antialias gaps between adjacent edge panels.
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = 0.55;
        ctx.stroke();
      });

      const frontFacing = rotate(0, 0, 1).z >= 0;
      const rim = frontFacing ? mesh.frontRim : mesh.backRim;
      const rearRim = frontFacing ? mesh.backRim : mesh.frontRim;
      const surfacePoint = (x, y) => project({
        x, y,
        z: mesh.displaySurface(x, y, !frontFacing) - mesh.offset,
        g: clamp(0.5 - y / mesh.height, 0, 1)
      });
      const references = [surfacePoint(0, 0), surfacePoint(mesh.width * 0.3, 0), surfacePoint(0, mesh.height * 0.3)];
      // Draw the far outline before the near face, which correctly hides occluded
      // rear-edge sections instead of creating a second ragged line on the face.
      this._path(rearRim, projected);
      ctx.strokeStyle = tintAmount === 1 ? 'rgba(75,94,99,0.21)' : tintAmount === 0 ? 'rgba(105,137,143,0.23)' :
        color(mix([105,137,143], [75,94,99], tintAmount), 1, .23 - .02 * tintAmount);
      ctx.lineWidth = 0.6; ctx.stroke();
      // One continuous surface fill avoids seams between rasterized mesh triangles.
      // Its outline and light reflections still use the curved 3D surface geometry.
      this._path(rim, projected);
      const clearAlpha = .16 + Math.min(.19, reflectance * .28);
      const faceAlpha = tintAmount === 1 ? .86 : clearAlpha + (.86 - clearAlpha) * tintAmount;
      ctx.fillStyle = this._facePaint(references, top, middle, bottom, 1, faceAlpha, gradient);
      ctx.fill();
      this._path(rim, projected);
      ctx.strokeStyle = tintAmount === 1 ? 'rgba(54,79,85,0.32)' : tintAmount === 0 ? 'rgba(92,126,132,0.40)' :
        color(mix([92,126,132], [54,79,85], tintAmount), 1, .40 - .08 * tintAmount);
      ctx.lineJoin = 'round';
      ctx.lineWidth = .85; ctx.stroke();

      // Fine reflected edge glints use the physical rim and move with the lens.
      // They are continuous paths, never triangular surface mesh outlines.
      ctx.beginPath();
      let drawing = false;
      for (let i = 0; i <= rim.length; i++) {
        const id = rim[i % rim.length], previous = rim[(i + rim.length - 1) % rim.length];
        const p = projected[id], q = projected[previous];
        const dx = p.x - q.x, dy = p.y - q.y;
        const catchesLight = dx * .8 - dy * .6 > 0 && facing > .08;
        if (catchesLight) { if (!drawing) ctx.moveTo(q.x, q.y); ctx.lineTo(p.x, p.y); }
        drawing = catchesLight;
      }
      ctx.strokeStyle = 'rgba(255,255,255,.69)'; ctx.lineWidth = .55; ctx.lineCap = 'round'; ctx.stroke();

      if (facing > .08) this._reflection(mesh, projected, rim, project, frontFacing, scale, reflectance, tintAmount);
      if (!this.options.showFrame && eye.label && bounds.maxX >= 0 && bounds.minX <= this.width) {
        ctx.save();
        ctx.font = '600 11px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#65705e';
        const labelX = (bounds.minX + bounds.maxX) / 2;
        ctx.fillText(eye.label, labelX, clamp(bounds.maxY + 24, 24, this.height - 16));
        ctx.restore();
      }
    }

    _renderMeasurements(eyes) {
      const ctx = this.ctx;
      const rendered = this._renderedEyes;
      if (rendered.length !== 2) return;
      const left = rendered[0], right = rendered[1];
      const blue = '#397b9d', green = '#488a71', orange = '#b87336';
      const mm = (value, digits = 1) => Number(value).toFixed(digits).replace('.', ',') + ' mm';
      const line = (points, color, dashed = false) => {
        ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 1;
        ctx.setLineDash(dashed ? [2, 3] : []);
        ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.stroke(); ctx.restore();
      };
      const arrow = (a, b, color) => {
        line([a, b], color);
        const angle = Math.atan2(b.y - a.y, b.x - a.x), length = Math.hypot(b.x - a.x, b.y - a.y);
        const size = Math.min(4.5, length / 3);
        if (size < 1.5) return;
        ctx.save(); ctx.fillStyle = color;
        for (const [p, direction] of [[a, angle], [b, angle + Math.PI]]) {
          ctx.beginPath(); ctx.moveTo(p.x, p.y);
          for (const side of [-1, 1]) ctx.lineTo(p.x + Math.cos(direction) * size + Math.cos(direction + Math.PI / 2) * size * .7 * side,
            p.y + Math.sin(direction) * size + Math.sin(direction + Math.PI / 2) * size * .7 * side);
          ctx.closePath(); ctx.fill();
        }
        ctx.restore();
      };
      const label = (kind, title, value, x, y, color, vertical = false) => {
        ctx.save(); ctx.font = '600 11px Arial, sans-serif';
        const textWidth = Math.max(ctx.measureText(title).width, ctx.measureText(value).width) + 10;
        const boxWidth = vertical ? 32 : textWidth, boxHeight = vertical ? textWidth : 32;
        x = clamp(x, boxWidth / 2 + 5, this.width - boxWidth / 2 - 5);
        y = clamp(y, boxHeight / 2 + 5, this.height - boxHeight / 2 - 22);
        const annotation = { kind, title, value, x, y, width: boxWidth, height: boxHeight };
        this._measurementAnnotations.push(annotation);
        ctx.translate(x, y); if (vertical) ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = 'rgba(248,250,247,.94)'; ctx.fillRect(-textWidth / 2, -16, textWidth, 32);
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = color;
        ctx.font = '500 10px Arial, sans-serif'; ctx.fillText(title, 0, -7);
        ctx.font = '600 12px Arial, sans-serif'; ctx.fillText(value, 0, 7);
        ctx.restore();
        return annotation;
      };
      ctx.save();
      // Values are physical frame dimensions, not measurements of screen pixels.
      // The A/B guides follow the projected outline; edge-on views use a leader
      // rather than presenting the small projected extent as a physical width.
      const widthY = clamp(left.bounds.minY - 12, 44, this.height - 55);
      const widthCenter = (left.bounds.minX + left.bounds.maxX) / 2;
      const widthSpan = left.bounds.maxX - left.bounds.minX;
      const frameProjection = this._transformation(eyes[0].mesh, eyes[0].offsetX);
      const widthAxis = [-1, 1].map(sign => frameProjection.project({ x: sign * this.mesh.width / 2, y: 0, z: 0 }));
      const heightAxis = [-1, 1].map(sign => frameProjection.project({ x: 0, y: sign * this.mesh.height / 2, z: 0 }));
      const projectedA = Math.abs(widthAxis[1].x - widthAxis[0].x);
      const projectedB = Math.abs(heightAxis[1].y - heightAxis[0].y);
      const widthDimension = widthSpan >= 24 && projectedA >= 24 && projectedA >= this.mesh.width * frameProjection.scale * .3;
      if (widthDimension) {
        arrow({ x: left.bounds.minX, y: widthY }, { x: left.bounds.maxX, y: widthY }, blue);
        for (const x of [left.bounds.minX, left.bounds.maxX]) line([{ x, y: widthY - 3 }, { x, y: left.bounds.minY - 3 }], blue);
      } else line([{ x: widthCenter, y: widthY }, { x: widthCenter, y: left.bounds.minY - 3 }], blue);
      label('width', 'Lebar A', mm(this.mesh.width), widthCenter, widthY - 23, blue).guideMode = widthDimension ? 'dimension' : 'leader';

      const heightX = clamp(left.bounds.minX - 10, 38, this.width - 45);
      const heightCenter = (left.bounds.minY + left.bounds.maxY) / 2;
      const heightDimension = left.bounds.maxY - left.bounds.minY >= 24 && projectedB >= 24 && projectedB >= this.mesh.height * frameProjection.scale * .3;
      if (heightDimension) {
        arrow({ x: heightX, y: left.bounds.minY }, { x: heightX, y: left.bounds.maxY }, blue);
        for (const y of [left.bounds.minY, left.bounds.maxY]) line([{ x: heightX - 3, y }, { x: left.bounds.minX - 3, y }], blue);
      } else line([{ x: heightX, y: heightCenter }, { x: left.bounds.minX - 3, y: heightCenter }], blue);
      let heightLabelX = heightX - 21, heightLabelY = heightCenter;
      if (this.options.showFrame && this._frameParts.length) {
        // An opaque vertical label must not erase an open temple and make its
        // ear tip appear detached. Prefer a nearby position along the B guide;
        // use the outside hardware margin only when the adjacent places are busy.
        ctx.font = '600 11px Arial, sans-serif';
        const labelHeight = Math.max(ctx.measureText('Tinggi B').width, ctx.measureText(mm(this.mesh.height)).width) + 10;
        const hardware = this._frameParts.flatMap(part => {
          const points = part.closed ? [...part.screenPoints, part.screenPoints[0]] : part.screenPoints;
          return points.slice(1).map((point, i) => [points[i], point]);
        });
        const outsideX = Math.min(...this._frameParts.flatMap(part => part.screenPoints.map(point => point.x))) - 24;
        const positions = [
          [heightLabelX, heightCenter],
          [heightLabelX, left.bounds.maxY - 12],
          [heightLabelX, left.bounds.minY + 12],
          [outsideX, heightCenter]
        ].map(([x, y], order) => {
          x = clamp(x, 21, this.width - 21);
          y = clamp(y, labelHeight / 2 + 5, this.height - labelHeight / 2 - 22);
          const rect = { minX: x - 18, maxX: x + 18, minY: y - labelHeight / 2 - 2, maxY: y + labelHeight / 2 + 2 };
          const collisions = hardware.filter(([a, b]) => Math.max(a.x, b.x) >= rect.minX && Math.min(a.x, b.x) <= rect.maxX &&
            Math.max(a.y, b.y) >= rect.minY && Math.min(a.y, b.y) <= rect.maxY).length;
          const labels = this._measurementAnnotations.filter(box => Math.abs(box.x - x) < box.width / 2 + 18 &&
            Math.abs(box.y - y) < box.height / 2 + labelHeight / 2 + 2).length;
          return { x, y, score: (collisions + labels * 10) * 1000 + order };
        });
        const chosen = positions.reduce((best, current) => current.score < best.score ? current : best);
        heightLabelX = chosen.x; heightLabelY = chosen.y;
      }
      label('height', 'Tinggi B', mm(this.mesh.height), heightLabelX, heightLabelY, blue, true).guideMode = heightDimension ? 'dimension' : 'leader';

      // DBL belongs to the fixed front-view boxing gap. Independently rotating
      // the lenses widens their apparent gap, but must not change this reference.
      const { scale, originX } = this._transformation();
      const bridge = clamp(number(this.options.bridgeMm, 18), 0, 40);
      const bridgeY = clamp(Math.min(left.bounds.minY, right.bounds.minY) + 5, 57, this.height - 55);
      const bridgeHalf = bridge * scale / 2;
      arrow({ x: originX - bridgeHalf, y: bridgeY }, { x: originX + bridgeHalf, y: bridgeY }, green);
      for (const x of [originX - bridgeHalf, originX + bridgeHalf]) line([{ x, y: bridgeY - 3 }, { x, y: bridgeY + 5 }], green);
      label('bridge', 'DBL', mm(bridge), originX, bridgeY - 23, green);

      if (this.options.measurementsValid !== false && eyes.every(eye => eye.mesh.opticalModel.valid)) {
        const candidates = eyes.map(eye => ({ eye, metrics: meshThicknessMetrics(eye.mesh, true) }));
        // Equal maxima prefer the right-hand slot so that the callout stays clear
        // of the height dimension. Different eyes keep their own true maximum.
        const choice = candidates.reduce((best, item) => !best || item.metrics.maxMm >= best.metrics.maxMm - 1e-9 ? item : best, null);
        const actual = rendered.find(item => item.eye === choice.eye.eye);
        const { mesh, offsetX } = choice.eye;
        const { project, rotate } = this._transformation(mesh, offsetX);
        const location = choice.metrics.maxLocation;
        const frontFacing = rotate(0, 0, 1).z >= 0;
        const anchor = project({ x: location.x, y: location.y,
          z: mesh.front(location.x, location.y) - (frontFacing ? 0 : mesh.thickness(location.x, location.y)) - mesh.offset });
        ctx.font = '600 11px Arial, sans-serif';
        const eyeLabelX = (actual.bounds.minX + actual.bounds.maxX) / 2;
        const eyeLabelHalf = ctx.measureText(actual.label || '').width / 2;
        const eyeLabelY = clamp(actual.bounds.maxY + 24, 24, this.height - 16);
        const thicknessText = mm(choice.metrics.maxMm, 2);
        const thicknessHalf = (Math.max(ctx.measureText('Tebal maks.').width, ctx.measureText(thicknessText).width) + 10) / 2;
        const thicknessY = clamp(actual.bounds.maxY + 50, 21, this.height - 38);
        // Tall round/square lenses can use the bottom margin. Move the callout
        // toward the bridge when clamping would cover the eye's R/L label.
        const inward = actual.centerX < this.width / 2 ? 1 : -1;
        const thicknessX = Math.abs(thicknessY - eyeLabelY) < 27
          ? eyeLabelX + inward * (eyeLabelHalf + thicknessHalf + 8) : actual.centerX;
        const box = label('thickness', 'Tebal maks.', thicknessText, thicknessX, thicknessY, orange);
        // Keep the vertical leader outside both text blocks, even when a side
        // silhouette is narrower than its labels. The left lens routes inward
        // to keep its leader away from the vertical B dimension and label.
        const outerX = Math.max(actual.bounds.maxX + 7, box.x + box.width / 2 + 7, eyeLabelX + eyeLabelHalf + 7);
        const elbowX = clamp(outerX, 7, this.width - 7);
        const route = [{ x: box.x + box.width / 2, y: box.y },
          { x: elbowX, y: box.y }, { x: elbowX, y: anchor.y }, anchor];
        line(route, orange);
        box.leaderRoute = route;
        box.eyeLabelBounds = { minX: eyeLabelX - eyeLabelHalf, maxX: eyeLabelX + eyeLabelHalf,
          minY: eyeLabelY - 7, maxY: eyeLabelY + 7 };
        ctx.fillStyle = orange; ctx.beginPath(); ctx.arc(anchor.x, anchor.y, 2.3, 0, TAU); ctx.fill();
        this._measurementAnnotations.at(-1).anchor = { x: anchor.x, y: anchor.y, eye: choice.eye.eye,
          modelX: location.x, modelY: location.y, thicknessMm: choice.metrics.maxMm };

        // CT is measured at each eye's own optical center, not at the boxing
        // center or at the pair maximum. Keep its short callout near that point.
        const centerColor = '#776592';
        const rectFor = item => ({ left: item.x - item.width / 2, right: item.x + item.width / 2,
          top: item.y - item.height / 2, bottom: item.y + item.height / 2 });
        const eyeRects = rendered.map(item => {
          ctx.font = '600 11px Arial, sans-serif';
          const half = ctx.measureText(item.label || '').width / 2;
          const x = (item.bounds.minX + item.bounds.maxX) / 2;
          const y = clamp(item.bounds.maxY + 24, 24, this.height - 16);
          return { left: x - half, right: x + half, top: y - 7, bottom: y + 7 };
        });
        const overlap = (a, b) => Math.max(0, Math.min(a.right + 4, b.right) - Math.max(a.left - 4, b.left)) *
          Math.max(0, Math.min(a.bottom + 4, b.bottom) - Math.max(a.top - 4, b.top));
        const crosses = (r, a, b) => Math.max(a.x, b.x) >= r.left - 3 && Math.min(a.x, b.x) <= r.right + 3 &&
          Math.max(a.y, b.y) >= r.top - 3 && Math.min(a.y, b.y) <= r.bottom + 3;
        for (const item of candidates) {
          if (!item.metrics.opticalCenterInside || !Number.isFinite(item.metrics.centerThicknessMm)) continue;
          const eyeMesh = item.eye.mesh, oc = eyeMesh.opticalCenter;
          const transform = this._transformation(eyeMesh, item.eye.offsetX);
          const facingFront = transform.rotate(0, 0, 1).z >= 0;
          const point = transform.project({ x: oc.x, y: oc.y,
            z: eyeMesh.front(oc.x, oc.y) - (facingFront ? 0 : eyeMesh.thickness(oc.x, oc.y)) - eyeMesh.offset });
          const eyeBounds = rendered.find(entry => entry.eye === item.eye.eye).bounds;
          const title = 'CT · ' + item.eye.eye, value = mm(item.metrics.centerThicknessMm, 2);
          ctx.font = '600 11px Arial, sans-serif';
          const width = Math.max(ctx.measureText(title).width, ctx.measureText(value).width) + 10;
          const side = width / 2 + 13;
          const face = eyeBounds.maxX - eyeBounds.minX >= width + 18 && eyeBounds.maxY - eyeBounds.minY >= 62;
          const offsets = face ? [[0, 28], [0, -28], [side, 0], [-side, 0], [side, 25], [-side, 25], [0, 44], [0, -44]]
            : [[side, 0], [-side, 0], [side, 28], [-side, 28], [0, 35], [0, -35], [side, -28], [-side, -28]];
          const blockers = [...this._measurementAnnotations.map(rectFor), ...eyeRects,
            { left: point.x - 3, right: point.x + 3, top: point.y - 3, bottom: point.y + 3 }];
          const routes = this._measurementAnnotations.flatMap(entry => entry.leaderRoute ? entry.leaderRoute.slice(1).map((p, i) => [entry.leaderRoute[i], p]) : []);
          const placements = offsets.map(([dx, dy], order) => {
            const candidate = { x: clamp(point.x + dx, width / 2 + 5, this.width - width / 2 - 5),
              y: clamp(point.y + dy, 21, this.height - 38), width, height: 32 };
            const rect = rectFor(candidate);
            return { ...candidate, score: blockers.reduce((sum, obstacle) => sum + overlap(rect, obstacle) * 100, 0) +
              routes.filter(([a, b]) => crosses(rect, a, b)).length * 10000 + order * 2 };
          });
          const position = placements.reduce((best, candidate) => !best || candidate.score < best.score ? candidate : best, null);
          const centerBox = label('center', title, value, position.x, position.y, centerColor);
          const dx = point.x - centerBox.x, dy = point.y - centerBox.y;
          const factor = Math.max(Math.abs(dx) / (centerBox.width / 2 + 3), Math.abs(dy) / (centerBox.height / 2 + 3), 1);
          const start = { x: centerBox.x + dx / factor, y: centerBox.y + dy / factor };
          line([start, point], centerColor);
          ctx.fillStyle = centerColor; ctx.beginPath(); ctx.arc(point.x, point.y, 2.1, 0, TAU); ctx.fill();
          centerBox.leaderRoute = [start, { x: point.x, y: point.y }];
          centerBox.anchor = { x: point.x, y: point.y, eye: item.eye.eye,
            modelX: oc.x, modelY: oc.y, thicknessMm: item.metrics.centerThicknessMm };
        }
      }
      ctx.restore();
    }

    _reflection(mesh, projected, rim, project, frontFacing, scale, reflectance = .05, tintAmount = 0) {
      const ctx = this.ctx;
      ctx.save();
      this._path(rim, projected); ctx.clip();
      const surfacePoint = (x, y) => {
        const z = mesh.displaySurface(x, y, !frontFacing) - mesh.offset;
        return project({ x, y, z: z + (frontFacing ? 0.02 : -0.02) });
      };
      // Soft studio-light reflections follow the curved physical surface. Their
      // intensity uses the refractive-index Fresnel trend; no AR coating or
      // measured transmission is implied by this illustrative lighting.
      const sheen = Math.min(.28, .065 + reflectance * .24 + .025 * tintAmount);
      const strip = (topEdge, bottomEdge, alpha) => {
        ctx.beginPath();
        for (let i = 0; i <= 40; i++) {
          const t = i / 40, x = mesh.width * (-.57 + .96 * t);
          const p = surfacePoint(x, mesh.height * (topEdge + .06 * Math.sin(t * Math.PI)));
          if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
        }
        for (let i = 40; i >= 0; i--) {
          const t = i / 40, x = mesh.width * (-.57 + .96 * t);
          const p = surfacePoint(x, mesh.height * (bottomEdge + .045 * Math.sin(t * Math.PI)));
          ctx.lineTo(p.x, p.y);
        }
        ctx.closePath(); ctx.fillStyle = `rgba(255,255,255,${alpha})`; ctx.fill();
      };
      strip(.37, .23, sheen * .45);
      strip(.325, .25, sheen * .6);
      ctx.beginPath();
      for (let i = 0; i <= 32; i++) {
        const t = i / 32;
        const x = -mesh.width * 0.55 + mesh.width * .90 * t;
        const y = mesh.height * (.27 + .05 * Math.sin(t * Math.PI));
        const p = surfacePoint(x, y);
        if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
      }
      ctx.strokeStyle = `rgba(255,255,255,${sheen})`;
      ctx.lineWidth = Math.max(3, mesh.width * scale * .025); ctx.lineCap = 'round'; ctx.stroke();
      ctx.strokeStyle = `rgba(255,255,255,${Math.min(.38, sheen * 1.7)})`;
      ctx.lineWidth = .8; ctx.stroke();

      const p = surfacePoint(-mesh.width * 0.2, mesh.height * 0.02);
      const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, mesh.width * scale * 0.48);
      glow.addColorStop(0, `rgba(255,255,255,${Math.min(.16, .05 + reflectance * .13)})`);
      glow.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = glow; ctx.fillRect(0, 0, this.width, this.height);
      ctx.restore();
    }

    toDataURL(type = 'image/png', quality) {
      this.render();
      return this.canvas.toDataURL(type, quality);
    }

    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      this._autoRotate = false;
      this._cancelFrame();
      this._observer?.disconnect();
      this._document?.removeEventListener?.('visibilitychange', this._visibilityChange);
      if (this._motionMedia?.removeEventListener) this._motionMedia.removeEventListener('change', this._motionChange);
      else this._motionMedia?.removeListener?.(this._motionChange);
      if (this._windowResize) global.removeEventListener('resize', this._windowResize);
      this._events.forEach(([type, callback, options]) => this.canvas.removeEventListener(type, callback, options));
      this._events.length = 0;
      this.pointers.clear();
    }
  }

  global.LensViewer = LensViewer;
  if (typeof module !== 'undefined' && module.exports) module.exports = LensViewer;
})(typeof window !== 'undefined' ? window : globalThis);
