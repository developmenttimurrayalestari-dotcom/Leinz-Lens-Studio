import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),T=require('../dist/tabular-import.js');
test('every workbook row matches the shipped material master without changing source indices or power coverage',()=>{
 const bytes=fs.readFileSync(new URL('fixtures/material-master-2026-11-10.xlsx',import.meta.url));
 const rows=T.rowsFor(T.parseExcel(bytes,{filename:'DMO UNI OSA WXG TRN.xlsx'}),'materials');
 const m=JSON.parse(fs.readFileSync(new URL('../dist/assets/materials.json',import.meta.url)));
 assert.equal(rows.length,6829);assert.equal(m.products.length,91);assert.equal(m.blanks.length,796);assert.equal(m.rules.length,6829);
 const products=new Map(m.products.map(p=>[p.supplier+'\0'+p.code,p]));
 const blanks=new Map(m.blanks.map(b=>[JSON.stringify([b.productId,b.baseCurve,b.diameter]),b]));
 const key=r=>JSON.stringify([r.blankId,r.sphFrom,r.sphTo,r.cylFrom,r.cylTo,r.addFrom,r.addTo]);
 const rules=new Set(m.rules.map(key));
 for(const row of rows){const v=row.values,p=products.get(String(v.supplier).trim()+'\0'+String(v.LensCode).trim());assert(p,'product row '+row.row);assert.equal(p.name,String(v.Descr).trim());
  const b=blanks.get(JSON.stringify([p.id,Number(v.base_curve),Number(v.diameter)]));assert(b,'blank row '+row.row);assert.equal(b.ct,Number(v.center_thickness));assert.equal(b.et,Number(v.edge_thickness));
  const r={blankId:b.id,...Object.fromEntries(['sph','cyl','add'].flatMap(p=>[['From','from'],['To','to']].map(([a,s])=>[p+a,Number(v[p+'_'+s])])))};assert(rules.has(key(r)),'power row '+row.row);
 }
 assert.deepEqual([...new Set(m.products.map(p=>p.supplier))].sort(),['DMO','SOA','TRN','UNI','WXG']);
 assert(m.products.filter(p=>p.index==='1.61').every(p=>p.activeForSimulator===false));
});
