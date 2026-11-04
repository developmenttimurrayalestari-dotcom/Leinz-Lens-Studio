/* Shared, deterministic validation for managed reference catalogs. */
(function (global) {
  'use strict';
  const SCHEMA = 'trl-master-catalogs/1.0';
  const INDICES = Object.freeze(['1.50','1.56','1.57','1.59','1.60','1.67','1.74']);
  const SIMULATOR_INDICES = Object.freeze(INDICES.filter(index => index !== '1.59'));
  const GROUPS = Object.freeze(['fashion','sunglass','therapeutic','special']);
  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const clone = value => JSON.parse(JSON.stringify(value));
  const active = item => !!item && item.active !== false;
  const validId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(value);
  const finite = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
  const text = (value, max, required = true) => typeof value === 'string' && value.length <= max && (!required || value.trim().length > 0) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
  const hex = value => value === null || /^#[0-9a-f]{6}$/i.test(value || '');

  function jsonProblem(value) {
    let nodes = 0, problem = '';
    function walk(item, depth) {
      if (problem) return;
      if (++nodes > 300000 || depth > 40) { problem = 'Struktur master terlalu besar atau terlalu dalam.'; return; }
      if (item === null) return;
      if (typeof item === 'number') { if (!Number.isFinite(item)) problem = 'Angka master harus bernilai terbatas.'; return; }
      if (['string','boolean'].includes(typeof item)) return;
      if (typeof item !== 'object') { problem = 'Master hanya boleh memuat nilai JSON.'; return; }
      for (const key of Object.keys(item)) {
        if (['__proto__','prototype','constructor'].includes(key)) { problem = 'Nama atribut master tidak diizinkan.'; return; }
        walk(item[key], depth + 1);
      }
    }
    walk(value, 0); return problem;
  }

  function validateOpticalProfile(value) {
    const errors = [];
    if (!isObject(value)) return {ok:false,errors:['Profil optik harus berupa objek.'],value:null};
    const problem = jsonProblem(value);
    if (problem) return {ok:false,errors:[problem],value:null};
    for (const key of ['minCenterMm','minEdgeMm']) if (value[key] !== undefined && !finite(value[key], .5, 10)) errors.push(key + ' harus 0,5–10 mm.');
    if (value.frontPowerD !== undefined && !finite(value.frontPowerD, 0, 20)) errors.push('frontPowerD harus 0–20 dioptri.');
    if (value.frontRadiusMm !== undefined && value.frontRadiusMm !== null && !finite(value.frontRadiusMm, 20, 5000)) errors.push('frontRadiusMm harus 20–5.000 mm atau kosong.');
    if (value.frontCurveBasis !== undefined && !['material','reference-index'].includes(value.frontCurveBasis)) errors.push('Basis kurva depan tidak valid.');
    if (value.curveReferenceIndex !== undefined && !finite(value.curveReferenceIndex, 1.3, 2)) errors.push('Indeks acuan kurva harus 1,3–2.');
    for (const key of ['frontConic','backConic']) if (value[key] !== undefined && value[key] !== 0) errors.push('Desain asferis belum didukung: ' + key + ' harus 0.');
    if (value.source !== undefined && !['assumption','lab'].includes(value.source)) errors.push('Sumber parameter optik harus assumption atau lab.');
    if (value.reference !== undefined && !text(value.reference, 500, false)) errors.push('Acuan parameter optik maksimal 500 karakter.');
    if (value.source === 'lab' && !text(value.reference, 500)) errors.push('Parameter dari lab memerlukan acuan yang diisi pengguna.');
    return {ok:errors.length === 0,errors,value:errors.length ? null : clone(value)};
  }

  function segmentCross(a, b, c) { return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]); }
  function onSegment(a, b, p) { return Math.abs(segmentCross(a,b,p)) < 1e-10 && p[0] >= Math.min(a[0],b[0])-1e-10 && p[0] <= Math.max(a[0],b[0])+1e-10 && p[1] >= Math.min(a[1],b[1])-1e-10 && p[1] <= Math.max(a[1],b[1])+1e-10; }
  function intersects(a,b,c,d) {
    const abC=segmentCross(a,b,c),abD=segmentCross(a,b,d),cdA=segmentCross(c,d,a),cdB=segmentCross(c,d,b);
    return (abC*abD < -1e-20 && cdA*cdB < -1e-20) || onSegment(a,b,c) || onSegment(a,b,d) || onSegment(c,d,a) || onSegment(c,d,b);
  }
  function contourProblem(points) {
    if (!Array.isArray(points) || points.length < 4 || points.length > 512) return 'Kontur harus memuat 4–512 titik.';
    if (points.some(p => !Array.isArray(p) || p.length !== 2 || !p.every(v => finite(v,-.500001,.500001)))) return 'Titik kontur harus pasangan angka x/y pada rentang −0,5 sampai 0,5.';
    const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
    if (Math.max(...xs)-Math.min(...xs)<.1 || Math.max(...ys)-Math.min(...ys)<.1) return 'Kontur harus memiliki lebar dan tinggi yang cukup.';
    let area=0;
    for (let i=0;i<points.length;i++) {
      const a=points[i],b=points[(i+1)%points.length];
      if (Math.hypot(a[0]-b[0],a[1]-b[1])<1e-8) return 'Kontur mempunyai titik berurutan yang sama.';
      area+=a[0]*b[1]-b[0]*a[1];
      for(let j=i+2;j<points.length;j++) {
        if(i===0&&j===points.length-1)continue;
        if(intersects(a,b,points[j],points[(j+1)%points.length]))return 'Kontur berpotongan dengan dirinya sendiri.';
      }
    }
    if(Math.abs(area)<.01)return 'Luas kontur terlalu kecil atau tidak valid.';
    return '';
  }

  function summarizeCatalogs(value) {
    const materials=value?.materials||{},shapes=value?.shapes?.items||[],tints=value?.tints?.items||[];
    const products=materials.products||[],blanks=materials.blanks||[],rules=materials.rules||[];
    return {products:products.length,blanks:blanks.length,rules:rules.length,shapes:shapes.length,tints:tints.length,
      activeProducts:products.filter(active).length,activeBlanks:blanks.filter(active).length,
      activeRules:rules.filter(active).length,activeShapes:shapes.filter(active).length,activeTints:tints.filter(active).length,
      simulatorProducts:products.filter(p=>active(p)&&p.activeForSimulator).length,
      indices:[...new Set(products.map(p=>p.index))].sort()};
  }

  function validateCatalogBundle(input, {previous,skuCatalog} = {}) {
    const errors=[]; const add = message => { if(errors.length<100&&!errors.includes(message))errors.push(message); };
    if(!isObject(input))return {ok:false,errors:['Master harus berupa objek materials, shapes, dan tints.'],value:null};
    const problem=jsonProblem(input); if(problem)return {ok:false,errors:[problem],value:null};
    for(const key of ['materials','shapes','tints'])if(!isObject(input[key])||input[key].schemaVersion!==1)add('Schema katalog '+key+' harus versi 1.');
    if(errors.length)return {ok:false,errors,value:null};
    const {materials,shapes,tints}=input;
    const lists=[['produk',materials.products,1000],['blank',materials.blanks,10000],['aturan power',materials.rules,20000],['shape',shapes.items,200],['tint',tints.items,1000]];
    for(const [label,items,max]of lists)if(!Array.isArray(items)||items.length>max)add('Daftar '+label+' tidak valid atau melebihi batas '+max+'.');
    if(errors.length)return {ok:false,errors,value:null};
    const checkFlag=(row,key,label)=>{if(row[key]!==undefined&&typeof row[key]!=='boolean')add(label+': '+key+' harus boolean.');};
    const indexRows=(rows,field,label)=>{
      const map=new Map();
      for(const row of rows){
        if(!isObject(row)){add(label+' harus berupa objek.');continue;}
        if(!validId(row[field]))add('ID/kode '+label+' tidak valid.');
        else if(map.has(row[field]))add('ID/kode '+label+' berulang: '+row[field]+'.');
        else map.set(row[field],row);
        checkFlag(row,'active',label+' '+String(row[field]||''));
      }
      return map;
    };
    const productMap=indexRows(materials.products,'id','produk'),blankMap=indexRows(materials.blanks,'id','blank');
    const ruleMap=indexRows(materials.rules,'id','aturan power'),shapeMap=indexRows(shapes.items,'code','shape'),tintMap=indexRows(tints.items,'code','tint');
    for(const p of productMap.values()){
      const label='Produk '+p.id;
      if(!text(p.supplier,80))add(label+': supplier wajib diisi, maksimal 80 karakter.');
      if(!text(p.code,80))add(label+': kode wajib diisi, maksimal 80 karakter.');
      if(!text(p.name,200))add(label+': nama wajib diisi, maksimal 200 karakter.');
      if(!INDICES.includes(p.index))add(label+': indeks tidak tersedia dalam katalog.');
      if(typeof p.activeForSimulator!=='boolean')add(label+': activeForSimulator harus boolean.');
      if(p.activeForSimulator&&!SIMULATOR_INDICES.includes(p.index))add(label+': indeks '+p.index+' hanya untuk katalog, bukan enam indeks simulator.');
      if(p.opticalProfile!==undefined){const checked=validateOpticalProfile(p.opticalProfile);checked.errors.forEach(e=>add(label+': '+e));}
    }
    for(const b of blankMap.values()){
      const label='Blank '+b.id;
      if(!productMap.has(b.productId))add(label+': produk bahan tidak ditemukan.');
      for(const [key,min,max]of [['baseCurve',0,30],['diameter',20,150],['ct',.1,50],['et',.1,50]])if(!finite(b[key],min,max))add(label+': '+key+' harus '+min+'–'+max+'.');
      if(b.opticalProfile!==undefined){const checked=validateOpticalProfile(b.opticalProfile);checked.errors.forEach(e=>add(label+': '+e));}
    }
    for(const r of ruleMap.values()){
      const label='Aturan '+r.id;
      if(!blankMap.has(r.blankId))add(label+': blank tidak ditemukan.');
      for(const [prefix,min,max]of [['sph',-40,40],['cyl',-20,0],['add',0,10]]){
        if(!finite(r[prefix+'From'],min,max)||!finite(r[prefix+'To'],min,max))add(label+': rentang '+prefix.toUpperCase()+' harus '+min+'–'+max+'.');
        else if(r[prefix+'From']>r[prefix+'To'])add(label+': minimum '+prefix.toUpperCase()+' melebihi maksimum.');
      }
      if(r.sourceRows!==undefined&&(!Array.isArray(r.sourceRows)||r.sourceRows.length>20000||r.sourceRows.some(n=>!Number.isSafeInteger(n)||n<1)))add(label+': nomor baris sumber tidak valid.');
      if(r.exactDuplicateCount!==undefined&&(!Number.isSafeInteger(r.exactDuplicateCount)||r.exactDuplicateCount<0))add(label+': jumlah duplikat tidak valid.');
      checkFlag(r,'hasExactDuplicates',label);
    }
    for(const s of shapeMap.values()){
      const label='Shape '+s.code;
      if(!text(s.name,140))add(label+': nama wajib diisi, maksimal 140 karakter.');
      if(s.shortName!==undefined&&!text(s.shortName,60))add(label+': nama pendek tidak valid.');
      if(s.description!==undefined&&!text(s.description,1000,false))add(label+': deskripsi tidak valid.');
      const invalid=contourProblem(s.points);if(invalid)add(label+': '+invalid);
      if(s.defaultWidthMm!==undefined&&!finite(s.defaultWidthMm,35,70))add(label+': lebar awal harus 35–70 mm.');
      if(s.defaultHeightMm!==undefined&&!finite(s.defaultHeightMm,25,60))add(label+': tinggi awal harus 25–60 mm.');
      if(s.referenceAspectRatio!==undefined&&!finite(s.referenceAspectRatio,.4,3))add(label+': rasio bentuk tidak valid.');
      if(s.contourMode!==undefined&&!['raster','vector'].includes(s.contourMode))add(label+': mode kontur tidak valid.');
      if(s.geometryRevision!==undefined&&!text(s.geometryRevision,64))add(label+': revisi geometri tidak valid.');
    }
    if(!shapes.items.some(s=>isObject(s)&&active(s)))add('Pertahankan setidaknya satu frame shape aktif.');
    for(const t of tintMap.values()){
      const label='Tint '+t.code;
      if(!text(t.name,160))add(label+': nama wajib diisi, maksimal 160 karakter.');
      if(!['Solid','Gradient'].includes(t.kind))add(label+': jenis harus Solid atau Gradient.');
      if(!GROUPS.includes(t.group))add(label+': kelompok tint tidak valid.');
      if(t.nominalPercent!==null&&!finite(t.nominalPercent,0,100))add(label+': label persentase harus 0–100 atau kosong.');
      for(const key of ['previewHex','previewMidHex','previewBottomHex'])if(t[key]!==undefined&&!hex(t[key]))add(label+': '+key+' harus warna #RRGGBB atau kosong.');
      for(const key of ['previewCalibrated','requiresPhysicalSample'])checkFlag(t,key,label);
      if(t.referenceStatus!==undefined&&!text(t.referenceStatus,64))add(label+': status acuan tidak valid.');
      if(t.referenceNote!==undefined&&!text(t.referenceNote,2000,false))add(label+': catatan acuan maksimal 2.000 karakter.');
      if(t.sourceImage!==undefined&&t.sourceImage!==null&&(typeof t.sourceImage!=='string'||!/^assets\/[A-Za-z0-9_/-]+\.(?:png|jpe?g|webp)$/i.test(t.sourceImage)||t.sourceImage.includes('..')))add(label+': gambar acuan harus aset lokal yang valid.');
    }
    // Existing identities remain available to saved consultations. Use archive
    // instead of physical removal; rule ranges may be edited/removed explicitly.
    if(previous){
      const priorLists=[['produk',previous.materials?.products,productMap,'id'],['blank',previous.materials?.blanks,blankMap,'id'],['shape',previous.shapes?.items,shapeMap,'code'],['tint',previous.tints?.items,tintMap,'code']];
      for(const [label,rows,map,key]of priorLists)for(const row of Array.isArray(rows)?rows:[])if(!map.has(row[key]))add('Master '+label+' '+row[key]+' tidak boleh dihapus. Arsipkan untuk mempertahankan riwayat.');
    }
    if(skuCatalog?.skus){
      for(const sku of skuCatalog.skus)for(const v of sku.variants||[])for(const a of v.assignments||[]){
        const p=productMap.get(a.productId),label='SKU '+String(sku.code||sku.id);
        if(!p||p.index!==v.index||p.supplier!==a.supplier||!p.activeForSimulator)add(label+': identitas supplier/produk/indeks yang sudah di-assign tidak boleh diubah atau dihapus.');
        for(const id of a.blankIds||[])if(!blankMap.has(id)||blankMap.get(id).productId!==a.productId)add(label+': blank yang sudah di-assign tidak boleh dipindahkan atau dihapus.');
      }
    }
    return {ok:errors.length===0,errors,value:errors.length?null:clone(input)};
  }

  function validateCatalogs(input, options={}) {
    const result=validateCatalogBundle(input,{...options,skuCatalog:options.skuCatalog||(options.skus?{skus:options.skus}:undefined)});
    if(!result.ok)throw Object.assign(new Error(result.errors.join(' ')),{errors:result.errors});
    return result.value;
  }
  const api={SCHEMA,INDICES,SIMULATOR_INDICES,GROUPS,active,validId,validateOpticalProfile,contourProblem,validateCatalogBundle,validateCatalogs,summarizeCatalogs};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  global.LeinzCatalogModel=api;
})(typeof window!=='undefined'?window:globalThis);
