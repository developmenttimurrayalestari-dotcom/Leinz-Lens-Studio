# Leinz Lens Studio 2.2.0 — photochromic, UV, dan impor data

Versi ini menambahkan preview photochromic pada pasangan A/B, impor CSV dan
Excel beserta template, serta pengujian beberapa resep dalam satu tabel.
Pengaturan frame dan resep tetap berada di atas tint terpilih pada panel
Frame & resep. Pengaturan SKU, indeks dan produk berada pada perbandingan A/B.

## 1. Preview photochromic

Pada setiap kartu preview tersedia checkbox **Photochromic A** atau
**Photochromic B**. Satu pilihan berlaku untuk kedua lensa R/L dalam pasangan
tersebut. Contohnya, A dapat memakai photochromic pada indeks 1.74 sementara B
memakai tint pada indeks 1.50. Keduanya tetap menggunakan frame dan resep uji
yang sama agar perbandingan mudah dibaca.

Saat photochromic diaktifkan:

- Kode tint aktif pada pasangan tersebut dikosongkan.
- Kartu tint dan warna custom dinonaktifkan ketika pasangan itu sedang dipilih.
- Tombol **Samakan warna** dinonaktifkan selama salah satu pasangan memakai
  photochromic, sehingga tint tidak tersalin ke pasangan photochromic.
- Pasangan lain yang tidak memakai photochromic tetap dapat diberi tint.
- Mematikan photochromic mengembalikan pasangan menjadi tanpa tint. Pilih tint
  kembali bila diperlukan; aplikasi tidak mengaktifkan tint lama secara diam-diam.

## 2. Simulasi paparan UV

Panel **Paparan UV simulasi** menyediakan slider 0–100% dan preset 0%, 50%,
serta 100%. Kontrol aktif setelah salah satu pasangan memakai photochromic.
Satu nilai UV diterapkan bersama pada semua pasangan photochromic.

Pada 0%, preview bening. Menaikkan UV membuat lensa berangsur lebih gelap dalam
warna abu-abu; menurunkannya kembali menjernihkan lensa. Perubahan permukaan,
transparansi, pantulan, outline dan warna tepi dilakukan secara kontinu.
Rotasi 360°, pilihan sudut pandang, jenis frame, tangkai, dan anotasi CT/ET
tetap dapat digunakan pada mode ini.

**Angka “gelap visual” adalah skala tampilan relatif.** Nilai 100% berarti
pengaturan visual paling gelap yang disediakan simulator, bukan lensa yang
menahan 100% cahaya. Slider bukan UV Index, irradiance, VLT, atau waktu aktivasi.
Aplikasi tidak memodelkan suhu, durasi paparan, merek, formula photochromic,
atau karakteristik bahan tertentu. Pilihan preview ini juga belum memverifikasi
bahwa SKU/material yang dipilih tersedia dalam varian photochromic.

