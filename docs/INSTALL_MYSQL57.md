# Instalasi Leinz Lens Studio 2.1.0 — MySQL 5.7.24

Untuk kode terbaru dengan skema 5 (level akun), ikuti juga
[panduan normalisasi dan migrasi](NORMALISASI_DATABASE.md). Database existing
memerlukan `npm run db:migrate` dengan seluruh penulis aplikasi dihentikan.

Migrasi 005 menambahkan level `administrator` dan `user`. Akun lama tetap
administrator. Setelah migrasi dan restart server, gunakan **Manage → Manage
User** untuk membuat akun, mengganti password, mengatur level, atau menonaktifkan
akun. Akun user hanya dapat membuka Studio Lensa dan tidak dapat menulis master
melalui API. Buat administrator pertama menggunakan `npm run admin:create`.

Panduan ini awalnya untuk paket **Leinz-Lens-Studio-2.1.0-MySQL57.zip**. Folder utama di dalam ZIP adalah `leinz-lens-studio`. Jalankan perintah aplikasi dari folder yang memuat `package.json`, `server/`, `dist/`, dan `database/`.

Versi ini menjalankan frontend dan API melalui **Node.js**, lalu menyimpan data pada **MySQL**. Aplikasi tidak memerlukan PHP, Composer, Python, bundler frontend, atau compiler C/C++. `npm run build` memeriksa sintaks JavaScript, aset, dan katalog; tidak menghasilkan binary native.

## 1. Perangkat lunak yang diperlukan

| Komponen | Kebutuhan paket |
| --- | --- |
| Node.js | **22.x atau 24.x**, 64-bit. Pilih salah satu versi tersebut secara eksplisit pada unduhan resmi. |
| npm | npm yang disertakan pada instalasi Node.js; dependency dipasang dari `package-lock.json`. |
| Database | **MySQL Community Server 5.7.24**. Pemeriksaan versi juga menerima patch MySQL 5.7 yang lebih baru. |
| Karakter database | `utf8mb4` dengan collation `utf8mb4_unicode_ci`. |
| Engine tabel | InnoDB; ditetapkan oleh skrip migrasi. |
| `max_allowed_packet` | Minimal **8 MB**; gunakan **16M** atau **64M**. |
| Browser | Browser desktop modern dengan Canvas, JavaScript, dan cookies aktif. |
| Koneksi saat instalasi | Akses registry npm untuk `npm ci`, serta akses ke server MySQL yang ditentukan. |

Paket tidak memasang atau mengganti server MySQL yang sudah dimiliki perusahaan. MariaDB dan MySQL 8 bukan target paket ini dan ditolak oleh pemeriksaan versi. Periksa binary yang dipakai:

```text
node --version
npm --version
mysql --version
```

Pada Windows PowerShell, gunakan `npm.cmd` jika `npm` memilih skrip `npm.ps1` yang diblokir kebijakan eksekusi. Perubahan execution policy tidak diperlukan.

## 2. Siapkan database melalui akun DBA

Buka MySQL client atau alat administrasi database menggunakan akun DBA. Contoh koneksi TCP lokal:

```text
mysql --host=127.0.0.1 --port=3306 --user=root --password
```

`--password` tanpa nilai meminta password secara interaktif. Jangan menempelkan password setelah opsi perintah.

Periksa server yang benar:

```sql
SELECT VERSION();
SHOW GLOBAL VARIABLES LIKE 'max_allowed_packet';
```

Untuk instalasi baru, buat database khusus dan akun aplikasi. Ganti `GANTI_PASSWORD_DATABASE` dengan password database yang ditetapkan sendiri:

```sql
CREATE DATABASE IF NOT EXISTS leinz_lens_studio
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER 'leinz_app'@'127.0.0.1'
  IDENTIFIED BY 'GANTI_PASSWORD_DATABASE';

GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, REFERENCES
  ON leinz_lens_studio.*
  TO 'leinz_app'@'127.0.0.1';
```

Contoh akun di atas berlaku ketika Node.js dan MySQL berada pada server yang sama dan aplikasi terhubung ke `127.0.0.1`. Bila MySQL berada pada server berbeda, gunakan alamat sumber server aplikasi pada bagian host akun MySQL dan isi `MYSQL_HOST` dengan alamat server database. Sesuaikan akses jaringan dan akun database dengan topologi tersebut. Gunakan akun yang telah tersedia bila database dikelola melalui panel hosting; tidak perlu membuat akun duplikat.

