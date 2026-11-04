# Mulai di sini — Leinz Lens Studio 2.1.1

Paket **Leinz-Lens-Studio-2.1.1-Full-Source-Database.zip** berisi source code,
frontend siap disajikan, backend Node.js, skema MySQL, master data sumber, serta
panduan dan hasil QA. Folder utama hasil ekstraksi adalah `leinz-lens-studio`.
Jalankan semua perintah aplikasi dari folder yang memuat `package.json`.

**Panduan database:** [docs/DATABASE_IMPORT.md](docs/DATABASE_IMPORT.md)  
**Panduan instalasi Windows/Linux:** [docs/INSTALL_MYSQL57.md](docs/INSTALL_MYSQL57.md)  
**Hasil QA paket ini:** [docs/QA_RELEASE_2_1_1.md](docs/QA_RELEASE_2_1_1.md)

## 1. Siapkan perangkat lunak dan database

- **Node.js 22.x atau 24.x**, beserta npm.
- **MySQL 5.7.24**; paket juga menerima patch MySQL 5.7 yang lebih baru.
- Database khusus dengan `utf8mb4` / `utf8mb4_unicode_ci` dan akun MySQL untuk
  aplikasi. Contoh penyiapan akun dan hak akses tersedia dalam panduan instalasi.
- `max_allowed_packet` minimal 8 MB; konfigurasi contoh memakai 16M.

Paket tidak memasang server MySQL dan tidak menyertakan akun/password siap
pakai. MariaDB dan MySQL 8 tidak termasuk target paket ini.

## 2. Ekstrak, pasang dependency, dan periksa source

Ekstrak ZIP, masuk ke folder `leinz-lens-studio`, lalu jalankan:

```text
npm ci
npm run build
npm test
```

Pada Windows PowerShell, gunakan `npm.cmd` jika `npm.ps1` diblokir. Dependency
diunduh dari registry npm sesuai `package-lock.json`; `node_modules` tidak
disertakan. `npm run build` memeriksa sintaks JavaScript, aset, dan katalog JSON.
Aplikasi tidak memerlukan compiler native atau proses transpile tambahan.

## 3. Isi `.env`

Salin `.env.example` menjadi `.env` di folder utama, kemudian isi sesuai server:

```dotenv
HOST=127.0.0.1
PORT=3000
APP_URL=http://localhost:3000
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_DATABASE=leinz_lens_studio
MYSQL_USER=leinz_app
MYSQL_PASSWORD="GANTI_DENGAN_PASSWORD_DATABASE"
```

Nama database, akun, dan password harus sesuai yang dibuat pada langkah 1.
Biarkan `ADMIN_USERNAME` dan `ADMIN_PASSWORD` kosong untuk membuat akun aplikasi
secara interaktif. Simpan `.env` di luar folder `dist/`.

## 4. Pilih satu jalur pengisian skema dan master

### Jalur A — otomatis melalui aplikasi

Setelah koneksi database pada `.env` siap:

```text
npm run db:migrate
npm run db:seed
```

### Jalur B — impor SQL manual

Impor berkas berikut ke database baru yang telah disiapkan:

**[`database/leinz-schema-and-master-data.sql`](database/leinz-schema-and-master-data.sql)**

Ikuti [panduan impor database](docs/DATABASE_IMPORT.md) untuk pemilihan database
target, perintah MySQL client, dan pemeriksaan hasil. Impor ini sudah memuat
skema dan master; pada instalasi awal yang berhasil diimpor, tidak perlu
menjalankan kembali `db:migrate` dan `db:seed`.

Kedua jalur memasukkan master sumber yang sama. Untuk memperbarui instalasi
yang sudah memiliki data, gunakan bagian pembaruan pada panduan instalasi.

## 5. Buat akun aplikasi dan jalankan

```text
npm run admin:create
npm run doctor
npm start
```

`admin:create` meminta username dan password baru **8–128 karakter**. Akun ini
dipakai pada halaman login, berbeda dari akun MySQL pada `.env`. Tidak ada
password aplikasi bawaan. Pada instalasi lama, gunakan akun yang sudah ada.

Setelah `doctor` menunjukkan `ok: true`, buka **alamat yang persis sama dengan
`APP_URL`**. Dengan contoh di atas, buka `http://localhost:3000`. Mengganti
hostname menjadi `127.0.0.1`, IP LAN, atau mengganti port tanpa mengubah
`APP_URL` akan menggagalkan pemeriksaan origin saat login.

Pastikan status penyimpanan setelah login menampilkan **MySQL**. Membuka file
`dist/index.html` atau menyajikan `dist/` secara statis hanya menyediakan mode
browser. Biarkan proses `npm start` berjalan; panduan instalasi menjelaskan
konfigurasi layanan dan reverse proxy untuk penggunaan server.

## Master data dalam paket

| Master sumber | Jumlah |
| --- | ---: |
| Produk material | 19 |
| Blank/raw material | 186 |
| Aturan power | 2.026 |
| Frame shape | 13 |
| Tinting | 66 |
| SKU produk finish | **0** |

Master SKU dari browser atau database perusahaan tidak otomatis ikut dalam
paket. Screenshot **CREA2** yang pernah diberikan hanya menunjukkan pilihan
produk, bukan seluruh assignment blank dan batas power SKU. Konfigurasi itu
tidak dibuat ulang dari gambar. Untuk memindahkannya, buka **Manage → Master SKU
→ Ekspor JSON** pada aplikasi asal, lalu impor JSON tersebut pada instalasi
MySQL baru. Perubahan master yang hanya tersimpan di aplikasi asal juga perlu
diekspor dan diimpor melalui menu Manage.

Setelah impor atau seed, `npm run doctor` menampilkan jumlah master yang
benar-benar berada di database. Laporan pengujian paket lengkap ada di
`docs/QA_RELEASE_2_1_1.md`, dan log barunya di `docs/qa-results/2.1.1-full/`.
Laporan versi sebelumnya tetap disertakan sebagai riwayat pengujian.
