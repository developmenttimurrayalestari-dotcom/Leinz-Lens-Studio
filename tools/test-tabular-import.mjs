import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const imports=require('../dist/tabular-import.js');
const XLSX=require('../dist/vendor/xlsx.full.min.js');
const engine=require('../dist/blank-engine.js');
const {MasterUiModel,LeinzMasterManager}=require('../dist/master-manager.js');
const {SkuManager,planImport,validateCatalog}=require('../dist/sku-manager.js');
const source=Object.fromEntries(['materials','shapes','tints'].map(name=>[name,JSON.parse(fs.readFileSync(new URL('../dist/assets/'+name+'.json',import.meta.url),'utf8'))]));
const now='2026-11-04T00:00:00.000Z';
const copy=value=>structuredClone(value);
const readTemplate=(name,ext)=>fs.readFileSync(new URL('../dist/templates/'+name+'-template.'+ext,import.meta.url));
const reference=fs.readFileSync(new URL('fixtures/blank-reference.xlsx',import.meta.url));
const parsedReference=imports.parseExcel(reference,{filename:'DMO UNV OSA.xlsx'});
const quote=value=>'"'+String(value??'').replaceAll('"','""')+'"';
const csv=(kind,rows,{delimiter=',',headers=imports.HEADERS[kind]}={})=>'\uFEFF'+headers.map(quote).join(delimiter)+'\r\n'+rows.map(r=>headers.map(h=>quote(r[h])).join(delimiter)).join('\r\n')+'\r\n';
const parsed=(kind,rows,options={})=>imports.parseCSV(csv(kind,rows,options),{filename:options.filename||'fixture.csv'});
const blankRows=imports.rowsFor(imports.parseCSV(readTemplate('blank','csv').toString('utf8')),'materials').map(r=>r.values);
const shapeRows=imports.rowsFor(imports.parseCSV(readTemplate('frame-shape','csv').toString('utf8')),'shapes').map(r=>r.values);
const tintRows=imports.rowsFor(imports.parseCSV(readTemplate('tinting','csv').toString('utf8')),'tints').map(r=>r.values);
const skuRows=imports.rowsFor(imports.parseCSV(readTemplate('sku','csv').toString('utf8')),'skus').map(r=>r.values);
const master=(rows,kind='materials',current=source)=>imports.buildMasterImport(current,parsed(kind,rows),{kind,now});
const asFile=(name,bytes)=>({name,size:bytes.length,arrayBuffer:async()=>Uint8Array.from(bytes).buffer,text:async()=>Buffer.from(bytes).toString('utf8')});
const workbook=(tables,mutate)=>{
  const wb=XLSX.utils.book_new();
  for(const [name,rows]of tables)XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),name);
  mutate?.(wb);
  return XLSX.write(wb,{type:'buffer',bookType:'xlsx'});
};
const aoa=(kind,rows)=>[imports.HEADERS[kind],...rows.map(r=>imports.HEADERS[kind].map(h=>r[h]??''))];
const smallFrame=engine.estimateFrame({points:source.shapes.items[0].points,width:52,height:38,dbl:18,pdR:35,pdL:35,heightR:19,heightL:19,allowanceDiameter:2});
const status=(materials,productId,index,blankId,rx,frame=smallFrame,skuVariant=null)=>engine.evaluate({materials,productId,index,rx,frame,skuVariant}).rows.find(r=>r.blank.id===blankId);

test('the real supplier workbook is an idempotent 2689-row import with 2026 coupled rules',()=>{
  const before=JSON.stringify(source),result=imports.buildMasterImport(source,parsedReference,{now});
  assert.equal(result.info.rowCount,2689);assert.equal(result.info.uniqueRecords,2026);assert.equal(result.info.duplicateRows,663);
  assert.equal(result.info.touchedProducts,19);assert.equal(result.info.touchedBlanks,186);
  assert.equal(result.info.removedRules,0);assert.equal(result.info.addedRules,0);
  assert.deepEqual(result.payload.catalogs,source);
  assert.equal(MasterUiModel.importPlan(source,result.payload).changed,false);
  assert.equal(JSON.stringify(source),before);
  const again=imports.buildMasterImport(result.payload.catalogs,parsedReference,{now:'2030-01-01T00:00:00Z'});
  assert.deepEqual(again.payload.catalogs,source);
});

