/* Independent prescription screening against the same A/B frame and SKU setup. */
(function (global) {
  'use strict';
  const engine = global.BlankEngine || (typeof require === 'function' ? require('./blank-engine.js') : null);
  const MAX_ROWS = 20;
  function evaluate(rows, { materials, frame, choices } = {}) {
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > MAX_ROWS) throw Error('Isi 1–20 resep untuk pengujian simultan.');
    if (!Array.isArray(choices) || choices.length !== 2 || choices[0]?.key !== 'a' || choices[1]?.key !== 'b') throw Error('Pengujian memerlukan pilihan A dan B.');
    return rows.map((row, i) => ({
      label: 'Resep ' + (i + 1),
      prescription: { sph: row?.sph, cyl: row?.cyl, add: row?.add },
      choices: choices.map(choice => {
        const result = engine.evaluate({ materials, frame, index: choice.index, productId: choice.productId, skuVariant: choice.skuVariant, rx: row || {} });
        const eligible = result.rows.filter(candidate => candidate.eligibleR || candidate.eligibleL);
        return {
          key: choice.key, index: choice.index, productId: choice.productId,
          valid: result.valid, errors: result.errors, summary: result.summary,
          status: result.valid && result.summary.eligibleRCount > 0 && result.summary.eligibleLCount > 0 ? 'lolos' : result.valid ? 'belum-lolos' : 'input-tidak-valid',
          candidates: eligible.map(candidate => ({
            blankId: candidate.blank.id, diameter: candidate.blank.diameter,
            baseCurve: candidate.blank.baseCurve, eligibleR: candidate.eligibleR, eligibleL: candidate.eligibleL,
            matchingRuleIds: [...candidate.matchingRuleIds], sourceRows: [...candidate.sourceRows]
          })),
          reasons: [...new Set(result.rows.flatMap(candidate => [...candidate.reasonsR, ...candidate.reasonsL]))]
        };
      })
    }));
  }
  const api = Object.freeze({ evaluate, MAX_ROWS });
  global.LeinzBlankBatch = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
