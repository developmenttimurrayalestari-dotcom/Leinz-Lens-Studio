/** Destructive integration suite, restricted to explicitly opted-in test databases. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadConfig} from '../server/config.mjs';
import {createPool,migrate,MysqlStore,TABLES,catalogDigest,decodeJson} from '../server/db.mjs';
import {readRelational,documentId,REL_TABLES} from '../server/relational.mjs';
import {hashPassword} from '../server/auth.mjs';
if(process.env.LEINZ_ALLOW_TEST_DB!=='1'||!/^leinz_test_[A-Za-z0-9_]+$/.test(process.env.MYSQL_DATABASE||'')) throw Error('Requires LEINZ_ALLOW_TEST_DB=1 and MYSQL_DATABASE=leinz_test_<disposable_name>.');
const config=loadConfig({env:process.env,envFile:'/nonexistent-relational-test-env'});
const pool=createPool(config);
const catalogs=Object.fromEntries(await Promise.all(['materials','shapes','tints'].map(async key=>[key,JSON.parse(await readFile(new URL(`../dist/assets/${key}.json`,import.meta.url),'utf8'))])));
const state={active:'a',shape:'001',width:52,height:38,dbl:18,sph:-4,cyl:-1,axis:180,add:0,uvExposure:65,showFrame:true,showTemples:false,sync:false,
  a:{index:'1.74',productId:'DMO:SPHW74',tintCode:null,photochromic:true,note:'Café 👓'},b:{index:'1.50',productId:'SOA:SPHW50',tintCode:'09S',photochromic:false},future:{emptyObject:{},emptyArray:[],zero:0,flag:false,nullable:null}};
const history=[{id:'same-id-for-two-users',title:'Riwayat lama',createdAt:'2026-11-10T08:10:11.123+07:00',state:{...state,shape:'browline'},data:{schema:'trl-lens-consultation/1.3',choices:[{index:'1.74',tint:null},{index:'1.50',tint:{code:'old-code'}}],legacySnapshot:{arbitrary:[{},[],null,'👓'],power:-1.123456789012345}}}];
const sku={schema:'trl-sku-catalog/1.0',skus:[{id:'sku-old',code:'CAFÉ',name:'Produk lama',active:true,createdAt:null,updatedAt:null,variants:[{index:'1.74',enabled:true,power:{sphMin:-10,sphMax:10,cylMin:-6,cylMax:0,addMin:0,addMax:4},assignments:[{id:'old-assignment',supplier:'DMO',productId:'DMO:SPHW74',blankIds:['DMO:SPHW74:BC1.00:D70.00']}]}]}]};
async function legacy() {
  const result={};
  for(const table of ['leinz_catalog_documents','leinz_workspace_documents','leinz_user_documents','leinz_users','leinz_sessions','leinz_catalog_revision']) {
    const [rows]=await pool.query(`SELECT * FROM ${table} ORDER BY 1,2`); result[table]=rows;
  }
  return result;
}
async function consistentRead(scope,key,userId=null) {
  const c=await pool.getConnection();
  try{await c.beginTransaction();const v=await readRelational(c,scope,key,userId);await c.commit();return v;}catch(e){await c.rollback();throw e;}finally{c.release();}
}
try {
  for(const name of [...TABLES].reverse())await pool.query(`DROP TABLE IF EXISTS \`${name}\``);
  for(const name of ['001_initial.sql','002_managed_catalogs.sql']) {
    const sql=await readFile(new URL('../database/'+name,import.meta.url),'utf8');
    for(const statement of sql.replace(/^\s*--.*$/gm,'').split(';').map(x=>x.trim()).filter(Boolean))await pool.query(statement);
  }
  for(const [key,value]of Object.entries(catalogs))await pool.execute('INSERT INTO leinz_catalog_documents VALUES (?,?,?,UTC_TIMESTAMP())',[key,JSON.stringify(value),catalogDigest(value)]);
  await pool.query('UPDATE leinz_catalog_revision SET revision=12');
  await pool.execute('INSERT INTO leinz_workspace_documents VALUES (?,?,9,UTC_TIMESTAMP())',['skus',JSON.stringify(sku)]);
  for(const name of ['old-one','old-two']) {
    const [user]=await pool.execute('INSERT INTO leinz_users (username,password_hash,active,created_at) VALUES (?,?,1,UTC_TIMESTAMP())',[name,await hashPassword('Only-For-Disposable-Test')]);
    for(const [key,value]of [['state',state],['saved',history]])await pool.execute('INSERT INTO leinz_user_documents VALUES (?,?,?,7,UTC_TIMESTAMP())',[user.insertId,key,JSON.stringify(value)]);
  }
  const original=await legacy();
  // Trigger is injected after DDL installation, before any backfill succeeds.
  const ddl=await readFile(new URL('../database/003_relational_documents.sql',import.meta.url),'utf8');
  for(const s of ddl.replace(/^\s*--.*$/gm,'').split(';').map(x=>x.trim()).filter(Boolean))await pool.query(s);
  await pool.query("CREATE TRIGGER qa_rel_fail BEFORE INSERT ON leinz_rel_tint_items FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Injected migration failure'");
  await assert.rejects(migrate(pool),/Injected migration failure/);
  assert.deepEqual(await legacy(),original);
  const [[partial]]=await pool.query('SELECT COUNT(*) AS n FROM leinz_rel_documents');assert.equal(Number(partial.n),0);
  const [[version]]=await pool.query('SELECT MAX(version) AS v FROM leinz_schema_migrations');assert.equal(Number(version.v),2);
  await pool.query('DROP TRIGGER qa_rel_fail');
  console.log('PASS migration SQL failure rolls back every extracted document and retains all legacy rows');
  await pool.execute('INSERT INTO leinz_workspace_documents VALUES (?,?,0,UTC_TIMESTAMP())',['future',JSON.stringify({unknown:true})]);
  await assert.rejects(migrate(pool),/belum didukung/);
  const [[unknown]]=await pool.query('SELECT COUNT(*) AS n FROM leinz_rel_documents');assert.equal(Number(unknown.n),0);
  await pool.execute('DELETE FROM leinz_workspace_documents WHERE document_key=?',['future']);
  console.log('PASS unknown legacy document stops cutover without discarding data');
  await migrate(pool);await migrate(pool);
  assert.deepEqual(await legacy(),original);
  for(const [key,value]of Object.entries(catalogs)) assert.deepEqual(await consistentRead('catalog',key),value);
  assert.deepEqual(await consistentRead('workspace','skus'),sku);
  for(const user of [1,2]) {
    assert.deepEqual(await consistentRead('user','state',user),state);
    assert.deepEqual(await consistentRead('user','saved',user),history);
  }
  const [audit]=await pool.query('SELECT migrated_sha256 FROM leinz_rel_documents');assert.equal(audit.length,8);assert(audit.every(r=>/^[a-f0-9]{64}$/.test(r.migrated_sha256)));
  const store=new MysqlStore(pool,config);await store.initialize();
  const multiple=structuredClone(sku);
  multiple.skus[0].variants[0].powerRanges=[{diameter:70,sphMin:-4,sphMax:6,cylMin:-3,cylMax:0,addMin:0,addMax:0},{diameter:75,sphMin:-8,sphMax:2,cylMin:-3,cylMax:0,addMin:0,addMax:0}];
  delete multiple.skus[0].variants[0].power;
  await store.putDocument(null,'skus',multiple,9);
  assert.deepEqual((await store.getDocument(null,'skus')).value.skus[0].variants[0].powerRanges,multiple.skus[0].variants[0].powerRanges);
  const [[rangeCount]]=await pool.query('SELECT COUNT(*) AS n FROM leinz_rel_sku_power_ranges');assert.equal(Number(rangeCount.n),2);
  await migrate(pool);
  assert.deepEqual((await store.getDocument(null,'skus')).value.skus[0].variants[0].powerRanges,multiple.skus[0].variants[0].powerRanges);
  const changed={...state,sph:-5,uvExposure:22};
  await store.putDocument(1,'state',changed,7);
  await store.putDocument(1,'saved',[],7);
  assert.deepEqual((await store.getDocument(1,'state')).value,changed);
  assert.deepEqual((await store.getDocument(1,'saved')).value,[]);
  assert.deepEqual((await store.getDocument(2,'saved')).value,history);
  const [[deleted]]=await pool.execute('SELECT COUNT(*) AS n FROM leinz_rel_consultations WHERE document_id=?',[documentId('user','saved',1)]);assert.equal(Number(deleted.n),0);
  await assert.rejects(store.putDocument(1,'state',state,7),e=>e.status===409&&e.extra.document.revision===8);
  await migrate(pool);
  assert.deepEqual((await store.getDocument(1,'state')).value,changed);
  const frozen=await legacy();
  for(const table of ['leinz_catalog_documents','leinz_workspace_documents','leinz_user_documents']) {
    for(let i=0;i<original[table].length;i++)assert.deepEqual(decodeJson(frozen[table][i].document_json),decodeJson(original[table][i].document_json));
  }
  const [jsonColumns]=await pool.query("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND DATA_TYPE='json'");assert.equal(jsonColumns.length,3);
  console.log(`PASS migration preserves all 8 documents, revisions, users and Unicode; ${REL_TABLES.length} relational tables; CRUD, delete, isolation and rerun preserve frozen JSON`);
}finally{await pool.end();}
