# Laporan QA — Leinz Lens Studio 2.0.0 / MySQL 5.7.24

Tanggal pemeriksaan: 3 November 2026. Sasaran: kompatibilitas MySQL 5.7.24,
integritas penyimpanan, regresi simulator, dan kelengkapan paket instalasi.

## Ringkasan hasil

Pemeriksaan yang tercantum di bawah lulus pada lingkungan uji yang dijelaskan.
Temuan yang terkonfirmasi selama QA telah diperbaiki. Hasil ini bukan jaminan
bahwa semua kombinasi lingkungan dan input yang mungkin bebas dari bug.

| Area | Hasil dan bukti |
| --- | --- |
| Build / syntax | 24 berkas JavaScript; referensi aset HTML dan JSON katalog diperiksa oleh `npm run build` |
| SKU | 24 pengujian otomatis untuk validasi, impor, persistensi asinkron, konflik, dan batas katalog |
| Adapter penyimpanan | 16 pengujian otomatis untuk antrean revisi, kegagalan jaringan, respons hilang, konflik, dan autentikasi |
| Impor konsultasi | 12 pengujian otomatis untuk schema 1.3, data R/L, bentuk, warna, frame, sentrasi, dan input rusak |
| Backend dasar | 10 pengujian otomatis untuk konfigurasi, kredensial, cookie, dan validasi |
| Geometri / blank | Suite blank-engine dan lens-viewer lulus; rincian cakupan di bagian simulator |
| MySQL nyata | 18 kelompok integration test lulus pada MySQL Community Server 5.7.24 |
| Restart database | Pemeriksaan terpisah membuktikan state, riwayat, dan SKU tetap tersimpan setelah mysqld dimulai ulang |
| Browser | Regresi antarmuka mode browser, ekspor PNG/JSON, impor, penyimpanan dan pemulihan state diperiksa |
| Paket ZIP | Ekstraksi ke folder baru, `npm ci`, build, test, integration MySQL, dan restart database lulus |

Laporan ini membedakan pemeriksaan otomatis API/database dan pemeriksaan
antarmuka browser. Status lulus tidak berarti setiap fitur diuji dengan semua
kemungkinan kombinasi resep, perangkat, browser, maupun lingkungan server.

## Lingkungan yang benar-benar dijalankan

- Linux x64, Ubuntu 24.04.3.
- Node.js 24.22.1 dan npm 11.9.0.
- Dependency `mysql2` 3.24.6 sesuai `package-lock.json`.
- MySQL Community Server **5.7.24**, diverifikasi lewat `SELECT VERSION()`.
- InnoDB, `utf8mb4_unicode_ci`, strict SQL mode termasuk `ONLY_FULL_GROUP_BY`.
- `max_allowed_packet` pada pengujian: 67.108.864 byte (64 MiB).
- Database disposable terpisah; tidak mengakses database produksi pengguna.

Runtime MySQL berasal dari arsip resmi
`mysql-5.7.24-linux-glibc2.12-x86_64.tar.gz`.
Ukuran arsip 644.930.593 byte; checksum MD5 cocok dengan referensi resmi:
`075dccd655e090ca999e2c8da3b67eb7`. Ini identifikasi arsip pengujian,
bukan checksum ZIP aplikasi.

Node.js 22 diterima konfigurasi aplikasi dan dicantumkan dalam panduan.
Eksekusi QA ini memakai Node.js 24; tidak mengklaim eksekusi terpisah pada Node.js 22.
Panduan Windows PowerShell, Nginx, systemd, dan backup/restore disertakan;
lingkungan tersebut belum dijalankan pada server pengguna.

## Instalasi dari paket ZIP

ZIP diekstrak ke folder kosong, terpisah dari checkout pengembangan. Paket tidak
memuat `node_modules`, `.env`, kredensial QA, atau binary MySQL. `npm ci` memasang
12 package dari lockfile; `npm run build` dan `npm test` selesai dengan exit code 0.
Suite test menghasilkan 62 pengujian bernama yang lulus (24 SKU dan 38 backend,
storage, serta konsultasi), ditambah dua suite assertion geometri/blank/viewer.

