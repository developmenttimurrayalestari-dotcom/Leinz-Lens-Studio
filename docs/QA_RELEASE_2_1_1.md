# QA paket lengkap — Leinz Lens Studio 2.1.1

Tanggal: **4 November 2026**. Paket: **Leinz-Lens-Studio-2.1.1-Full-Source-Database.zip**.
Source aplikasi berasal dari commit `01c9e2bb488061b0fad5e586718dd117f4d1aeed`.
Paket lengkap menambahkan SQL siap impor, generator SQL, inventaris master, dan
panduan instalasi. Kode aplikasi dan perhitungan versi 2.1.1 dipertahankan.

**Hasil:** instalasi dependency, build, pengujian otomatis, impor SQL, startup,
login/API, backup/restore, serta persistensi setelah restart lulus pada lingkungan
di bawah. Pemeriksaan dijalankan ulang untuk paket ini; laporan versi sebelumnya
merupakan bukti historis yang terpisah.

## Lingkungan pengujian

| Komponen | Versi / konfigurasi |
| --- | --- |
| OS eksekusi | Linux x64, Ubuntu 24.04 |
| Node.js | 24.22.1 |
| npm | 11.9.0 |
| Driver | mysql2 3.24.6 dari lockfile |
| Database server | **MySQL Community Server 5.7.24**, diverifikasi dengan `SELECT VERSION()` |
| MySQL client / mysqldump | **5.7.24** |
| Penyimpanan | InnoDB; utf8mb4 / utf8mb4_unicode_ci |
| Packet | 16 MiB |
| SQL mode | Strict mode termasuk ONLY_FULL_GROUP_BY; impor terpisah juga diuji dengan NO_BACKSLASH_ESCAPES |
| Koneksi | TCP localhost pada database QA terpisah |

Runtime database resmi diunduh dari arsip MySQL. Ukuran arsip
`mysql-5.7.24-linux-glibc2.12-x86_64.tar.gz` adalah 644.930.593 byte dan MD5
`075dccd655e090ca999e2c8da3b67eb7`, cocok dengan checksum resmi. Binary database,
library runtime QA, file kredensial, dan database uji tidak disertakan dalam ZIP.

Lingkungan QA membatasi Unix socket serta memisahkan jaringan setiap proses
eksekusi. Database dan seluruh client uji dijalankan bersama dalam satu ruang
eksekusi dengan TCP loopback. Penyesuaian ini hanya konfigurasi QA; source
aplikasi tetap memakai pengaturan MySQL pada `.env`.

## Instalasi bersih dan build

Source dibungkus sebagai kandidat ZIP, diekstrak ke folder kosong yang terpisah,
lalu diperiksa dari folder hasil ekstraksi:

| Perintah / pemeriksaan | Hasil |
| --- | --- |
| `npm ci` | Exit 0; 12 package terpasang dari lockfile |
| `npm run build` | Exit 0; **31 berkas JavaScript valid**, aset HTML dan JSON tersedia |
| `npm test` | Exit 0; **121 pengujian bernama lulus, 0 gagal** |
| Blank engine | Seluruh assertion lulus |
| Lens viewer | Seluruh assertion lulus |
| Referensi HTML | 22 referensi lokal tersedia; 162 ID unik |
| Gambar master | 48 referensi gambar tersedia |

Build aplikasi ini adalah pemeriksaan source JavaScript, aset, dan katalog.
Frontend siap disajikan berada pada `dist/`; tidak ada transpile atau compiler
native tambahan. Satu dari 31 berkas adalah generator SQL yang ditambahkan pada
paket lengkap. Aplikasi sebelumnya memiliki 30 berkas JavaScript.

121 pengujian terdiri dari 24 tes SKU dan 97 tes backend dasar, storage,
konsultasi, validator katalog, pengelolaan master, dan model optik. Suite
blank/viewer berisi assertion tambahan di luar hitungan tersebut.

## Integrasi aplikasi dengan MySQL nyata

`npm run test:mysql` lulus **24 kelompok pengujian**, termasuk:

- Migrasi baru, upgrade skema lama, serta migrasi/seed berulang.
- Pembuatan akun, login, sesi, CSRF, Origin, dan isolasi dokumen antar akun.
- Semua master dibaca dari MySQL dan dibandingkan dengan sumber melalui hash
  kanonis, bukan hanya jumlah record.
- Tambah/ubah/arsip material, blank, aturan power, shape, tint, profil optik, dan
  SKU dengan assignment indeks/supplier/blank.
- Transaksi katalog atomik; kegagalan SQL pada update terakhir membatalkan
  perubahan sebelumnya dan revisinya.
- Penolakan relasi atau input tidak valid, benturan revisi, penyimpanan
  bersamaan, dan respons kegagalan database tanpa pengakuan simpan yang keliru.
- Penyimpanan resep, sentrasi, frame/tangkai, tint, catatan Unicode, dan riwayat.
- Perlindungan route privat, source/configuration, serta path tidak valid.

Setelah proses MySQL dihentikan dan dimulai kembali, **satu pengujian persistensi
tambahan** lulus untuk state, riwayat, SKU, master yang telah diedit, dan profil
optik. Data fixture QA hanya berada dalam database uji, bukan SQL distribusi.

## Impor SQL dan backup/restore

Delapan pemeriksaan baru dijalankan memakai MySQL client 5.7.24:

1. Versi runtime tepat 5.7.24 dan database target uji kosong.
2. SQL gabungan membuat tujuh tabel, migrasi 1–2, dan seluruh master sumber.
3. Impor gabungan berulang mempertahankan revisi serta timestamp.
4. Impor skema lalu master secara terpisah berhasil dengan NO_BACKSLASH_ESCAPES.
5. Master yang diubah dan SKU valid dapat disimpan pada database uji terpisah.
6. Impor ulang mempertahankan master/SKU yang telah diubah, revisi, dan timestamp.
7. `mysqldump --single-transaction --hex-blob --set-gtid-purged=OFF` berhasil
   menghasilkan backup database referensi, lalu backup diimpor ke database baru.
8. Database hasil restore identik dan berhasil menginisialisasi store aplikasi.

**Hasil: 8 lulus, 0 gagal.** SQL memakai JSON UTF-8 dalam literal hex dan fungsi
`CONVERT(... USING utf8mb4)`, sehingga karakter kutip, backslash, Unicode, kontur,
metadata, dan seluruh relasi master terpelihara. SQL distribusi tidak memuat
DROP/TRUNCATE atau akun/password bawaan. Generator menghasilkan byte yang sama
ketika dijalankan ulang dari direktori kerja berbeda.

## Master yang benar-benar disertakan

| Master | Jumlah |
| --- | ---: |
| Supplier | 2: DMO dan SOA |
| Produk material | 19 |
| Spesifikasi blank | 186 |
| Aturan power unik | 2.026 |
| Frame shape | 13 |
| Tinting | 66 |
| SKU produk finish pada sumber | **0** |

Relasi produk → blank → aturan power tidak memiliki orphan atau ID duplikat.
Referensi seluruh 2.689 baris CSV koreksi terpelihara, termasuk 663 baris duplikat
tanpa menggandakan aturan unik. Data indeks 1.59 tetap tersimpan sebagai katalog;
enam indeks simulator adalah 1.50, 1.56, 1.57, 1.60, 1.67, dan 1.74.

| Katalog | SHA-256 isi kanonis |
| --- | --- |
| materials | `c0efc3b8b9535b38fb0a48760521275ff159d26af802bf8d21c185ad42fea456` |
| shapes | `6f2257c279bb0fe691d0deda99c1255b0171c1653134d254b88098ed721822a6` |
| tints | `ed19014abcb814dc9e723324ad1ebb8a385a26fb80bddbf0176c3fbd91700a65` |

Hash sumber, SQL hasil impor, dan database hasil restore cocok. Inventaris
per supplier, indeks, diameter, bentuk, dan jenis tint tersedia dalam
`database/master-data-inventory.json`.

Source tidak berisi ekspor Master SKU produksi dari browser atau database
perusahaan. Screenshot CREA2 tidak cukup untuk menentukan seluruh assignment
blank dan batas power. Paket menyediakan struktur SKU kosong yang sama dengan
seed aplikasi; konfigurasi SKU yang sudah ada dapat dipindahkan melalui
Ekspor/Impor JSON pada Master SKU. SQL ini adalah paket instalasi master sumber,
bukan backup database operasional pengguna.

## Startup dari hasil ekstraksi

Pada database yang dibuat melalui **SQL gabungan**, `npm run admin:create` dan
`npm run doctor` berhasil. `npm start` benar-benar dijalankan dari hasil ekstraksi
ZIP. Pemeriksaan HTTP/API membuktikan:

- Halaman utama merespons 200 dan memuat kontrol layout 2.1.1.
- Runtime menyatakan mode `mysql`.
- Health melaporkan versi aplikasi 2.1.1, database 5.7.24, dan `ready: true`.
- Login akun uji berhasil; bootstrap terautentikasi membaca jumlah master di atas.
- State dengan bentuk Rectangle, lebar 54 mm, resep −5/−1, pasangan aktif B,
  indeks A 1.74/B 1.50, dan catatan Unicode berhasil disimpan.
- Setelah aplikasi dan MySQL direstart, login kembali berhasil; state dan semua
  katalog identik dengan nilai sebelum restart.

## Keutuhan paket dan batas verifikasi

`RELEASE_CODE_SHA256.json` mencatat **108 berkas** kode, dependency manifest,
konfigurasi contoh, SQL, inventaris, dan aset yang diuji dari hasil ekstraksi.
Arsip akhir mempertahankan hash tersebut; sesudah pengujian hanya laporan/log
QA yang dilengkapi. Integritas ZIP dan keberadaan berkas wajib juga diperiksa.

Log baru berada pada [`qa-results/2.1.1-full/`](qa-results/2.1.1-full/). Peringatan
npm mengenai `http-proxy` berasal dari environment pengujian, bukan paket. Tidak
ada kegagalan instalasi, build, assertion, impor/restore SQL, atau startup dalam
pemeriksaan yang dinyatakan lulus.

QA antarmuka visual 2.1.1 sebelumnya tetap tercatat dalam
[QA_2_1_1.md](QA_2_1_1.md), termasuk frame/resep di atas tint dan viewport
1366×768, 1000×768, serta 390×844. QA paket lengkap ini menambahkan pengujian
instalasi/database/API; seluruh interaksi browser tidak diulang secara manual.

Node.js 22, Windows, phpMyAdmin/HeidiSQL UI, konfigurasi reverse proxy/layanan,
dan server perusahaan tidak dieksekusi dalam QA ini. Tidak ada kredensial atau
koneksi database perusahaan yang digunakan. Kesesuaian CT/ET terhadap hasil
produksi Lensware juga belum merupakan hasil kalibrasi produksi; lihat
[OPTICS_MODEL.md](OPTICS_MODEL.md).

Hasil ini berlaku pada cakupan dan lingkungan yang diuji, bukan jaminan bahwa
seluruh kombinasi input, browser, dan konfigurasi server bebas dari bug.
