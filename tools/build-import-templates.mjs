#!/usr/bin/env node
/**
 * Rebuild the four import templates from the application's shipped master data.
 * XLSX authoring requires the Codex primary runtime and @oai/artifact-tool.
 * The application itself does not require this authoring dependency to run.
 *
 * Usage (from the primary runtime):
 *   node tools/build-import-templates.mjs --output /absolute/workspace/outputs/import-templates
 *
 * Artifacts are exported to --output first, then copied to dist/templates.
 * The temporary authoring directory owns its node_modules symlink. It never
 * changes the application dependencies or an installed runtime directory.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const option = name => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};
const projectRoot = path.resolve(option('--root') || fileURLToPath(new URL('..', import.meta.url)));
const outputOption = option('--output');
if (!outputOption || !path.isAbsolute(outputOption)) {
  throw new Error('Provide --output with an absolute workspace outputs directory.');
}
const outputDir = path.resolve(outputOption);
const templateDir = path.join(projectRoot, 'dist', 'templates');
const previewDir = path.join(outputDir, 'previews');
const runtimeNode = process.env.CODEX_PRIMARY_RUNTIME_NODE;
const runtimeModules = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
if (!runtimeNode || !runtimeModules || path.resolve(process.execPath) !== path.resolve(runtimeNode)) {
  throw new Error('Run this optional template-authoring script with CODEX_PRIMARY_RUNTIME_NODE and its bundled dependencies.');
}
const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'leinz-import-templates-'));
await fs.symlink(runtimeModules, path.join(workDir, 'node_modules'), 'dir');
const requireFromWorkDir = createRequire(path.join(workDir, 'package.json'));
const { Workbook, SpreadsheetFile } = await import(requireFromWorkDir.resolve('@oai/artifact-tool'));
await fs.mkdir(outputDir, { recursive: true });
await fs.mkdir(previewDir, { recursive: true });
await fs.mkdir(templateDir, { recursive: true });

const readMaster = async filename => JSON.parse(await fs.readFile(path.join(projectRoot, 'dist', 'assets', filename), 'utf8'));
const [materials, shapes, tints] = await Promise.all([
  readMaster('materials.json'), readMaster('shapes.json'), readMaster('tints.json'),
]);
const blankId = 'DMO:SPHG60:BC1.00:D75.00';
const blank = materials.blanks.find(item => item.id === blankId);
const product = materials.products.find(item => item.id === blank?.productId);
const blankRules = materials.rules.filter(item => item.blankId === blankId);
if (!blank || !product || blankRules.length !== 2) {
  throw new Error('Expected the complete two-rule example blank DMO/SPHG60 BC1 D75 in the master data.');
}

const blankRows = blankRules.map(rule => [
  product.supplier, product.code, product.name, blank.baseCurve, blank.diameter,
  blank.ct, blank.et, rule.sphFrom, rule.sphTo, rule.cylFrom, rule.cylTo,
  rule.addFrom, rule.addTo,
]);
const shapeRows = ['round', 'rectangle'].map(code => {
  const shape = shapes.items.find(item => item.code === code);
  if (!shape) throw new Error(`Missing template shape ${code}.`);
  return [shape.code, shape.name, shape.active !== false, shape.defaultWidthMm,
    shape.defaultHeightMm, 'keep', null];
});
const tintRows = ['01S', '02G'].map(code => {
  const tint = tints.items.find(item => item.code === code);
  if (!tint || tint.referenceStatus !== 'matched') throw new Error(`Missing matched template tint ${code}.`);
  return [tint.code, tint.name, tint.kind, tint.group, tint.nominalPercent,
    tint.previewHex, tint.previewMidHex, tint.previewBottomHex, tint.referenceNote,
    !!tint.requiresPhysicalSample, tint.active !== false, false, null];
});

const commonNotes = [
  ['Sebelum digunakan', 'Hapus atau ganti baris contoh dengan data yang akan diimpor. Pertahankan nama dan urutan header pada baris pertama.'],
  ['Alur impor', 'Pilih file di menu Manage, periksa pratinjau dan pesan validasi, lalu terapkan impor. Sheet Petunjuk diabaikan oleh importer.'],
  ['Format angka', 'Isi angka sebagai angka Excel, bukan formula. Pada CSV gunakan titik desimal. File contoh CSV memakai UTF-8 BOM dan pemisah koma.'],
  ['Nilai kosong', 'Kosong berarti tidak diisi; 0 adalah angka nol. Jangan memakai formula, simbol satuan, atau tanda s/d pada kolom angka.'],
  ['Pilihan aktif', 'Isi TRUE atau FALSE untuk kolom status. FALSE menyimpan entri tanpa mengaktifkannya dalam pilihan simulator.'],
];

const specs = [
  {
    basename: 'blank-template', sheet: 'Blank', title: 'Template impor blank',
    subtitle: 'Raw material dan cakupan resep per blank',
    headers: ['supplier', 'LensCode', 'Descr', 'base_curve', 'diameter', 'center_thickness', 'edge_thickness', 'sph_from', 'sph_to', 'cyl_from', 'cyl_to', 'add_from', 'add_to'],
    rows: blankRows, widths: [105, 130, 310, 120, 115, 155, 145, 120, 120, 120, 120, 120, 120],
    numeric: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12], booleans: [],
    notes: [
      ...commonNotes.filter(([label]) => label !== 'Pilihan aktif'),
      ['Contoh lengkap', 'Dua baris contoh memuat seluruh aturan DMO / SPHG60, BC 1.00, diameter 75.00 mm. CT blank 7.50 mm dan ET blank 15.00 mm.'],
      ['Sumber contoh', 'Master bahan baku Leinz Lens Studio; nilainya sesuai DMO UNV OSA.xlsx, sheet DMO UNV OSA, baris 3–4.'],
      ['Identitas blank', 'supplier + LensCode + base_curve + diameter menentukan satu blank fisik. Kode produk yang sama pada supplier berbeda tetap terpisah.'],
      ['Mengimpor ulang', 'Semua aturan untuk blank yang tercantum diganti oleh seluruh barisnya dalam file ini. Sertakan cakupan lengkap blank tersebut. Blank lain tetap tersimpan.'],
      ['Kombinasi range', 'SPH, CYL, dan ADD harus cocok pada baris yang sama (AND). Cukup satu baris cocok untuk blank tersebut (OR antarbaris). Batas from/to ikut tercakup.'],
      ['Angka nol', 'CYL 0.00–0.00 hanya untuk silinder nol. ADD 0.00–0.00 hanya untuk ADD nol. Angka nol bukan semua nilai; kolom wajib tidak boleh kosong.'],
      ['Konvensi CYL', 'Gunakan CYL minus atau nol seperti data acuan. Jangan mengganti tanda CYL tanpa menyesuaikan resep. Batas from harus lebih kecil atau sama dengan to.'],
      ['Uji contoh', 'SPH −9 / CYL −4 / ADD 0 cocok. SPH −9 / CYL 0 / ADD +1 cocok. SPH −9 / CYL −4 / ADD +1 tidak tercakup oleh blank contoh.'],
      ['Duplikat & konflik', 'Aturan yang identik dapat digabung dengan jejak baris asal. CT/ET yang berbeda untuk identitas blank sama harus dikoreksi sebelum impor.'],
      ['supplier, LensCode', 'Teks kode supplier dan produk; gunakan penamaan yang konsisten. Supplier contoh adalah DMO. Nilai SOA pada master tidak boleh diganti menjadi OSA.'],
      ['Descr / indeks', 'Nama/deskripsi produk memuat indeks yang jelas, misalnya 1.6 atau 1.60. Produk dikenal mengikuti indeks pada master. Indeks yang tidak jelas perlu dikoreksi.'],
      ['base_curve', 'Base curve blank dalam dioptri (D), sesuai spesifikasi supplier.'],
      ['diameter', 'Diameter blank dalam milimeter (mm), misalnya 75.00. Harus positif dan sesuai ketersediaan supplier.'],
      ['center_thickness', 'Ketebalan pusat blank bahan baku dalam mm. Ini bukan CT lensa selesai hasil simulasi.'],
      ['edge_thickness', 'Ketebalan tepi blank bahan baku dalam mm. Ini bukan ET lensa selesai hasil simulasi.'],
      ['sph_from / sph_to', 'Batas SPH minimum dan maksimum untuk baris cakupan ini, dalam D.'],
      ['cyl_from / cyl_to', 'Batas CYL minimum dan maksimum untuk baris cakupan ini, dalam D; gunakan minus/zero.'],
      ['add_from / add_to', 'Batas ADD minimum dan maksimum untuk baris cakupan ini, dalam D. Isi 0 dan 0 jika hanya tanpa ADD.'],
      ['Kelayakan simulator', 'Lolos range masih memerlukan diameter yang cukup, geometri frame, aturan SKU, dan assignment blank. Data cakupan tidak menyatakan stok aktual.'],
    ],
  },
  {
    basename: 'frame-shape-template', sheet: 'FrameShape', title: 'Template impor frame shape',
    subtitle: 'Nama, ukuran awal, dan kontur frame',
    headers: ['code', 'name', 'active', 'width_mm', 'height_mm', 'contour', 'points_json'],
    rows: shapeRows, widths: [145, 240, 95, 130, 130, 190, 400], numeric: [3, 4], booleans: [2],
    enums: { 5: ['ellipse', 'rounded-rectangle', 'points', 'keep'] },
    notes: [
      ...commonNotes,
      ['Contoh master', 'Kode round dan rectangle memakai nama serta ukuran awal dari master frame shape. contour=keep mempertahankan kontur acuan yang sudah ada.'],
      ['Mengimpor ulang', 'Kode yang sama memperbarui shape tersebut. Shape lain tidak dihapus. Untuk shape baru gunakan kode baru dan pilih kontur yang didukung.'],
      ['code', 'Kode unik dalam bentuk teks. Pertahankan leading zero pada kode seperti 001. Jangan menggunakan kode yang sama untuk dua bentuk berbeda.'],
      ['name', 'Nama yang ditampilkan saat memilih frame shape.'],
      ['active', 'TRUE agar tersedia untuk dipilih; FALSE untuk menyimpan bentuk dalam keadaan nonaktif.'],
      ['width_mm / height_mm', 'Lebar dan tinggi bukaan satu lensa dalam mm. Nilai positif ini menjadi ukuran awal dan dapat disesuaikan pada simulator.'],
      ['contour = keep', 'Hanya untuk kode yang sudah ada. Mempertahankan titik kontur dan acuan bentuk saat nama, ukuran, atau status diperbarui. points_json dibiarkan kosong.'],
      ['contour = ellipse', 'Membuat kontur elips halus. Lebar dan tinggi yang sama menghasilkan lingkaran. points_json dibiarkan kosong.'],
      ['rounded-rectangle', 'Membuat kontur persegi panjang dengan sudut membulat. Sesuaikan width_mm dan height_mm. points_json dibiarkan kosong.'],
      ['contour = points', 'Gunakan points_json berisi daftar pasangan [x,y] kontur yang valid. Satu baris mewakili satu kontur lengkap.'],
      ['points_json', 'JSON array pasangan koordinat, misalnya [[-0.5,0],[0,-0.5],[0.5,0],[0,0.5]]. Koordinat mengikuti bounding box ternormalisasi, x ke kanan dan y ke bawah.'],
      ['CSV dengan JSON', 'Jika points_json berisi koma, bungkus sel dengan tanda petik CSV. Template CSV sudah memakai penulisan kutip yang benar.'],
      ['Sumber contoh', 'Master frame shape Leinz Lens Studio; kode round dan rectangle mempertahankan kontur dari SVG acuan pengguna.'],
    ],
  },
  {
    basename: 'tinting-template', sheet: 'Tinting', title: 'Template impor tinting',
    subtitle: 'Kode warna, jenis, dan warna pratinjau',
    headers: ['code', 'name', 'kind', 'group', 'nominal_percent', 'preview_hex', 'preview_mid_hex', 'preview_bottom_hex', 'reference_note', 'requires_physical_sample', 'active', 'override_reference', 'manual_reference'],
    rows: tintRows, widths: [95, 245, 115, 120, 150, 135, 155, 175, 380, 210, 95, 180, 340], numeric: [4], booleans: [9, 10, 11],
    enums: { 2: ['Solid', 'Gradient'], 3: ['fashion', 'sunglass', 'therapeutic', 'special'] },
    notes: [
      ...commonNotes,
      ['Contoh master', '01S Bazaar (Solid) dan 02G Cerulean Frost Gradient memakai nilai warna serta catatan acuan master. Sel kosong nominal_percent tetap kosong.'],
      ['Mengimpor ulang', 'Kode yang sama memperbarui tint tersebut; tint lain tetap tersimpan. Data acuan yang tidak diubah dipertahankan.'],
      ['code / name', 'Kode warna unik dan nama tampilan. Gunakan kode sebagai teks agar nol awal tidak hilang.'],
      ['kind', 'Pilih Solid atau Gradient. Solid memakai satu warna; Gradient memakai warna atas, tengah, dan bawah.'],
      ['group', 'Pilih fashion, sunglass, therapeutic, atau special sesuai kelompok katalog.'],
      ['nominal_percent', 'Label persentase katalog 0–100. Kosong jika tidak ada pada sumber. Nilai ini bukan VLT atau transmisi yang terukur.'],
      ['preview_hex', 'Warna utama/atas dalam format #RRGGBB. Kosong jika data warna tidak tersedia; jangan menggantinya dengan warna yang ditebak.'],
      ['preview_mid_hex', 'Warna tengah gradasi #RRGGBB, jika tersedia. Pada contoh Solid nilainya sama dengan warna utama.'],
      ['preview_bottom_hex', 'Warna bawah gradasi #RRGGBB, jika tersedia. Pada contoh Solid nilainya sama dengan warna utama.'],
      ['reference_note', 'Catatan singkat tentang acuan warna, batasan ilustrasi, atau kebutuhan tindak lanjut.'],
      ['requires_physical_sample', 'TRUE bila pemesanan warna membutuhkan contoh lensa fisik. FALSE bila tidak diwajibkan oleh data acuan.'],
      ['override_reference', 'Tetap FALSE untuk pembaruan biasa. TRUE digunakan secara sengaja untuk mengganti referensi yang berkonflik, disertai manual_reference.'],
      ['manual_reference', 'Acuan pengganti yang jelas bila override_reference=TRUE, misalnya kode sampel fisik dan tanggal pemeriksaan. Jangan diisi dengan acuan yang belum ada.'],
      ['Warna pratinjau', 'Warna layar merupakan ilustrasi. Hasil tinting dapat berbeda menurut bahan lensa, indeks, coating, dan pencahayaan.'],
      ['Sumber contoh', 'Master tinting Leinz Lens Studio; kode 01S dan 02G berstatus matched terhadap lembar contoh warna yang sudah tersedia.'],
    ],
  },
  {
    basename: 'sku-template', sheet: 'SKU', title: 'Template impor SKU',
    subtitle: 'Indeks, range finish, dan assignment blank',
    headers: ['sku_code', 'sku_name', 'sku_active', 'index', 'index_enabled', 'sph_min', 'sph_max', 'cyl_min', 'cyl_max', 'add_min', 'add_max', 'supplier', 'LensCode', 'base_curve', 'diameter'],
    rows: [['DEMO-IMPORT', 'Contoh SKU impor (nonaktif)', false, 1.6, true, -9.25, -8, -4, 0, 0, 0, product.supplier, product.code, blank.baseCurve, blank.diameter]],
    widths: [170, 260, 120, 100, 150, 115, 115, 115, 115, 115, 115, 115, 145, 125, 120],
    numeric: [3, 5, 6, 7, 8, 9, 10, 13, 14], booleans: [2, 4],
    notes: [
      ...commonNotes,
      ['Contoh nonaktif', 'DEMO-IMPORT adalah contoh baru dengan sku_active=FALSE, bukan SKU produksi. Ganti kode, nama, rentang, dan assignment sesuai produk yang disetujui.'],
      ['Blank acuan', 'Contoh memakai blank nyata DMO / SPHG60, indeks 1.60, BC 1.00, diameter 75.00 mm. Range finish contoh berada dalam cakupan aturan blank tersebut.'],
      ['Satu baris', 'Satu baris mewakili satu assignment blank fisik pada satu SKU dan indeks. Ulangi baris untuk menambah blank; gunakan metadata dan range yang sama pada SKU/indeks yang sama.'],
      ['Mengimpor ulang', 'Impor mengganti seluruh indeks dan assignment untuk setiap SKU yang tercantum. Sertakan seluruh konfigurasi SKU tersebut; SKU lain tetap tersimpan.'],
      ['sku_code / sku_name', 'Kode unik dan nama produk finish. Kode yang sama tanpa membedakan huruf besar/kecil memperbarui SKU yang sudah ada.'],
      ['sku_active', 'TRUE untuk SKU aktif. FALSE menyimpan konfigurasi tanpa mengaktifkan SKU untuk pilihan simulator.'],
      ['index', 'Indeks lensa: 1.50, 1.56, 1.57, 1.60, 1.67, atau 1.74, sesuai daftar indeks simulator.'],
      ['index_enabled', 'TRUE mengaktifkan indeks pada SKU. FALSE menonaktifkan indeks tersebut. Semua baris dengan SKU/indeks sama harus memiliki status yang sama.'],
      ['sph_min / sph_max', 'Range SPH finish/SKU dalam dioptri. Minimum tidak boleh melebihi maksimum. Ini tidak mengganti range bahan baku.'],
      ['cyl_min / cyl_max', 'Range CYL finish/SKU dalam dioptri, menggunakan konvensi minus/zero. Isi 0 dan 0 bila hanya CYL nol.'],
      ['add_min / add_max', 'Range ADD finish/SKU dalam dioptri. Isi 0 dan 0 untuk tanpa ADD.'],
      ['supplier / LensCode', 'Kode supplier dan produk bahan baku yang sudah ada pada master. Indeks produk harus sesuai kolom index.'],
      ['base_curve / diameter', 'Base curve (D) dan diameter (mm) harus menunjuk blank fisik yang tersedia. CT/ET diambil dari master blank, tidak dimasukkan ulang di SKU.'],
      ['Indeks nonaktif', 'Untuk indeks nonaktif tanpa assignment, kolom supplier, LensCode, base_curve dan diameter dapat dikosongkan bersama.'],
      ['Kecocokan resep', 'Resep harus lolos range SKU serta satu aturan SPH/CYL/ADD blank sekaligus. Assignment tidak menjamin stok maupun kecukupan diameter untuk semua frame.'],
      ['Sumber contoh', 'Kode SKU dan range finish adalah contoh nonaktif. Identitas serta spesifikasi blank diambil dari master bahan baku Leinz Lens Studio.'],
    ],
  },
];

const COLORS = {
  teal: '#174E52', orange: '#F2703D', body: '#263B40', muted: '#647477',
  stripe: '#EFF7F6', line: '#D4E3E1', paleOrange: '#FFF2E8', white: '#FFFFFF',
};
const FONT = 'Arial';
function columnName(number) {
  let n = number + 1, out = '';
  while (n) { n--; out = String.fromCharCode(65 + n % 26) + out; n = Math.floor(n / 26); }
  return out;
}
function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'boolean' ? (value ? 'TRUE' : 'FALSE') : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
function csvOf(spec) {
  return '\uFEFF' + [spec.headers, ...spec.rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

function styleData(sheet, spec) {
  const lastColumn = columnName(spec.headers.length - 1);
  const lastRow = spec.rows.length + 1;
  const entryEnd = Math.max(lastRow + 6, 10);
  const area = sheet.getRange(`A1:${lastColumn}${entryEnd}`);
  area.format.font = { name: FONT, size: 10, color: COLORS.body };
  area.format.rowHeight = 27;
  area.format.verticalAlignment = 'center';
  area.format.fill = COLORS.white;
  area.format.horizontalAlignment = 'left';
  sheet.showGridLines = false;
  sheet.tabColor = COLORS.teal;
  sheet.freezePanes.freezeRows(1);
  sheet.freezePanes.freezeColumns(Math.min(2, spec.headers.length));
  spec.widths.forEach((width, c) => {
    sheet.getRange(`${columnName(c)}1:${columnName(c)}${entryEnd}`).format.columnWidthPx = width;
  });
  const header = sheet.getRange(`A1:${lastColumn}1`);
  header.format.fill = COLORS.teal;
  header.format.font = { name: FONT, size: 10, bold: true, color: COLORS.white };
  header.format.rowHeight = 38;
  header.format.horizontalAlignment = 'center';
  header.format.wrapText = false;
  header.format.borders = { bottom: { style: 'medium', color: COLORS.orange } };
  for (let r = 2; r <= entryEnd; r++) {
    const line = sheet.getRange(`A${r}:${lastColumn}${r}`);
    if (r % 2 === 0) line.format.fill = COLORS.stripe;
    line.format.borders = { bottom: { style: 'hair', color: COLORS.line } };
  }
  for (const c of spec.numeric) {
    const range = sheet.getRange(`${columnName(c)}2:${columnName(c)}${entryEnd}`);
    range.setNumberFormat('0.00');
    range.format.horizontalAlignment = 'right';
  }
  for (const c of spec.booleans) {
    const range = sheet.getRange(`${columnName(c)}2:${columnName(c)}${entryEnd}`);
    range.format.horizontalAlignment = 'center';
    range.dataValidation = { rule: { type: 'list', values: ['TRUE', 'FALSE'] } };
  }
  for (const [c, choices] of Object.entries(spec.enums || {})) {
    const range = sheet.getRange(`${columnName(Number(c))}2:${columnName(Number(c))}${entryEnd}`);
    range.format.horizontalAlignment = 'center';
    range.dataValidation = {
      rule: { type: 'list', values: choices },
    };
  }
  const supplierColumn = spec.headers.indexOf('supplier');
  if (supplierColumn > 0) sheet.getRange(`${columnName(supplierColumn)}2:${columnName(supplierColumn)}${entryEnd}`).format.horizontalAlignment = 'center';
  // Codes remain text, including values with leading zero.
  sheet.getRange(`A2:A${entryEnd}`).setNumberFormat('@');
  const lensCodeColumn = spec.headers.indexOf('LensCode');
  if (lensCodeColumn >= 0) sheet.getRange(`${columnName(lensCodeColumn)}2:${columnName(lensCodeColumn)}${entryEnd}`).setNumberFormat('@');
  sheet.getRange(`A2:${lastColumn}${lastRow}`).format.rowHeight = 36;
  const descColumn = spec.headers.findIndex(h => h === 'Descr' || h === 'name' || h === 'sku_name');
  if (descColumn >= 0) sheet.getRange(`${columnName(descColumn)}2:${columnName(descColumn)}${lastRow}`).format.wrapText = true;
  const noteColumn = spec.headers.indexOf('reference_note');
  if (noteColumn >= 0) {
    sheet.getRange(`${columnName(noteColumn)}2:${columnName(noteColumn)}${lastRow}`).format.wrapText = true;
    sheet.getRange(`A2:${lastColumn}${lastRow}`).format.rowHeight = 45;
  }
}

function createInstructions(workbook, spec) {
  const sheet = workbook.worksheets.add('Petunjuk');
  const finalRow = 6 + spec.notes.length;
  sheet.showGridLines = false;
  sheet.tabColor = COLORS.orange;
  const area = sheet.getRange(`A1:B${finalRow}`);
  area.format.font = { name: FONT, size: 10, color: COLORS.body };
  area.format.fill = COLORS.white;
  area.format.verticalAlignment = 'center';
  sheet.getRange(`A1:A${finalRow}`).format.columnWidthPx = 205;
  sheet.getRange(`B1:B${finalRow}`).format.columnWidthPx = 835;
  sheet.getRange('A1:B1').format.rowHeight = 14;
  sheet.getRange('A2').values = [['LEINZ']];
  sheet.getRange('A2').format.font = { name: FONT, size: 16, bold: true, color: COLORS.orange };
  sheet.getRange('B2').values = [[spec.title]];
  sheet.getRange('B2').format.font = { name: FONT, size: 16, bold: true, color: COLORS.teal };
  sheet.getRange('A2:B2').format.rowHeight = 34;
  sheet.getRange('A3').values = [['LENS STUDIO']];
  sheet.getRange('A3').format.font = { name: FONT, size: 10, bold: true, color: COLORS.teal };
  sheet.getRange('B3').values = [[spec.subtitle]];
  sheet.getRange('B3').format.font = { name: FONT, size: 10, color: COLORS.muted };
  sheet.getRange('A3:B3').format.rowHeight = 24;
  sheet.getRange('A4:B4').format.rowHeight = 12;
  sheet.getRange('A4:B4').format.borders = { bottom: { style: 'thin', color: COLORS.orange } };
  sheet.getRange('A5:B5').values = [['Data contoh', `${spec.rows.length} baris contoh di sheet ${spec.sheet}. Ganti dengan data yang akan diimpor.`]];
  sheet.getRange('A5:B5').format.fill = COLORS.paleOrange;
  sheet.getRange('A5:B5').format.rowHeight = 34;
  sheet.getRange('A5').format.font = { name: FONT, size: 10, bold: true, color: COLORS.teal };
  sheet.getRange('A6:B6').format.rowHeight = 10;
  sheet.getRange(`A7:B${finalRow}`).values = spec.notes;
  sheet.getRange(`A7:A${finalRow}`).format.font = { name: FONT, size: 10, bold: true, color: COLORS.teal };
  sheet.getRange(`A7:A${finalRow}`).format.wrapText = false;
  sheet.getRange(`B7:B${finalRow}`).format.wrapText = true;
  spec.notes.forEach(([label, value], i) => {
    const row = i + 7;
    const range = sheet.getRange(`A${row}:B${row}`);
    const lines = Math.ceil(value.length / 133);
    range.format.rowHeight = lines > 1 ? 42 : 29;
    range.format.borders = { bottom: { style: 'hair', color: COLORS.line } };
    if (i % 2 === 0) range.format.fill = COLORS.stripe;
  });
  return { sheet, finalRow };
}

const manifest = [];
for (const spec of specs) {
  const workbook = Workbook.create();
  const data = workbook.worksheets.add(spec.sheet);
  const matrix = [spec.headers, ...spec.rows];
  const lastCol = columnName(spec.headers.length - 1);
  const lastRow = matrix.length;
  data.getRange(`A1:${lastCol}${lastRow}`).values = matrix;
  styleData(data, spec);
  const instructions = createInstructions(workbook, spec);
  workbook.recalculate();

  const check = await workbook.inspect({
    kind: 'table', range: `${spec.sheet}!A1:${lastCol}${lastRow}`,
    include: 'values,formulas', tableMaxRows: 4, tableMaxCols: spec.headers.length,
    maxChars: 5000,
  });
  await fs.writeFile(path.join(outputDir, `${spec.basename}-inspect.ndjson`), check.ndjson, 'utf8');
  const errorScan = await workbook.inspect({
    kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',
    options: { useRegex: true, maxResults: 50 }, maxChars: 2000,
    summary: 'template formula error scan',
  });
  await fs.writeFile(path.join(outputDir, `${spec.basename}-errors.ndjson`), errorScan.ndjson, 'utf8');
  for (const [suffix, sheetName, range] of [
    ['data', spec.sheet, `A1:${lastCol}${lastRow + 2}`],
    ['instructions', 'Petunjuk', `A1:B${instructions.finalRow}`],
  ]) {
    const preview = await workbook.render({ sheetName, range, scale: 1.4, format: 'png' });
    await fs.writeFile(path.join(previewDir, `${spec.basename}-${suffix}.png`), new Uint8Array(await preview.arrayBuffer()));
  }
  const exported = await SpreadsheetFile.exportXlsx(workbook);
  const xlsxPath = path.join(outputDir, `${spec.basename}.xlsx`);
  const csvPath = path.join(outputDir, `${spec.basename}.csv`);
  await exported.save(xlsxPath);
  await fs.writeFile(csvPath, csvOf(spec), 'utf8');
  await fs.copyFile(xlsxPath, path.join(templateDir, `${spec.basename}.xlsx`));
  await fs.copyFile(csvPath, path.join(templateDir, `${spec.basename}.csv`));
  manifest.push({ basename: spec.basename, sheet: spec.sheet, headers: spec.headers,
    exampleRows: spec.rows.length, rows: spec.rows, numericColumns: spec.numeric,
    booleanColumns: spec.booleans });
  console.log(`${spec.basename}: ${spec.rows.length} example rows; CSV and XLSX exported.`);
}

const instructionsText = [
  'LEINZ LENS STUDIO — PETUNJUK TEMPLATE IMPOR', '',
  'Empat template tersedia dalam CSV dan Excel (.xlsx). Gunakan salah satu format.',
  'File berisi contoh. Hapus/ganti baris contoh sebelum memuat data baru.',
  'Header pada baris pertama harus dipertahankan. Excel memiliki sheet Petunjuk.',
  '',
  ...specs.flatMap(spec => [spec.title.toUpperCase(), `File: ${spec.basename}.csv / ${spec.basename}.xlsx`,
    ...spec.notes.map(([label, value]) => `${label}: ${value}`), '']),
].join('\r\n');
await fs.writeFile(path.join(templateDir, 'README-import-templates.txt'), instructionsText, 'utf8');
await fs.writeFile(path.join(outputDir, 'template-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
await fs.rm(workDir, { recursive: true, force: true });
console.log(`Templates copied to ${templateDir}. Rendered previews and inspection logs: ${outputDir}.`);
