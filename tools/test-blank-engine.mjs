import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Engine = require('../dist/blank-engine.js');
const materials = JSON.parse(readFileSync(new URL('../dist/assets/materials.json', import.meta.url), 'utf8'));
const shapes = JSON.parse(readFileSync(new URL('../dist/assets/shapes.json', import.meta.url), 'utf8'));
const ellipse = Array.from({ length: 128 }, (_, i) => [Math.cos(i * Math.PI / 64) / 2, Math.sin(i * Math.PI / 64) / 2]);
const base = { points: ellipse, width: 52, height: 38, dbl: 18, pdR: 35, pdL: 35, heightR: 19, heightL: 19, allowanceDiameter: 2 };
const frame = extra => Engine.estimateFrame({ ...base, ...extra });
const approx = (actual, expected, tolerance = 1e-7) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} should equal ${expected}`);
const smallFrame = frame({ points: shapes.items[0].points, pdR: 31.5, pdL: 31.5 });
const rx = { sph: -4, cyl: -1, add: 0 };
const evaluate = extra => Engine.evaluate({ materials, index: '1.60', productId: 'SOA:SPHW60', rx, frame: smallFrame, ...extra });

// Boxing dimensions normalize the original contour, preserving all source peaks.
for (const shape of shapes.items) {
  const estimate = frame({ points: shape.points });
  assert.equal(estimate.valid, true, shape.code);
  for (const side of ['R', 'L']) {
    const p = estimate.eyes[side].contour;
    approx(Math.max(...p.map(v => v.x)) - Math.min(...p.map(v => v.x)), 52);
    approx(Math.max(...p.map(v => v.y)) - Math.min(...p.map(v => v.y)), 38);
    assert.ok(Number.isFinite(estimate.eyes[side].requiredDiameter));
  }
  estimate.eyes.R.contour.forEach((p, i) => {
    approx(p.x, -estimate.eyes.L.contour[i].x);
    approx(p.y, estimate.eyes.L.contour[i].y);
  });
  approx(estimate.eyes.R.requiredDiameter, estimate.eyes.L.requiredDiameter);
}

const centered = frame();
assert.equal(centered.valid, true);
approx(centered.framePD, 70);
approx(centered.ed, 52);
approx(centered.eyes.R.opticalCenter.x, 0);
approx(centered.eyes.R.opticalCenter.y, 0);
approx(centered.eyes.R.geometricDiameter, 52);
approx(centered.eyes.R.requiredDiameter, 54);
assert.equal(centered.allowanceDiameter, 2);
approx(frame({ allowanceDiameter: 4 }).eyes.R.requiredDiameter - centered.eyes.R.requiredDiameter, 2);

// ED follows the contour, not the bounding-box diagonal.
const rectangle = frame({ points: [[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]], width: 52, height: 40, heightR: 20, heightL: 20 });
const diamond = frame({ points: [[0,-.5],[.5,0],[0,.5],[-.5,0]], width: 52, height: 40, heightR: 20, heightL: 20 });
approx(rectangle.ed, Math.hypot(52,40));
approx(diamond.ed, 52);
assert.ok(rectangle.ed > diamond.ed + 10);

// Larger boxes, decentration, and fitting height change required cutout diameter.
assert.ok(frame({ width: 62 }).requiredDiameter > centered.requiredDiameter);
assert.ok(frame({ height: 58, heightR: 29, heightL: 29 }).requiredDiameter > centered.requiredDiameter);
const largerBridge = frame({ dbl: 28 });
assert.ok(largerBridge.requiredDiameter > centered.requiredDiameter);
approx(largerBridge.eyes.R.opticalCenter.x, 5);
approx(largerBridge.eyes.L.opticalCenter.x, -5);
const compensatedPD = frame({ dbl: 28, pdR: 40, pdL: 40 });
approx(compensatedPD.requiredDiameter, centered.requiredDiameter);
const asym = frame({ pdR: 30, pdL: 35 });
assert.ok(asym.eyes.R.requiredDiameter > asym.eyes.L.requiredDiameter);
approx(asym.eyes.R.requiredDiameter, 64);
approx(asym.eyes.L.requiredDiameter, 54);
assert.ok(frame({ heightR: 29 }).eyes.R.requiredDiameter > centered.eyes.R.requiredDiameter);

// Existing source fixtures retain exact product identity and all BC alternatives.
const dmo = evaluate({ productId: 'DMO:SPHG60' });
assert.equal(dmo.summary.eligibleBothCount, 1);
assert.deepEqual(dmo.rows.filter(r => r.eligibleBoth).map(r => r.sourceRows), [[45]]);
assert.equal(dmo.rows.find(r => r.eligibleBoth).blank.diameter, 75);
const soa = evaluate();
assert.equal(soa.summary.eligibleBothCount, 4);
assert.deepEqual(soa.rows.filter(r => r.eligibleBoth).map(r => r.sourceRows[0]).sort((a,b) => a-b), [1961,1962,2192,2193]);
assert.equal(soa.summary.minDiameterBoth, 70);
assert.ok(soa.rows.every(r => r.blank.productId === 'SOA:SPHW60'));
assert.equal(soa.rows.length, materials.blanks.filter(b => b.productId === 'SOA:SPHW60').length);
assert.equal(soa.assumptions.baseCurvePriority, 'not-supplied');

// Required73mm excludes70mm but admits real75mm alternatives, with their own CT/ET.
const require73 = frame({ width: 58, height: 40, heightR: 20, heightL: 20, pdR: 31.5, pdL: 31.5 });
approx(require73.requiredDiameter, 73);
const medium = evaluate({ frame: require73 });
assert.equal(medium.summary.minDiameterR, 75);
assert.equal(medium.summary.minDiameterL, 75);
assert.equal(medium.summary.eligibleBothCount, 2);
const rejected70 = medium.rows.filter(r => r.rawPowerMatches && r.blank.diameter === 70);
assert.equal(rejected70.length, 2);
assert.ok(rejected70.every(r => !r.eligibleR && r.reasonsR.includes('blank-too-small-r')));
assert.deepEqual(medium.rows.filter(r => r.eligibleBoth).map(r => [r.blank.ct,r.blank.et]), [[6.5,15],[7,15]]);

// Exact boundary passes; an actual oversize exceeding tolerance is rejected.
const synthetic = {
  summary: { activeIndices: ['1.60'] },
  products: [{ id:'A:P',supplier:'A',code:'P',index:'1.60',activeForSimulator:true }],
  blanks: [{ id:'A:P:75',productId:'A:P',diameter:75,baseCurve:3,ct:8,et:13 }],
  rules: [{ id:'r1',blankId:'A:P:75',sphFrom:-10,sphTo:10,cylFrom:-7,cylTo:0,addFrom:0,addTo:4,sourceRows:[2] }]
};
const exact = frame({ width: 73, height: 40, heightR: 20, heightL: 20, pdR: 45.5, pdL: 45.5 });
approx(exact.requiredDiameter, 75);
const exactEval = Engine.evaluate({ materials:synthetic,index:'1.60',productId:'A:P',rx,frame:exact });
assert.equal(exactEval.summary.eligibleBothCount, 1);
const oversize = frame({ width:73.000002,height:40,heightR:20,heightL:20,pdR:45.500001,pdL:45.500001 });
assert.equal(Engine.evaluate({ materials:synthetic,index:'1.60',productId:'A:P',rx,frame:oversize }).summary.eligibleBothCount, 0);

// No80mm is invented for a75mm-only supplier/product/index.
const p57 = 'DMO:SPHW57';
const blank57 = new Set(materials.blanks.filter(b=>b.productId===p57).map(b=>b.id));
const rule57 = materials.rules.find(r => blank57.has(r.blankId));
const rx57 = {sph:(rule57.sphFrom+rule57.sphTo)/2,cyl:(rule57.cylFrom+rule57.cylTo)/2,add:(rule57.addFrom+rule57.addTo)/2};
const require76 = frame({ width:74,height:40,heightR:20,heightL:20,pdR:46,pdL:46 });
approx(require76.requiredDiameter,76);
const no80 = evaluate({ index:'1.57',productId:p57,rx:rx57,frame:require76 });
assert.ok(no80.summary.rawPowerCount > 0);
assert.deepEqual(no80.summary.availableDiameters,[75]);
assert.equal(no80.summary.minDiameterR,null);
assert.equal(no80.summary.minDiameterL,null);
assert.equal(no80.summary.eligibleBothCount,0);

// Eye-specific cutout failure is retained without discarding the smaller eye's candidates.
const half = evaluate({ frame:frame({width:58,height:40,heightR:20,heightL:20,pdR:28,pdL:38}) });
assert.ok(half.summary.requiredDiameterR > 75);
assert.ok(half.summary.eligibleRCount === 0 && half.summary.eligibleLCount > 0);
assert.equal(half.status,'partial-eye-candidates');

// Finish SKU constraints are an additional gate, never a replacement for raw rules.
const allowedBlank = 'SOA:SPHW60:BC1.00:D75.00';
const variant = {
  index:'1.60',enabled:true,
  power:{sphMin:-8,sphMax:0,cylMin:-4,cylMax:0,addMin:0,addMax:4},
  assignments:[{id:'a1',supplier:'SOA',productId:'SOA:SPHW60',blankIds:[allowedBlank]}]
};
const selected = evaluate({ skuVariant:variant });
assert.equal(selected.valid,true);
assert.equal(selected.skuPowerAllowed,true);
assert.equal(selected.summary.assignedCount,1);
assert.deepEqual(selected.rows.filter(r=>r.eligibleBoth).map(r=>r.blank.id),[allowedBlank]);
assert.equal(selected.summary.minDiameterBoth,75);
const outside = evaluate({ skuVariant:{...variant,power:{...variant.power,sphMax:-5}} });
assert.equal(outside.valid,true);
assert.equal(outside.skuPowerAllowed,false);
assert.equal(outside.summary.eligibleBothCount,0);
assert.ok(outside.rows.every(r=>r.reasons.includes('sku-power-outside')));
const disabled = evaluate({ skuVariant:{...variant,enabled:false} });
assert.equal(disabled.summary.eligibleBothCount,0);
assert.ok(disabled.rows.every(r=>r.reasons.includes('sku-disabled')));
const wrongIndex = evaluate({ skuVariant:{...variant,index:'1.67'} });
assert.equal(wrongIndex.summary.eligibleBothCount,0);
assert.ok(wrongIndex.rows.every(r=>r.reasons.includes('sku-index-mismatch')));
const wrongSupplier = evaluate({ skuVariant:{...variant,assignments:[{...variant.assignments[0],supplier:'DMO'}]} });
assert.equal(wrongSupplier.summary.eligibleBothCount,0);
assert.equal(wrongSupplier.summary.assignedCount,0);
assert.equal(wrongSupplier.warnings.length,1);
const foreignBlank = evaluate({ skuVariant:{...variant,assignments:[{...variant.assignments[0],blankIds:[allowedBlank,'DMO:SPHG60:BC3.00:D75.00']}]} });
assert.equal(foreignBlank.summary.eligibleBothCount,0);
assert.equal(foreignBlank.warnings.length,1);
const rawRejected = evaluate({ skuVariant:variant,rx:{sph:-4,cyl:-6,add:0} });
assert.equal(rawRejected.summary.eligibleBothCount,0);

// Duplicate CSV lines remain provenance, not additional blank candidates.
const duplicateRule = materials.rules.find(r=>r.hasExactDuplicates);
const duplicateBlank = materials.blanks.find(b=>b.id===duplicateRule.blankId);
const duplicateProduct = materials.products.find(p=>p.id===duplicateBlank.productId);
const duplicates = evaluate({
  index:duplicateProduct.index,productId:duplicateProduct.id,
  rx:{sph:(duplicateRule.sphFrom+duplicateRule.sphTo)/2,cyl:duplicateRule.cylFrom,add:duplicateRule.addFrom}
});
const duplicateRow = duplicates.rows.find(r=>r.blank.id===duplicateBlank.id);
assert.ok(duplicateRow.exactDuplicateExtraRows >= duplicateRule.exactDuplicateCount);
assert.ok(duplicateRule.sourceRows.every(row=>duplicateRow.sourceRows.includes(row)));
assert.equal(duplicates.rows.length,new Set(duplicates.rows.map(r=>r.blank.id)).size);
assert.equal(duplicateRow.sourceRows.length,new Set(duplicateRow.sourceRows).size);

// Invalid input must never coerce blanks/booleans to zero or produce eligible candidates.
for (const value of ['',null,undefined,NaN,Infinity,false,[]]) {
  assert.equal(frame({pdR:value}).valid,false,String(value));
  assert.equal(evaluate({rx:{...rx,sph:value}}).summary.eligibleBothCount,0,String(value));
}
for (const bad of [{width:0},{height:-1},{dbl:-1},{pdR:0},{heightR:39},{heightL:-1},{allowanceDiameter:-1},{points:[[0,0],[1,1],[2,2]]},{points:[[0,0],[1,0],[0,NaN]]}]) {
  const f=frame(bad);assert.equal(f.valid,false);assert.equal(evaluate({frame:f}).summary.eligibleBothCount,0);
}
assert.equal(evaluate({rx:{...rx,cyl:1}}).valid,false);
assert.equal(evaluate({rx:{...rx,add:-1}}).valid,false);
assert.equal(evaluate({index:'1.67'}).valid,false);
assert.equal(evaluate({productId:'missing'}).valid,false);
assert.equal(evaluate({skuVariant:{...variant,power:{...variant.power,sphMin:''}}}).valid,false);
assert.equal(Engine.inRange('',0,1),false);
assert.equal(Engine.inRange(-4,-4,0),true);
assert.equal(Engine.inRange(0,-4,0),true);
assert.equal(Engine.inRange(1,2,0),false);

// These functions must not alter the retained catalog or frame source.
const unchanged = JSON.stringify({materials,shape:shapes.items[0]});
Engine.estimateFrame({...base,points:shapes.items[0].points});
evaluate({skuVariant:variant});
assert.equal(JSON.stringify({materials,shape:shapes.items[0]}),unchanged);

console.log('Blank engine checks passed: contour/ED, frame and centration effects, R/L fit, exact boundaries, actual diameters, SKU and raw-power gates, supplier assignments, provenance, and invalid input.');
