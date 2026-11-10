import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {validateDocument} from '../server/validation.mjs';
const require=createRequire(import.meta.url),engine=require('../dist/blank-engine.js'),batch=require('../dist/blank-batch.js');
const powerRanges=[
  {diameter:65,sphMin:-4,sphMax:6,cylMin:-3,cylMax:0,addMin:0,addMax:0},
  {diameter:70,sphMin:-8,sphMax:2,cylMin:-3,cylMax:0,addMin:0,addMax:0}
];
const materials={products:[{id:'TEST:P',supplier:'TEST',code:'P',name:'Fixture',index:'1.50',activeForSimulator:true}],
  blanks:[65,70,75].map(diameter=>({id:'blank-'+diameter,productId:'TEST:P',diameter,baseCurve:4,ct:8,et:12})),
  rules:[65,70,75].map(d=>({id:'rule-'+d,blankId:'blank-'+d,sphFrom:-20,sphTo:20,cylFrom:-7,cylTo:0,addFrom:0,addTo:4}))};
const variant={index:'1.50',enabled:true,powerRanges,assignments:[{id:'assignment-test',supplier:'TEST',productId:'TEST:P',blankIds:materials.blanks.map(b=>b.id)}]};
const frame={valid:true,eyes:{R:{requiredDiameter:50},L:{requiredDiameter:50}}};
const evaluate=(rx,changes={})=>engine.evaluate({materials,index:'1.50',productId:'TEST:P',rx:{cyl:-3,add:0,...rx},frame,skuVariant:variant,...changes});
const candidates=result=>result.rows.filter(r=>r.eligibleBoth).map(r=>r.blank.diameter);

test('user example: each diameter retains its own SPH interval with inclusive limits',()=>{
  const before=JSON.stringify({materials,variant});
  for(const [sph,expected]of [[-8,[70]],[-6,[70]],[-4,[65,70]],[2,[65,70]],[4,[65]],[6,[65]],[-8.01,[]],[6.01,[]]])assert.deepEqual(candidates(evaluate({sph})),expected,'SPH '+sph);
  assert.deepEqual(candidates(evaluate({sph:0,cyl:-3.01})),[]);
  assert.deepEqual(candidates(evaluate({sph:0,cyl:0})),[65,70]);
  assert.equal(JSON.stringify({materials,variant}),before);
  const rejected=evaluate({sph:4}).rows.find(r=>r.blank.diameter===70);
  assert.equal(rejected.skuPowerMatches,false);assert(rejected.reasons.includes('sku-power-diameter-outside'));
});
test('SPH, CYL and ADD cannot be combined across different diameter rows',()=>{
  const skuVariant={...variant,powerRanges:[powerRanges[0],{...powerRanges[1],addMin:2,addMax:3}]};
  assert.deepEqual(candidates(evaluate({sph:4,add:2},{skuVariant})),[]);
  assert.deepEqual(candidates(evaluate({sph:-6,add:2},{skuVariant})),[70]);
  assert.deepEqual(candidates(evaluate({sph:4,add:0},{skuVariant})),[65]);
  assert.deepEqual(candidates(evaluate({sph:4},{frame:{valid:true,eyes:{R:{requiredDiameter:66},L:{requiredDiameter:66}}}})),[]);
});
test('raw power, assignment and per-eye geometry remain independent requirements',()=>{
  const unassigned={...variant,assignments:[{...variant.assignments[0],blankIds:['blank-65']}]};
  assert.deepEqual(candidates(evaluate({sph:-6},{skuVariant:unassigned})),[]);
  const noRaw={...materials,rules:materials.rules.filter(r=>r.blankId!=='blank-70')};
  assert.deepEqual(candidates(evaluate({sph:-6},{materials:noRaw})),[]);
  const asymmetric={valid:true,eyes:{R:{requiredDiameter:68},L:{requiredDiameter:50}}};
  const result=evaluate({sph:4},{frame:asymmetric});
  assert.equal(result.summary.eligibleRCount,0);assert.equal(result.summary.eligibleLCount,1);
});
test('backend SKU validation retains row-wise diameter limits and rejects malformed rows',()=>{
  const value={schema:'trl-sku-catalog/1.0',skus:[{id:'TEST',code:'TEST',name:'TEST',active:true,variants:[variant]}]};
  const saved=validateDocument('skus',value,{materials});
  assert.deepEqual(saved.skus[0].variants[0].powerRanges,powerRanges);
  const invalid=structuredClone(value);invalid.skus[0].variants[0].powerRanges[1].sphMax=-9;
  assert.throws(()=>validateDocument('skus',invalid,{materials}),/minimum SPH/);
  for(const bad of [null,[],[{...powerRanges[0],diameter:''}],[{...powerRanges[0],cylMax:1}]])assert.equal(evaluate({sph:0},{skuVariant:{...variant,powerRanges:bad}}).valid,false);
});
test('batch consultation uses the same coupled diameter/power ranges',()=>{
  const choices=['a','b'].map(key=>({key,index:'1.50',productId:'TEST:P',skuVariant:variant}));
  const results=batch.evaluate([{sph:-6,cyl:-3,add:0},{sph:4,cyl:-3,add:0}],{materials,frame,choices});
  assert.deepEqual(results[0].choices[0].candidates.map(c=>c.blankId),['blank-70']);
  assert.deepEqual(results[1].choices[1].candidates.map(c=>c.blankId),['blank-65']);
});
