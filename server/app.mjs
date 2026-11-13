import { createServer } from 'node:http';
import { readFile, stat, realpath } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { APP_VERSION, PROJECT_ROOT } from './config.mjs';
import { AppError } from './errors.mjs';
import { username, validatePassword, validateRole, verifyPassword, readSessionToken, sessionCookie, equalSecret, LoginLimiter } from './auth.mjs';
import { isObject, checkJson } from './validation.mjs';

const TYPES = { '.csv': 'text/csv; charset=utf-8', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.txt': 'text/plain; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
function sendJson(res, status, value, headers = {}) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', ...headers }); res.end(body);
}
function readBody(req, limit) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw new AppError(415, 'content_type', 'Gunakan Content-Type application/json.');
  return new Promise((resolveBody, reject) => {
    const chunks = []; let size = 0, settled = false;
    const fail = error => { if (settled) return; settled = true; chunks.length = 0; reject(error); };
    req.on('data', chunk => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) { fail(new AppError(413, 'body_too_large', 'Data permintaan melebihi batas ukuran.')); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!isObject(value)) throw new AppError(400, 'invalid_json', 'Permintaan JSON harus berupa objek.');
        checkJson(value); settled = true; resolveBody(value);
      } catch (error) { fail(error instanceof AppError ? error : new AppError(400, 'invalid_json', 'JSON permintaan tidak valid.')); }
    });
    req.on('error', () => fail(new AppError(400, 'request_aborted', 'Permintaan terputus.')));
    req.on('aborted', () => fail(new AppError(400, 'request_aborted', 'Permintaan terputus.')));
  });
}

