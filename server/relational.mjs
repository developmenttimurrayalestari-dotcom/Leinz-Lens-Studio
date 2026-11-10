// Typed domain tables plus atomic extension values for forward-compatible metadata.
// No JSON column or serialized JSON value is used by this storage layer.
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { AppError } from './errors.mjs';

const id = 'VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin';
const str = n => `VARCHAR(${n})`;
const text = 'LONGTEXT', num = 'DOUBLE', bool = 'TINYINT UNSIGNED';
const fields = specification => Object.entries(specification).map(([name, sql]) => ({ name, column: name.replace(/[A-Z]/g, c => '_' + c.toLowerCase()), sql }));
const child = (type, many = false) => ({ type, many });
const definition = (columns = {}, children = {}, identity = null, constraints = []) => ({ fields: fields(columns), children, identity, constraints });
const power = Object.fromEntries(['sphMin','sphMax','cylMin','cylMax','addMin','addMax'].map(k => [k,num]));
export const TYPES = {
  materials: definition({schemaVersion:num}, {products:child('products',true),blanks:child('blanks',true),rules:child('power_rules',true)}),
  products: definition({id,supplier:str(80),code:str(80),name:str(200),index:str(8),activeForSimulator:bool,active:bool}, {opticalProfile:child('optical_profiles')}, 'id', ['UNIQUE KEY uq_rel_product (id)']),
  blanks: definition({id,productId:id,baseCurve:num,diameter:num,ct:num,et:num,active:bool}, {opticalProfile:child('optical_profiles')}, 'id', ['UNIQUE KEY uq_rel_blank (id)','FOREIGN KEY (product_id) REFERENCES leinz_rel_products(id)']),
  power_rules: definition({id,blankId:id,sphFrom:num,sphTo:num,cylFrom:num,cylTo:num,addFrom:num,addTo:num,exactDuplicateCount:num,hasExactDuplicates:bool,active:bool}, {sourceRows:child('source_rows',true)}, 'id', ['UNIQUE KEY uq_rel_rule (id)','FOREIGN KEY (blank_id) REFERENCES leinz_rel_blanks(id)']),
  source_rows: definition({value:num}),
  shapes: definition({schemaVersion:num,coordinateSystem:text,note:text}, {items:child('frame_shapes',true)}),
  frame_shapes: definition({code:id,name:str(140),shortName:str(60),description:str(1000),defaultWidthMm:num,defaultHeightMm:num,referenceAspectRatio:num,sourceAspectRatio:num,geometryRevision:str(64),contourMode:str(16),source:str(64),status:str(64),sourceFile:text,sourceSha256:str(64),sourcePathIndex:num,sourceSubpathIndex:num,sourceIndexBase:num,sourceContour:text,sourceSide:str(32),canonicalEye:str(8),sourcePathData:text,category:str(64),synthetic:bool,active:bool}, {points:child('shape_points',true),aliases:child('shape_aliases',true)}, 'code', ['UNIQUE KEY uq_rel_shape (code)']),
  shape_points: definition({x:num,y:num}),
  shape_aliases: definition({value:text}),
  tints: definition({schemaVersion:num}, {items:child('tint_items',true),pdfOnlySwatches:child('swatches',true)}),
  tint_items: definition({code:id,name:str(160),kind:str(16),family:str(64),group:str(32),nominalPercent:num,previewHex:str(7),previewMidHex:str(7),previewBottomHex:str(7),sourcePage:num,referenceStatus:str(64),referenceNote:str(2000),sourceRow:num,sourceImage:text,chartName:text,chartNominalPercent:num,chartKind:str(32),chartGroup:str(32),chartTopHex:str(7),chartMidHex:str(7),chartBottomHex:str(7),mappingMethod:text,previewCalibrated:bool,requiresPhysicalSample:bool,active:bool}, {}, 'code', ['UNIQUE KEY uq_rel_tint (code)']),
  swatches: definition({number:num,name:text,kind:str(32),group:str(32),nominalPercent:num,sourcePage:num,sourceImage:text,topHex:str(7),midHex:str(7),bottomHex:str(7)}),
  skus: definition({schema:str(64),updatedAt:str(40),sourceFile:text,sourceSha256:str(64),availabilityMeaning:text}, {skus:child('sku_items',true)}),
  sku_items: definition({id,code:str(64),name:str(140),active:bool,createdAt:text,updatedAt:text}, {variants:child('sku_variants',true)}, 'id', ['UNIQUE KEY uq_rel_sku (id)']),
  sku_variants: definition({index:str(8),enabled:bool}, {power:child('sku_power'),assignments:child('sku_assignments',true),powerRanges:child('sku_power_ranges',true)}, 'index'),
  sku_power: definition(power),
  sku_assignments: definition({id,supplier:str(80),productId:id}, {blankIds:child('sku_blanks',true)}, 'id', ['FOREIGN KEY (product_id) REFERENCES leinz_rel_products(id)']),
  sku_blanks: definition({value:id}, {}, null, ['FOREIGN KEY (value) REFERENCES leinz_rel_blanks(id)']),
  history: definition({}, {items:child('consultations',true)}),
  consultations: definition({id,title:str(100),createdAt:str(40)}, {state:child('states'),data:child('snapshots')}, 'id'),
  states: definition({active:str(1),shape:id,shapeRevision:str(64),width:num,height:num,dbl:num,sph:num,cyl:num,axis:num,add:num,pdR:num,pdL:num,heightR:num,heightL:num,allowanceDiameter:num,pd:num,fittingHeight:num,sync:bool,showFrame:bool,showTemples:bool,frameStyle:str(16),uvExposure:num}, {a:child('choices'),b:child('choices'),camera:child('cameras'),optics:child('optics')}),
  choices: definition({index:str(8),productId:id,skuId:id,blankIdR:id,blankIdL:id,tintCode:id,note:str(800),customColor:str(7),photochromic:bool}, {camera:child('cameras')}),
  cameras: definition({yaw:num,pitch:num,zoom:num}),
  optics: definition({useOverride:bool}, {profile:child('optical_profiles')}),
  optical_profiles: definition({minCenterMm:num,minEdgeMm:num,frontPowerD:num,frontRadiusMm:num,frontCurveBasis:str(32),curveReferenceIndex:num,frontConic:num,backConic:num,source:str(16),reference:str(500)}),
  snapshots: definition({schema:str(64),applicationVersion:str(32),storageMode:str(16),title:text,createdAt:text,status:text,productionReady:bool,lenswareConnected:bool}, {choices:child('snapshot_choices',true),frame:child('snapshot_frames'),prescription:child('prescriptions'),preview:child('previews')}),
  snapshot_choices: definition({choice:str(1),index:str(8)}, {photochromic:child('appearances')}),
  snapshot_frames: definition({shapeCode:id,shapeName:text,shapeSource:text,a:num,b:num,dbl:num,allowanceDiameter:num,unit:str(8)}),
  prescriptions: definition({sph:num,cyl:num,axis:num,add:num,scope:text}),
  previews: definition({uvExposure:num,comparisonUnit:text,displayConvention:text,indexScope:text,eyeMode:text,rotationMode:text,cameraSynchronized:bool,sameTint:bool,geometry:text,productionCalibration:text}, {optics:child('optics'),frameDisplay:child('frame_displays')}),
  frame_displays: definition({visible:bool,style:str(16),styleName:text,templesVisible:bool,templesEnabled:bool,illustrative:bool}),
  appearances: definition({enabled:bool,uvExposure:num,mode:text}),
  sku_power_ranges: definition({diameter:num,...power})
};
export const REL_TABLES = ['leinz_rel_documents','leinz_rel_entities','leinz_rel_values',...Object.keys(TYPES).map(k => 'leinz_rel_' + k)];
const hash = value => createHash('sha256').update(value).digest('hex');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const documentId = (scope,key,userId = null) => `${scope}:${scope === 'user' ? userId + ':' : ''}${key}`;
const rootType = (scope,key) => scope === 'catalog' ? key : key === 'saved' ? 'history' : key === 'state' ? 'states' : key;
const scalarTypes = new Set(['source_rows','shape_aliases','sku_blanks']);
function adapt(type,value) {
  if (scalarTypes.has(type)) return {value};
  if (type === 'shape_points' && Array.isArray(value) && value.length === 2) return {x:value[0],y:value[1]};
  return value;
}
function fits(value,sql) {
  if (sql === num) return typeof value === 'number' && Number.isFinite(value);
  if (sql === bool) return typeof value === 'boolean';
  if (typeof value !== 'string') return false;
  const max = sql.match(/^VARCHAR\((\d+)\)/)?.[1];
  return (!max || value.length <= Number(max)) && (!sql.includes('ascii') || /^[\x00-\x7f]*$/.test(value));
}
export function encodeDocument(scope,key,value) {
  const records = [], type = rootType(scope,key);
  const supported = {catalog:['materials','shapes','tints'],workspace:['skus'],user:['state','saved']};
  if (!supported[scope]?.includes(key)) throw Error(`Jenis dokumen belum didukung: ${scope}/${key}. Data asal dipertahankan.`);
  if (value === null) return {rootType:type,isNull:true,records};
  function visit(type,input,parentId,relation,ordinal) {
    const d = TYPES[type], object = adapt(type,input);
    if (!plain(object)) throw Error(`Struktur ${type} tidak dapat dimigrasikan. Data asal dipertahankan.`);
    const identity = d.identity && typeof object[d.identity] === 'string' ? object[d.identity] : String(ordinal);
    const nodeId = hash(JSON.stringify([parentId,relation,identity]));
    const record = {nodeId,parentId,relation,ordinal,type,fields:[],fieldMask:'',childMask:'',extra:{...object}};
    records.push(record);
    for (const f of d.fields) {
      const present = Object.hasOwn(object,f.name), v = object[f.name];
      const flag = !present ? '0' : v === null ? '1' : fits(v,f.sql) ? '2' : '3';
      record.fieldMask += flag;
      record.fields.push(flag === '2' ? (f.sql === bool ? Number(v) : v) : null);
      if (flag !== '3') delete record.extra[f.name];
    }
    for (const [name,c] of Object.entries(d.children)) {
      const present = Object.hasOwn(object,name), v = object[name];
      const valid = c.many ? Array.isArray(v) : plain(v);
      const flag = !present ? '0' : v === null ? '1' : valid ? '2' : '3';
      record.childMask += flag;
      if (flag !== '3') delete record.extra[name];
      if (flag === '2') (c.many ? v : [v]).forEach((item,i) => visit(c.type,item,nodeId,name,i));
    }
  }
  visit(type,key === 'saved' && scope === 'user' ? {items:value} : value,null,'root',0);
  if (new Set(records.map(r => r.nodeId)).size !== records.length) throw Error('Identitas relasional berulang. Data asal dipertahankan.');
  return {rootType:type,isNull:false,records};
}
export function decodeDocument(scope,key,plan) {
  if (plan.isNull) return null;
  const children = new Map();
  for (const r of plan.records) {
    const parent = r.parentId ?? '';
    if (!children.has(parent)) children.set(parent,[]);
    children.get(parent).push(r);
  }
  function visit(r) {
    const d = TYPES[r.type], value = {...r.extra};
    d.fields.forEach((f,i) => {
      if (r.fieldMask[i] === '1') value[f.name] = null;
      if (r.fieldMask[i] === '2') value[f.name] = f.sql === bool ? Boolean(r.fields[i]) : r.fields[i];
    });
    Object.entries(d.children).forEach(([name,c],i) => {
      if (r.childMask[i] === '1') value[name] = null;
      if (r.childMask[i] === '2') {
        const rows = (children.get(r.nodeId) || []).filter(n => n.relation === name).sort((a,b) => a.ordinal-b.ordinal);
        if (!c.many && rows.length !== 1) throw Error(`Relasi ${r.type}.${name} tidak lengkap.`);
        value[name] = c.many ? rows.map(visit) : visit(rows[0]);
      }
    });
    if (scalarTypes.has(r.type)) return value.value;
    if (r.type === 'shape_points') return [value.x,value.y];
    return value;
  }
  const roots = children.get('') || [];
  if (roots.length !== 1) throw Error('Root dokumen relasional tidak lengkap.');
  const value = visit(roots[0]);
  return scope === 'user' && key === 'saved' ? value.items : value;
}

