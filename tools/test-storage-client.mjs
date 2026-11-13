import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { LeinzStorage } = require('../dist/storage-client.js');
const STATE = 'leinz-lens-studio-state-v1';
const SAVED = 'leinz-lens-studio-saved-v1';
const SKUS = 'leinz-sku-catalog-v1';
const CATALOGS = 'leinz-master-catalogs-v1';
const copy = value => structuredClone(value);
const response = (status, value) => ({ status, ok: status >= 200 && status < 300, async json() { return copy(value); } });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

test('catalog deletion metadata survives network failure and retry with the same revision',async()=>{
  let fail=true;
  const f=mysqlFixture(req=>{if(req.path==='/api/catalogs'&&req.method==='PUT'&&fail){fail=false;throw Error('offline');}});
  f.documents.catalogs.value.tints.items=[{code:'DELETE-ME'}];await f.ready();
  const value=copy(f.documents.catalogs.value);value.tints.items=[];
  const deletion={kind:'tint',ids:['DELETE-ME']};
  await assert.rejects(f.adapter.saveCatalogs(value,{deletion}));
  await f.adapter.retryPending();
  assert.equal(f.puts().length,2);
  for(const req of f.puts()){assert.deepEqual(req.body.deletion,deletion);assert.equal(req.body.revision,0);}
  assert.equal(f.adapter.pendingOptions.size,0);
});

function mysqlFixture(intercept = () => undefined) {
  const requests = [], statuses = [], localCalls = [];
  const documents = {
    state: { value: { revisionLabel: 'initial' }, revision: 0 },
    saved: { value: [], revision: 0 },
    skus: { value: { schema: 'trl-sku-catalog/1.0', skus: [] }, revision: 0 },
    catalogs: { value: { tints: { items: [] }, materials: { products: [], blanks: [], rules: [] }, shapes: { items: [] } }, revision: 0 }
  };
  const user = { id: 1, username: 'qa-user' }, csrfToken = 'a'.repeat(64);
  const fixture = { requests, statuses, localCalls, documents, user, csrfToken, adapter: null };
  fixture.defaultRequest = request => {
    if (request.path === '/api/session' && request.method === 'GET') return response(200, { authenticated: true, user, csrfToken });
    if (request.path === '/api/session' && request.method === 'POST') return response(200, { authenticated: true, user, csrfToken });
    if (request.path === '/api/session' && request.method === 'DELETE') return response(200, { authenticated: false });
    if (request.path === '/api/bootstrap') return response(200, {
      catalogs: documents.catalogs.value, catalogRevision:documents.catalogs.revision,
      documents, user, csrfToken
    });
    if (request.path === '/api/catalogs/indices' && request.method === 'PUT') {
      const current = documents.catalogs;
      if (request.body.revision !== current.revision) return response(409, {
        error: { code: 'revision_conflict', message: 'Data changed on another device.' }, document: current
      });
      const value = copy(current.value); value.materials.indexOptions = copy(request.body.value);
      documents.catalogs = { value, revision: current.revision + 1 };
      return response(200, documents.catalogs);
    }
    const key = request.path.split('/').at(-1);
    if (!documents[key]) return response(404, { error: { code: 'not_found', message: 'Unknown fixture route' } });
    if (request.method === 'GET') return response(200, documents[key]);
    if (request.method === 'PUT') {
      if (request.body.revision !== documents[key].revision) return response(409, {
        error: { code: 'revision_conflict', message: 'Data changed on another device.' }, document: documents[key]
      });
      documents[key] = { value: copy(request.body.value), revision: request.body.revision + 1 };
      return response(200, documents[key]);
    }
    return response(405, { error: { code: 'method', message: 'Unknown fixture method' } });
  };
  fixture.adapter = new LeinzStorage({
    runtime: { mode: 'mysql', apiBase: '/api' },
    localStorage: {
      getItem(key) { localCalls.push(['get', key]); return 'browser data that must never replace MySQL'; },
      setItem(key, text) { localCalls.push(['set', key, text]); }
    },
    onStatus: value => statuses.push(copy(value)),
    fetchImpl: async (path, options = {}) => {
      const request = { path, method: options.method || 'GET', options,
        body: options.body === undefined ? undefined : JSON.parse(options.body) };
      requests.push(request);
      const overridden = await intercept(request, fixture);
      return overridden === undefined ? fixture.defaultRequest(request) : overridden;
    }
  });
  fixture.ready = async () => { await fixture.adapter.connect(); await fixture.adapter.load(); return fixture; };
  fixture.puts = () => requests.filter(request => request.method === 'PUT');
  return fixture;
}

