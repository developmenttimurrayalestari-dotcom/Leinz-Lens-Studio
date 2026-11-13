# Impor CSV, Excel, dan template — Leinz Lens Studio 2.2.0

Impor tersedia di **Manage → Blank / Raw Material, Frame Shape, Manage Tinting, dan Master SKU**. CSV dan Excel mengikuti jenis master pada tab yang sedang dibuka. Seluruh isi berkas divalidasi dan ditampilkan untuk ditinjau sebelum tombol **Terapkan** dapat menyimpan perubahan.

## 1. Cara menggunakan

1. Buka tab master yang sesuai, lalu unduh **Template impor → Excel (.xlsx)** atau **CSV (.csv)**.
2. Ganti contoh dengan data yang ingin dimasukkan. Pertahankan header; gunakan angka tetap, bukan formula Excel. Untuk kode seperti `001`, gunakan format sel **Text** agar nol awal tetap ada.
3. Pilih **Impor JSON / CSV / Excel**. Periksa jumlah baris, duplikat, record baru/berubah, aturan yang dilepas, serta contoh baris pada tinjauan.
4. Jika ada kesalahan, perbaiki berkas lalu pilih kembali. Kesalahan menampilkan sheet, baris, dan kolom bila tersedia. Tidak ada baris yang diterapkan sebagian.
5. Klik **Terapkan perubahan master** atau **Terapkan impor … SKU**. Aplikasi baru menyatakan berhasil setelah penyimpanan dikonfirmasi. Master yang berubah di sesi lain perlu ditinjau ulang sebelum disimpan.

Mode browser menyimpan perubahan pada browser tersebut. Instalasi server menyimpan master bersama di MySQL. Ekspor JSON tersedia untuk cadangan dan pemindahan data. Impor dan perubahan master tidak menunjukkan jumlah stok gudang.

### Format dan berkas template

| Tab Manage | CSV | Excel | Sheet data |
|---|---|---|---|
| Blank / Raw Material | [blank-template.csv](../dist/templates/blank-template.csv) | [blank-template.xlsx](../dist/templates/blank-template.xlsx) | `Blank` |
| Frame Shape | [frame-shape-template.csv](../dist/templates/frame-shape-template.csv) | [frame-shape-template.xlsx](../dist/templates/frame-shape-template.xlsx) | `FrameShape` |
| Manage Tinting | [tinting-template.csv](../dist/templates/tinting-template.csv) | [tinting-template.xlsx](../dist/templates/tinting-template.xlsx) | `Tinting` |
| Master SKU | [sku-template.csv](../dist/templates/sku-template.csv) | [sku-template.xlsx](../dist/templates/sku-template.xlsx) | `SKU` |

Dalam aplikasi, berkas tersedia pada `templates/<nama-berkas>`. Semua template Excel mempunyai sheet `Petunjuk`. Importer mengabaikan sheet bernama `Petunjuk`, `README`, `Instructions`, atau `Panduan`; sheet data lain dibaca bersama dan harus mempunyai header yang sesuai. Nama sheet sumber boleh berbeda, misalnya `DMO UNV OSA`.

CSV mendukung pemisah koma, titik koma, atau tab; tanda kutip CSV; teks multiline; BOM UTF-8/UTF-16; serta deklarasi `sep=`. Angka dapat memakai titik atau koma desimal tanpa pemisah ribuan. Saat memakai pemisah koma CSV, nilai desimal berkoma harus dikutip, misalnya `"7,5"`; memakai pemisah titik koma juga dapat digunakan. Template CSV menggunakan UTF-8 BOM, koma sebagai pemisah, dan titik desimal.

Excel yang didukung adalah **`.xlsx`**. Untuk `.xls`, gunakan **Save As → Excel Workbook (.xlsx)** terlebih dahulu. JSON tetap memakai format ekspor aplikasi:

- Pada tiga tab master pertama, `trl-master-catalogs/1.0` memuat bahan, shape, dan tint sebagai satu paket. Master SKU terpisah.
- Pada Master SKU, `trl-sku-catalog/1.0` memuat konfigurasi SKU dan assignment-nya.
- Impor JSON konsultasi tetap berada pada riwayat konsultasi; bukan melalui impor master.

## 2. Blank / raw material

Header wajib mengikuti 13 kolom berkas acuan:

```csv
supplier,LensCode,Descr,base_curve,diameter,center_thickness,edge_thickness,sph_from,sph_to,cyl_from,cyl_to,add_from,add_to
```

