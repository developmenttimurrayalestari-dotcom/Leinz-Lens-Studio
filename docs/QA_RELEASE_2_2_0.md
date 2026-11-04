# Laporan QA Leinz Lens Studio 2.2.0

**Tanggal verifikasi: 4 November 2026.** Paket rilis telah diekstrak ke direktori kosong, dipasang ulang dengan `npm ci`, diperiksa melalui `npm run build`, dan diuji dengan `npm test`. Integrasi database dijalankan terhadap **MySQL 5.7.24 yang sebenarnya**. Pemeriksaan antarmuka mencakup impor CSV/Excel, pengujian beberapa resep, photochromic per pasangan A/B, penyimpanan konsultasi, dan tata letak responsif.

Semua pemeriksaan yang tercatat di bawah selesai dengan hasil lulus. Hasil ini menunjukkan cakupan yang telah diverifikasi pada rilis ini; hasil uji tidak menyatakan bahwa setiap kombinasi lingkungan dan input yang mungkin telah diuji.

## 1. Ringkasan hasil

| Pemeriksaan | Hasil | Bukti |
|---|---|---|
| Instalasi dependency dari paket yang diekstrak ke direktori kosong | `npm ci` selesai; 12 package dipasang | [npm-ci.txt](qa-results/2.2.0/npm-ci.txt) |
| Pemeriksaan build | 40 berkas JavaScript valid; aset HTML tersedia; katalog JSON dapat dibaca | [npm-build.txt](qa-results/2.2.0/npm-build.txt) |
| Suite utama `node:test` | 157 lulus, 0 gagal, 0 dilewati | [npm-test.txt](qa-results/2.2.0/npm-test.txt) |
| Suite SKU yang dijalankan tersendiri | 24 lulus, 0 gagal, 0 dilewati | [npm-test.txt](qa-results/2.2.0/npm-test.txt) |
| Assertion geometri/BlankEngine dan viewer | Selesai tanpa kegagalan | [npm-test.txt](qa-results/2.2.0/npm-test.txt) |
| Integrasi aplikasi dan MySQL 5.7.24 | 29 kelompok pengujian lulus, 0 gagal | [mysql-integration.txt](qa-results/2.2.0/mysql-integration.txt) |
| Impor SQL, pengulangan impor, dan backup/restore | 8 pemeriksaan lulus, 0 gagal | [sql-install-qa.json](qa-results/2.2.0/sql-install-qa.json), [sql-import.txt](qa-results/2.2.0/sql-import.txt) |
| Persistensi setelah database dimulai ulang | Lulus; state, riwayat, SKU, dan master tetap tersedia | [mysql-restart.txt](qa-results/2.2.0/mysql-restart.txt) |
| Startup dengan `npm start` dan pemeriksaan aplikasi | Lulus; HTTP 200, mode MySQL, bootstrap terautentikasi dan putaran simpan/baca berhasil | [npm-start-smoke.json](qa-results/2.2.0/npm-start-smoke.json), [npm-start.txt](qa-results/2.2.0/npm-start.txt) |
| Kesesuaian berkas final dengan ekstraksi yang telah diuji | Seluruh 131 berkas kode/data/template sama persis; tidak ada perbedaan | [final-code-comparison.json](qa-results/2.2.0/final-code-comparison.json) |

Jumlah pengujian bernama yang dilaporkan oleh `node:test` adalah **181**, terdiri dari 157 pengujian suite utama dan 24 pengujian SKU. Assertion pada skrip BlankEngine dan viewer dilaporkan terpisah dan tidak ditambahkan ke angka tersebut. Kelompok integrasi MySQL dan pemeriksaan SQL juga menggunakan hitungan tersendiri.

Log npm memuat peringatan konfigurasi `http-proxy` dari lingkungan eksekusi QA. Instalasi, pemeriksaan build, dan pengujian tetap selesai dengan hasil berhasil. Aplikasi ini menggunakan JavaScript yang diperiksa langsung; perintah build tidak memerlukan tahap kompilasi tambahan.

## 2. Master data yang disertakan

Jumlah master pada source, hasil impor SQL, dan bootstrap aplikasi MySQL sesuai:

| Master | Jumlah |
|---|---:|
| Produk bahan baku | 19 |
| Spesifikasi blank fisik | 186 |
| Aturan cakupan power unik | 2.026 |
| Frame shape | 13 |
| Tinting | 66 |
| SKU awal dalam seed | 0 |

Indeks 1.59 tetap tersimpan pada katalog bahan baku sebagai data katalog. Enam indeks simulator tetap 1.50, 1.56, 1.57, 1.60, 1.67, dan 1.74.

SKU `DEMO-IMPORT` pada template adalah contoh nonaktif. Penerapannya saat QA dilakukan pada data pengujian lokal. Contoh tersebut tidak ditambahkan ke seed rilis dan tidak mengubah jumlah SKU awal menjadi satu.

Hash kanonis master yang tercatat pada pemeriksaan database:

| Katalog | SHA-256 kanonis |
|---|---|
| Materials | `c0efc3b8b9535b38fb0a48760521275ff159d26af802bf8d21c185ad42fea456` |
| Shapes | `6f2257c279bb0fe691d0deda99c1255b0171c1653134d254b88098ed721822a6` |
| Tints | `ed19014abcb814dc9e723324ad1ebb8a385a26fb80bddbf0176c3fbd91700a65` |

Hash ini merupakan hash representasi katalog kanonis yang digunakan oleh pemeriksaan, sehingga tidak harus sama dengan hash byte berkas JSON yang memiliki indentasi berbeda. Bukti jumlah dan hash tersedia pada [hasil integrasi MySQL](qa-results/2.2.0/mysql-integration.txt) serta [hasil impor SQL](qa-results/2.2.0/sql-install-qa.json).

## 3. Impor CSV dan Excel

Empat jenis master memiliki pasangan template CSV dan Excel: blank/raw material, frame shape, tinting, dan SKU. Delapan file telah dibaca melalui importer aplikasi. Kesetaraan nilai CSV/XLSX, tipe angka, boolean Excel, kode dengan nol di awal, header, dan penanganan sheet Petunjuk telah diperiksa. Server juga berhasil melayani delapan file melalui GET dengan byte yang tepat, MIME yang sesuai, dan HEAD tanpa body.

Pengujian mencakup validasi sebelum penerapan, penolakan data yang tidak valid, penanganan duplikat, penyimpanan asal data, perlindungan terhadap preview impor yang sudah kedaluwarsa, serta pengulangan impor tanpa perubahan yang tidak diperlukan.

### Cakupan blank tetap mengikuti kombinasi tiap baris

Setiap baris menyimpan satu kombinasi SPH, CYL, dan ADD. Ketiganya harus cocok bersama pada baris yang sama. Beberapa baris untuk blank yang sama merupakan pilihan cakupan yang berbeda. Rentang tidak digabung menjadi satu minimum/maksimum global yang dapat meloloskan resep di luar data supplier.

Fixture dari data acuan DMO/SPHG60, BC 1.00, diameter 75 mm telah diperiksa melalui importer dan BlankEngine:

| SPH | CYL | ADD | Hasil untuk blank tersebut |
|---:|---:|---:|---|
| −9.00 | −4.00 | 0.00 | Tercakup |
| −9.00 | 0.00 | +1.00 | Tercakup |
| −9.00 | −4.00 | +1.00 | Tidak tercakup |

Angka nol tetap literal: CYL 0–0 hanya menerima CYL nol, dan ADD 0–0 hanya menerima ADD nol. Sel kosong tidak dianggap nol. Batas minimum/maksimum yang terbalik ditolak.

Impor mengganti seluruh aturan untuk blank yang tercantum di dalam berkas. Aturan blank lain tetap tersimpan. Karena itu, template blank menyertakan seluruh dua aturan untuk satu blank contoh. Pengujian memeriksa pelestarian ID, status arsip, profil finishing optik, assignment SKU, serta asal sheet dan nomor baris untuk aturan baru.

### Temuan regresi yang telah diperbaiki

- **Benturan ID SKU setelah perubahan kode.** Mengimpor kembali kode lama dari SKU yang telah diganti kodenya kini menghasilkan identitas baru yang tersedia, sehingga SKU yang telah diganti kode tetap tersimpan.
- **Pembulatan indeks dalam deskripsi.** Nilai deskripsi yang tidak termasuk indeks yang didukung, seperti 1.599 atau 1.6001, ditolak. Pemeriksaan juga berlaku ketika produk sudah dikenal atau file menyediakan kolom indeks eksplisit.
- **Penerapan sebagian file.** Baris tidak valid yang muncul setelah baris valid membatalkan persiapan impor secara keseluruhan. Data sebelumnya tidak berubah.

Pemeriksaan tersebut tercakup dalam suite otomatis, termasuk [test-import-regressions.mjs](../tools/test-import-regressions.mjs) dan [test-tabular-import.mjs](../tools/test-tabular-import.mjs).

## 4. Verifikasi antarmuka di browser

Verifikasi manual dilakukan pada aplikasi yang berjalan, dengan hasil berikut:

| Skenario | Hasil pengamatan |
|---|---|
| Photochromic pada pasangan A dan B dengan UV 0%, 50%, dan 100% | Kontrol dan perubahan pratinjau bekerja pada pasangan yang dipilih |
| Tint ketika photochromic aktif | Pilihan tint pada pasangan tersebut terkunci sesuai aturan |
| Pasangan lain tetap non-photochromic | Pasangan tersebut tetap dapat memilih tint |
| Perubahan UV dengan resep dan geometri tetap | Nilai CT dan ET tidak berubah |
| Muat ulang aplikasi, ekspor JSON konsultasi schema 1.4, dan pembacaan hasil ekspor oleh validator impor | State photochromic dan UV dipertahankan |
| Impor workbook acuan blank | Terbaca 2.689 baris, 663 duplikat identik, dan 2.026 aturan unik; master tetap sama sehingga tidak perlu disimpan ulang |
| Impor template blank CSV | Hasil sama dengan master yang tersedia; tidak menambah atau mengganti data identik |
| Impor dengan minimum range melebihi maksimum | Diblokir dan kesalahan ditampilkan sebelum penerapan |
| Impor contoh SKU nonaktif | Dapat diterapkan pada data QA lokal; status tetap nonaktif |
| Pengujian dua resep sekaligus | Hasil tiap baris dihitung secara independen dan dapat diekspor sebagai CSV |
| Tata letak iframe 390 px, viewport dalam 375 px | Tidak ada overflow horizontal; kontrol photochromic dan UV tetap tersedia dan berfungsi |
| Tata letak iframe 1.000 px, viewport dalam 985 px | Lebar body 985 px tanpa overflow horizontal; kontrol aktif, UV 0%, dan pengaturan frame/resep berada sebelum tint |

Ukuran iframe dan viewport dalam dicatat terpisah karena area scrollbar/browser memengaruhi lebar yang tersedia untuk halaman.

## 5. Database dan instalasi MySQL 5.7.24

Versi runtime yang dilaporkan database adalah **5.7.24**, dengan `max_allowed_packet` 16.777.216 byte. Mode SQL yang diuji mencakup `ONLY_FULL_GROUP_BY`, `STRICT_TRANS_TABLES`, `NO_ZERO_IN_DATE`, `NO_ZERO_DATE`, dan `ERROR_FOR_DIVISION_BY_ZERO`. Pemeriksaan tambahan menjalankan impor schema dan master terpisah dengan `NO_BACKSLASH_ESCAPES`.

Pemeriksaan instalasi mencakup:

- Migrasi dan seed yang dapat dijalankan ulang, termasuk migrasi dari schema 2.0 tanpa menghilangkan akun, SKU, katalog, atau konsultasi.
- Impor SQL gabungan yang membentuk tujuh tabel serta seluruh master acuan, dan jalur impor schema/master terpisah.
- Pengulangan impor yang mempertahankan revisi, timestamp, master yang telah diedit, dan SKU yang tersimpan.
- Pembuatan backup dengan `mysqldump`, restore melalui client `mysql`, serta pembandingan hasil restore dengan database acuan.
- Penyimpanan master secara atomik, rollback ketika penulisan terakhir gagal, dan penolakan perubahan dengan revisi yang sudah kedaluwarsa.
- Login, isolasi state/riwayat pengguna, proteksi sesi dan CSRF, serta penolakan input invalid tanpa mengubah data yang sudah tersimpan.
- Putaran simpan/baca state photochromic, UV dan riwayat schema 1.4, serta kompatibilitas riwayat schema 1.3.
- Startup aplikasi, restart aplikasi, restart database, dan pembacaan kembali data yang telah dikomit.

Catatan runtime tersedia pada [mysql-runtime.txt](qa-results/2.2.0/mysql-runtime.txt). Rincian 29 kelompok integrasi, delapan pemeriksaan SQL, dan restart tersedia pada log yang ditautkan di ringkasan.

## 6. Batas verifikasi dan interpretasi

**Skala UV pada photochromic adalah kontrol ilustrasi visual generik.** Angka 0–100% tidak menyatakan VLT, intensitas UV terukur, waktu aktivasi/pemudaran, atau kalibrasi berdasarkan material/produk tertentu. Perubahan pratinjau tidak mengubah perhitungan ketebalan. QA perangkat lunak ini tidak memvalidasi model terhadap hasil pengukuran produksi lensa, transmisi spektral, atau waktu respons photochromic di laboratorium.

**Pratinjau Site menggunakan penyimpanan browser.** Paket instalasi yang dijalankan dengan server dan MySQL menggunakan penyimpanan database. Pengujian kedua alur tersebut tidak mengubah Site menjadi server MySQL, dan data lokal pada browser tidak otomatis menjadi data instalasi perusahaan.

Pengujian runtime instalasi dilakukan pada lingkungan Linux. **Runtime Windows belum diuji secara langsung** dalam QA rilis ini. Dokumen instalasi dan kompatibilitas MySQL 5.7.24 tetap perlu diikuti pada lingkungan tujuan, terutama konfigurasi koneksi database dan akun aplikasi.

## 7. Log yang disertakan

Direktori [qa-results/2.2.0](qa-results/2.2.0/) berisi sebelas salinan log/hasil eksekusi yang relevan dan satu [manifest log](qa-results/2.2.0/log-manifest.json). Nilai lulus/gagal, jumlah pengujian, versi aplikasi/database, dan hash master dipertahankan. Nama database QA sementara serta port listener disamarkan. Metadata berkas backup sementara dihapus dari ringkasan SQL; hasil pengujian backup/restore tetap tercatat.

Konfigurasi runtime QA, kredensial, token/sesi, data pengguna, dump database sementara, script bootstrap QA, dan binary runtime tidak disertakan dalam direktori hasil ini. Pemeriksaan antarmuka manual dicatat pada bagian 4 laporan ini.