test('real SPH/CYL/ADD coverage holes stay excluded and inclusive boundaries still pass',()=>{
  const materials=imports.buildMasterImport(source,parsedReference,{now}).payload.catalogs.materials;
  const target='DMO:SPHG60:BC1.00:D75.00';
  for(const [sph,cyl,add,expected]of [[-9,-4,0,true],[-9,0,1,true],[-9,-4,1,false],[-10,0,.25,true],[-7.75,-6,0,true],[-7.75,0,.25,false]]){
    const result=status(materials,'DMO:SPHG60','1.60',target,{sph,cyl,add});
    assert.equal(result.rawPowerMatches,expected,JSON.stringify({sph,cyl,add}));
    assert.equal(result.eligibleBoth,expected);
  }
  const target2='SOA:F35W50:BC1.00:D70.00';
  for(const [sph,cyl,expected]of [[-5.25,-5,false],[-5,-5,true],[-5.25,-4.75,true]])assert.equal(status(materials,'SOA:F35W50','1.50',target2,{sph,cyl,add:0}).rawPowerMatches,expected);
});

test('coverage, geometric diameter, and SKU finish restrictions all remain necessary after import',()=>{
  const m=imports.buildMasterImport(source,parsedReference,{now}).payload.catalogs.materials;
  const large=engine.estimateFrame({points:source.shapes.items[0].points,width:70,height:58,dbl:28,pdR:25,pdL:25,heightR:29,heightL:29,allowanceDiameter:2});
  const target='DMO:SPHG60:BC1.00:D75.00',rx={sph:-9,cyl:-4,add:0};
  const result=status(m,'DMO:SPHG60','1.60',target,rx,large);
  assert.equal(result.rawPowerMatches,true);assert.equal(result.eligibleBoth,false);assert.ok(result.reasons.includes('blank-too-small-r'));
  const variant={index:'1.60',enabled:true,power:{sphMin:-8,sphMax:0,cylMin:-6,cylMax:0,addMin:0,addMax:0},assignments:[{supplier:'DMO',productId:'DMO:SPHG60',blankIds:[target]}]};
  const restricted=status(m,'DMO:SPHG60','1.60',target,rx,smallFrame,variant);
  assert.equal(restricted.rawPowerMatches,true);assert.equal(restricted.skuPowerMatches,false);assert.equal(restricted.eligibleBoth,false);
});

test('a changed subset replaces rules only for the referenced blank and retains stable identities',()=>{
  const rows=copy(blankRows);rows.splice(1,1);rows[0].sph_from=-9.5;
  const {payload,info}=master(rows),next=payload.catalogs,blankId='DMO:SPHG60:BC1.00:D75.00';
  assert.equal(info.touchedBlanks,1);assert.equal(info.removedRules,2);assert.equal(info.addedRules,1);
  assert.deepEqual(next.materials.products,source.materials.products);assert.deepEqual(next.materials.blanks,source.materials.blanks);
  assert.deepEqual(next.materials.rules.filter(r=>r.blankId!==blankId),source.materials.rules.filter(r=>r.blankId!==blankId));
  assert.deepEqual(next.shapes,source.shapes);assert.deepEqual(next.tints,source.tints);
  const rules=next.materials.rules.filter(r=>r.blankId===blankId);assert.equal(rules.length,1);
  assert.equal(status(next.materials,'DMO:SPHG60','1.60',blankId,{sph:-9,cyl:-4,add:0}).rawPowerMatches,false);
  assert.equal(rules[0].sourceFile,'fixture.csv');assert.deepEqual(rules[0].sourceLocations,[{sheet:'CSV',row:2}]);assert.deepEqual(rules[0].sourceRows,[2]);
  assert.deepEqual(master(rows,'materials',next).payload.catalogs,next);
});