| Kolom | Arti dan aturan |
|---|---|
| `supplier`, `LensCode` | Identitas supplier dan produk. Kode yang sama pada supplier berbeda tetap merupakan produk berbeda. Penamaan harus konsisten, termasuk huruf besar/kecil. Supplier sumber adalah `DMO` dan `SOA`; nama berkas yang mengandung `OSA` tidak mengubah kode `SOA`. |
| `Descr` | Nama/deskripsi produk. Produk baru memerlukan indeks yang jelas pada deskripsi atau kolom tambahan `index`. |
| `base_curve` | Label BC menurut konvensi supplier, rentang 0–30. Label ini tidak otomatis menjadi power permukaan untuk kalkulasi finishing. |
| `diameter` | Diameter blank, 20–150 mm. |
| `center_thickness`, `edge_thickness` | CT dan ET **bahan baku**, masing-masing 0,1–50 mm; terpisah dari estimasi ketebalan lensa selesai. |
| `sph_from`, `sph_to` | Batas SPH inklusif, −40 sampai +40 D. |
| `cyl_from`, `cyl_to` | Batas CYL inklusif, −20 sampai 0 D. Konvensi yang diterima adalah CYL minus/nol. |
| `add_from`, `add_to` | Batas ADD inklusif, 0 sampai +10 D. |

Kolom **`index` bersifat opsional** dan boleh ditambahkan. Produk yang sudah dikenal mengikuti indeks master; indeks eksplisit atau indeks pada deskripsi yang bertentangan akan ditolak. Produk baru menerima indeks eksplisit yang valid atau satu nilai indeks yang tidak ambigu pada `Descr`. `1.6` setara dengan `1.60`; nilai seperti `1.599` atau `1.6001` tidak dibulatkan menjadi `1.60`. Importer tidak menebak indeks hanya dari akhiran `LensCode`.

Enam indeks simulator adalah **1.50, 1.56, 1.57, 1.60, 1.67, dan 1.74**. Data bahan **1.59** tetap tersimpan sebagai katalog dan tidak diaktifkan untuk simulator/SKU.

### Identitas, pembaruan, dan sumber

Identitas produk adalah **supplier + LensCode**. Identitas blank fisik adalah **produk + base_curve + diameter**. CT/ET untuk identitas blank yang sama harus konsisten. Jika CT/ET berbeda antarbaris atau berbeda dari master yang sudah ada, impor ditolak. Periksa sumber; bila perubahan spesifikasi memang benar, koreksi secara eksplisit melalui editor blank sebelum mengimpor cakupannya. Identitas ambigu akibat duplikasi produk/blank pada master juga harus diselesaikan terlebih dahulu.

**Setiap blank yang tercantum memakai seluruh kumpulan aturan dari berkas tersebut.** Aturan lama blank itu yang tidak lagi tercantum akan dilepas. Karena itu, sertakan **semua baris cakupan setiap blank yang diperbarui**. Produk, blank, dan master lain di luar berkas tetap tersedia. Impor tabular tidak menghapus identitas blank dan mempertahankan status arsip serta profil finishing yang telah ada.

Duplikat identik diringkas menjadi satu aturan; jumlahnya dilaporkan. Aturan baru menyimpan nama berkas, sheet, dan semua nomor baris sumbernya. Aturan yang sudah sama mempertahankan ID dan provenance sebelumnya. Mengimpor ulang isi yang sama menghasilkan **tidak ada perubahan**, sehingga tombol penerapan tidak memicu penyimpanan ulang.

Nomor baris selalu terkait **berkas dan sheet asalnya**. Susunan workbook Excel tidak harus sama dengan CSV lama. Dalam workbook `DMO UNV OSA.xlsx`, dua aturan contoh berikut berada pada baris **3–4** sheet `DMO UNV OSA`; dalam template kecil, keduanya berada pada baris **2–3**. Master yang tidak berubah tetap dapat menampilkan nomor baris dari CSV sumber sebelumnya. Nomor tersebut bukan nomor baris workbook baru.

### Range harus cocok bersamaan

Untuk sebuah resep, **SPH AND CYL AND ADD harus cocok pada satu baris aturan**. Cukup satu baris cocok untuk meloloskan range blank (**OR antarbaris**). Batas `from` dan `to` ikut tercakup. `0..0` berarti tepat nol; sel kosong tidak berarti nol atau semua nilai.

Contoh nyata DMO / SPHG60, BC 1, diameter 75 mm, CT blank 7,5 mm, ET blank 15 mm:

| Aturan | SPH | CYL | ADD |
|---|---|---|---|
| 1 | −10,00 s/d −8,00 | 0,00 s/d 0,00 | +0,25 s/d +4,00 |
| 2 | −9,25 s/d −7,75 | −6,00 s/d 0,00 | 0,00 s/d 0,00 |

