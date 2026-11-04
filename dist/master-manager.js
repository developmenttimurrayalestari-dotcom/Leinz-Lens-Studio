/* Manage raw materials, shapes and tint references. All writes await storage acknowledgement. */
(function (global) {
  'use strict';
  const IMPORT_SCHEMA = 'trl-master-catalogs/1.0';
  const INDICES = ['1.50','1.56','1.57','1.59','1.60','1.67','1.74'];
  const ACTIVE_INDICES = INDICES.filter(index => index !== '1.59');
  const POWER_FIELDS = ['sphFrom','sphTo','cylFrom','cylTo','addFrom','addTo'];
  const POWER_LABELS = ['SPH min','SPH maks','CYL min','CYL maks','ADD min','ADD maks'];
  const SECTIONS = {
    materials: {title:'Manage Blank / Raw Material', subtitle:'Kelola produk bahan, ukuran blank, dan batas power dari supplier.'},
    shapes: {title:'Manage Frame Shape', subtitle:'Kelola bentuk, ukuran awal, dan kontur yang dipakai bersama oleh preview serta pemeriksaan blank.'},
    tints: {title:'Manage Tinting', subtitle:'Kelola kode warna, jenis pewarnaan, dan acuan pratinjau digital.'}
  };
  const clone = value => JSON.parse(JSON.stringify(value));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const active = item => item?.active !== false;
  const uid = prefix => prefix + '-' + (global.crypto?.randomUUID?.() || Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));
  const stable = value => JSON.stringify(value, (key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(k => [k,item[k]])) : item);
  const equal = (a,b) => stable(a) === stable(b);
  const fmt = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString('id-ID',{maximumFractionDigits:2}) : '—';
  const text = value => typeof value === 'string' ? value.trim() : '';
  const hex = value => /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value).toUpperCase() : null;
  const model = () => global.LeinzCatalogModel || (typeof require === 'function' ? require('./catalog-model.js') : null);
  const tabular = () => global.LeinzTabularImport || (typeof require === 'function' ? require('./tabular-import.js') : null);
  const skuEnvelope = input => Array.isArray(input) ? {schema:'trl-sku-catalog/1.0',skus:input} : input || {schema:'trl-sku-catalog/1.0',skus:[]};
  function checked(bundle, context) {
    const api = model();
    if (!api?.validateCatalogBundle) throw Error('Validator master belum dimuat. Muat ulang aplikasi.');
    const result = api.validateCatalogBundle(bundle,context || {});
    if (!result.ok) {
      const e = Error(result.errors?.[0] || 'Master belum valid.');
      e.validationErrors = result.errors || [e.message];
      throw e;
    }
    return result.value;
  }
  function numeric(value,label,{optional=false}={}) {
    if (value === '' || value === null || value === undefined) {
      if (optional) return null;
      throw Error(label + ' wajib diisi.');
    }
    if (typeof value !== 'string' && typeof value !== 'number') throw Error(label + ' harus berupa angka.');
    if (typeof value === 'string' && !value.trim()) throw Error(label + ' wajib diisi.');
    const n = Number(value);
    if (!Number.isFinite(n)) throw Error(label + ' harus berupa angka yang valid.');
    return n;
  }
  function counts(catalogs) {
    return {products:catalogs.materials.products.length,blanks:catalogs.materials.blanks.length,
      rules:catalogs.materials.rules.length,shapes:catalogs.shapes.items.length,tints:catalogs.tints.items.length};
  }
  function arrays(bundle) {
    return [
      ['products',bundle.materials.products,'id','produk bahan'],
      ['blanks',bundle.materials.blanks,'id','blank'],
      ['rules',bundle.materials.rules,'id','aturan power'],
      ['shapes',bundle.shapes.items,'code','frame shape'],
      ['tints',bundle.tints.items,'code','tint']
    ];
  }
  function importPlan(current, payload, context={}) {
    if (!payload || payload.schema !== IMPORT_SCHEMA || !payload.catalogs) throw Error('Berkas harus menggunakan schema ' + IMPORT_SCHEMA + '. Gunakan Ekspor semua master untuk membuat berkas yang sesuai.');
    const value = checked(payload.catalogs,{previous:current,skuCatalog:skuEnvelope(context.skuCatalog)});
    const changes = [];
    const before = arrays(current), after = arrays(value);
    for (let i=0;i<before.length;i++) {
      const [kind,oldRows,key,label] = before[i], newRows = after[i][1];
      const oldMap = new Map(oldRows.map(row=>[row[key],row])), newMap = new Map(newRows.map(row=>[row[key],row]));
      const removed = oldRows.filter(row=>!newMap.has(row[key]));
      if (kind !== 'rules' && removed.length) throw Error('Impor tidak boleh menghapus ' + removed.length + ' ' + label + ' yang sudah ada. Pertahankan record tersebut dan gunakan status arsip bila tidak dipakai.');
      changes.push({kind,label,added:newRows.filter(row=>!oldMap.has(row[key])).length,
        updated:newRows.filter(row=>oldMap.has(row[key])&&!equal(oldMap.get(row[key]),row)).length,
        archived:newRows.filter(row=>oldMap.has(row[key])&&active(oldMap.get(row[key]))&&!active(row)).length,
        removed:removed.length,total:newRows.length});
    }
    return {value,changes,changed:!equal(current,value),base:stable(current)};
  }
  function generatedPoints(kind,count=128) {
    if (kind === 'ellipse') return Array.from({length:count},(_,i)=> {
      const a = i * Math.PI * 2 / count;
      return [Number((.5*Math.cos(a)).toFixed(8)),Number((.5*Math.sin(a)).toFixed(8))];
    });
    if (kind !== 'rounded-rectangle') throw Error('Preset kontur belum dikenal.');
    const points=[], radius=.15, centers=[[.5-radius,.5-radius],[-.5+radius,.5-radius],[-.5+radius,-.5+radius],[.5-radius,-.5+radius]];
    for (let corner=0;corner<4;corner++) {
      for (let j=0;j<count/4;j++) {
        const a=(corner*Math.PI/2)+(j/(count/4-1))*Math.PI/2;
        points.push([Number((centers[corner][0]+radius*Math.cos(a)).toFixed(8)),Number((centers[corner][1]+radius*Math.sin(a)).toFixed(8))]);
      }
    }
    return points;
  }
  function parsePoints(raw) {
    let points;
    try { points=JSON.parse(raw); } catch { throw Error('Titik kontur harus berupa JSON, misalnya [[-0.5,0],[0,-0.5],[0.5,0],[0,0.5]].'); }
    if (!Array.isArray(points) || points.length<4 || points.length>512 || points.some(p=>!Array.isArray(p)||p.length!==2||p.some(v=>typeof v!=='number'||!Number.isFinite(v)||v<-.5||v>.5))) throw Error('Kontur memerlukan 4–512 pasangan [x,y] berupa angka antara -0,5 dan 0,5.');
    return points;
  }
  function profileDraft(record) {
    const p=record?.opticalProfile;
    return {enabled:!!p,measure:p?.frontRadiusMm?'radius':'power',
      minCenterMm:p?.minCenterMm??1.5,minEdgeMm:p?.minEdgeMm??1.5,
      frontPowerD:p?.frontPowerD??4,frontRadiusMm:p?.frontRadiusMm??'',
      frontCurveBasis:p?.frontCurveBasis||'material',curveReferenceIndex:p?.curveReferenceIndex??1.53,
      source:p?.source||'assumption',reference:p?.reference||''};
  }
  function collectProfile(draft) {
    if (!draft.enabled) return null;
    const p={minCenterMm:numeric(draft.minCenterMm,'Minimum CT finishing'),minEdgeMm:numeric(draft.minEdgeMm,'Minimum ET finishing'),
      frontCurveBasis:draft.frontCurveBasis,curveReferenceIndex:numeric(draft.curveReferenceIndex,'Indeks acuan kurva'),
      frontConic:0,backConic:0,source:draft.source,reference:text(draft.reference)};
    if (draft.measure==='radius') p.frontRadiusMm=numeric(draft.frontRadiusMm,'Radius depan');
    else p.frontPowerD=numeric(draft.frontPowerD,'Power permukaan depan');
    return p;
  }
  function provenance(record) {
    const copy=clone(record);
    delete copy.originalSource;
    delete copy.managedAt;
    return copy;
  }
  function buildCandidate(catalogs, draft) {
    const next=clone(catalogs), now=new Date().toISOString(), v=draft.values, original=draft.original;
    let record=clone(draft.record);
    if (draft.type==='product') {
      record={...record,code:text(v.code),name:text(v.name),supplier:text(v.supplier),index:v.index,
        active:v.active===true,activeForSimulator:ACTIVE_INDICES.includes(v.index)&&(v.index!==record.index||record.activeForSimulator!==false)};
      const p=collectProfile(draft.profile);
      if(p)record.opticalProfile=p;else delete record.opticalProfile;
      const at=next.materials.products.findIndex(p=>p.id===record.id);
      if(at<0)next.materials.products.push(record);else next.materials.products[at]=record;
    } else if(draft.type==='blank') {
      record={...record,productId:v.productId,baseCurve:numeric(v.baseCurve,'Base curve'),diameter:numeric(v.diameter,'Diameter blank'),
        ct:numeric(v.ct,'CT bahan baku'),et:numeric(v.et,'ET bahan baku'),active:v.active===true};
      const p=collectProfile(draft.profile);
      if(p)record.opticalProfile=p;else delete record.opticalProfile;
      const at=next.materials.blanks.findIndex(b=>b.id===record.id);
      if(at<0)next.materials.blanks.push(record);else next.materials.blanks[at]=record;
      const oldRules=new Map(catalogs.materials.rules.filter(r=>r.blankId===record.id).map(r=>[r.id,r]));
      const rules=draft.rules.map(raw=>{
        const r={...clone(raw),blankId:record.id};
        for(let i=0;i<POWER_FIELDS.length;i++)r[POWER_FIELDS[i]]=numeric(raw[POWER_FIELDS[i]],POWER_LABELS[i]);
        const old=oldRules.get(r.id);
        if(!old || POWER_FIELDS.some(k=>r[k]!==old[k])) {
          if(old&&!r.originalSource)r.originalSource=provenance(old);
          r.source='managed';r.sourceRows=[];r.exactDuplicateCount=0;r.hasExactDuplicates=false;r.managedAt=now;
        }
        return r;
      });
      const replacements=new Map(rules.map(r=>[r.id,r]));
      const priorIds=new Set(next.materials.rules.map(r=>r.id));
      next.materials.rules=next.materials.rules.flatMap(r=>r.blankId!==record.id?[r]:(replacements.has(r.id)?[replacements.get(r.id)]:[]))
        .concat(rules.filter(r=>!priorIds.has(r.id)));
    } else if(draft.type==='shape') {
      record={...record,code:text(v.code),name:text(v.name),active:v.active===true,
        defaultWidthMm:numeric(v.defaultWidthMm,'Lebar awal A'),defaultHeightMm:numeric(v.defaultHeightMm,'Tinggi awal B')};
      record.referenceAspectRatio=record.defaultWidthMm/record.defaultHeightMm;
      const points=draft.contourMode==='points'?parsePoints(draft.pointsText):
        ['ellipse','rounded-rectangle'].includes(draft.contourMode)?generatedPoints(draft.contourMode):clone(draft.record.points);
      const changed=!equal(points,draft.record.points)||!original;
      if(changed) {
        if(original&&!record.originalSource)record.originalSource=provenance(original);
        for(const key of ['sourceSha256','sourcePathData','sourceFile','sourceRegion','sourceBounds','sourcePathIndex','sourceSubpathIndex','sourceSide','canonicalEye','contourSampling'])delete record[key];
        record.contourMode=draft.contourMode==='keep'?(draft.record.contourMode||(draft.record.source==='user-svg'?'vector':'raster')):'vector';
        record.source='managed';record.category='additional';record.synthetic=['ellipse','rounded-rectangle'].includes(draft.contourMode);
        record.status='illustrative';record.geometryRevision='managed-'+now;record.points=points;
      }
      const at=next.shapes.items.findIndex(s=>s.code===draft.originalKey);
      if(at<0)next.shapes.items.push(record);else next.shapes.items[at]=record;
    } else if(draft.type==='tint') {
      const colorChanged=v.kind!==draft.record.kind||v.previewEnabled!==!!draft.record.previewHex||
        ['previewHex','previewMidHex','previewBottomHex'].some(k=>(hex(v[k])||null)!==(hex(draft.record[k])||null));
      if(original?.referenceStatus==='percent-conflict'&&colorChanged&&!v.overrideReference)throw Error('Tint ini memiliki konflik acuan. Centang penggantian acuan dan isi sumber koreksi sebelum mengubah pratinjau.');
      if(original?.referenceStatus==='percent-conflict'&&v.overrideReference&&!text(v.manualReference))throw Error('Isi acuan koreksi untuk mengganti referensi tint yang konflik.');
      record={...record,code:text(v.code),name:text(v.name),kind:v.kind,group:v.group,active:v.active===true,
        family:original?(record.family||text(v.code)):(/^\d{2}[SG]$/.test(text(v.code))?text(v.code).slice(0,2):text(v.code)),nominalPercent:numeric(v.nominalPercent,'Label persentase',{optional:true}),
        referenceNote:text(v.referenceNote),requiresPhysicalSample:v.requiresPhysicalSample===true,previewCalibrated:false};
      if(v.previewEnabled) {
        if(!hex(v.previewHex))throw Error('Warna atas/solid harus memakai kode #RRGGBB.');
        record.previewHex=hex(v.previewHex);
        record.previewMidHex=v.kind==='Solid'?record.previewHex:(text(v.previewMidHex)?hex(v.previewMidHex):null);
        record.previewBottomHex=v.kind==='Solid'?record.previewHex:hex(v.previewBottomHex);
        if(v.kind==='Gradient'&&!record.previewBottomHex)throw Error('Warna bawah gradasi harus memakai kode #RRGGBB.');
        if(v.kind==='Gradient'&&text(v.previewMidHex)&&!record.previewMidHex)throw Error('Warna tengah harus kosong atau memakai kode #RRGGBB.');
      } else record.previewHex=record.previewMidHex=record.previewBottomHex=null;
      if(!original||colorChanged||v.overrideReference) {
        if(original&&!record.originalSource)record.originalSource=provenance(original);
        record.referenceStatus='manual';record.mappingMethod='managed-digital-reference';
        record.manualReference=text(v.manualReference);
        if(v.overrideReference&&record.manualReference)record.referenceNote='Acuan manual: '+record.manualReference+(record.referenceNote?' · '+record.referenceNote:'');
      }
      const at=next.tints.items.findIndex(t=>t.code===draft.originalKey);
      if(at<0)next.tints.items.push(record);else next.tints.items[at]=record;
    } else throw Error('Jenis editor belum dikenal.');
    if(!original||!equal(record,original)){
      if(original&&!record.originalSource)record.originalSource=provenance(original);
      record.managedAt=now;
    }
    return next;
  }
  function makeDraft(type,record,catalogs,{duplicate=false,productId}={}) {
    const original=record&&!duplicate?clone(record):null;
    let entity=record?clone(record):null;
    const d={type,original,originalKey:type==='shape'||type==='tint'?original?.code:null,base:stable(catalogs),dirty:false,stale:false};
    if(type==='product') {
      entity=entity||{id:uid('material'),code:'',name:'',supplier:'',index:'1.60',active:true,activeForSimulator:true,source:'managed'};
      if(duplicate)entity={...entity,id:uid('material'),code:'',name:entity.name+' — salinan',active:true};
      d.values={code:entity.code,name:entity.name,supplier:entity.supplier,index:entity.index,active:active(entity)};d.profile=profileDraft(entity);
    } else if(type==='blank') {
      const sourceId=entity?.id;
      entity=entity||{id:uid('blank'),productId:productId||catalogs.materials.products[0]?.id||'',baseCurve:'',diameter:'',ct:'',et:'',active:true,source:'managed'};
      if(duplicate)entity={...entity,id:uid('blank'),active:true,originalSource:provenance(entity)};
      d.values={productId:entity.productId,baseCurve:entity.baseCurve,diameter:entity.diameter,ct:entity.ct,et:entity.et,active:active(entity)};
      d.profile=profileDraft(entity);
      d.rules=sourceId?catalogs.materials.rules.filter(r=>r.blankId===sourceId).map(r=>duplicate?{...clone(r),id:uid('rule'),blankId:entity.id,originalSource:provenance(r),source:'managed',sourceRows:[],hasExactDuplicates:false,exactDuplicateCount:0}:clone(r)):[{id:uid('rule'),blankId:entity.id,source:'managed',sourceRows:[],exactDuplicateCount:0,hasExactDuplicates:false,...Object.fromEntries(POWER_FIELDS.map(k=>[k,'']))}];
    } else if(type==='shape') {
      entity=entity||{code:'',name:'',points:generatedPoints('ellipse'),source:'managed',contourMode:'vector',status:'illustrative',category:'additional',synthetic:true,active:true,defaultWidthMm:50,defaultHeightMm:42};
      if(duplicate)entity={...entity,code:'',name:entity.name+' — salinan',active:true,originalSource:provenance(entity)};
      d.values={code:entity.code,name:entity.name,active:active(entity),defaultWidthMm:entity.defaultWidthMm??52,defaultHeightMm:entity.defaultHeightMm??38};
      d.contourMode=record?'keep':'ellipse';d.pointsText=JSON.stringify(entity.points,null,2);
    } else if(type==='tint') {
      entity=entity||{code:'',name:'',kind:'Solid',group:'fashion',nominalPercent:null,previewHex:null,previewMidHex:null,previewBottomHex:null,referenceStatus:'manual',referenceNote:'',previewCalibrated:false,requiresPhysicalSample:false,source:'managed',active:true};
      if(duplicate)entity={...entity,code:'',name:entity.name+' — salinan',active:true,originalSource:provenance(entity),referenceStatus:'manual'};
      d.values={code:entity.code,name:entity.name,kind:entity.kind,group:entity.group,nominalPercent:entity.nominalPercent??'',
        previewEnabled:!!entity.previewHex,previewHex:entity.previewHex||'',previewMidHex:entity.previewMidHex||'',previewBottomHex:entity.previewBottomHex||'',
        referenceNote:entity.referenceNote||'',requiresPhysicalSample:entity.requiresPhysicalSample===true,active:active(entity),overrideReference:false,manualReference:entity.manualReference||''};
    } else throw Error('Jenis editor belum dikenal.');
    d.record=entity;
    return d;
  }
  function svgPreview(points, width=50,height=42) {
    if(!Array.isArray(points)||points.length<4)return '<span>Kontur belum tersedia</span>';
    const ratio=Math.max(.6,Math.min(2.2,Number(width)/Number(height)||1.2)),w=Math.min(120,86*ratio),h=w/ratio;
    const safe=points.every(p=>Array.isArray(p)&&p.length===2&&p.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=.5));
    if(!safe)return '<span>Kontur belum valid</span>';
    const path=points.map((p,i)=>(i?'L':'M')+(80+p[0]*w).toFixed(3)+' '+(55+p[1]*h).toFixed(3)).join(' ')+'Z';
    return '<svg viewBox="0 0 160 110" aria-hidden="true"><path class="mm-shape-outline" d="'+path+'"/><path class="mm-shape-cross" d="M76 55h8 M80 51v8"/></svg>';
  }
  function swatchStyle(v) {
    const top=hex(v.previewHex),mid=hex(v.previewMidHex),bottom=hex(v.previewBottomHex);
    if(!top)return '';
    return v.kind==='Gradient'?'background:linear-gradient(180deg,'+top+' 0%,'+(mid?mid+' 50%,':'')+(bottom||'#FFFFFF')+' 100%)':'background:'+top;
  }
  function input(label,name,value,{type='text',required=false,readonly=false,min,max,step,maxlength,help,placeholder,profile=false}={}) {
    return '<label class="mm-field"><span>'+esc(label)+(required?' <b aria-hidden="true">*</b>':'')+'</span><input '+(profile?'data-mm-profile':'data-mm-field')+'="'+esc(name)+'" type="'+type+'" value="'+esc(value)+'"'+(required?' required':'')+(readonly?' readonly':'')+(min!==undefined?' min="'+min+'"':'')+(max!==undefined?' max="'+max+'"':'')+(step!==undefined?' step="'+step+'"':'')+(maxlength?' maxlength="'+maxlength+'"':'')+(placeholder?' placeholder="'+esc(placeholder)+'"':'')+'>'+(help?'<small>'+esc(help)+'</small>':'')+'</label>';
  }
  function select(label,name,value,options,{profile=false,required=false}={}) {
    return '<label class="mm-field"><span>'+esc(label)+(required?' <b aria-hidden="true">*</b>':'')+'</span><select '+(profile?'data-mm-profile':'data-mm-field')+'="'+esc(name)+'"'+(required?' required':'')+'>'+options.map(o=>'<option value="'+esc(o[0])+'"'+(String(o[0])===String(value)?' selected':'')+'>'+esc(o[1])+'</option>').join('')+'</select></label>';
  }
  function check(label,name,value,{profile=false}={}) {
    return '<label class="mm-check"><input type="checkbox" '+(profile?'data-mm-profile':'data-mm-field')+'="'+esc(name)+'"'+(value?' checked':'')+'><span>'+esc(label)+'</span></label>';
  }
  function statusBadge(item,catalogOnly=false) {
    return '<span class="mm-status '+(!active(item)?'archived':catalogOnly?'catalog-only':'')+'">'+(!active(item)?'Arsip':catalogOnly?'Katalog saja':'Aktif')+'</span>';
  }

  class LeinzMasterManager {
    constructor({root,catalogs,saveCatalogs,onChange=()=>{},getSkus=()=>[],mode='browser',onNotify=()=>{},onNavigate=()=>{}}={}) {
      if(!root?.addEventListener)throw TypeError('Manage memerlukan elemen root DOM.');
      if(typeof saveCatalogs!=='function')throw TypeError('Manage memerlukan fungsi penyimpanan.');
      this.root=root;this.catalogs=clone(catalogs);this.saveCatalogs=saveCatalogs;this.onChange=onChange;this.getSkus=getSkus;
      this.mode=mode;this.onNotify=onNotify;this.onNavigate=onNavigate;this.tab='materials';this.saving=false;this.draft=null;this.importReview=null;this.mounted=false;
      this.filter={materials:'',shapes:'',tints:''};this.showArchived=false;this.productId=this.catalogs.materials.products[0]?.id||'';this.blankFilter='';this.tintLimit=24;
      this.notice='';this.noticeKind='';this._disabled=[];this.mount();
    }
    _q(selector){return this.root.querySelector(selector);}
    mount(){
      if(this.mounted)return this;
      this.mounted=true;this.root.classList.add('master-manager');
      this.root.innerHTML='<div class="mm-shell"><div class="mm-toolbar"><div><h2 id="mm-title"></h2><p id="mm-subtitle"></p></div><div class="mm-tools"><button type="button" class="button secondary" data-mm-action="export">Ekspor semua master</button><label class="button secondary mm-import-label"><span id="mm-import-label-text">Impor JSON / CSV / Excel</span><input id="mm-import-file" type="file" accept=".json,.csv,.xlsx,application/json,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-label="Impor master JSON CSV atau Excel"></label><span id="mm-import-templates"></span></div></div><div id="mm-persistence" class="mm-persistence"></div><div id="mm-notice" class="mm-notice" role="status" hidden></div><div class="mm-filterbar"><label class="mm-search"><span>Cari master</span><input id="mm-search" type="search" placeholder="Cari kode, nama, atau supplier"></label><label class="mm-check"><input type="checkbox" id="mm-show-archived"><span>Tampilkan arsip</span></label><span id="mm-counts"></span></div><div id="mm-content"></div></div><dialog id="mm-editor-dialog" class="mm-dialog" aria-labelledby="mm-editor-title"><form id="mm-editor-form"><div class="mm-dialog-heading"><div><p class="mm-eyebrow" id="mm-editor-kicker">MASTER DATA</p><h2 id="mm-editor-title"></h2></div><button type="button" class="mm-close" aria-label="Tutup editor master" data-mm-action="cancel-editor">×</button></div><div id="mm-editor-error" class="mm-error" role="alert" hidden></div><div id="mm-editor-body"></div><div class="mm-editor-footer"><button type="button" class="text-button" data-mm-action="export-draft">Ekspor draft</button><div><button type="button" class="button secondary" data-mm-action="cancel-editor">Batal</button><button type="submit" class="button primary" id="mm-save">Simpan master</button></div></div></form></dialog><dialog id="mm-import-dialog" class="mm-dialog mm-import-dialog" aria-labelledby="mm-import-title"><div class="mm-dialog-heading"><div><p class="mm-eyebrow">TINJAU BERKAS</p><h2 id="mm-import-title">Impor master data</h2></div><button type="button" class="mm-close" aria-label="Tutup tinjauan impor" data-mm-action="cancel-import">×</button></div><div id="mm-import-error" class="mm-error" role="alert" hidden></div><div id="mm-import-content"></div><div class="mm-editor-footer"><span>Data baru diterapkan setelah penyimpanan berhasil.</span><div><button type="button" class="button secondary" data-mm-action="cancel-import">Batal</button><button type="button" class="button primary" data-mm-action="apply-import" id="mm-apply-import">Terapkan perubahan master</button></div></div></dialog>';
      this._click=e=>this._handleClick(e);this._input=e=>this._handleInput(e);this._change=e=>this._handleChange(e);
      this._submit=e=>{if(e.target.id==='mm-editor-form'){e.preventDefault();this._saveEditor();}};
      this._cancel=e=>{if(e.target.id==='mm-editor-dialog'){e.preventDefault();this.closeEditor();}else if(e.target.id==='mm-import-dialog'){e.preventDefault();this.closeImport();}};
      for(const [event,handler] of [['click',this._click],['input',this._input],['change',this._change],['submit',this._submit],['cancel',this._cancel]])this.root.addEventListener(event,handler,true);
      this.render();return this;
    }
    destroy(){
      if(!this.mounted)return;
      for(const [event,handler] of [['click',this._click],['input',this._input],['change',this._change],['submit',this._submit],['cancel',this._cancel]])this.root.removeEventListener(event,handler,true);
      for(const d of this.root.querySelectorAll('dialog'))if(d.open)d.close();
      this.mounted=false;this.root.innerHTML='';
    }
    isDirty(){return !!this.draft?.dirty||!!this.importReview;}
    isBusy(){return this.saving;}
    setTab(kind){
      if(!SECTIONS[kind])return false;
      if(this.saving){this._notice('Master masih disimpan. Tunggu sampai selesai.','warning');return false;}
      if(kind!==this.tab&&!this.confirmLeave())return false;
      this.tab=kind;this.render();return true;
    }
    confirmLeave(){
      if(this.saving)return false;
      if(this.draft?.dirty&&global.confirm&&!global.confirm('Draft master belum disimpan. Buang draft dan lanjutkan?'))return false;
      this.closeEditor(true);this.closeImport(true);return true;
    }
    updateCatalogs(catalogs){
      const changed=!equal(this.catalogs,catalogs);
      this.catalogs=clone(catalogs);
      if(changed&&this.draft&&!this.saving){this.draft.stale=true;this._editorErrors(['Master terbaru sudah dimuat. Draft Anda tetap tersedia. Ekspor draft bila diperlukan, lalu buka ulang record sebelum menyimpan.']);}
      if(changed&&this.importReview&&!this.saving){this.importReview.stale=true;this._importErrors(['Master berubah sejak berkas ditinjau. Tutup tinjauan dan impor kembali berkas untuk membandingkan dengan data terbaru.']);}
      if(!this.catalogs.materials.products.some(p=>p.id===this.productId))this.productId=this.catalogs.materials.products[0]?.id||'';
      this.render();
    }
    render(){
      if(!this.mounted)return;
      const section=SECTIONS[this.tab],n=counts(this.catalogs);
      this._q('#mm-title').textContent=section.title;this._q('#mm-subtitle').textContent=section.subtitle;
      this._q('#mm-import-templates').innerHTML=tabular()?.templateLinks(this.tab)||'';
      this._q('#mm-import-label-text').textContent='Impor JSON / CSV / Excel';
      this._q('#mm-import-file').setAttribute('aria-label','Impor '+section.title+' JSON CSV atau Excel');
      this._q('#mm-persistence').textContent=this.mode==='mysql'?'Master bersama · perubahan tersimpan di database MySQL setelah dikonfirmasi server.':'Preview browser · perubahan master tersimpan pada browser ini. Gunakan ekspor JSON untuk memindahkannya ke server MySQL.';
      const search=this._q('#mm-search');search.value=this.filter[this.tab];search.placeholder=this.tab==='materials'?'Cari produk, supplier, atau indeks':this.tab==='shapes'?'Cari kode atau nama frame':'Cari kode atau nama tint';
      this._q('#mm-show-archived').checked=this.showArchived;
      this._q('#mm-counts').textContent=this.tab==='materials'?n.products+' produk · '+n.blanks+' blank · '+n.rules+' aturan':this.tab==='shapes'?n.shapes+' bentuk frame':n.tints+' kode tint';
      const notice=this._q('#mm-notice');notice.hidden=!this.notice;notice.textContent=this.notice;notice.className='mm-notice '+this.noticeKind;
      this._renderList();
    }
    _renderList(){
      this._q('#mm-content').innerHTML=this.tab==='materials'?this._materialsHtml():this.tab==='shapes'?this._shapesHtml():this._tintsHtml();
    }
    _matches(item,fields){
      const q=this.filter[this.tab].toLocaleLowerCase('id-ID');
      return (this.showArchived||active(item))&&(!q||fields.join(' ').toLocaleLowerCase('id-ID').includes(q));
    }
    _materialsHtml(){
      const m=this.catalogs.materials,rows=m.products.filter(p=>this._matches(p,[p.code,p.name,p.supplier,p.index]));
      if(!rows.some(p=>p.id===this.productId))this.productId=rows[0]?.id||'';
      const product=m.products.find(p=>p.id===this.productId),allBlanks=product?m.blanks.filter(b=>b.productId===product.id):[];
      const blankRows=allBlanks.filter(b=>(this.showArchived||active(b))&&(!this.blankFilter||[b.baseCurve,b.diameter,b.ct,b.et,b.id].join(' ').toLowerCase().includes(this.blankFilter.toLowerCase())));
      const action='<div class="mm-section-actions"><button type="button" class="button primary" data-mm-action="new-product">+ Produk bahan</button><button type="button" class="button secondary" data-mm-action="navigate-screening">Cek kecocokan blank ↗</button></div>';
      return action+'<div class="mm-material-layout"><aside class="mm-products" aria-label="Produk bahan baku">'+(rows.length?rows.map(p=>{
        const bs=m.blanks.filter(b=>b.productId===p.id);
        return '<button type="button" class="mm-product '+(p.id===this.productId?'selected ':'')+(!active(p)?'is-archived':'')+'" data-mm-action="select-product" data-mm-id="'+esc(p.id)+'" aria-pressed="'+(p.id===this.productId)+'"><span class="mm-product-top"><strong>'+esc(p.code)+'</strong><span class="mm-index">'+esc(p.index)+'</span></span><span class="mm-product-name">'+esc(p.name)+'</span><span class="mm-product-meta">'+esc(p.supplier)+' · '+bs.length+' blank '+statusBadge(p,!p.activeForSimulator)+'</span></button>';
      }).join(''):'<div class="mm-empty"><strong>Tidak ada produk yang sesuai.</strong><p>Ubah pencarian atau tampilkan arsip.</p></div>')+'</aside><section class="mm-blank-section" aria-label="Daftar blank">'+(product?'<div class="mm-product-detail"><div><div class="mm-tagline">'+esc(product.supplier)+' <span>INDEKS '+esc(product.index)+'</span>'+statusBadge(product,!product.activeForSimulator)+'</div><h3>'+esc(product.code)+' <span>'+esc(product.name)+'</span></h3><p>CT/ET di tabel adalah ketebalan bahan baku. Parameter finishing, bila diisi, disimpan terpisah.</p></div><div class="mm-inline-actions"><button type="button" class="button secondary" data-mm-action="edit-product" data-mm-id="'+esc(product.id)+'">Ubah produk</button><button type="button" class="text-button" data-mm-action="toggle-product" data-mm-id="'+esc(product.id)+'">'+(active(product)?'Arsipkan produk':'Aktifkan produk')+'</button></div></div><div class="mm-blank-toolbar"><label><span class="sr-only">Cari blank produk terpilih</span><input type="search" id="mm-blank-search" value="'+esc(this.blankFilter)+'" placeholder="Cari diameter atau BC"></label><button type="button" class="button primary" data-mm-action="new-blank" data-mm-id="'+esc(product.id)+'">+ Tambah blank</button></div><div class="mm-table-scroll"><table class="mm-table"><caption class="sr-only">Spesifikasi blank untuk '+esc(product.code)+'</caption><thead><tr><th>BC</th><th>Diameter</th><th>CT bahan</th><th>ET bahan</th><th>Aturan</th><th>Status</th><th>Aksi</th></tr></thead><tbody>'+blankRows.map(b=>{
        const ruleCount=m.rules.filter(r=>r.blankId===b.id).length;
        return '<tr class="'+(!active(b)?'is-archived':'')+'"><td><strong>'+fmt(b.baseCurve)+'</strong></td><td>'+fmt(b.diameter)+' <small>mm</small></td><td>'+fmt(b.ct)+' <small>mm</small></td><td>'+fmt(b.et)+' <small>mm</small></td><td>'+ruleCount+'<small>'+((b.opticalProfile||product.opticalProfile)?'Profil finishing tersedia':'Tanpa profil finishing')+'</small></td><td>'+statusBadge(b)+'</td><td><div class="mm-row-actions"><button type="button" class="text-button" data-mm-action="edit-blank" data-mm-id="'+esc(b.id)+'" aria-label="Ubah blank BC '+esc(b.baseCurve)+' diameter '+esc(b.diameter)+'">Ubah</button><button type="button" class="text-button" data-mm-action="copy-blank" data-mm-id="'+esc(b.id)+'">Salin</button><button type="button" class="text-button mm-muted-action" data-mm-action="toggle-blank" data-mm-id="'+esc(b.id)+'">'+(active(b)?'Arsipkan':'Aktifkan')+'</button></div></td></tr>';
      }).join('')+'</tbody></table>'+(blankRows.length?'':'<div class="mm-empty"><strong>Belum ada blank yang ditampilkan.</strong><p>Tambahkan spesifikasi blank atau tampilkan arsip.</p></div>')+'</div><p class="mm-footnote">'+blankRows.length+' dari '+allBlanks.length+' blank produk ini. BC mengikuti konvensi sumber; bukan otomatis power optik permukaan.</p>':'<div class="mm-empty"><h3>Tambahkan produk bahan pertama.</h3><p>Setelah produk tersedia, isi diameter, BC, CT/ET bahan, dan aturan power blank.</p></div>')+'</section></div>';
    }
    _shapesHtml(){
      const rows=this.catalogs.shapes.items.filter(s=>this._matches(s,[s.code,s.name]));
      return '<div class="mm-section-actions"><button type="button" class="button primary" data-mm-action="new-shape">+ Tambah frame shape</button><p>Arsip mempertahankan identitas bentuk untuk riwayat. Bentuk aktif tersedia di Studio.</p></div><div class="mm-shape-grid">'+rows.map(s=>'<article class="mm-shape-card '+(!active(s)?'is-archived':'')+'"><div class="mm-card-top"><span class="mm-record-code">'+esc(s.code)+'</span>'+statusBadge(s)+'</div><div class="mm-shape-preview">'+svgPreview(s.points,s.defaultWidthMm||52,s.defaultHeightMm||38)+'</div><h3>'+esc(s.name)+'</h3><p>'+(s.defaultWidthMm&&s.defaultHeightMm?'A '+fmt(s.defaultWidthMm)+' · B '+fmt(s.defaultHeightMm)+' mm':'Ukuran diatur di Studio')+'</p><small>'+esc(s.source==='user-svg'?'Kontur SVG acuan':s.source==='screenshot'?'Referensi Lensware':'Kontur master')+' · '+s.points.length+' titik</small><div class="mm-card-actions"><button type="button" class="button secondary" data-mm-action="edit-shape" data-mm-id="'+esc(s.code)+'" aria-label="Ubah frame '+esc(s.name)+'">Ubah</button><button type="button" class="text-button" data-mm-action="copy-shape" data-mm-id="'+esc(s.code)+'">Salin</button><button type="button" class="text-button mm-muted-action" data-mm-action="toggle-shape" data-mm-id="'+esc(s.code)+'">'+(active(s)?'Arsipkan':'Aktifkan')+'</button></div></article>').join('')+'</div>'+(rows.length?'':'<div class="mm-empty"><h3>Tidak ada bentuk yang sesuai.</h3><p>Ubah pencarian atau tampilkan arsip.</p></div>');
    }
    _tintsHtml(){
      const rows=this.catalogs.tints.items.filter(t=>this._matches(t,[t.code,t.name,t.group,t.kind])),shown=rows.slice(0,this.tintLimit);
      return '<div class="mm-section-actions"><button type="button" class="button primary" data-mm-action="new-tint">+ Tambah tint</button><button type="button" class="button secondary" data-mm-action="navigate-reference">Lihat lembar acuan warna ↗</button><p>Warna digital bukan pengukuran transmisi atau resep pewarnaan.</p></div><div class="mm-tint-grid">'+shown.map(t=>'<article class="mm-tint-card '+(!active(t)?'is-archived':'')+'"><div class="mm-card-top"><span class="mm-record-code">'+esc(t.code)+'</span>'+statusBadge(t)+'</div><div class="mm-tint-sample '+(!t.previewHex?'no-color':'')+'" style="'+swatchStyle(t)+'">'+(!t.previewHex?'<span>'+(t.referenceStatus==='percent-conflict'?'Acuan konflik':'Tanpa warna baku')+'</span>':'')+'</div><h3>'+esc(t.name)+'</h3><p>'+esc(t.kind==='Gradient'?'Gradasi':'Solid')+' · '+esc({fashion:'Regular',sunglass:'Sunglass',therapeutic:'Therapeutic',special:'Khusus'}[t.group]||t.group)+(t.nominalPercent!==null?' · label '+fmt(t.nominalPercent)+'%':'')+'</p><small class="'+(t.referenceStatus==='percent-conflict'?'mm-warning-text':'')+'">'+esc(t.referenceStatus==='percent-conflict'?'Konflik acuan belum diselesaikan':t.referenceStatus==='manual'?'Acuan digital manual':t.referenceStatus==='missing'?'Memerlukan acuan tambahan':'Memiliki rujukan sumber')+'</small><div class="mm-card-actions"><button type="button" class="button secondary" data-mm-action="edit-tint" data-mm-id="'+esc(t.code)+'" aria-label="Ubah tint '+esc(t.code)+'">Ubah</button><button type="button" class="text-button" data-mm-action="copy-tint" data-mm-id="'+esc(t.code)+'">Salin</button><button type="button" class="text-button mm-muted-action" data-mm-action="toggle-tint" data-mm-id="'+esc(t.code)+'">'+(active(t)?'Arsipkan':'Aktifkan')+'</button></div></article>').join('')+'</div>'+(rows.length>shown.length?'<div class="mm-load-more"><button type="button" class="button secondary" data-mm-action="more-tints">Tampilkan lebih banyak ('+(rows.length-shown.length)+')</button></div>':'')+(rows.length?'':'<div class="mm-empty"><h3>Tidak ada tint yang sesuai.</h3><p>Ubah pencarian atau tampilkan arsip.</p></div>');
    }
    _notice(message,kind='success'){
      this.notice=message;this.noticeKind=kind;
      const el=this._q('#mm-notice');if(el){el.hidden=!message;el.textContent=message;el.className='mm-notice '+kind;}
      this.onNotify(message);
    }
    _editorErrors(errors){const el=this._q('#mm-editor-error');if(el){el.hidden=!errors.length;el.innerHTML=errors.map(e=>'<p>'+esc(e)+'</p>').join('');}}
    _importErrors(errors){const el=this._q('#mm-import-error');if(el){el.hidden=!errors.length;el.innerHTML=errors.map(e=>'<p>'+esc(e)+'</p>').join('');}}
    _find(type,id){
      return type==='product'?this.catalogs.materials.products.find(r=>r.id===id):
        type==='blank'?this.catalogs.materials.blanks.find(r=>r.id===id):
        type==='shape'?this.catalogs.shapes.items.find(r=>r.code===id):this.catalogs.tints.items.find(r=>r.code===id);
    }
    openEditor(type,id=null,{duplicate=false,productId}={}){
      if(this.saving)return false;
      if(!this.closeEditor())return false;
      const record=id?this._find(type,id):null;
      if(id&&!record){this._notice('Record tidak ditemukan. Muat ulang data master.','warning');return false;}
      this.draft=makeDraft(type,record,this.catalogs,{duplicate,productId:productId||this.productId});
      this._renderEditor();
      const dialog=this._q('#mm-editor-dialog');if(!dialog.open)dialog.showModal();
      const first=dialog.querySelector('input:not([readonly]):not([type=checkbox]),select');first?.focus();
      return true;
    }
    closeEditor(force=false){
      if(this.saving&&!force)return false;
      if(!force&&this.draft?.dirty&&global.confirm&&!global.confirm('Perubahan master belum disimpan. Buang draft?'))return false;
      const d=this._q('#mm-editor-dialog');if(d?.open)d.close();
      this.draft=null;return true;
    }
    _renderEditor(){
      const d=this.draft;if(!d)return;
      const titles={product:'produk bahan',blank:'blank / raw material',shape:'frame shape',tint:'tinting'};
      this._q('#mm-editor-title').textContent=(d.original?'Ubah ':'Tambah ')+titles[d.type];
      this._q('#mm-editor-kicker').textContent=d.original?'IDENTITAS MASTER TETAP':'RECORD BARU';
      this._editorErrors([]);
      const v=d.values;
      let body='';
      if(d.type==='product') {
        body='<div class="mm-form-grid">'+input('Kode produk','code',v.code,{required:true,maxlength:64})+input('Supplier','supplier',v.supplier,{required:true,maxlength:80})+input('Nama bahan','name',v.name,{required:true,maxlength:180})+select('Indeks bahan','index',v.index,INDICES.map(n=>[n,n+(n==='1.59'?' · katalog saja':'')]),{required:true})+'</div><div class="mm-form-note">Indeks 1.59 tetap disimpan sebagai data katalog; simulator menyediakan enam indeks yang telah ditetapkan. Perubahan supplier/indeks harus tetap cocok dengan assignment SKU yang ada.</div>'+check('Produk aktif','active',v.active)+this._profileHtml(d.profile);
      } else if(d.type==='blank') {
        const productOptions=this.catalogs.materials.products.map(p=>[p.id,p.supplier+' · '+p.code+' · '+p.index+(!active(p)?' · arsip':'')]);
        body='<div class="mm-form-grid">'+select('Produk bahan','productId',v.productId,productOptions,{required:true})+input('Base curve · sesuai sumber','baseCurve',v.baseCurve,{type:'number',required:true,step:'.01',min:0,max:30})+input('Diameter blank · mm','diameter',v.diameter,{type:'number',required:true,step:'.1',min:20,max:150})+input('CT bahan baku · mm','ct',v.ct,{type:'number',required:true,step:'.01',min:'.1',max:50})+input('ET bahan baku · mm','et',v.et,{type:'number',required:true,step:'.01',min:'.1',max:50})+'</div>'+check('Blank aktif','active',v.active)+'<p class="mm-form-note">CT dan ET di atas adalah ukuran blank mentah. Nilai ini tidak dipakai sebagai ketebalan lensa jadi. Jangan menganggap angka BC sebagai power permukaan sebelum konvensi supplier dikonfirmasi.</p>'+this._profileHtml(d.profile)+'<div class="mm-subsection-heading"><div><h3>Aturan power bahan</h3><p>Setiap baris merupakan satu rentang yang diperbolehkan. Gunakan CYL minus; batas bersifat inklusif.</p></div><button type="button" class="button secondary" data-mm-action="add-rule">+ Aturan</button></div><div class="mm-rule-scroll"><table class="mm-table mm-rule-table"><thead><tr><th>No.</th>'+POWER_LABELS.map(l=>'<th>'+l+'</th>').join('')+'<th>Aksi</th></tr></thead><tbody>'+d.rules.map((r,i)=>'<tr><td>'+(i+1)+'</td>'+POWER_FIELDS.map((k,j)=>'<td><input type="number" step=".01" required data-mm-rule="'+i+'" data-mm-power="'+k+'" value="'+esc(r[k])+'" aria-label="Aturan '+(i+1)+' '+POWER_LABELS[j]+'"></td>').join('')+'<td><button type="button" class="text-button" data-mm-action="remove-rule" data-mm-rule="'+i+'" aria-label="Hapus aturan '+(i+1)+'">Hapus</button></td></tr>').join('')+'</tbody></table></div>';
      } else if(d.type==='shape') {
        body='<div class="mm-shape-editor"><div><div class="mm-form-grid">'+input('Kode bentuk','code',v.code,{required:true,readonly:!!d.original,maxlength:64,help:d.original?'Kode tetap agar riwayat masih mengenali bentuk ini.':'Gunakan huruf, angka, titik, minus, atau underscore.'})+input('Nama bentuk','name',v.name,{required:true,maxlength:140})+input('Lebar awal A · mm','defaultWidthMm',v.defaultWidthMm,{type:'number',required:true,min:35,max:70,step:'.1'})+input('Tinggi awal B · mm','defaultHeightMm',v.defaultHeightMm,{type:'number',required:true,min:25,max:60,step:'.1'})+'</div>'+check('Bentuk aktif','active',v.active)+'</div><div id="mm-shape-live" class="mm-shape-live">'+svgPreview(d.record.points,v.defaultWidthMm,v.defaultHeightMm)+'</div></div><label class="mm-field"><span>Sumber kontur</span><select id="mm-contour-mode">'+(d.original||d.contourMode==='keep'?'<option value="keep"'+(d.contourMode==='keep'?' selected':'')+'>Pertahankan kontur yang disimpan</option>':'')+'<option value="ellipse"'+(d.contourMode==='ellipse'?' selected':'')+'>Preset ellipse / rounded</option><option value="rounded-rectangle"'+(d.contourMode==='rounded-rectangle'?' selected':'')+'>Preset rectangle dengan sudut halus</option><option value="points"'+(d.contourMode==='points'?' selected':'')+'>Titik kontur JSON</option></select></label><div class="mm-form-note">Preset adalah ilustrasi. Untuk mengikuti frame tertentu, masukkan titik tracing yang valid. Koordinat dinormalisasi ke -0,5…0,5, berurutan sepanjang tepi, tanpa menyilang. Lebar/tinggi aktual tetap dapat diatur di Studio.</div><label class="mm-field mm-contour-field"'+(d.contourMode==='points'?'':' hidden')+'><span>Titik [x,y] · 4–512 titik</span><textarea id="mm-shape-points" rows="8" spellcheck="false">'+esc(d.pointsText)+'</textarea></label>';
      } else if(d.type==='tint') {
        body='<div class="mm-tint-editor-head"><div class="mm-form-grid">'+input('Kode tint','code',v.code,{required:true,readonly:!!d.original,maxlength:64,help:d.original?'Kode tetap agar konsultasi lama masih terhubung.':'Contoh: CUSTOM-BLUE atau 49S.'})+input('Nama tint','name',v.name,{required:true,maxlength:160})+select('Jenis tint','kind',v.kind,[['Solid','Solid'],['Gradient','Gradasi']])+select('Kelompok','group',v.group,[['fashion','Regular'],['sunglass','Sunglass'],['therapeutic','Therapeutic'],['special','Khusus']])+input('Label persentase · opsional','nominalPercent',v.nominalPercent,{type:'number',min:0,max:100,step:'.1',help:'Label katalog, bukan nilai transmisi/VLT terukur.'})+'</div><div id="mm-tint-live" class="mm-tint-live '+(!v.previewEnabled?'no-color':'')+'" style="'+(v.previewEnabled?swatchStyle(v):'')+'"></div></div>'+check('Tint aktif','active',v.active)+check('Memerlukan contoh lensa fisik','requiresPhysicalSample',v.requiresPhysicalSample)+(d.original?.referenceStatus==='percent-conflict'?'<div class="mm-reference-conflict"><strong>Acuan '+esc(d.original.code)+' belum konsisten.</strong><p>'+esc(d.original.referenceNote)+'</p>'+check('Saya memiliki acuan pengganti untuk koreksi warna','overrideReference',v.overrideReference)+input('Acuan koreksi','manualReference',v.manualReference,{maxlength:500,help:'Cantumkan dokumen/sampel yang menjadi dasar koreksi.'})+'</div>':'')+'<div class="mm-colors">'+check('Aktifkan pratinjau warna baku','previewEnabled',v.previewEnabled)+'<div class="mm-color-grid">'+this._colorField('Warna atas / solid','previewHex',v.previewHex)+this._colorField('Warna tengah · opsional','previewMidHex',v.previewMidHex)+this._colorField('Warna bawah gradasi','previewBottomHex',v.previewBottomHex)+'</div><p class="mm-form-note">Perubahan warna ditandai sebagai acuan digital manual. Warna layar tidak membuktikan hasil pewarnaan, kompatibilitas bahan, atau transmisi lensa.</p></div><label class="mm-field"><span>Catatan acuan</span><textarea data-mm-field="referenceNote" maxlength="2000" rows="3">'+esc(v.referenceNote)+'</textarea></label>';
        if(['CON','CONG','NOTE'].includes(d.original?.code))body+='<p class="mm-form-note">Kode '+esc(d.original.code)+' memakai warna pilihan per konsultasi di Studio. Acuan warna baku pada master ini tidak menggantikan warna konsultasi tersebut.</p>';
      }
      body+='<p class="mm-record-identity">Identitas tersimpan: '+esc(d.record.id||d.originalKey||'dibuat saat disimpan')+'</p>';
      this._q('#mm-editor-body').innerHTML=body;
      this._updateConditionalFields();
    }
    _profileHtml(p){
      return '<details class="mm-profile"'+(p.enabled?' open':'')+'><summary>Parameter finishing lab <span>'+(p.enabled?'Profil tersedia':'Opsional')+'</span></summary><p>Profil ini terpisah dari CT/ET blank mentah. Profil blank menggantikan profil produk hanya ketika blank tersebut dipilih. Parameter lab bukan jaminan hasil produksi identik.</p>'+check('Gunakan profil finishing pada record ini','enabled',p.enabled,{profile:true})+'<div class="mm-profile-fields"'+(p.enabled?'':' hidden')+'><div class="mm-form-grid">'+input('Minimum CT finishing · mm','minCenterMm',p.minCenterMm,{profile:true,type:'number',required:true,min:'.5',max:10,step:'.01'})+input('Minimum ET finishing · mm','minEdgeMm',p.minEdgeMm,{profile:true,type:'number',required:true,min:'.5',max:10,step:'.01'})+select('Input permukaan depan','measure',p.measure,[['power','Power permukaan (D)'],['radius','Radius permukaan (mm)']],{profile:true})+input('Power permukaan depan · D','frontPowerD',p.frontPowerD,{profile:true,type:'number',required:true,min:0,max:20,step:'.01'})+input('Radius permukaan depan · mm','frontRadiusMm',p.frontRadiusMm,{profile:true,type:'number',min:20,max:5000,step:'.01'})+select('Dasar power kurva','frontCurveBasis',p.frontCurveBasis,[['material','Indeks material lensa'],['reference-index','Indeks acuan alat/supplier']],{profile:true})+input('Indeks acuan kurva','curveReferenceIndex',p.curveReferenceIndex,{profile:true,type:'number',required:true,min:'1.3',max:2,step:'.001'})+select('Asal parameter','source',p.source,[['assumption','Asumsi / belum dikalibrasi'],['lab','Parameter dari lab']],{profile:true})+'</div><label class="mm-field"><span>Acuan parameter lab</span><textarea data-mm-profile="reference" rows="2" maxlength="500" placeholder="Nama dokumen, sampel, atau referensi pengukuran">'+esc(p.reference)+'</textarea><small>Wajib diisi untuk parameter dari lab. Model saat ini memakai permukaan sferis; koefisien asferis tidak ditebak.</small></label></div></details>';
    }
    _colorField(label,key,value){
      return '<label class="mm-field mm-color-field"><span>'+esc(label)+'</span><span><input type="color" data-mm-color="'+key+'" value="'+(hex(value)||'#808080')+'" aria-label="Pilih '+esc(label.toLowerCase())+'"><input type="text" data-mm-field="'+key+'" value="'+esc(value)+'" placeholder="#RRGGBB" maxlength="7" spellcheck="false" aria-label="'+esc(label)+' kode hex"></span></label>';
    }
    _updateConditionalFields(){
      const d=this.draft;if(!d)return;
      if(d.profile) {
        const fields=this._q('.mm-profile-fields');if(fields)fields.hidden=!d.profile.enabled;
        for(const el of this.root.querySelectorAll('[data-mm-profile]')) {
          const name=el.dataset.mmProfile;
          const conditional=name==='frontPowerD'?d.profile.measure!=='power':name==='frontRadiusMm'?d.profile.measure!=='radius':
            ['frontCurveBasis','curveReferenceIndex'].includes(name)?d.profile.measure!=='power'||(name==='curveReferenceIndex'&&d.profile.frontCurveBasis!=='reference-index'):false;
          el.disabled=name!=='enabled'&&(!d.profile.enabled||conditional);
          if(['frontPowerD','frontRadiusMm','frontCurveBasis','curveReferenceIndex'].includes(name))el.closest('.mm-field').hidden=conditional;
        }
      }
      if(d.type==='tint') {
        const conflict=d.original?.referenceStatus==='percent-conflict'&&!d.values.overrideReference;
        for(const el of this.root.querySelectorAll('[data-mm-color],.mm-color-grid [data-mm-field]')) {
          const key=el.dataset.mmColor||el.dataset.mmField;
          el.disabled=!d.values.previewEnabled||conflict||(d.values.kind==='Solid'&&key!=='previewHex');
        }
        const enabled=this._q('[data-mm-field="previewEnabled"]');if(enabled)enabled.disabled=conflict;
      }
    }
    _updateLivePreview(){
      const d=this.draft;if(!d)return;
      if(d.type==='shape') {
        const p=this._q('#mm-shape-live');
        try{const points=d.contourMode==='points'?parsePoints(d.pointsText):['ellipse','rounded-rectangle'].includes(d.contourMode)?generatedPoints(d.contourMode):d.record.points;p.innerHTML=svgPreview(points,d.values.defaultWidthMm,d.values.defaultHeightMm);}catch{p.innerHTML='<span>Periksa JSON kontur.</span>';}
      } else if(d.type==='tint') {
        const p=this._q('#mm-tint-live');p.classList.toggle('no-color',!d.values.previewEnabled||!hex(d.values.previewHex));
        p.setAttribute('style',d.values.previewEnabled?swatchStyle(d.values):'');
      }
    }
    _setSaving(saving){
      this.saving=saving;this.root.setAttribute('aria-busy',String(saving));
      if(saving){this._disabled=[...this.root.querySelectorAll('button,input,select,textarea')].map(el=>[el,el.disabled]);for(const [el]of this._disabled)el.disabled=true;}
      else{for(const [el,disabled]of this._disabled)if(this.root.contains(el))el.disabled=disabled;this._disabled=[];this._updateConditionalFields();}
      const save=this._q('#mm-save');if(save)save.textContent=saving?'Menyimpan…':'Simpan master';
    }
    async _commit(next,success,{base=stable(this.catalogs),closeEditor=false,closeImport=false}={}){
      if(this.saving)return false;
      if(base!==stable(this.catalogs)){const message='Master telah berubah sejak editor dibuka. Ekspor draft, lalu buka ulang record sebelum menyimpan.';this._editorErrors([message]);this._importErrors([message]);this._notice(message,'warning');return false;}
      let value;
      try{value=checked(next,{previous:this.catalogs,skuCatalog:skuEnvelope(this.getSkus())});}
      catch(e){this._editorErrors(e.validationErrors||[e.message]);this._importErrors(e.validationErrors||[e.message]);this._notice(e.message,'warning');return false;}
      this._setSaving(true);
      try{
        const response=await this.saveCatalogs(clone(value));
        const acknowledged=response?.value||response?.catalogs||response;
        if(!acknowledged?.materials||!acknowledged?.shapes||!acknowledged?.tints)throw Error('Konfirmasi master dari penyimpanan belum lengkap. Muat ulang untuk memeriksa data yang tersimpan.');
        this.catalogs=clone(acknowledged);
        if(closeEditor)this.closeEditor(true);
        if(closeImport)this.closeImport(true);
        this.render();
        try{this.onChange(clone(this.catalogs));}catch{this._notice('Master tersimpan, tetapi preview belum diperbarui. Muat ulang aplikasi.','warning');return true;}
        this._notice(success);
        return true;
      }catch(e){
        if(e?.status===409||e?.code==='revision_conflict'||e?.code==='CONFLICT') {
          if(this.draft)this.draft.stale=true;
          if(this.importReview)this.importReview.stale=true;
          if(e.document?.value?.materials) {
            this.catalogs=clone(e.document.value);
            this.render();
            try{this.onChange(clone(this.catalogs));}catch{}
          }
        }
        const message=e?.message||'Master belum tersimpan. Periksa koneksi dan coba kembali.';
        this._editorErrors([message]);this._importErrors([message]);this._notice(message,'warning');return false;
      }finally{this._setSaving(false);}
    }
    async _saveEditor(){
      const d=this.draft;if(!d||this.saving)return false;
      if(d.stale){this._editorErrors(['Master berubah di sesi lain. Ekspor draft bila diperlukan, kemudian buka ulang record untuk meninjau data terbaru.']);return false;}
      try{
        const next=buildCandidate(this.catalogs,d);
        const saved=await this._commit(next,'Master berhasil disimpan.',{base:d.base,closeEditor:true});
        if(saved){
          if(d.type==='product'){this.productId=d.record.id;this.filter.materials='';}
          if(d.type==='blank'){this.productId=d.values.productId;this.blankFilter='';this.filter.materials='';}
          if(!d.original&&d.type==='shape')this.filter.shapes=text(d.values.code);
          if(!d.original&&d.type==='tint')this.filter.tints=text(d.values.code);
          this.render();
        }
        return saved;
      }catch(e){this._editorErrors(e.validationErrors||[e.message]);return false;}
    }
    async toggle(type,id){
      if(this.saving)return false;
      const record=this._find(type,id);if(!record)return false;
      const next=clone(this.catalogs),target=type==='product'?next.materials.products.find(r=>r.id===id):type==='blank'?next.materials.blanks.find(r=>r.id===id):type==='shape'?next.shapes.items.find(r=>r.code===id):next.tints.items.find(r=>r.code===id);
      target.active=!active(record);
      return this._commit(next,target.active?'Master diaktifkan kembali.':'Master diarsipkan. Identitas dan data sumber tetap tersimpan.');
    }
    exportCatalogs(value=this.catalogs,{draft=false}={}){
      const date=new Date().toISOString();
      const payload={schema:IMPORT_SCHEMA,exportedAt:date,storageMode:this.mode,draft, cataloguesAreLiveStock:false,catalogs:clone(value)};
      this._download(payload,'Leinz-Master-Data'+(draft?'-Draft':'')+'-'+date.slice(0,10)+'.json');
    }
    _download(payload,filename){
      const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
      const url=global.URL.createObjectURL(blob),a=global.document.createElement('a');
      a.href=url;a.download=filename;global.document.body.append(a);a.click();a.remove();setTimeout(()=>global.URL.revokeObjectURL(url),1000);
    }
    async readImport(file){
      if(!file||this.saving)return false;
      const token=(this.importReadToken||0)+1;this.importReadToken=token;
      const kind=this.tab;this.importReview=null;this._importErrors([]);
      const dialog=this._q('#mm-import-dialog'),content=this._q('#mm-import-content'),apply=this._q('#mm-apply-import');
      content.innerHTML='<p class="mm-import-file">'+esc(file.name)+'</p><p role="status">Membaca dan memvalidasi seluruh baris…</p>';apply.disabled=true;
      if(!dialog.open)dialog.showModal();
      try{
        if(file.size>8*1024*1024)throw Error('Berkas master maksimal 8 MiB.');
        let payload,info=null;
        if(/\.json$/i.test(file.name)){
          try{payload=JSON.parse(await file.text());}catch{throw Error('Berkas JSON tidak dapat dibaca. Gunakan hasil Ekspor semua master.');}
        }else{
          const api=tabular();if(!api)throw Error('Pembaca impor belum dimuat. Muat ulang aplikasi.');
          const parsed=await api.readFile(file);
          if(token!==this.importReadToken)return false;
          const prepared=api.buildMasterImport(this.catalogs,parsed,{kind,skuCatalog:this.getSkus()});
          payload=prepared.payload;info=prepared.info;
        }
        if(token!==this.importReadToken)return false;
        const plan=importPlan(this.catalogs,payload,{skuCatalog:this.getSkus()});
        this.importReview={...plan,filename:file.name,info,stale:false};
        this._importErrors([]);
        content.innerHTML='<p class="mm-import-file">'+esc(file.name)+'</p>'+(info?tabular().reviewMarkup(info):'<p>Master akan diperbarui sebagai satu kesatuan. Record yang sudah ada harus dipertahankan; gunakan status arsip untuk menonaktifkannya.</p>')+'<div class="mm-table-scroll"><table class="mm-table"><thead><tr><th>Master</th><th>Baru</th><th>Berubah</th><th>Diarsipkan</th><th>Dihapus</th><th>Total</th></tr></thead><tbody>'+plan.changes.map(c=>'<tr><td>'+esc(c.label)+'</td><td>'+c.added+'</td><td>'+c.updated+'</td><td>'+c.archived+'</td><td>'+c.removed+'</td><td>'+c.total+'</td></tr>').join('')+'</tbody></table></div><p class="mm-form-note">Assignment SKU diperiksa terhadap identitas produk/blank. Semua perubahan diterapkan sekaligus setelah konfirmasi penyimpanan.</p>'+(!plan.changed?'<div class="mm-notice">Isi master sama dengan data yang telah dimuat. Tidak diperlukan penyimpanan ulang. Identitas dan sumber master sebelumnya tetap digunakan.</div>':'');
        apply.disabled=!plan.changed;return true;
      }catch(e){
        if(token!==this.importReadToken)return false;
        this.importReview=null;apply.disabled=true;
        content.innerHTML='<p class="mm-import-file">'+esc(file.name)+'</p>'+(tabular()?.errorMarkup(e)||'<p>'+esc(e.message)+'</p>');
        this._notice('Impor belum diterapkan. Periksa rincian kesalahan pada tinjauan berkas.','warning');return false;
      }
    }
    closeImport(force=false){
      if(this.saving&&!force)return false;
      this.importReadToken=(this.importReadToken||0)+1;
      const dialog=this._q('#mm-import-dialog');if(dialog?.open)dialog.close();this.importReview=null;return true;
    }
    async applyImport(){
      const plan=this.importReview;if(!plan||!plan.changed||this.saving)return false;
      if(plan.stale){this._importErrors(['Master telah berubah. Tutup dialog dan tinjau ulang berkas.']);return false;}
      return this._commit(plan.value,'Impor master berhasil disimpan.',{base:plan.base,closeImport:true});
    }
    _handleClick(event){
      const button=event.target.closest('[data-mm-action]');if(!button||!this.root.contains(button))return;
      const action=button.dataset.mmAction,id=button.dataset.mmId;
      if(this.saving)return;
      if(action==='select-product'){this.productId=id;this.blankFilter='';this._renderList();return;}
      if(action==='export'){this.exportCatalogs();return;}
      if(action==='export-draft'){
        try{this.exportCatalogs(buildCandidate(this.catalogs,this.draft),{draft:true});}catch(e){this._editorErrors([e.message]);}return;
      }
      if(action==='cancel-editor'){this.closeEditor();return;}
      if(action==='cancel-import'){this.closeImport();return;}
      if(action==='apply-import'){this.applyImport();return;}
      if(action==='navigate-screening'||action==='navigate-reference'){if(this.confirmLeave())this.onNavigate(action==='navigate-screening'?'screening':'reference');return;}
      if(action==='more-tints'){this.tintLimit+=24;this._renderList();return;}
      if(action==='add-rule'&&this.draft?.type==='blank'){
        this.draft.rules.push({id:uid('rule'),blankId:this.draft.record.id,source:'managed',sourceRows:[],exactDuplicateCount:0,hasExactDuplicates:false,...Object.fromEntries(POWER_FIELDS.map(k=>[k,'']))});
        this.draft.dirty=true;this._renderEditor();return;
      }
      if(action==='remove-rule'&&this.draft?.type==='blank'){
        this.draft.rules.splice(Number(button.dataset.mmRule),1);this.draft.dirty=true;this._renderEditor();return;
      }
      const match=/^(new|edit|copy|toggle)-(product|blank|shape|tint)$/.exec(action);
      if(match){
        const [,verb,type]=match;
        if(verb==='toggle'){this.toggle(type,id);return;}
        this.openEditor(type,verb==='new'?null:id,{duplicate:verb==='copy',productId:type==='blank'&&verb==='new'?id:undefined});
      }
    }
    _handleInput(event){
      const el=event.target;
      if(el.id==='mm-search'){this.filter[this.tab]=el.value;this.tintLimit=24;this._renderList();return;}
      if(el.id==='mm-blank-search'){
        const position=el.selectionStart;this.blankFilter=el.value;this._renderList();const next=this._q('#mm-blank-search');next.focus();if(position!==null)next.setSelectionRange(position,position);return;
      }
      if(!this.draft||this.saving)return;
      const d=this.draft;
      if(el.dataset.mmField){d.values[el.dataset.mmField]=el.type==='checkbox'?el.checked:el.value;d.dirty=true;}
      if(el.dataset.mmProfile){d.profile[el.dataset.mmProfile]=el.type==='checkbox'?el.checked:el.value;d.dirty=true;}
      if(el.dataset.mmRule!==undefined&&el.dataset.mmPower&&d.rules[Number(el.dataset.mmRule)]){d.rules[Number(el.dataset.mmRule)][el.dataset.mmPower]=el.value;d.dirty=true;}
      if(el.id==='mm-shape-points'){d.pointsText=el.value;d.dirty=true;}
      if(el.dataset.mmColor){
        d.values[el.dataset.mmColor]=el.value;d.dirty=true;
        const target=this._q('[data-mm-field="'+el.dataset.mmColor+'"]');if(target)target.value=el.value;
      }
      this._updateConditionalFields();this._updateLivePreview();
    }
    _handleChange(event){
      const el=event.target;
      if(el.id==='mm-show-archived'){this.showArchived=el.checked;this._renderList();return;}
      if(el.id==='mm-import-file'){const file=el.files?.[0];this.readImport(file);el.value='';return;}
      if(el.id==='mm-contour-mode'&&this.draft?.type==='shape'){
        this.draft.contourMode=el.value;this.draft.dirty=true;
        if(el.value==='points'&&this.draft.pointsText==='')this.draft.pointsText=JSON.stringify(this.draft.record.points,null,2);
        const field=this._q('.mm-contour-field');field.hidden=el.value!=='points';this._updateLivePreview();
      }
      this._handleInput(event);
    }
  }
  const api={LeinzMasterManager,MasterUiModel:{IMPORT_SCHEMA,counts,importPlan,generatedPoints,parsePoints,profileDraft,collectProfile,buildCandidate,makeDraft,stable,equal}};
  global.LeinzMasterManager=LeinzMasterManager;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);

