/* Illustrative UV-driven photochromic appearance, shared by preview and validation.
 * The 0–100 scale is a relative visual setting, not UV Index, VLT, UV protection,
 * a measured activation curve, or an activation/fading time for any product.
 */
(function (global) {
  'use strict';
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  function validateExposure(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
      throw Error('Paparan UV simulasi harus berupa angka 0–100.');
    }
    return value;
  }
  function getAppearance(enabled = false, uvExposure = 0) {
    if (typeof enabled !== 'boolean') throw Error('Status TransActiv harus berupa boolean.');
    validateExposure(uvExposure);
    const visualDarknessPercent = enabled ? uvExposure : 0;
    // Neutral gray endpoints chosen for the existing studio renderer. This is
    // only an appearance control; it never changes power, index, CT or ET.
    const channel = Math.round(232 - 176 * visualDarknessPercent / 100);
    const component = channel.toString(16).padStart(2, '0').toUpperCase();
    const colorHex = visualDarknessPercent === 0 ? null : '#' + component.repeat(3);
    return { enabled, uvExposure, visualDarknessPercent, colorHex, simulationOnly: true };
  }
  function validateSnapshot(value, { uvExposure = 0, tint = null, required = false } = {}) {
    validateExposure(uvExposure);
    if (value === undefined && !required) return getAppearance(false, uvExposure);
    if (!object(value) || typeof value.enabled !== 'boolean') throw Error('Pengaturan TransActiv harus memuat status enabled boolean.');
    validateExposure(value.uvExposure);
    if (value.uvExposure !== uvExposure) throw Error('Paparan UV TransActiv harus sama dengan paparan UV bersama pada preview.');
    if (value.simulationOnly !== true) throw Error('Preview TransActiv harus ditandai sebagai simulasi visual.');
    if (value.enabled && tint !== null && tint !== undefined) throw Error('TransActiv aktif tidak dapat digabungkan dengan tinting.');
    const expected = getAppearance(value.enabled, uvExposure);
    if (value.visualDarknessPercent !== undefined && value.visualDarknessPercent !== expected.visualDarknessPercent) {
      throw Error('Tingkat gelap visual TransActiv tidak sesuai dengan paparan UV simulasi.');
    }
    if (value.colorHex !== undefined && value.colorHex !== null && (typeof value.colorHex !== 'string' || !/^#[0-9A-F]{6}$/i.test(value.colorHex))) {
      throw Error('Warna preview TransActiv tidak valid.');
    }
    if (value.colorHex !== undefined && (typeof value.colorHex === 'string' ? value.colorHex.toUpperCase() : value.colorHex) !== expected.colorHex) {
      throw Error('Warna preview TransActiv tidak sesuai dengan paparan UV simulasi.');
    }
    return expected;
  }
  const api = { getAppearance, validateExposure, validateSnapshot };
  global.LeinzPhotochromic = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
