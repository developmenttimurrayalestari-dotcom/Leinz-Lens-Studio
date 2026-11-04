import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {MasterUiModel:ui,LeinzMasterManager}=require('../dist/master-manager.js');
const model=require('../dist/catalog-model.js');
const source=Object.fromEntries(['materials','shapes','tints'].map(name=>[name,JSON.parse(fs.readFileSync(new URL('../dist/assets/'+name+'.json',import.meta.url),'utf8'))]));
const copy=()=>structuredClone(source);
const validate=(value,previous=source)=>model.validateCatalogBundle(value,{previous});
const itemKey=(type)=>type==='shapes'||type==='tints'?'code':'id';

test('material edits retain catalog-only status, existing availability and source catalogs',()=>{
  const current=copy(),before=JSON.stringify(current),d=ui.makeDraft('product',null,current);
  Object.assign(d.values,{code:'QA-MATERIAL',name:'QA material',supplier:'QA',index:'1.59',active:true});
  const next=ui.buildCandidate(current,d);
  assert.equal(JSON.stringify(current),before);
  assert.equal(next.materials.products.length,current.materials.products.length+1);
  assert.equal(next.materials.products.at(-1).activeForSimulator,false);
  assert.equal(next.materials.products.at(-1).active,true);
  assert.deepEqual(next.materials.products.slice(0,-1),current.materials.products);
  assert.deepEqual(next.materials.blanks,current.materials.blanks);
  assert.deepEqual(next.shapes,current.shapes);
  assert.deepEqual(next.tints,current.tints);
  assert.equal(validate(next,current).ok,true);
  const existing=current.materials.products.find(p=>p.index==='1.60');
  existing.activeForSimulator=false;
  const edit=ui.makeDraft('product',existing,current);edit.values.name='Updated catalog-only material';
  const edited=ui.buildCandidate(current,edit).materials.products.find(p=>p.id===existing.id);
  assert.equal(edited.activeForSimulator,false);
  assert.equal(edited.index,existing.index);
  assert.equal(edited.id,existing.id);
});

test('raw blank edits keep identity and independent finishing profile without rewriting rules',()=>{
  const current=copy(),record=current.materials.blanks[0],d=ui.makeDraft('blank',record,current);
  d.values.ct='8.25';d.profile.enabled=true;d.profile.minCenterMm='1.25';d.profile.minEdgeMm='1.4';
  const next=ui.buildCandidate(current,d),b=next.materials.blanks.find(b=>b.id===record.id);
  assert.equal(b.id,record.id);assert.equal(b.ct,8.25);assert.equal(b.et,record.et);
  assert.equal(b.opticalProfile.minCenterMm,1.25);assert.equal(b.opticalProfile.minEdgeMm,1.4);
  assert.equal(b.originalSource.ct,record.ct);
  assert.deepEqual(next.materials.rules,current.materials.rules);
  assert.equal(validate(next,current).ok,true);
});

test('edited rule preserves historical provenance separately and keeps exact zero ranges',()=>{
  const current=copy(),blank=current.materials.blanks[0],d=ui.makeDraft('blank',blank,current);
  const prior=d.rules[0];d.rules[0]={...prior,sphFrom:'-9',sphTo:'-8',cylFrom:'0',cylTo:'0',addFrom:'0',addTo:'4'};
  const next=ui.buildCandidate(current,d),r=next.materials.rules.find(r=>r.id===prior.id);
  assert.deepEqual(r.originalSource.sourceRows,prior.sourceRows);
  assert.deepEqual(r.sourceRows,[]);assert.equal(r.source,'managed');
  assert.equal(r.cylFrom,0);assert.equal(r.cylTo,0);
  assert.equal(r.hasExactDuplicates,false);assert.equal(r.exactDuplicateCount,0);
  assert.deepEqual(next.materials.rules.filter(r=>r.id!==prior.id),current.materials.rules.filter(r=>r.id!==prior.id));
  assert.equal(validate(next,current).ok,true);
});

