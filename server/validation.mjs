import { createRequire } from 'node:module';
import { validationError } from './errors.mjs';
const require = createRequire(import.meta.url);
const { validateCatalog, SCHEMA } = require('../dist/sku-manager.js');
const { validateCatalogBundle, validateOpticalProfile } = require('../dist/catalog-model.js');
const { validateExposure, validateSnapshot } = require('../dist/photochromic.js');
const INDICES = ['1.50', '1.56', '1.57', '1.60', '1.67', '1.74'];
const BOUNDS = {
  width: [35, 70], height: [25, 60], dbl: [10, 28], sph: [-20, 12], cyl: [-7, 0], axis: [0, 180], add: [0, 4],
  pdR: [20, 45], pdL: [20, 45], heightR: [0, 60], heightL: [0, 60], allowanceDiameter: [0, 10],
  pd: [40, 90], fittingHeight: [0, 60]
};
export const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(value);

export function checkJson(value) {
  let nodes = 0;
  function walk(item, depth) {
    if (++nodes > 300000 || depth > 48) throw validationError('Struktur data terlalu besar atau terlalu dalam.');
    if (typeof item === 'number' && !Number.isFinite(item)) throw validationError('Semua angka harus bernilai terbatas.');
    if (item === null || typeof item !== 'object') return;
    for (const key of Object.keys(item)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw validationError('Nama atribut data tidak diizinkan.');
      walk(item[key], depth + 1);
    }
  }
  walk(value, 0);
}

function camera(value, label) {
  if (value === undefined) return;
  if (!isObject(value)) throw validationError(`${label} harus berupa objek.`);
  for (const key of ['yaw', 'pitch', 'zoom']) if (typeof value[key] !== 'number' || !Number.isFinite(value[key])) throw validationError(`${label}.${key} tidak valid.`);
  if (value.zoom < .55 || value.zoom > 2.6 || Math.abs(value.yaw) > 20 || Math.abs(value.pitch) > 20) throw validationError(`${label} berada di luar rentang.`);
}

