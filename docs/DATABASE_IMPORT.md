# Impor database dan master data — Leinz Lens Studio 2.2.0

Pembaruan skema 4 (range SKU per diameter): ikuti [panduan normalisasi](NORMALISASI_DATABASE.md).
Sesudah impor SQL, jalankan `npm run db:migrate` untuk mengekstrak dan
memverifikasi data relasional sebelum menjalankan server.

Paket ini menyediakan **SQL MySQL 5.7.24 beserta seluruh master referensi yang
tersedia di source**. Berkas SQL dapat diimpor langsung melalui MySQL client,
phpMyAdmin, atau HeidiSQL. Source aplikasi dan file JSON master tetap disertakan.

SQL ini adalah data instalasi awal. Untuk memindahkan instalasi yang sudah
digunakan, backup database instalasi tersebut agar perubahan master, SKU, akun,
dan konsultasi ikut terbawa. Petunjuk backup/restore ada pada
[INSTALL_MYSQL57.md](INSTALL_MYSQL57.md).

## 1. Pilih berkas sesuai kebutuhan

| Berkas dalam `database/` | Isi dan penggunaan |
| --- | --- |
| `leinz-schema-and-master-data.sql` | **Pilihan utama untuk instalasi baru**: tabel lama dan relasional baru beserta master referensi lengkap; lanjutkan dengan `db:migrate` untuk backfill dan marker skema 4. |
| `leinz-schema.sql` | Skema saja, termasuk tabel revisi katalog. Belum mengisi material, shape, tint, atau dokumen SKU. |
| `leinz-master-data.sql` | Master saja. Impor setelah skema tersedia; gunakan jika pembuatan tabel ditangani terpisah. |
| `master-data-inventory.json` | Jumlah record, perincian supplier/indeks/diameter, SHA-256 isi JSON, dan checksum ketiga SQL. |
| `001_initial.sql`, `002_managed_catalogs.sql`, `003_relational_documents.sql`, `004_sku_power_ranges.sql` | DDL yang dipakai `npm run db:migrate`; backfill Node.js wajib sebelum skema baru siap. |

Pilih **SQL gabungan**, atau **skema lalu master**. Tidak perlu menjalankan kedua
cara sekaligus. File yang telah selesai dibuat dapat langsung diimpor; tidak
perlu menjalankan generator terlebih dahulu.

## 2. Master data yang disertakan

| Master | Jumlah |
| --- | ---: |
| Supplier pada produk material | 5: DMO, SOA, TRN, UNI, WXG |
| Produk material | 91 |
| Spesifikasi blank | 796 |
| Aturan power unik | 6.829 |
| Frame shape | 13 |
| Kode tinting | 66: 46 Solid dan 20 Gradient |
| Master SKU produk finish | **0** pada sumber paket |

Frame shape meliputi **001–009, Rounded/Bulat, Cat-eye, Rectangle, dan Square**.
Indeks simulator tetap **1.50, 1.56, 1.57, 1.60, 1.67, dan 1.74**. Data indeks
**1.59 dan 1.61** dari sumber tetap tersimpan sebagai katalog, tanpa diaktifkan sebagai
pilihan simulator.

Material mengikuti berkas **DMO UNI OSA WXG TRN.xlsx** yang sudah dibandingkan
dengan database. Seluruh **6.829 baris** dipertahankan sebagai aturan unik,
tanpa baris duplikat identik pada workbook baru. Provenance lama tetap tersedia
pada record existing dan backup sebelum sinkronisasi.
Diameter, base curve, CT/ET bahan, rentang power, dan relasi produk/blank tetap
utuh. JSON juga menyimpan kontur frame, warna, sumber, dan catatan tinting.

**Master SKU perlu diperhatikan:** source tidak memuat ekspor lengkap Master SKU
yang telah diisi pada browser atau database pengguna. SKU **CREA2** yang terlihat
pada gambar tidak menyediakan seluruh assignment supplier/blank dan rentang
power. Paket tidak menebak data tersebut. Jika SKU sudah dibuat pada instalasi
lama, ekspor melalui **Manage → Master SKU → Ekspor JSON**, lalu impor di
instalasi baru. SKU yang sudah ada dalam database target tetap dipertahankan.

Paket SQL membawa data referensi melalui kolom JSON lama, lalu `db:migrate`
mengekstraknya ke tabel `leinz_rel_*`. Backend membaca dan menulis tabel
relasional tersebut. Tabel `leinz_catalog_documents` mempertahankan tiga dokumen
asal (`materials`, `shapes`, `tints`) sebagai backup; `leinz_workspace_documents`
mempertahankan JSON SKU asal. Format respons API tetap sama.