test('adding or removing indices sends a small request behind a proxy body limit', async () => {
  const fixture = mysqlFixture(request => {
    if (Buffer.byteLength(request.options.body || '') > 1024 * 1024) return {
      ok:false, status:413, async json() { throw SyntaxError('nginx HTML response'); }
    };
  });
  fixture.documents.catalogs.value.materials.rules = [{ source:'x'.repeat(2 * 1024 * 1024) }];
  await fixture.ready();
  const initial = fixture.adapter.getCatalogs();
  const added = await fixture.adapter.saveMaterialIndices(['1.60','1.70']);
  assert.deepEqual(added.materials.indexOptions,['1.60','1.70']);
  assert.deepEqual(added.materials.rules,initial.materials.rules);
  assert.equal(fixture.adapter.getCatalogRevision(),1);
  await fixture.adapter.saveMaterialIndices(['1.60']);
  assert.deepEqual(fixture.adapter.getCatalogs().materials.indexOptions,['1.60']);
  for (const request of fixture.puts()) {
    assert.equal(request.path,'/api/catalogs/indices');
    assert(Buffer.byteLength(request.options.body)<1024);
    assert.deepEqual(Object.keys(request.body).sort(),['revision','value']);
    assert.equal(request.options.headers['X-CSRF-Token'],fixture.csrfToken);
  }
  assert.equal(fixture.adapter.getCatalogRevision(),2);
  assert.equal(fixture.adapter.status().pending,false);
  assert.deepEqual(fixture.localCalls,[]);
});

test('index retries retain the compact endpoint and reconcile a lost acknowledgement',async()=>{
  let offline=true,loseAck=false;
  const fixture=await mysqlFixture((request,context)=>{
    if(request.path==='/api/catalogs/indices'&&request.method==='PUT') {
      if(offline)throw TypeError('Offline');
      if(loseAck){loseAck=false;context.defaultRequest(request);throw TypeError('Lost response after commit');}
    }
  }).ready();
  await assert.rejects(fixture.adapter.saveMaterialIndices(['1.60','1.70']),e=>e.code==='NETWORK_ERROR');
  assert.equal(fixture.adapter.status().pending,true);assert.equal(fixture.adapter.getCatalogRevision(),0);
  offline=false;loseAck=true;
  await fixture.adapter.retryPending();
  assert.equal(fixture.adapter.getCatalogRevision(),1);
  assert.deepEqual(fixture.adapter.getCatalogs().materials.indexOptions,['1.60','1.70']);
  assert.equal(fixture.adapter.status().pending,false);
  assert.equal(fixture.puts().length,2);
  for(const request of fixture.puts()){assert.equal(request.path,'/api/catalogs/indices');assert(Array.isArray(request.body.value));}
});

test('index conflicts load the current full catalog without overwriting another edit',async()=>{
  const fixture=await mysqlFixture().ready();
  fixture.documents.catalogs.value.tints.items.push({code:'OTHER-EDIT'});
  fixture.documents.catalogs.revision++;
  await assert.rejects(fixture.adapter.saveMaterialIndices(['1.60','1.70']),e=>e.status===409);
  assert.equal(fixture.adapter.getCatalogRevision(),1);
  assert.equal(fixture.adapter.getCatalogs().tints.items[0].code,'OTHER-EDIT');
  assert.equal(fixture.adapter.status().conflict,true);
  assert.equal(fixture.documents.catalogs.value.materials.indexOptions,undefined);
});

test('a proxy HTML 413 is reported explicitly without a misleading JSON error',async()=>{
  const fixture=await mysqlFixture(request=>request.method==='PUT'?{
    ok:false,status:413,async json(){throw SyntaxError('nginx HTML');}
  }:undefined).ready();
  const value=fixture.adapter.getCatalogs();value.tints.items.push({code:'EDIT'});
  await assert.rejects(fixture.adapter.saveCatalogs(value),e=>e.status===413&&e.code==='BODY_TOO_LARGE'&&/413/.test(e.message));
  assert.equal(fixture.puts().length,1);
  assert.equal(fixture.adapter.getCatalogRevision(),0);
  assert.equal(fixture.adapter.status().pending,true);
});