export function validateState(value, catalogs, { legacy = false } = {}) {
  if (value === null) return null;
  if (!isObject(value)) throw validationError('State simulator harus berupa objek.');
  checkJson(value);
  if (!['a', 'b'].includes(value.active)) throw validationError('Pilihan aktif harus A atau B.');
  if (!catalogs.shapes.items.some(shape => shape.code === value.shape) && !(legacy && value.shape === 'browline')) throw validationError('Bentuk frame tidak tersedia.');
  for (const [key, [min, max]] of Object.entries(BOUNDS)) {
    if (value[key] === undefined && !['width', 'height', 'dbl', 'sph', 'cyl', 'axis', 'add'].includes(key)) continue;
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < min || value[key] > max) throw validationError(`Nilai ${key} harus ${min}–${max}.`);
  }
  for (const key of ['sync', 'showFrame', 'showTemples']) if (value[key] !== undefined && typeof value[key] !== 'boolean') throw validationError(`Nilai ${key} harus berupa boolean.`);
  if (value.uvExposure !== undefined) {
    try { validateExposure(value.uvExposure); } catch (error) { throw validationError(error.message); }
  }
  if (value.frameStyle !== undefined && !['full-rim', 'half-rimless', 'rimless'].includes(value.frameStyle)) throw validationError('Jenis frame tidak valid.');
  if (value.shapeRevision !== undefined && value.shapeRevision !== null && (typeof value.shapeRevision !== 'string' || value.shapeRevision.length > 64)) throw validationError('Revisi bentuk tidak valid.');
  if (value.optics !== undefined) {
    if (!isObject(value.optics) || typeof value.optics.useOverride !== 'boolean') throw validationError('Pengaturan optik harus memuat useOverride boolean.');
    if (value.optics.useOverride || value.optics.profile !== undefined) {
      const checked = validateOpticalProfile(value.optics.profile);
      if (!checked.ok) throw validationError(checked.errors.join(' '));
    }
  }
  camera(value.camera, 'camera');
  for (const key of ['a', 'b']) {
    const slot = value[key];
    if (!isObject(slot) || !INDICES.includes(slot.index)) throw validationError(`Indeks pasangan ${key.toUpperCase()} tidak valid.`);
    if (typeof slot.productId !== 'string' || (slot.productId && !safeId(slot.productId))) throw validationError('ID produk tidak valid.');
    for (const field of ['skuId', 'blankIdR', 'blankIdL']) if (slot[field] !== undefined && slot[field] !== null && !safeId(slot[field])) throw validationError(`${field} tidak valid.`);
    if (slot.photochromic !== undefined && typeof slot.photochromic !== 'boolean') throw validationError('Status TransActiv harus berupa boolean.');
    if (slot.photochromic === true) {
      if (value.uvExposure === undefined) throw validationError('Paparan UV simulasi wajib disimpan untuk TransActiv aktif.');
      if (slot.tintCode !== null) throw validationError('TransActiv aktif tidak dapat digabungkan dengan tinting.');
    }
    if (slot.tintCode !== null && !catalogs.tints.items.some(tint => tint.code === slot.tintCode)) throw validationError('Kode tint tidak tersedia.');
    if (slot.note !== undefined && (typeof slot.note !== 'string' || slot.note.length > 800)) throw validationError('Catatan maksimal 800 karakter.');
    if (slot.customColor !== undefined && (typeof slot.customColor !== 'string' || !/^#[a-f0-9]{6}$/i.test(slot.customColor))) throw validationError('Warna custom tidak valid.');
    camera(slot.camera, `camera.${key}`);
  }
  return JSON.parse(JSON.stringify(value));
}

export function validateSaved(value, catalogs) {
  if (!Array.isArray(value) || value.length > 30) throw validationError('Riwayat harus berupa daftar maksimal 30 konsultasi.');
  checkJson(value);
  const seen = new Set();
  for (const item of value) {
    if (!isObject(item) || !safeId(item.id) || seen.has(item.id)) throw validationError('ID konsultasi tidak valid atau berulang.');
    seen.add(item.id);
    if (typeof item.title !== 'string' || item.title.length > 100 || !item.title.trim()) throw validationError('Nama konsultasi wajib diisi, maksimal 100 karakter.');
    if (typeof item.createdAt !== 'string' || item.createdAt.length > 40 || !Number.isFinite(Date.parse(item.createdAt))) throw validationError('Tanggal konsultasi tidak valid.');
    if (item.state === null) throw validationError('State konsultasi tidak boleh kosong.');
    validateState(item.state, catalogs, { legacy: true });
    if (!isObject(item.data) || !Array.isArray(item.data.choices) || item.data.choices.length !== 2 || item.data.choices.some(choice => !isObject(choice) || !INDICES.includes(choice.index) || (choice.tint !== null && choice.tint !== undefined && !isObject(choice.tint)))) throw validationError('Snapshot konsultasi harus memuat dua pilihan pasangan lensa.');
    const hasPhotochromic = item.data.schema === 'trl-lens-consultation/1.4' || item.data.preview?.uvExposure !== undefined || item.data.choices.some(choice=>choice.photochromic!==undefined);
    if (hasPhotochromic) {
      try {
        const uvExposure = validateExposure(item.data.preview?.uvExposure);
        if (uvExposure !== (item.state.uvExposure ?? 0)) throw Error('Paparan UV pada snapshot tidak sama dengan state konsultasi.');
        for (const key of ['a','b']) {
          const choice = item.data.choices.find(value=>value.choice===key.toUpperCase());
          if (!choice) throw Error('Snapshot TransActiv harus memuat pilihan A dan B.');
          const appearance = validateSnapshot(choice.photochromic,{uvExposure,tint:choice.tint,required:true});
          if (appearance.enabled !== (item.state[key].photochromic === true)) throw Error('Status TransActiv pada snapshot tidak sama dengan state konsultasi.');
        }
      } catch (error) { throw validationError(error.message); }
    } else if (item.state.a.photochromic === true || item.state.b.photochromic === true) {
      throw validationError('Konsultasi TransActiv aktif memerlukan snapshot paparan UV dan status pasangan.');
    }
  }
  return JSON.parse(JSON.stringify(value));
}

export function validateDocument(key, value, catalogs) {
  if (key === 'state') return validateState(value, catalogs);
  if (key === 'saved') return validateSaved(value, catalogs);
  if (key === 'skus') {
    checkJson(value);
    const result = validateCatalog(value, { materials: catalogs.materials, indices: INDICES });
    if (!result.ok) throw validationError(result.errors.slice(0, 10).join(' '));
    return {
      schema: SCHEMA, updatedAt: typeof value.updatedAt === 'string' && value.updatedAt.length <= 40 && Number.isFinite(Date.parse(value.updatedAt)) ? value.updatedAt : new Date().toISOString(),
      sourceFile: catalogs.materials.summary?.sourceFile || null,
      sourceSha256: catalogs.materials.summary?.sourceSha256 || null,
      availabilityMeaning: 'catalog-assignment-not-live-stock', skus: result.skus
    };
  }
  throw validationError('Jenis dokumen tidak dikenal.');
}

export function validateRevision(value) {
  if (!Number.isInteger(value) || value < 0 || value >= 4294967295) throw validationError('Revisi dokumen tidak valid.');
  return value;
}

export function validateMasterCatalogs(value, context = {}) {
  checkJson(value);
  const checked = validateCatalogBundle(value, context);
  if (!checked.ok) throw validationError(checked.errors.slice(0, 10).join(' '));
  return checked.value;
}
