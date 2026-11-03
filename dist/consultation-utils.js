(function(global) {
  'use strict';
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const safeId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(value);
  const validSavedEntry = item => object(item) && safeId(item.id) && object(item.state);
  function historyTintLabels(item) {
    const choices = Array.isArray(item?.data?.choices) ? item.data.choices : ['a','b'].map(key=>({tint:{code:item?.state?.[key]?.tintCode}}));
    return choices.slice(0,2).map(choice => typeof choice?.tint?.code === 'string' ? choice.tint.code : 'Bening').join(' / ');
  }
  function consultationToState(payload, catalogs) {
    if (!object(payload) || payload.schema !== 'trl-lens-consultation/1.3' || !Array.isArray(payload.choices) || payload.choices.length !== 2) throw Error('Gunakan JSON konsultasi Leinz dengan schema trl-lens-consultation/1.3.');
    const frame=payload.frame,rx=payload.prescription;
    if (!object(frame)||!object(rx)||!catalogs.shapes.items.some(s=>s.code===frame.shapeCode)) throw Error('Bentuk frame atau resep pada berkas tidak valid.');
    if(payload.preview!==undefined&&!object(payload.preview))throw Error('Pengaturan preview harus berupa objek.');
    const preview=payload.preview||{},display=preview.frameDisplay;
    if(display!==undefined&&!object(display))throw Error('Pengaturan frame harus berupa objek.');
    if(preview.cameraSynchronized!==undefined&&typeof preview.cameraSynchronized!=='boolean')throw Error('Status sinkronisasi kamera harus berupa boolean.');
    for(const key of ['visible','templesEnabled','templesVisible'])if(display?.[key]!==undefined&&typeof display[key]!=='boolean')throw Error('Status tampilan frame harus berupa boolean.');
    const state={active:'a',shape:frame.shapeCode,shapeRevision:frame.shapeReference?.geometryRevision||null,
      width:frame.a,height:frame.b,dbl:frame.dbl,allowanceDiameter:frame.allowanceDiameter??2,
      sph:rx.sph,cyl:rx.cyl,axis:rx.axis,add:rx.add,pdR:rx.monocularPd?.R,pdL:rx.monocularPd?.L,
      heightR:rx.fittingHeight?.R,heightL:rx.fittingHeight?.L,sync:payload.preview?.cameraSynchronized!==false,
      showFrame:payload.preview?.frameDisplay?.visible!==false,
      showTemples:payload.preview?.frameDisplay?.templesEnabled??payload.preview?.frameDisplay?.templesVisible??true,
      frameStyle:payload.preview?.frameDisplay?.style||'full-rim'};
    for(const [key,min,max] of [['width',35,70],['height',25,60],['dbl',10,28],['allowanceDiameter',0,10],['sph',-20,12],['cyl',-7,0],['axis',0,180],['add',0,4],['pdR',20,45],['pdL',20,45],['heightR',0,60],['heightL',0,60]]) {
      if(typeof state[key]!=='number'||!Number.isFinite(state[key])||state[key]<min||state[key]>max) throw Error('Nilai '+key+' pada berkas tidak valid.');
    }
    if(!['full-rim','half-rimless','rimless'].includes(state.frameStyle)||typeof state.showTemples!=='boolean')throw Error('Pengaturan frame pada berkas tidak valid.');
    for(const key of ['a','b']) {
      const choice=payload.choices.find(c=>object(c)&&c.choice===key.toUpperCase());
      if(!choice||!['1.50','1.56','1.57','1.60','1.67','1.74'].includes(choice.index))throw Error('Berkas harus memuat pilihan A dan B dengan indeks yang tersedia.');
      for(const field of ['tint','product','sku','blankSelection'])if(choice[field]!==undefined&&choice[field]!==null&&!object(choice[field]))throw Error('Format '+field+' pada berkas tidak valid.');
      for(const id of [choice.sku?.id,choice.blankSelection?.eyes?.R?.id,choice.blankSelection?.eyes?.L?.id])if(id!==undefined&&id!==null&&!safeId(id))throw Error('ID SKU atau blank pada berkas tidak valid.');
      if(choice.camera!==undefined&&choice.camera!==null&&(!object(choice.camera)||!['yaw','pitch','zoom'].every(k=>typeof choice.camera[k]==='number'&&Number.isFinite(choice.camera[k]))||choice.camera.zoom<.55||choice.camera.zoom>2.6||Math.abs(choice.camera.yaw)>20||Math.abs(choice.camera.pitch)>20))throw Error('Kamera pada berkas tidak valid.');
      const tintCode=choice.tint?.code??null;
      if(tintCode!==null&&!catalogs.tints.items.some(t=>t.code===tintCode))throw Error('Kode tint pada berkas tidak tersedia.');
      const p=catalogs.materials.products.find(p=>p.supplier===choice.product?.supplier&&p.code===choice.product?.lensCode&&p.index===choice.index);
      if(!p&&!choice.sku?.id)throw Error('Produk bahan baku pada pilihan '+key.toUpperCase()+' tidak ditemukan pada katalog saat ini. Impor belum diterapkan.');
      state[key]={index:choice.index,productId:p?.id||'',skuId:choice.sku?.id||null,
        blankIdR:choice.blankSelection?.eyes?.R?.id||null,blankIdL:choice.blankSelection?.eyes?.L?.id||null,
        tintCode,note:typeof choice.note==='string'?choice.note.slice(0,800):'',
        customColor:choice.tint?.previewColorSource==='user-selected-consultation-color'?choice.tint.previewColor:'#9b7965',camera:choice.camera};
    }
    state.camera=state.a.camera;
    return state;
  }
  const api={validSavedEntry,historyTintLabels,consultationToState};
  global.LeinzConsultations=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
