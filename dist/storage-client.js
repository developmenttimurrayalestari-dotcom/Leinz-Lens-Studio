/* Explicit browser/MySQL persistence. A failed server never falls back to localStorage. */
(function (global) {
  'use strict';
  const CATALOG_KEY = 'leinz-master-catalogs-v1';
  const KEYS = Object.freeze({
    'leinz-lens-studio-state-v1': 'state',
    'leinz-lens-studio-saved-v1': 'saved',
    'leinz-sku-catalog-v1': 'skus',
    [CATALOG_KEY]: 'catalogs'
  });
  const error = (message, code, status = 0, document = null) => Object.assign(new Error(message), {code, status, document});
  const encode = value => value === null || value === undefined ? null : JSON.stringify(value);
  const equal = (left, right) => {
    if (left === right) return true;
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
    if (Array.isArray(left) !== Array.isArray(right)) return false;
    const a = Object.keys(left).sort(), b = Object.keys(right).sort();
    return a.length === b.length && a.every((key, i) => key === b[i] && equal(left[key], right[key]));
  };
  class LeinzStorage {
    constructor({runtime, fetchImpl, localStorage, onStatus = () => {}, timeoutMs = 15000} = {}) {
      if (!runtime || !['browser','mysql'].includes(runtime.mode)) throw error('Konfigurasi penyimpanan belum dapat dimuat. Muat ulang halaman.', 'RUNTIME_MISSING');
      this.mode = runtime.mode;
      this.apiBase = runtime.apiBase || '/api';
      if (!/^\/[A-Za-z0-9/_-]+$/.test(this.apiBase)) throw error('Alamat API tidak valid.', 'RUNTIME_INVALID');
      this.fetch = fetchImpl || global.fetch?.bind(global);
      try { this.local = localStorage || global.localStorage; } catch { this.local = null; }
      this.onStatus = onStatus; this.timeoutMs = timeoutMs;
      this.documents = new Map(); this.queues = new Map(); this.pending = new Map(); this.pendingOptions = new Map();
      this.failures = new Map(); this.conflicts = new Set(); this.inflight = 0;
      this.user = null; this.csrfToken = null; this.authenticated = this.mode === 'browser';
      this.loaded = false; this.catalogs = null; this.baseCatalogs = null;
    }
    status() {
      return {mode:this.mode, user:this.user, authenticated:this.authenticated,
        saving:this.inflight > 0, pending:this.pending.size > 0,
        conflict:this.conflicts.size > 0, message:[...this.failures.values()][0]?.message || ''};
    }
    _emit() { this.onStatus(this.status()); }
    async _request(path, {method = 'GET', body, csrf = true} = {}) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const headers = {'Accept':'application/json'};
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        if (method !== 'GET' && csrf && this.csrfToken) headers['X-CSRF-Token'] = this.csrfToken;
        const response = await this.fetch(this.apiBase + path, {method, headers,
          credentials:'same-origin', cache:'no-store', signal:controller.signal,
          ...(body === undefined ? {} : {body:JSON.stringify(body)})});
        if (response.status === 413) throw error('Permintaan terlalu besar untuk server (HTTP 413). Periksa batas ukuran permintaan pada reverse proxy.', 'BODY_TOO_LARGE', 413);
        let payload;
        try { payload = await response.json(); }
        catch { throw error('Respons server tidak valid. Periksa layanan aplikasi.', 'INVALID_RESPONSE', response.status); }
        if (!response.ok) {
          if (response.status === 401) { this.authenticated = false; this._emit(); }
          throw error(payload?.error?.message || 'Permintaan belum berhasil.', payload?.error?.code || 'HTTP_ERROR', response.status, payload?.document || null);
        }
        return payload;
      } catch (e) {
        if (typeof e.code === 'string' && typeof e.status === 'number') throw e;
        throw error(e.name === 'AbortError' ? 'Server belum merespons. Perubahan belum dikonfirmasi tersimpan.' : 'Server tidak dapat dihubungi. Perubahan belum dikonfirmasi tersimpan.', 'NETWORK_ERROR');
      } finally { clearTimeout(timer); }
    }
    async connect() {
      if (this.mode === 'browser') { this._emit(); return {authenticated:true}; }
      const session = await this._request('/session');
      this.authenticated = session.authenticated === true;
      this.user = session.user || null; this.csrfToken = session.csrfToken || null;
      this._emit(); return session;
    }
    async listUsers() { return this._request('/users'); }
    async saveUser(id, value) { return this._request('/users'+(id?'/'+id:''), {method:id?'PUT':'POST',body:value}); }
    async login(username, password) {
      const previousUser = this.loaded ? this.user?.id : null;
      const session = await this._request('/session', {method:'POST', body:{username,password}, csrf:false});
      if (!session.authenticated || !session.user || !session.csrfToken) throw error('Respons login tidak lengkap.', 'INVALID_RESPONSE');
      this.csrfToken = session.csrfToken;
      if (previousUser !== null && String(session.user.id) !== String(previousUser)) {
        this.authenticated = false;
        try { await this._request('/session', {method:'DELETE'}); }
        catch { /* Never retain the other account's CSRF credentials on failure. */ }
        finally { this.csrfToken = null; this._emit(); }
        throw error('Masuk kembali dengan akun yang sama untuk menyimpan perubahan yang tertunda.', 'ACCOUNT_CHANGED');
      }
      this.user = session.user; this.authenticated = true; this._emit();
      return session;
    }
    _accept(key, doc) {
      if (!doc || !Number.isSafeInteger(doc.revision) || doc.revision < 0 || !Object.hasOwn(doc, 'value')) throw error('Revisi data server tidak valid.', 'INVALID_RESPONSE');
      this.documents.set(key, {value:doc.value, text:encode(doc.value), revision:doc.revision});
      if (key === CATALOG_KEY) this.catalogs = doc.value;
    }
    _documentPath(key) { return key === CATALOG_KEY ? '/catalogs' : '/documents/' + KEYS[key]; }
    _sameValue(key, left, right) {
      if (KEYS[key] === 'skus' && left && right) return left.schema === right.schema && equal(left.skus,right.skus);
      return equal(left,right);
    }
    async load() {
      if (this.mode === 'browser') {
        const names = ['tints','materials','shapes'];
        const values = await Promise.all(names.map(async name => {
          const r = await this.fetch('assets/' + name + '.json');
          if (!r.ok) throw error('Katalog ' + name + ' belum dapat dibaca.', 'CATALOG_MISSING');
          return r.json();
        }));
        this.baseCatalogs = Object.fromEntries(names.map((name,i) => [name,values[i]]));
        let text;
        try { text = this.local?.getItem(CATALOG_KEY); }
        catch { throw error('Master browser belum dapat dibaca. Periksa izin penyimpanan browser.', 'LOCAL_STORAGE'); }
        try { this.catalogs = text ? JSON.parse(text) : this.baseCatalogs; }
        catch { throw error('Master browser rusak. Pulihkan ekspor JSON sebelum melanjutkan.', 'INVALID_CATALOGS'); }
        this.loaded = true; this._emit();
        return this.getCatalogs();
      }
      const bootstrap = await this._request('/bootstrap');
      if (!bootstrap.catalogs || !bootstrap.documents || !bootstrap.user || !bootstrap.csrfToken) throw error('Data awal server belum lengkap.', 'INVALID_RESPONSE');
      for (const [key, name] of Object.entries(KEYS)) if (key !== CATALOG_KEY) this._accept(key, bootstrap.documents[name]);
      this._accept(CATALOG_KEY, {value:bootstrap.catalogs, revision:bootstrap.catalogRevision});
      this.user = bootstrap.user; this.csrfToken = bootstrap.csrfToken;
      this.authenticated = true; this.loaded = true; this._emit();
      return this.getCatalogs();
    }
    getCatalogs() { return this.catalogs === null ? null : JSON.parse(JSON.stringify(this.catalogs)); }
    getCatalogRevision() { return this.mode === 'mysql' ? this.documents.get(CATALOG_KEY)?.revision ?? null : null; }
    async saveMaterialIndices(indices) {
      if (!this.loaded) throw error('Master belum dimuat.', 'NOT_INITIALIZED');
      const value = this.getCatalogs();
      value.materials.indexOptions = indices;
      return this.saveCatalogs(value, { materialIndices: true });
    }
    async saveCatalogs(value,options = {}) {
      if (!this.loaded) throw error('Master belum dimuat.', 'NOT_INITIALIZED');
      if (this.mode === 'browser') {
        let current;
        try { const text = this.local?.getItem(CATALOG_KEY); current = text ? JSON.parse(text) : this.baseCatalogs; }
        catch { throw error('Master browser belum dapat dibaca; penyimpanan dibatalkan.', 'LOCAL_STORAGE'); }
        if (!equal(current,this.catalogs)) throw error('Master berubah pada tab lain. Muat master terbaru sebelum menyimpan.', 'CONFLICT',409);
      }
      await this.setItem(CATALOG_KEY,JSON.stringify(value),options);
      if (this.mode === 'browser') this.catalogs = JSON.parse(this.getItem(CATALOG_KEY));
      return this.getCatalogs();
    }
    async refreshCatalogs() {
      if (this.pending.has(CATALOG_KEY)) throw error('Masih ada perubahan master tertunda. Selesaikan penyimpanan atau muat ulang halaman dengan meninjau draft terlebih dahulu.', 'PENDING_WRITES');
      if (this.mode === 'mysql') this._accept(CATALOG_KEY,await this._request('/catalogs'));
      else {
        try { const text = this.local?.getItem(CATALOG_KEY); this.catalogs = text ? JSON.parse(text) : this.baseCatalogs; }
        catch { throw error('Master browser belum dapat dibaca.', 'INVALID_CATALOGS'); }
      }
      return this.getCatalogs();
    }
    getItem(key) {
      if (this.mode === 'browser') return this.local?.getItem(key) ?? null;
      if (!Object.hasOwn(KEYS,key)) throw error('Jenis data tidak dikenal.', 'INVALID_KEY');
      return this.documents.get(key)?.text ?? null;
    }
    setItem(key, text, options = {}) {
      if (this.mode === 'browser') {
        try {
          if (!this.local) throw error('Penyimpanan browser tidak tersedia. Gunakan ekspor JSON.', 'LOCAL_STORAGE');
          this.local.setItem(key,text); this.failures.delete(key); this._emit();
          return Promise.resolve();
        } catch (e) { this.failures.set(key,e); this._emit(); return Promise.reject(e); }
      }
      if (!Object.hasOwn(KEYS,key)) return Promise.reject(error('Jenis data tidak dikenal.', 'INVALID_KEY'));
      let value;
      try { value = JSON.parse(text); } catch { return Promise.reject(error('Data belum berupa JSON yang valid.', 'INVALID_JSON')); }
      const canonical = JSON.stringify(value);
      this.pending.set(key,canonical); this.pendingOptions.set(key,options); this._emit();
      const job = (this.queues.get(key) || Promise.resolve()).catch(() => {}).then(async () => {
        this.inflight++; this._emit();
        try {
          if (!this.authenticated || !this.csrfToken) throw error('Sesi telah berakhir. Masuk kembali untuk menyimpan perubahan.', 'AUTH_REQUIRED', 401);
          if (this.conflicts.has(key)) throw error('Data telah berubah di sesi lain. Ekspor perubahan Anda lalu muat ulang data terbaru.', 'CONFLICT', 409);
          const current = this.documents.get(key);
          if (!current) throw error('Data server belum dimuat.', 'NOT_INITIALIZED');
          if (!this._sameValue(key,current.value,value)) {
            let saved;
            const indicesOnly = key === CATALOG_KEY && options.materialIndices === true;
            try { saved = await this._request(indicesOnly ? '/catalogs/indices' : this._documentPath(key), {method:'PUT',body:{value:indicesOnly ? value.materials.indexOptions : value,revision:current.revision,...(options.deletion?{deletion:options.deletion}:{})}}); }
            catch (e) {
              // A lost HTTP acknowledgement may still mean the transaction committed.
              // A read can confirm exactly that value without issuing another write.
              if (e.code === 'NETWORK_ERROR' || e.code === 'INVALID_RESPONSE') {
                try {
                  const actual = await this._request(this._documentPath(key));
                  if (this._sameValue(key,actual.value,value)) saved = actual;
                  else if (actual.revision !== current.revision) e = error('Data telah berubah di sesi lain. Muat ulang sebelum menyimpan.', 'CONFLICT', 409, actual);
                } catch { /* Retain the original failure and the pending draft. */ }
              }
              if (!saved) {
                if (e.status === 409) {
                  if (e.document) this._accept(key,e.document);
                  this.conflicts.add(key);
                }
                throw e;
              }
            }
            this._accept(key,saved);
          }
          if (this.pending.get(key) === canonical) {this.pending.delete(key);this.pendingOptions.delete(key);}
          this.failures.delete(key);
        } catch (e) { this.failures.set(key,e); throw e; }
        finally { this.inflight--; this._emit(); }
      });
      this.queues.set(key,job);
      // Retain rejection for the caller while preventing an unhandled queue rejection.
      job.catch(() => {});
      return job;
    }
    async retryPending() {
      await this.flush(false);
      const writes = [...this.pending].map(([key,text]) => this.setItem(key,text,this.pendingOptions.get(key)||{}));
      const results = await Promise.allSettled(writes);
      const failed = results.find(r => r.status === 'rejected');
      if (failed) throw failed.reason;
    }
    async flush(throwOnError = true) {
      const results = await Promise.allSettled([...this.queues.values()]);
      const failed = results.find(r => r.status === 'rejected');
      if (throwOnError && failed) throw failed.reason;
      if (throwOnError && this.pending.size) throw error('Masih ada perubahan yang belum tersimpan.', 'PENDING_WRITES');
    }
    async logout() {
      await this.flush();
      await this._request('/session', {method:'DELETE'});
      this.documents.clear(); this.csrfToken = null; this.user = null;
      this.authenticated = false; this.loaded = false; this.catalogs = null; this._emit();
    }
  }
  LeinzStorage.KEYS = KEYS;
  LeinzStorage.CATALOG_KEY = CATALOG_KEY;
  global.LeinzStorage = LeinzStorage;
  if (typeof module !== 'undefined' && module.exports) module.exports = {LeinzStorage, equal};
})(typeof window !== 'undefined' ? window : globalThis);
