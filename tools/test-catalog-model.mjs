import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Model = require('../dist/catalog-model.js');
const baseline = Object.fromEntries(['materials','shapes','tints'].map(key=>[key,JSON.parse(readFileSync(new URL(`../dist/assets/${key}.json`,import.meta.url),'utf8'))]));
const clone = value => JSON.parse(JSON.stringify(value));
const fixture = () => clone(baseline);
const valid = (value, context) => {const result=Model.validateCatalogBundle(value,context);assert.equal(result.ok,true,result.errors.join(' '));return result.value;};
const invalid = (value, context) => {const result=Model.validateCatalogBundle(value,context);assert.equal(result.ok,false);assert.equal(result.value,null);return result.errors.join(' ');};
const skuFor = (product,blank) => ({schema:'trl-sku-catalog/1.0',skus:[{id:'qa-sku',code:'QA',variants:[{index:product.index,assignments:[{supplier:product.supplier,productId:product.id,blankIds:[blank.id]}]}]}]});

test('all existing master records validate without changing metadata or catalog-only 1.59',()=>{
  const result=valid(baseline);assert.deepEqual(result,baseline);assert.notEqual(result,baseline);
  assert.deepEqual(Model.summarizeCatalogs(result),{products:19,blanks:186,rules:2026,shapes:13,tints:66,activeProducts:19,activeBlanks:186,activeRules:2026,activeShapes:13,activeTints:66,simulatorProducts:18,indices:['1.50','1.56','1.57','1.59','1.60','1.67','1.74']});
  const catalogOnly=result.materials.products.find(p=>p.index==='1.59');assert(catalogOnly);assert.equal(catalogOnly.activeForSimulator,false);
});

test('a complete new material, blank, power rule, shape and tint can be added atomically',()=>{
  const value=fixture();
  value.materials.products.push({id:'QA:NEW',code:'NEW',name:'Lensa Café 👓',supplier:'QA',index:'1.60',activeForSimulator:true,opticalProfile:{minCenterMm:1.2,minEdgeMm:1.5,frontPowerD:4,frontCurveBasis:'material',source:'assumption',reference:'Uji asumsi, bukan hasil produksi'}});
  value.materials.blanks.push({id:'QA:NEW:80',productId:'QA:NEW',baseCurve:4,diameter:80,ct:8,et:10,active:true});
  value.materials.rules.push({id:'qa-rule',blankId:'QA:NEW:80',sphFrom:-10,sphTo:8,cylFrom:-6,cylTo:0,addFrom:0,addTo:4,sourceRows:[],exactDuplicateCount:0,hasExactDuplicates:false,source:'managed'});
  value.shapes.items.push({code:'qa-square',name:'QA Square',category:'additional',points:[[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]],defaultWidthMm:52,defaultHeightMm:40,contourMode:'vector',active:true});
  value.tints.items.push({code:'QA-TINT',name:'QA Blue',kind:'Gradient',group:'fashion',nominalPercent:null,previewHex:'#123456',previewMidHex:null,previewBottomHex:'#ffffff',referenceStatus:'manual',referenceNote:'Contoh pengguna',active:true});
  valid(value,{previous:baseline});assert.equal(value.materials.products.length,20);
});

test('archives preserve identities and existing SKU assignments',()=>{
  const value=fixture(),product=value.materials.products[0],blank=value.materials.blanks.find(b=>b.productId===product.id);
  const skuCatalog=skuFor(product,blank);
  product.active=false;blank.active=false;value.shapes.items[0].active=false;value.tints.items[0].active=false;
  const result=valid(value,{previous:baseline,skuCatalog});
  assert.equal(Model.active(result.materials.products[0]),false);assert.equal(Model.summarizeCatalogs(result).activeShapes,12);
  assert.equal(product.activeForSimulator,true,'Archiving must not erase the original simulator/index eligibility flag');
});

test('existing master identities cannot disappear through a full-bundle import',()=>{
  for(const [catalog,key]of [['materials','products'],['materials','blanks'],['shapes','items'],['tints','items']]){
    const value=fixture();value[catalog][key].pop();assert.match(invalid(value,{previous:baseline}),/tidak boleh dihapus/);
  }
});

test('SKU-linked product supplier/index and blank parent cannot be reassigned',()=>{
  const original=fixture(),product=original.materials.products[0],blank=original.materials.blanks.find(b=>b.productId===product.id),skuCatalog=skuFor(product,blank);
  for(const mutate of [v=>v.materials.products[0].supplier='Changed',v=>v.materials.products[0].index='1.67',v=>v.materials.products[0].activeForSimulator=false,v=>v.materials.blanks.find(b=>b.id===blank.id).productId=v.materials.products[1].id]){
    const value=fixture();mutate(value);assert.match(invalid(value,{previous:baseline,skuCatalog}),/SKU QA/);
  }
});

test('orphan blanks, orphan rules and duplicate identities are rejected',()=>{
  for(const mutate of [v=>v.materials.blanks[0].productId='missing',v=>v.materials.rules[0].blankId='missing',v=>v.materials.products.push(clone(v.materials.products[0])),v=>v.materials.blanks.push(clone(v.materials.blanks[0])),v=>v.shapes.items.push(clone(v.shapes.items[0])),v=>v.tints.items.push(clone(v.tints.items[0]))]){
    const value=fixture();mutate(value);invalid(value);
  }
});