// Extension values are individual typed atoms, including container/ordering rows.
// Used for provenance, arbitrary historical calculation output and future fields.
export function flattenExtra(value) {
  const rows = [];
  function visit(v,parent,member,ordinal) {
    const n = rows.length;
    const kind = v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
    if (!['null','array','object','string','number','boolean'].includes(kind)) throw Error('Nilai ekstensi bukan data JSON.');
    rows.push([n,parent,member,ordinal,kind,kind === 'string' ? v : null,kind === 'number' ? v : null,kind === 'boolean' ? Number(v) : null]);
    if (v !== null && typeof v === 'object') Object.entries(v).forEach(([k,item],i) => visit(item,n,k,i));
  }
  visit(value,null,'',0); return rows;
}
export function inflateExtra(rows) {
  if (!rows.length) return {};
  const objects = new Map();
  for (const r of [...rows].sort((a,b) => Number(a[0])-Number(b[0]))) {
    const [n,parent,member,,kind,s,v,b] = r;
    const value = kind === 'null' ? null : kind === 'array' ? [] : kind === 'object' ? {} : kind === 'string' ? s : kind === 'number' ? Number(v) : Boolean(b);
    objects.set(Number(n),value);
    if (parent !== null) Object.defineProperty(objects.get(Number(parent)),member,{value,enumerable:true,writable:true,configurable:true});
  }
  return objects.get(0);
}

