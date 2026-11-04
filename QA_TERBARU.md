# QA ulang Leinz Lens Studio 2.2.0

Tanggal laporan: 04 November 2026, 12:33 WIB (Asia/Jakarta).
Source aplikasi: `d4231ae9df7ebb994da715fabffb44060c05c98e`; sama dengan Site versi 15 dan rilis 2.2.0.

## Hasil QA ulang

Source diekstrak ke direktori kosong, lalu dipasang dan diuji kembali.
Pengujian database memakai instance MySQL 5.7.24 baru dengan direktori data
terpisah. Database operasional pengguna tidak diakses atau diubah.

| Pemeriksaan ulang | Hasil |
| --- | --- |
| npm ci | Lulus dari ekstraksi bersih |
| npm run build | Lulus: 40 berkas JavaScript, aset HTML, dan katalog JSON |
| Suite utama node:test | 157 lulus, 0 gagal |
| Suite SKU terpisah | 24 lulus, 0 gagal |
| Assertion BlankEngine dan viewer | Lulus |
| Integrasi MySQL 5.7.24 | 29 kelompok lulus, 0 gagal |
| Impor SQL, impor ulang, schema/master terpisah, backup/restore | 8 pemeriksaan lulus |
| Audit pemeliharaan master dan payload SQL | 39 pemeriksaan lulus |
| npm start, login, bootstrap dan simpan/baca | Lulus |
| Restart aplikasi dan database | Photochromic/UV serta master tetap tersimpan |
| Kesesuaian source paket dengan ekstraksi yang diuji | Semua 131 berkas kode/data/template identik |

Lingkungan QA: Linux, Node.js v24.22.1, npm 11.9.0, MySQL 5.7.24.
Build aplikasi memeriksa JavaScript secara langsung; tidak ada tahap transpile
atau compiler native tambahan. Peringatan npm tentang konfigurasi http-proxy
berasal dari lingkungan QA dan tidak menyebabkan kegagalan instalasi/test.

## Master data dipertahankan

| Master | Sebelum | Sesudah |
| --- | ---: | ---: |
| Supplier | 2 | 2 |
| Produk material | 19 | 19 |
| Blank fisik | 186 | 186 |
| Aturan SPH/CYL/ADD unik | 2.026 | 2.026 |
| Frame shape | 13 | 13 |
| Tinting | 66 | 66 |
| SKU bawaan | 0 | 0 |

Ketiga master JSON dan tiga SQL sama persis dengan baseline Git dan inventory.
Payload JSON yang tertanam dalam SQL identik dengan master sumber. Jejak 2.689
baris sumber, termasuk 663 pengulangan identik, tetap tersedia. Data indeks
1.59 tetap tersimpan sebagai katalog saja; enam indeks simulator tidak berubah.

Master SKU bawaan memang kosong sejak baseline. Contoh DEMO-IMPORT pada template
bersifat nonaktif dan bukan seed produksi. Paket ini berisi master referensi
rilis, bukan backup database operasional atau perubahan lokal browser pengguna.
Untuk memindahkan tambahan data dari instalasi asal, gunakan backup database
atau ekspor/impor master melalui menu Manage sesuai panduan yang disertakan.

SQL menggunakan CREATE TABLE IF NOT EXISTS, INSERT IGNORE dan transaksi.
Impor ulang mempertahankan dokumen master/SKU yang telah ada, termasuk edit
dan revisinya; SQL tidak mengganti isi dokumen tersebut dengan master bawaan.
Perilaku ini diperiksa langsung pada database pengujian.

## Cakupan fitur dan batas verifikasi

Suite otomatis menguji range blank yang tetap berpasangan SPH/CYL/ADD,
diameter/frame/sentrasi, assignment SKU, viewer dan anotasi CT/ET, photochromic
beserta larangan tint, UV tanpa perubahan geometri, penyimpanan konsultasi,
impor CSV/XLSX, seluruh delapan template, validasi input, serta persistensi
dan konflik revisi database.

Verifikasi visual browser pada source yang sama tercatat dalam
[laporan rilis 2.2.0](docs/QA_RELEASE_2_2_0.md). QA ulang ini menjalankan kembali
instalasi, build, suite otomatis, database dan audit master; sesi visual browser
tersebut tidak diulang. Tidak ada perubahan source aplikasi setelah QA visual.

Runtime Windows belum diuji langsung. Hasil lulus berlaku untuk skenario dan
lingkungan yang dicatat, bukan jaminan semua kombinasi input/lingkungan telah
diuji. Photochromic tetap berupa simulasi visual generik, belum kalibrasi VLT,
waktu respons atau performa material tertentu.

## Memulai instalasi

Baca [MULAI_DI_SINI.md](MULAI_DI_SINI.md) dan
[panduan database](docs/DATABASE_IMPORT.md). Frontend siap disajikan berada di
dist/, backend Node.js di server/, dan SQL ada di database/. Delapan template
impor CSV/XLSX tetap disertakan di dist/templates/.

Untuk instalasi lama, pertahankan .env dan database yang sudah digunakan,
ikuti bagian upgrade pada [panduan instalasi](docs/INSTALL_MYSQL57.md), lalu
jalankan pemeriksaan doctor. Pembaruan 2.1.1 ke 2.2.0 tidak memerlukan tabel baru.

Log QA ulang tersanitasi berada di docs/qa-results/recheck-2026-11-04/.
Kredensial QA, file konfigurasi rahasia, binary MySQL, node_modules, database
sementara, dan dump data pengujian tidak disertakan.
