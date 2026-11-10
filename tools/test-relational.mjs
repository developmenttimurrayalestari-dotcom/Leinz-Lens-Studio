import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { encodeDocument, decodeDocument, flattenExtra, inflateExtra, schemaSql, TYPES } from '../server/relational.mjs';

const roundtrip = (scope,key,value) => {
  const plan = encodeDocument(scope,key,value);
  // Simulate SQL atom storage too, not just the in-memory domain mapper.
  for (const record of plan.records) record.extra = inflateExtra(Object.keys(record.extra).length ? flattenExtra(record.extra) : []);
  assert.deepEqual(decodeDocument(scope,key,plan),value);
  return plan;
};
test('all packaged catalog fields, source rows and coordinates survive extraction', async () => {
  for (const key of ['materials','shapes','tints']) {
    const value = JSON.parse(await readFile(new URL(`../dist/assets/${key}.json`,import.meta.url),'utf8'));
    const plan = roundtrip('catalog',key,value);
    if (key === 'materials') {
      assert.equal(plan.records.filter(r => r.type === 'products').length,value.products.length);
      assert.equal(plan.records.filter(r => r.type === 'power_rules').length,value.rules.length);
      assert.equal(plan.records.filter(r => r.type === 'source_rows').length,value.rules.reduce((n,r)=>n+(r.sourceRows?.length||0),0));
    }
    if (key === 'shapes') assert(plan.records.some(r => r.type === 'shape_points'));
  }
});
test('missing, null, empty, false, zero, Unicode, arbitrary metadata and legacy values survive', () => {
  roundtrip('user','state',null);
  roundtrip('user','saved',[]);
  roundtrip('user','state',{active:'a',shape:'001',a:{index:'1.50',productId:'',tintCode:null,note:'',photochromic:false},b:{index:'1.74',productId:'old:missing',tintCode:'retired'},sph:0,uvExposure:0,optics:{useOverride:false,profile:{frontRadiusMm:null}},future:{'arbitrary/key':['Café 👓',{},[],null,false,0]},width:'old value',camera:null});
  roundtrip('user','saved',[{id:'one',title:'Riwayat',createdAt:'2026-11-10T00:00:00+07:00',state:{a:{index:'1.50'},b:{index:'1.74'}},data:{schema:'trl-lens-consultation/1.3',choices:[{index:'1.50',tint:null},{index:'1.74',tint:{code:'retired'}}],frame:{shapeCode:'browline',shapeReference:{contour:[[-.5,.5],[.5,-.5]]}},prescription:{monocularPd:{R:31.1234567890123,L:32}},deep:{empty:[]}}}]);
  roundtrip('workspace','skus',{schema:'trl-sku-catalog/1.0',skus:[{id:'sku1',code:'CAFÉ',name:'Essai',active:true,variants:[{index:'1.50',enabled:false,power:{sphMin:'',sphMax:null,cylMin:-2,cylMax:0,addMin:0,addMax:1},assignments:[]}]}]});
});
test('stable identities survive array reorder and preserve order in reconstructed response', () => {
  const a = {schemaVersion:1,products:[{id:'one',name:'One'},{id:'two',name:'Two'}],blanks:[],rules:[]};
  const first = roundtrip('catalog','materials',a);
  const second = roundtrip('catalog','materials',{...a,products:[...a.products].reverse()});
  for (const record of first.records.filter(r => r.type === 'products')) assert(second.records.some(r => r.nodeId === record.nodeId && r.ordinal !== record.ordinal));
});

test('SKU diameter bounds persist through relational extension values without changing old field masks', () => {
  const value = {schema:'trl-sku-catalog/1.0',skus:[{id:'diameter-sku',code:'DIA',name:'Diameter',active:true,variants:[{index:'1.60',enabled:true,power:{sphMin:-8,sphMax:6,cylMin:-4,cylMax:0,addMin:0,addMax:3,diameterMin:65,diameterMax:75.5},assignments:[]}]}]};
  const plan = roundtrip('workspace','skus',value);
  const power = plan.records.find(r=>r.type==='sku_power');
  assert.equal(power.fieldMask,'222222');
  assert.deepEqual(power.extra,{diameterMin:65,diameterMax:75.5});
});
test('extension atoms preserve dangerous legacy property names without prototype mutation', () => {
  const value = JSON.parse('{"__proto__":{"polluted":true},"constructor":null,"x":[{},[],false]}');
  assert.deepEqual(inflateExtra(flattenExtra(value)),value);
  assert.equal({}.polluted,undefined);
});
test('schema is additive, has domain foreign keys and contains no JSON columns', async () => {
  const base = schemaSql(), extra = schemaSql({powerRangesOnly:true}), sql=base+extra;
  assert.equal(base,await readFile(new URL('../database/003_relational_documents.sql',import.meta.url),'utf8'));
  assert.equal(extra,await readFile(new URL('../database/004_sku_power_ranges.sql',import.meta.url),'utf8'));
  assert(!/\b(?:DROP|TRUNCATE|ALTER)\b/.test(sql));
  assert(!/\bJSON\b/.test(sql));
  assert.match(sql,/REFERENCES leinz_rel_products\(id\)/);
  assert.match(sql,/REFERENCES leinz_rel_blanks\(id\)/);
  for (const type of Object.keys(TYPES)) assert(sql.includes('leinz_rel_'+type));
});

test('multiple SKU diameter/power rows round-trip as separate typed relational records', () => {
  const powerRanges=[{diameter:65,sphMin:-4,sphMax:6,cylMin:-3,cylMax:0,addMin:0,addMax:0},{diameter:70,sphMin:-8,sphMax:2,cylMin:-3,cylMax:0,addMin:0,addMax:0}];
  const plan=roundtrip('workspace','skus',{schema:'trl-sku-catalog/1.0',skus:[{id:'TEST',code:'TEST',name:'TEST',active:true,variants:[{index:'1.50',enabled:true,powerRanges,assignments:[]}]}]});
  const rows=plan.records.filter(r=>r.type==='sku_power_ranges');
  assert.equal(rows.length,2);assert.deepEqual(rows.map(r=>r.fields[0]),[65,70]);
  assert(rows.every(r=>Object.keys(r.extra).length===0));
});