test('copied blank assigns fresh identities to every copied rule',()=>{
  const current=copy(),record=current.materials.blanks[0],d=ui.makeDraft('blank',record,current,{duplicate:true});
  assert.notEqual(d.record.id,record.id);
  const originalIds=new Set(current.materials.rules.map(r=>r.id));
  assert.ok(d.rules.every(r=>!originalIds.has(r.id)&&r.blankId===d.record.id));
  d.values.diameter='80';
  const next=ui.buildCandidate(current,d);
  assert.equal(next.materials.blanks.length,current.materials.blanks.length+1);
  assert.equal(validate(next,current).ok,true);
});

test('radius profile has an unambiguous surface input and requires a source for lab values',()=>{
  const p=ui.profileDraft({});
  p.enabled=true;p.measure='radius';p.frontRadiusMm='125';p.source='lab';p.reference='Lab surface record A';
  const result=ui.collectProfile(p);
  assert.equal(result.frontRadiusMm,125);
  assert.equal(Object.hasOwn(result,'frontPowerD'),false);
  assert.equal(result.frontConic,0);assert.equal(result.backConic,0);
  assert.equal(model.validateOpticalProfile(result).ok,true);
  result.reference='';
  assert.equal(model.validateOpticalProfile(result).ok,false);
  result.reference='Lab';result.frontConic=-1;
  assert.equal(model.validateOpticalProfile(result).ok,false);
});

test('editing shape labels or defaults does not regenerate its original contour or source metadata',()=>{
  const current=copy(),record=current.shapes.items.find(s=>s.code==='cat-eye'),d=ui.makeDraft('shape',record,current);
  d.values.name='Cat-eye acuan lab';d.values.defaultWidthMm='55';
  const next=ui.buildCandidate(current,d),s=next.shapes.items.find(s=>s.code===record.code);
  assert.deepEqual(s.points,record.points);
  assert.equal(s.sourceSha256,record.sourceSha256);
  assert.equal(s.sourcePathData,record.sourcePathData);
  assert.equal(s.source,record.source);
  assert.equal(s.defaultWidthMm,55);
  assert.equal(validate(next,current).ok,true);
});

test('generated shape presets are normalized simple closed contours',()=>{
  for(const kind of ['ellipse','rounded-rectangle']){
    const points=ui.generatedPoints(kind);
    assert.equal(points.length,128);
    assert.equal(model.contourProblem(points),'');
    for(const axis of [0,1]){
      assert.equal(Math.min(...points.map(p=>p[axis])),-.5);
      assert.equal(Math.max(...points.map(p=>p[axis])),.5);
    }
  }
});

test('custom contour is labeled managed and invalid crossings cannot pass validation',()=>{
  const current=copy(),d=ui.makeDraft('shape',null,current);
  Object.assign(d.values,{code:'QA-CUSTOM-SHAPE',name:'QA custom'});
  d.contourMode='points';d.pointsText=JSON.stringify([[-.5,0],[0,-.5],[.5,0],[0,.5]]);
  let next=ui.buildCandidate(current,d),shape=next.shapes.items.at(-1);
  assert.equal(shape.source,'managed');assert.equal(shape.contourMode,'vector');assert.equal(shape.synthetic,false);
  assert.equal(validate(next,current).ok,true);
  d.pointsText=JSON.stringify([[-.5,-.5],[.5,.5],[-.5,.5],[.5,-.5]]);
  next=ui.buildCandidate(current,d);
  assert.equal(validate(next,current).ok,false);
  d.pointsText='not JSON';
  assert.throws(()=>ui.buildCandidate(current,d),/JSON/);
  assert.equal(current.shapes.items.length,source.shapes.items.length);
});