Jika nama akun sudah terdaftar, `CREATE USER` akan menolak pembuatan ulang. Periksa akun yang ada dan hak aksesnya; jangan menghapusnya untuk mengulang instalasi. `CREATE DATABASE IF NOT EXISTS` juga tidak mengubah collation database yang sudah ada. Tabel Leinz tetap memakai collation yang ditentukan dalam migrasi.

### Ukuran paket MySQL

Tambahkan atau sesuaikan nilai berikut dalam file konfigurasi MySQL yang benar-benar dipakai layanan, pada bagian `[mysqld]`:

```ini
[mysqld]
max_allowed_packet=16M
```

Lokasi file tergantung instalasi: biasanya `my.ini` pada Windows dan `my.cnf` atau file konfigurasi tambahan pada Linux. Periksa konfigurasi layanan sebelum mengedit. Untuk menerapkan batas 16 MB pada server yang sedang berjalan, DBA dapat menjalankan:

```sql
SET GLOBAL max_allowed_packet = 16777216;
```

Perubahan global ini membutuhkan hak DBA dan berlaku pada koneksi baru. Simpan juga nilai tersebut pada konfigurasi layanan agar bertahan setelah restart MySQL. Hentikan dan mulai kembali aplikasi Node.js setelah mengubahnya. Jangan menurunkan nilai apabila server sudah memakai nilai yang lebih besar, misalnya 64M.

