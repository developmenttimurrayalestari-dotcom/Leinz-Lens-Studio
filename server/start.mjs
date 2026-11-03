import { loadConfig } from './config.mjs';
import { createPool, MysqlStore } from './db.mjs';
import { createApp } from './app.mjs';

let pool, server;
try {
  const config = loadConfig();
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const [flag, inline] = args[i].split('=', 2);
    // Managed preview may append Vite-style --strictPort. Node already fails
    // on a busy port instead of silently selecting another one.
    if (flag === '--strictPort' && inline === undefined) continue;
    if (!['--host', '--port'].includes(flag)) throw Error('Argumen yang didukung: --host, --port, dan --strictPort.');
    const value = inline ?? args[++i];
    if (flag === '--port') {
      if (!/^\d+$/.test(value || '') || +value < 1 || +value > 65535) throw Error('--port tidak valid.');
      config.port = +value;
    } else {
      if (!/^[A-Za-z0-9.:[\]_-]+$/.test(value || '')) throw Error('--host tidak valid.');
      config.host = value;
    }
  }
  pool = createPool(config);
  const store = new MysqlStore(pool, config); await store.initialize();
  server = createApp({ store, config });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port, config.host, resolve); });
  console.log(`Leinz Lens Studio siap pada ${config.origin} (listener ${config.host}:${config.port}).`);
  const stop = () => {
    server.close(() => pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
} catch (error) {
  console.error(error.code ? `Server belum dapat dimulai (${error.code}). Periksa .env, akses database, migrasi, dan seed.` : error.message);
  await pool?.end(); process.exitCode = 1;
}