test('exact repeated range rows collapse without widening the rule and retain all new source locations',()=>{
  const row={...blankRows[0],sph_from:-9.5},result=master([row,row,row]);
  assert.equal(result.info.duplicateRows,2);assert.equal(result.info.uniqueRecords,1);
  const r=result.payload.catalogs.materials.rules.find(r=>r.sourceFile==='fixture.csv');
  assert.equal(r.hasExactDuplicates,true);assert.equal(r.exactDuplicateCount,2);assert.deepEqual(r.sourceRows,[2,3,4]);
  assert.deepEqual(r.sourceLocations,[2,3,4].map(row=>({sheet:'CSV',row})));
});

test('empty numeric cells, invalid ranges, non-finite values and positive CYL fail without changing masters',()=>{
  const before=JSON.stringify(source);
  for(const [key,value]of [['sph_from',''],['cyl_from',' '],['add_to',null],['diameter',Infinity],['center_thickness','NaN'],['sph_from',4],['cyl_to',.25],['add_from',-.25],['edge_thickness','10mm']]){
    const row={...blankRows[0],[key]:value};
    assert.throws(()=>master([blankRows[1],row]),imports.ImportError,key);
  }
  assert.equal(JSON.stringify(source),before);
});

test('zero-only CYL and ADD ranges retain literal zero and do not become wildcards',()=>{
  const row={...blankRows[0],sph_from:-1,sph_to:1,cyl_from:0,cyl_to:0,add_from:0,add_to:0};
  const m=master([row]).payload.catalogs.materials,id='DMO:SPHG60:BC1.00:D75.00';
  assert.equal(status(m,'DMO:SPHG60','1.60',id,{sph:0,cyl:0,add:0}).rawPowerMatches,true);
  assert.equal(status(m,'DMO:SPHG60','1.60',id,{sph:0,cyl:-.25,add:0}).rawPowerMatches,false);
  assert.equal(status(m,'DMO:SPHG60','1.60',id,{sph:0,cyl:0,add:.25}).rawPowerMatches,false);
});

test('inconsistent source CT/ET and conflicts with known blank dimensions need explicit correction',()=>{
  assert.throws(()=>master([blankRows[0],{...blankRows[1],center_thickness:8}]),/CT\/ET/);
  assert.throws(()=>master([{...blankRows[0],edge_thickness:14}]),/CT\/ET/);
  const one={...blankRows[0],supplier:'NEW',LensCode:'TEST60',Descr:'Spherical 1.60'};
  assert.throws(()=>master([one,{...one,center_thickness:8}]),/bertentangan/);
});

test('unknown products need a validated index and never infer it only from LensCode suffix',()=>{
  const row={...blankRows[0],supplier:'NEW',LensCode:'TEST60',Descr:'Unlabelled product'};
  assert.throws(()=>master([row]),/Indeks produk baru tidak jelas/);
  assert.throws(()=>master([{...row,Descr:'Material 1.60 or 1.67'}]),/Indeks produk baru tidak jelas/);
  assert.throws(()=>master([{...row,Descr:'Material 1.599'}]),/tidak dibulatkan/);
  assert.throws(()=>master([{...blankRows[0],Descr:'Material 1.599'}]),/tidak dibulatkan/);
  assert.throws(()=>master([{...blankRows[0],Descr:'Material 1.6001'}]),/tidak dibulatkan/);
  const payload=imports.buildMasterImport(source,parsed('materials',[{...row,index:'1,60'}],{headers:[...imports.HEADERS.materials,'index']}),{now}).payload;
  const added=payload.catalogs.materials.products.find(p=>p.supplier==='NEW');assert.equal(added.index,'1.60');assert.equal(added.activeForSimulator,true);
  assert.throws(()=>imports.buildMasterImport(source,parsed('materials',[{...blankRows[0],index:1.67}],{headers:[...imports.HEADERS.materials,'index']}),{now}),/Indeks berbeda/);
  assert.throws(()=>master([{...blankRows[0],Descr:'Spherical 1.67'}]),/bertentangan/);
});

