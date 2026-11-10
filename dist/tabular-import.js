/* Local CSV / Excel imports. Range rows are kept intact: SPH AND CYL AND ADD. */
(function (global) {
  'use strict';
  const LIMITS = Object.freeze({bytes:8*1024*1024,rows:20000,columns:32,sheets:12,cellLength:32768,zipBytes:64*1024*1024});
  const HEADERS = Object.freeze({
    materials:['supplier','LensCode','Descr','base_curve','diameter','center_thickness','edge_thickness','sph_from','sph_to','cyl_from','cyl_to','add_from','add_to'],
    shapes:['code','name','active','width_mm','height_mm','contour','points_json'],
    tints:['code','name','kind','group','nominal_percent','preview_hex','preview_mid_hex','preview_bottom_hex','reference_note','requires_physical_sample','active','override_reference','manual_reference'],
    skus:['sku_code','sku_name','sku_active','index','index_enabled','sph_min','sph_max','cyl_min','cyl_max','add_min','add_max','supplier','LensCode','base_curve','diameter']
  });
  const TEMPLATE_NAMES = {materials:'blank',shapes:'frame-shape',tints:'tinting',skus:'sku'};
  const LABELS = {materials:'Blank / raw material',shapes:'Frame shape',tints:'Tinting',skus:'SKU produk finish'};
  const POWER = ['sphFrom','sphTo','cylFrom','cylTo','addFrom','addTo'];
  const INDICES = ['1.50','1.56','1.57','1.59','1.60','1.61','1.67','1.74'];
  const clone = value => JSON.parse(JSON.stringify(value));
  const stable = value => JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
  const blank = value => value===null||value===undefined||(typeof value==='string'&&!value.trim());
  const norm = value => String(value??'').trim().toLowerCase().replace(/[\s_-]+/g,'');
  const escape = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const model = () => global.LeinzCatalogModel || (typeof require==='function'?require('./catalog-model.js'):null);
  const xlsx = () => global.XLSX || (typeof require==='function'?require('./vendor/xlsx.full.min.js'):null);
  const skuModel = () => global.SkuManager?.helpers || (typeof require==='function'?require('./sku-manager.js'):null);
  function issueText(i) { return (i.sheet?i.sheet+' · ':'')+(i.row?'baris '+i.row+' · ':'')+(i.column?i.column+': ':'')+i.message; }
  class ImportError extends Error {
    constructor(issues) {
      const rows=Array.isArray(issues)?issues:[{message:String(issues)}];
      super(rows.length?issueText(rows[0]):'Berkas impor belum valid.');
      this.name='ImportError';this.issues=rows;this.validationErrors=rows.map(issueText);
    }
  }
  const fail = (message,where={},column='') => { throw new ImportError([{sheet:where.sheet||where.name||'',row:where.row||0,column,message}]); };
  function collector() {
    const issues=[];
    return {issues,run(fn){try{return fn();}catch(e){issues.push(...(e.issues||[{message:e.message||'Data tidak valid.'}]));return null;}},finish(){if(issues.length)throw new ImportError(issues.slice(0,100));}};
  }
  function hash(text) {
    let a=2166136261,b=2246822507;
    for(let i=0;i<text.length;i++){a=Math.imul(a^text.charCodeAt(i),16777619);b=Math.imul(b^text.charCodeAt(i),3266489909);}
    return (a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');
  }
  function newId(candidate,prefix,key,existing,identity) {
    const id=model().validId(candidate)?candidate:prefix+':'+hash(key);
    const previous=existing.get(id);
    if(previous&&!identity(previous))fail('Identitas hasil impor bertabrakan dengan master yang sudah ada. Ubah identitas sumber: '+candidate+'.');
    return id;
  }
  function stringCell(row,key,max=200,{optional=false}={}) {
    const value=row.values[key];
    if(blank(value)){if(optional)return '';fail('Wajib diisi.',row,key);}
    if(typeof value!=='string')fail('Gunakan teks; untuk kode dengan nol di awal, format sel Excel sebagai Text.',row,key);
    const s=value.trim();
    if(s.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s))fail('Teks maksimal '+max+' karakter dan tidak boleh memuat karakter kontrol.',row,key);
    if(s.startsWith('='))fail('Gunakan nilai tetap, bukan formula.',row,key);
    return s;
  }
  function numberCell(row,key,min,max,{optional=false}={}) {
    let value=row.values[key];
    if(blank(value)){if(optional)return null;fail('Wajib berupa angka; sel kosong tidak berarti nol.',row,key);}
    if(typeof value==='string'){
      value=value.trim();
      if(!/^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)(?:[eE][+-]?\d+)?$/.test(value))fail('Angka tidak valid. Gunakan titik/koma desimal tanpa pemisah ribuan.',row,key);
      value=Number(value.replace(',','.'));
    }
    if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)fail('Harus berupa angka '+min+' sampai '+max+'.',row,key);
    return Object.is(value,-0)?0:value;
  }
  function boolCell(row,key) {
    const value=row.values[key];
    if(value===true||value===1)return true;
    if(value===false||value===0)return false;
    if(typeof value==='string'){
      if(['true','1','yes','ya'].includes(value.trim().toLowerCase()))return true;
      if(['false','0','no','tidak'].includes(value.trim().toLowerCase()))return false;
    }
    fail('Isi TRUE/FALSE atau 1/0.',row,key);
  }
  function indexCell(row,key='index',{optional=false}={}) {
    if(blank(row.values[key])&&optional)return null;
    const n=numberCell(row,key,1.3,2),s=n.toFixed(2);
    if(Math.abs(n-Number(s))>1e-8||!INDICES.includes(s))fail('Indeks yang tersedia: '+INDICES.join(', ')+'.',row,key);
    return s;
  }
  function hexCell(row,key) {
    const s=stringCell(row,key,7,{optional:true});
    if(s&&!/^#[0-9a-f]{6}$/i.test(s))fail('Isi #RRGGBB atau biarkan kosong.',row,key);
    return s?s.toUpperCase():null;
  }
  function powerRow(row,suffixes=['from','to'],optional=false) {
    const values={};
    for(const [prefix,min,max]of [['sph',-40,40],['cyl',-20,0],['add',0,10]]){
      const from=numberCell(row,prefix+'_'+suffixes[0],min,max,{optional}),to=numberCell(row,prefix+'_'+suffixes[1],min,max,{optional});
      if((from===null)!==(to===null))fail('Kedua batas harus terisi atau keduanya kosong untuk indeks nonaktif.',row,prefix.toUpperCase());
      if(from!==null&&from>to)fail('Batas minimum melebihi maksimum; rentang tidak dibalik otomatis.',row,prefix.toUpperCase());
      values[prefix+(suffixes[0]==='from'?'From':'Min')]=from;values[prefix+(suffixes[1]==='to'?'To':'Max')]=to;
    }
    return values;
  }
  function parseCSV(text,{filename='data.csv'}={}) {
    if(typeof text!=='string')fail('CSV harus berupa teks UTF-8.');
    if(text.length>LIMITS.bytes)fail('Berkas impor maksimal 8 MiB.');
    text=text.replace(/^\uFEFF/,'');
    if(text.includes('\u0000'))fail('Encoding CSV tidak dikenali. Simpan ulang sebagai CSV UTF-8.');
    let forced='',startLine=1;
    const sep=/^sep=([;,\t])\r?\n/i.exec(text);
    if(sep){forced=sep[1];text=text.slice(sep[0].length);startLine++;}
    const counts={',':0,';':0,'\t':0},detectionText=text.replace(/^(?:[ \t]*(?:\r\n|\r|\n))+/,'');let quoted=false;
    for(let i=0;i<detectionText.length;i++){
      const c=detectionText[i];if(c==='"'){if(quoted&&detectionText[i+1]==='"')i++;else quoted=!quoted;}
      else if(!quoted&&(c==='\r'||c==='\n'))break;
      else if(!quoted&&Object.hasOwn(counts,c))counts[c]++;
    }
    const delimiter=forced||Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0];
    const records=[];let fields=[],field='',inQuotes=false,closed=false,line=startLine,rowLine=startLine,atStart=true;
    const endField=()=>{fields.push(field);if(fields.length>LIMITS.columns)fail('Maksimal '+LIMITS.columns+' kolom.',{sheet:'CSV',row:rowLine});field='';closed=false;atStart=true;};
    const endRow=()=>{endField();if(fields.some(v=>String(v).trim()))records.push({row:rowLine,cells:fields});fields=[];if(records.length>LIMITS.rows+1)fail('Maksimal '+LIMITS.rows.toLocaleString('id-ID')+' baris data.',{sheet:'CSV',row:rowLine});};
    for(let i=0;i<text.length;i++){
      const c=text[i];
      if(inQuotes){
        if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else{inQuotes=false;closed=true;}}
        else{field+=c;if(c==='\n')line++;else if(c==='\r'&&text[i+1]!=='\n')line++;}
      }else if(c===delimiter){endField();}
      else if(c==='\n'||c==='\r'){
        endRow();if(c==='\r'&&text[i+1]==='\n')i++;line++;rowLine=line;
      }else if(closed){if(c!==' '&&c!=='\t')fail('Karakter setelah penutup tanda kutip tidak valid.',{sheet:'CSV',row:line});}
      else if(c==='"'){if(!atStart)fail('Tanda kutip harus dimulai pada awal kolom CSV.',{sheet:'CSV',row:line});inQuotes=true;atStart=false;}
      else{field+=c;atStart=false;}
      if(field.length>LIMITS.cellLength)fail('Isi sel terlalu panjang (maksimal '+LIMITS.cellLength+' karakter).',{sheet:'CSV',row:line});
    }
    if(inQuotes)fail('Tanda kutip CSV belum ditutup.',{sheet:'CSV',row:rowLine});
    if(field||fields.length||closed)endRow();
    if(!records.length)fail('CSV tidak memiliki header dan data.');
    return {filename,format:'CSV',delimiter,sheets:[{name:'CSV',records}]};
  }
  function checkZip(bytes) {
    if(bytes.length<22||bytes[0]!==0x50||bytes[1]!==0x4b)fail('Berkas .xlsx bukan workbook Excel yang valid. Simpan sebagai Excel Workbook (.xlsx).');
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let eocd=-1;
    for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--)if(view.getUint32(p,true)===0x06054b50){eocd=p;break;}
    if(eocd<0)fail('Struktur workbook Excel rusak atau terpotong.');
    const count=view.getUint16(eocd+10,true),size=view.getUint32(eocd+12,true),offset=view.getUint32(eocd+16,true);
    if(view.getUint16(eocd+4,true)||view.getUint16(eocd+6,true)||count===65535||offset===4294967295||size===4294967295||count>512||offset+size>eocd)fail('Workbook terlalu besar atau menggunakan format ZIP yang tidak didukung.');
    let total=0,p=offset;
    for(let i=0;i<count;i++){
      if(p+46>bytes.length||view.getUint32(p,true)!==0x02014b50)fail('Struktur workbook Excel tidak valid.');
      total+=view.getUint32(p+24,true);
      if(total>LIMITS.zipBytes)fail('Isi workbook setelah dibuka melebihi 64 MiB. Gunakan workbook data yang lebih kecil.');
      if(view.getUint16(p+8,true)&1)fail('Workbook terenkripsi belum didukung. Simpan salinan tanpa password.');
      p+=46+view.getUint16(p+28,true)+view.getUint16(p+30,true)+view.getUint16(p+32,true);
      if(p>offset+size)fail('Struktur workbook Excel tidak valid.');
    }
  }
  function parseExcel(buffer,{filename='data.xlsx'}={}) {
    const bytes=buffer instanceof Uint8Array?buffer:new Uint8Array(buffer);
    if(bytes.byteLength>LIMITS.bytes)fail('Berkas impor maksimal 8 MiB.');
    checkZip(bytes);
    const lib=xlsx();if(!lib?.read)fail('Pembaca Excel belum dimuat. Muat ulang aplikasi.');
    let wb;
    try{wb=lib.read(bytes,{type:'array',dense:true,cellFormula:true,cellDates:true,cellHTML:false,cellNF:false,cellText:false,sheetRows:LIMITS.rows+2,bookVBA:false});}
    catch(e){throw new ImportError([{message:'Excel tidak dapat dibaca. Pastikan berkas .xlsx tidak rusak atau dilindungi password.'}]);}
    if(wb.SheetNames.length>LIMITS.sheets)fail('Maksimal '+LIMITS.sheets+' sheet per workbook.');
    const sheets=[],issues=collector();
    for(const name of wb.SheetNames){
      if(/^(petunjuk|readme|instructions|panduan)$/i.test(name.trim()))continue;
      const ws=wb.Sheets[name];if(!ws?.['!ref'])continue;
      issues.run(()=>{
        const range=lib.utils.decode_range(ws['!fullref']||ws['!ref']);
        if(range.e.r>=LIMITS.rows+1||range.e.c>=LIMITS.columns)fail('Maksimal '+LIMITS.rows.toLocaleString('id-ID')+' baris data dan '+LIMITS.columns+' kolom per sheet.',{sheet:name});
        if(ws['!merges']?.length)fail('Sel gabungan tidak didukung pada sheet data. Pisahkan sel dan ulangi nilainya di setiap baris.',{sheet:name});
        const records=[];
        for(let r=range.s.r;r<=range.e.r;r++){
          const cells=[];let populated=false;
          for(let c=0;c<=range.e.c;c++){
            const cell=ws['!data']?.[r]?.[c]??ws[lib.utils.encode_cell({r,c})];
            if(cell?.f||cell?.F)fail('Formula Excel tidak diimpor. Salin lalu Paste Values pada sheet data.',{sheet:name,row:r+1},lib.utils.encode_col(c));
            if(cell?.t==='e'||cell?.t==='d')fail('Sel error/tanggal tidak dapat dipakai pada data master.',{sheet:name,row:r+1},lib.utils.encode_col(c));
            const value=cell?.v??'';
            if(typeof value==='string'&&value.length>LIMITS.cellLength)fail('Isi sel terlalu panjang.',{sheet:name,row:r+1},lib.utils.encode_col(c));
            if(!blank(value))populated=true;
            cells.push(value);
          }
          if(populated)records.push({row:r+1,cells});
        }
        if(records.length)sheets.push({name,records});
      });
    }
    issues.finish();
    if(!sheets.length)fail('Workbook tidak memiliki sheet data. Sheet Petunjuk/README diabaikan.');
    return {filename,format:'Excel',sheets};
  }
  async function readFile(file) {
    if(!file||typeof file.arrayBuffer!=='function')fail('Pilih berkas CSV atau Excel.');
    if(file.size>LIMITS.bytes)fail('Berkas impor maksimal 8 MiB.');
    const filename=String(file.name||''),extension=filename.split('.').pop().toLowerCase();
    if(!['csv','xlsx'].includes(extension))fail('Gunakan .csv atau Excel .xlsx. Untuk Excel lama, Save As ke .xlsx terlebih dahulu.');
    const bytes=new Uint8Array(await file.arrayBuffer());
    if(bytes.byteLength>LIMITS.bytes)fail('Berkas impor maksimal 8 MiB.');
    if(extension==='xlsx')return parseExcel(bytes,{filename});
    let text;
    try{
      const encoding=bytes[0]===255&&bytes[1]===254?'utf-16le':bytes[0]===254&&bytes[1]===255?'utf-16be':'utf-8';
      text=new TextDecoder(encoding,{fatal:true}).decode(bytes);
    }catch{fail('Encoding CSV tidak dikenali. Simpan ulang sebagai CSV UTF-8.');}
    return parseCSV(text,{filename});
  }
  function rowsFor(parsed,kind) {
    const required=HEADERS[kind];if(!required)fail('Jenis master impor tidak dikenal.');
    const allowed=required.concat(kind==='materials'?['index']:[]),lookup=new Map(allowed.map(h=>[norm(h),h]));
    const issues=collector(),rows=[];
    for(const sheet of parsed.sheets||[]){
      const data=issues.run(()=>{
        const first=sheet.records?.[0];if(!first)return [];
        const headers=first.cells.map(h=>blank(h)?'':lookup.get(norm(h))||null),seen=new Set();
        for(let c=0;c<headers.length;c++){
          const h=headers[c];
          if(h===null)fail('Kolom tidak dikenal: '+String(first.cells[c])+'. Gunakan template '+LABELS[kind]+'.',{sheet:sheet.name,row:first.row});
          if(h&&seen.has(h))fail('Header berulang: '+h+'.',{sheet:sheet.name,row:first.row});
          if(h)seen.add(h);
        }
        const missing=required.filter(h=>!seen.has(h));
        if(missing.length)fail('Kolom wajib belum tersedia: '+missing.join(', ')+'.',{sheet:sheet.name,row:first.row});
        return sheet.records.slice(1).map(record=>{
          const row={sheet:sheet.name,row:record.row,values:{}};
          record.cells.forEach((v,c)=>{
            if(!headers[c]&&!blank(v))fail('Data berada di kolom tanpa header.',row,'kolom '+(c+1));
            if(headers[c])row.values[headers[c]]=v;
          });
          for(const h of headers)if(h&&!Object.hasOwn(row.values,h))row.values[h]='';
          return row;
        });
      });
      if(data)rows.push(...data);
    }
    issues.finish();
    if(!rows.length)fail('Berkas hanya memiliki header; tambahkan setidaknya satu baris data.');
    if(rows.length>LIMITS.rows)fail('Total data dari semua sheet maksimal '+LIMITS.rows.toLocaleString('id-ID')+' baris.');
    return rows;
  }
  const productKey = (supplier,code) => JSON.stringify([supplier,code]);
  const blankKey = (productId,baseCurve,diameter) => JSON.stringify([productId,baseCurve,diameter]);
  const ruleKey = r => JSON.stringify([r.blankId,...POWER.map(k=>r[k])]);
  function updatedRecord(old,values,now) {
    if(!old)return {...values,source:'tabular-import',managedAt:now};
    const changed=Object.entries(values).some(([key,value])=>key==='active'?(old.active!==false)!==value:stable(old[key]??null)!==stable(value??null));
    if(!changed)return clone(old);
    const original=clone(old);delete original.originalSource;delete original.managedAt;
    return {...clone(old),...values,originalSource:old.originalSource||original,managedAt:now};
  }
  function importMaterials(current,rows,parsed,now) {
    const out=clone(current),m=out.materials,issues=collector();
    const ids=new Map(m.products.map(p=>[p.id,p])),products=new Map();
    for(const p of m.products){const key=productKey(p.supplier,p.code);if(!products.has(key))products.set(key,[]);products.get(key).push(p);}
    const blankIds=new Map(m.blanks.map(b=>[b.id,b])),blanks=new Map();
    for(const b of m.blanks){const key=blankKey(b.productId,b.baseCurve,b.diameter);if(!blanks.has(key))blanks.set(key,[]);blanks.get(key).push(b);}
    const seenProducts=new Map(),seenBlanks=new Map(),rules=new Map();let duplicates=0;
    for(const row of rows)issues.run(()=>{
      const supplier=stringCell(row,'supplier',80),code=stringCell(row,'LensCode',80),name=stringCell(row,'Descr',200);
      const key=productKey(supplier,code),known=products.get(key)||[];
      if(known.length>1)fail('Supplier dan LensCode mengarah ke beberapa produk. Perbaiki identitas master terlebih dahulu.',row,'LensCode');
      const old=known[0],explicit=indexCell(row,'index',{optional:true});
      const describedNumbers=[...new Set((name.match(/(?<![0-9])1[.,][0-9]+(?![0-9])/g)||[]).map(n=>Number(n.replace(',','.'))))];
      const described=describedNumbers.map(n=>n.toFixed(2));
      if(describedNumbers.some((n,i)=>Math.abs(n-Number(described[i]))>1e-8||!INDICES.includes(described[i])))fail('Indeks pada Descr tidak termasuk indeks katalog yang didukung; nilai tidak dibulatkan otomatis.',row,'Descr');
      const index=explicit||old?.index||(described.length===1?described[0]:null);
      if(!index||!INDICES.includes(index))fail('Indeks produk baru tidak jelas. Tambahkan kolom index atau satu indeks yang valid pada Descr.',row,'Descr');
      if(old&&old.index!==index)fail('Indeks berbeda dari produk yang sudah ada. Gunakan LensCode baru atau perbaiki berkas.',row,'index');
      if(described.length>1||described.length===1&&described[0]!==index)fail('Indeks pada Descr bertentangan atau ambigu terhadap index/produk yang dikenal.',row,'Descr');
      const p=old?updatedRecord(old,{name},now):{id:newId(supplier+':'+code,'material',key,ids,p=>p.supplier===supplier&&p.code===code),supplier,code,name,index,activeForSimulator:!['1.59','1.61'].includes(index),active:true,source:'tabular-import',managedAt:now};
      const priorProduct=seenProducts.get(key);
      if(priorProduct&&(priorProduct.product.name!==name||priorProduct.product.index!==index))fail('Deskripsi/indeks tidak konsisten dengan baris '+priorProduct.row.row+' untuk supplier + LensCode yang sama.',row,'Descr');
      const baseCurve=numberCell(row,'base_curve',0,30),diameter=numberCell(row,'diameter',20,150),ct=numberCell(row,'center_thickness',.1,50),et=numberCell(row,'edge_thickness',.1,50);
      const bkey=blankKey(p.id,baseCurve,diameter),existing=blanks.get(bkey)||[];
      if(existing.length>1)fail('BC dan diameter mengarah ke beberapa blank. Perbaiki duplikasi master sebelum impor.',row,'base_curve');
      const priorBlank=seenBlanks.get(bkey),oldBlank=existing[0];
      if(priorBlank&&(priorBlank.blank.ct!==ct||priorBlank.blank.et!==et))fail('CT/ET bertentangan dengan baris '+priorBlank.row.row+' untuk blank yang sama.',row,'center_thickness');
      if(oldBlank&&(oldBlank.ct!==ct||oldBlank.et!==et))fail('CT/ET berbeda dari master blank BC '+baseCurve+' / Ø '+diameter+'. Periksa sumber atau ubah spesifikasi melalui editor blank sebelum impor.',row,'center_thickness');
      const numberId=n=>Number(n.toFixed(2))===n?n.toFixed(2):String(n);
      const b=oldBlank||{id:newId(p.id+':BC'+numberId(baseCurve)+':D'+numberId(diameter),'blank',bkey,blankIds,b=>b.productId===p.id&&b.baseCurve===baseCurve&&b.diameter===diameter),productId:p.id,baseCurve,diameter,ct,et,active:true,source:'tabular-import',managedAt:now};
      const power=powerRow(row),r={blankId:b.id,...power},rkey=ruleKey(r);
      const priorRule=rules.get(rkey);
      if(priorRule){duplicates++;priorRule.locations.push({sheet:row.sheet,row:row.row});}
      else rules.set(rkey,{rule:r,locations:[{sheet:row.sheet,row:row.row}]});
      seenProducts.set(key,{product:p,row});seenBlanks.set(bkey,{blank:b,row});ids.set(p.id,p);blankIds.set(b.id,b);
    });
    issues.finish();
    const replacements=new Map([...seenProducts.values()].map(v=>[v.product.id,v.product]));
    m.products=m.products.map(p=>replacements.get(p.id)||p).concat([...replacements.values()].filter(p=>!current.materials.products.some(old=>old.id===p.id)));
    const touched=new Set([...seenBlanks.values()].map(v=>v.blank.id));
    for(const {blank:b}of seenBlanks.values())if(!m.blanks.some(old=>old.id===b.id))m.blanks.push(b);
    const oldRuleByKey=new Map();for(const r of current.materials.rules)if(!oldRuleByKey.has(ruleKey(r)))oldRuleByKey.set(ruleKey(r),r);
    const ruleIds=new Map(current.materials.rules.map(r=>[r.id,r])),incoming=[];
    for(const [key,v]of rules){
      const old=oldRuleByKey.get(key);
      if(old)incoming.push(clone(old));
      else incoming.push({...v.rule,id:newId('rule:import-'+hash(key),'rule',key,ruleIds,r=>ruleKey(r)===key),source:'tabular-import',sourceFile:parsed.filename,sourceRows:v.locations.map(l=>l.row),sourceLocations:v.locations,exactDuplicateCount:v.locations.length-1,hasExactDuplicates:v.locations.length>1,managedAt:now});
    }
    const incomingIds=new Set(incoming.map(r=>r.id)),byId=new Map(incoming.map(r=>[r.id,r]));
    m.rules=m.rules.flatMap(r=>!touched.has(r.blankId)?[r]:incomingIds.has(r.id)?[byId.get(r.id)]:[]).concat(incoming.filter(r=>!ruleIds.has(r.id)));
    const removedRules=current.materials.rules.filter(r=>touched.has(r.blankId)&&!incomingIds.has(r.id)).length;
    return {value:out,info:{uniqueRecords:rules.size,duplicateRows:duplicates,touchedProducts:seenProducts.size,touchedBlanks:touched.size,removedRules,addedRules:incoming.filter(r=>!ruleIds.has(r.id)).length,unchangedRules:incoming.filter(r=>ruleIds.has(r.id)).length}};
  }
  function contourPoints(kind,count=128) {
    if(kind==='ellipse')return Array.from({length:count},(_,i)=>{const a=i*Math.PI*2/count;return [Number((.5*Math.cos(a)).toFixed(8)),Number((.5*Math.sin(a)).toFixed(8))];});
    const result=[],radius=.15,centers=[[.35,.35],[-.35,.35],[-.35,-.35],[.35,-.35]];
    for(let corner=0;corner<4;corner++)for(let i=0;i<count/4;i++){
      const a=corner*Math.PI/2+i/(count/4-1)*Math.PI/2;
      result.push([Number((centers[corner][0]+radius*Math.cos(a)).toFixed(8)),Number((centers[corner][1]+radius*Math.sin(a)).toFixed(8))]);
    }
    return result;
  }
  function importShapes(current,rows,now) {
    const out=clone(current),map=new Map(current.shapes.items.map(s=>[s.code,s])),seen=new Map(),issues=collector();let duplicates=0;
    for(const row of rows)issues.run(()=>{
      const code=stringCell(row,'code',128);if(!model().validId(code))fail('Kode hanya boleh berisi huruf, angka, titik, titik dua, _ atau -.',row,'code');
      const old=map.get(code),name=stringCell(row,'name',140),active=boolCell(row,'active'),width=numberCell(row,'width_mm',35,70),height=numberCell(row,'height_mm',25,60),contour=stringCell(row,'contour',32).toLowerCase();
      if(!['keep','ellipse','rounded-rectangle','points'].includes(contour))fail('Isi keep, ellipse, rounded-rectangle, atau points.',row,'contour');
      if(contour==='keep'&&!old)fail('keep hanya berlaku untuk kode shape yang sudah ada.',row,'contour');
      let points=old?.points;
      if(contour==='points'){
        try{points=JSON.parse(stringCell(row,'points_json',LIMITS.cellLength));}catch(e){if(e instanceof ImportError)throw e;fail('Gunakan JSON pasangan titik, misalnya [[-0.5,0],[0,-0.5],[0.5,0],[0,0.5]].',row,'points_json');}
      }else if(!blank(row.values.points_json))fail('points_json hanya diisi bila contour=points.',row,'points_json');
      else if(contour!=='keep')points=contourPoints(contour);
      const problem=model().contourProblem(points);if(problem)fail(problem,row,'points_json');
      const values={code,name,active,defaultWidthMm:width,defaultHeightMm:height};
      if(!old||old.defaultWidthMm!==width||old.defaultHeightMm!==height)values.referenceAspectRatio=width/height;
      if(!old||stable(points)!==stable(old.points))Object.assign(values,{points,source:'tabular-import',contourMode:'vector',status:'illustrative',category:'additional',synthetic:contour!=='points',geometryRevision:'import-'+hash(stable(points))});
      const record=updatedRecord(old,values,now);
      if(seen.has(code)){
        if(stable(seen.get(code).record)!==stable(record))fail('Kode shape berulang dengan data berbeda dari baris '+seen.get(code).row.row+'.',row,'code');
        duplicates++;
      }else seen.set(code,{record,row});
    });
    issues.finish();
    out.shapes.items=out.shapes.items.map(s=>seen.get(s.code)?.record||s).concat([...seen.values()].map(v=>v.record).filter(s=>!map.has(s.code)));
    return {value:out,info:{uniqueRecords:seen.size,duplicateRows:duplicates}};
  }
  function importTints(current,rows,now) {
    const out=clone(current),map=new Map(current.tints.items.map(t=>[t.code,t])),seen=new Map(),issues=collector();let duplicates=0;
    for(const row of rows)issues.run(()=>{
      const code=stringCell(row,'code',128);if(!model().validId(code))fail('Kode tint hanya boleh berisi huruf, angka, titik, titik dua, _ atau -.',row,'code');
      const old=map.get(code),name=stringCell(row,'name',160),kind=stringCell(row,'kind',16),group=stringCell(row,'group',24);
      if(!['Solid','Gradient'].includes(kind))fail('Gunakan Solid atau Gradient.',row,'kind');
      if(!['fashion','sunglass','therapeutic','special'].includes(group))fail('Gunakan fashion, sunglass, therapeutic, atau special.',row,'group');
      const values={code,name,kind,group,nominalPercent:numberCell(row,'nominal_percent',0,100,{optional:true}),previewHex:hexCell(row,'preview_hex'),previewMidHex:hexCell(row,'preview_mid_hex'),previewBottomHex:hexCell(row,'preview_bottom_hex'),referenceNote:stringCell(row,'reference_note',2000,{optional:true}),requiresPhysicalSample:boolCell(row,'requires_physical_sample'),active:boolCell(row,'active')};
      const override=boolCell(row,'override_reference'),manual=stringCell(row,'manual_reference',500,{optional:true});
      if(!values.previewHex&&(values.previewMidHex||values.previewBottomHex))fail('Warna tengah/bawah memerlukan preview_hex.',row,'preview_hex');
      if(kind==='Gradient'&&values.previewHex&&!values.previewBottomHex)fail('Tint Gradient dengan preview memerlukan warna bawah.',row,'preview_bottom_hex');
      if(kind==='Solid'&&[values.previewMidHex,values.previewBottomHex].some(h=>h&&h!==values.previewHex))fail('Warna Solid harus sama pada seluruh lensa.',row,'preview_bottom_hex');
      const colorChanged=!old||kind!==old.kind||['previewHex','previewMidHex','previewBottomHex'].some(k=>(old[k]?old[k].toUpperCase():null)!==values[k]);
      if(old?.referenceStatus==='percent-conflict'&&colorChanged&&!override)fail('Tint memiliki konflik acuan. Isi override_reference=TRUE beserta manual_reference yang jelas.',row,'override_reference');
      if(override&&!manual)fail('Acuan manual wajib diisi saat mengganti referensi.',row,'manual_reference');
      if(!old||colorChanged||override)Object.assign(values,{referenceStatus:'manual',mappingMethod:'managed-digital-reference',manualReference:manual,previewCalibrated:false});
      else if(manual&&manual!==old.manualReference)values.manualReference=manual;
      if(!old)values.family=/^\d{2}[SG]$/.test(code)?code.slice(0,2):code;
      const record=updatedRecord(old,values,now);
      if(seen.has(code)){
        if(stable(seen.get(code).record)!==stable(record))fail('Kode tint berulang dengan data berbeda dari baris '+seen.get(code).row.row+'.',row,'code');
        duplicates++;
      }else seen.set(code,{record,row});
    });
    issues.finish();
    out.tints.items=out.tints.items.map(t=>seen.get(t.code)?.record||t).concat([...seen.values()].map(v=>v.record).filter(t=>!map.has(t.code)));
    return {value:out,info:{uniqueRecords:seen.size,duplicateRows:duplicates}};
  }
  function buildMasterImport(current,parsed,{kind='materials',skuCatalog={skus:[]},now=new Date().toISOString()}={}) {
    const rows=rowsFor(parsed,kind),result=kind==='materials'?importMaterials(current,rows,parsed,now):kind==='shapes'?importShapes(current,rows,now):kind==='tints'?importTints(current,rows,now):null;
    if(!result)fail('Pilih jenis master yang sesuai.');
    const checked=model().validateCatalogBundle(result.value,{previous:current,skuCatalog:Array.isArray(skuCatalog)?{skus:skuCatalog}:skuCatalog});
    if(!checked.ok)throw new ImportError(checked.errors.map(message=>({message})));
    return {payload:{schema:'trl-master-catalogs/1.0',catalogs:checked.value},info:{kind,filename:parsed.filename,format:parsed.format,rowCount:rows.length,sheetNames:parsed.sheets.map(s=>s.name),previewRows:rows.slice(0,8),...result.info}};
  }
  function buildSkuImport(existing,materials,parsed,{now=new Date().toISOString()}={}) {
    const rows=rowsFor(parsed,'skus'),issues=collector(),seen=new Map(),productLookup=new Map(),blankLookup=new Map(),skuIds=new Set(existing.map(s=>s.id));let duplicates=0;
    const freshSkuId=key=>{
      let attempt=0,id='sku:import-'+hash(key);
      while(skuIds.has(id)){attempt++;if(attempt>1001)fail('Tidak dapat membuat identitas SKU unik. Periksa master SKU.');id='sku:import-'+hash(JSON.stringify([key,attempt]));}
      skuIds.add(id);return id;
    };
    for(const p of materials.products){const key=productKey(p.supplier,p.code);if(!productLookup.has(key))productLookup.set(key,[]);productLookup.get(key).push(p);}
    for(const b of materials.blanks){const key=blankKey(b.productId,b.baseCurve,b.diameter);if(!blankLookup.has(key))blankLookup.set(key,[]);blankLookup.get(key).push(b);}
    for(const row of rows)issues.run(()=>{
      const code=stringCell(row,'sku_code',64),key=code.toLocaleUpperCase('en-US'),name=stringCell(row,'sku_name',140),active=boolCell(row,'sku_active'),index=indexCell(row),enabled=boolCell(row,'index_enabled');
      if(index==='1.59')fail('Indeks 1.59 hanya berada pada katalog bahan dan tidak dapat dipakai SKU simulator.',row,'index');
      const power=powerRow(row,['min','max'],!enabled),old=existing.find(s=>s.code.toLocaleUpperCase('en-US')===key);
      // Legacy CSV/Excel templates have no SKU diameter-range columns. Retain
      // bounds set in the form when updating that SKU/index through a template.
      const oldPower=old?.variants.find(v=>v.index===index)?.power;
      for(const field of ['diameterMin','diameterMax'])if(oldPower?.[field]!==undefined)power[field]=oldPower[field];
      let item=seen.get(key);
      if(item&&(item.sku.name!==name||item.sku.active!==active||item.sku.code!==code))fail('Kode, nama, atau status SKU bertentangan dengan baris '+item.row.row+'.',row,'sku_code');
      if(!item)item={row,sku:{id:old?.id||freshSkuId(key),code,name,active,variants:[],createdAt:old?.createdAt||now,updatedAt:old?.updatedAt||now},variants:new Map(),old};
      let variant=item.variants.get(index);
      if(variant&&variant.value.enabled!==enabled)fail('Status indeks harus sama pada semua baris SKU dan indeks yang sama (lihat baris '+variant.row.row+').',row,'index');
      if(!variant)variant={row,value:{index,enabled,power,assignments:[]},assignments:new Map(),ranges:[],useRanges:Array.isArray(old?.variants.find(v=>v.index===index)?.powerRanges)};
      if(stable(variant.value.power)!==stable(power))variant.useRanges=true;
      const fields=['supplier','LensCode','base_curve','diameter'],empty=fields.filter(k=>blank(row.values[k]));
      if(empty.length===fields.length){
        if(enabled)fail('Indeks aktif memerlukan supplier, LensCode, base_curve, dan diameter.',row,'supplier');
        if(item.variants.has(index))duplicates++;
      }else{
        if(empty.length)fail('Assignment blank belum lengkap: '+empty.join(', ')+'.',row,'supplier');
        const supplier=stringCell(row,'supplier',80),lensCode=stringCell(row,'LensCode',80),baseCurve=numberCell(row,'base_curve',0,30),diameter=numberCell(row,'diameter',20,150);
        const range={diameter,...Object.fromEntries(['sphMin','sphMax','cylMin','cylMax','addMin','addMax'].map(k=>[k,power[k]]))};
        if(!variant.ranges.some(r=>stable(r)===stable(range)))variant.ranges.push(range);
        const matches=productLookup.get(productKey(supplier,lensCode))||[],p=matches[0];
        if(matches.length!==1)fail(matches.length?'Produk bahan ambigu; perbaiki duplikasi master.':'Supplier dan LensCode tidak ditemukan. Impor bahan terlebih dahulu.',row,'LensCode');
        if(p.index!==index||!p.activeForSimulator)fail('Indeks bahan berbeda dari indeks SKU atau bahan tidak tersedia pada simulator.',row,'index');
        const candidates=blankLookup.get(blankKey(p.id,baseCurve,diameter))||[];
        if(candidates.length!==1)fail(candidates.length?'Blank tidak unik untuk BC/diameter ini. Perbaiki master.':'Blank BC/diameter ini tidak ditemukan pada produk supplier terpilih.',row,'diameter');
        const b=candidates[0];
        let assignment=variant.assignments.get(p.id);
        if(!assignment){const prior=item.old?.variants.find(v=>v.index===index)?.assignments.find(a=>a.productId===p.id);assignment={id:prior?.id||'assignment:import-'+hash(JSON.stringify([item.sku.id,index,p.id])),supplier,productId:p.id,blankIds:[]};}
        if(assignment.blankIds.includes(b.id))duplicates++;else assignment.blankIds.push(b.id);
        variant.assignments.set(p.id,assignment);
      }
      item.variants.set(index,variant);seen.set(key,item);
    });
    issues.finish();
    const skus=[...seen.values()].map(item=>({...item.sku,variants:[...item.variants.values()].map(v=>{
      const value={...v.value,assignments:[...v.assignments.values()].map(a=>({...a,blankIds:a.blankIds.sort()})).sort((a,b)=>a.productId.localeCompare(b.productId))};
      if(v.useRanges){value.powerRanges=v.ranges;delete value.power;}
      return value;
    }).sort((a,b)=>a.index.localeCompare(b.index))}));
    const payload={schema:'trl-sku-catalog/1.0',skus};
    const check=skuModel().validateCatalog(payload,{materials});
    if(!check.ok)throw new ImportError(check.errors.map(message=>({message})));
    return {payload,info:{kind:'skus',filename:parsed.filename,format:parsed.format,rowCount:rows.length,uniqueRecords:skus.length,duplicateRows:duplicates,sheetNames:parsed.sheets.map(s=>s.name),previewRows:rows.slice(0,8)}};
  }
  function templateLinks(kind) {
    const name=TEMPLATE_NAMES[kind];if(!name)return '';
    return '<details class="import-templates"><summary>Template impor ▾</summary><div><a href="templates/'+name+'-template.xlsx" download>Excel (.xlsx)</a><a href="templates/'+name+'-template.csv" download>CSV (.csv)</a></div></details>';
  }
  function reviewMarkup(info) {
    if(!info)return '';
    const label=LABELS[info.kind],headers=HEADERS[info.kind];
    return '<div class="import-info"><p><strong>'+escape(label)+' · '+escape(info.format)+'</strong></p><p>'+info.rowCount.toLocaleString('id-ID')+' baris dibaca · '+info.uniqueRecords.toLocaleString('id-ID')+' '+(info.kind==='materials'?'aturan unik':'record unik')+' · '+info.duplicateRows.toLocaleString('id-ID')+' baris duplikat identik diringkas.</p>'+(info.kind==='materials'?'<p class="import-replace-note"><strong>Ganti cakupan '+info.touchedBlanks+' blank yang tercantum.</strong> Semua aturan untuk setiap blank tersebut mengikuti berkas ini. Sertakan seluruh baris cakupannya; '+info.removedRules+' aturan lama akan dilepas. SPH, CYL, dan ADD harus cocok bersamaan pada satu baris. Nilai 0 berarti nol.</p>':info.kind==='skus'?'<p class="import-replace-note">Setiap SKU yang tercantum memakai seluruh konfigurasi indeks dan assignment dari berkas. Sertakan semua indeks/blank yang tetap diizinkan pada SKU tersebut.</p>':'')+'<details class="import-row-preview"><summary>Lihat '+info.previewRows.length+' baris pertama</summary><div class="import-preview-scroll"><table><thead><tr><th>Sheet / baris</th>'+headers.map(h=>'<th>'+escape(h)+'</th>').join('')+'</tr></thead><tbody>'+info.previewRows.map(r=>'<tr><td>'+escape(r.sheet)+' / '+r.row+'</td>'+headers.map(h=>'<td>'+escape(typeof r.values[h]==='string'&&r.values[h].length>120?r.values[h].slice(0,117)+'…':r.values[h])+'</td>').join('')+'</tr>').join('')+'</tbody></table></div></details></div>';
  }
  function errorMarkup(error) {
    const issues=error.issues||[{message:error.message||'Berkas belum valid.'}];
    return '<p>Impor belum diterapkan. Perbaiki seluruh kesalahan, lalu pilih kembali berkas.</p><div class="import-error-list" role="alert"><ul>'+issues.slice(0,40).map(i=>'<li>'+escape(issueText(i))+'</li>').join('')+'</ul>'+(issues.length>40?'<p>Menampilkan 40 dari '+issues.length+' kesalahan.</p>':'')+'</div>';
  }
  const api={LIMITS,HEADERS,ImportError,parseCSV,parseExcel,readFile,rowsFor,buildMasterImport,buildSkuImport,templateLinks,reviewMarkup,errorMarkup,issueText,stable};
  global.LeinzTabularImport=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
