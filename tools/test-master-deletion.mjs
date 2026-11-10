import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {validateMasterDeletion,validateMasterCatalogs} from '../server/validation.mjs';
const require=createRequire(import.meta.url),M=require('../dist/catalog-model.js');
const {LeinzMasterManager}=require('../dist/master-manager.js'),{SkuManager}=require('../dist/sku-manager.js');
const source=Object.fromEntries(['materials','shapes','tints'].map(k=>[k,JSON.parse(fs.readFileSync(new URL('../dist/assets/'+k+'.json',import.meta.url)))]));

test('explicit deletion removes selected blanks and their rules, retaining all other masters',()=>{
  const ids=source.materials.blanks.slice(0,2).map(b=>b.id),before=JSON.stringify(source);
  const next=validateMasterDeletion(source,{kind:'blank',ids},{skuCatalog:{skus:[]}});
  assert.equal(next.materials.blanks.length,source.materials.blanks.length-2);
  assert(next.materials.rules.every(r=>!ids.includes(r.blankId)));
  assert.deepEqual(next.shapes,source.shapes);assert.deepEqual(next.tints,source.tints);
  assert.equal(JSON.stringify(source),before);
  assert.throws(()=>validateMasterCatalogs(next,{previous:source}),/không|tidak boleh dihapus/);
});
test('references in SKU, per-user draft and saved consultation block deletion atomically',()=>{
  const b=source.materials.blanks[0],p=source.materials.products.find(p=>p.id===b.productId);
  const skuCatalog={skus:[{id:'SKU',code:'SKU',variants:[{index:p.index,assignments:[{supplier:p.supplier,productId:p.id,blankIds:[b.id]}]}]}]};
  assert.throws(()=>M.deleteItems(source,'blank',[b.id],{skuCatalog}),/SKU/);
  assert.throws(()=>M.deleteItems(source,'product',[p.id],{skuCatalog}),/SKU/);
  for(const documents of [[{shape:source.shapes.items[0].code}],[ [{state:{a:{tintCode:source.tints.items[0].code}}}] ]]) {
    const kind=Array.isArray(documents[0])?'tint':'shape',id=kind==='tint'?source.tints.items[0].code:source.shapes.items[0].code;
    assert.throws(()=>M.deleteItems(source,kind,[id],{documents}),/draft atau riwayat/);
  }
  assert.throws(()=>M.deleteItems(source,'shape',source.shapes.items.map(s=>s.code)),/setidaknya satu/);
});
test('individual and multiple shape/tint removals preserve unselected records',()=>{
  for(const [kind,key]of [['shape','shapes'],['tint','tints']])for(const count of [1,2]) {
    const ids=source[key].items.slice(0,count).map(r=>r.code),next=M.deleteItems(source,kind,ids);
    assert.deepEqual(next[key].items,source[key].items.slice(count));
  }
});
test('manager deletion sends explicit intent and clears selection only after successful acknowledgement',async()=>{
  const m=Object.create(LeinzMasterManager.prototype),id=source.tints.items[0].code;
  Object.assign(m,{catalogs:source,getSkus:()=>[],getDocuments:()=>[],saving:false,confirmLeave:()=>true,_notice:()=>{},_renderList:()=>{}});
  m._selection('tint').add(id);let received,release;
  m._commit=(value,message,options)=>{received=options;return new Promise(resolve=>release=resolve);};
  const operation=m.deleteItems('tint',[id]);assert(m._selection('tint').has(id));release(true);
  assert.equal(await operation,true);assert.equal(m._selection('tint').size,0);assert.deepEqual(received.deletion,{kind:'tint',ids:[id]});
});
test('SKU multi-delete persists one batch and refuses referenced SKU',async()=>{
  const m=Object.create(SkuManager.prototype),original=[{id:'a'},{id:'b'},{id:'c'}];let saved;
  Object.assign(m,{skus:original,saving:false,getDocuments:()=>[],_notice:()=>{},_renderList:()=>{},_commit:async next=>{saved=next;return true;}});
  assert.equal(await m.deleteItems(['a','b']),true);assert.deepEqual(saved,[{id:'c'}]);
  m.getDocuments=()=>[[{state:{a:{skuId:'c'}}}]];saved=null;
  assert.equal(await m.deleteItems(['c']),false);assert.equal(saved,null);
});
test('all master views render selection controls and single-item delete actions',()=>{
  const m=Object.create(LeinzMasterManager.prototype);
  Object.assign(m,{catalogs:source,filter:{materials:'',shapes:'',tints:''},showArchived:false,blankFilter:'',tintLimit:24,productId:source.materials.products[0].id});
  for(const [tab,render,kinds]of [['materials','_materialsHtml',['product','blank']],['shapes','_shapesHtml',['shape']],['tints','_tintsHtml',['tint']]]) {
    m.tab=tab;const html=m[render]();for(const kind of kinds){assert(html.includes('data-mm-select="'+kind+'"'));assert(html.includes('data-mm-action="delete-'+kind+'"'));}
  }
});
