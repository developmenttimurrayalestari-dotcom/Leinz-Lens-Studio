/* Finished-product SKU master. Catalogue assignments do not represent live stock. */
(function (global) {
  'use strict';
  const SCHEMA = 'trl-sku-catalog/1.0';
  const STORAGE_KEY = 'leinz-sku-catalog-v1';
  const DEFAULT_INDICES = ['1.50','1.56','1.57','1.60','1.67','1.74'];
  const POWER_KEYS = ['sphMin','sphMax','cylMin','cylMax','addMin','addMax'];
  const clone = value => JSON.parse(JSON.stringify(value));
  const tabular = () => global.LeinzTabularImport || (typeof require==='function'?require('./tabular-import.js'):null);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const codeKey = value => String(value ?? '').trim().toLocaleUpperCase('en-US');
  const id = prefix => prefix + '-' + (global.crypto?.randomUUID?.() || Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));
  const validId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(value);
  const finite = value => (typeof value === 'number' || typeof value === 'string') && String(value).trim() !== '' && Number.isFinite(Number(value));
  const numberText = value => Number(value).toLocaleString('id-ID',{maximumFractionDigits:2});
  const emptyPower = () => Object.fromEntries(POWER_KEYS.map(key => [key,'']));
  const emptyRange = () => ({diameter:'',...emptyPower(),addMin:0,addMax:0});
  const emptyVariant = index => ({index,enabled:true,powerRanges:[emptyRange()],assignments:[]});
  function editableRanges(variant,materials) {
    if (Array.isArray(variant.powerRanges)) return variant.powerRanges;
    const power=variant.power||{},ids=new Set((variant.assignments||[]).flatMap(a=>a.blankIds||[]));
    const diameters=[...new Set((materials.blanks||[]).filter(b=>ids.has(b.id)&&
      (power.diameterMin==null||b.diameter>=power.diameterMin)&&(power.diameterMax==null||b.diameter<=power.diameterMax)).map(b=>b.diameter))].sort((a,b)=>a-b);
    const emptyDisabled=!variant.enabled&&!diameters.length&&POWER_KEYS.every(k=>power[k]==null||power[k]==='');
    variant.powerRanges=(diameters.length?diameters:emptyDisabled?[]:['']).map(diameter=>({diameter,...Object.fromEntries(POWER_KEYS.map(k=>[k,power[k]??'']))}));
    delete variant.power;
    return variant.powerRanges;
  }
  const skuContent = value => {
    const item=clone(value);delete item.createdAt;delete item.updatedAt;
    item.variants.sort((a,b)=>a.index.localeCompare(b.index));
    for(const v of item.variants){v.assignments.sort((a,b)=>a.productId.localeCompare(b.productId));for(const a of v.assignments)a.blankIds.sort();}
    return JSON.stringify(item,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
  };

  function validateSku(input, context = {}) {
    const errors = [], materials = context.materials || {}, indices = context.indices || DEFAULT_INDICES;
    const products = new Map((materials.products || []).map(p => [p.id,p]));
    const blanks = new Map((materials.blanks || []).map(b => [b.id,b]));
    if (!input || typeof input !== 'object' || Array.isArray(input)) return {ok:false,errors:['Format SKU harus berupa objek.'],sku:null};
    const code = typeof input.code === 'string' ? input.code.trim() : '';
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!validId(input.id)) errors.push('ID SKU tidak valid.');
    if (!code || code.length > 64 || /[\u0000-\u001f]/.test(code)) errors.push('Kode SKU wajib diisi, maksimal 64 karakter.');
    if (!name || name.length > 140 || /[\u0000-\u001f]/.test(name)) errors.push('Nama produk wajib diisi, maksimal 140 karakter.');
    if (typeof input.active !== 'boolean') errors.push('Status aktif SKU harus bernilai true atau false.');
    if ((context.existing || []).some(s => s.id !== input.id && codeKey(s.code) === codeKey(code))) errors.push('Kode SKU sudah digunakan oleh produk lain.');
    if (!Array.isArray(input.variants) || !input.variants.length) errors.push('Tambahkan setidaknya satu indeks pada SKU.');
    const seenIndices = new Set(), variants = [];
    for (const raw of Array.isArray(input.variants) ? input.variants : []) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { errors.push('Format varian indeks tidak valid.'); continue; }
      const index = raw.index, prefix = 'Indeks ' + String(index) + ': ';
      if (!indices.includes(index)) errors.push(prefix + 'tidak termasuk enam indeks simulator.');
      if (seenIndices.has(index)) errors.push(prefix + 'tercantum lebih dari satu kali.');
      seenIndices.add(index);
      if (typeof raw.enabled !== 'boolean') errors.push(prefix + 'status ketersediaan harus berupa boolean.');
      const power = {};
      const multiple = Object.hasOwn(raw,'powerRanges');
      let powerRanges;
      if (multiple) {
        powerRanges=[];
        if(!Array.isArray(raw.powerRanges)||raw.powerRanges.length>2000||(raw.enabled&&!raw.powerRanges.length))errors.push(prefix+'tambahkan minimal satu range power per diameter (maksimal 2.000 baris).');
        for(const [i,row]of (Array.isArray(raw.powerRanges)?raw.powerRanges:[]).entries()) {
          const label=prefix+'baris '+(i+1)+': ',range={};
          if(!row||typeof row!=='object'||Array.isArray(row)){errors.push(label+'format range tidak valid.');continue;}
          for(const key of ['diameter',...POWER_KEYS]) {
            if(!finite(row[key]))errors.push(label+key+' wajib berupa angka yang valid.');
            else range[key]=Number(row[key]);
          }
          if(range.diameter<20||range.diameter>150)errors.push(label+'diameter harus 20–150 mm.');
          for(const [lo,hi,name]of [['sphMin','sphMax','SPH'],['cylMin','cylMax','CYL'],['addMin','addMax','ADD']])if(range[lo]>range[hi])errors.push(label+'batas minimum '+name+' melebihi maksimum.');
          if(range.cylMin>0||range.cylMax>0)errors.push(label+'gunakan CYL minus (maksimum 0).');
          if(range.addMin<0||range.addMax<0)errors.push(label+'ADD tidak boleh negatif.');
          powerRanges.push(range);
        }
      } else {
      for (const key of POWER_KEYS) {
        const value = raw.power?.[key];
        if (finite(value)) power[key] = Number(value);
        else { power[key] = null; if (raw.enabled || (value !== '' && value !== null && value !== undefined)) errors.push(prefix + key + ' wajib berupa angka yang valid.'); }
      }
      for (const [from,to,label] of [['sphMin','sphMax','SPH'],['cylMin','cylMax','CYL'],['addMin','addMax','ADD']]) {
        if (power[from] !== null && power[to] !== null && power[from] > power[to]) errors.push(prefix + 'batas minimum ' + label + ' melebihi maksimum.');
      }
      if ([power.cylMin,power.cylMax].some(v => v !== null && v > 0)) errors.push(prefix + 'gunakan konvensi CYL minus (maksimum 0).');
      if ([power.addMin,power.addMax].some(v => v !== null && v < 0)) errors.push(prefix + 'ADD tidak boleh negatif.');
      const diameterKeys = ['diameterMin','diameterMax'];
      const hasDiameter = diameterKeys.some(key => raw.power?.[key] !== undefined && raw.power[key] !== null && String(raw.power[key]).trim() !== '');
      if (hasDiameter) {
        for (const key of diameterKeys) {
          const value = raw.power?.[key];
          if (!finite(value) || Number(value) < 20 || Number(value) > 150) errors.push(prefix + 'diameter minimum dan maksimum wajib berupa angka 20–150 mm.');
          else power[key] = Number(value);
        }
        if (power.diameterMin > power.diameterMax) errors.push(prefix + 'batas minimum diameter melebihi maksimum.');
      }
      }
      const assignments = [], seenProducts = new Set(), seenAssignments = new Set();
      if (!Array.isArray(raw.assignments)) errors.push(prefix + 'daftar assignment blank tidak valid.');
      for (const a of Array.isArray(raw.assignments) ? raw.assignments : []) {
        if (!a || typeof a !== 'object' || Array.isArray(a)) { errors.push(prefix + 'format assignment tidak valid.'); continue; }
        if (!validId(a.id)) errors.push(prefix + 'ID assignment tidak valid.');
        if (seenAssignments.has(a.id)) errors.push(prefix + 'ID assignment berulang.');
        seenAssignments.add(a.id);
        const p = products.get(a.productId);
        if (!p || !p.activeForSimulator) errors.push(prefix + 'produk bahan baku tidak ditemukan atau tidak aktif di simulator.');
        else {
          if (p.index !== index) errors.push(prefix + 'indeks produk bahan baku tidak sesuai.');
          if (p.supplier !== a.supplier) errors.push(prefix + 'supplier tidak sesuai dengan produk bahan baku.');
        }
        if (seenProducts.has(a.productId)) errors.push(prefix + 'produk bahan baku yang sama ditambahkan dua kali. Gabungkan pilihan blank pada satu assignment.');
        seenProducts.add(a.productId);
        if (!Array.isArray(a.blankIds)) errors.push(prefix + 'daftar blank tidak valid.');
        const blankIds = Array.isArray(a.blankIds) ? a.blankIds : [];
        if (new Set(blankIds).size !== blankIds.length) errors.push(prefix + 'ID blank berulang pada satu assignment.');
        if (raw.enabled && !blankIds.length) errors.push(prefix + 'pilih setidaknya satu blank untuk setiap assignment.');
        for (const blankId of blankIds) {
          const b = blanks.get(blankId);
          if (!b) errors.push(prefix + 'blank ' + String(blankId) + ' tidak tersedia dalam katalog.');
          else if (b.productId !== a.productId) errors.push(prefix + 'blank tidak berasal dari produk/supplier yang dipilih.');
        }
        assignments.push({id:a.id,supplier:a.supplier,productId:a.productId,blankIds:[...blankIds]});
      }
      if (raw.enabled && !assignments.length) errors.push(prefix + 'tambahkan supplier, produk bahan baku, dan blank yang boleh digunakan.');
      variants.push({index,enabled:raw.enabled === true,...(multiple?{powerRanges}:{power}),assignments});
    }
    if (input.active && !variants.some(v => v.enabled)) errors.push('SKU aktif harus mempunyai setidaknya satu indeks yang diaktifkan.');
    const sku = {id:input.id,code,name,active:input.active === true,variants,
      createdAt:typeof input.createdAt === 'string' ? input.createdAt : null,
      updatedAt:typeof input.updatedAt === 'string' ? input.updatedAt : null};
    return {ok:errors.length === 0,errors:[...new Set(errors)],sku:errors.length ? null : sku};
  }

  function validateCatalog(payload, context = {}) {
    if (!payload || typeof payload !== 'object' || payload.schema !== SCHEMA || !Array.isArray(payload.skus)) return {ok:false,errors:['Berkas harus memakai schema ' + SCHEMA + ' dan memiliki daftar skus.'],skus:[]};
    if (payload.skus.length > 1000) return {ok:false,errors:['Maksimum 1.000 SKU pada satu master.'],skus:[]};
    const skus = [], errors = [], codes = new Set(), ids = new Set();
    payload.skus.forEach((input,i) => {
      const check = validateSku(input,context);
      check.errors.forEach(e => errors.push('SKU ' + (i + 1) + ': ' + e));
      if (check.ok) {
        if (codes.has(codeKey(check.sku.code))) errors.push('Kode SKU berulang dalam berkas: ' + check.sku.code + '.');
        if (ids.has(check.sku.id)) errors.push('ID SKU berulang dalam berkas.');
        codes.add(codeKey(check.sku.code));ids.add(check.sku.id);skus.push(check.sku);
      }
    });
    return {ok:errors.length === 0,errors,skus:errors.length ? [] : skus};
  }

  function planImport(existing, payload, context = {}) {
    const checked = validateCatalog(payload,context);
    if (!checked.ok) return {ok:false,errors:checked.errors,skus:[],changes:[]};
    const next = clone(existing), changes = [], errors = [], unchanged = [], targets = new Set(), now = context.now || new Date().toISOString();
    for (const incoming of checked.skus) {
      const codeMatch = next.find(s => codeKey(s.code) === codeKey(incoming.code));
      const idMatch = next.find(s => s.id === incoming.id);
      if (codeMatch && idMatch && codeMatch.id !== idMatch.id) { errors.push('Kode dan ID mengarah ke SKU berbeda: ' + incoming.code + '.'); continue; }
      const target = codeMatch || idMatch;
      const targetId = target?.id || incoming.id;
      if (targets.has(targetId)) { errors.push('Beberapa baris impor mengarah ke SKU yang sama: ' + incoming.code + '.'); continue; }
      targets.add(targetId);
      if (target) {
        const replacement = {...incoming,id:target.id,createdAt:target.createdAt,updatedAt:now};
        if(skuContent(target)===skuContent(replacement)){unchanged.push({code:target.code,id:target.id});continue;}
        next[next.findIndex(s => s.id === target.id)] = replacement;
        changes.push({action:'update',code:incoming.code,previousCode:target.code,id:target.id,active:incoming.active});
      } else {
        next.push({...incoming,createdAt:incoming.createdAt || now,updatedAt:now});
        changes.push({action:'create',code:incoming.code,id:incoming.id,active:incoming.active});
      }
    }
    const finalCheck = validateCatalog({schema:SCHEMA,skus:next},context);
    errors.push(...finalCheck.errors);
    return {ok:errors.length === 0,errors,skus:errors.length ? [] : finalCheck.skus,changes:errors.length ? [] : changes,unchanged:errors.length ? [] : unchanged};
  }

  class SkuManager {
    constructor({container,materials,indices=DEFAULT_INDICES,onChange=()=>{},onNotify=()=>{},storage,storageMode='browser',getDocuments=()=>[]} = {}) {
      if (!container || !container.addEventListener) throw new TypeError('SkuManager memerlukan container DOM.');
      this.container=container;this.materials=materials;this.indices=indices;this.onChange=onChange;this.onNotify=onNotify;
      this.storage=storage;this.storageMode=['mysql','server'].includes(storageMode)?'mysql':'browser';this.saving=false;this._disabledControls=[];
      if(this.storage===undefined){try{this.storage=global.localStorage;}catch{this.storage=null;}}
      this.context={materials,indices};this.skus=[];this.storageSnapshot=null;this.storageError='';this.storageInvalid=false;this.draft=null;this.draftIndex=null;this.draftBase=null;this.importPlan=null;this.importBase=null;this.filter='';this.showInactive=false;
      this.selected=new Set();this.getDocuments=getDocuments;
      this.products=new Map(materials.products.map(p=>[p.id,p]));this.blanks=new Map(materials.blanks.map(b=>[b.id,b]));
      this._readStorage();this._renderShell();this._bind();
      this._storageEvent=e=>{if(e.key===STORAGE_KEY){this._readStorage();this._renderList();if(this.draft)this._editorErrors(['Master SKU berubah di tab lain. Periksa ulang sebelum menyimpan.']);this.onChange(this.getSkus({includeInactive:true}));}};
      if(this.storageMode==='browser')global.addEventListener?.('storage',this._storageEvent);
    }
    getSkus({includeInactive=false}={}) { return clone(this.skus.filter(s=>includeInactive||s.active)); }
    getSku(skuId) { const sku=this.skus.find(s=>s.id===skuId);return sku?clone(sku):null; }
    updateMaterials(materials) {
      this.materials=materials;this.context={materials,indices:this.indices};
      this.products=new Map(materials.products.map(p=>[p.id,p]));this.blanks=new Map(materials.blanks.map(b=>[b.id,b]));
      this._readStorage();this._renderList();
      if(this.draft){this._renderVariant();this._editorErrors(['Master bahan telah diperbarui. Tinjau kembali assignment sebelum menyimpan SKU.']);}
    }
    reloadFromStorage() {
      this._readStorage();this._renderList();this.onChange(this.getSkus({includeInactive:true}));
      if(this.draft){
        const current=this.skus.find(s=>s.id===this.draft.id);
        if(current&&current.updatedAt!==this.draftBase)this._editorErrors(['Master SKU terbaru sudah dimuat. Draft Anda tetap tersedia; salin perubahan yang diperlukan lalu buka ulang SKU sebelum menyimpan.']);
      }
      return !this.storageError&&!this.storageInvalid;
    }
    _q(selector) { return this.container.querySelector(selector); }
    _readStorage() {
      this.storageInvalid=false;
      try {
        const stored=this.storage.getItem(STORAGE_KEY);this.storageSnapshot=stored;
        if(!stored){this.skus=[];this.storageError='';return;}
        const check=validateCatalog(JSON.parse(stored),this.context);
        if(!check.ok){this.storageInvalid=true;this.storageError='Master tersimpan belum dapat dipakai: '+check.errors.slice(0,2).join(' ')+' Ekspor JSON menyimpan data pemulihan; impor berkas yang valid untuk mengganti master ini.';this.skus=[];return;}
        this.skus=check.skus;this.storageError='';
      }catch(e){this.storageInvalid=this.storageSnapshot!==null;this.storageError=this.storageInvalid?'Master tersimpan tidak dapat dibaca. Ekspor JSON untuk data pemulihan; impor berkas yang valid untuk mengganti master ini.':'Penyimpanan belum dapat dibaca. Data SKU belum dimuat.';this.skus=[];}
    }
    _envelope(skus=this.skus) {
      return {schema:SCHEMA,updatedAt:new Date().toISOString(),sourceFile:this.materials.summary?.sourceFile || null,sourceSha256:this.materials.summary?.sourceSha256 || null,availabilityMeaning:'catalog-assignment-not-live-stock',skus:clone(skus)};
    }
    _setSaving(saving) {
      this.saving=saving;this.container.setAttribute('aria-busy',String(saving));
      if(saving){this._disabledControls=[...this.container.querySelectorAll('button,input,select,textarea')].map(el=>[el,el.disabled]);this._disabledControls.forEach(([el])=>{el.disabled=true;});}
      else{this._disabledControls.forEach(([el,disabled])=>{if(this.container.contains(el))el.disabled=disabled;});this._disabledControls=[];}
    }
    async _commit(next,expectedSnapshot=this.storageSnapshot,{replaceInvalid=false}={}) {
      if(this.saving){this._notice('Penyimpanan SKU masih berlangsung. Tunggu sampai selesai.');return false;}
      const checked=validateCatalog({schema:SCHEMA,skus:next},this.context);
      if(!checked.ok){this._editorErrors(checked.errors);this._notice(checked.errors[0]);return false;}
      this._setSaving(true);
      try {
        if(!this.storage||typeof this.storage.getItem!=='function'||typeof this.storage.setItem!=='function')throw Error('Penyimpanan belum tersedia. Periksa koneksi, lalu coba kembali.');
        if(this.storage.getItem(STORAGE_KEY)!==expectedSnapshot)throw Error('Master SKU berubah di tab atau perangkat lain. Buka ulang data atau tinjau ulang impor sebelum menyimpan.');
        if(this.storageInvalid&&!replaceInvalid)throw Error('Data master tersimpan belum valid. Ekspor JSON untuk menyimpan data pemulihan, lalu tinjau dan terapkan impor master yang valid.');
        const text=JSON.stringify(this._envelope(checked.skus));await this.storage.setItem(STORAGE_KEY,text);
        const acknowledged=this.storage.getItem(STORAGE_KEY);
        const confirmed=typeof acknowledged==='string'?validateCatalog(JSON.parse(acknowledged),this.context):{ok:false};
        if(!confirmed.ok)throw Error('Konfirmasi penyimpanan SKU belum valid. Muat ulang data sebelum menyimpan lagi.');
        this.storageSnapshot=acknowledged;this.skus=clone(confirmed.skus);this.storageError='';this.storageInvalid=false;this._renderList();this.onChange(this.getSkus({includeInactive:true}));return true;
      }catch(e){
        // A server conflict may refresh the adapter cache before rejecting the
        // write. Show that authoritative master, while retaining the editor and
        // import review so the user can recover their unsaved work.
        this._readStorage();this._renderList();this.onChange(this.getSkus({includeInactive:true}));
        const message=e?.status===409||e?.code==='conflict'?'Master SKU berubah di tab atau perangkat lain. Data terbaru sudah dimuat; draft Anda dipertahankan. Buka ulang data atau tinjau ulang impor sebelum menyimpan.':e?.message||'Master SKU belum tersimpan. Periksa koneksi dan penyimpanan, lalu coba kembali.';
        this._editorErrors([message]);this._notice(message);return false;
      }finally{this._setSaving(false);}
    }
    _notice(message) { this.onNotify(message); }
    _renderShell() {
      const persistence=this.storageMode==='mysql'?'Tersimpan di database MySQL dan tersedia pada perangkat yang memakai server ini.':'Tersimpan di browser ini.';
      this.container.innerHTML='<div class="sku-manager"><div class="sku-toolbar"><div><h2>Master SKU produk lensa</h2><p>Atur indeks, batas power lensa jadi, dan blank yang boleh dipakai untuk setiap produk.</p></div><div class="sku-toolbar-actions"><button type="button" class="button primary" data-sku-action="new">+ Tambah SKU</button><button type="button" class="button secondary" data-sku-action="export">Ekspor JSON</button><label class="button secondary sku-import-label">Impor JSON / CSV / Excel<input type="file" id="sku-import-file" accept=".json,.csv,.xlsx,application/json,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-label="Impor master SKU JSON CSV atau Excel"></label>'+(tabular()?.templateLinks('skus')||'')+'</div></div><div class="sku-local-note">'+persistence+' Ekspor JSON untuk cadangan atau pemindahan data. Ketersediaan adalah pengaturan katalog SKU, belum terhubung ke jumlah stok gudang.</div><div id="sku-storage-warning" class="sku-error" hidden></div><div class="sku-list-tools"><input type="search" id="sku-master-search" placeholder="Cari kode atau nama SKU" aria-label="Cari SKU produk"><label class="sku-inline-check"><input type="checkbox" id="sku-show-inactive">Tampilkan SKU nonaktif</label></div><div id="sku-master-list" class="sku-master-list"></div><section id="sku-editor" class="panel sku-editor" hidden></section><section id="sku-import-review" class="panel sku-import-review" hidden></section></div>';
      this._renderList();
    }
    _renderList() {
      const query=this.filter.toLocaleLowerCase('id-ID');
      const rows=this.skus.filter(s=>(this.showInactive||s.active)&&(!query||(s.code+' '+s.name).toLocaleLowerCase('id-ID').includes(query)));
      const warning=this._q('#sku-storage-warning');if(warning){warning.hidden=!this.storageError;warning.textContent=this.storageError;}
      this.selected??=new Set();
      for(const id of this.selected)if(!this.skus.some(s=>s.id===id))this.selected.delete(id);
      const controls='<div class="sku-bulk-controls"><span>'+this.selected.size+' SKU terpilih</span><button type="button" class="text-button" data-sku-action="select-visible">Pilih semua ditampilkan</button><button type="button" class="text-button" data-sku-action="clear-selected">Batalkan pilihan</button><button type="button" class="button secondary" data-sku-action="delete-selected" '+(!this.selected.size?'disabled':'')+'>Hapus terpilih ('+this.selected.size+')</button></div>';
      this._q('#sku-master-list').innerHTML=controls+(rows.length?rows.map(s=>{
        const enabled=s.variants.filter(v=>v.enabled),assignmentCount=enabled.reduce((n,v)=>n+v.assignments.length,0),blankCount=enabled.reduce((n,v)=>n+v.assignments.reduce((x,a)=>x+a.blankIds.length,0),0);
        return '<article class="sku-master-card '+(!s.active?'sku-is-inactive':'')+'"><label class="sku-select-item"><input type="checkbox" data-sku-select="1" value="'+escapeHtml(s.id)+'" aria-label="Pilih SKU '+escapeHtml(s.code)+'" '+(this.selected.has(s.id)?'checked':'')+'></label><div class="sku-card-copy"><div class="sku-code-row"><strong>'+escapeHtml(s.code)+'</strong><span class="sku-status '+(s.active?'':'inactive')+'">'+(s.active?'Aktif':'Nonaktif')+'</span></div><h3>'+escapeHtml(s.name)+'</h3><div class="sku-index-tags">'+enabled.map(v=>'<span>'+escapeHtml(v.index)+'</span>').join('')+'</div><p>'+assignmentCount+' assignment bahan · '+blankCount+' spesifikasi blank</p></div><div class="sku-card-actions"><button type="button" class="button secondary" data-sku-action="edit" data-sku-id="'+escapeHtml(s.id)+'">Ubah</button><button type="button" class="text-button sku-delete" data-sku-action="delete" data-sku-id="'+escapeHtml(s.id)+'">Hapus</button><button type="button" class="text-button" data-sku-action="toggle" data-sku-id="'+escapeHtml(s.id)+'">'+(s.active?'Nonaktifkan':'Aktifkan kembali')+'</button></div></article>';
      }).join(''):'<div class="sku-empty"><h3>'+(this.skus.length?'Tidak ada SKU yang sesuai.':'Belum ada SKU produk.')+'</h3><p>'+(this.skus.length?'Ubah pencarian atau tampilkan SKU nonaktif.':'Tambahkan kode produk lensa jadi, aktifkan indeks, lalu pilih supplier dan blank dari katalog.')+'</p>'+(!this.skus.length?'<button type="button" class="button primary" data-sku-action="new">Tambah SKU pertama</button>':'')+'</div>');
    }
    async deleteItems(ids) {
      if(this.saving||!ids.length)return false;
      if(ids.some(id=>!this.skus.some(s=>s.id===id))){this._notice('SKU berubah atau sudah dihapus. Muat data terbaru.');return false;}
      const removed=new Set(ids),used=s=>s&&['a','b'].some(k=>removed.has(s[k]?.skuId));
      if((this.getDocuments?.()||[]).some(d=>used(d)||Array.isArray(d)&&d.some(e=>used(e?.state)))){this._notice('SKU masih dipakai dalam draft atau riwayat konsultasi. Lepaskan referensinya sebelum menghapus.');return false;}
      if(global.confirm&&!global.confirm('Hapus '+ids.length+' SKU terpilih beserta konfigurasi indeks dan assignment-nya?'))return false;
      const ok=await this._commit(this.skus.filter(s=>!removed.has(s.id)));
      if(ok){for(const id of ids)this.selected?.delete(id);if(removed.has(this.draft?.id))this._closeEditor();this._renderList();this._notice(ids.length+' SKU berhasil dihapus.');}return ok;
    }
    openEditor(skuId) {
      const current=skuId?this.skus.find(s=>s.id===skuId):null;
      if(skuId&&!current){this._notice('SKU tidak ditemukan.');return;}
      const now=new Date().toISOString();this.draft=current?clone(current):{id:id('sku'),code:'',name:'',active:true,variants:[],createdAt:now,updatedAt:now};
      this.draftBase=current?.updatedAt || null;this.draftIndex=this.draft.variants.find(v=>v.enabled)?.index || this.draft.variants[0]?.index || null;
      this._renderEditor();const el=this._q('#sku-editor');el.hidden=false;el.scrollIntoView({behavior:'smooth',block:'start'});this._q('#sku-code').focus({preventScroll:true});
    }
    _renderEditor() {
      const s=this.draft,exists=this.skus.some(x=>x.id===s.id);
      this._q('#sku-editor').innerHTML='<form id="sku-master-form" novalidate><div class="sku-editor-heading"><div><p class="eyebrow small">PRODUK LENSA JADI</p><h2>'+(exists?'Ubah SKU':'Tambah SKU')+'</h2></div><button type="button" class="icon-button" data-sku-action="close" aria-label="Tutup editor SKU">×</button></div><div id="sku-editor-errors" class="sku-error" role="alert" hidden></div><div class="sku-basic-fields"><label>Kode SKU<input id="sku-code" maxlength="64" value="'+escapeHtml(s.code)+'" autocomplete="off" required placeholder="Kode produk perusahaan"></label><label>Nama produk<input id="sku-name" maxlength="140" value="'+escapeHtml(s.name)+'" required placeholder="Nama produk lensa jadi"></label></div><label class="sku-inline-check sku-active-field"><input type="checkbox" id="sku-active" '+(s.active?'checked':'')+'>SKU aktif untuk dipilih di simulator</label><fieldset class="sku-index-fieldset"><legend>Indeks yang tersedia pada SKU</legend><div class="sku-index-checks">'+this.indices.map(index=>'<label><input type="checkbox" data-sku-index="'+index+'" '+(s.variants.some(v=>v.index===index&&v.enabled)?'checked':'')+'><span>'+index+'</span></label>').join('')+'</div><p>Setiap indeks memiliki rentang power dan assignment blank sendiri. Menonaktifkan indeks menyimpan konfigurasinya untuk dipakai kembali.</p></fieldset><div id="sku-variant-tabs" class="sku-variant-tabs"></div><div id="sku-variant-editor"></div><div class="sku-editor-footer"><p>Rentang SKU dan aturan power bahan baku sama-sama diperiksa saat memilih kandidat blank.</p><div><button type="button" class="button secondary" data-sku-action="close">Batal</button><button type="submit" class="button primary">Simpan SKU</button></div></div></form>';
      this._renderVariant();
    }
    _variant() { return this.draft?.variants.find(v=>v.index===this.draftIndex) || null; }
    _rangeMarkup(range,row,index) {
      const columns=[['diameter','Diameter (mm)'],['sphMin','SPH minimum'],['sphMax','SPH maksimum'],['cylMin','CYL minimum'],['cylMax','CYL maksimum'],['addMin','ADD minimum'],['addMax','ADD maksimum']];
      return '<tr>'+columns.map(([key,label])=>'<td><input type="number" step="any" '+(key==='diameter'?'min="20" max="150" ':key.startsWith('cyl')?'max="0" ':key.startsWith('add')?'min="0" ':'')+'data-sku-range="'+row+'" data-sku-range-field="'+key+'" aria-label="'+label+' baris '+(row+1)+' indeks '+index+'" value="'+escapeHtml(range[key]??'')+'" placeholder="'+(key==='diameter'?'65':key.startsWith('add')?'0':'')+'"></td>').join('')+'<td><button type="button" class="sku-remove-assignment" data-sku-action="remove-range" data-range-row="'+row+'" aria-label="Hapus range baris '+(row+1)+'">×</button></td></tr>';
    }
    _renderVariant() {
      if(!this.draft)return;const variant=this._variant();
      this._q('#sku-variant-tabs').innerHTML=this.draft.variants.map(v=>'<button type="button" class="'+(v.index===this.draftIndex?'active':'')+'" data-sku-variant="'+v.index+'">Indeks '+v.index+(v.enabled?'':' · nonaktif')+'</button>').join('');
      if(!variant){this._q('#sku-variant-editor').innerHTML='<div class="sku-variant-empty">Aktifkan sebuah indeks di atas untuk mengisi rentang power dan memilih blank.</div>';return;}
      this._q('#sku-variant-editor').innerHTML='<div class="sku-variant-heading"><h3>Konfigurasi indeks '+variant.index+'</h3><span class="sku-status '+(variant.enabled?'':'inactive')+'">'+(variant.enabled?'Tersedia pada SKU':'Indeks dinonaktifkan')+'</span></div><div class="sku-range-block"><div class="sku-range-heading"><div><h4>Range power per diameter</h4><p>Setiap baris berlaku untuk satu diameter. SPH, CYL, dan ADD harus cocok bersamaan pada baris yang sama. Gunakan CYL minus; untuk tanpa ADD, isi 0–0.</p></div><button type="button" class="button secondary" data-sku-action="add-range">+ Tambah range diameter</button></div><div class="sku-range-scroll"><table class="sku-range-table"><thead><tr><th>Diameter (mm)</th><th>SPH min.</th><th>SPH maks.</th><th>CYL min.</th><th>CYL maks.</th><th>ADD min.</th><th>ADD maks.</th><th></th></tr></thead><tbody>'+editableRanges(variant,this.materials).map((range,i)=>this._rangeMarkup(range,i,variant.index)).join('')+'</tbody></table></div>'+(variant.powerRanges.length?'':'<p class="sku-select-help">Belum ada range diameter. Tambahkan range untuk indeks ini.</p>')+'</div><div class="sku-assignment-heading"><div><h4>Supplier dan blank yang diizinkan</h4><p>Pilih spesifikasi per diameter dan base curve. CT/ET tetap milik bahan baku.</p></div><button type="button" class="button secondary" data-sku-action="add-assignment">+ Assign blank</button></div><div class="sku-assignments">'+(variant.assignments.length?variant.assignments.map(a=>this._assignmentMarkup(a,variant)).join(''):'<div class="sku-variant-empty">Belum ada assignment. Klik Assign blank untuk memilih supplier dan produk bahan baku.</div>')+'</div>';
    }
    _assignmentMarkup(a,variant) {
      const products=this.materials.products.filter(p=>p.activeForSimulator&&p.index===variant.index&&(p.active!==false||p.id===a.productId));
      const suppliers=[...new Set(products.map(p=>p.supplier))].sort();
      const allowedProducts=products.filter(p=>p.supplier===a.supplier);
      const blanks=this.materials.blanks.filter(b=>b.productId===a.productId&&(b.active!==false||a.blankIds.includes(b.id))).sort((x,y)=>x.diameter-y.diameter||x.baseCurve-y.baseCurve);
      const diameters=[...new Set(blanks.map(b=>b.diameter))];
      return '<article class="sku-assignment" data-sku-assignment-id="'+escapeHtml(a.id)+'"><div class="sku-assignment-top"><div class="sku-assignment-fields"><label>Supplier<select data-sku-supplier="'+escapeHtml(a.id)+'" aria-label="Supplier assignment"><option value="">Pilih supplier</option>'+suppliers.map(s=>'<option value="'+escapeHtml(s)+'" '+(s===a.supplier?'selected':'')+'>'+escapeHtml(s)+'</option>').join('')+'</select></label><label>Produk bahan baku<select data-sku-product="'+escapeHtml(a.id)+'" aria-label="Produk bahan baku assignment" '+(!a.supplier?'disabled':'')+'><option value="">Pilih produk bahan baku</option>'+allowedProducts.map(p=>'<option value="'+escapeHtml(p.id)+'" '+(p.id===a.productId?'selected':'')+'>'+escapeHtml(p.code+' · '+p.name+(p.active===false?' · arsip':''))+'</option>').join('')+'</select></label></div><button type="button" class="sku-remove-assignment" data-sku-action="remove-assignment" data-assignment-id="'+escapeHtml(a.id)+'" aria-label="Hapus assignment blank">×</button></div>'+(a.productId?'<div class="sku-blank-tools"><span>'+a.blankIds.length+' / '+blanks.length+' blank dipilih</span><div><button type="button" data-sku-action="select-blanks" data-assignment-id="'+escapeHtml(a.id)+'">Pilih semua</button><button type="button" data-sku-action="clear-blanks" data-assignment-id="'+escapeHtml(a.id)+'">Kosongkan</button></div></div><div class="sku-diameter-picks"><span>Pilih per diameter:</span>'+diameters.map(d=>'<button type="button" data-sku-action="diameter" data-assignment-id="'+escapeHtml(a.id)+'" data-diameter="'+d+'" class="'+(blanks.filter(b=>b.diameter===d).every(b=>a.blankIds.includes(b.id))?'selected':'')+'">Ø '+numberText(d)+' mm</button>').join('')+'</div><div class="sku-blank-scroll"><table class="sku-blank-table"><thead><tr><th>Pilih</th><th>Diameter</th><th>BC</th><th>CT blank</th><th>ET blank</th></tr></thead><tbody>'+blanks.map(b=>'<tr><td><input type="checkbox" data-sku-blank="'+escapeHtml(b.id)+'" data-assignment-id="'+escapeHtml(a.id)+'" aria-label="Pilih blank '+escapeHtml(a.supplier+' '+this.products.get(a.productId)?.code+' diameter '+b.diameter+' BC '+b.baseCurve)+'" '+(a.blankIds.includes(b.id)?'checked':'')+'></td><td>'+numberText(b.diameter)+' mm</td><td>'+numberText(b.baseCurve)+'</td><td>'+numberText(b.ct)+'</td><td>'+numberText(b.et)+(b.active===false?' · arsip':'')+'</td></tr>').join('')+'</tbody></table></div>':'<p class="sku-select-help">Pilih supplier dan produk untuk melihat diameter serta base curve yang ada pada katalog.</p>')+'</article>';
    }
    _editorErrors(errors=[]) {
      const box=this._q('#sku-editor-errors');
      if(box){box.hidden=!errors.length;box.innerHTML=errors.length?'<strong>Periksa konfigurasi SKU</strong><ul>'+errors.slice(0,12).map(e=>'<li>'+escapeHtml(e)+'</li>').join('')+'</ul>':'';if(errors.length)box.scrollIntoView({behavior:'smooth',block:'nearest'});}
    }
    async _saveDraft() {
      if(!this.draft||this.saving)return;
      const current=this.skus.find(s=>s.id===this.draft.id);
      if(current&&current.updatedAt!==this.draftBase){this._editorErrors(['SKU ini diubah di tab lain. Tutup editor dan buka kembali data terbaru sebelum menyimpan.']);return;}
      const input={...this.draft,updatedAt:new Date().toISOString()};
      const checked=validateSku(input,{...this.context,existing:this.skus});
      if(!checked.ok){this._editorErrors(checked.errors);return;}
      const next=this.skus.map(s=>s.id===checked.sku.id?checked.sku:s);if(!current)next.push(checked.sku);
      if(await this._commit(next)){this._closeEditor();this._notice('SKU '+checked.sku.code+' tersimpan.');}
    }
    _closeEditor() { this.draft=null;this.draftIndex=null;this._q('#sku-editor').hidden=true;this._q('#sku-editor').innerHTML=''; }
    async _toggle(skuId) {
      const current=this.skus.find(s=>s.id===skuId);if(!current||this.saving)return;
      const input={...current,active:!current.active,updatedAt:new Date().toISOString()};
      const checked=validateSku(input,{...this.context,existing:this.skus});
      if(!checked.ok){this.openEditor(skuId);this._editorErrors(checked.errors);return;}
      if(await this._commit(this.skus.map(s=>s.id===skuId?checked.sku:s)))this._notice('SKU '+current.code+(checked.sku.active?' diaktifkan kembali.':' dinonaktifkan.'));
    }
    _export() {
      const recovery=this.storageInvalid&&this.storageSnapshot!==null;
      const blob=new Blob([recovery?this.storageSnapshot:JSON.stringify(this._envelope(),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=global.document.createElement('a');
      a.href=url;a.download='leinz-sku-'+(recovery?'pemulihan-':'master-')+new Date().toISOString().slice(0,10)+'.json';global.document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);this._notice(recovery?'Data tersimpan diekspor untuk pemulihan.':'Master SKU diekspor sebagai JSON.');
    }
    async _readImport(file) {
      if(!file||this.saving)return;
      const token=(this.importReadToken||0)+1;this.importReadToken=token;this.importPlan=null;
      const box=this._q('#sku-import-review');box.hidden=false;
      box.innerHTML='<p class="eyebrow small">TINJAU IMPOR</p><h3>'+escapeHtml(file.name)+'</h3><p role="status">Membaca dan memvalidasi seluruh baris…</p><button type="button" class="button secondary" data-sku-action="cancel-import">Batal</button>';
      try {
        if(file.size>8*1024*1024)throw Error('Berkas impor maksimal 8 MiB.');
        let payload,info=null;
        if(/\.json$/i.test(file.name)){
          try{payload=JSON.parse(await file.text());}catch{throw Error('JSON tidak dapat dibaca. Gunakan hasil ekspor Master SKU.');}
        }else{
          const api=tabular();if(!api)throw Error('Pembaca impor belum dimuat. Muat ulang aplikasi.');
          const parsed=await api.readFile(file);
          if(token!==this.importReadToken)return;
          const prepared=api.buildSkuImport(this.skus,this.materials,parsed);payload=prepared.payload;info=prepared.info;
        }
        if(token!==this.importReadToken)return;
        const plan=planImport(this.skus,payload,this.context);this.importPlan=plan;this.importBase=this.storageSnapshot;
        if(!plan.ok){box.innerHTML='<h3>Impor belum dapat diterapkan</h3><div class="sku-error"><ul>'+plan.errors.slice(0,15).map(e=>'<li>'+escapeHtml(e)+'</li>').join('')+'</ul></div><button type="button" class="button secondary" data-sku-action="cancel-import">Tutup</button>';}
        else {
          const created=plan.changes.filter(c=>c.action==='create').length,updated=plan.changes.length-created;
          const changedSource=payload.sourceSha256&&payload.sourceSha256!==this.materials.summary?.sourceSha256;
          box.innerHTML='<p class="eyebrow small">TINJAU IMPOR '+escapeHtml(info?.format||'JSON')+'</p><h3>'+created+' SKU baru · '+updated+' SKU diperbarui</h3><p>'+escapeHtml(file.name)+'</p>'+(info?tabular().reviewMarkup(info):'')+'<p>Impor menggabungkan data berdasarkan kode atau ID SKU. Identitas SKU yang sudah ada dipertahankan.</p>'+(plan.unchanged?.length?'<p class="sku-local-note">'+plan.unchanged.length+' SKU sama dengan data yang sudah ada; tidak disimpan ulang.</p>':'')+(changedSource?'<div class="sku-local-note">Berkas berasal dari versi katalog bahan yang berbeda. Seluruh assignment telah diperiksa terhadap katalog bahan yang saat ini tersedia.</div>':'')+'<ul class="sku-import-changes">'+plan.changes.map(c=>'<li><strong>'+escapeHtml(c.code)+'</strong><span>'+(c.action==='create'?'Baru':'Perbarui')+' · '+(c.active?'aktif':'nonaktif')+'</span></li>').join('')+'</ul><div class="sku-import-actions"><button type="button" class="button secondary" data-sku-action="cancel-import">Batal</button><button type="button" class="button primary" data-sku-action="apply-import" '+(!plan.changes.length?'disabled':'')+'>Terapkan impor '+plan.changes.length+' SKU</button></div>';
        }
        box.scrollIntoView({behavior:'smooth',block:'start'});
      }catch(e){if(token!==this.importReadToken)return;this.importPlan=null;box.hidden=false;box.innerHTML='<h3>Impor belum dapat dibaca</h3>'+(tabular()?.errorMarkup(e)||'<div class="sku-error">'+escapeHtml(e.message)+'</div>')+'<button type="button" class="button secondary" data-sku-action="cancel-import">Tutup</button>';this._notice('Impor SKU belum diterapkan.');}
      finally {if(token===this.importReadToken)this._q('#sku-import-file').value='';}
    }
    _bind() {
      this._click=async e=>{
        const button=e.target.closest('button');if(!button||!this.container.contains(button))return;
        if(this.saving)return;
        const action=button.dataset.skuAction,variant=this._variant();
        if(action==='select-visible'){this.selected??=new Set();for(const el of this.container.querySelectorAll('[data-sku-select]'))this.selected.add(el.value);this._renderList();return;}
        if(action==='clear-selected'){this.selected?.clear();this._renderList();return;}
        if(action==='delete-selected'){await this.deleteItems([...(this.selected||[])]);return;}
        if(action==='delete'){await this.deleteItems([button.dataset.skuId]);return;}
        if(button.dataset.skuVariant){this.draftIndex=button.dataset.skuVariant;this._renderVariant();return;}
        if(action==='new')this.openEditor();
        else if(action==='edit')this.openEditor(button.dataset.skuId);
        else if(action==='toggle')await this._toggle(button.dataset.skuId);
        else if(action==='close')this._closeEditor();
        else if(action==='export')this._export();
        else if(action==='add-range'&&variant){editableRanges(variant,this.materials).push(emptyRange());this._renderVariant();}
        else if(action==='remove-range'&&variant){editableRanges(variant,this.materials).splice(Number(button.dataset.rangeRow),1);this._renderVariant();}
        else if(action==='add-assignment'&&variant){variant.assignments.push({id:id('assignment'),supplier:'',productId:'',blankIds:[]});this._renderVariant();}
        else if(action==='remove-assignment'&&variant){variant.assignments=variant.assignments.filter(a=>a.id!==button.dataset.assignmentId);this._renderVariant();}
        else if(['select-blanks','clear-blanks','diameter'].includes(action)&&variant){
          const a=variant.assignments.find(x=>x.id===button.dataset.assignmentId);if(!a)return;
          const blanks=this.materials.blanks.filter(b=>b.productId===a.productId&&b.active!==false);
          if(action==='select-blanks')a.blankIds=blanks.map(b=>b.id);
          else if(action==='clear-blanks')a.blankIds=[];
          else {const ids=blanks.filter(b=>b.diameter===Number(button.dataset.diameter)).map(b=>b.id),remove=ids.every(x=>a.blankIds.includes(x));a.blankIds=remove?a.blankIds.filter(x=>!ids.includes(x)):[...new Set([...a.blankIds,...ids])];}
          this._renderVariant();
        }
        else if(action==='cancel-import'){this.importReadToken=(this.importReadToken||0)+1;this.importPlan=null;this._q('#sku-import-review').hidden=true;}
        else if(action==='apply-import'&&this.importPlan?.ok&&this.importPlan.changes.length){if(await this._commit(this.importPlan.skus,this.importBase,{replaceInvalid:true})){this.importPlan=null;this._q('#sku-import-review').hidden=true;this._closeEditor();this._notice('Master SKU berhasil diimpor.');}}
      };
      this._input=e=>{
        if(this.saving)return;
        const t=e.target;
        if(t.id==='sku-master-search'){this.filter=t.value;this._renderList();}
        if(!this.draft)return;
        if(t.id==='sku-code')this.draft.code=t.value;
        else if(t.id==='sku-name')this.draft.name=t.value;
        else if(t.dataset.skuRangeField&&this._variant()){const row=editableRanges(this._variant(),this.materials)[Number(t.dataset.skuRange)];if(row&&['diameter',...POWER_KEYS].includes(t.dataset.skuRangeField))row[t.dataset.skuRangeField]=t.value;}
      };
      this._change=e=>{
        if(this.saving)return;
        const t=e.target;
        if(t.id==='sku-import-file'){this._readImport(t.files?.[0]);return;}
        if(t.dataset.skuSelect){this.selected??=new Set();t.checked?this.selected.add(t.value):this.selected.delete(t.value);this._renderList();return;}
        if(t.id==='sku-show-inactive'){this.showInactive=t.checked;this._renderList();return;}
        if(!this.draft)return;
        if(t.id==='sku-active'){this.draft.active=t.checked;return;}
        if(t.dataset.skuIndex){let v=this.draft.variants.find(x=>x.index===t.dataset.skuIndex);if(!v){v=emptyVariant(t.dataset.skuIndex);this.draft.variants.push(v);this.draft.variants.sort((a,b)=>this.indices.indexOf(a.index)-this.indices.indexOf(b.index));}v.enabled=t.checked;this.draftIndex=v.index;this._renderVariant();return;}
        const variant=this._variant();if(!variant)return;
        const a=variant.assignments.find(x=>x.id===(t.dataset.skuSupplier||t.dataset.skuProduct||t.dataset.assignmentId));if(!a)return;
        if(t.dataset.skuSupplier){a.supplier=t.value;a.productId='';a.blankIds=[];this._renderVariant();}
        else if(t.dataset.skuProduct){a.productId=t.value;a.blankIds=[];this._renderVariant();}
        else if(t.dataset.skuBlank){const blankId=t.dataset.skuBlank;a.blankIds=t.checked?[...new Set([...a.blankIds,blankId])]:a.blankIds.filter(x=>x!==blankId);this._renderVariant();[...this.container.querySelectorAll('[data-sku-blank]')].find(el=>el.dataset.skuBlank===blankId&&el.dataset.assignmentId===a.id)?.focus({preventScroll:true});}
      };
      this._submit=async e=>{if(e.target.id==='sku-master-form'){e.preventDefault();await this._saveDraft();}};
      this.container.addEventListener('click',this._click);this.container.addEventListener('input',this._input);this.container.addEventListener('change',this._change);this.container.addEventListener('submit',this._submit);
    }
    destroy() { this.container.removeEventListener('click',this._click);this.container.removeEventListener('input',this._input);this.container.removeEventListener('change',this._change);this.container.removeEventListener('submit',this._submit);global.removeEventListener?.('storage',this._storageEvent); }
  }
  SkuManager.helpers={SCHEMA,STORAGE_KEY,validateSku,validateCatalog,planImport,emptyVariant,editableRanges,escapeHtml};
  global.SkuManager=SkuManager;
  if(typeof module!=='undefined'&&module.exports)module.exports={SkuManager,...SkuManager.helpers};
})(typeof window!=='undefined'?window:globalThis);