test('raw dimensions, finite power limits and explicit zero ranges are validated',()=>{
  const zero=fixture();Object.assign(zero.materials.rules[0],{sphFrom:0,sphTo:0,cylFrom:0,cylTo:0,addFrom:0,addTo:0});valid(zero);
  for(const mutate of [v=>v.materials.blanks[0].ct=0,v=>v.materials.blanks[0].diameter=Infinity,v=>v.materials.blanks[0].diameter='75',v=>v.materials.rules[0].sphFrom=40,v=>v.materials.rules[0].cylTo=1,v=>v.materials.rules[0].addFrom=-1]){
    const value=fixture();mutate(value);invalid(value);
  }
});

test('managed rule provenance retains source snapshot without attributing edits to CSV rows',()=>{
  const value=fixture(),rule=value.materials.rules[0],original=clone(rule);
  Object.assign(rule,{sphFrom:-9,sphTo:-8,source:'managed',sourceRows:[],exactDuplicateCount:0,hasExactDuplicates:false,originalSource:original});
  const result=valid(value,{previous:baseline});assert.deepEqual(result.materials.rules[0].originalSource,original);assert.deepEqual(result.materials.rules[0].sourceRows,[]);
  value.materials.rules.pop();valid(value,{previous:baseline});
});

test('shape contours reject self-intersections, duplicate points, degenerate and out-of-range geometry',()=>{
  const invalidContours=[[[0,0],[.5,.5],[-.5,.5],[.5,-.5]],[[0,0],[0,0],[.5,.5],[-.5,.5]],[[0,0],[.1,.1],[.2,.2],[.3,.3]],[[-1,-.5],[.5,-.5],[.5,.5],[-.5,.5]]];
  for(const points of invalidContours){const value=fixture();value.shapes.items[0].points=points;invalid(value);}
  const value=fixture();value.shapes.items.forEach(s=>s.active=false);assert.match(invalid(value),/setidaknya satu/);
  value.shapes.items[0].active=true;value.shapes.items[0].defaultWidthMm=10;invalid(value);
});

test('tints accept explicit manual colors and reject unsafe color, percentage or image references',()=>{
  const manual=fixture();Object.assign(manual.tints.items[0],{previewHex:'#AbCdEF',referenceStatus:'manual',sourceImage:null});valid(manual);
  for(const mutate of [t=>t.previewHex='url(javascript:alert(1))',t=>t.previewMidHex='red',t=>t.nominalPercent=101,t=>t.group='unknown',t=>t.kind='Unknown',t=>t.sourceImage='https://tracking.invalid/pixel.png',t=>t.sourceImage='assets/../secret.png']){
    const value=fixture();mutate(value.tints.items[0]);invalid(value);
  }
});

test('optical profiles validate explicit finished constraints and lab provenance without claiming calibration',()=>{
  const profile={minCenterMm:1.2,minEdgeMm:1.5,frontPowerD:4,frontRadiusMm:150,frontCurveBasis:'reference-index',curveReferenceIndex:1.53,frontConic:0,backConic:0,source:'lab',reference:'Surat parameter lab QA, 2026-11-04'};
  const checked=Model.validateOpticalProfile(profile);assert.equal(checked.ok,true,checked.errors.join(' '));assert.deepEqual(checked.value,profile);
  const value=fixture();value.materials.products[0].opticalProfile=profile;value.materials.blanks[0].opticalProfile={...profile,source:'assumption',reference:''};valid(value);
  assert.equal(Object.hasOwn(checked.value,'productionVerified'),false);
});

test('invalid optical profiles are rejected rather than clamped or silently converted',()=>{
  for(const profile of [null,{minCenterMm:.49},{minEdgeMm:11},{frontPowerD:-1},{frontRadiusMm:0},{frontRadiusMm:5001},{curveReferenceIndex:1.2},{frontCurveBasis:'guess'},{frontConic:-1},{backConic:1},{source:'lab',reference:''},{source:'production'},{minCenterMm:'1.2'}])assert.equal(Model.validateOpticalProfile(profile).ok,false,JSON.stringify(profile));
  assert.equal(Model.validateOpticalProfile({frontRadiusMm:null}).ok,true);
  const value=fixture();value.materials.blanks[0].opticalProfile={frontConic:-1};assert.match(invalid(value),/asferis belum didukung/);
});

test('catalog booleans, schema and unsupported simulator indices cannot be silently coerced',()=>{
  for(const mutate of [v=>v.materials.schemaVersion='1',v=>v.shapes.items[0].active='false',v=>v.tints.items[0].previewCalibrated=1,v=>v.materials.products[0].activeForSimulator=1,v=>v.materials.products.find(p=>p.index==='1.59').activeForSimulator=true]){const value=fixture();mutate(value);invalid(value);}
});

test('prototype keys, non-JSON values and bounded collection limits fail safely',()=>{
  const proto=fixture();proto.extra=JSON.parse('{"__proto__":{"polluted":true}}');invalid(proto);assert.equal({}.polluted,undefined);
  const nan=fixture();nan.extra=NaN;invalid(nan);
  const fn=fixture();fn.extra=()=>true;invalid(fn);
  const over=fixture();over.shapes.items=Array(201).fill(over.shapes.items[0]);assert.match(invalid(over),/batas 200/);
});

test('validation is deterministic, preserves input, and offers the documented throwing alias',()=>{
  const original=JSON.stringify(baseline),a=valid(baseline),b=valid(baseline);assert.deepEqual(a,b);assert.equal(JSON.stringify(baseline),original);
  assert.deepEqual(Model.validateCatalogs(baseline),a);assert.throws(()=>Model.validateCatalogs({}),/Schema/);
  a.materials.products[0].name='Mutated copy';assert.notEqual(baseline.materials.products[0].name,a.materials.products[0].name);
});
