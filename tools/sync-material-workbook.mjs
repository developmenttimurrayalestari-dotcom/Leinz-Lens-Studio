// Workbook cells are treated only as data. No macros, formulas or instructions execute.
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolve,basename} from 'node:path';
import {loadConfig,PROJECT_ROOT} from '../server/config.mjs';
import {createPool,migrate,MysqlStore,catalogDigest} from '../server/db.mjs';
import {readRelational,assertPreserved} from '../server/relational.mjs';
const require=createRequire(import.meta.url),T=require('../dist/tabular-import.js');
const args=process.argv.slice(2),file=args[args.indexOf('--file')+1];
if(!args.includes('--file')||!file)throw Error('Use --file workbook.xlsx [--apply-assets] [--apply-db]');
const bytes=await fs.readFile(file),sha=createHash('sha256').update(bytes).digest('hex');
const parsed=T.parseExcel(bytes,{filename:basename(file)}),rows=T.rowsFor(parsed,'materials');
const now=new Date().toISOString(),stamp=now.replace(/[:.]/g,'-');
const backupDir=resolve(PROJECT_ROOT,'.qa/backups',stamp);await fs.mkdir(backupDir,{recursive:true});
function reconcile(current,skus={skus:[]}) {
 const base=structuredClone(current),lookup=new Map(base.materials.products.map(p=>[p.supplier+'\0'+p.code,p]));
 const specs=new Map();for(const r of rows){const v=r.values;const p=lookup.get(String(v.supplier).trim()+'\0'+String(v.LensCode).trim());if(p)specs.set(JSON.stringify([p.id,Number(v.base_curve),Number(v.diameter)]),{ct:Number(v.center_thickness),et:Number(v.edge_thickness)});}
 const thickness=[];for(const b of base.materials.blanks){const s=specs.get(JSON.stringify([b.productId,b.baseCurve,b.diameter]));if(s&&(s.ct!==b.ct||s.et!==b.et)){thickness.push({id:b.id,before:{ct:b.ct,et:b.et},after:s});b.originalSource??=structuredClone(b);Object.assign(b,s);}}
 const result=T.buildMasterImport(base,parsed,{kind:'materials',skuCatalog:skus,now});
 const value=result.payload.catalogs,m=value.materials;
 // Keep stable rule identities while recording the new workbook's exact provenance.
 const pmap=new Map(m.products.map(p=>[p.supplier+'\0'+p.code,p.id]));
 const bmap=new Map(m.blanks.map(b=>[JSON.stringify([b.productId,b.baseCurve,b.diameter]),b.id]));
 const locations=new Map();
 const ruleKey=r=>JSON.stringify([r.blankId,r.sphFrom,r.sphTo,r.cylFrom,r.cylTo,r.addFrom,r.addTo]);
 for(const r of rows){const v=r.values;const bid=bmap.get(JSON.stringify([pmap.get(String(v.supplier).trim()+'\0'+String(v.LensCode).trim()),Number(v.base_curve),Number(v.diameter)]));const k=ruleKey({blankId:bid,...Object.fromEntries(['sph','cyl','add'].flatMap(p=>[['From','from'],['To','to']].map(([a,b])=>[p+a,Number(v[p+'_'+b])])))});if(!locations.has(k))locations.set(k,[]);locations.get(k).push({sheet:r.sheet,row:r.row});}
 for(const rule of m.rules){const loc=locations.get(ruleKey(rule));if(!loc)continue;if(rule.sourceFile!==basename(file)||rule.sourceSha256!==sha)rule.originalSource??=structuredClone(rule);Object.assign(rule,{sourceFile:basename(file),sourceSha256:sha,sourceRows:loc.map(l=>l.row),sourceLocations:loc,exactDuplicateCount:loc.length-1,hasExactDuplicates:loc.length>1});}
 Object.assign(m.summary,{sourceFile:basename(file),sourceSha256:sha,sourceRowCount:rows.length,sourceColumnCount:13,productCount:m.products.length,blankCount:m.blanks.length,uniqueRuleCount:m.rules.length,exactDuplicateExtraRows:result.info.duplicateRows,exactDuplicateGroups:[...locations.values()].filter(x=>x.length>1).length,sourceRowsBySupplier:{},sourceRowsByIndex:{},activeIndices:['1.50','1.56','1.57','1.60','1.67','1.74'],catalogueOnlyIndices:[...new Set(m.products.filter(p=>!p.activeForSimulator).map(p=>p.index))].sort()});
 for(const r of rows){const supplier=String(r.values.supplier).trim(),p=m.products.find(p=>p.supplier===supplier&&p.code===String(r.values.LensCode).trim());m.summary.sourceRowsBySupplier[supplier]=(m.summary.sourceRowsBySupplier[supplier]||0)+1;m.summary.sourceRowsByIndex[p.index]=(m.summary.sourceRowsByIndex[p.index]||0)+1;}
 return {value,report:{source:basename(file),sha256:sha,sourceRows:rows.length,before:{products:current.materials.products.length,blanks:current.materials.blanks.length,rules:current.materials.rules.length},after:{products:m.products.length,blanks:m.blanks.length,rules:m.rules.length},thicknessChanges:thickness,...Object.fromEntries(Object.entries(result.info).filter(([k])=>!['previewRows','filename'].includes(k)))}};
}
const assets=Object.fromEntries(await Promise.all(['materials','shapes','tints'].map(async k=>[k,JSON.parse(await fs.readFile(resolve(PROJECT_ROOT,'dist/assets/'+k+'.json'),'utf8'))])));
const report={assets:reconcile(assets).report};
if(args.includes('--apply-assets')){await fs.writeFile(resolve(backupDir,'materials-assets-before.json'),JSON.stringify(assets.materials));await fs.writeFile(resolve(PROJECT_ROOT,'dist/assets/materials.json'),JSON.stringify(reconcile(assets).value.materials));}
if(args.includes('--apply-db')) {
 const pool=createPool(loadConfig());
 try {
  const c=await pool.getConnection();let current,sku,revision;
  try{await c.beginTransaction();current={};for(const k of ['materials','shapes','tints'])current[k]=await readRelational(c,'catalog',k);sku=await readRelational(c,'workspace','skus');const [[r]]=await c.query('SELECT revision FROM leinz_catalog_revision WHERE id=1');revision=Number(r.revision);await c.commit();}finally{c.release();}
  await fs.writeFile(resolve(backupDir,'catalogs-database-before.json'),JSON.stringify({value:current,revision,sku}));
  const next=reconcile(current,sku);report.database=next.report;
  await migrate(pool);
  const store=new MysqlStore(pool,loadConfig());await store.initialize();
  if(catalogDigest(current)!==catalogDigest(next.value))await store.putCatalogs(next.value,revision);
  assertPreserved(next.value,(await store.getCatalogs()).value,'workbook sync');
  assertPreserved(sku,(await store.getDocument(null,'skus')).value,'SKU unchanged');
  report.database.verified=true;
 }finally{await pool.end();}
}
report.backupDirectory=backupDir;
await fs.writeFile(resolve(PROJECT_ROOT,'database/workbook-sync-report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