| Resep uji | Hasil range |
|---|---|
| SPH −9 / CYL −4 / ADD 0 | Cocok aturan 2 |
| SPH −9 / CYL 0 / ADD +1 | Cocok aturan 1 |
| SPH −9 / CYL −4 / ADD +1 | Tidak tercakup |

Menggabungkan minimum/maksimum semua kolom menjadi satu range besar akan meloloskan resep terakhir secara keliru. Template blank memuat kedua aturan lengkap tersebut. Lolos range masih memerlukan diameter yang cukup untuk frame/sentrasi masing-masing mata, range finish SKU, dan assignment blank yang sesuai. Fitur **Uji resep simultan** dijelaskan bersama perubahan simulator pada [PERUBAHAN_2_2_0.md](PERUBAHAN_2_2_0.md).

## 3. Master SKU

```csv
sku_code,sku_name,sku_active,index,index_enabled,sph_min,sph_max,cyl_min,cyl_max,add_min,add_max,supplier,LensCode,base_curve,diameter
```

Satu baris menunjuk satu blank fisik untuk satu SKU dan indeks. Ulangi baris untuk menambahkan blank atau supplier. `sku_code`, nama, dan status harus konsisten; status indeks pada kombinasi SKU/indeks yang sama juga harus konsisten. **Range finish boleh berbeda untuk masing-masing diameter**, misalnya Ø65 dengan SPH -4..+6 dan Ø70 dengan SPH -8..+2. Diameter, SPH, CYL, dan ADD diperiksa bersamaan pada satu baris; rentang antarbaris tidak digabung menjadi batas minimum/maksimum global. Supplier, LensCode, BC, dan diameter harus menunjuk blank nyata di master, dengan indeks bahan yang sesuai. CT/ET diambil dari master blank.

Kode SKU dicocokkan tanpa membedakan huruf besar/kecil. SKU yang sudah cocok mempertahankan identitasnya. Impor memperbarui **seluruh konfigurasi indeks dan assignment SKU yang tercantum**, sehingga semua indeks/blank yang tetap diizinkan harus disertakan. SKU lain tetap tersimpan. Kode yang pernah dipakai lalu diubah tidak menyebabkan SKU lama tertimpa ketika kode tersebut digunakan kembali.

`sku_active` dan `index_enabled` menerima `TRUE/FALSE` atau `1/0`. Indeks aktif memerlukan range lengkap dan assignment blank. Untuk indeks nonaktif tanpa assignment, keempat kolom supplier/LensCode/BC/diameter boleh dikosongkan bersama; pasangan batas power juga boleh kosong. SKU aktif harus mempunyai setidaknya satu indeks aktif. Range finish tetap diperiksa bersama aturan bahan dan kebutuhan diameter.

Template berisi **DEMO-IMPORT dengan `sku_active=FALSE`**, bukan SKU produksi. Contoh memakai blank nyata DMO/SPHG60, indeks 1.60, BC 1, diameter 75 mm; range contoh SPH −9,25..−8, CYL −4..0, ADD 0..0. Mengunduh template tidak menambahkan SKU. Impor yang dikonfirmasi akan menyimpan contoh nonaktif tersebut; ganti dengan konfigurasi perusahaan sebelum digunakan untuk operasional.

## 4. Frame Shape

```csv
code,name,active,width_mm,height_mm,contour,points_json
```

`code` adalah identitas bentuk, `active` menentukan ketersediaan, dan ukuran awal satu bukaan lensa adalah lebar 35–70 mm serta tinggi 25–60 mm. Kode yang sama memperbarui bentuk tersebut; bentuk lain tetap tersedia.

| `contour` | Penggunaan |
|---|---|
| `keep` | Mempertahankan kontur dan acuan bentuk yang sudah ada. Hanya untuk kode yang sudah dikenal; `points_json` dikosongkan. |
| `ellipse` | Membuat kontur elips halus. Lebar dan tinggi sama menghasilkan lingkaran. |
| `rounded-rectangle` | Membuat persegi panjang dengan sudut membulat. |
| `points` | Membaca kontur lengkap dari `points_json`: 4–512 pasangan angka `[x,y]` ternormalisasi sekitar −0,5 sampai +0,5. Kontur tidak boleh berpotongan dengan dirinya sendiri, mempunyai titik berurutan sama, atau luas yang tidak memadai. |