test('master catalogs use the dedicated atomic endpoint and acknowledged revision', async () => {
  const fixture = await mysqlFixture().ready();
  const value=fixture.adapter.getCatalogs(); value.tints.items.push({code:'QA'});
  const result=await fixture.adapter.saveCatalogs(value);
  assert.deepEqual(result,value);
  assert.equal(fixture.puts()[0].path,'/api/catalogs');
  assert.equal(fixture.puts()[0].body.revision,0);
  assert.equal(fixture.adapter.getCatalogRevision(),1);
  result.tints.items.push({code:'MUTATED'});
  assert.deepEqual(fixture.adapter.getCatalogs(),value,'Caller cannot mutate acknowledged cache.');
});

test('master catalog response lost after commit reconciles without duplicate writes',async()=>{
  const fixture=await mysqlFixture((request,context)=>{
    if(request.path==='/api/catalogs'&&request.method==='PUT'){context.defaultRequest(request);throw TypeError('Lost acknowledgement');}
  }).ready();
  const value=fixture.adapter.getCatalogs();value.shapes.items.push({code:'new'});
  await fixture.adapter.saveCatalogs(value);
  assert.equal(fixture.puts().length,1);
  assert.equal(fixture.adapter.status().pending,false);
  assert.equal(fixture.adapter.getCatalogRevision(),1);
});

test('stale master update keeps remote data and blocks an automatic overwrite',async()=>{
  const fixture=await mysqlFixture().ready();
  const requested=fixture.adapter.getCatalogs();requested.tints.items.push({code:'LOCAL'});
  fixture.documents.catalogs={value:{...fixture.adapter.getCatalogs(),shapes:{items:[{code:'REMOTE'}]}},revision:1};
  await assert.rejects(fixture.adapter.saveCatalogs(requested),e=>e.status===409);
  assert.equal(fixture.adapter.getCatalogs().shapes.items[0].code,'REMOTE');
  assert.equal(fixture.adapter.status().pending,true);
  assert.equal(fixture.adapter.status().conflict,true);
  await assert.rejects(fixture.adapter.refreshCatalogs(),e=>e.code==='PENDING_WRITES');
  await assert.rejects(fixture.adapter.retryPending(),e=>e.status===409);
  assert.equal(fixture.puts().length,1);
});

test('catalog refresh reads current MySQL revision without touching browser storage',async()=>{
  const fixture=await mysqlFixture().ready();
  fixture.documents.catalogs.value.materials.products=[{id:'REMOTE'}];fixture.documents.catalogs.revision=4;
  const value=await fixture.adapter.refreshCatalogs();
  assert.equal(value.materials.products[0].id,'REMOTE');
  assert.equal(fixture.adapter.getCatalogRevision(),4);
  assert.deepEqual(fixture.localCalls,[]);
});

test('missing catalog revision fails initialization instead of using an unguarded write',async()=>{
  const fixture=mysqlFixture((request,context)=>{
    if(request.path==='/api/bootstrap')return response(200,{catalogs:{},documents:context.documents,user:context.user,csrfToken:context.csrfToken});
  });
  await fixture.adapter.connect();
  await assert.rejects(fixture.adapter.load(),e=>e.code==='INVALID_RESPONSE');
  assert.equal(fixture.adapter.loaded,false);
});

test('browser managed catalogs survive reload and stale tabs cannot overwrite a new master',async()=>{
  const values=new Map();
  const options={runtime:{mode:'browser'},localStorage:{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)},
    fetchImpl:async()=>response(200,{items:[]})};
  const one=new LeinzStorage(options),two=new LeinzStorage(options);
  await one.load();await two.load();
  const value=one.getCatalogs();value.tints.items=[{code:'NEW'}];
  await one.saveCatalogs(value);
  assert.deepEqual(JSON.parse(values.get(CATALOGS)),value);
  await assert.rejects(two.saveCatalogs(two.getCatalogs()),e=>e.code==='CONFLICT');
  await two.refreshCatalogs();
  assert.deepEqual(two.getCatalogs(),value);
  const three=new LeinzStorage(options);assert.deepEqual(await three.load(),value);
});

test('runtime mode must be explicit and API addresses cannot point to a different origin', () => {
  assert.throws(() => new LeinzStorage(), error => error.code === 'RUNTIME_MISSING');
  assert.throws(() => new LeinzStorage({ runtime: { mode: 'automatic' } }), error => error.code === 'RUNTIME_MISSING');
  assert.throws(() => new LeinzStorage({ runtime: { mode: 'mysql', apiBase: 'https://example.test/api' } }), error => error.code === 'RUNTIME_INVALID');
});

