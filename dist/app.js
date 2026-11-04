(() => {
  'use strict';
  const VERSION = '2.1.1';
  const STATE_KEY = 'leinz-lens-studio-state-v1';
  const SAVED_KEY = 'leinz-lens-studio-saved-v1';
  const INDICES = ['1.50','1.56','1.57','1.60','1.67','1.74'];
  const FRAME_STYLES = {'full-rim':'Full Rim','half-rimless':'Half Rimless',rimless:'Rimless'};
  const $ = (q, root=document) => root.querySelector(q);
  const $$ = (q, root=document) => [...root.querySelectorAll(q)];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = (v, digits=2) => Number(v).toLocaleString('id-ID',{minimumFractionDigits:digits,maximumFractionDigits:digits});
  const clamp = (v,min,max,fallback) => Number.isFinite(Number(v)) ? Math.max(min,Math.min(max,Number(v))) : fallback;
  const defaultOpticalProfile = () => ({minCenterMm:1.5,minEdgeMm:1.5,frontPowerD:4,frontCurveBasis:'material',curveReferenceIndex:1.53,frontConic:0,backConic:0,source:'assumption',reference:''});
  const baseCamera = () => ({yaw:-.62,pitch:.12,zoom:1});
  const angle = (value,fallback=0) => Number.isFinite(Number(value)) ? Math.atan2(Math.sin(Number(value)),Math.cos(Number(value))) : fallback;
  const normalizeCamera = (input={},fallback=baseCamera()) => ({yaw:angle(input?.yaw,fallback.yaw),pitch:angle(input?.pitch,fallback.pitch),zoom:clamp(input?.zoom,.55,2.6,fallback.zoom)});
  const freshState = () => ({active:'a',optics:{useOverride:false,profile:defaultOpticalProfile()},showFrame:true,showTemples:true,frameStyle:'full-rim',shape:'001',width:52,height:38,dbl:18,sph:-4,cyl:-1,axis:180,add:0,pdR:31.5,pdL:31.5,heightR:19,heightL:19,allowanceDiameter:2,sync:true,camera:baseCamera(),a:{index:'1.74',productId:'DMO:SPHW74',skuId:null,blankIdR:null,blankIdL:null,tintCode:'09S',note:'',customColor:'#9b7965'},b:{index:'1.50',productId:'SOA:SPHW50',skuId:null,blankIdR:null,blankIdL:null,tintCode:'09S',note:'',customColor:'#9b7965'}});
  const icons = {
    search:'<circle cx="10.8" cy="10.8" r="6.5"/><path d="m16 16 4.6 4.6"/>',
    download:'<path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4"/>',
    bookmark:'<path d="M6 4h12v17l-6-4-6 4Z"/>',
    image:'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m4 17 5-5 4 4 3-3 5 5"/>',
    move:'<path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
    rotate:'<path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5"/>',
    chevron:'<path d="m6 9 6 6 6-6"/>',
    database:'<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>'
  };
  function installIcons(root=document){$$('[data-icon]',root).forEach(el=>{el.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true">'+(icons[el.dataset.icon]||'')+'</svg>';});}
  let data, state, skuManager, masterManager, currentManageTab='materials', currentManageDetail=null, frameFit, evaluations={}, previewMetrics={}, viewers={}, tintMap, productMap, blankMap, saved=[], currentTab='studio', filterKind='all',filterGroup='all',search='',materialMode='candidates',storageOK=true,toastTimer,saveTimer,autoRotating=false,settingRotation=false,lastCameraUpdate=0,cameraStatusTimer=null,currentView='perspective';
  let storage, stateChangeSerial=0, stateSavedSerial=0, savingHistory=false, pendingConsultationImport=null,allowDiscardOnReload=false;
  function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('visible'),3500);}
  function readStorage(key,fallback){try{const x=storage.getItem(key);return x?JSON.parse(x):fallback;}catch{return fallback;}}
  async function writeStorage(key,value){try{await storage.setItem(key,JSON.stringify(value));storageOK=true;return true;}catch{storageOK=false;return false;}}
  async function flushState(){clearTimeout(saveTimer);if(!state)return true;const serial=stateChangeSerial,snapshot=JSON.parse(JSON.stringify(state));const ok=await writeStorage(STATE_KEY,snapshot);if(ok)stateSavedSerial=Math.max(stateSavedSerial,serial);return ok;}
  function persist(){clearTimeout(saveTimer);stateChangeSerial++;saveTimer=setTimeout(()=>{flushState();},storage?.mode==='mysql'?400:150);}
  function renderStorageStatus(info){
    if(!$('#storage-status'))return;
    const mysql=info.mode==='mysql';
    $('#storage-mode').textContent=mysql?'MySQL · '+(info.user?.username||'akun perusahaan'):'Data di browser ini';
    $('#storage-message').textContent=info.message||(info.saving?'Menyimpan…':info.pending?'Perubahan menunggu penyimpanan.':mysql?'Data tersimpan di server.':'Gunakan ekspor JSON untuk cadangan.');
    $('#storage-status').classList.toggle('is-error',!!info.message);
    $('#storage-retry').hidden=!mysql||!info.pending||info.conflict||!info.authenticated;
    $('#storage-retry').disabled=info.saving;
    $('#storage-login').hidden=!mysql||info.authenticated;
    $('#storage-reload').hidden=!mysql;
    $('#storage-logout').hidden=!mysql;
    $('#storage-logout').disabled=info.saving;
  }
  function loginFlow(reconnect=false){
    $('#loading').hidden=true;$('#app').hidden=true;$('#login-panel').hidden=false;
    $('#login-username').readOnly=reconnect;
    if(reconnect)$('#login-username').value=storage.user?.username||'';
    $('#login-error').hidden=true;
    return new Promise(resolve=>{
      $('#login-form').onsubmit=async event=>{
        event.preventDefault();const button=$('#login-submit');if(button.disabled)return;button.disabled=true;
        try{await storage.login($('#login-username').value.trim(),$('#login-password').value);$('#login-password').value='';$('#login-panel').hidden=true;$('#login-form').onsubmit=null;resolve();}
        catch(err){$('#login-error').textContent=err.message||'Login belum berhasil.';$('#login-error').hidden=false;}
        finally{button.disabled=false;}
      };
      (reconnect?$('#login-password'):$('#login-username')).focus();
    });
  }
function rebuildMasterMaps(){
    tintMap=new Map(data.tints.items.map(t=>[t.code,t]));productMap=new Map(data.materials.products.map(p=>[p.id,p]));blankMap=new Map(data.materials.blanks.map(b=>[b.id,b]));
  }
  function applyCatalogs(value,{syncManager=true}={}){
    const checked=LeinzCatalogModel.validateCatalogBundle(value);
    if(!checked.ok)throw Error(checked.errors.slice(0,3).join(' '));
    data=checked.value;rebuildMasterMaps();
    skuManager?.updateMaterials(data.materials);
    if(state)state=normalizeState(state);
    if(syncManager)masterManager?.updateCatalogs(data);
    if(state&&viewers.a)renderAll();else renderManageSummary();
  }
  function renderManageSummary(){
    if(!data)return;
    const count=LeinzCatalogModel.summarizeCatalogs(data);
    $('#manage-count-materials').textContent=count.products+' / '+count.blanks;
    $('#manage-count-shapes').textContent=count.shapes;
    $('#manage-count-tints').textContent=count.tints;
    $('#manage-count-skus').textContent=skuManager?.getSkus({includeInactive:true}).length||0;
    $('#manage-storage-label').textContent=(storage.mode==='mysql'?'Master bersama di MySQL · revisi '+storage.getCatalogRevision():'Preview browser · master tersimpan pada perangkat ini')+' · '+count.rules+' aturan power';
    $('#tint-total').textContent=count.activeTints;
    $('#reference-count-total').textContent=count.tints;
    $('#reference-count-preview').textContent=data.tints.items.filter(t=>!!t.previewHex).length;
    $('#reference-count-kinds').textContent=data.tints.items.filter(t=>t.kind==='Solid').length+' / '+data.tints.items.filter(t=>t.kind==='Gradient').length;
  }
  function mountManage(){
    for(const id of ['view-materials','view-skus','view-reference']){
      const panel=$('#'+id);panel.classList.remove('page-view');panel.classList.add('manage-subview');$('#manage-legacy-panels').append(panel);
      const button=panel.querySelector('.page-heading [data-tab="studio"]');
      if(button){button.removeAttribute('data-tab');button.dataset.manageTab=id==='view-reference'?'tints':id==='view-skus'?'skus':'materials';button.textContent=id==='view-reference'?'Kelola tinting':id==='view-materials'?'Kelola blank / raw material':'Kembali ke Manage';}
    }
    $('#view-reference h1').textContent='Lembar acuan tinting';
    masterManager=new LeinzMasterManager({root:$('#master-manager-root'),catalogs:data,mode:storage.mode,
      saveCatalogs:value=>storage.saveCatalogs(value),getSkus:()=>skuManager.getSkus({includeInactive:true}),
      onChange:value=>applyCatalogs(value,{syncManager:false}),onNotify:toast,
      onNavigate:target=>{if(showManage(target==='reference'?'tints':'materials',target))setTab('manage');}});
    showManage('materials');
  }
  function opticalProfileFor(key,eye){
    const candidate=state.optics?.useOverride?state.optics.profile:
      blankMap.get(state[key]['blankId'+eye])?.opticalProfile||productMap.get(state[key].productId)?.opticalProfile;
    return {...defaultOpticalProfile(),...(candidate||{})};
  }
  function renderOpticsControls(){
    const optics=state.optics,profile=optics.profile;
    $('#optics-override').checked=optics.useOverride;$('#optics-fields').disabled=!optics.useOverride;
    for(const [id,key]of [['min-ct','minCenterMm'],['min-et','minEdgeMm'],['front-power','frontPowerD'],['ref-index','curveReferenceIndex'],['curve-basis','frontCurveBasis'],['source','source'],['reference','reference']])$('#optics-'+id).value=profile[key]??'';
    $('#optics-radius').value=profile.frontRadiusMm??'';
    $('#optics-ref-index').disabled=profile.frontCurveBasis!=='reference-index';
    const sources=['R','L'].map(eye=>{
      const selected=blankMap.get(state[state.active]['blankId'+eye]),product=productMap.get(state[state.active].productId),p=opticalProfileFor(state.active,eye);
      const from=optics.useOverride?'konsultasi':selected?.opticalProfile?'blank terpilih':product?.opticalProfile?'produk':'default asumsi';
      return eye+': '+from+' · minimum CT '+fmt(p.minCenterMm)+' / ET '+fmt(p.minEdgeMm)+' mm'+(p.source==='lab'?' · acuan lab':'');
    });
    $('#optics-source-note').textContent=sources.join(' | ');
  }
  function applyOpticalInputs(){
    const fields=[['minCenterMm','min-ct'],['minEdgeMm','min-et'],['frontPowerD','front-power'],['curveReferenceIndex','ref-index']],profile={...defaultOpticalProfile()};
    for(const [key,id]of fields){const text=$('#optics-'+id).value.trim();profile[key]=text===''?NaN:Number(text);}
    profile.frontCurveBasis=$('#optics-curve-basis').value;profile.source=$('#optics-source').value;profile.reference=$('#optics-reference').value.trim();
    const radius=$('#optics-radius').value.trim();if(radius!=='')profile.frontRadiusMm=Number(radius);
    const checked=LeinzCatalogModel.validateOpticalProfile(profile);
    const message=$('#optics-error');
    if(!checked.ok){message.textContent=checked.errors.join(' ');message.hidden=false;return;}
    state.optics={useOverride:true,profile:checked.value};message.hidden=true;renderAll();toast('Parameter CT/ET diterapkan pada pasangan A dan B.');
  }
  function metricError(key){
    const errors=previewMetrics[key]?.errors;
    return Array.isArray(errors)&&errors.length?errors.map(x=>typeof x==='string'?x:x.message||'Geometri optik tidak valid.').join(' '):'Perbaiki data frame, sentrasi, atau parameter optik untuk menghitung ketebalan.';
  }
  function readHistory(){const history=readStorage(SAVED_KEY,[]);return Array.isArray(history)?history.filter(LeinzConsultations.validSavedEntry).slice(0,30):[];}
  async function retryStorage(){
    if(!await flushState())throw Error('Draft belum tersimpan. Periksa status penyimpanan di atas.');
    await storage.retryPending();applyCatalogs(storage.getCatalogs());skuManager.reloadFromStorage();saved=readHistory();refreshSavedCount();renderSaved();
    toast('Perubahan yang tertunda sudah tersimpan di server.');
  }
  function normalizeState(input){
    const base=freshState(), s={...base,...(input&&typeof input==='object'?input:{})};
    for(const eye of ['R','L']){if(input?.['pd'+eye]===undefined&&input?.pd!==undefined)s['pd'+eye]=input.pd;if(input?.['height'+eye]===undefined&&input?.fittingHeight!==undefined)s['height'+eye]=input.fittingHeight;}
    delete s.pd;delete s.fittingHeight;
    const previousShape=s.shape;
    s.active=s.active==='b'?'b':'a';s.shape=data.shapes.items.some(x=>x.code===s.shape)?s.shape:(previousShape==='browline'&&data.shapes.items.some(x=>x.code==='round')?'round':data.shapes.items.find(x=>x.active!==false).code);s.sync=s.sync!==false;
    s.showFrame=s.showFrame!==false;s.showTemples=s.showTemples!==false;
    s.frameStyle=Object.hasOwn(FRAME_STYLES,s.frameStyle)?s.frameStyle:'full-rim';
    const profileCheck=LeinzCatalogModel.validateOpticalProfile(s.optics?.profile||defaultOpticalProfile());
    s.optics={useOverride:s.optics?.useOverride===true&&profileCheck.ok,profile:{...defaultOpticalProfile(),...(profileCheck.ok?profileCheck.value:{})}};
    for(const [k,min,max] of [['width',35,70],['height',25,60],['dbl',10,28],['sph',-20,12],['cyl',-7,0],['axis',0,180],['add',0,4],['pdR',20,45],['pdL',20,45],['heightR',0,60],['heightL',0,60],['allowanceDiameter',0,10]])s[k]=clamp(s[k],min,max,base[k]);
    const shape=data.shapes.items.find(x=>x.code===s.shape);
    if(isShapePreset(shape)&&s.shapeRevision!==shape.geometryRevision){
      const legacySizes={round:[50,50],'cat-eye':[54,38],rectangle:[54,34],square:[50,50]};
      const legacy=legacySizes[previousShape];
      if(previousShape==='browline'||(legacy&&s.width===legacy[0]&&s.height===legacy[1])){
        s.width=shape.defaultWidthMm;s.height=shape.defaultHeightMm;
      }
    }
    s.shapeRevision=isShapePreset(shape)?shape.geometryRevision:null;
    s.camera=normalizeCamera(s.camera);
    for(const key of ['a','b']){
      s[key]={...base[key],...(s[key]&&typeof s[key]==='object'?s[key]:{})};const v=s[key];
      v.index=INDICES.includes(v.index)?v.index:'1.60';
      v.skuId=typeof v.skuId==='string'&&v.skuId?v.skuId:null;
      if(!v.skuId&&(!productMap.has(v.productId)||productMap.get(v.productId).index!==v.index))v.productId=defaultProductFor(v.index)?.id||'';
      for(const eye of ['R','L'])if(typeof v['blankId'+eye]!=='string')v['blankId'+eye]=null;
      if(v.tintCode!==null&&!tintMap.has(v.tintCode))v.tintCode=null;
      v.note=String(v.note||'').slice(0,800);v.customColor=/^#[0-9a-f]{6}$/i.test(v.customColor)?v.customColor:'#9b7965';v.camera=normalizeCamera(v.camera||s.camera,s.camera);
    }if(s.sync){s.a.camera={...s.camera};s.b.camera={...s.camera};}return s;
  }
  function productsFor(index){return data.materials.products.filter(p=>p.index===index&&p.activeForSimulator&&p.active!==false);}
  function defaultProductFor(index,supplier){const rows=productsFor(index),code='SPHW'+index.slice(2);return rows.find(p=>p.code===code&&p.supplier===supplier)||rows.find(p=>p.code===code)||rows[0];}
  const inputMap={'frame-width':'width','frame-height':'height','frame-dbl':'dbl','frame-allowance':'allowanceDiameter','rx-sph':'sph','rx-cyl':'cyl','rx-axis':'axis','rx-add':'add','rx-pd-r':'pdR','rx-pd-l':'pdL','rx-height-r':'heightR','rx-height-l':'heightL','m-width':'width','m-height':'height','m-dbl':'dbl','m-allowance':'allowanceDiameter','m-pd-r':'pdR','m-pd-l':'pdL','m-height-r':'heightR','m-height-l':'heightL'};
  function selectedSku(key=state.active){return state[key].skuId?skuManager.getSku(state[key].skuId):null;}
  function skuVariantFor(key=state.active){
    const slot=state[key];if(!slot.skuId)return null;
    const sku=selectedSku(key),variant=sku?.variants.find(v=>v.index===slot.index);
    return sku?.active&&variant?.enabled?variant:{...(variant||{}),index:slot.index,enabled:false,power:variant?.power||{sphMin:0,sphMax:0,cylMin:0,cylMax:0,addMin:0,addMax:0},assignments:[]};
  }
  function indicesFor(key){if(!state[key].skuId)return INDICES;const sku=selectedSku(key);return sku?.active?sku.variants.filter(v=>v.enabled).map(v=>v.index):[];}
  function productsForSlot(key){const slot=state[key],rows=productsFor(slot.index);if(!slot.skuId)return rows;const v=skuVariantFor(key);return v.enabled?rows.filter(p=>v.assignments.some(a=>a.productId===p.id&&a.supplier===p.supplier&&a.blankIds.length)):[];}
  function slotDefault(key,supplier){const rows=productsForSlot(key),code='SPHW'+state[key].index.slice(2);return rows.find(p=>p.code===code&&p.supplier===supplier)||rows.find(p=>p.supplier===supplier)||rows.find(p=>p.code===code)||rows[0];}
  function clearBlanks(key){state[key].blankIdR=null;state[key].blankIdL=null;}
  function setIndex(key,index){if(!['a','b'].includes(key)||!indicesFor(key).includes(index))return;setRotation(false);const slot=state[key],supplier=productMap.get(slot.productId)?.supplier;slot.index=index;slot.productId=slotDefault(key,supplier)?.id||'';clearBlanks(key);state.active=key;renderAll();}
  function applyPairExample(){
    const desired={a:'1.74',b:'1.50'},blocked=Object.keys(desired).filter(key=>!indicesFor(key).includes(desired[key]));
    if(blocked.length){toast('Indeks contoh belum tersedia pada SKU pilihan '+blocked.map(x=>x.toUpperCase()).join(' dan ')+'. Sesuaikan SKU atau indeks pasangan.');return;}
    setRotation(false);
    for(const [key,index] of Object.entries(desired)){const slot=state[key];if(slot.index===index)continue;const supplier=productMap.get(slot.productId)?.supplier;slot.index=index;slot.productId=slotDefault(key,supplier)?.id||'';clearBlanks(key);}
    renderAll();toast('Pilihan A: R/L indeks 1.74. Pilihan B: R/L indeks 1.50.');
  }
  function setSku(id){const key=state.active,slot=state[key],supplier=productMap.get(slot.productId)?.supplier;slot.skuId=id||null;const allowed=indicesFor(key);if(!allowed.includes(slot.index)&&allowed.length)slot.index=allowed[0];slot.productId=slotDefault(key,supplier)?.id||'';clearBlanks(key);renderAll();}
  function recalculatePlanning(){
    frameFit=BlankEngine.estimateFrame({points:LensViewer.screeningContour(selectedShape().points,state.width,state.height,shapeContourMode()),width:state.width,height:state.height,dbl:state.dbl,pdR:state.pdR,pdL:state.pdL,heightR:state.heightR,heightL:state.heightL,allowanceDiameter:state.allowanceDiameter});
    const removed=[];
    for(const key of ['a','b']){const slot=state[key];evaluations[key]=BlankEngine.evaluate({materials:data.materials,index:slot.index,productId:slot.productId,skuVariant:skuVariantFor(key),rx:state,frame:frameFit});for(const eye of ['R','L']){const id=slot['blankId'+eye];if(id&&!evaluations[key].rows.some(r=>r.blank.id===id&&r['eligible'+eye])){slot['blankId'+eye]=null;removed.push(key.toUpperCase()+'/'+eye);}}}
    if(removed.length)toast('Pilihan blank '+removed.join(', ')+' dilepas karena tidak lagi memenuhi frame, power, atau aturan SKU.');
  }
  function rangeText(v){if(!v?.power)return 'Belum ada batas power finish SKU.';const p=v.power;return 'SPH '+fmt(p.sphMin)+' s/d '+fmt(p.sphMax)+' · CYL '+fmt(p.cylMin)+' s/d '+fmt(p.cylMax)+' · ADD '+fmt(p.addMin)+' s/d '+fmt(p.addMax);}
  function skuProblem(key=state.active){const slot=state[key],sku=selectedSku(key);if(!slot.skuId)return '';if(!sku)return 'SKU tersimpan tidak ditemukan. Pilih SKU aktif atau buka Master SKU.';if(!sku.active)return 'SKU diarsipkan. Aktifkan kembali atau pilih SKU lain.';if(!sku.variants.some(v=>v.index===slot.index&&v.enabled))return 'Indeks ini tidak lagi aktif pada SKU. Pilih indeks yang tersedia.';return '';}
  function indexOptions(key){const allowed=indicesFor(key),current=state[key].index;return (!allowed.includes(current)?'<option value="'+esc(current)+'" selected disabled>'+esc(current)+' · tidak tersedia</option>':'')+allowed.map(n=>'<option value="'+n+'" '+(n===current?'selected':'')+'>'+n+'</option>').join('');}
  function materialLabel(product){
    if(!product)return '';
    const label=product.code+' — '+product.name;
    const twins=productsFor(product.index).filter(p=>p.code===product.code&&p.name.trim()===product.name.trim());
    return label+(twins.length>1?' · varian bahan '+(twins.findIndex(p=>p.id===product.id)+1):'');
  }
  function renderSkuControls(){
    const key=state.active,slot=state[key],sku=selectedSku(key),problem=skuProblem(key),skus=skuManager.getSkus();
    $('#sku-select').innerHTML='<option value="">Katalog bahan · tanpa SKU</option>'+(!skus.some(s=>s.id===slot.skuId)&&slot.skuId?'<option selected value="'+esc(slot.skuId)+'">'+esc(sku?sku.code+' · diarsipkan':'SKU tidak ditemukan')+'</option>':'')+skus.map(s=>'<option value="'+esc(s.id)+'" '+(s.id===slot.skuId?'selected':'')+'>'+esc(s.code+' — '+s.name)+'</option>').join('');
    $('#sku-select').value=slot.skuId||'';
    $('#sku-status').textContent=problem||(sku?'Ketersediaan mengikuti assignment SKU, belum stok aktual.':'Eksplorasi katalog bahan. Batas power finish belum diterapkan.');$('#sku-status').classList.toggle('invalid-text',!!problem);
    $('#index-select').innerHTML=indexOptions(key);for(const k of ['a','b'])$('#index-'+k).innerHTML=indexOptions(k);
    const rows=productsForSlot(key),p=productMap.get(slot.productId);
    $('#product-select').innerHTML=(!rows.some(x=>x.id===slot.productId)?'<option selected disabled value="'+esc(slot.productId)+'">'+esc(p?p.code+(p.active===false?' · diarsipkan':' · tidak di-assign'):'Belum ada produk tersedia')+'</option>':'')+rows.map(p=>'<option value="'+esc(p.id)+'" '+(p.id===slot.productId?'selected':'')+'>'+esc(materialLabel(p))+'</option>').join('');
    const ev=evaluations[key];$('#sku-power-status').textContent=slot.skuId?(rangeText(skuVariantFor(key))+(!ev.skuPowerAllowed?' · Resep di luar rentang finish.':'')):'Kecocokan power mengikuti rentang bahan pada CSV.';$('#sku-power-status').classList.toggle('invalid-text',!!slot.skuId&&!ev.skuPowerAllowed);
    for(const eye of ['R','L']){const low=eye.toLowerCase(),candidates=ev.rows.filter(r=>r['eligible'+eye]),chosen=blankMap.get(slot['blankId'+eye]);$('#blank-'+low).innerHTML='<option value="">'+(candidates.length?'Pilih blank · '+candidates.length+' kandidat':'Tidak ada kandidat yang lolos')+'</option>'+candidates.map(({blank:b})=>'<option value="'+esc(b.id)+'" '+(b.id===slot['blankId'+eye]?'selected':'')+'>Ø '+fmt(b.diameter,0)+' · BC '+fmt(b.baseCurve)+' · CT '+fmt(b.ct)+' / ET '+fmt(b.et)+'</option>').join('');$('#blank-'+low).disabled=!candidates.length;$('#blank-detail-'+low).textContent=chosen?'Bahan baku: CT '+fmt(chosen.ct)+' mm · ET '+fmt(chosen.et)+' mm. Belum ketebalan lensa jadi.':(frameFit.valid?'Kebutuhan Ø '+fmt(frameFit.eyes[eye].requiredDiameter)+' mm. '+(ev.summary['minDiameter'+eye]!==null?'Diameter kandidat terkecil '+fmt(ev.summary['minDiameter'+eye],0)+' mm.':'Belum ada diameter yang memenuhi semua aturan.'):'Perbaiki data frame atau sentrasi.');}
  }
  function sameTint(){return state.a.tintCode===state.b.tintCode&&(!isCustom(selectedTint('a'))||state.a.customColor.toLowerCase()===state.b.customColor.toLowerCase());}
  function cameraStatus(force=false){const now=Date.now();if(!force&&now-lastCameraUpdate<100){if(cameraStatusTimer===null)cameraStatusTimer=setTimeout(()=>{cameraStatusTimer=null;cameraStatus(true);},100-(now-lastCameraUpdate));return;}clearTimeout(cameraStatusTimer);cameraStatusTimer=null;lastCameraUpdate=now;const c=viewers[state.active]?.getCamera()||state[state.active].camera;const degrees=v=>Math.round(((v*180/Math.PI)%360+360)%360)%360;$('#rotation-angle').textContent='H '+degrees(c.yaw)+'° · V '+degrees(c.pitch)+'°';}
  function setRotation(enabled){
    settingRotation=true;autoRotating=!!enabled;
    if(autoRotating&&state.sync){viewers.b?.setAutoRotate(false);viewers.a?.setAutoRotate(true);}else for(const v of Object.values(viewers))v.setAutoRotate(autoRotating);
    autoRotating=Object.values(viewers).some(v=>v.isAutoRotating());settingRotation=false;
    $('#auto-rotate').setAttribute('aria-pressed',String(autoRotating));$('#rotation-label').textContent=autoRotating?'Jeda rotasi':'Putar 360°';
    if(autoRotating){currentView='custom';$$('[data-view]').forEach(x=>x.classList.remove('active'));}else{cameraStatus(true);persist();}
  }
  function cameraChanged(key,camera){
    state.camera={...camera};state[key].camera={...camera};const other=key==='a'?'b':'a';
    if(state.sync&&viewers[other]){viewers[other].setOptions({camera});state[other].camera={...camera};}
    if(currentView!=='custom'){currentView='custom';$$('[data-view]').forEach(x=>x.classList.remove('active'));}
    cameraStatus();if(!autoRotating)persist();
  }
  function selectedTint(key=state.active){return tintMap.get(state[key].tintCode)||null;}
  function isCustom(t){return !!t&&['CON','CONG','NOTE'].includes(t.code);}
  function appearance(key){
    const slot=state[key],t=selectedTint(key);if(!t)return {top:null,mid:null,bottom:null,available:true,kind:'Solid'};
    if(isCustom(t))return {top:slot.customColor,mid:null,bottom:t.kind==='Gradient'?'#FFFFFF':slot.customColor,available:true,kind:t.kind};
    return {top:t.previewHex,mid:t.previewMidHex,bottom:t.previewBottomHex,available:!!t.previewHex,kind:t.kind};
  }
  function swatchBackground(t,key){
    if(!t)return 'linear-gradient(135deg,#fbfdfb,#e8eee7)';
    const custom=key&&isCustom(t), top=custom?state[key].customColor:t.previewHex, bottom=custom?(t.kind==='Gradient'?'#ffffff':top):t.previewBottomHex;
    if(!top)return 'repeating-linear-gradient(135deg,#eeede6,#eeede6 5px,#f6f6f0 5px,#f6f6f0 10px)';
    if(t.kind==='Solid')return top;
    return t.previewMidHex&&!custom?'linear-gradient(180deg,'+top+' 0%,'+t.previewMidHex+' 50%,'+(bottom||'#fff')+' 100%)':'linear-gradient(180deg,'+top+' 0%,'+(bottom||'#fff')+' 100%)';
  }
  function tintName(t){return t?t.name:'Tanpa tint';}
  function tintMeta(t){return t?[t.code,t.kind==='Gradient'?'Gradasi':'Solid',t.nominalPercent!==null?'Label '+t.nominalPercent+'%':null].filter(Boolean).join(' · '):'Bening · tanpa kode tint';}
  function statusLabel(t){if(!t)return '';if(t.referenceStatus==='manual')return 'Acuan manual';if(t.referenceStatus==='percent-conflict')return 'Acuan perlu disepakati';if(t.referenceStatus==='category-conflict')return 'Nama berbeda pada PDF';if(t.referenceStatus==='derived-style')return 'Varian visual turunan';if(t.referenceStatus==='missing')return 'Tanpa swatch PDF';return 'Sampel PDF';}
  function selectedShape(){return data.shapes.items.find(s=>s.code===state.shape);}
  function isShapePreset(shape){return shape?.category==='additional'||shape?.source==='managed';}
  function shapeContourMode(shape=selectedShape()){return ['raster','vector'].includes(shape.contourMode)?shape.contourMode:['user-svg','managed'].includes(shape.source)?'vector':'raster';}
  function shapeName(shape=selectedShape()){return shape.name||'Shape '+shape.code;}
  function setShape(code){
    const shape=data.shapes.items.find(s=>s.code===code);
    if(!shape||shape.active===false||state.shape===code)return;
    state.shape=code;
    state.shapeRevision=isShapePreset(shape)?shape.geometryRevision:null;
    if(Number.isFinite(shape.defaultWidthMm)&&Number.isFinite(shape.defaultHeightMm)){state.width=shape.defaultWidthMm;state.height=shape.defaultHeightMm;}
    renderAll();
  }
  function shapePath(shape){
    const points=typeof LensViewer.smoothContour==='function'?LensViewer.smoothContour(shape.points,shapeContourMode(shape)):shape.points;
    const ratio=isShapePreset(shape)?(shape.referenceAspectRatio||shape.defaultWidthMm/shape.defaultHeightMm):70/50;
    const width=Math.min(70,50*ratio),height=width/ratio;
    return points.map((p,i)=>(i?'L':'M')+(40+p[0]*width).toFixed(2)+' '+(30+p[1]*height).toFixed(2)).join(' ')+'Z';
  }
  function shapeButton(shape){
    const sizeValue=value=>fmt(value,Number.isInteger(value)?0:1);
    const preset=isShapePreset(shape),name=shapeName(shape),size=preset?sizeValue(shape.defaultWidthMm)+' × '+sizeValue(shape.defaultHeightMm)+' mm':'';
    return '<button class="shape-button '+(preset?'named-shape ':'')+(shape.code===state.shape?'active':'')+'" data-shape="'+esc(shape.code)+'" title="'+esc(name+(preset?' · ukuran awal A/B '+size:''))+'" aria-label="Pilih '+esc(name)+'" aria-pressed="'+(shape.code===state.shape)+'"><svg viewBox="0 0 80 60" aria-hidden="true"><path d="'+shapePath(shape)+'"/></svg><span>'+esc(preset?(shape.shortName||shape.name):shape.code)+'</span>'+(preset?'<small>'+size+'</small>':'')+'</button>';
  }
  function renderShapes(){
    const group=(label,items,extraClass)=>items.length?'<div class="shape-group" role="group" aria-label="'+label+'"><p class="shape-group-label">'+label+'</p><div class="shape-grid '+extraClass+'">'+items.map(shapeButton).join('')+'</div></div>':'';
    $('#shape-picker').innerHTML=group('Varian tambahan',data.shapes.items.filter(s=>(s.active!==false||s.code===state.shape)&&isShapePreset(s)),'shape-grid-named')+group('Referensi Lensware · 001–009',data.shapes.items.filter(s=>(s.active!==false||s.code===state.shape)&&!isShapePreset(s)),'shape-grid-reference');
    $('#active-shape-name').textContent=shapeName()+(selectedShape().active===false?' · diarsipkan':'');
  }
  function frameDescription(){return state.showFrame?FRAME_STYLES[state.frameStyle]+' · '+(state.showTemples?'tangkai tampil':'tangkai disembunyikan'):'Frame disembunyikan';}
  function renderFrameControls(){
    $('#show-frame').checked=state.showFrame;
    $('#show-temples').checked=state.showTemples;$('#show-temples').disabled=!state.showFrame;
    $$('[data-frame-style]').forEach(el=>{el.classList.toggle('active',el.dataset.frameStyle===state.frameStyle);el.setAttribute('aria-pressed',String(el.dataset.frameStyle===state.frameStyle));el.disabled=!state.showFrame;});
    $('#frame-style-description').textContent=state.showFrame?({'full-rim':'Bingkai mengelilingi seluruh lensa.','half-rimless':'Bingkai pada bagian atas lensa.',rimless:'Sambungan tanpa bingkai keliling.'}[state.frameStyle]):'Hanya lensa ditampilkan.';
    $('#view-studio').classList.toggle('frame-visible',state.showFrame);
  }
  function renderControls(){
    const key=state.active, slot=state[key],t=selectedTint();
    $$('.active-slot-letter,.active-slot-letter-text').forEach(x=>x.textContent=key.toUpperCase());
    $$('.pair-product-switch [data-slot]').forEach(el=>{el.classList.toggle('active',el.dataset.slot===key);el.setAttribute('aria-pressed',String(el.dataset.slot===key));});
    renderSkuControls();renderFrameControls();renderOpticsControls();
    $('#comparison-indices').textContent='A · '+state.a.index+' (R/L) ↔ B · '+state.b.index+' (R/L)';
    $('#comparison-hint').textContent='Bandingkan pasangan A dengan pasangan B. Satu indeks berlaku untuk R dan L dalam setiap pilihan. '+(state.a.index===state.b.index?'Saat ini kedua pasangan memakai indeks yang sama.':sameTint()?'Warna kedua pasangan sama.':'Gunakan Samakan warna untuk menyamakan tint kedua pasangan.');
    const exampleAllowed=indicesFor('a').includes('1.74')&&indicesFor('b').includes('1.50');$('#pair-example').disabled=!exampleAllowed;$('#pair-example').title=exampleAllowed?'Terapkan indeks 1.74 untuk pasangan A dan 1.50 untuk pasangan B':'Contoh ini memerlukan indeks 1.74 pada SKU A dan 1.50 pada SKU B';
    $('#match-tints').title='Salin warna pilihan '+key.toUpperCase()+' ke pilihan '+(key==='a'?'B':'A');
    $('#selected-tint').innerHTML='<div class="selected-tint-inner"><span class="large-swatch" style="background:'+swatchBackground(t,key)+'"></span><div><strong>'+esc(tintName(t))+'</strong><small>'+esc(tintMeta(t))+'</small></div></div>';
    const note=$('#reference-warning');note.hidden=!t;note.className='reference-note'+(t&&['percent-conflict','category-conflict','missing'].includes(t.referenceStatus)?' warning':'');
    if(t)note.textContent=(t.active===false?'Tint diarsipkan; masih ditampilkan untuk referensi konsultasi ini. ':'')+(isCustom(t)?'Warna digital dipilih pengguna sebagai ilustrasi konsultasi. '+(t.requiresPhysicalSample?'Acuan produksi tetap memerlukan contoh lensa fisik.':'Sertakan catatan untuk lab. Untuk warna di luar katalog, contoh lensa fisik tetap diperlukan.'):t.referenceNote);
    $('#custom-tint').hidden=!isCustom(t);$('#custom-color').value=slot.customColor;$('#custom-color-value').textContent=slot.customColor.toUpperCase();
    $('#physical-sample-note').textContent=t?.requiresPhysicalSample?'Contoh lensa fisik diperlukan sesuai petunjuk lembar referensi.':'Warna di luar katalog memerlukan contoh lensa fisik. Kode NOTE tetap mengikuti katalog.';
    $('#tint-note').value=slot.note;
    for(const [id,k]of Object.entries(inputMap))$('#'+id).value=state[k];
    $('#m-shape').innerHTML=[['Varian tambahan',data.shapes.items.filter(s=>(s.active!==false||s.code===state.shape)&&isShapePreset(s))],['Referensi Lensware · 001–009',data.shapes.items.filter(s=>(s.active!==false||s.code===state.shape)&&!isShapePreset(s))]].map(([label,items])=>'<optgroup label="'+label+'">'+items.map(x=>'<option value="'+esc(x.code)+'" '+(x.code===state.shape?'selected':'')+'>'+esc(shapeName(x)+(x.active===false?' · diarsipkan':''))+'</option>').join('')+'</optgroup>').join('');
    $('#studio-shape').innerHTML=$('#m-shape').innerHTML;$('#studio-shape').value=state.shape;
    $('#sync-camera').checked=state.sync;renderShapes();cameraStatus(true);
  }
  function mmRange(low,high){
    if(!Number.isFinite(low)||!Number.isFinite(high))return '—';
    return Math.round(low*100)===Math.round(high*100)?fmt(high):fmt(low)+'–'+fmt(high);
  }
  function measurementValues(key){
    const m=previewMetrics[key]?.pair;
    return {max:m?fmt(m.maxMm):'—',center:m&&m.centerAvailableEyeCount===m.eyeCount?mmRange(m.centerMinMm,m.centerMaxMm):'—',edge:m?mmRange(m.edgeMinMm,m.edgeMaxMm):'—'};
  }
  function measurementsMarkup(key){
    const v=measurementValues(key),m=previewMetrics[key]?.pair;
    return '<div class="thickness-detail"><span>CT pusat <strong>'+v.center+' mm</strong></span><span>ET tepi <strong>'+v.edge+' mm</strong></span><span class="model-label">Estimasi optik</span></div>'+(!m?'<p class="metric-warning">'+esc(metricError(key))+'</p>':m.centerAvailableEyeCount!==m.eyeCount?'<p class="metric-warning">CT belum ditampilkan: pusat optik salah satu mata di luar kontur.</p>':'');
  }
  function renderThicknessComparison(){
    const a=previewMetrics.a?.pair?.maxMm,b=previewMetrics.b?.pair?.maxMm,el=$('#thickness-comparison');
    if(!Number.isFinite(a)||!Number.isFinite(b)){el.textContent='Estimasi ketebalan menunggu data frame dan sentrasi yang valid.';return;}
    const roundedA=Math.round(a*100)/100,roundedB=Math.round(b*100)/100,difference=Math.abs(roundedA-roundedB);
    if(difference<.005){el.innerHTML='<strong>Ketebalan maksimum sama</strong><span>Kedua pasangan '+fmt(a)+' mm pada model ini.</span>';return;}
    const thin=roundedA<roundedB?'A':'B',thick=roundedA<roundedB?'B':'A',percent=difference/Math.max(roundedA,roundedB)*100;
    el.innerHTML='<strong>Pasangan '+thin+' lebih tipis '+fmt(difference)+' mm</strong><span>'+fmt(percent,1)+'% dibanding '+thick+', berdasarkan ketebalan maksimum model.</span>';
  }
  function measurementSummary(key){const v=measurementValues(key);return '<p class="summary-measurements"><strong>Estimasi model 3D:</strong> tebal maksimum '+v.max+' mm · CT pusat '+v.center+' mm · ET tepi '+v.edge+' mm.</p>';}
  function updatePreview(){
    const shape=selectedShape();
    $('#preview-shape-name').textContent=shapeName(shape);
    for(const key of ['a','b']){
      const slot=state[key],t=selectedTint(key),a=appearance(key),active=key===state.active;
      $('#card-'+key).classList.toggle('selected',active);$('#card-'+key+' .lens-card-header').setAttribute('aria-pressed',String(active));$('#card-'+key+' .edit-label').textContent=active?'Sedang dipilih':'Pilih untuk ubah';
      $('#pair-title-'+key).textContent='Pilihan '+key.toUpperCase()+' · '+slot.index;$('#index-label-'+key).textContent='Sepasang kanan + kiri';$('#pair-scope-'+key).textContent='R + L · keduanya indeks '+slot.index;$('#canvas-'+key).setAttribute('aria-label','Pilihan '+key.toUpperCase()+': L di kiri layar dan R di kanan layar, keduanya indeks '+slot.index+'. Geser untuk rotasi 360 derajat atau gulir untuk zoom.');$('#name-'+key).textContent=tintName(t);$('#meta-'+key).textContent=tintMeta(t);$('#caption-swatch-'+key).style.background=swatchBackground(t,key);
      $('#overlay-'+key).hidden=a.available;if(!a.available)$('#overlay-'+key).textContent=t?.referenceStatus==='percent-conflict'?'Pratinjau warna ditunda: CSV 70%, PDF 80%.':'Kode tersedia. Belum ada swatch warna untuk ditampilkan.';
      viewers[key].setOptions({shapePoints:shape.points,contourMode:shapeContourMode(shape),widthMm:state.width,heightMm:state.height,bridgeMm:state.dbl,pairMode:true,eyeLayout:'wearer',showFrame:state.showFrame,showTemples:state.showTemples,frameStyle:state.frameStyle,showMeasurements:true,measurementsValid:frameFit.valid,opticalCenters:frameFit.valid?{R:frameFit.eyes.R.opticalCenter,L:frameFit.eyes.L.opticalCenter}:{R:{x:0,y:0},L:{x:0,y:0}},sph:state.sph,cyl:state.cyl,axis:state.axis,index:Number(slot.index),colorHex:a.top,bottomColorHex:a.bottom,midColorHex:a.mid,kind:a.kind,visualStrength:1,opticalProfiles:{R:opticalProfileFor(key,'R'),L:opticalProfileFor(key,'L')}});
      previewMetrics[key]=frameFit.valid?viewers[key].getThicknessMetrics():null;
      $('#measurements-'+key).innerHTML=measurementsMarkup(key);
      const values=measurementValues(key);
      const centers=['L','R'].map(eye=>{const ct=previewMetrics[key]?.eyes?.[eye]?.centerThicknessMm;return 'CT '+eye+' '+(Number.isFinite(ct)?fmt(ct)+' mm':'belum tersedia');}).join(', ');
      $('#canvas-'+key).setAttribute('aria-label','Pilihan '+key.toUpperCase()+': L di kiri layar dan R di kanan layar, keduanya indeks '+slot.index+'. Bentuk '+shapeName(shape)+'. '+frameDescription()+'. Lebar A '+fmt(state.width,1)+' mm, tinggi B '+fmt(state.height,1)+' mm, jembatan DBL '+fmt(state.dbl,1)+' mm. Estimasi tebal maksimum '+values.max+' mm. '+centers+'. Geser untuk rotasi 360 derajat atau gulir untuk zoom.');
    }
    renderThicknessComparison();
  }
  function renderCatalog(){
    const q=search.trim().toLowerCase(),active=state[state.active].tintCode;
    const rows=data.tints.items.filter(t=>t.active!==false&&(filterKind==='all'||t.kind===filterKind)&&(filterGroup==='all'||t.group===filterGroup)&&(!q||[t.code,t.name,t.kind,t.group].join(' ').toLowerCase().includes(q)));
    $('#results-count').textContent=rows.length+' pilihan';
    $('#tint-grid').innerHTML=rows.length?rows.map(t=>'<button class="tint-card '+(t.code===active?'active':'')+'" data-tint="'+esc(t.code)+'" aria-label="Pilih '+esc(t.code+' '+t.name)+' untuk pilihan '+state.active.toUpperCase()+'" aria-pressed="'+(t.code===active)+'" title="'+esc(t.referenceNote)+'"><div class="swatch-wrap"><span class="swatch-lens '+(!t.previewHex?'swatch-missing':'')+'" style="background:'+swatchBackground(t)+'">'+(!t.previewHex?'?':'')+'</span>'+(t.code===active?'<span class="selected-indicator">✓</span>':'')+'</div><span class="tint-code">'+esc(t.code)+'</span><strong>'+esc(t.name)+'</strong><span class="tint-kind">'+(t.kind==='Gradient'?'Gradasi':'Solid')+(t.nominalPercent!==null?' · '+t.nominalPercent+'%':'')+'</span>'+(['percent-conflict','category-conflict','missing'].includes(t.referenceStatus)?'<span class="warning-dot" aria-label="Ada catatan referensi"></span>':'')+'</button>').join(''):'<div class="empty-state">Tidak ada tint yang sesuai pencarian.<br>Coba nama, kode, atau kategori lainnya.</div>';
    $$('[data-kind]').forEach(x=>{x.classList.toggle('active',x.dataset.kind===filterKind);x.setAttribute('aria-pressed',String(x.dataset.kind===filterKind));});
    $$('[data-group]').forEach(x=>{x.classList.toggle('active',x.dataset.group===filterGroup);x.setAttribute('aria-pressed',String(x.dataset.group===filterGroup));});
  }
  function candidateList(pid=state[state.active].productId,rx=state,mode=materialMode){
    const ev=BlankEngine.evaluate({materials:data.materials,index:productMap.get(pid)?.index||state[state.active].index,productId:pid,skuVariant:skuVariantFor(),rx,frame:frameFit});
    return ev.rows.filter(r=>mode==='all'||r.eligibleR||r.eligibleL).map(r=>({...r,rows:r.sourceRows}));
  }
  function selectedBlank(key,eye){return blankMap.get(state[key]['blankId'+eye])||null;}
  function fitIssue(key=state.active){const ev=evaluations[key],p=skuProblem(key);if(p)return p;if(!frameFit.valid)return frameFit.errors.map(e=>e.message).join(' ');if(!ev.valid)return ev.errors.map(e=>e.message).join(' ');if(state[key].skuId&&!ev.skuPowerAllowed)return 'Resep berada di luar rentang power finish SKU. Kandidat diblokir hingga resep atau konfigurasi SKU sesuai.';if(!ev.summary.eligibleRCount||!ev.summary.eligibleLCount){const missing=['R','L'].filter(e=>!ev.summary['eligible'+e+'Count']).join(' dan ');return 'Belum ada blank yang lolos untuk '+missing+'. Diameter pada produk: '+(ev.summary.availableDiameters.map(d=>fmt(d,0)).join(', ')||'—')+' mm. Periksa ukuran, aturan power, dan assignment pada tabel Semua & alasan.';}return '';}
  function cutoutMarkup(eye,extent){
    const key=state.active,e=frameFit.eyes[eye],ev=evaluations[key],chosen=selectedBlank(key,eye),candidateD=ev.summary['minDiameter'+eye],actualD=chosen?.diameter??candidateD??Math.max(0,...ev.summary.availableDiameters),low=eye.toLowerCase();
    const available=ev.summary['eligible'+eye+'Count']>0,oc=e.opticalCenter;
    const path=e.contour.map((p,i)=>(i?'L':'M')+(p.x-oc.x).toFixed(3)+' '+(p.y-oc.y).toFixed(3)).join(' ')+'Z';
    const box={x:-state.width/2-oc.x,y:-state.height/2-oc.y},cx=-oc.x,cy=-oc.y;
    const svg='<svg viewBox="'+[-extent,-extent,extent*2,extent*2].join(' ')+'" role="img" aria-label="Kontur frame dalam blank lensa '+eye+'"><circle class="cut-blank" r="'+(actualD/2)+'"/><circle class="cut-required" r="'+(e.requiredDiameter/2)+'"/><rect class="cut-box" x="'+box.x+'" y="'+box.y+'" width="'+state.width+'" height="'+state.height+'"/><path class="cut-shape" d="'+path+'"/><path class="cut-center" d="M'+(cx-2)+' '+cy+'h4M'+cx+' '+(cy-2)+'v4"/><line class="cut-radius" x1="0" y1="0" x2="'+(e.farthestPoint.x-oc.x)+'" y2="'+(e.farthestPoint.y-oc.y)+'"/><circle class="cut-oc" r="1.4"/></svg>';
    const title=chosen?'Blank dipilih Ø '+fmt(chosen.diameter,0)+' · BC '+fmt(chosen.baseCurve):candidateD?'Acuan kandidat Ø '+fmt(candidateD,0)+' · belum dipilih':actualD?'Acuan katalog terbesar Ø '+fmt(actualD,0)+' · belum lolos':'Belum ada blank pada produk';
    return '<article class="cutout-card '+(!available?'blocked':'')+'"><div class="cutout-heading"><strong>'+eye+' · '+(eye==='R'?'Kanan':'Kiri')+'</strong><span>'+esc(title)+'</span></div>'+svg+'<p>Minimum geometris '+fmt(e.geometricDiameter)+' + '+fmt(state.allowanceDiameter,1)+' allowance = <strong>'+fmt(e.requiredDiameter)+' mm</strong></p><small>Pergeseran OC: horizontal '+fmt(oc.x)+' · vertikal '+fmt(oc.y)+' mm</small></article>';
  }
  function rowEyeMarkup(row,eye){const selected=state[state.active]['blankId'+eye]===row.blank.id;if(row['eligible'+eye])return '<button class="blank-pick '+(selected?'selected':'')+'" data-pick-blank="'+esc(row.blank.id)+'" data-eye="'+eye+'" aria-pressed="'+selected+'">'+(selected?'✓ Terpilih':'Pilih '+eye)+'</button><small>Sisa Ø '+fmt(row['sizeMargin'+eye])+' mm</small>';return '<span class="fit-badge no">Belum lolos</span><small>'+esc(row['reasons'+eye].map(c=>BlankEngine.reasonLabels[c]||c).join(' '))+'</small>';}
  function renderMaterials(){
    const key=state.active,p=productMap.get(state[key].productId),ev=evaluations[key],sku=selectedSku(key),issue=fitIssue(key),list=ev.rows.filter(r=>materialMode==='all'||r.eligibleR||r.eligibleL);
    $('#candidate-query').textContent=(sku?sku.code+' · ':state[key].skuId?'SKU tidak ditemukan · ':'Tanpa SKU · ')+(p?p.code+' · indeks '+p.index:'Produk belum dipilih')+' · SPH '+fmt(state.sph)+' / CYL '+fmt(state.cyl)+' / ADD '+fmt(state.add);
    $('#material-sku-range').textContent=state[key].skuId?'Rentang finish: '+rangeText(skuVariantFor(key)):'Mode katalog bahan: batas power finish SKU belum diterapkan.';
    $('#fit-alert').textContent=issue||'Kandidat tersedia untuk R dan L. Pilih blank pada tabel untuk mencatat diameter, BC, CT, dan ET bahan.';$('#fit-alert').classList.toggle('warning',!!issue);
    $('#studio-fit-status').innerHTML=frameFit.valid?'<div><strong>Kebutuhan blank</strong><span>R Ø '+fmt(frameFit.eyes.R.requiredDiameter)+' · L Ø '+fmt(frameFit.eyes.L.requiredDiameter)+' mm</span><small>Termasuk allowance Ø '+fmt(state.allowanceDiameter,1)+' mm · '+esc(issue?'Perlu diperiksa':'kandidat tersedia untuk pilihan '+key.toUpperCase())+'</small></div><button class="text-button" data-tab="materials">Periksa cutting ↗</button>':'<div><strong>Data sentrasi perlu diperbaiki</strong><span>'+esc(frameFit.errors.map(e=>e.message).join(' '))+'</span></div><button class="text-button" data-tab="materials">Periksa ↗</button>';
    $('#studio-fit-status').classList.toggle('warning',!!issue);
    const metric=(label,value,sub)=>'<div><span>'+label+'</span><strong>'+value+'</strong><small>'+sub+'</small></div>';
    $('#fit-metrics').innerHTML=frameFit.valid?metric('ED kontur',fmt(frameFit.ed)+' mm','Dari pusat boxing ke titik terjauh')+metric('Frame PD',fmt(frameFit.framePD,1)+' mm','A + DBL')+['R','L'].map(eye=>metric('Kebutuhan Ø '+eye,fmt(frameFit.eyes[eye].requiredDiameter)+' mm',ev.summary['minDiameter'+eye]!==null?'Kandidat terkecil Ø '+fmt(ev.summary['minDiameter'+eye],0)+' mm':'Tidak ada kandidat yang lolos')).join(''):metric('Data belum valid','—','Periksa tinggi sentrasi terhadap B frame');
    if(frameFit.valid){const extent=Math.max(frameFit.requiredDiameter,...['R','L'].map(e=>selectedBlank(key,e)?.diameter??ev.summary['minDiameter'+e]??Math.max(0,...ev.summary.availableDiameters)))/2+6;$('#cutout-grid').innerHTML=['R','L'].map(e=>cutoutMarkup(e,extent)).join('');}else $('#cutout-grid').innerHTML='';
    $('#candidate-rows').innerHTML=list.length?list.map(r=>{const b=r.blank,rows=r.sourceRows.length?r.sourceRows:r.allSourceRows;return '<tr><td>'+fmt(b.baseCurve)+'</td><td><strong>Ø '+fmt(b.diameter,0)+'</strong></td><td>'+fmt(b.ct)+'</td><td>'+fmt(b.et)+'</td><td>'+rowEyeMarkup(r,'R')+'</td><td>'+rowEyeMarkup(r,'L')+'</td><td><span class="fit-badge '+(r.rawPowerMatches?'yes':'no')+'">Power bahan '+(r.rawPowerMatches?'sesuai':'di luar')+'</span>'+(state[key].skuId?'<span class="fit-badge '+(r.skuAssignmentMatches?'yes':'no')+'">'+(r.skuAssignmentMatches?'Di-assign SKU':'Belum di-assign')+'</span>':'')+'<small title="'+esc(rows.join(', '))+'">'+(r.sourceRows.length?'Baris cocok: ':'Baris spesifikasi: ')+esc(rows.slice(0,6).join(', ')+(rows.length>6?' … ('+rows.length+' baris)':''))+'</small></td></tr>';}).join(''):'<tr><td colspan="7"><div class="empty-state">Tidak ada kandidat yang lolos untuk pilihan ini.<br>Lihat <button class="text-button" data-material-mode="all">Semua & alasan</button> untuk memeriksa setiap spesifikasi blank.</div></td></tr>';
    $('#candidate-count').textContent=list.length+' dari '+ev.summary.productBlankCount+' spesifikasi produk · '+ev.summary.eligibleRCount+' kandidat R / '+ev.summary.eligibleLCount+' kandidat L. Diameter, CT, dan ET ditampilkan dalam mm (asumsi satuan CSV). BC belum diprioritaskan otomatis.';
    $$('[data-material-mode]').forEach(x=>{x.classList.toggle('active',x.dataset.materialMode===materialMode);x.setAttribute('aria-pressed',String(x.dataset.materialMode===materialMode));});$$('.choice-switch [data-slot]').forEach(x=>{x.classList.toggle('active',x.dataset.slot===key);x.setAttribute('aria-pressed',String(x.dataset.slot===key));});
  }
  function renderAll(){recalculatePlanning();renderControls();updatePreview();renderCatalog();renderMaterials();renderManageSummary();persist();}
  function showManage(kind=currentManageTab,detail=null){
    if(!['materials','shapes','tints','skus'].includes(kind))kind='materials';
    if((kind==='skus'||detail)&&masterManager?.isDirty()&&!masterManager.confirmLeave())return false;
    if(kind!=='skus'&&masterManager&&masterManager.setTab(kind)===false)return false;
    currentManageTab=kind;currentManageDetail=detail;
    $('#master-manager-root').hidden=kind==='skus'||!!detail;
    $('#view-skus').hidden=kind!=='skus';$('#view-materials').hidden=detail!=='screening';$('#view-reference').hidden=detail!=='reference';
    $$('[data-manage-tab]').forEach(el=>{const active=el.dataset.manageTab===kind;el.classList.toggle('active',active);if(el.getAttribute('role')==='tab'){el.setAttribute('aria-selected',String(active));el.tabIndex=active?0:-1;}});
    $('#manage-content').setAttribute('aria-labelledby','manage-tab-'+kind);
    if(detail==='screening')renderMaterials();renderManageSummary();
    return true;
  }
  function setTab(tab){
    if(tab==='materials'){if(!showManage('materials','screening'))return;tab='manage';}
    else if(tab==='reference'){if(!showManage('tints','reference'))return;tab='manage';}
    else if(tab==='skus'){if(!showManage('skus'))return;tab='manage';}
    else if(tab==='manage'&&!showManage(currentManageTab,currentManageDetail))return;
    currentTab=tab==='manage'?'manage':'studio';
    if(currentTab!=='studio')setRotation(false);
    $$('.page-view').forEach(x=>x.hidden=x.id!=='view-'+currentTab);
    $$('.nav-button').forEach(x=>{x.classList.toggle('active',x.dataset.tab===currentTab);if(x.dataset.tab===currentTab)x.setAttribute('aria-current','page');else x.removeAttribute('aria-current');});
    window.scrollTo({top:0,behavior:'smooth'});
    if(currentTab==='studio')requestAnimationFrame(()=>{viewers.a.setOptions({});viewers.b.setOptions({});});
  }
  function getSelection(key){const slot=state[key],t=selectedTint(key),p=productMap.get(slot.productId),a=appearance(key);return {choice:key.toUpperCase(),index:slot.index,indexAppliesTo:['R','L'],comparisonUnit:'lens-pair',displayConvention:'wearer-side-layout',screenEyeOrder:['L','R'],eyeMode:'paired-illustration-shared-prescription',sku:skuSnapshot(key),blankSelection:blankSnapshot(key),camera:{...slot.camera},product:p?{supplier:p.supplier,lensCode:p.code,name:p.name,index:p.index}:null,tint:t?{code:t.code,description:t.name,kind:t.kind,nominalPercent:t.nominalPercent,chartNominalPercent:t.chartNominalPercent??null,referenceStatus:t.referenceStatus,referenceNote:t.referenceNote,sourcePage:t.sourcePage,sourceRow:t.sourceRow,previewAvailable:a.available,previewColor:a.top,previewMidColor:a.mid,previewBottomColor:a.bottom,previewColorSource:isCustom(t)?'user-selected-consultation-color':a.available?(t.referenceStatus==='manual'?'managed-digital-reference':'PDF-screen-sample'):null,previewCalibrated:false,requiresPhysicalSample:t.code==='NOTE'?null:!!t.requiresPhysicalSample,physicalSampleCondition:t.requiresPhysicalSample?'required':t.code==='NOTE'?'required-if-color-outside-catalog':null}:null,note:slot.note,compatibilityWithMaterial:'not-verified',illustrativeThickness:previewMetrics[key]||null,finishedThickness:null,productionGeometry:null};}
  function skuSnapshot(key){const sku=selectedSku(key);return !state[key].skuId?null:{id:state[key].skuId,code:sku?.code||null,name:sku?.name||null,active:!!sku?.active,updatedAt:sku?.updatedAt||null,variant:JSON.parse(JSON.stringify(skuVariantFor(key))),issue:skuProblem(key)||null};}
  function blankSnapshot(key){const ev=evaluations[key];return {screeningStatus:ev.status,screeningIssue:fitIssue(key)||null,availability:'configured-catalog-not-live-stock',eyes:Object.fromEntries(['R','L'].map(eye=>{const b=selectedBlank(key,eye),row=b?ev.rows.find(r=>r.blank.id===b.id):null;return [eye,b?{...b,rawThickness:true,requiredDiameter:frameFit.eyes[eye].requiredDiameter,sizeMargin:row['sizeMargin'+eye],matchingRuleIds:row.matchingRuleIds,sourceRows:row.sourceRows}:null];})),eligibleDiameters:Object.fromEntries(['R','L'].map(eye=>[eye,[...new Set(ev.rows.filter(r=>r['eligible'+eye]).map(r=>r.blank.diameter))].sort((a,b)=>a-b)])),surfacingVolumeVerified:false};}
  function payload(){return {schema:'trl-lens-consultation/1.3',applicationVersion:VERSION,storageMode:storage.mode,title:$('#consultation-title').value.trim()||'Pilihan lensa',createdAt:new Date().toISOString(),status:'consultation-draft',productionReady:false,lenswareConnected:false,preview:{comparisonUnit:'lens-pair',displayConvention:'wearer-side-layout',screenEyeOrder:['L','R'],indexScope:'one-index-for-both-eyes-in-each-choice',eyeMode:'paired-illustration-shared-prescription',eyes:['R','L'],rotationMode:'individual-lens-centers',cameraSynchronized:state.sync,sameTint:sameTint(),geometry:'spherical-toric-sag-with-per-eye-centration',optics:JSON.parse(JSON.stringify(state.optics)),productionCalibration:'not-validated',frameDisplay:{visible:state.showFrame,style:state.frameStyle,styleName:FRAME_STYLES[state.frameStyle],templesVisible:state.showFrame&&state.showTemples,templesEnabled:state.showTemples,illustrative:true}},frame:{shapeCode:state.shape,shapeName:shapeName(),shapeSource:selectedShape().source==='managed'?'managed-contour-shared-with-3D':selectedShape().source==='user-svg'?'traced-inner-aperture-from-user-svg-shared-with-3D':'smoothed-illustration-from-reference-screenshot-shared-with-3D',shapeReference:isShapePreset(selectedShape())?{file:selectedShape().sourceFile,sha256:selectedShape().sourceSha256,geometryRevision:selectedShape().geometryRevision,contourMode:shapeContourMode(),aspectRatio:selectedShape().referenceAspectRatio,indexBase:selectedShape().sourceIndexBase,pathIndex:selectedShape().sourcePathIndex,subpathIndex:selectedShape().sourceSubpathIndex,contour:selectedShape().sourceContour}:null,shapePresetDimensions:isShapePreset(selectedShape())?{a:selectedShape().defaultWidthMm,b:selectedShape().defaultHeightMm,unit:'mm'}:null,a:state.width,b:state.height,dbl:state.dbl,allowanceDiameter:state.allowanceDiameter,unit:'mm',screening:frameFit},prescription:{sph:state.sph,cyl:state.cyl,axis:state.axis,add:state.add,monocularPd:{R:state.pdR,L:state.pdL},fittingHeight:{R:state.heightR,L:state.heightL},scope:'one-test-prescription-shared-by-both-eyes-and-comparisons'},choices:[getSelection('a'),getSelection('b')],notes:['Screen preview is not a calibrated color measurement or VLT.','Thickness uses spherical-front/toric-rear sag with back-vertex power and explicit minimum CT/ET constraints; not validated against Lensware production.','Blank CT/ET is raw-material metadata, not finished thickness.','Diameter fit does not verify surfacing volume, base-curve priority, prism or design feasibility.','Raw power ranges are inclusive, CYL zero is literal, and mm is an assumed CSV unit.',(storage.mode==='mysql'?'SKU data is shared in MySQL; consultation history is scoped to the signed-in account. Configured availability is not actual inventory.':'SKU data is browser-local and configured availability is not actual inventory.')],sources:{masterStorage:storage.mode,masterRevision:storage.getCatalogRevision(),managedMasterChangesSupported:true,tints:'tint code lensware untuk umum.csv',colorReference:'LEMBAR CONTOH WARNA-REVISI-21-12-2023-CTP-EMBEDED-SAMPLE FILE VECTOR.pdf',rawMaterial:'DMO UNV OSA(1).csv'}};}
  function snapshot(key){try{return viewers[key].toDataURL();}catch{return '';}}
  function choiceMarkup(key,images){const t=selectedTint(key),slot=state[key],p=productMap.get(slot.productId),img=images?snapshot(key):'';return '<article class="summary-choice">'+(img?'<img src="'+img+'" alt="Ilustrasi pasangan R/L pilihan '+key.toUpperCase()+'">':'')+'<div><h3>Pasangan R/L '+key.toUpperCase()+' · '+esc(tintName(t))+'</h3><p><strong>'+esc(tintMeta(t))+'</strong></p><p>Indeks '+esc(slot.index)+' · '+esc(p?p.code:'')+'</p>'+measurementSummary(key)+'<p><strong>SKU:</strong> '+esc(selectedSku(key)?.code|| (slot.skuId?'Tidak tersedia':'Belum dipilih'))+'</p>'+['R','L'].map(eye=>{const b=selectedBlank(key,eye);return '<p><strong>Blank '+eye+':</strong> '+(b?'Ø '+fmt(b.diameter,0)+' · BC '+fmt(b.baseCurve)+' · CT '+fmt(b.ct)+' / ET '+fmt(b.et)+' mm (bahan baku)':'Belum dipilih')+'</p>';}).join('')+(fitIssue(key)?'<p>'+esc(fitIssue(key))+'</p>':'')+(t?'<p>'+esc(statusLabel(t))+' · '+esc(t.referenceNote)+'</p>':'')+(isCustom(t)?'<p>Warna digital pengguna: '+esc(slot.customColor.toUpperCase())+'. Acuan konsultasi.</p>':'')+(slot.note?'<p><strong>Catatan:</strong> '+esc(slot.note)+'</p>':'')+'</div></article>';}
  function summaryMarkup(images=true){return '<div class="summary-choices">'+choiceMarkup('a',images)+choiceMarkup('b',images)+'</div><div class="summary-details">Sepasang R/L pada setiap pilihan · resep uji sama untuk kedua mata<br>'+esc(shapeName())+' · '+esc(frameDescription())+'<br>A '+fmt(state.width,1)+' / B '+fmt(state.height,1)+' / DBL '+fmt(state.dbl,1)+' mm<br>SPH '+fmt(state.sph)+' · CYL '+fmt(state.cyl)+' · AXIS '+state.axis+' · ADD '+fmt(state.add)+'<br>PD R/L '+fmt(state.pdR,1)+' / '+fmt(state.pdL,1)+' mm · tinggi R/L '+fmt(state.heightR,1)+' / '+fmt(state.heightL,1)+' mm<br>'+(frameFit.valid?'Kebutuhan diameter R/L '+fmt(frameFit.eyes.R.requiredDiameter)+' / '+fmt(frameFit.eyes.L.requiredDiameter)+' mm, termasuk allowance total '+fmt(state.allowanceDiameter,1)+' mm.':'Data frame atau sentrasi belum valid.')+'</div>';}
  function showSummary(){setRotation(false);if(!$('#consultation-title').value)$('#consultation-title').value='Pilihan warna · '+new Date().toLocaleDateString('id-ID');$('#summary-content').innerHTML=summaryMarkup();$('#summary-dialog').showModal();}
  function downloadBlob(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function timestamp(){return new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');}
  function refreshSavedCount(){$('#saved-count').textContent=saved.length;}
  async function saveLocal(){
    if(savingHistory)return;savingHistory=true;$('#save-local').disabled=true;
    try{
      const entry={id:globalThis.crypto?.randomUUID?crypto.randomUUID():String(Date.now()),title:$('#consultation-title').value.trim().slice(0,100)||'Pilihan warna lensa',createdAt:new Date().toISOString(),state:JSON.parse(JSON.stringify(state)),data:payload()};
      const next=[entry,...saved].slice(0,30);
      if(await writeStorage(SAVED_KEY,next)){saved=readHistory();refreshSavedCount();$('#summary-dialog').close();toast(storage.mode==='mysql'?'Pilihan tersimpan di MySQL.':'Pilihan tersimpan di browser ini.');}
      else toast('Pilihan belum tersimpan. Periksa status penyimpanan atau unduh JSON sebagai cadangan.');
    }finally{savingHistory=false;$('#save-local').disabled=false;}
  }
  function renderSaved(){ $('#saved-list').innerHTML=saved.length?saved.map(s=>'<article class="saved-item"><div><h3>'+esc(typeof s.title==='string'?s.title:'Pilihan lensa')+'</h3><p>'+esc(Number.isFinite(Date.parse(s.createdAt))?new Date(s.createdAt).toLocaleString('id-ID'):'Tanggal tidak tersedia')+'</p><p>'+esc(LeinzConsultations.historyTintLabels(s))+'</p></div><div class="actions"><button class="button secondary" data-load-saved="'+esc(s.id)+'">Buka</button><button class="icon-button" data-delete-saved="'+esc(s.id)+'" aria-label="Hapus '+esc(s.title)+'">×</button></div></article>').join(''):'<div class="empty-state">Belum ada pilihan tersimpan.<br>Gunakan tombol Simpan pilihan di studio.</div>';}
  async function readConsultationImport(file){
    if(!file)return;const review=$('#consultation-import-review');pendingConsultationImport=null;review.hidden=false;
    try{
      if(file.size>2*1024*1024)throw Error('Berkas konsultasi maksimal 2 MB.');
      const document=JSON.parse(await file.text()),input=LeinzConsultations.consultationToState(document,data);
      const title=typeof document.title==='string'?document.title.trim().slice(0,100):'';
      pendingConsultationImport={id:globalThis.crypto?.randomUUID?crypto.randomUUID():String(Date.now()),title:title||'Konsultasi impor',createdAt:new Date().toISOString(),state:normalizeState(input),data:document};
      review.innerHTML='<h3>'+esc(pendingConsultationImport.title)+'</h3><p>Pasangan A indeks '+esc(input.a.index)+' · pasangan B indeks '+esc(input.b.index)+'<br>A '+fmt(input.width,1)+' / B '+fmt(input.height,1)+' / DBL '+fmt(input.dbl,1)+' mm</p><p>Konsultasi ditambahkan ke riwayat akun ini. Master SKU diimpor terpisah melalui menu Master SKU; ketersediaan blank diperiksa kembali saat konsultasi dibuka.</p><div class="dialog-actions"><button class="button secondary" data-cancel-consultation-import>Batal</button><button class="button primary" data-apply-consultation-import>Simpan konsultasi</button></div>';
    }catch(err){review.textContent=err.message||'Berkas konsultasi belum dapat dibaca.';}
    finally{$('#consultation-import').value='';}
  }
  function downloadImage(key){
    setRotation(false);viewers[key].render();
    const original=$('#canvas-'+key),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d'),values=measurementValues(key);
    canvas.width=1200;canvas.height=1240;ctx.fillStyle='#f7f8f3';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle='#30362b';ctx.font='32px Arial';ctx.fillText('LEINZ / LENS STUDIO',55,65);ctx.font='18px Arial';ctx.fillStyle='#838c78';ctx.fillText('Pilihan '+key.toUpperCase()+' · pasangan R/L indeks '+state[key].index+' · '+shapeName()+' · '+frameDescription(),55,102,1090);
    const ratio=original.width/original.height,w=Math.min(1090,650*ratio),h=w/ratio;ctx.drawImage(original,(1200-w)/2,140,w,h);
    const t=selectedTint(key);ctx.fillStyle='#30362b';ctx.font='bold 28px Arial';ctx.fillText(tintName(t),55,835,1090);ctx.font='20px Arial';ctx.fillStyle='#7e8873';ctx.fillText(tintMeta(t)+' · indeks '+state[key].index,55,875,1090);
    ctx.fillStyle='#4c6241';ctx.font='bold 24px Arial';ctx.fillText('Ketebalan maksimum '+values.max+' mm · estimasi model 3D',55,930,1090);
    ctx.font='20px Arial';ctx.fillText('Lebar A '+fmt(state.width,1)+' mm   ·   Tinggi B '+fmt(state.height,1)+' mm   ·   DBL '+fmt(state.dbl,1)+' mm',55,972,1090);
    ctx.font='18px Arial';ctx.fillText('CT pusat '+values.center+' mm   ·   ET tepi '+values.edge+' mm',55,1010,1090);
    ctx.fillStyle='#7e8873';ctx.font='16px Arial';ctx.fillText('Model sag sferis/torik dengan minimum CT/ET dan curve depan sesuai parameter.',55,1060,1090);ctx.fillText('Ketebalan maksimum adalah nilai terbesar pada pasangan; CT/ET berupa rentang bila berbeda.',55,1090,1090);ctx.fillText('Model belum dikalibrasi terhadap hasil produksi Lensware; CT/ET blank adalah data terpisah.',55,1120,1090);
    if(!appearance(key).available){ctx.fillStyle='#8b632d';ctx.fillText('Kode ini belum memiliki pratinjau warna yang tervalidasi dari referensi.',55,1150,1090);}
    canvas.toBlob(blob=>{if(blob)downloadBlob(blob,'leinz-'+key+'-'+(t?.code||'clear')+'-'+timestamp()+'.png');else toast('Gambar belum dapat diekspor.');},'image/png');
  }
  function bindEvents(){
    $('#optics-override').addEventListener('change',e=>{state.optics.useOverride=e.target.checked;$('#optics-error').hidden=true;renderAll();});
    $('#apply-optics').addEventListener('click',applyOpticalInputs);
    $('#optics-curve-basis').addEventListener('change',e=>{$('#optics-ref-index').disabled=e.target.value!=='reference-index';});
    $('#refresh-masters').addEventListener('click',async()=>{const button=$('#refresh-masters');if(masterManager?.isBusy()){toast('Penyimpanan master masih berlangsung.');return;}if(masterManager?.isDirty()&&!masterManager.confirmLeave())return;button.disabled=true;try{applyCatalogs(await storage.refreshCatalogs());toast('Master terbaru telah dimuat.');}catch(err){toast(err.message);}finally{button.disabled=false;}});
    $('.manage-tabs').addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;const tabs=$$('[role="tab"]',$('.manage-tabs')),current=tabs.indexOf(document.activeElement);if(current<0)return;e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(current+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;tabs[next].click();tabs[next].focus();});
    document.addEventListener('click',async ev=>{
      const el=ev.target.closest('button');if(!el)return;
      if(el.dataset.manageTab){if(showManage(el.dataset.manageTab))setTab('manage');return;}
      if(el.dataset.tab){setTab(el.dataset.tab);return;}
      if(el.dataset.slot){state.active=el.dataset.slot;renderAll();return;}
      if(el.dataset.pickBlank){const eye=el.dataset.eye,row=evaluations[state.active].rows.find(r=>r.blank.id===el.dataset.pickBlank);if(['R','L'].includes(eye)&&row?.['eligible'+eye]){state[state.active]['blankId'+eye]=row.blank.id;renderAll();}return;}
      if(el.dataset.tint){if(tintMap.get(el.dataset.tint)?.active===false)return;state[state.active].tintCode=el.dataset.tint;renderAll();return;}
      if(el.dataset.frameStyle&&Object.hasOwn(FRAME_STYLES,el.dataset.frameStyle)){state.frameStyle=el.dataset.frameStyle;renderFrameControls();updatePreview();persist();return;}
      if(el.dataset.shape){setShape(el.dataset.shape);return;}
      if(el.dataset.kind){filterKind=el.dataset.kind;renderCatalog();return;}
      if(el.dataset.group){filterGroup=el.dataset.group;renderCatalog();return;}
      if(el.dataset.materialMode){materialMode=el.dataset.materialMode;renderMaterials();return;}
      if(el.dataset.view){setRotation(false);const view=el.dataset.view;for(const key of ['a','b'])view==='reset'?viewers[key].reset():viewers[key].setView(view);$$('[data-view]').forEach(x=>x.classList.toggle('active',x.dataset.view===(view==='reset'?'perspective':view)));currentView=view==='reset'?'perspective':view;cameraStatus(true);return;}
      if(el.dataset.close){$('#'+el.dataset.close).close();return;}
      if(el.dataset.action==='download-image'){downloadImage(el.dataset.slotId);return;}
      if(el.dataset.loadSaved){const s=saved.find(x=>x.id===el.dataset.loadSaved);if(s){setRotation(false);state=normalizeState(s.state);$('#consultation-title').value=s.title;$('#saved-dialog').close();renderAll();for(const key of ['a','b'])viewers[key].setOptions({camera:state[key].camera});currentView='custom';$$('[data-view]').forEach(x=>x.classList.remove('active'));cameraStatus(true);setTab('studio');toast('Pilihan tersimpan dibuka.');}return;}
      if(el.dataset.deleteSaved){if(savingHistory)return;savingHistory=true;el.disabled=true;try{const next=saved.filter(s=>s.id!==el.dataset.deleteSaved);if(await writeStorage(SAVED_KEY,next)){saved=readHistory();refreshSavedCount();renderSaved();toast('Pilihan dihapus dari riwayat.');}else toast('Penghapusan belum tersimpan. Periksa status penyimpanan.');}finally{savingHistory=false;el.disabled=false;}return;}
      if(el.hasAttribute('data-cancel-consultation-import')){pendingConsultationImport=null;$('#consultation-import-review').hidden=true;return;}
      if(el.hasAttribute('data-apply-consultation-import')){if(!pendingConsultationImport||savingHistory)return;savingHistory=true;el.disabled=true;try{const next=[pendingConsultationImport,...saved].slice(0,30);if(await writeStorage(SAVED_KEY,next)){saved=readHistory();pendingConsultationImport=null;$('#consultation-import-review').hidden=true;refreshSavedCount();renderSaved();toast('Konsultasi berhasil diimpor.');}else toast('Impor belum tersimpan. Periksa status penyimpanan.');}finally{savingHistory=false;el.disabled=false;}return;}
    });
    $('#index-select').addEventListener('change',e=>setIndex(state.active,e.target.value));
    $('#show-frame').addEventListener('change',e=>{state.showFrame=e.target.checked;renderFrameControls();updatePreview();persist();});
    $('#show-temples').addEventListener('change',e=>{state.showTemples=e.target.checked;renderFrameControls();updatePreview();persist();});
    for(const key of ['a','b'])$('#index-'+key).addEventListener('change',e=>setIndex(key,e.target.value));
    $('#pair-example').addEventListener('click',applyPairExample);
    $('#match-tints').addEventListener('click',()=>{const from=state.active,to=from==='a'?'b':'a';state[to].tintCode=state[from].tintCode;state[to].customColor=state[from].customColor;renderAll();toast('Warna pilihan '+from.toUpperCase()+' diterapkan juga ke '+to.toUpperCase()+'.');});
    $('#auto-rotate').addEventListener('click',()=>setRotation(!autoRotating));
    for(const key of ['a','b']){
      const canvas=$('#canvas-'+key),activate=()=>{if(state.active!==key){state.active=key;renderAll();}};
      const manualInput=()=>{if(autoRotating)setRotation(false);activate();};
      canvas.addEventListener('focus',activate);
      canvas.addEventListener('pointerdown',()=>{manualInput();canvas.focus({preventScroll:true});},{capture:true});
      canvas.addEventListener('wheel',manualInput,{capture:true,passive:true});
      canvas.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-','=','Home'].includes(e.key))manualInput();},{capture:true});
    }
    $('#sku-select').addEventListener('change',e=>setSku(e.target.value));
    $('#product-select').addEventListener('change',e=>{state[state.active].productId=e.target.value;clearBlanks(state.active);renderAll();});
    for(const eye of ['R','L'])$('#blank-'+eye.toLowerCase()).addEventListener('change',e=>{const row=evaluations[state.active].rows.find(r=>r.blank.id===e.target.value);state[state.active]['blankId'+eye]=row?.['eligible'+eye]?row.blank.id:null;renderAll();});
    for(const id of ['m-shape','studio-shape'])$('#'+id).addEventListener('change',e=>setShape(e.target.value));
    $('#tint-search').addEventListener('input',e=>{search=e.target.value;renderCatalog();});
    $('#tint-note').addEventListener('input',e=>{state[state.active].note=e.target.value.slice(0,800);persist();});
    $('#custom-color').addEventListener('input',e=>{state[state.active].customColor=e.target.value;renderControls();updatePreview();persist();});
    $('#clear-tint').addEventListener('click',()=>{state[state.active].tintCode=null;renderAll();});
    $('#sync-camera').addEventListener('change',e=>{const running=autoRotating;setRotation(false);state.sync=e.target.checked;if(state.sync){const camera=viewers[state.active].getCamera();for(const key of ['a','b']){viewers[key].setOptions({camera});state[key].camera={...camera};}state.camera={...camera};}if(running)setRotation(true);cameraStatus(true);persist();});
    for(const [id,key]of Object.entries(inputMap)){const el=$('#'+id),commit=()=>{if(el.value.trim()===''||!Number.isFinite(Number(el.value))){el.value=state[key];toast('Isi angka yang valid. Nilai sebelumnya dipertahankan.');return;}const next=Number(el.value);if(next===state[key])return;state[key]=next;state=normalizeState(state);renderAll();};el.addEventListener('change',commit);el.addEventListener('blur',commit);}
    $('#show-candidates').addEventListener('click',()=>{materialMode='candidates';setTab('materials');});
    $('#open-summary').addEventListener('click',showSummary);
    $('#open-saved').addEventListener('click',()=>{renderSaved();$('#saved-dialog').showModal();});
    $('#save-local').addEventListener('click',saveLocal);
    $('#consultation-import').addEventListener('change',event=>readConsultationImport(event.target.files?.[0]));
    $('#storage-retry').addEventListener('click',async()=>{try{await retryStorage();}catch(err){toast(err.message);}});
    $('#storage-login').addEventListener('click',async()=>{await loginFlow(true);$('#app').hidden=false;try{await retryStorage();}catch(err){toast(err.message);}});
    $('#storage-reload').addEventListener('click',()=>$('#reload-dialog').showModal());
    $('#confirm-reload').addEventListener('click',()=>{allowDiscardOnReload=true;window.location.reload();});
    $('#storage-logout').addEventListener('click',async()=>{const button=$('#storage-logout');button.disabled=true;try{setRotation(false);if(!await flushState())throw Error('Draft belum tersimpan. Unduh JSON atau coba simpan lagi sebelum keluar.');await storage.logout();window.location.reload();}catch(err){toast(err.message);button.disabled=false;}});
    $('#download-json').addEventListener('click',()=>{downloadBlob(new Blob([JSON.stringify(payload(),null,2)],{type:'application/json'}),'leinz-consultation-'+timestamp()+'.json');toast('Ringkasan JSON diunduh.');});
    $('#print-summary').addEventListener('click',()=>{const title=$('#consultation-title').value.trim()||'Pilihan warna lensa';$('#print-area').innerHTML='<p class="print-kicker">LEINZ LENS STUDIO / TIMUR RAYA LESTARI</p><h1>'+esc(title)+'</h1>'+summaryMarkup()+'<p class="dialog-note">Draft konsultasi, '+esc(new Date().toLocaleString('id-ID'))+'. Warna layar dan bentuk 3D adalah ilustrasi. Ketebalan akhir serta kesesuaian tint–material belum diverifikasi melalui Lensware. Persentase tint bukan hasil pengukuran VLT.</p>';window.print();});
    for(const key of ['summary','saved'])$('#'+key+'-dialog').addEventListener('click',e=>{if(e.target===e.currentTarget){const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.currentTarget.close();}});
    window.addEventListener('beforeunload',event=>{if(allowDiscardOnReload)return;if(masterManager?.isDirty()||masterManager?.isBusy()||skuManager?.draft){event.preventDefault();event.returnValue='';return;}if(storage.mode==='browser'){storage.setItem(STATE_KEY,JSON.stringify(state)).catch(()=>{});return;}if(stateChangeSerial>stateSavedSerial||storage.status().pending){event.preventDefault();event.returnValue='';}});
  }
  async function init(){
    installIcons();
    try{
      storage=new LeinzStorage({runtime:window.LEINZ_RUNTIME,onStatus:renderStorageStatus});
      const session=await storage.connect();if(!session.authenticated)await loginFlow();
      $('#loading').hidden=false;data=await storage.load();
      const catalogCheck=LeinzCatalogModel.validateCatalogBundle(data);
      if(!catalogCheck.ok)throw Error(catalogCheck.errors.slice(0,3).join(' '));
      rebuildMasterMaps();
      if(typeof SkuManager!=='function'||typeof BlankEngine!=='object')throw Error('Modul perencanaan SKU atau blank belum dapat dibaca.');
      skuManager=new SkuManager({container:$('#sku-admin'),materials:data.materials,indices:INDICES,storage,storageMode:storage.mode,onChange:()=>{if(state&&viewers.a)renderAll();},onNotify:toast});
      state=normalizeState(readStorage(STATE_KEY,freshState()));saved=readHistory();
      mountManage();
      if(storage.mode==='mysql'){$('#save-local').textContent='Simpan ke MySQL';$('#saved-scope').textContent='RIWAYAT AKUN INI';$('#saved-storage-note').textContent='Tersimpan di server MySQL untuk akun ini. Unduh JSON untuk cadangan atau pemindahan konsultasi.';}
      if(typeof LensViewer!=='function')throw Error('Modul pratinjau 3D belum dapat dibaca.');
      $('#loading').hidden=true;$('#app').hidden=false;
      for(const key of ['a','b'])viewers[key]=new LensViewer($('#canvas-'+key),{camera:state[key].camera,background:'#f6f7f3',opticalProfile:defaultOpticalProfile(),pairMode:true,eyeLayout:'wearer',bridgeMm:state.dbl,onChange:camera=>cameraChanged(key,camera),onRotationChange:enabled=>{if(!enabled&&!settingRotation&&autoRotating)setRotation(false);}});
      bindEvents();renderAll();refreshSavedCount();
      window.LeinzStudio={getState:()=>JSON.parse(JSON.stringify(state)),getPayload:payload,findCandidates:(productId,rx={})=>productMap.get(productId)?.activeForSimulator?candidateList(productId,{...state,...rx},'candidates').map(x=>({blank:{...x.blank},rows:[...x.rows]})):[],getCatalogs:()=>JSON.parse(JSON.stringify(data)),summary:data.tints.summary,version:VERSION};
    }catch(err){$('#loading').hidden=true;$('#login-panel').hidden=true;$('#app').hidden=true;const panel=document.createElement('div');panel.className='error-panel';panel.innerHTML='<h2>Simulator belum dapat dimuat</h2><p>'+esc(err.message)+'</p><button class="button secondary">Coba lagi</button>';panel.querySelector('button').addEventListener('click',()=>window.location.reload());$('#main').append(panel);console.error(err);}
  }
  init();
})();