Integration test kemudian dijalankan dari source hasil ekstraksi menggunakan
database baru `leinz_test_release200` pada MySQL 5.7.24: 18 kelompok lulus.
Pengujian terpisah setelah restart database juga lulus. Sebanyak 93 hash SHA-256
source, konfigurasi, dan aset dalam `RELEASE_CODE_SHA256.json` cocok sebelum dan
sesudah instalasi. Penambahan laporan/log sesudah QA tidak mengubah file aplikasi
yang telah diuji.

Perintah instalasi yang sebenarnya, `npm start`, juga dijalankan dari hasil
ekstraksi: HTML merespons HTTP 200, `/api/health` menyatakan versi 2.0.0,
`databaseVersion: 5.7.24` dan `ready: true`, serta runtime menyatakan mode MySQL.

Satu peringatan npm berasal dari environment pengujian: konfigurasi `http-proxy`
tidak dikenali oleh npm 11.9.0. Tidak ada kegagalan instalasi dependency, error
build, atau kegagalan assertion dari paket. Peringatan tersebut bukan pengaturan
yang dikirim dalam ZIP.

Bukti eksekusi tersedia dalam `docs/qa-results/`:

- `release-npm-ci.txt`, `release-npm-build.txt`, `release-npm-test.txt`.
- `release-npm-start.txt` untuk pemeriksaan entrypoint aplikasi.
- `release-mysql-integration.txt`, `release-mysql-restart.txt`.
- `mysql5724-integration.txt`, `mysql5724-restart.txt` dari pemeriksaan awal.

## Penyesuaian database

Aplikasi server menyajikan antarmuka dan API dari origin yang sama. Server
membaca kredensial database dari environment atau `.env`, lalu menggunakan
query berparameter. Browser tidak menerima password database.

Enam tabel mencakup migrasi, akun, sesi, katalog referensi, dokumen workspace,
dan dokumen per akun. SQL memakai collation MySQL 5.7, native JSON tanpa default,
serta InnoDB. Tidak memakai collation MySQL 8, CTE, window functions, atau
mengandalkan CHECK constraint untuk validasi input.

Katalog referensi dan Master SKU disimpan sebagai dokumen JSON agar struktur
data lama tetap utuh. Master SKU digunakan bersama. Draft simulator dan riwayat
konsultasi terpisah per akun. Semua akun aplikasi dapat mengubah Master SKU;
belum ada pembagian peran admin/operator.

Setiap penyimpanan menyertakan revisi. Server menolak revisi lama dengan HTTP 409,
sehingga penyimpanan dari dua tab atau dua pengguna tidak menimpa perubahan
tanpa diketahui. Antarmuka hanya menyatakan berhasil setelah server mengakui
penyimpanan. Kegagalan database tidak memicu perpindahan diam-diam ke localStorage.

## Cakupan integration test pada MySQL 5.7.24

1. Migrasi dan seed dari database kosong; masing-masing dapat dijalankan dua kali.
2. Pembuatan akun, penolakan akun duplikat tanpa mengganti password, serta diagnosis `doctor`.
3. Bootstrap, dokumen pengguna/Master SKU, dan katalog mentah memerlukan autentikasi.
4. Login benar/salah, username injeksi, dan penolakan Origin asing.
5. Bootstrap memuat katalog lengkap dari database.
6. CSRF, header CSRF Unicode, dan Origin salah tidak dapat mengubah dokumen.
7. Simpan/baca draft mempertahankan frame, warna, sentrasi, Unicode, dan emoji.
8. Draft/riwayat antarakun terpisah; parameter query tidak dapat mengganti pemilik data.
9. Revisi lama ditolak; dua penulisan bersamaan menghasilkan satu pemenang.
10. Master SKU mendukung enam indeks, kode berapostrof, Unicode, dan akses bersama.
11. Supplier, blank, rentang power, dan duplikat yang tidak valid ditolak tanpa perubahan data.
12. Riwayat konsultasi dapat disimpan/dibaca; entri rusak dan ID duplikat ditolak.
13. JSON rusak, prototype keys, revisi salah, state tidak valid, dan body di atas 8 MiB ditolak.
14. Server tidak menyajikan source backend, konfigurasi database, `.env`, atau berkas di luar `dist/`; traversal path dan akses katalog melalui repeated slash diblokir.
15. Migrasi/seed ulang mempertahankan dokumen pengguna dan revisi Master SKU.
16. Restart aplikasi mempertahankan data dan sesi yang masih berlaku.
17. Sesi kedaluwarsa atau telah logout tidak dapat membaca/mengubah data.
18. Connection pool yang telah ditutup menghasilkan HTTP 503 tersanitasi pada health endpoint, tanpa password, query SQL, atau path internal.

