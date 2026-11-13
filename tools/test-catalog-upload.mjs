import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createApp } from '../server/app.mjs';
import { newToken } from '../server/auth.mjs';
import { AppError } from '../server/errors.mjs';
import { validateMasterCatalogs } from '../server/validation.mjs';
const require = createRequire(import.meta.url);
const { LeinzStorage } = require('../dist/storage-client.js');
const Import = require('../dist/tabular-import.js');
const catalogs = () => Object.fromEntries(['materials','shapes','tints'].map(key=>[key,JSON.parse(readFileSync(new URL('../dist/assets/'+key+'.json',import.meta.url),'utf8'))]));
const listen = server => new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve('http://127.0.0.1:'+server.address().port)));
const close = server => new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});

async function fixture(t) {
  let committed = { value:catalogs(), revision:0 }, writes = 0;
  const token = newToken(), csrfToken = 'b'.repeat(64), user = {id:1,username:'admin',role:'administrator'};
  const config = { origin:'http://127.0.0.1', bodyLimit:8*1024*1024, sessionHours:8 };
  const requests = [];
  const store = {
    getSession:async value=>value===token?{user,csrfToken}:null,
    getCatalogs:async()=>structuredClone(committed),
    bootstrap:async()=>({catalogs:structuredClone(committed.value),catalogRevision:committed.revision,documents:{state:{value:null,revision:0},saved:{value:[],revision:0},skus:{value:{schema:'trl-sku-catalog/1.0',skus:[]},revision:0}}}),
    putCatalogs:async(value,revision)=>{
      if(revision!==committed.revision)throw new AppError(409,'revision_conflict','Master berubah.',{document:structuredClone(committed)});
      const validated=validateMasterCatalogs(value,{previous:committed.value});
      committed={value:validated,revision:revision+1};writes++;return structuredClone(committed);
    }
  };
  const app=createApp({store,config,logger:{error:assert.fail}}),backend=await listen(app);
  // Buffer/reject the upload before forwarding, as a proxy body limit does.
  const proxy=createServer((req,res)=>{
    const chunks=[];let size=0;
    req.on('data',chunk=>{size+=chunk.length;if(size<=1024*1024)chunks.push(chunk);});
    req.on('end',()=>{
      requests.push({path:req.url,bytes:size,encoding:req.headers['content-encoding']});
      if(size>1024*1024){res.writeHead(413,{'Content-Type':'text/html'});res.end('<h1>413 Request Entity Too Large</h1>nginx');return;}
      const upstream=httpRequest(backend+req.url,{method:req.method,headers:{...req.headers,'content-length':size}},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});
      upstream.on('error',()=>{res.writeHead(502);res.end();});upstream.end(Buffer.concat(chunks));
    });
  });
  const origin=await listen(proxy);config.origin=origin;
  t.after(async()=>{await close(proxy);await close(app);});
  const headers={'Origin':origin,'Cookie':'leinz_session='+token,'X-CSRF-Token':csrfToken,'Content-Type':'application/json'};
  const storage=new LeinzStorage({runtime:{mode:'mysql'},fetchImpl:(path,options)=>fetch(origin+path,{...options,headers:{...headers,...options.headers}})});
  await storage.connect();await storage.load();
  return {storage,origin,backend,headers,config,requests,current:()=>structuredClone(committed),writes:()=>writes};
}

test('Excel master import commits through a proxy that rejects requests larger than 1 MiB',async t=>{
  const f=await fixture(t),before=f.current();
  const parsed=Import.parseExcel(readFileSync(new URL('../dist/templates/blank-template.xlsx',import.meta.url)),{filename:'blank-import.xlsx'});
  for(const sheet of parsed.sheets){const at=sheet.records[0]?.cells.indexOf('Descr');if(at>=0)for(const record of sheet.records.slice(1))record.cells[at]+=' - updated import';}
  const value=Import.buildMasterImport(before.value,parsed,{kind:'materials'}).payload.catalogs;
  assert.notDeepEqual(value.materials,before.value.materials);
  const plain=JSON.stringify({value,revision:before.revision});assert(Buffer.byteLength(plain)>1024*1024);
  const rejected=await fetch(f.origin+'/api/catalogs',{method:'PUT',headers:f.headers,body:plain});
  assert.equal(rejected.status,413);await rejected.text();assert.equal(f.writes(),0);
  const result=await f.storage.saveCatalogs(value);
  const upload=f.requests.filter(r=>r.path==='/api/catalogs').at(-1);
  assert.equal(upload.encoding,'gzip');assert(upload.bytes<1024*1024);
  assert.deepEqual(result,value);assert.deepEqual(f.current().value,value);
  assert.equal(f.storage.getCatalogRevision(),1);assert.equal(f.writes(),1);assert.equal(f.storage.status().pending,false);
  t.diagnostic('Excel import request: '+Buffer.byteLength(plain)+' bytes JSON -> '+upload.bytes+' bytes gzip');
  // Same transaction/revision rules apply to compressed retries and conflicts.
  const stale=structuredClone(value);stale.materials.summary.uploadTest='stale edit';
  const conflict=await fetch(f.origin+'/api/catalogs',{method:'PUT',headers:{...f.headers,'Content-Encoding':'gzip'},body:gzipSync(JSON.stringify({value:stale,revision:0}))});
  assert.equal(conflict.status,409);assert.equal((await conflict.json()).document.revision,1);assert.equal(f.writes(),1);
});

test('compressed requests retain body bounds, JSON validation, authentication, and CSRF checks',async t=>{
  const f=await fixture(t);f.config.bodyLimit=1024;
  const send=(body,headers={})=>fetch(f.backend+'/api/catalogs',{method:'PUT',headers:{...f.headers,'Content-Encoding':'gzip',...headers},body});
  let result=await send(gzipSync(JSON.stringify({value:'x'.repeat(2048),revision:0})));
  assert.equal(result.status,413);assert.equal((await result.json()).error.code,'body_too_large');
  result=await send(Buffer.alloc(2048));assert.equal(result.status,413);await result.text();
  result=await send(Buffer.from('not gzip'));assert.equal(result.status,400);assert.equal((await result.json()).error.code,'invalid_gzip');
  const good=gzipSync(JSON.stringify({value:{},revision:0}));
  result=await send(good.subarray(0,good.length-4));assert.equal(result.status,400);await result.text();
  result=await send(gzipSync('[]'));assert.equal(result.status,400);await result.text();
  result=await send(gzipSync('{"__proto__":{},"value":{},"revision":0}'));assert.equal(result.status,422);await result.text();
  result=await send(good,{'Content-Encoding':'deflate'});assert.equal(result.status,415);await result.text();
  result=await send(good,{'Cookie':''});assert.equal(result.status,401);await result.text();
  result=await send(good,{'X-CSRF-Token':'invalid'});assert.equal(result.status,403);await result.text();
  assert.equal(f.writes(),0);assert.equal(f.current().revision,0);
});