test('copying a raster contour preserves its smoothing mode while using a new code',()=>{
  const current=copy(),d=ui.makeDraft('shape',current.shapes.items[0],current,{duplicate:true});
  d.values.code='QA-COPY';d.values.name='QA copy';
  const shape=ui.buildCandidate(current,d).shapes.items.at(-1);
  assert.equal(shape.contourMode,'raster');assert.deepEqual(shape.points,current.shapes.items[0].points);
  assert.equal(shape.code,'QA-COPY');
});

test('conflicted tint cannot silently gain a preview without explicit replacement source',()=>{
  const current=copy(),record=current.tints.items.find(t=>t.code==='42S'),d=ui.makeDraft('tint',record,current);
  d.values.previewEnabled=true;d.values.previewHex='#f05222';
  assert.throws(()=>ui.buildCandidate(current,d),/konflik/);
  d.values.overrideReference=true;
  assert.throws(()=>ui.buildCandidate(current,d),/acuan koreksi/);
  d.values.manualReference='Sampel disetujui lab 2026-11';
  const next=ui.buildCandidate(current,d),t=next.tints.items.find(t=>t.code==='42S');
  assert.equal(t.referenceStatus,'manual');assert.equal(t.previewHex,'#F05222');
  assert.equal(t.previewCalibrated,false);assert.equal(t.originalSource.referenceStatus,'percent-conflict');
  assert.match(t.referenceNote,/Sampel disetujui lab/);
  assert.equal(validate(next,current).ok,true);
});

test('a name-only edit retains conflict and disabled colors; disabling a normal tint clears all preview stops',()=>{
  const current=copy(),d=ui.makeDraft('tint',current.tints.items.find(t=>t.code==='42S'),current);
  d.values.name='Acuan yang perlu diperiksa';
  const t=ui.buildCandidate(current,d).tints.items.find(t=>t.code==='42S');
  assert.equal(t.referenceStatus,'percent-conflict');assert.equal(t.previewHex,null);
  const other=ui.makeDraft('tint',current.tints.items[0],current);
  other.values.previewEnabled=false;
  const next=ui.buildCandidate(current,other).tints.items[0];
  assert.equal(next.previewHex,null);assert.equal(next.previewMidHex,null);assert.equal(next.previewBottomHex,null);
});

test('blank numeric parsing rejects empty and nonfinite values without changing current catalogs',()=>{
  const current=copy(),before=JSON.stringify(current),d=ui.makeDraft('blank',current.materials.blanks[0],current);
  d.values.ct='';
  assert.throws(()=>ui.buildCandidate(current,d),/wajib/);
  d.values.ct='Infinity';
  assert.throws(()=>ui.buildCandidate(current,d),/valid/);
  assert.equal(JSON.stringify(current),before);
});

test('import review is all-or-nothing, reports archives, and refuses removal of master identities',()=>{
  const current=copy(),incoming=copy();
  incoming.tints.items[0].active=false;
  const plan=ui.importPlan(current,{schema:ui.IMPORT_SCHEMA,catalogs:incoming});
  assert.equal(plan.changed,true);
  assert.equal(plan.changes.find(c=>c.kind==='tints').archived,1);
  assert.equal(current.tints.items[0].active,undefined);
  assert.throws(()=>ui.importPlan(current,{schema:'trl-sku-catalog/1.0',skus:[]}),/schema/);
  incoming.shapes.items.pop();
  assert.throws(()=>ui.importPlan(current,{schema:ui.IMPORT_SCHEMA,catalogs:incoming}),/tidak boleh dihapus/);
});

test('import protects supplier and blank identity already assigned to a SKU',()=>{
  const current=copy(),incoming=copy(),p=current.materials.products[0],b=current.materials.blanks.find(b=>b.productId===p.id);
  const skuCatalog={schema:'trl-sku-catalog/1.0',skus:[{id:'sku-qa',code:'SKU-QA',variants:[{index:p.index,assignments:[{productId:p.id,supplier:p.supplier,blankIds:[b.id]}]}]}]};
  incoming.materials.products[0].supplier='Another';
  assert.throws(()=>ui.importPlan(current,{schema:ui.IMPORT_SCHEMA,catalogs:incoming},{skuCatalog}),/supplier/);
});