export function createApp({ store, config, logger = console }) {
  const limiter = new LoginLimiter(), staticRoot = resolve(PROJECT_ROOT, 'dist');
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'");
    try {
      let pathname;
      try {
        if (!req.url.startsWith('/')) throw Error('Only origin-form request paths are accepted.');
        pathname = decodeURIComponent(new URL(req.url.replace(/^\/+/, '/'), config.origin).pathname).replace(/\/{2,}/g, '/');
      } catch { throw new AppError(400, 'bad_path', 'Alamat permintaan tidak valid.'); }
      if (pathname.includes('\0') || pathname.includes('\\')) throw new AppError(400, 'bad_path', 'Alamat permintaan tidak valid.');
      const mutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
      if (mutation && req.headers.origin !== config.origin) throw new AppError(403, 'origin', 'Origin permintaan berbeda dari APP_URL server. Buka alamat aplikasi yang dikonfigurasi.');
      const token = readSessionToken(req.headers.cookie);
      let sessionLoaded = false, currentSession = null;
      const session = async () => {
        if (!sessionLoaded) { currentSession = await store.getSession(token); sessionLoaded = true; }
        return currentSession;
      };
      const requireSession = async () => {
        const value = await session();
        if (!value) throw new AppError(401, 'authentication_required', 'Sesi berakhir. Masuk kembali untuk mengakses database.');
        return value;
      };
      const requireCsrf = async () => {
        const value = await requireSession();
        if (!equalSecret(req.headers['x-csrf-token'], value.csrfToken)) throw new AppError(403, 'csrf', 'Token keamanan tidak valid. Muat ulang aplikasi dan coba kembali.');
        return value;
      };
      const requireAdministrator = async () => {
        const current = await requireSession();
        if (current.user.role !== 'administrator') throw new AppError(403, 'administrator_required', 'Menu Manage hanya dapat diakses administrator.');
        return current;
      };
      if (pathname === '/api/health' && req.method === 'GET') {
        return sendJson(res, 200, { status: 'ok', version: APP_VERSION, ...(await store.health()) });
      }
      if (pathname === '/api/session') {
        if (req.method === 'GET') {
          const current = await session();
          return sendJson(res, 200, current ? { authenticated: true, ...current } : { authenticated: false });
        }
        if (req.method === 'POST') {
          const body = await readBody(req, Math.min(config.bodyLimit, 4096));
          let name;
          try { name = username(body.username); } catch { name = ''; }
          const key = `${req.socket.remoteAddress || ''}|${name}`;
          if (!limiter.check(key)) throw new AppError(429, 'login_limited', 'Terlalu banyak percobaan masuk. Coba kembali setelah 15 menit.');
          const user = name ? await store.userByName(name) : null;
          const verified = await verifyPassword(body.password, user?.password_hash);
          if (!user || !Number(user.active) || !verified) { limiter.fail(key); throw new AppError(401, 'invalid_credentials', 'Username atau password tidak sesuai.'); }
          limiter.success(key);
          const next = await store.createSession(user);
          await store.removeSession(token);
          return sendJson(res, 200, { authenticated: true, user: next.user, csrfToken: next.csrfToken }, { 'Set-Cookie': sessionCookie(next.token, config) });
        }
        if (req.method === 'DELETE') {
          await requireCsrf(); await store.removeSession(token);
          return sendJson(res, 200, { authenticated: false }, { 'Set-Cookie': sessionCookie('', config, true) });
        }
        throw new AppError(405, 'method', 'Metode permintaan tidak tersedia.');
      }
      if (pathname === '/api/bootstrap' && req.method === 'GET') {
        const current = await requireSession();
        return sendJson(res, 200, { ...(await store.bootstrap(current.user.id)), user: current.user, csrfToken: current.csrfToken });
      }
      const userPath = pathname.match(/^\/api\/users(?:\/(\d+))?$/);
      if (userPath) {
        const current = await requireAdministrator();
        if (req.method === 'GET' && !userPath[1]) return sendJson(res, 200, {users:await store.listUsers()});
        if (req.method === 'POST' && !userPath[1] || req.method === 'PUT' && userPath[1]) {
          await requireCsrf();
          const body = await readBody(req, Math.min(config.bodyLimit, 4096));
          try {
            username(body.username); validateRole(body.role);
            if (body.active !== undefined && typeof body.active !== 'boolean') throw Error('Status akun harus aktif atau nonaktif.');
            if (req.method === 'POST' || body.password !== undefined && body.password !== '') validatePassword(body.password);
          } catch (error) { throw new AppError(422, 'invalid_user', error.message); }
          const user = req.method === 'POST' ? await store.addUser(body) : await store.updateUser(Number(userPath[1]), body, current.user.id);
          return sendJson(res, req.method === 'POST' ? 201 : 200, {user});
        }
        throw new AppError(405, 'method', 'Metode permintaan tidak tersedia.');
      }
      if (pathname === '/api/catalogs') {
        await requireSession();
        if (req.method === 'GET') return sendJson(res, 200, await store.getCatalogs());
        if (req.method === 'PUT') {
          await requireAdministrator();
          await requireCsrf();
          const body = await readBody(req, config.bodyLimit);
          return sendJson(res, 200, await store.putCatalogs(body.value, body.revision, body.deletion || null));
        }
        throw new AppError(405, 'method', 'Metode permintaan tidak tersedia.');
      }
      const documentPath = pathname.match(/^\/api\/documents\/(state|saved|skus)$/);
      if (documentPath) {
        const current = await requireSession(), key = documentPath[1];
        if (req.method === 'GET') return sendJson(res, 200, await store.getDocument(current.user.id, key));
        if (req.method === 'PUT') {
          if (key === 'skus') await requireAdministrator();
          await requireCsrf();
          const body = await readBody(req, config.bodyLimit);
          return sendJson(res, 200, await store.putDocument(current.user.id, key, body.value, body.revision));
        }
        throw new AppError(405, 'method', 'Metode permintaan tidak tersedia.');
      }
      if (pathname.startsWith('/api/')) throw new AppError(404, 'not_found', 'Endpoint tidak ditemukan.');
      if (!['GET', 'HEAD'].includes(req.method)) throw new AppError(405, 'method', 'Metode permintaan tidak tersedia.');
      if (pathname === '/runtime-config.js') {
        const code = 'window.LEINZ_RUNTIME=' + JSON.stringify({ mode: 'mysql', apiBase: '/api', version: APP_VERSION }) + ';\n';
        res.writeHead(200, { 'Content-Type': TYPES['.js'], 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(code) }); return res.end(req.method === 'HEAD' ? undefined : code);
      }
      if (pathname.split('/').some(part => part.startsWith('.'))) throw new AppError(404, 'not_found', 'Berkas tidak ditemukan.');
      // Authenticated catalog downloads use the same committed MySQL master as
      // bootstrap/Manage. Never return the unedited seed file in server mode.
      const catalogAsset = pathname.match(/^\/assets\/(materials|shapes|tints)\.json$/);
      if (catalogAsset) {
        await requireSession();
        return sendJson(res, 200, (await store.getCatalogs()).value[catalogAsset[1]]);
      }
      let target = resolve(staticRoot, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!target.startsWith(staticRoot + sep)) throw new AppError(404, 'not_found', 'Berkas tidak ditemukan.');
      try { target = await realpath(target); } catch (error) { if (['ENOENT', 'ENOTDIR'].includes(error.code)) throw new AppError(404, 'not_found', 'Berkas tidak ditemukan.'); throw error; }
      if (!target.startsWith(staticRoot + sep) || !(await stat(target)).isFile()) throw new AppError(404, 'not_found', 'Berkas tidak ditemukan.');
      const type = TYPES[extname(target)];
      if (!type) throw new AppError(404, 'not_found', 'Berkas tidak ditemukan.');
      const bytes = await readFile(target);
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': bytes.length, 'Cache-Control': 'no-cache' }); res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
      if (res.headersSent || res.destroyed) return;
      if (error instanceof AppError) return sendJson(res, error.status, { error: { code: error.code, message: error.message }, ...error.extra });
      // Never send SQL, paths, credentials, or stack traces to a browser.
      logger.error?.('Permintaan gagal:', /^[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'INTERNAL_ERROR');
      sendJson(res, 503, { error: { code: 'service_unavailable', message: 'Layanan penyimpanan belum tersedia. Perubahan belum dikonfirmasi tersimpan; periksa koneksi server dan coba kembali.' } });
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  server.keepAliveTimeout = 5000;
  server.on('clientError', (_error, socket) => { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); });
  return server;
}