test('catalog-only index 1.59 is preserved and new 1.59 products remain unavailable in simulator',()=>{
  const result=master([{...blankRows[0],supplier:'QA',LensCode:'POLY59',Descr:'Spherical 1.59'}]);
  const p=result.payload.catalogs.materials.products.find(p=>p.code==='POLY59');assert.equal(p.index,'1.59');assert.equal(p.activeForSimulator,false);
  const original=source.materials.products.filter(p=>p.index==='1.59');assert.deepEqual(result.payload.catalogs.materials.products.filter(p=>original.some(o=>o.id===p.id)),original);
});

test('new blank identities retain meaningful third decimal places',()=>{
  const rows=[{...blankRows[0],base_curve:1.001},{...blankRows[0],base_curve:1.002}];
  const result=master(rows).payload.catalogs.materials;
  const added=result.blanks.filter(b=>b.baseCurve===1.001||b.baseCurve===1.002);assert.equal(added.length,2);assert.notEqual(added[0].id,added[1].id);
});

test('import preserves archived status and separate finishing profiles on unchanged physical blanks',()=>{
  const current=copy(source),b=current.materials.blanks[0],p=current.materials.products[0];
  b.active=false;b.opticalProfile={minCenterMm:1.4,minEdgeMm:1.3};p.active=false;p.activeForSimulator=false;
  const result=master(blankRows,'materials',current).payload.catalogs;
  assert.deepEqual(result,current);
});

test('ambiguous supplier/product or duplicate physical blank identities are rejected',()=>{
  let current=copy(source);current.materials.products.push({...current.materials.products[0],id:'duplicate-product'});
  assert.throws(()=>master(blankRows,'materials',current),/beberapa produk/);
  current=copy(source);current.materials.blanks.push({...current.materials.blanks[0],id:'duplicate-blank'});
  assert.throws(()=>master(blankRows,'materials',current),/beberapa blank/);
});

test('CSV handles BOM, semicolons, decimal commas, quotes and multiline values with physical row numbers',()=>{
  const rows=copy(blankRows);rows[0].Descr='Spherical 1,60 "UV420"\nGrey';rows[1].Descr=rows[0].Descr;
  for(const r of rows)for(const h of imports.HEADERS.materials.slice(3))r[h]=String(r[h]).replace('.',',');
  const data=parsed('materials',rows,{delimiter:';'}),records=imports.rowsFor(data,'materials');
  assert.equal(data.delimiter,';');assert.equal(records[0].row,2);assert.equal(records[1].row,4);
  assert.equal(records[0].values.Descr,rows[0].Descr);
  const result=imports.buildMasterImport(source,data,{now});assert.equal(result.info.uniqueRecords,2);
  assert.equal(result.payload.catalogs.materials.rules.length,source.materials.rules.length);
  assert.equal(result.payload.catalogs.materials.products[0].name,'Spherical 1,60 "UV420"\nGrey');
});

test('CSV supports sep declarations and tab delimiters while rejecting malformed quotes',()=>{
  const s=csv('materials',blankRows,{delimiter:';'}).replace(/^\uFEFF/,'');
  const declared=imports.parseCSV('\uFEFFsep=;\r\n'+s);assert.equal(imports.rowsFor(declared,'materials')[0].row,3);
  const leading=imports.parseCSV('\uFEFF\n\n'+s);assert.equal(leading.delimiter,';');assert.equal(imports.rowsFor(leading,'materials')[0].row,4);
  assert.equal(imports.rowsFor(parsed('materials',blankRows,{delimiter:'\t'}),'materials').length,2);
  for(const s of ['a,b\n"unterminated,1','a,b\n"value"junk,1','a,b\nva"lue,1'])assert.throws(()=>imports.parseCSV(s),imports.ImportError);
});