export function schemaSql({powerRangesOnly = false} = {}) {
  const engine = ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;';
  const doc = 'VARCHAR(180) CHARACTER SET ascii COLLATE ascii_bin', node = 'CHAR(64) CHARACTER SET ascii COLLATE ascii_bin';
  const sql = [
    '-- Additive MySQL 5.7.24 schema. Run npm run db:migrate for verified backfill.',
    '-- Version 3 is recorded by the backfill, never by DDL alone.',
    `CREATE TABLE IF NOT EXISTS leinz_rel_documents (document_id ${doc} NOT NULL PRIMARY KEY, scope VARCHAR(16) CHARACTER SET ascii NOT NULL, document_key VARCHAR(16) CHARACTER SET ascii NOT NULL, user_id INT UNSIGNED NULL, root_type VARCHAR(48) CHARACTER SET ascii NOT NULL, is_null TINYINT UNSIGNED NOT NULL, migrated_sha256 CHAR(64) CHARACTER SET ascii NULL, migrated_at DATETIME NULL, FOREIGN KEY (user_id) REFERENCES leinz_users(id) ON DELETE CASCADE)${engine}`,
    `CREATE TABLE IF NOT EXISTS leinz_rel_entities (document_id ${doc} NOT NULL, node_id ${node} NOT NULL, parent_id ${node} NULL, relation_name VARCHAR(64) CHARACTER SET ascii NOT NULL, ordinal INT UNSIGNED NOT NULL, entity_type VARCHAR(48) CHARACTER SET ascii NOT NULL, field_mask VARCHAR(255) CHARACTER SET ascii NOT NULL, child_mask VARCHAR(255) CHARACTER SET ascii NOT NULL, PRIMARY KEY(document_id,node_id), KEY ix_rel_parent(document_id,parent_id,relation_name,ordinal), FOREIGN KEY(document_id) REFERENCES leinz_rel_documents(document_id) ON DELETE CASCADE, FOREIGN KEY(document_id,parent_id) REFERENCES leinz_rel_entities(document_id,node_id) ON DELETE CASCADE)${engine}`,
    `CREATE TABLE IF NOT EXISTS leinz_rel_values (document_id ${doc} NOT NULL, node_id ${node} NOT NULL, value_id INT UNSIGNED NOT NULL, parent_value_id INT UNSIGNED NULL, member_name LONGTEXT NOT NULL, ordinal INT UNSIGNED NOT NULL, value_kind ENUM('null','array','object','string','number','boolean') NOT NULL, string_value LONGTEXT NULL, number_value DOUBLE NULL, boolean_value TINYINT UNSIGNED NULL, PRIMARY KEY(document_id,node_id,value_id), FOREIGN KEY(document_id,node_id) REFERENCES leinz_rel_entities(document_id,node_id) ON DELETE CASCADE)${engine}`
  ];
  if (powerRangesOnly) sql.length=0;
  for (const [name,d] of Object.entries(TYPES)) {
    if (powerRangesOnly !== (name === 'sku_power_ranges')) continue;
    const columns = [`document_id ${doc} NOT NULL`,`node_id ${node} NOT NULL`,...d.fields.map(f => `\`${f.column}\` ${f.sql} NULL`),'PRIMARY KEY(document_id,node_id)',`FOREIGN KEY(document_id,node_id) REFERENCES leinz_rel_entities(document_id,node_id) ON DELETE CASCADE`,...d.constraints];
    sql.push(`CREATE TABLE IF NOT EXISTS leinz_rel_${name} (\n  ${columns.join(',\n  ')}\n)${engine}`);
  }
  return sql.join('\n\n') + '\n';
}

