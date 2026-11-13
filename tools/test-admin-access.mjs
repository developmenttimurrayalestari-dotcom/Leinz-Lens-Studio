import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.mjs';
import { MysqlStore } from '../server/db.mjs';
import { newToken, validateRole, hashPassword } from '../server/auth.mjs';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { encodeDocument, decodeDocument } from '../server/relational.mjs';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const model=require('../dist/catalog-model.js');
const ui=require('../dist/master-manager.js').MasterUiModel;
const tabular=require('../dist/tabular-import.js');
const catalogs=()=>Object.fromEntries(['materials','shapes','tints'].map(key=>[key,JSON.parse(readFileSync(new URL('../dist/assets/'+key+'.json',import.meta.url),'utf8'))]));

test('application navigation hides Manage for users and rejects every Manage entry point',()=>{
  const makeElement=(id,dataset={})=>({id,dataset,hidden:false,attributes:{},classList:{toggle(){},add(){},remove(){}},setAttribute(key,value){this.attributes[key]=value;},removeAttribute(key){delete this.attributes[key];}});
  const elements=new Map();const get=id=>{if(!elements.has(id))elements.set(id,makeElement(id));return elements.get(id);};
  const navigation=[makeElement('nav-studio',{tab:'studio'}),makeElement('nav-manage',{tab:'manage'})];
  const managed=[navigation[1],makeElement('cutting',{tab:'materials'}),makeElement('users',{manageTab:'users'})];
  const pages=[get('view-studio'),get('view-manage')];
  const document={querySelector:q=>get(q.replace(/^#/,'')),querySelectorAll:q=>q==='.page-view'?pages:q==='.nav-button'?navigation:q.includes('[data-tab="manage"]')?managed:[]};
  const context=vm.createContext({document,window:{scrollTo(){}},requestAnimationFrame(){},setTimeout(){},clearTimeout(){}});
  const source=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8').replace(/  init\(\);\s*\}\)\(\);\s*$/,'  window.testAccess={canManage,applyAccess,setTab,showManage,setStorage:value=>storage=value,setPage:value=>currentTab=value,getPage:()=>currentTab};\n})();');
  vm.runInContext(source,context);const access=context.window.testAccess;assert(access);
  access.setStorage({mode:'mysql',authenticated:true,user:{role:'user'}});access.applyAccess();assert.equal(access.canManage(),false);assert(managed.every(el=>el.hidden));
  for(const tab of ['manage','materials','skus','reference']){access.setTab(tab);assert.equal(access.getPage(),'studio');}
  assert.equal(access.showManage('users'),false);
  access.setPage('manage');access.applyAccess();assert.equal(access.getPage(),'studio');assert.equal(get('view-studio').hidden,false);assert.equal(get('view-manage').hidden,true);
  access.setStorage({mode:'mysql',authenticated:true,user:{role:'administrator'}});access.applyAccess();assert.equal(access.canManage(),true);assert(managed.every(el=>!el.hidden));
  access.setStorage({mode:'mysql',authenticated:false,user:{role:'administrator'}});access.applyAccess();assert.equal(access.canManage(),false);assert(managed.every(el=>el.hidden));
  access.setStorage({mode:'browser',authenticated:true});assert.equal(access.canManage(),true);
});

test('admin forms render custom indices and restore controls after nested save/load failures',()=>{
  require('../dist/admin-manager.js');const Manager=globalThis.LeinzAdminManager;
  const controls=[{disabled:false},{disabled:true}],root={addEventListener(){},setAttribute(){},querySelectorAll(){return controls;},contains:el=>controls.includes(el)};
  const value=catalogs();value.materials.indexOptions=[...model.materialIndices(value.materials),'1.70'];
  const manager=new Manager({root,storage:{mode:'mysql',user:{id:1}},getCatalogs:()=>value,onCatalogs(){}});
  assert.match(manager.indicesHtml(),/1\.70/);
  manager.setBusy(true);manager.setBusy(true);manager.setBusy(false);manager.setBusy(false);assert.equal(controls[0].disabled,false);assert.equal(controls[1].disabled,true);
  manager.editing={id:1,username:'safe<script>',role:'administrator',active:true};assert.match(manager.usersHtml(),/safe&lt;script&gt;/);assert.doesNotMatch(manager.usersHtml(),/safe<script>/);
  manager.storage.mode='browser';assert.match(manager.usersHtml(),/mode server MySQL/);
});

test('managed indices validate, persist through relational mapping, and populate product drafts',()=>{
  const value=catalogs();value.materials.indexOptions=[...model.materialIndices(value.materials),'1.70'];
  const draft=ui.makeDraft('product',null,value);Object.assign(draft.values,{code:'CUSTOM70',supplier:'Custom',name:'Custom material',index:'1.70'});
  const candidate=ui.buildCandidate(value,draft);
  assert.equal(model.validateCatalogBundle(candidate).ok,true);
  assert.equal(candidate.materials.products.at(-1).activeForSimulator,false);
  const roundtrip=decodeDocument('catalog','materials',encodeDocument('catalog','materials',candidate.materials));
  assert.deepEqual(roundtrip,candidate.materials);
  roundtrip.indexOptions=roundtrip.indexOptions.filter(n=>n!=='1.70');
  assert.equal(model.validateCatalogBundle({...candidate,materials:roundtrip}).ok,false);
  const unused=catalogs();unused.materials.indexOptions=[...model.materialIndices(unused.materials),'1.70'];unused.materials.indexOptions.pop();
  assert.equal(model.validateCatalogBundle(unused).ok,true);
  for(const list of [[],['1.70','1.70'],['1.701'],['1.00'],['2.51'],null,{}]){
    const bad=catalogs();bad.materials.indexOptions=list;assert.equal(model.validateCatalogBundle(bad).ok,false);
  }
  const small={...value,materials:{...value.materials,products:[],blanks:[],rules:[],indexOptions:['1.70']}};
  assert.equal(ui.makeDraft('product',null,small).values.index,'1.70');
});

test('material CSV imports use managed indices and retain catalog-only status',()=>{
  const value=catalogs();value.materials.indexOptions=[...model.materialIndices(value.materials),'1.70'];
  const csv=readFileSync(new URL('../dist/templates/blank-template.csv',import.meta.url),'utf8');
  const parsed=tabular.parseCSV(csv),rows=tabular.rowsFor(parsed,'materials');
  const row=rows[0];row.values.supplier='Custom';row.values.LensCode='CUSTOM70';row.values.Descr='Material 1.70';row.values.index='1.70';
  // Build a workbook using the existing template headers and a custom catalog index.
  const headers=[...tabular.HEADERS.materials,'index'];
  const text=headers.join(',')+'\n'+headers.map(h=>row.values[h]??'').join(',');
  const plan=tabular.buildMasterImport(value,tabular.parseCSV(text),{kind:'materials'});
  const result=plan.payload.catalogs;
  const product=result.materials.products.find(p=>p.code==='CUSTOM70');
  assert.equal(product.index,'1.70');assert.equal(product.activeForSimulator,false);
  assert.throws(()=>tabular.buildMasterImport(catalogs(),tabular.parseCSV(text),{kind:'materials'}));
});

test('compact index writes merge into the locked catalog and preserve unrelated master data',async()=>{
  const current={value:catalogs(),revision:7},calls=[];
  current.value.materials.products[0].name='Latest server edit';
  const connection={beginTransaction:async()=>{},commit:async()=>calls.push({commit:true}),rollback:async()=>calls.push({rollback:true}),release(){},
    query:async(sql,args)=>{calls.push({sql,args});return sql.startsWith('SELECT revision')?[[{revision:7}]]:[[]];},
    execute:async(sql,args)=>{calls.push({sql,args});return [[]];}};
  const store=new MysqlStore({getConnection:async()=>connection},{});
  store.getCatalogs=async()=>structuredClone(current);
  store.getDocument=async()=>({value:{skus:[]},revision:0});
  const indices=[...model.materialIndices(current.value.materials),'1.70'];
  const saved=await store.putMaterialIndices(indices,7);
  assert.equal(saved.revision,8);
  assert.deepEqual(saved.value,{...current.value,materials:{...current.value.materials,indexOptions:indices}});
  assert.deepEqual(calls.filter(c=>c.sql?.startsWith('UPDATE leinz_catalog_documents')).map(c=>c.args[0]),['materials']);
  assert(calls.some(c=>c.commit));assert(!calls.some(c=>c.rollback));
  calls.length=0;
  await assert.rejects(store.putMaterialIndices(indices,6),e=>e.status===409&&e.extra.document.revision===7);
  assert(!calls.some(c=>c.sql?.startsWith('INSERT')||c.sql?.startsWith('UPDATE')));
  calls.length=0;
  await assert.rejects(store.putMaterialIndices(indices.filter(n=>n!=='1.60'),7),e=>e.status===422);
  assert(!calls.some(c=>c.sql?.startsWith('INSERT')||c.sql?.startsWith('UPDATE')));
  await assert.rejects(store.putMaterialIndices(null,7),e=>e.status===422);
});

test('HTTP authorization protects users and shared masters while allowing Studio documents',async()=>{
  const adminToken=newToken(),userToken=newToken(),unknownRoleToken=newToken(),csrf='b'.repeat(64),writes=[];
  const sessions=new Map([[adminToken,{user:{id:1,username:'admin',role:'administrator'},csrfToken:csrf}],[userToken,{user:{id:2,username:'operator',role:'user'},csrfToken:csrf}],[unknownRoleToken,{user:{id:3,username:'legacy'},csrfToken:csrf}]]);
  const passwordHash=await hashPassword('test-password-only');
  const store={getSession:async token=>sessions.get(token)||null,userByName:async()=>({id:2,username:'operator',role:'user',active:1,password_hash:passwordHash}),createSession:async user=>({token:userToken,user:{id:user.id,username:user.username,role:user.role},csrfToken:csrf}),removeSession:async()=>{},bootstrap:async()=>({catalogs:{},documents:{}}),getCatalogs:async()=>({value:{},revision:1}),putCatalogs:async()=>{writes.push('catalog');return {};},getDocument:async()=>({value:null,revision:0}),putDocument:async(id,key)=>{writes.push([id,key]);return {};},listUsers:async()=>[{id:1,username:'admin',role:'administrator',active:true}],addUser:async value=>{writes.push(value);return {id:4,username:value.username,role:value.role,active:true};},updateUser:async(id,value,actor)=>{writes.push({id,value,actor});return {id,...value,password:undefined};}};
  const config={origin:'http://127.0.0.1',bodyLimit:1024*1024,sessionHours:8};
  store.putMaterialIndices=async(value,revision)=>{writes.push({indices:value,revision});return {value:{materials:{indexOptions:value}},revision:revision+1};};
  const server=createApp({store,config,logger:{error:assert.fail}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));config.origin='http://127.0.0.1:'+server.address().port;
  const request=(path,{method='GET',token=adminToken,body,csrfToken=csrf}={})=>fetch(config.origin+path,{method,headers:{Origin:config.origin,Cookie:'leinz_session='+token,'Content-Type':'application/json','X-CSRF-Token':csrfToken},...(body===undefined?{}:{body:JSON.stringify(body)})});
  try{
    assert.equal((await request('/api/users',{token:''})).status,401);
    for(const token of [userToken,unknownRoleToken]){
      for(const [path,method]of [['/api/users','GET'],['/api/users','POST'],['/api/users/1','PUT'],['/api/catalogs','PUT'],['/api/catalogs/indices','PUT'],['/api/documents/skus','PUT']])assert.equal((await request(path,{token,method,body:method==='GET'?undefined:{}})).status,403,path);
      assert.equal((await request('/api/bootstrap',{token})).status,200);
      assert.equal((await request('/api/catalogs',{token})).status,200);
      assert.equal((await request('/api/documents/skus',{token})).status,200);
    }
    for(const key of ['state','saved'])assert.equal((await request('/api/documents/'+key,{method:'PUT',token:userToken,body:{value:null,revision:0}})).status,200);
    assert.deepEqual(writes,[[2,'state'],[2,'saved']]);
    const users=await (await request('/api/users')).json();assert.equal(users.users[0].role,'administrator');assert.equal(users.users[0].password_hash,undefined);
    const body={username:'newuser',password:'valid-password',role:'user'};
    assert.equal((await request('/api/users',{method:'POST',body,csrfToken:'wrong'})).status,403);
    assert.equal((await request('/api/users',{method:'POST',body:{...body,role:'owner'}})).status,422);
    assert.equal((await request('/api/users',{method:'POST',body:{...body,password:'short'}})).status,422);
    assert.equal((await request('/api/users',{method:'POST',body})).status,201);
    assert.equal((await request('/api/users/4',{method:'PUT',body:{username:'newuser',role:'administrator',active:true,password:''}})).status,200);
    assert.equal(writes.at(-1).actor,1);
    assert.equal((await request('/api/catalogs',{method:'PUT',body:{value:{},revision:1}})).status,200);
    assert.equal((await request('/api/catalogs/indices',{method:'PUT',body:{value:['1.60','1.70'],revision:1},csrfToken:'wrong'})).status,403);
    assert.equal((await request('/api/catalogs/indices')).status,405);
    const indexSave=await request('/api/catalogs/indices',{method:'PUT',body:{value:['1.60','1.70'],revision:1}});
    assert.equal(indexSave.status,200);assert.equal((await indexSave.json()).revision,2);
    assert.deepEqual(writes.at(-1),{indices:['1.60','1.70'],revision:1});
    assert.equal((await request('/api/catalogs/indices',{method:'PUT',body:{value:['1.70'],revision:1,unrelated:'x'.repeat(5000)}})).status,413);
    const session=await (await request('/api/session',{method:'POST',token:'',body:{username:'operator',password:'test-password-only'}})).json();assert.equal(session.user.role,'user');
    sessions.delete(userToken);assert.equal((await request('/api/documents/state',{token:userToken})).status,401);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('account edits protect active administrators and revoke changed account sessions',async()=>{
  const rows=[{id:1,role:'administrator',active:1},{id:2,role:'user',active:1}],calls=[];
  const connection={beginTransaction:async()=>{},commit:async()=>calls.push('commit'),rollback:async()=>calls.push('rollback'),release(){},query:async()=>[rows],execute:async(sql,args)=>{calls.push({sql,args});return [{}];}};
  const store=new MysqlStore({getConnection:async()=>connection},{});
  await assert.rejects(store.updateUser(1,{username:'admin',role:'user',active:true},1),error=>error.code==='self_lockout');
  await assert.rejects(store.updateUser(1,{username:'admin',role:'administrator',active:false},9),error=>error.code==='last_administrator');
  await assert.rejects(store.updateUser(9,{username:'unknown',role:'user',active:true},1),error=>error.status===404);
  await assert.rejects(store.updateUser(2,{username:'operator',role:'owner',active:true},1),error=>error.status===422);
  assert.equal(calls.some(c=>c.sql?.startsWith('UPDATE')),false);
  await store.updateUser(2,{username:'operator',role:'administrator',active:true,password:'new-password-test'},1);
  const update=calls.find(c=>c.sql?.startsWith('UPDATE'));assert.match(update.args[3],/^scrypt\$1\$/);assert(!update.args.includes('new-password-test'));
  assert(calls.some(c=>c.sql==='DELETE FROM leinz_sessions WHERE user_id=?'&&c.args[0]===2));
  assert.throws(()=>validateRole('owner'));assert.equal(validateRole('user'),'user');
});