## 3. Persiapan database

Gunakan **database khusus aplikasi**, dengan MySQL 5.7.24, karakter `utf8mb4`,
collation `utf8mb4_unicode_ci`, dan `max_allowed_packet` minimal 8 MB
(konfigurasi yang disarankan pada panduan instalasi adalah 16M).

Untuk impor paket SQL master terbaru, gunakan `max_allowed_packet` **minimal
16 MB** karena literal hex master material berukuran lebih dari 8 MB. Jalankan
`db:migrate` setelah impor untuk backfill relasional terverifikasi.

Ikuti langkah pembuatan database dan akun MySQL pada
[panduan instalasi](INSTALL_MYSQL57.md). SQL dalam paket tidak membuat database,
akun MySQL, atau password. Pilih database target sebelum mengimpor. Akun impor
memerlukan hak pembuatan tabel dan hak baca/tulis yang dijelaskan pada panduan.

Untuk instalasi baru, gunakan database kosong. Untuk memperbarui instalasi yang
sudah berisi data, gunakan alur **`npm run db:migrate` lalu `npm run db:seed`**
setelah backup, sesuai panduan upgrade. Tidak perlu mengimpor ulang SQL gabungan.

## 4. Impor melalui MySQL client

Buka terminal dari komputer yang mempunyai MySQL client. Ganti host, port,
username, dan nama database berikut sesuai konfigurasi sebenarnya:

```text
mysql --host=127.0.0.1 --port=3306 --user=leinz_app --password --default-character-set=utf8mb4 leinz_lens_studio
```

`--password` meminta password akun database secara interaktif. Setelah muncul
prompt `mysql>`, jalankan **salah satu** contoh sesuai lokasi paket.

Contoh Windows, gunakan slash `/`:

```sql
SOURCE C:/Apps/leinz-lens-studio/database/leinz-schema-and-master-data.sql;
```

Contoh Linux:

```sql
SOURCE /opt/leinz-lens-studio/database/leinz-schema-and-master-data.sql;
```

Ganti path tersebut dengan lokasi hasil ekstraksi. Untuk proses ini, gunakan
path yang tidak mengandung spasi. Periksa bahwa tidak ada pesan `ERROR` selama
impor. Hasil terakhir pada database kosong adalah:

| inserted_catalog_documents | inserted_sku_documents |
| ---: | ---: |
| 3 | 1 |

`inserted_sku_documents = 1` berarti satu dokumen SKU kosong telah dibuat,
bukan satu produk SKU. Jika diulang tanpa perubahan, hasilnya `0` dan `0`.

## 5. Impor melalui phpMyAdmin atau HeidiSQL

### phpMyAdmin

1. Masuk ke server MySQL yang benar dan pilih database khusus aplikasi.
2. Pilih **Import**, lalu berkas `database/leinz-schema-and-master-data.sql`.
3. Gunakan format **SQL** dan karakter **utf-8**. Jalankan impor sampai selesai.
4. Periksa hasil sukses, tujuh tabel yang terbentuk, dan jumlah master melalui
   query pada bagian berikut.

Jika antarmuka menolak ukuran unggahan atau proses berhenti sebelum selesai,
gunakan MySQL client. Jangan menganggap hanya munculnya beberapa tabel sebagai
bukti bahwa seluruh master berhasil diimpor.

### HeidiSQL

1. Hubungkan ke server MySQL, lalu pilih database khusus aplikasi.
2. Buka tab query dan muat `database/leinz-schema-and-master-data.sql` melalui
   menu pembukaan file SQL, menggunakan encoding **UTF-8**.
3. Jalankan **seluruh berkas**, bukan hanya statement yang sedang dipilih.
4. Pastikan tidak ada error, lalu periksa tabel dan jumlah master.

## 6. Verifikasi isi setelah impor

Jalankan query berikut pada database target:

```sql
SELECT VERSION() AS mysql_version;
SHOW TABLES;
SELECT version FROM leinz_schema_migrations ORDER BY version;
SELECT id, revision FROM leinz_catalog_revision;

SELECT
  JSON_LENGTH(document_json, '$.products') AS products,
  JSON_LENGTH(document_json, '$.blanks') AS blanks,
  JSON_LENGTH(document_json, '$.rules') AS power_rules
FROM leinz_catalog_documents WHERE document_key = 'materials';

SELECT document_key, JSON_LENGTH(document_json, '$.items') AS items
FROM leinz_catalog_documents
WHERE document_key IN ('shapes', 'tints')
ORDER BY document_key;

SELECT JSON_LENGTH(document_json, '$.skus') AS sku_items
FROM leinz_workspace_documents WHERE document_key = 'skus';

SELECT document_key, JSON_VALID(document_json) AS valid_json, source_sha256
FROM leinz_catalog_documents ORDER BY document_key;
```

Pada instalasi kosong, harapkan **7 tabel**, versi migrasi **1 dan 2**, revisi
katalog **1**, material **19/186/2.026**, shape **13**, tint **66**, dan SKU **0**.
Semua nilai `valid_json` harus **1**. Hash `source_sha256` menggunakan bentuk JSON
kanonis aplikasi; cocokkan dengan `sourceAssets.*.canonicalSha256` pada
`master-data-inventory.json`, bukan hash byte berkas JSON yang berformat rapi.

Setelah akun aplikasi dibuat, `npm run doctor` juga melaporkan jumlah master
dan hash isi katalog yang benar-benar terbaca dari database.

## 7. Jalankan aplikasi setelah SQL diimpor

1. Dari folder yang memuat `package.json`, pasang dependency dengan `npm ci`
   dan periksa source dengan `npm run build`. `npm test` tersedia untuk QA.
2. Salin `.env.example` menjadi `.env`, lalu isi koneksi database dan `APP_URL`.
   Akun MySQL di `.env` berbeda dari akun login aplikasi.
3. Jalankan `npm run admin:create`, masukkan username dan password yang
   ditetapkan sendiri. Password aplikasi **8–128 karakter**. Tidak ada akun atau
   password login bawaan di SQL.
4. Jalankan `npm run doctor`, lalu `npm start`.
5. Buka alamat yang sama persis dengan `APP_URL`, masuk, dan pastikan indikator
   penyimpanan menampilkan **MySQL**.

Pada PowerShell, gunakan `npm.cmd` jika `npm` terhalang kebijakan skrip.
Impor SQL gabungan sudah memenuhi tahap `db:migrate` dan `db:seed`; keduanya
tidak perlu diulang untuk instalasi baru yang berhasil diimpor.

## 8. Perlindungan data yang sudah ada

Skema memakai `CREATE TABLE IF NOT EXISTS`. Pengisian master memakai
`INSERT IGNORE`: jika key katalog atau dokumen SKU sudah ada, isinya tidak
diganti. Seluruh DML master berada dalam transaksi dengan kunci baris revisi
katalog, dan revisi hanya bertambah ketika ada dokumen katalog baru.

SQL tidak menjalankan `DROP`, `TRUNCATE`, penghapusan akun, atau reset password.
Meski demikian, SQL referensi bukan sarana memperbaiki database rusak secara
otomatis dan bukan pengganti backup. Jangan menggunakan hasil integration test
sebagai database instalasi: pengujian memakai data QA sementara yang berbeda
dari master referensi pada paket ini.

Untuk membawa master yang sudah diedit dari preview browser, gunakan
**Manage → Ekspor semua master**, kemudian **Impor master JSON** di instalasi
MySQL. Ekspor/import **Master SKU** dilakukan terpisah. Untuk membawa seluruh
database lama, termasuk akun dan konsultasi, gunakan prosedur backup/restore.

## 9. Membuat ulang SQL dari source

Bagian ini hanya diperlukan untuk pengembang ketika aset master paket diubah.
Setelah `npm ci`, jalankan:

```text
node tools/build-install-sql.mjs
```

Generator memakai path relatif terhadap lokasi source, sehingga dapat dijalankan
dari working directory lain dengan path skrip yang tepat. Ia memvalidasi master,
menggabungkan migrasi 001/002, dan menulis ulang ketiga SQL beserta inventaris.
Tidak ada koneksi atau perubahan database dari perintah tersebut.

JSON disimpan sebagai literal heksadesimal UTF-8 melalui
`CONVERT(0x... USING utf8mb4)`, sehingga apostrof, backslash, dan karakter Unicode
tidak berubah oleh mode SQL. Generator selalu memakai master referensi dalam
`dist/assets/` dan SKU kosong sesuai seed; ia tidak mengambil perubahan dari
browser atau database operasional. Uji impor hasil baru sebelum didistribusikan.