test('queued writes are serialized by document and use the last acknowledged revision', async () => {
  const entered = deferred(), release = deferred(); let first = true;
  const fixture = await mysqlFixture(async (request, context) => {
    if (request.method === 'PUT' && first) { first = false; entered.resolve(); await release.promise; return context.defaultRequest(request); }
  }).ready();
  const { adapter } = fixture;
  const initial = adapter.getItem(STATE);
  const firstWrite = adapter.setItem(STATE, JSON.stringify({ revisionLabel: 'first' }));
  const secondWrite = adapter.setItem(STATE, JSON.stringify({ revisionLabel: 'second' }));
  await entered.promise;
  assert.equal(fixture.puts().length, 1);
  assert.equal(adapter.getItem(STATE), initial, 'An unacknowledged write must not replace the durable cache.');
  assert.equal(adapter.status().saving, true);
  assert.equal(adapter.status().pending, true);
  release.resolve(); await Promise.all([firstWrite, secondWrite]);
  assert.deepEqual(fixture.puts().map(request => request.body.revision), [0, 1]);
  assert.deepEqual(fixture.puts().map(request => request.body.value.revisionLabel), ['first', 'second']);
  assert.deepEqual(JSON.parse(adapter.getItem(STATE)), { revisionLabel: 'second' });
  assert.equal(fixture.documents.state.revision, 2);
  assert.equal(adapter.status().pending, false);
  assert.equal(adapter.status().saving, false);
  assert.deepEqual(fixture.localCalls, []);
  for (const request of fixture.puts()) {
    assert.equal(request.options.credentials, 'same-origin');
    assert.equal(request.options.headers['X-CSRF-Token'], fixture.csrfToken);
  }
});

test('unconfirmed network failure rejects, preserves pending work, and never falls back to browser storage', async () => {
  const fixture = await mysqlFixture(request => {
    if (request.path === '/api/documents/state') throw TypeError('Disconnected network');
  }).ready();
  const initial = fixture.adapter.getItem(STATE), requested = JSON.stringify({ revisionLabel: 'unsaved' });
  await assert.rejects(fixture.adapter.setItem(STATE, requested), error => error.code === 'NETWORK_ERROR');
  assert.equal(fixture.adapter.getItem(STATE), initial);
  assert.equal(fixture.adapter.pending.get(STATE), requested);
  assert.equal(fixture.adapter.status().pending, true);
  assert.match(fixture.adapter.status().message, /belum dikonfirmasi tersimpan/);
  assert.equal(fixture.adapter.status().saving, false);
  assert.deepEqual(fixture.localCalls, []);
  await assert.rejects(fixture.adapter.flush());
});

test('lost state acknowledgement is reconciled through one read without a duplicate write', async () => {
  const fixture = await mysqlFixture((request, context) => {
    if (request.method === 'PUT') { context.defaultRequest(request); throw TypeError('Reply lost after commit'); }
  }).ready();
  const value = { revisionLabel: 'committed-before-response-loss' };
  await fixture.adapter.setItem(STATE, JSON.stringify(value));
  assert.deepEqual(JSON.parse(fixture.adapter.getItem(STATE)), value);
  assert.equal(fixture.puts().length, 1);
  assert.equal(fixture.requests.filter(request => request.path === '/api/documents/state' && request.method === 'GET').length, 1);
  assert.equal(fixture.adapter.status().pending, false);
  assert.equal(fixture.adapter.status().conflict, false);
});

test('lost SKU acknowledgement tolerates canonical server metadata while retaining returned JSON', async () => {
  const fixture = await mysqlFixture((request, context) => {
    if (request.method === 'PUT') {
      const accepted = copy(request.body.value);
      context.documents.skus = { value: {
        skus: accepted.skus, schema: accepted.schema, updatedAt: '2026-11-03T07:00:01.000Z',
        sourceFile: 'DMO UNV OSA(1).csv', sourceSha256: 'canonical-catalog-hash', availabilityMeaning: 'catalog-assignment-not-live-stock'
      }, revision: request.body.revision + 1 };
      throw TypeError('Reply lost after normalized SKU commit');
    }
  }).ready();
  const value = { schema: 'trl-sku-catalog/1.0', updatedAt: '2026-11-03T07:00:00.000Z', skus: [{ id: 'sku-qa', code: 'QA', name: 'Acknowledged product' }] };
  await fixture.adapter.setItem(SKUS, JSON.stringify(value));
  assert.deepEqual(JSON.parse(fixture.adapter.getItem(SKUS)), fixture.documents.skus.value);
  assert.equal(fixture.puts().length, 1);
  assert.equal(fixture.adapter.status().pending, false);
  assert.equal(fixture.adapter.status().conflict, false);
});