async function bulk(connection,sql,rows) {
  for (let i=0;i<rows.length;i+=250) await connection.query(sql,[rows.slice(i,i+250)]);
}
export async function writeRelational(connection,scope,key,value,userId = null) {
  const docId = documentId(scope,key,userId), plan = encodeDocument(scope,key,value);
  await connection.execute('INSERT INTO leinz_rel_documents (document_id,scope,document_key,user_id,root_type,is_null) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE root_type=VALUES(root_type),is_null=VALUES(is_null)',[docId,scope,key,userId,plan.rootType,Number(plan.isNull)]);
  const [old] = await connection.execute('SELECT node_id,parent_id,entity_type FROM leinz_rel_entities WHERE document_id=?',[docId]);
  const nodes = plan.records.map(r => [docId,r.nodeId,r.parentId,r.relation,r.ordinal,r.type,r.fieldMask,r.childMask]);
  await bulk(connection,'INSERT INTO leinz_rel_entities (document_id,node_id,parent_id,relation_name,ordinal,entity_type,field_mask,child_mask) VALUES ? ON DUPLICATE KEY UPDATE parent_id=VALUES(parent_id),ordinal=VALUES(ordinal),field_mask=VALUES(field_mask),child_mask=VALUES(child_mask)',nodes);
  for (const [type,d] of Object.entries(TYPES)) {
    const records = plan.records.filter(r => r.type === type);
    if (!records.length) continue;
    const columns = ['document_id','node_id',...d.fields.map(f => f.column)].map(c => '`'+c+'`');
    const update = d.fields.length ? d.fields.map(f => `\`${f.column}\`=VALUES(\`${f.column}\`)`).join(',') : 'node_id=VALUES(node_id)';
    await bulk(connection,`INSERT INTO leinz_rel_${type} (${columns.join(',')}) VALUES ? ON DUPLICATE KEY UPDATE ${update}`,records.map(r => [docId,r.nodeId,...r.fields]));
  }
  await connection.execute('DELETE FROM leinz_rel_values WHERE document_id=?',[docId]);
  const values = plan.records.flatMap(r => Object.keys(r.extra).length ? flattenExtra(r.extra).map(v => [docId,r.nodeId,...v]) : []);
  await bulk(connection,'INSERT INTO leinz_rel_values (document_id,node_id,value_id,parent_value_id,member_name,ordinal,value_kind,string_value,number_value,boolean_value) VALUES ?',values);
  const keep = new Set(plan.records.map(r => r.nodeId));
  // Children are removed before parents. Product/blank identities are retained by
  // master validation; rules and user history may be removed by an authorized PUT.
  const oldMap = new Map(old.map(r => [r.node_id,r]));
  const depth = r => r?.parent_id ? 1+depth(oldMap.get(r.parent_id)) : 0;
  const stale = old.filter(r => !keep.has(r.node_id)).sort((a,b) => depth(b)-depth(a));
  await deleteEntityRows(connection,docId,stale);
  return plan;
}