test('missing, duplicated, unknown headers and populated unheaded columns fail clearly',()=>{
  assert.throws(()=>imports.buildMasterImport(source,parsed('materials',blankRows),{kind:'shapes',now}),/Kolom tidak dikenal/);
  assert.throws(()=>imports.rowsFor(imports.parseCSV('supplier,LensCode\nDMO,SPHG60'),'materials'),/Kolom wajib/);
  assert.throws(()=>imports.rowsFor(imports.parseCSV(csv('materials',blankRows,{headers:[...imports.HEADERS.materials,'diameter']})),'materials'),/Header berulang/);
  assert.throws(()=>imports.rowsFor(imports.parseCSV(csv('materials',blankRows,{headers:[...imports.HEADERS.materials,'thikness']})),'materials'),/Kolom tidak dikenal/);
  const s=imports.HEADERS.materials.join(',')+',\n'+imports.HEADERS.materials.map(h=>quote(blankRows[0][h])).join(',')+',unexpected';
  assert.throws(()=>imports.rowsFor(imports.parseCSV(s),'materials'),/tanpa header/);
});

test('Excel reads all data sheets, ignores the named instructions sheet and keeps row provenance',()=>{
  const row={...blankRows[0],sph_from:-9.5},bytes=workbook([['Supplier A',aoa('materials',[row])],['Supplier B',aoa('materials',[row])],['Petunjuk',[['Instructions'],['Do not import this sheet']]]]);
  const result=imports.buildMasterImport(source,imports.parseExcel(bytes,{filename:'two-sheets.xlsx'}),{now});
  assert.equal(result.info.rowCount,2);assert.equal(result.info.duplicateRows,1);
  const r=result.payload.catalogs.materials.rules.find(r=>r.sourceFile==='two-sheets.xlsx');
  assert.deepEqual(r.sourceLocations,[{sheet:'Supplier A',row:2},{sheet:'Supplier B',row:2}]);
});

test('Excel formulas, error cells, dates, merged fields and extra unknown data sheets are rejected',()=>{
  const table=aoa('materials',blankRows);
  for(const cell of [{t:'n',v:7.5,f:'1+6.5'},{t:'e',v:7},{t:'d',v:new Date('2026-01-01')}]){
    const bytes=workbook([['Blank',table]],wb=>{wb.Sheets.Blank.F2=cell;});
    assert.throws(()=>imports.parseExcel(bytes),/Formula|error\/tanggal/);
  }
  assert.throws(()=>imports.parseExcel(workbook([['Blank',table]],wb=>{wb.Sheets.Blank['!merges']=[{s:{r:1,c:0},e:{r:2,c:0}}];})),/gabungan/);
  const extra=imports.parseExcel(workbook([['Blank',table],['Unexpected',[['Another data table'],['Data']]]]));
  assert.throws(()=>imports.buildMasterImport(source,extra,{now}),/Kolom tidak dikenal/);
});

test('file size, expanded workbook size, invalid extension, corruption and row limits are bounded',async()=>{
  await assert.rejects(()=>imports.readFile({name:'big.csv',size:imports.LIMITS.bytes+1,arrayBuffer:async()=>new ArrayBuffer(1)}),/8 MiB/);
  await assert.rejects(()=>imports.readFile(asFile('legacy.xls',Buffer.from('test'))),/\.xlsx/);
  await assert.rejects(()=>imports.readFile(asFile('bad.csv',Buffer.from([0xff,0xfe,0x00]))),/Encoding/);
  assert.throws(()=>imports.parseExcel(Buffer.from('fake workbook')),/workbook/);
  const bytes=Buffer.from(reference),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let eocd=bytes.length-22;while(eocd>=0&&view.getUint32(eocd,true)!==0x06054b50)eocd--;
  assert.ok(eocd>=0);const central=view.getUint32(eocd+16,true);view.setUint32(central+24,imports.LIMITS.zipBytes+1,true);
  assert.throws(()=>imports.parseExcel(bytes),/64 MiB/);
  assert.throws(()=>imports.parseCSV('a,b\n'+'1,2\n'.repeat(imports.LIMITS.rows+1)),/Maksimal/);
});

