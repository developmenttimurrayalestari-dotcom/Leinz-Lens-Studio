import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { loadConfig } from './config.mjs';
import { createPool, migrate, seed, createUser, inspectDatabase } from './db.mjs';

async function askPassword(prompt) {
  if (!process.stdin.isTTY) throw Error('Input non-interaktif memerlukan ADMIN_USERNAME dan ADMIN_PASSWORD melalui environment. Jangan menaruh password pada argumen perintah.');
  let hidden = false;
  const output = new Writable({ write(chunk, _encoding, callback) { if (!hidden) process.stdout.write(chunk); callback(); } });
  const reader = createInterface({ input: process.stdin, output, terminal: true });
  try { process.stdout.write(prompt); hidden = true; return await reader.question(''); }
  finally { hidden = false; process.stdout.write('\n'); reader.close(); }
}

let pool;
try {
  const command = process.argv[2];
  if (!['migrate', 'seed', 'admin-create', 'doctor'].includes(command) || process.argv.length > 3) throw Error('Gunakan npm run db:migrate, db:seed, admin:create, atau doctor.');
  const config = loadConfig(); pool = createPool(config);
  if (command === 'migrate') { await migrate(pool); console.log('Migrasi selesai. Tabel dan data yang sudah ada dipertahankan.'); }
  if (command === 'seed') { await seed(pool); console.log('Katalog referensi berhasil diisi. Master SKU dan konsultasi yang sudah ada dipertahankan.'); }
  if (command === 'admin-create') {
    await inspectDatabase(pool);
    let name = config.adminUsername, password = config.adminPassword;
    if (!name) {
      if (!process.stdin.isTTY) throw Error('Isi ADMIN_USERNAME dan ADMIN_PASSWORD melalui environment untuk input non-interaktif.');
      const reader = createInterface({ input: process.stdin, output: process.stdout });
      try { name = await reader.question('Username akun: '); } finally { reader.close(); }
    }
    if (!password) {
      password = await askPassword('Password (8–128 karakter, input disembunyikan): ');
      const repeat = await askPassword('Ulangi password: ');
      if (password !== repeat) throw Error('Kedua password tidak sama. Akun belum dibuat.');
    }
    const user = await createUser(pool, name, password); password = ''; config.adminPassword = '';
    console.log(`Akun ${user.username} berhasil dibuat. Password tidak ditampilkan.`);
  }
  if (command === 'doctor') {
    const report = await inspectDatabase(pool);
    const [[users]] = await pool.query('SELECT COUNT(*) AS activeUsers FROM leinz_users WHERE active = 1');
    if (!Number(users.activeUsers)) throw Error('Belum ada akun aktif. Jalankan npm run admin:create.');
    console.log(JSON.stringify({ ok: true, node: process.version, database: 'MySQL', databaseVersion: report.version, schemaVersion: 1, tables: report.tables.length, catalogs: report.catalogCount, activeUsers: Number(users.activeUsers), maxAllowedPacket: report.maxAllowedPacket, applicationOrigin: config.origin }, null, 2));
  }
} catch (error) {
  console.error(error.code ? `Perintah gagal (${error.code}). Periksa database, hak akses, dan konfigurasi .env.` : error.message);
  process.exitCode = 1;
} finally { await pool?.end(); }