Untuk `ellipse` dan `rounded-rectangle`, kosongkan `points_json`. Contoh kontur `points` yang valid adalah `[[-0.5,0],[0,-0.5],[0.5,0],[0,0.5]]`. Bungkus sel JSON dengan kutip CSV bila berisi koma. Template memakai master `round` dan `rectangle` dengan `keep`, sehingga impor ulang contoh mempertahankan kontur acuan.

## 5. Manage Tinting

```csv
code,name,kind,group,nominal_percent,preview_hex,preview_mid_hex,preview_bottom_hex,reference_note,requires_physical_sample,active,override_reference,manual_reference
```

`kind` memakai `Solid` atau `Gradient`; `group` memakai `fashion`, `sunglass`, `therapeutic`, atau `special`. `nominal_percent` adalah label katalog 0–100 dan boleh kosong; nilainya tidak dinyatakan sebagai VLT terukur. Warna memakai `#RRGGBB` atau kosong bila tidak tersedia. Gradient dengan warna preview memerlukan warna bawah; warna tengah opsional. Solid harus mempunyai warna yang sama pada setiap posisi yang diisi. Tanpa warna utama, warna tengah/bawah juga harus kosong.

`reference_note` mencatat acuan, `requires_physical_sample` menunjukkan kebutuhan sampel fisik, dan `active` mengatur ketersediaan. Gunakan boolean `TRUE/FALSE` atau `1/0`.

Biarkan **`override_reference=FALSE`** untuk pembaruan biasa. Mengubah preview tint yang mempunyai konflik acuan memerlukan **`override_reference=TRUE` dan `manual_reference` yang diisi** dengan acuan pengganti yang jelas. Perubahan warna dicatat sebagai acuan digital manual yang belum dikalibrasi. Data yang sama mempertahankan sumber/status referensi sebelumnya. Template memakai contoh master `01S` dan `02G` tanpa mengganti acuannya. Aturan photochromic dan tint pada preview dijelaskan dalam [PERUBAHAN_2_2_0.md](PERUBAHAN_2_2_0.md).

## 6. Batas impor dan master bawaan

Pada mode MySQL, tombol **Terapkan perubahan master** mengirim hasil katalog
yang sudah ditinjau ke `/api/catalogs`, termasuk data master yang dipertahankan
dan riwayat sumbernya. Ukuran permintaan dapat lebih besar dari berkas Excel.
Permintaan katalog besar kini dikompresi gzip sebelum dikirim pada browser
yang mendukungnya; data tetap divalidasi dan disimpan dalam satu transaksi.
Backend membatasi hasil dekompresi ke 8 MiB. Jika masih terjadi HTTP 413, ikuti
[pengaturan batas upload Nginx](INSTALL_MYSQL57.md#contoh-reverse-proxy-nginx).
Perbarui frontend/backend bersamaan dan restart Node.js sebelum mengimpor ulang.

| Batas | Nilai |
|---|---:|
| Ukuran satu berkas | 8 MiB |
| Total baris data semua sheet | 20.000 |
| Kolom per sheet | 32 |
| Sheet per workbook | 12 |
| Panjang satu sel | 32.768 karakter |
| Isi workbook setelah dekompresi | 64 MiB |

Formula, sel error/tanggal, merge pada sheet data, angka tidak valid, header hilang/berulang/tidak dikenal, dan range minimum di atas maksimum akan ditolak. Gunakan **Paste Values** pada sheet data sebelum impor. Setiap berkas harus memiliki setidaknya satu baris data. Validasi katalog akhir juga berlaku: maksimal 1.000 produk bahan, 10.000 blank, 20.000 aturan, 200 shape, 1.000 tint, dan 1.000 SKU; struktur atau referensi yang tidak valid tidak dapat disimpan.

Master bawaan rilis ini memuat **19 produk bahan, 186 blank, 2.026 aturan unik, 13 frame shape, dan 66 tint** (46 Solid, 20 Gradient). Belum ada SKU produksi yang ditambahkan sebagai seed. Workbook acuan memuat **2.689 baris**, termasuk **663 baris duplikat identik**, dan sesuai dengan isi master bahan bawaan. Mengimpornya ulang menghasilkan tinjauan tanpa perubahan. Data master yang sudah dikelola pada instalasi pengguna dapat mempunyai jumlah berbeda.

Untuk penelusuran teknis, salinan workbook acuan berada di [tools/fixtures/blank-reference.xlsx](../tools/fixtures/blank-reference.xlsx); perilaku impor diuji pada `tools/test-tabular-import.mjs` dan `tools/test-import-regressions.mjs`. Informasi instalasi database tersedia dalam [DATABASE_IMPORT.md](DATABASE_IMPORT.md) dan [INSTALL_MYSQL57.md](INSTALL_MYSQL57.md).