test('a conflict adopts the remote revision, preserves the pending draft, and blocks automatic overwrites', async () => {
  const fixture = await mysqlFixture().ready();
  fixture.documents.state = { value: { revisionLabel: 'other-device' }, revision: 3 };
  const value = JSON.stringify({ revisionLabel: 'my-draft' });
  await assert.rejects(fixture.adapter.setItem(STATE, value), error => error.status === 409);
  assert.deepEqual(JSON.parse(fixture.adapter.getItem(STATE)), fixture.documents.state.value);
  assert.equal(fixture.adapter.pending.get(STATE), value);
  assert.equal(fixture.adapter.status().conflict, true);
  const requests = fixture.puts().length;
  await assert.rejects(fixture.adapter.retryPending(), error => error.status === 409);
  assert.equal(fixture.puts().length, requests, 'Retry must not silently overwrite a known conflict.');
});

test('an ambiguous lost acknowledgement becomes a conflict if a different value advanced the revision', async () => {
  const fixture = await mysqlFixture((request, context) => {
    if (request.method === 'PUT') {
      context.documents.state = { value: { revisionLabel: 'different-server-value' }, revision: 1 };
      throw TypeError('Reply lost');
    }
  }).ready();
  await assert.rejects(fixture.adapter.setItem(STATE, JSON.stringify({ revisionLabel: 'mine' })), error => error.status === 409);
  assert.deepEqual(JSON.parse(fixture.adapter.getItem(STATE)), { revisionLabel: 'different-server-value' });
  assert.equal(fixture.adapter.status().conflict, true);
});

test('401 expires the session, blocks further writes, and allows same-account recovery', async () => {
  let rejectWrite = true;
  const fixture = await mysqlFixture(request => {
    if (request.method === 'PUT' && rejectWrite) return response(401, { error: { code: 'authentication_required', message: 'Session expired' } });
  }).ready();
  const value = JSON.stringify({ revisionLabel: 'recover-after-login' });
  await assert.rejects(fixture.adapter.setItem(STATE, value), error => error.status === 401);
  assert.equal(fixture.adapter.authenticated, false);
  const count = fixture.puts().length;
  await assert.rejects(fixture.adapter.setItem(STATE, value), error => error.code === 'AUTH_REQUIRED');
  assert.equal(fixture.puts().length, count);
  rejectWrite = false;
  await fixture.adapter.login('qa-user', 'test-password');
  await fixture.adapter.retryPending();
  assert.deepEqual(JSON.parse(fixture.adapter.getItem(STATE)), JSON.parse(value));
  assert.equal(fixture.adapter.status().pending, false);
});

test('a different-account login with failed logout cannot retain credentials or submit the old account draft', async () => {
  const fixture = await mysqlFixture(request => {
    if (request.path === '/api/session' && request.method === 'POST') return response(200, {
      authenticated: true, user: { id: 2, username: 'different-user' }, csrfToken: 'b'.repeat(64)
    });
    if (request.path === '/api/session' && request.method === 'DELETE') throw TypeError('Logout connection failed');
  }).ready();
  const old = fixture.adapter.getItem(STATE);
  fixture.adapter.authenticated = false;
  await assert.rejects(fixture.adapter.login('different-user', 'test-password'), error => error.code === 'ACCOUNT_CHANGED');
  assert.equal(fixture.adapter.authenticated, false);
  assert.equal(fixture.adapter.csrfToken, null);
  assert.equal(fixture.adapter.user.id, 1);
  assert.equal(fixture.adapter.getItem(STATE), old);
  await assert.rejects(fixture.adapter.setItem(STATE, JSON.stringify({ revisionLabel: 'old-user-work' })), error => error.code === 'AUTH_REQUIRED');
  assert.equal(fixture.puts().length, 0);
});

