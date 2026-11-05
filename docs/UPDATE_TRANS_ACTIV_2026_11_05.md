# Pembaruan tampilan — 5 November 2026

## Catatan di bawah preview lensa

Satu blok catatan ditampilkan tepat setelah kedua preview A/B. Teks mengikuti
permintaan pengguna:

> Nilai hasil yang ada pada preview simulator lensa merupakan nilai yang mendekati perhitungan Center Thicknes (CT) & Edge Thickness (ET) real yang mengacu pada Raw Material, Refraksi, Frame Shape, dan Diameter lensa. Nilai Center Thicknes (CT) & Edge Thickness (ET) lensa fisik pada lensa Leinz memungkinkan lebih tipis hingga 10-30%

Catatan menggunakan alur halaman biasa sehingga teks dapat membungkus pada
layar kecil. Nilai CT/ET tetap dihasilkan oleh model optik yang tersedia.

## Nama fitur TransActiv

Nama fitur pada antarmuka menjadi **TransActiv**: pilihan A/B, status UV,
penguncian tint, tooltip, notifikasi, caption lensa, ringkasan/cetakan,
riwayat, catatan ekspor JSON, nama unduhan PNG, serta pesan validasi.
Istilah photochromic dalam panduan rilis sebelumnya merujuk fitur yang sama.

Properti state dan snapshot `photochromic`, schema JSON, ID elemen, serta
nama modul tetap kompatibel dengan konsultasi yang sudah disimpan. Nama
kanonis produk supplier pada master dipertahankan.

## Verifikasi perubahan

- `npm run build`: berhasil; 40 berkas JavaScript serta aset/katalog valid.
- Suite validasi server, model UV, dan konsultasi: **41 tes lulus, 0 gagal**.
- Pemeriksaan diff: berhasil.
- Browser: label A/B dan caption memakai TransActiv; UV 100% menggelapkan
  pasangan yang aktif; pilihan tint dan Samakan warna terkunci.
- Catatan tampil utuh tepat di bawah preview, dengan lebar area catatan
  884 px pada desktop serta 321 px pada viewport dalam 375 px. Tidak ada
  pemotongan teks atau overflow horizontal pada pemeriksaan tersebut.
- Master material, frame shape, tinting, dan tiga SQL tetap identik dengan
  hash pada inventory: 19 produk, 186 blank, 2.026 aturan, 13 shape, 66 tint.

Pembaruan ini terbatas pada teks dan tata letak catatan. Laporan QA instalasi
dan integrasi MySQL 5.7.24 sebelumnya tetap tersedia dalam paket sebagai
riwayat pengujian; pengujian database penuh tidak diulang untuk perubahan ini.
