import { readdir, readFile, access } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PROJECT_ROOT } from './config.mjs';

const sources = [];
async function scan(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, item.name);
    if (item.isDirectory()) await scan(path);
    else if (item.isFile() && /\.(?:js|mjs)$/.test(item.name)) sources.push(path);
  }
}
try {
  for (const folder of ['dist', 'server', 'tools']) await scan(resolve(PROJECT_ROOT, folder));
  for (const source of sources) {
    const result = spawnSync(process.execPath, ['--check', source], { encoding: 'utf8' });
    if (result.status !== 0) throw Error(`${relative(PROJECT_ROOT, source)}: ${result.stderr || result.error?.message || 'Syntax check gagal.'}`);
  }
  const html = await readFile(resolve(PROJECT_ROOT, 'dist/index.html'), 'utf8');
  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    if (/^(?:https?:|data:|#|\/\/)/.test(match[1])) continue;
    await access(resolve(PROJECT_ROOT, 'dist', match[1].replace(/^\//, '').split(/[?#]/)[0]));
  }
  for (const key of ['tints', 'materials', 'shapes']) JSON.parse(await readFile(resolve(PROJECT_ROOT, `dist/assets/${key}.json`), 'utf8'));
  console.log(`Pemeriksaan selesai: ${sources.length} berkas JavaScript valid, aset HTML tersedia, dan katalog JSON dapat dibaca. Tidak ada tahap kompilasi tambahan.`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