test('retry submits only the latest pending content after a network outage', async () => {
  let offline = true;
  const fixture = await mysqlFixture(request => {
    if (request.path.startsWith('/api/documents/') && offline) throw TypeError('Offline');
  }).ready();
  await assert.rejects(fixture.adapter.setItem(STATE, JSON.stringify({ revisionLabel: 'earlier-draft' })));
  await assert.rejects(fixture.adapter.setItem(STATE, JSON.stringify({ revisionLabel: 'latest-draft' })));
  offline = false;
  await fixture.adapter.retryPending();
  assert.deepEqual(fixture.documents.state.value, { revisionLabel: 'latest-draft' });
  assert.equal(fixture.documents.state.revision, 1);
  assert.equal(fixture.adapter.status().pending, false);
});

test('logout is refused while writes remain unconfirmed and does not clear cached work', async () => {
  const fixture = await mysqlFixture(request => {
    if (request.path.startsWith('/api/documents/')) throw TypeError('Offline');
  }).ready();
  await assert.rejects(fixture.adapter.setItem(STATE, JSON.stringify({ revisionLabel: 'unsaved' })));
  await assert.rejects(fixture.adapter.logout());
  assert.equal(fixture.requests.some(request => request.method === 'DELETE'), false);
  assert.equal(fixture.adapter.loaded, true);
  assert.equal(fixture.adapter.user.id, 1);
  assert.equal(fixture.adapter.status().pending, true);
});

test('unchanged content does not increment the database revision and invalid JSON is never submitted', async () => {
  const fixture = await mysqlFixture().ready();
  await fixture.adapter.setItem(STATE, fixture.adapter.getItem(STATE));
  assert.equal(fixture.puts().length, 0);
  await assert.rejects(fixture.adapter.setItem(STATE, '{bad-json'), error => error.code === 'INVALID_JSON');
  await assert.rejects(fixture.adapter.setItem('unknown-key', '{}'), error => error.code === 'INVALID_KEY');
  assert.equal(fixture.puts().length, 0);
  assert.equal(fixture.adapter.status().pending, false);
});

test('malformed server revisions stop bootstrap and cannot be replaced by local data', async () => {
  const fixture = mysqlFixture(request => {
    if (request.path === '/api/bootstrap') return response(200, {
      catalogs: {}, documents: { state: { value: {}, revision: '1' } }, user: { id: 1 }, csrfToken: 'a'.repeat(64)
    });
  });
  await fixture.adapter.connect();
  await assert.rejects(fixture.adapter.load(), error => error.code === 'INVALID_RESPONSE');
  assert.equal(fixture.adapter.loaded, false);
  assert.deepEqual(fixture.localCalls, []);
});

test('browser mode reads and writes its injected local storage without making database requests', async () => {
  const values = new Map(), requests = [];
  const adapter = new LeinzStorage({ runtime: { mode: 'browser' },
    localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
    fetchImpl: async path => { requests.push(path); return response(200, { items: [] }); }
  });
  await adapter.connect();
  await adapter.setItem(STATE, '{"local":true}');
  assert.equal(adapter.getItem(STATE), '{"local":true}');
  assert.deepEqual(requests, []);
  await adapter.load();
  assert.deepEqual(requests.sort(), ['assets/materials.json', 'assets/shapes.json', 'assets/tints.json']);
  assert.equal(adapter.mode, 'browser');
});

test('browser quota and read errors are observable and cannot be reported as successful persistence', async () => {
  const adapter = new LeinzStorage({ runtime: { mode: 'browser' },
    localStorage: {
      getItem() { throw Error('Read access denied'); },
      setItem() { throw Error('Quota exceeded'); }
    }, fetchImpl: async () => { throw Error('Unexpected network access'); }
  });
  assert.throws(() => adapter.getItem(STATE), /Read access denied/);
  await assert.rejects(adapter.setItem(STATE, '{}'), /Quota exceeded/);
  assert.match(adapter.status().message, /Quota exceeded/);
});

test('different document queues remain independent while a state write is awaiting acknowledgement', async () => {
  const entered = deferred(), release = deferred();
  const fixture = await mysqlFixture(async (request, context) => {
    if (request.path === '/api/documents/state' && request.method === 'PUT') {
      entered.resolve(); await release.promise; return context.defaultRequest(request);
    }
  }).ready();
  const stateWrite = fixture.adapter.setItem(STATE, JSON.stringify({ revisionLabel: 'pending-state' }));
  await entered.promise;
  await fixture.adapter.setItem(SAVED, JSON.stringify([{ id: 'independent-history-write' }]));
  assert.equal(fixture.documents.saved.revision, 1);
  assert.equal(fixture.documents.state.revision, 0);
  release.resolve(); await stateWrite;
  await fixture.adapter.flush();
  assert.equal(fixture.adapter.status().pending, false);
});