export async function deleteEntityRows(connection,docId,stale) {
  const rank=r=>({sku_blanks:0,sku_assignments:1,power_rules:1,blanks:2,products:3}[r.entity_type]??0);
  for(const priority of [0,1,2,3]) {
    const group=stale.filter(r=>rank(r)===priority);
    for (let i=0;i<group.length;i+=250) {
      const ids = group.slice(i,i+250).map(r => r.node_id);
      await connection.query('DELETE FROM leinz_rel_entities WHERE document_id=? AND node_id IN (?)',[docId,ids]);
    }
  }
}

// Caller supplies a dedicated connection in REPEATABLE READ transaction so all
// component SELECTs and the legacy revision metadata belong to one snapshot.
export async function readRelational(connection,scope,key,userId = null) {
  const docId = documentId(scope,key,userId);
  const [[doc]] = await connection.execute('SELECT root_type,is_null FROM leinz_rel_documents WHERE document_id=?',[docId]);
  if (!doc) throw new AppError(503,'storage_uninitialized','Penyimpanan relasional belum lengkap. Jalankan npm run db:migrate lalu db:seed.');
  const [entities] = await connection.execute('SELECT node_id,parent_id,relation_name,ordinal,entity_type,field_mask,child_mask FROM leinz_rel_entities WHERE document_id=?',[docId]);
  const records = entities.map(r => ({nodeId:r.node_id,parentId:r.parent_id,relation:r.relation_name,ordinal:Number(r.ordinal),type:r.entity_type,fieldMask:r.field_mask,childMask:r.child_mask,extra:{},fields:[]}));
  const byNode = new Map(records.map(r => [r.nodeId,r]));
  for (const type of new Set(records.map(r => r.type))) {
    const d = TYPES[type];
    if (!Object.hasOwn(TYPES,type)) throw Error('Jenis entitas relasional tidak dikenal.');
    const [rows] = await connection.execute(`SELECT t.* FROM leinz_rel_${type} t INNER JOIN leinz_rel_entities e ON e.document_id=t.document_id AND e.node_id=t.node_id WHERE t.document_id=?`,[docId]);
    for (const row of rows) byNode.get(row.node_id).fields = d.fields.map(f => row[f.column]);
    if (rows.length !== records.filter(r => r.type === type).length) throw Error('Baris domain relasional tidak lengkap.');
  }
  const [extras] = await connection.execute('SELECT node_id,value_id,parent_value_id,member_name,ordinal,value_kind,string_value,number_value,boolean_value FROM leinz_rel_values WHERE document_id=? ORDER BY node_id,value_id',[docId]);
  const groups = new Map();
  for (const r of extras) {
    if (!groups.has(r.node_id)) groups.set(r.node_id,[]);
    groups.get(r.node_id).push([r.value_id,r.parent_value_id,r.member_name,r.ordinal,r.value_kind,r.string_value,r.number_value,r.boolean_value]);
  }
  for (const [node,rows] of groups) byNode.get(node).extra = inflateExtra(rows);
  return decodeDocument(scope,key,{rootType:doc.root_type,isNull:Boolean(doc.is_null),records});
}

export function assertPreserved(expected,actual,label) {
  if (!isDeepStrictEqual(expected,actual)) throw Error(`Verifikasi migrasi gagal (${label}). Transaksi dibatalkan, JSON asal tetap utuh.`);
}