test('native numeric, boolean and string code types survive the eight downloadable templates',()=>{
  for(const [kind,name,count]of [['materials','blank',2],['shapes','frame-shape',2],['tints','tinting',2],['skus','sku',1]]){
    let previous;
    for(const extension of ['csv','xlsx']){
      const bytes=readTemplate(name,extension),data=extension==='csv'?imports.parseCSV(bytes.toString('utf8')):imports.parseExcel(bytes);
      const built=kind==='skus'?imports.buildSkuImport([],source.materials,data,{now}):imports.buildMasterImport(source,data,{kind,now});
      assert.equal(built.info.rowCount,count,name+'.'+extension);
      if(kind!=='skus')assert.deepEqual(built.payload.catalogs,source,name+'.'+extension+' should be a no-op');
      if(previous)assert.deepEqual(built.payload,previous);previous=built.payload;
      if(kind==='skus'){assert.equal(built.payload.skus[0].active,false);assert.equal(validateCatalog(built.payload,{materials:source.materials}).ok,true);}
    }
  }
});

test('shape import preserves original contours for keep and validates new contour geometry',()=>{
  const before=copy(source),base={...shapeRows[0],code:'import-round',name:'Import round',active:false,contour:'ellipse',points_json:'',width_mm:50,height_mm:50};
  const result=master([base],'shapes').payload.catalogs;
  assert.deepEqual(result.shapes.items.slice(0,-1),source.shapes.items);assert.equal(result.shapes.items.at(-1).points.length,128);assert.equal(result.shapes.items.at(-1).active,false);
  assert.throws(()=>master([{...base,contour:'keep'}],'shapes'),/sudah ada/);
  assert.throws(()=>master([{...base,contour:'points',points_json:'[[0,0],[0.5,0.5],[0,0.5],[0.5,0]]'}],'shapes'),/berpotongan/);
  assert.throws(()=>master([{...base,contour:'points',points_json:'not JSON'}],'shapes'),/JSON/);
  assert.deepEqual(source,before);
  assert.deepEqual(master([base],'shapes',result).payload.catalogs,result);
});

test('conflicting duplicate shape/tint records fail while exact duplicate rows are explicit',()=>{
  assert.throws(()=>master([shapeRows[0],{...shapeRows[0],name:'Other name'}],'shapes'),/berulang/);
  assert.throws(()=>master([tintRows[0],{...tintRows[0],name:'Other name'}],'tints'),/berulang/);
  assert.equal(master([shapeRows[0],shapeRows[0]],'shapes').info.duplicateRows,1);
  assert.equal(master([tintRows[0],tintRows[0]],'tints').info.duplicateRows,1);
});