function fakeManager(saveCatalogs){
  const m=Object.create(LeinzMasterManager.prototype);
  Object.assign(m,{catalogs:copy(),saveCatalogs,getSkus:()=>[],saving:false,draft:{dirty:true},importReview:null,
    notices:[],changes:[],render:()=>{},_editorErrors:errors=>{m.editorErrors=errors;},_importErrors:errors=>{m.importErrors=errors;},
    _notice:(message,kind)=>m.notices.push({message,kind}),_setSaving:value=>{m.saving=value;},
    closeEditor:()=>{m.draft=null;},closeImport:()=>{m.importReview=null;},onChange:value=>m.changes.push(value)});
  return m;
}
test('master save waits for acknowledgement, prevents duplicate submissions and adopts canonical response',async()=>{
  let resolve,count=0;
  const m=fakeManager(()=>{count++;return new Promise(r=>{resolve=r;});});
  const next=copy();next.tints.items[0].name='Changed';
  const first=m._commit(next,'Saved',{closeEditor:true});
  await Promise.resolve();
  assert.equal(m.saving,true);assert.equal(m.catalogs.tints.items[0].name,source.tints.items[0].name);
  assert.equal(m.draft.dirty,true);assert.equal(m.changes.length,0);
  assert.equal(await m._commit(next,'Duplicate'),false);assert.equal(count,1);
  const ack=structuredClone(next);ack.materials.serverNote='Canonical acknowledgement';
  resolve({value:ack});
  assert.equal(await first,true);assert.equal(m.saving,false);assert.equal(m.draft,null);
  assert.equal(m.catalogs.materials.serverNote,'Canonical acknowledgement');assert.equal(m.changes.length,1);
});

test('failed master save retains prior master and editor draft without a success message',async()=>{
  const m=fakeManager(async()=>{throw Error('Network unavailable');});
  const next=copy();next.tints.items[0].name='Pending';
  assert.equal(await m._commit(next,'Saved',{closeEditor:true}),false);
  assert.deepEqual(m.catalogs,source);assert.equal(m.draft.dirty,true);assert.equal(m.changes.length,0);
  assert.ok(m.notices.every(n=>n.kind==='warning'));assert.equal(m.saving,false);
});

test('stale local master and server 409 cannot silently overwrite newer catalog data',async()=>{
  let calls=0;const m=fakeManager(async()=>{calls++;});
  const base=ui.stable(m.catalogs),next=copy();next.tints.items[0].name='Pending';
  m.catalogs.tints.items[0].name='Newer';
  assert.equal(await m._commit(next,'Saved',{base}),false);assert.equal(calls,0);
  const remote=copy();remote.tints.items[0].name='Remote';
  m.saveCatalogs=async()=>{throw Object.assign(Error('Conflict'),{status:409,document:{value:remote}});};
  assert.equal(await m._commit(next,'Saved'),false);
  assert.equal(m.catalogs.tints.items[0].name,'Remote');assert.equal(m.draft.stale,true);
  assert.equal(m.changes.length,1);
});

test('missing acknowledgement is never announced as successful and rendering errors do not undo committed data',async()=>{
  const m=fakeManager(async()=>undefined);
  assert.equal(await m._commit(copy(),'Saved'),false);assert.equal(m.changes.length,0);
  m.saveCatalogs=async value=>value;m.onChange=()=>{throw Error('Renderer failed');};
  const next=copy();next.tints.items[0].name='Committed';
  assert.equal(await m._commit(next,'Saved'),true);
  assert.equal(m.catalogs.tints.items[0].name,'Committed');
  assert.ok(m.notices.at(-1).message.includes('Master tersimpan'));
});