Ukuran dokumen JSON MySQL dipengaruhi `max_allowed_packet`; paket ini memeriksanya sebelum instalasi dan startup. Lihat [manual MySQL 5.7 tentang JSON](https://docs.oracle.com/cd/E17952_01/mysql-5.7-en/json.html) dan [variabel server](https://docs.oracle.com/cd/E17952_01/mysql-5.7-en/server-system-variables.html).

## 3. Ekstrak paket dan pasang dependency

### Windows PowerShell

Sesuaikan lokasi ZIP dengan folder unduhan sebenarnya. Contoh folder aplikasi:

```powershell
Expand-Archive -Path "$env:USERPROFILE\Downloads\Leinz-Lens-Studio-2.1.0-MySQL57.zip" -DestinationPath "C:\Apps"
Set-Location "C:\Apps\leinz-lens-studio"
Copy-Item .env.example .env
npm.cmd ci
npm.cmd run build
npm.cmd test
notepad.exe .env
```

### Linux

Contoh berikut memakai folder `/opt/leinz-lens-studio`. Siapkan hak tulis folder sesuai akun instalasi dan jalankan npm sebagai akun tersebut.

```bash
sudo unzip Leinz-Lens-Studio-2.1.0-MySQL57.zip -d /opt
sudo chown -R "$(id -u):$(id -g)" /opt/leinz-lens-studio
cd /opt/leinz-lens-studio
cp .env.example .env
npm ci
npm run build
npm test
```

Edit `.env` menggunakan editor yang tersedia. Jangan menaruh `.env` di dalam `dist/`. Bila memasang sebagai layanan Linux, pastikan hanya akun layanan dan administrator yang dapat membaca file tersebut; contoh `chmod 600 .env` setelah kepemilikan file disesuaikan.

`npm ci` memasang versi dependency yang terkunci pada paket. Folder `node_modules` memang tidak disertakan dalam ZIP. Kegagalan mengunduh dependency harus diselesaikan melalui koneksi/proxy registry sebelum melanjutkan.

Skrip Python ekstraksi warna/material dan generator bentuk dalam `tools/` adalah alat pengembangan. **Jangan menjalankannya sebagai langkah instalasi.** Katalog yang diperlukan sudah tersedia di `dist/assets/`.

## 4. Isi konfigurasi aplikasi

Contoh untuk Node.js dan MySQL pada komputer yang sama:

```dotenv
HOST=127.0.0.1
PORT=3000
APP_URL=http://localhost:3000

MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_DATABASE=leinz_lens_studio
MYSQL_USER=leinz_app
MYSQL_PASSWORD="GANTI_PASSWORD_DATABASE"
MYSQL_POOL_SIZE=5
MYSQL_SSL_CA=

SESSION_HOURS=8
ADMIN_USERNAME=
ADMIN_PASSWORD=
```

| Konfigurasi | Penjelasan |
| --- | --- |
| `HOST` | Alamat listener Node.js. `127.0.0.1` hanya dapat diakses secara lokal atau melalui reverse proxy pada server tersebut. |
| `PORT` | Port layanan Node.js. Gunakan port yang belum dipakai proses lain. |
| `APP_URL` | **Origin yang persis dipakai browser**, termasuk `http/https` dan port nonstandar. Tidak boleh memuat subfolder, query, atau kredensial. |
| `MYSQL_HOST`, `MYSQL_PORT` | Alamat dan port MySQL. Koneksi menggunakan TCP. |
| `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD` | Database dan akun yang disiapkan pada langkah sebelumnya. Nama database memakai huruf, angka, dan underscore. |
| `MYSQL_SSL_CA` | Opsional: path file sertifikat CA untuk TLS MySQL. Validasi sertifikat tetap aktif ketika digunakan. |
| `SESSION_HOURS` | Masa berlaku sesi login, 1–168 jam; default 8 jam. |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | Input opsional untuk CLI pembuatan akun. Biarkan kosong agar CLI meminta input. Bukan akun login bawaan. |

Gunakan tanda kutip pada password `.env` jika mengandung spasi atau `#`. Jangan menganggap `localhost`, `127.0.0.1`, alamat IP LAN, dan nama DNS sebagai origin yang sama. Contohnya, jika `APP_URL=http://localhost:3000`, buka persis `http://localhost:3000` untuk login.

Untuk akses langsung dari LAN, gunakan `HOST=0.0.0.0` dan `APP_URL=http://ALAMAT_SERVER:3000`, lalu ganti `ALAMAT_SERVER` dengan IP atau DNS sebenarnya. Jika memakai reverse proxy, pertahankan listener lokal dan gunakan URL publik reverse proxy sebagai `APP_URL`. Aplikasi ini dipasang pada root origin, bukan pada path seperti `/simulator/`.

## 5. Buat tabel, isi katalog, dan buat akun

Jalankan berurutan dari folder aplikasi. Pada Windows, ganti `npm` dengan `npm.cmd` bila diperlukan:

```bash
npm run db:migrate
npm run db:seed
npm run admin:create
npm run doctor
npm start
```

Hasil yang diharapkan:

1. **`db:migrate`** membuat tujuh tabel Leinz dan catatan versi skema. Tidak memakai `DROP TABLE`.
2. **`db:seed`** mengisi tiga katalog referensi yang belum tersedia: tint, raw material, dan shape. Katalog yang sudah diubah melalui Manage, Master SKU, dan konsultasi tidak ditimpa.
3. **`admin:create`** meminta username dan password baru. Username memakai 3–64 karakter huruf/angka/titik/underscore/tanda minus. Password 8–128 karakter, tidak ditampilkan saat diketik, dan diminta dua kali. Tidak tersedia password default.
4. **`doctor`** menghasilkan laporan `ok: true`, versi MySQL, schemaVersion 2, tujuh tabel, tiga katalog, revisi master, jumlah tiap master, hash isi katalog, dan jumlah akun aktif.
5. **`npm start`** menampilkan alamat aplikasi dan mempertahankan proses server tetap berjalan.

Buka alamat pada `APP_URL`, masuk dengan akun yang dibuat, lalu pastikan status penyimpanan pada antarmuka menampilkan **MySQL**. Master SKU yang masih kosong pada instalasi baru adalah kondisi normal; katalog bahan, tint, dan bentuk lensa telah diisi oleh seed.

Menutup terminal akan menghentikan server jika belum dipasang sebagai layanan. Gunakan `Ctrl+C` untuk menghentikan proses saat pengujian. Setelah perubahan `.env`, mulai ulang proses Node.js.

Nama perintah `admin:create` adalah nama alat instalasi akun. Paket ini belum mempunyai pembagian role administrator/manager/staff: **semua akun yang dibuat dapat mengubah master material, frame shape, tinting, dan Master SKU bersama**. Buat akun hanya untuk pengguna yang memang diberi wewenang tersebut. Akun database MySQL dan akun login aplikasi adalah dua hal yang berbeda.

## 6. Penyimpanan data dan pemindahan data browser

| Tabel | Isi |
| --- | --- |
| `leinz_schema_migrations` | Versi skema yang telah diterapkan. |
| `leinz_users` | Username dan hash password akun aplikasi. |
| `leinz_sessions` | Hash token sesi, token CSRF, dan masa berlaku. |
| `leinz_catalog_documents` | Katalog tint, material/blank/power, kontur shape, dan parameter optik eksplisit. |
| `leinz_catalog_revision` | Satu revisi bersama untuk penyimpanan atomik ketiga katalog. |
| `leinz_workspace_documents` | Master SKU bersama beserta nomor revisi. |
| `leinz_user_documents` | Draft simulator dan riwayat konsultasi masing-masing akun. |

Katalog dan dokumen aplikasi sengaja disimpan dalam kolom **JSON native MySQL**, sehingga struktur kontur, sumber data, assignment blank, rentang power, dan snapshot konsultasi tetap utuh. Ini bukan model dengan satu tabel terpisah untuk setiap varian atau titik kontur. Validasi aturan SKU dilakukan pada aplikasi dan server; tidak mengandalkan `CHECK` MySQL 5.7. Tidak ada default non-null pada kolom JSON atau collation khusus MySQL 8 dalam skema.

Master material, frame shape, tinting, dan SKU dibagikan kepada seluruh akun pada database yang sama. Draft dan riwayat konsultasi mengikuti akun login, dengan maksimum 30 entri riwayat. Master dibatasi 1.000 SKU. Perubahan dari sesi lain ditolak melalui pemeriksaan nomor revisi sehingga data terbaru tidak ditimpa diam-diam.

Data lama di browser **tidak dipindahkan otomatis** ke database. Gunakan alur berikut:

1. Buka simulator lama pada browser yang menyimpan datanya. Pada **Master SKU**, pilih **Ekspor JSON**.
2. Pada versi MySQL, masuk lalu buka **Manage → Master SKU → Impor JSON**. Periksa ringkasan perubahan dan pilih **Terapkan impor**.
3. Untuk setiap konsultasi lama, buka pilihan tersebut dan gunakan **Simpan pilihan → Unduh JSON**.
4. Pada versi MySQL, buka **Tersimpan → Impor konsultasi JSON**, tinjau ringkasannya, lalu pilih **Simpan konsultasi**.

Impor konsultasi menerima schema `trl-lens-consultation/1.3` dan `trl-lens-consultation/1.4`. Schema 1.4 memuat status photochromic per pasangan dan paparan UV simulasi bersama. Impor tersebut tidak mengganti Master SKU. Impor Master SKU terlebih dahulu agar referensi SKU tersedia; ketersediaan blank diperiksa kembali ketika konsultasi dibuka. File yang hanya berisi gambar PNG/PDF tidak dapat diimpor sebagai data konsultasi.

Tunggu indikator penyimpanan selesai sebelum keluar atau memuat ulang. Jika server terputus, aplikasi menampilkan status belum tersimpan dan mempertahankan perubahan tertunda; mode MySQL tidak beralih diam-diam ke penyimpanan browser. Jika ada konflik revisi, simpan salinan ekspor perubahan yang diperlukan, muat data terbaru, lalu tinjau ulang sebelum menyimpan.


## 6A. Manage master dan memastikan seluruh data berada di MySQL

Pada mode MySQL, menu **Manage** membaca dan menyimpan master langsung melalui
server. Tiga katalog disimpan dalam satu transaksi database dengan satu nomor
revisi. Ketika dua pengguna mengedit revisi yang sama, satu perubahan diterima
dan perubahan yang sudah tertinggal ditolak untuk ditinjau ulang.

- **Blank / Raw Material**: produk/supplier/indeks, diameter, base curve, CT/ET
  bahan baku, serta rentang SPH/CYL/ADD per blank.
- **Frame Shape**: nama, ukuran awal, kontur, dan status aktif/arsip.
- **Manage Tinting**: kode/nama, jenis solid/gradasi, warna preview, label
  persentase, catatan sumber, serta status aktif/arsip.
- **Master SKU**: ketersediaan indeks, assignment blank, dan range power finish.

Arsip mempertahankan ID sehingga riwayat konsultasi tidak kehilangan referensi.
Data arsip tidak dipakai sebagai pilihan baru. Master yang sudah ada tidak boleh
dihilangkan dari impor; impor harus menggabungkan data dan memakai ID yang tetap.
Aturan power dapat diedit atau dihapus secara eksplisit dan kecocokan blank akan
diperiksa kembali. Kode/ID berbeda bukan cara mengganti identitas record lama.

`npm run doctor` membaca isi database dan menampilkan `masterCounts`. Pada
instalasi kosong dari paket referensi, hasilnya:

| Master | Jumlah awal |
| --- | ---: |
| Produk material | 19 |
| Definisi blank | 186 |
| Aturan power unik | 2.026 |
| Frame shape | 13 |
| Tinting | 66 |
| SKU | 0, sampai master SKU diimpor/dibuat |

Material indeks 1.59 dari sumber tetap berada di database sebagai katalog,
sementara simulator memakai enam indeks yang telah disepakati. Setelah master
ditambah atau diarsipkan, jumlah aktual dapat berbeda; `doctor` tidak menghapus
atau mengembalikan perubahan ke jumlah awal. Katalog default tidak menggantikan
Master SKU atau perubahan yang hanya tersimpan di browser. Ekspor data browser
lalu impor melalui menu Manage pada instalasi MySQL untuk memindahkan data itu.

Pemeriksaan SQL read-only tambahan:

```sql
SELECT revision, updated_at FROM leinz_catalog_revision WHERE id = 1;

SELECT
  JSON_LENGTH(document_json, '$.products') AS products,
  JSON_LENGTH(document_json, '$.blanks') AS blanks,
  JSON_LENGTH(document_json, '$.rules') AS power_rules
FROM leinz_catalog_documents WHERE document_key = 'materials';

SELECT document_key, JSON_LENGTH(document_json, '$.items') AS items
FROM leinz_catalog_documents WHERE document_key IN ('shapes', 'tints');

SELECT JSON_LENGTH(document_json, '$.skus') AS skus
FROM leinz_workspace_documents WHERE document_key = 'skus';
```

Parameter `opticalProfile` dapat disimpan pada produk atau blank; profil blank
menggantikan profil produk ketika dipilih. Parameter ketebalan minimum adalah
batas **lensa jadi**, terpisah dari CT/ET bahan baku. Radius depan eksplisit
mengambil prioritas atas power kurva depan. `source: lab` berarti pengguna
mengisi parameter dan acuan lab; label tersebut bukan sertifikasi bahwa hasil
perhitungan sudah identik dengan hasil produksi. Base curve pada CSV tidak
langsung ditafsirkan sebagai power permukaan karena konvensinya belum tersedia.
Konstanta conic selain 0 ditolak pada versi ini. Lihat dokumentasi model optik
untuk cakupan perhitungan dan batas desain yang didukung.

## 7. Menjalankan sebagai layanan Linux dan memakai Nginx

Bagian ini opsional setelah akses lokal berhasil. Nama DNS, lokasi sertifikat, akun layanan, dan binary Node harus disesuaikan dengan server sebenarnya.

### Contoh unit systemd

Siapkan akun layanan `leinz` yang dapat membaca folder aplikasi dan `.env`. Temukan lokasi binary Node:

```bash
command -v node
```

Buat `/etc/systemd/system/leinz-lens-studio.service` menggunakan template berikut. **Ganti `/PATH_ABSOLUT_NODE/node` dengan hasil yang benar**; path tersebut adalah penanda, bukan lokasi runtime yang diasumsikan.

```ini
[Unit]
Description=Leinz Lens Studio
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=leinz
Group=leinz
WorkingDirectory=/opt/leinz-lens-studio
ExecStart=/PATH_ABSOLUT_NODE/node /opt/leinz-lens-studio/server/start.mjs
Environment=NODE_ENV=production
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

Pastikan binary Node juga dapat dijalankan oleh akun `leinz`, terutama jika Node awalnya dipasang dalam home directory akun lain. Aplikasi membaca `.env` sendiri; `EnvironmentFile` systemd tidak diperlukan.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now leinz-lens-studio
sudo systemctl status leinz-lens-studio
sudo journalctl -u leinz-lens-studio -n 100 --no-pager
```

### Contoh reverse proxy Nginx

Tambah/hapus Indeks Bahan memakai `PUT /api/catalogs/indices`, dengan payload
hanya daftar indeks dan revisi master (umumnya kurang dari 1 KB). Pastikan kode
frontend dan backend diperbarui bersamaan, lalu restart layanan Node.js dan muat
ulang browser. Perubahan ini tidak memerlukan migrasi database baru.

Impor Excel/CSV/JSON dan penyimpanan master lengkap tetap memakai
`PUT /api/catalogs`. Permintaan JSON dengan panjang minimal 262.144 karakter dikompresi gzip
secara otomatis pada browser yang menyediakan `CompressionStream`. Katalog
bawaan sekitar 5,6 MB menjadi sekitar 267 KB saat dikirim. Backend menerima
`Content-Encoding: gzip` dan membatasi ukuran sebelum maupun sesudah
dekompresi ke batas API 8 MiB. Validasi, revisi, serta transaksi penyimpanan
tetap berlaku. Tidak diperlukan migrasi database tambahan.

Untuk mengaktifkan perbaikan upload, perbarui **`dist/storage-client.js` dan
`server/app.mjs` bersamaan**, restart layanan Node.js, lalu muat ulang browser
dengan Ctrl+F5. Mengganti frontend saja belum cukup karena backend lama belum
membaca body gzip.

Jika operasi impor atau penyimpanan master lengkap masih menampilkan HTTP 413,
pastikan `client_max_body_size 8m;` berlaku pada konfigurasi server/location yang
melayani aplikasi, termasuk browser yang tidak menyediakan kompresi otomatis.
Pada hosting `simulator.leinz.id`, tambahkan direktif tersebut ke blok `server`
yang aktif untuk domain itu; jika `location /api/` menetapkan batas tersendiri,
sesuaikan juga batas di sana. Periksa konfigurasi dengan `nginx -t` lalu reload
Nginx. Pengaturan `gzip on` untuk respons bukan pengaturan batas upload.
Lihat [dokumentasi client_max_body_size](https://nginx.org/en/docs/http/ngx_http_core_module.html#client_max_body_size).
Respons HTML dari Nginx untuk 413 ditampilkan sebagai pesan ukuran permintaan,
bukan kesalahan JSON.

Contoh HTTP internal berikut memakai nama ilustratif `lensa.example.internal`. Ganti dengan DNS sebenarnya dan set `APP_URL` ke origin yang sama:

```nginx
server {
    listen 80;
    server_name lensa.example.internal;
    client_max_body_size 8m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
```

```dotenv
HOST=127.0.0.1
PORT=3000
APP_URL=http://lensa.example.internal
```

Untuk HTTPS, pasang sertifikat DNS yang sebenarnya pada Nginx dan gunakan `APP_URL=https://nama-dns-sebenarnya`. Cookie sesi memakai atribut `Secure` otomatis ketika `APP_URL` HTTPS. Teruskan seluruh path aplikasi, termasuk `/api/` dan `/runtime-config.js`, ke Node.js. Jangan mengganti route tersebut dengan file statis atau meng-cache respons API.

Uji konfigurasi Nginx sebelum memuat ulang layanan:

```bash
sudo nginx -t
sudo systemctl reload nginx
sudo systemctl restart leinz-lens-studio
```

Pada Windows, pengujian dapat dilakukan dengan `npm.cmd start` di terminal. Untuk layanan yang berjalan otomatis, pasang `node.exe` dan `server/start.mjs` melalui pengelola layanan yang telah digunakan organisasi, dengan working directory folder aplikasi. Paket ini tidak memasang Windows Service secara otomatis.

## 8. Backup, restore, dan pemasangan ulang

Gunakan client **mysqldump 5.7** agar opsi sesuai dengan server target. Simpan backup SQL database beserta salinan konfigurasi `.env` yang aksesnya dibatasi; kredensial akun database tidak dimasukkan oleh backup tabel aplikasi.

### Backup

Gunakan akun DBA/backup yang mempunyai hak untuk membaca objek database. Contoh dengan prompt password:

```text
mysqldump --host=127.0.0.1 --port=3306 --user=root --password --single-transaction --hex-blob --default-character-set=utf8mb4 --set-gtid-purged=OFF --result-file=leinz-backup.sql leinz_lens_studio
```

File ditulis pada current directory; gunakan path absolut bila diperlukan. `--hex-blob` mempertahankan data binary seperti hash token sesi. Jangan menjalankan migrasi/DDL bersamaan dengan proses backup.

Pada PowerShell, gunakan **`--result-file`**, bukan `> backup.sql`. Redirection PowerShell tertentu menghasilkan UTF-16 yang tidak sesuai untuk restore MySQL. Hal ini dijelaskan dalam [manual mysqldump MySQL 5.7](https://docs.oracle.com/cd/E17952_01/mysql-5.7-en/mysqldump.html).

### Restore

Uji restore pada database baru yang kosong terlebih dahulu. Backup SQL dapat mengganti tabel yang namanya sama; jangan mengarahkannya ke database produksi aktif sebagai percobaan.

```sql
CREATE DATABASE leinz_lens_studio_restore
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
```

Buka client MySQL dengan target database restore:

```text
mysql --host=127.0.0.1 --port=3306 --user=root --password --default-character-set=utf8mb4 leinz_lens_studio_restore
```

Kemudian jalankan `SOURCE` dari prompt MySQL menggunakan path backup sebenarnya. Contoh Linux:

```sql
SOURCE /backup/leinz-backup.sql;
```

Contoh Windows, gunakan slash `/` dan path tanpa spasi:

```sql
SOURCE C:/Backups/leinz-backup.sql;
```

Berikan hak akun aplikasi pada database hasil restore, sesuaikan `MYSQL_DATABASE` pada konfigurasi instalasi uji, lalu jalankan `npm run doctor` dan buka aplikasi. Periksa login, Master SKU, riwayat, serta pembukaan konsultasi sebelum menggunakan hasil restore untuk operasional.

### Pemasangan ulang atau pembaruan paket

1. Backup database dan `.env` lebih dahulu, lalu hentikan proses Node.js.
2. Ekstrak versi paket ke folder terpisah. Pertahankan `.env` yang telah diisi; jangan menimpanya dengan `.env.example`.
3. Jalankan `npm ci`, `npm run build`, dan `npm test` dari folder paket baru.
4. Jalankan `db:migrate` lalu `db:seed`. Keduanya dapat diulang; migrasi tidak menghapus tabel, seed tidak mengganti katalog yang sudah dikelola, Master SKU, atau konsultasi. Pada upgrade dari 2.0, migrasi 002 menambah tabel revisi master dan mempertahankan enam tabel beserta data sebelumnya.
5. Jangan membuat ulang akun yang sudah ada. Jalankan `doctor`, lalu mulai aplikasi.

Jika `.env` memakai path relatif untuk sertifikat CA MySQL, pindahkan file CA tersebut atau sesuaikan path saat mengganti folder instalasi.

## 9. Pemeriksaan QA dan troubleshooting

`npm test` memeriksa geometri dan CT/ET, pemeriksaan diameter blank, SKU, frame/tangkai, penyimpanan, impor konsultasi, serta unit backend. Perintah tersebut tidak menghapus database.

**`npm run test:mysql` berbeda:** ini adalah integration test untuk database disposable. Gunakan akun uji yang mempunyai hak pada database disposable, termasuk CREATE, DROP, dan TRIGGER untuk injeksi kegagalan transaksi. Skrip memerlukan `LEINZ_ALLOW_TEST_DB=1` dan nama database `leinz_test_*`, lalu menghapus dan membuat ulang tujuh tabel Leinz pada target test. Jangan memakai database utama. Laporan QA dalam paket mencatat hasil uji pada MySQL 5.7.24 sebenarnya; operator tidak wajib menjalankan integration test destruktif untuk menggunakan aplikasi.

| Gejala atau pesan | Pemeriksaan dan tindakan |
| --- | --- |
| `MYSQL_* belum diisi` | Pastikan `.env` ada di root paket, bukan `dist/`, dan placeholder password telah diganti. Environment proses lebih diprioritaskan daripada `.env`. |
| `ECONNREFUSED` / `ETIMEDOUT` | Periksa layanan MySQL, alamat/port, listener database, dan jalur jaringan. Uji koneksi dari server Node.js dengan MySQL client memakai host/port yang sama. |
| `ER_ACCESS_DENIED_ERROR` | Periksa username, password, dan host akun MySQL. Akun login aplikasi tidak digunakan untuk koneksi database. |
| `ER_BAD_DB_ERROR` | Database belum dibuat atau `MYSQL_DATABASE` salah. Buat database melalui DBA, lalu ulangi migrasi. |
| `ER_TABLEACCESS_DENIED_ERROR` / perintah CREATE ditolak | Akun instalasi belum memiliki hak yang diperlukan pada database khusus. Periksa grant DBA, lalu jalankan kembali perintah yang gagal. |
| `Skema belum lengkap` / tabel tidak ditemukan | Jalankan `npm run db:migrate` menggunakan `.env` untuk database yang benar. |
| `Katalog belum lengkap` | Jalankan `npm run db:seed` dari paket lengkap yang memiliki `dist/assets/*.json`. |
| `max_allowed_packet harus minimal 8 MB` | Atur 16M/64M pada server MySQL, buat koneksi baru, lalu ulangi `doctor`. |
| `Belum ada akun aktif` | Jalankan `npm run admin:create`. Tidak ada password bawaan. |
| `Username sudah terdaftar` | Akun lama dipertahankan. Gunakan akun tersebut atau pilih username baru; perintah tidak mereset password diam-diam. |
| Login `403 Origin` | Browser dibuka melalui alamat yang berbeda dari `APP_URL`. Samakan skema, hostname/IP, dan port; mulai ulang Node.js setelah mengubah `.env`. |
| `403 Token keamanan` / `401 Sesi berakhir` | Masuk kembali atau muat sesi terbaru. Jangan menghapus pemeriksaan CSRF agar permintaan lolos. |
| `409 Data telah berubah` | Ekspor perubahan yang perlu disimpan, muat data server terbaru, lalu tinjau ulang. Pesan ini mencegah penimpaan perubahan dari sesi lain. |
| `503` / status belum tersimpan | Periksa log Node.js dan MySQL. Jangan menganggap perubahan berhasil sebelum indikator penyimpanan selesai. Gunakan ekspor untuk salinan perubahan yang penting. |
| `EADDRINUSE` | Port Node.js sudah digunakan. Hentikan proses duplikat atau ganti `PORT` beserta `APP_URL` yang sesuai. |
| Tidak dapat diakses dari komputer lain | Listener `127.0.0.1` memang lokal. Gunakan reverse proxy atau konfigurasi LAN pada bagian 4. |
| Status menampilkan “Data di browser ini” | File sedang disajikan secara statis, bukan oleh backend Node.js. Jalankan `npm start` dan buka `APP_URL`; jangan membuka `dist/index.html` langsung atau hanya menyalin `dist/` ke web server statis. |
| Node versi tidak didukung | Pakai Node 22.x atau 24.x. Setelah instalasi, buka terminal baru dan periksa `node --version`. |

## 10. Perbedaan tautan preview dan instalasi MySQL

Tautan simulator yang dihosting pada Sites tetap menyediakan **preview dengan penyimpanan browser**. Hosting tersebut tidak menjalankan proses Node.js pada paket ini dan tidak menyediakan koneksi TCP langsung ke MySQL perusahaan.

Versi MySQL adalah **paket ZIP yang dipasang pada server sendiri** melalui panduan ini. Backend Node.js menyajikan `/runtime-config.js` dalam mode MySQL dan menghubungkan UI ke database. Tidak ada klaim bahwa database perusahaan sudah terhubung hanya karena tautan preview dapat dibuka.

Referensi resmi perangkat lunak: [unduh Node.js](https://nodejs.org/en/download), [manual MySQL 5.7](https://docs.oracle.com/cd/E17952_01/mysql-5.7-en/), dan [mysqldump 5.7](https://docs.oracle.com/cd/E17952_01/mysql-5.7-en/mysqldump.html). Detail perilaku aplikasi mengikuti source dan pengujian yang disertakan dalam paket ini.

## Pembaruan 2.2.0

Versi ini menambah photochromic, simulasi UV, impor CSV/Excel dan template, serta uji resep simultan. Dari 2.1.1 tidak ada migrasi tabel tambahan; nilai baru memakai dokumen JSON yang sudah ada. Pertahankan database dan `.env`, perbarui source/dependency, jalankan build/test, lalu restart layanan. Untuk instalasi kosong tersedia `database/leinz-schema-and-master-data.sql`, dengan [panduan impor](DATABASE_IMPORT.md).