Sebagai dasar umum, respons photochromic dipengaruhi UV, suhu dan material.
Referensi produsen: [Transitions — How photochromic lenses work](https://www.transitions.com/en-us/why-transitions/the-technology/photochromic-tech/).
Tampilan abu-abu aplikasi merupakan ilustrasi generik, bukan kalibrasi suatu
produk Transitions atau klaim performa merek tertentu.

UV hanya mengubah penampilan material. Diameter yang dibutuhkan, kandidat
blank, permukaan optik, indeks, CT dan ET tidak dihitung ulang karena perubahan
UV. Perhitungan ketebalan tetap mengikuti [model optik](OPTICS_MODEL.md).

## 3. Penyimpanan dan pemindahan konsultasi

Mode photochromic A/B dan UV disimpan bersama konsultasi. Pada instalasi
server, data berada dalam dokumen JSON MySQL; pada preview statis, data berada
di browser. Pengaturan dipulihkan setelah reload dan ketika konsultasi dibuka
dari riwayat. Ringkasan, cetakan, JSON dan gambar preview menunjukkan mode
photochromic serta nilai UV yang dipakai.

Ekspor baru menggunakan `trl-lens-consultation/1.4`. Impor tetap menerima
schema 1.3; berkas lama mendapat default photochromic nonaktif dan UV 0.
Impor/penyimpanan menolak pasangan photochromic dengan tint aktif, UV di luar
0–100, tipe nilai yang salah, atau snapshot photochromic yang bertentangan
dengan pengaturan bersama. Ini berlaku di validator aplikasi dan server.

## 4. Impor CSV dan Excel

Setiap tab Manage menyediakan **Impor JSON / CSV / Excel** dan **Template
impor**. Format tabular berlaku pada tab yang sedang dibuka: blank/raw
material, frame shape, tinting, atau SKU. Berkas Excel memakai `.xlsx`; simpan
ulang `.xls` menjadi `.xlsx` terlebih dahulu.

Semua baris diperiksa sebelum tombol penerapan diaktifkan. Ringkasan menunjukkan
penambahan, perubahan, duplikat dan baris yang tidak valid. Kesalahan pada satu
baris membatalkan persiapan seluruh berkas. Impor identik ditandai sebagai tidak
ada perubahan, sehingga tidak membuat master atau aturan rangkap.

Delapan template CSV/Excel berada pada `dist/templates/`. Sheet **Petunjuk**
menjelaskan isi contoh, nilai wajib, satuan, serta cara mengisi data. Detail
semua kolom dan aturan penggantian ada di [panduan impor](IMPORT_CSV_EXCEL.md).

Untuk blank, **SPH AND CYL AND ADD harus cocok pada satu baris aturan**. Baris
lainnya menjadi alternatif. CYL `0..0` dan ADD `0..0` berarti tepat nol.
Sebagai contoh, penerimaan SPH −9/CYL −4/ADD 0 pada satu baris dan
SPH −9/CYL 0/ADD +1 pada baris lain tidak otomatis menerima
SPH −9/CYL −4/ADD +1.

## 5. Uji resep simultan

Buka **Manage → Blank / Raw Material → Cek kecocokan blank**, atau tombol
**Lihat kandidat blank** pada Studio. Tabel **Uji resep simultan** memulai satu
baris dari resep studio. Gunakan **+ Resep dari studio** untuk menambahkan baris,
lalu ubah SPH, CYL minus dan ADD pada setiap baris. Maksimum 20 resep.

Setiap resep langsung diperiksa terhadap konfigurasi A dan B. Hasil memuat:

- status kelayakan R/L;
- jumlah kandidat per mata;
- diameter kandidat terkecil per mata;
- jumlah aturan yang cocok, atau alasan kegagalan.

Pemeriksaan menggabungkan aturan bahan, power finish SKU, assignment blank,
status arsip, serta kebutuhan diameter berdasarkan frame dan sentrasi saat ini.
Isi tabel uji tidak mengganti resep utama. Tombol **Unduh hasil CSV** menyertakan
hasil tiap resep/pasangan, ID blank dan aturan yang cocok untuk penelusuran.
Tabel uji bersifat sementara dan tidak termasuk riwayat konsultasi.

## 6. Paket dan upgrade MySQL

Paket lengkap mencakup backend Node.js, frontend, template, fixture Excel acuan,
test otomatis, SQL gabungan maupun terpisah, dan master referensi: 19 produk,
186 blank, 2.026 aturan power, 13 shape, dan 66 tint. Dokumen SKU awal kosong;
contoh `DEMO-IMPORT` pada template adalah nonaktif dan belum dimasukkan ke seed.

Target database tetap MySQL 5.7.24. Pembaruan dari 2.1.1 menggunakan struktur
tujuh tabel yang sama, sehingga tidak membutuhkan migrasi baru. Untuk instalasi
awal atau pemindahan data, ikuti [Mulai di sini](../MULAI_DI_SINI.md) dan
[panduan database](DATABASE_IMPORT.md). Laporan QA rilis tersedia pada
[QA 2.2.0](QA_RELEASE_2_2_0.md).