test('tint import protects conflicted references and requires a valid gradient or solid',()=>{
  const base={...tintRows[0],code:'42S',preview_hex:'#123456',preview_mid_hex:'#123456',preview_bottom_hex:'#123456'};
  assert.throws(()=>master([base],'tints'),/konflik acuan/);
  assert.throws(()=>master([{...base,override_reference:true}],'tints'),/Acuan manual/);
  const result=master([{...base,override_reference:true,manual_reference:'QA replacement reference'}],'tints').payload.catalogs;
  const t=result.tints.items.find(t=>t.code==='42S');assert.equal(t.referenceStatus,'manual');assert.equal(t.previewHex,'#123456');assert.ok(t.originalSource);
  assert.throws(()=>master([{...tintRows[0],preview_bottom_hex:'#987654'}],'tints'),/Solid/);
  assert.throws(()=>master([{...tintRows[1],preview_bottom_hex:''}],'tints'),/warna bawah/);
  assert.throws(()=>master([{...tintRows[0],preview_hex:'red'}],'tints'),/#RRGGBB/);
});

test('SKU template resolves physical blanks and repeated import preserves SKU and assignment identity',()=>{
  const data=parsed('skus',skuRows),prepared=imports.buildSkuImport([],source.materials,data,{now}),first=planImport([],prepared.payload,{materials:source.materials,now});
  assert.equal(first.ok,true);assert.equal(first.changes.length,1);assert.equal(first.skus[0].active,false);
  const assignment=first.skus[0].variants[0].assignments[0];assert.equal(assignment.productId,'DMO:SPHG60');assert.deepEqual(assignment.blankIds,['DMO:SPHG60:BC1.00:D75.00']);
  const second=imports.buildSkuImport(first.skus,source.materials,data,{now:'2030-01-01T00:00:00Z'}),merged=planImport(first.skus,second.payload,{materials:source.materials,now:'2030-01-01T00:00:00Z'});
  assert.equal(merged.changes.length,0);assert.equal(merged.unchanged.length,1);assert.deepEqual(merged.skus,first.skus);
});

test('SKU multi-index multi-supplier rows aggregate complete assignments without fabricating blank coverage',()=>{
  const soa=source.materials.blanks.find(b=>b.productId==='SOA:SPHW60'),high=source.materials.blanks.find(b=>b.productId==='DMO:SPHW74');
  const rows=[{...skuRows[0],sku_active:true},{...skuRows[0],sku_active:true,supplier:'SOA',LensCode:'SPHW60',base_curve:soa.baseCurve,diameter:soa.diameter},{...skuRows[0],sku_active:true,index:1.74,supplier:'DMO',LensCode:'SPHW74',base_curve:high.baseCurve,diameter:high.diameter}];
  const prepared=imports.buildSkuImport([],source.materials,parsed('skus',rows),{now}),sku=prepared.payload.skus[0];
  assert.equal(sku.variants.length,2);assert.equal(sku.variants[0].assignments.length,2);assert.equal(sku.variants[1].assignments.length,1);
  assert.equal(validateCatalog(prepared.payload,{materials:source.materials}).ok,true);
  const dupe=imports.buildSkuImport([],source.materials,parsed('skus',[rows[0],rows[0]]),{now});assert.equal(dupe.info.duplicateRows,1);assert.equal(dupe.payload.skus[0].variants[0].assignments[0].blankIds.length,1);
});

test('SKU import rejects ambiguous power ranges, unavailable indices and mismatched supplier/blank selections atomically',()=>{
  const build=rows=>imports.buildSkuImport([],source.materials,parsed('skus',rows),{now});
  for(const change of [{sph_min:-12},{index_enabled:false},{sku_name:'Conflicting name'},{sku_active:true}])assert.throws(()=>build([skuRows[0],{...skuRows[0],...change}]),/bertentangan|harus sama/);
  for(const change of [{index:1.59},{supplier:'UNKNOWN'},{LensCode:'MISSING'},{index:1.74},{diameter:80},{diameter:''},{cyl_max:.25}])assert.throws(()=>build([{...skuRows[0],...change}]),imports.ImportError);
});

test('disabled SKU indices may retain blank power fields but enabled indices need complete data',()=>{
  const row={...skuRows[0],index_enabled:false,supplier:'',LensCode:'',base_curve:'',diameter:''};
  for(const key of ['sph_min','sph_max','cyl_min','cyl_max','add_min','add_max'])row[key]='';
  const built=imports.buildSkuImport([],source.materials,parsed('skus',[row]),{now});
  assert.equal(built.payload.skus[0].variants[0].enabled,false);assert.equal(built.payload.skus[0].variants[0].assignments.length,0);
  assert.deepEqual(Object.values(built.payload.skus[0].variants[0].power),[null,null,null,null,null,null]);
  assert.throws(()=>imports.buildSkuImport([],source.materials,parsed('skus',[{...row,index_enabled:true}]),{now}),/Wajib berupa angka/);
});

test('SKU changes replace the touched SKU configuration, preserve other SKUs, and are idempotent for JSON too',()=>{
  const built=imports.buildSkuImport([],source.materials,parsed('skus',skuRows),{now});
  const first=planImport([],built.payload,{materials:source.materials,now});
  const existing=copy(first.skus);existing.push({...copy(existing[0]),id:'sku-other',code:'KEEP-OTHER'});
  const rows=[{...skuRows[0],sku_name:'Updated name'}];
  const update=imports.buildSkuImport(existing,source.materials,parsed('skus',rows),{now}),plan=planImport(existing,update.payload,{materials:source.materials,now});
  assert.equal(plan.changes.length,1);assert.deepEqual(plan.skus[1],existing[1]);assert.equal(plan.skus[0].id,existing[0].id);assert.equal(plan.skus[0].variants[0].assignments[0].id,existing[0].variants[0].assignments[0].id);
  assert.equal(planImport(plan.skus,{schema:'trl-sku-catalog/1.0',skus:plan.skus},{materials:source.materials,now:'2030-01-01T00:00:00Z'}).changes.length,0);
});

test('reimporting a formerly used SKU code cannot overwrite an existing renamed SKU by generated ID',()=>{
  const data=parsed('skus',skuRows),initial=imports.buildSkuImport([],source.materials,data,{now});
  const original=planImport([],initial.payload,{materials:source.materials,now}).skus[0];
  const renamed={...copy(original),code:'RENAMED-EXISTING'};
  const incoming=imports.buildSkuImport([renamed],source.materials,data,{now});
  assert.notEqual(incoming.payload.skus[0].id,renamed.id);
  const result=planImport([renamed],incoming.payload,{materials:source.materials,now});
  assert.equal(result.ok,true);assert.equal(result.skus.length,2);assert.deepEqual(result.skus[0],renamed);
  assert.equal(result.changes[0].action,'create');
  const again=imports.buildSkuImport(result.skus,source.materials,data,{now});
  assert.equal(planImport(result.skus,again.payload,{materials:source.materials,now}).changes.length,0);
});

test('review and error text escapes file data before HTML rendering',()=>{
  const data=parsed('materials',[{...blankRows[0],Descr:'<img src=x onerror=alert(1)> 1.60'}]),result=imports.buildMasterImport(source,data,{now});
  const markup=imports.reviewMarkup(result.info);assert.ok(markup.includes('&lt;img'));assert.ok(!markup.includes('<img'));
  const errors=imports.errorMarkup(new imports.ImportError([{sheet:'<svg>',row:2,column:'Descr',message:'<script>alert(1)</script>'}]));
  assert.ok(errors.includes('&lt;script&gt;'));assert.ok(!errors.includes('<script>'));assert.ok(errors.includes('baris 2'));
});

function masterController(){
  const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',disabled:false,open:false,showModal(){this.open=true;},close(){this.open=false;}});return nodes.get(id);};
  const manager=Object.create(LeinzMasterManager.prototype);
  Object.assign(manager,{catalogs:copy(source),tab:'materials',saving:false,importReview:null,_q:node,_importErrors(){},getSkus:()=>[],_notice(){}});
  return {manager,node};
}
test('an invalid second file clears the previous master review and cannot apply stale data',async()=>{
  const {manager,node}=masterController(),valid=asFile('changed.csv',Buffer.from(csv('materials',[{...blankRows[0],sph_from:-9.5}])));
  assert.equal(await manager.readImport(valid),true);assert.ok(manager.importReview);assert.equal(node('#mm-apply-import').disabled,false);
  assert.equal(await manager.readImport(asFile('bad.csv',Buffer.from('supplier,Oops\nDMO,bad'))),false);
  assert.equal(manager.importReview,null);assert.equal(node('#mm-apply-import').disabled,true);assert.equal(await manager.applyImport(),false);assert.deepEqual(manager.catalogs,source);
});

test('closing an import while a file is loading prevents a late preview from reopening',async()=>{
  const {manager,node}=masterController();let resolve;
  const file={name:'delayed.csv',size:100,arrayBuffer:()=>new Promise(done=>{resolve=done;})};
  const reading=manager.readImport(file);assert.equal(node('#mm-import-dialog').open,true);
  manager.closeImport();resolve(Uint8Array.from(Buffer.from(csv('materials',blankRows))).buffer);
  await reading;assert.equal(node('#mm-import-dialog').open,false);assert.equal(manager.importReview,null);
});

test('template links target all eight packaged files and preserve the existing JSON import option',()=>{
  for(const kind of ['materials','shapes','tints','skus']){
    const html=imports.templateLinks(kind);assert.ok(html.includes('.csv'));assert.ok(html.includes('.xlsx'));
    for(const [,path]of html.matchAll(/href="([^"]+)"/g))assert.ok(fs.existsSync(new URL('../dist/'+path,import.meta.url)));
  }
  assert.equal(typeof SkuManager.helpers.planImport,'function');assert.equal(typeof MasterUiModel.importPlan,'function');
});