Penolakan penyimpanan, respons yang terputus setelah commit, dan perilaku tanpa
acknowledgement diuji secara terpisah dalam suite adapter penyimpanan. Kasus
database nomor 18 memeriksa health endpoint, bukan PUT saat database terputus.

Setelah integration test, mysqld dihentikan dan dijalankan kembali.
Pemeriksaan terpisah memastikan state, riwayat, dan Master SKU masih sesuai.

## Cakupan regresi simulator

### Pengujian otomatis

- Kontur, effective diameter, lebar/tinggi frame, DBL, PD, tinggi sentrasi,
  kebutuhan diameter blank R/L, allowance, dan batas kecocokan diameter.
- Diameter aktual dalam katalog; supplier, produk, indeks, base curve, serta
  batas power bahan dan batas power SKU.
- Semua 13 bentuk pada tiga jenis frame; pencerminan R/L dan kontur halus.
- Full Rim, Half Rimless, Rimless, show/hide frame dan tangkai, rotasi/proyeksi,
  dan ketetapan mesh optik serta CT/ET saat lapisan frame berubah.
- Sembilan bentuk 001–009 tetap identik; empat bentuk tambahan mengikuti aperture SVG.
- Validasi SKU, konfigurasi multiindeks, assignment blank, impor/merge, identitas
  duplikat, batas 1.000 SKU, dan error penyimpanan.
- Adapter asinkron tidak memperbarui cache otoritatif sebelum acknowledgement;
  retry merekonsiliasi respons yang hilang; konflik tidak menimpa data server.
- Impor konsultasi memeriksa schema, input angka/boolean/ID, shape, material,
  sentrasi per mata, kamera, warna khusus, SKU, dan preferensi frame/tangkai.

### Pemeriksaan antarmuka browser

- Seluruh indeks 1.50, 1.56, 1.57, 1.60, 1.67, dan 1.74 dapat dipilih.
- Pilihan A dan B masing-masing berisi sepasang R/L; anotasi A/B/DBL,
  CT pusat, dan ketebalan maksimum tampil di dekat preview.
- Pembuatan, ekspor, arsip, aktivasi, dan impor ulang Master SKU.
- SKU 1.60 membatasi pilihan indeks dan memakai assignment produk/blank DMO.
- Blank diameter 75 / BC 3 dapat dipilih ketika lolos syarat.
- Memperbesar frame melampaui kapasitas blank melepas pilihan blank sebelumnya.
- Cat-eye, warna khusus CONG, sinkronisasi tint A/B, serta catatan tint tersimpan.
- Tint 42S menampilkan konflik 70% / 80% dari sumber; warna tidak ditebak.
- Rotasi 360°, reset sudut, Half Rimless, Rimless, sembunyikan/tampilkan frame,
  dan sembunyikan/tampilkan tangkai.
- Simpan konsultasi, reload, buka riwayat, dan pulihkan setting.
- Ekspor JSON menyatakan applicationVersion 2.0.0 dan mode penyimpanan.
- Impor JSON konsultasi ditinjau dahulu; berkas Master SKU yang salah dipilih
  pada impor konsultasi ditolak tanpa menambah riwayat.
- Ekspor PNG memuat kedua lensa pada pilihan terkait, tint, jenis frame,
  A/B/DBL, CT, ET, dan ketebalan maksimum.
- Panel data bahan dan referensi warna menampilkan katalog serta alasan kecocokan.

Katalog yang digunakan: **66 tint, 13 shape, 19 produk bahan, dan 186 definisi
blank**, berasal dari sumber yang telah disetujui pada iterasi sebelumnya.
Katalog material memuat 2.026 aturan unik dari 2.689 baris sumber; 663 duplikat
dihilangkan sesuai proses ekstraksi sebelumnya.

## Temuan yang telah diperbaiki

| Temuan | Perbaikan |
| --- | --- |
| Header CSRF Unicode dapat menyebabkan perbandingan byte melempar error | Perbandingan memeriksa panjang byte sebelum timingSafeEqual |
| Repeated slash pada URL dapat melewati pemilahan route | Path dinormalisasi sebelum keputusan routing dan autentikasi |
| Nama advisory lock dapat melebihi batas MySQL | Nama lock dibatasi dengan identitas hash |
| Rentang Node yang terlalu longgar | Versi runtime diterima dibatasi pada major 22 atau 24 |
| UI dapat mengaku berhasil sebelum write selesai | Operasi simpan/import/aktivasi menunggu acknowledgement |
| Respons write hilang setelah server commit | Retry membaca ulang dan merekonsiliasi data yang sama |
| Edit SKU serentak berisiko menimpa master | Compare-and-swap revisi, konflik 409, dan draft editor dipertahankan |
| SKU ke-1.001 dapat membuat katalog gagal dimuat | Validasi keseluruhan katalog sebelum commit |
| Metadata riwayat rusak dapat membuat panel gagal | Pembacaan defensif dan validasi impor yang ketat |
| Akun berubah saat pemulihan sesi | Akun baru tidak boleh menerima draft akun sebelumnya |
| Generator bergantung pada path workspace | Input sumber dipindahkan ke argumen CLI eksplisit |

## Cara menjalankan ulang

Dari folder aplikasi:

```sh
npm ci
npm run build
npm test
```

Integration test bersifat destruktif terhadap database uji. Skrip berhenti
sebelum mengakses database kecuali kedua syarat ini dipenuhi:

```text
LEINZ_ALLOW_TEST_DB=1
MYSQL_DATABASE=leinz_test_<nama_database_disposable>
```

Gunakan database uji khusus beserta konfigurasi koneksinya, lalu:

```sh
npm run test:mysql
```

Skrip `tools/test-server.mjs` mencakup restart aplikasi. Untuk verifikasi setelah
database dihentikan dan dijalankan kembali, gunakan dataset uji yang sama:

```sh
node tools/test-server.mjs --verify-persistence
```

Jangan mengarahkan integration test ke database produksi atau database yang
berisi data penting. Panduan instalasi harian tidak memerlukan `test:mysql`.

## Batas verifikasi

- Login/session dan persistence MySQL diuji melalui integration test nyata;
  halaman login diperiksa visual. Alur browser setelah login ke backend MySQL
  belum diuji manual dari ujung ke ujung. Regresi UI dilakukan dalam mode
  browser, sedangkan adapter API diuji otomatis.
- Server, port, firewall, hak user database, reverse proxy, dan storage milik
  Timur Raya Lestari belum diakses atau diubah.
- Tidak melakukan load test skala produksi, sertifikasi keamanan, pengujian
  seluruh browser/perangkat, pencetakan fisik, atau pemulihan dari backup nyata.
- Preview Sites tetap memakai penyimpanan browser. Instalasi server dalam paket
  adalah jalur penggunaan MySQL. Dua mode ini ditandai secara eksplisit di UI.
- Model ketebalan memakai asumsi minimum 1,5 mm dan belum merupakan kalkulasi
  produksi Lensware. CT/ET bahan baku dipertahankan sebagai data referensi.
- Warna layar bersifat ilustratif; validasi produksi memerlukan acuan lab.
- Tidak ada koneksi live ke Lensware, ERP, stok real-time, atau mesin edging.

