LEINZ LENS STUDIO — PETUNJUK TEMPLATE IMPOR

Empat template tersedia dalam CSV dan Excel (.xlsx). Gunakan salah satu format.
File berisi contoh. Hapus/ganti baris contoh sebelum memuat data baru.
Header pada baris pertama harus dipertahankan. Excel memiliki sheet Petunjuk.

TEMPLATE IMPOR BLANK
File: blank-template.csv / blank-template.xlsx
Sebelum digunakan: Hapus atau ganti baris contoh dengan data yang akan diimpor. Pertahankan nama dan urutan header pada baris pertama.
Alur impor: Pilih file di menu Manage, periksa pratinjau dan pesan validasi, lalu terapkan impor. Sheet Petunjuk diabaikan oleh importer.
Format angka: Isi angka sebagai angka Excel, bukan formula. Pada CSV gunakan titik desimal. File contoh CSV memakai UTF-8 BOM dan pemisah koma.
Nilai kosong: Kosong berarti tidak diisi; 0 adalah angka nol. Jangan memakai formula, simbol satuan, atau tanda s/d pada kolom angka.
Contoh lengkap: Dua baris contoh memuat seluruh aturan DMO / SPHG60, BC 1.00, diameter 75.00 mm. CT blank 7.50 mm dan ET blank 15.00 mm.
Sumber contoh: Master bahan baku Leinz Lens Studio; nilainya sesuai DMO UNV OSA.xlsx, sheet DMO UNV OSA, baris 3–4.
Identitas blank: supplier + LensCode + base_curve + diameter menentukan satu blank fisik. Kode produk yang sama pada supplier berbeda tetap terpisah.
Mengimpor ulang: Semua aturan untuk blank yang tercantum diganti oleh seluruh barisnya dalam file ini. Sertakan cakupan lengkap blank tersebut. Blank lain tetap tersimpan.
Kombinasi range: SPH, CYL, dan ADD harus cocok pada baris yang sama (AND). Cukup satu baris cocok untuk blank tersebut (OR antarbaris). Batas from/to ikut tercakup.
Angka nol: CYL 0.00–0.00 hanya untuk silinder nol. ADD 0.00–0.00 hanya untuk ADD nol. Angka nol bukan semua nilai; kolom wajib tidak boleh kosong.
Konvensi CYL: Gunakan CYL minus atau nol seperti data acuan. Jangan mengganti tanda CYL tanpa menyesuaikan resep. Batas from harus lebih kecil atau sama dengan to.
Uji contoh: SPH −9 / CYL −4 / ADD 0 cocok. SPH −9 / CYL 0 / ADD +1 cocok. SPH −9 / CYL −4 / ADD +1 tidak tercakup oleh blank contoh.
Duplikat & konflik: Aturan yang identik dapat digabung dengan jejak baris asal. CT/ET yang berbeda untuk identitas blank sama harus dikoreksi sebelum impor.
supplier, LensCode: Teks kode supplier dan produk; gunakan penamaan yang konsisten. Supplier contoh adalah DMO. Nilai SOA pada master tidak boleh diganti menjadi OSA.
Descr / indeks: Nama/deskripsi produk memuat indeks yang jelas, misalnya 1.6 atau 1.60. Produk dikenal mengikuti indeks pada master. Indeks yang tidak jelas perlu dikoreksi.
base_curve: Base curve blank dalam dioptri (D), sesuai spesifikasi supplier.
diameter: Diameter blank dalam milimeter (mm), misalnya 75.00. Harus positif dan sesuai ketersediaan supplier.
center_thickness: Ketebalan pusat blank bahan baku dalam mm. Ini bukan CT lensa selesai hasil simulasi.
edge_thickness: Ketebalan tepi blank bahan baku dalam mm. Ini bukan ET lensa selesai hasil simulasi.
sph_from / sph_to: Batas SPH minimum dan maksimum untuk baris cakupan ini, dalam D.
cyl_from / cyl_to: Batas CYL minimum dan maksimum untuk baris cakupan ini, dalam D; gunakan minus/zero.
add_from / add_to: Batas ADD minimum dan maksimum untuk baris cakupan ini, dalam D. Isi 0 dan 0 jika hanya tanpa ADD.
Kelayakan simulator: Lolos range masih memerlukan diameter yang cukup, geometri frame, aturan SKU, dan assignment blank. Data cakupan tidak menyatakan stok aktual.

TEMPLATE IMPOR FRAME SHAPE
File: frame-shape-template.csv / frame-shape-template.xlsx
Sebelum digunakan: Hapus atau ganti baris contoh dengan data yang akan diimpor. Pertahankan nama dan urutan header pada baris pertama.
Alur impor: Pilih file di menu Manage, periksa pratinjau dan pesan validasi, lalu terapkan impor. Sheet Petunjuk diabaikan oleh importer.
Format angka: Isi angka sebagai angka Excel, bukan formula. Pada CSV gunakan titik desimal. File contoh CSV memakai UTF-8 BOM dan pemisah koma.
Nilai kosong: Kosong berarti tidak diisi; 0 adalah angka nol. Jangan memakai formula, simbol satuan, atau tanda s/d pada kolom angka.
Pilihan aktif: Isi TRUE atau FALSE untuk kolom status. FALSE menyimpan entri tanpa mengaktifkannya dalam pilihan simulator.
Contoh master: Kode round dan rectangle memakai nama serta ukuran awal dari master frame shape. contour=keep mempertahankan kontur acuan yang sudah ada.
Mengimpor ulang: Kode yang sama memperbarui shape tersebut. Shape lain tidak dihapus. Untuk shape baru gunakan kode baru dan pilih kontur yang didukung.
code: Kode unik dalam bentuk teks. Pertahankan leading zero pada kode seperti 001. Jangan menggunakan kode yang sama untuk dua bentuk berbeda.
name: Nama yang ditampilkan saat memilih frame shape.
active: TRUE agar tersedia untuk dipilih; FALSE untuk menyimpan bentuk dalam keadaan nonaktif.
width_mm / height_mm: Lebar dan tinggi bukaan satu lensa dalam mm. Nilai positif ini menjadi ukuran awal dan dapat disesuaikan pada simulator.
contour = keep: Hanya untuk kode yang sudah ada. Mempertahankan titik kontur dan acuan bentuk saat nama, ukuran, atau status diperbarui. points_json dibiarkan kosong.
contour = ellipse: Membuat kontur elips halus. Lebar dan tinggi yang sama menghasilkan lingkaran. points_json dibiarkan kosong.
rounded-rectangle: Membuat kontur persegi panjang dengan sudut membulat. Sesuaikan width_mm dan height_mm. points_json dibiarkan kosong.
contour = points: Gunakan points_json berisi daftar pasangan [x,y] kontur yang valid. Satu baris mewakili satu kontur lengkap.
points_json: JSON array pasangan koordinat, misalnya [[-0.5,0],[0,-0.5],[0.5,0],[0,0.5]]. Koordinat mengikuti bounding box ternormalisasi, x ke kanan dan y ke bawah.
CSV dengan JSON: Jika points_json berisi koma, bungkus sel dengan tanda petik CSV. Template CSV sudah memakai penulisan kutip yang benar.
Sumber contoh: Master frame shape Leinz Lens Studio; kode round dan rectangle mempertahankan kontur dari SVG acuan pengguna.

TEMPLATE IMPOR TINTING
File: tinting-template.csv / tinting-template.xlsx
Sebelum digunakan: Hapus atau ganti baris contoh dengan data yang akan diimpor. Pertahankan nama dan urutan header pada baris pertama.
Alur impor: Pilih file di menu Manage, periksa pratinjau dan pesan validasi, lalu terapkan impor. Sheet Petunjuk diabaikan oleh importer.
Format angka: Isi angka sebagai angka Excel, bukan formula. Pada CSV gunakan titik desimal. File contoh CSV memakai UTF-8 BOM dan pemisah koma.
Nilai kosong: Kosong berarti tidak diisi; 0 adalah angka nol. Jangan memakai formula, simbol satuan, atau tanda s/d pada kolom angka.
Pilihan aktif: Isi TRUE atau FALSE untuk kolom status. FALSE menyimpan entri tanpa mengaktifkannya dalam pilihan simulator.
Contoh master: 01S Bazaar (Solid) dan 02G Cerulean Frost Gradient memakai nilai warna serta catatan acuan master. Sel kosong nominal_percent tetap kosong.
Mengimpor ulang: Kode yang sama memperbarui tint tersebut; tint lain tetap tersimpan. Data acuan yang tidak diubah dipertahankan.
code / name: Kode warna unik dan nama tampilan. Gunakan kode sebagai teks agar nol awal tidak hilang.
kind: Pilih Solid atau Gradient. Solid memakai satu warna; Gradient memakai warna atas, tengah, dan bawah.
group: Pilih fashion, sunglass, therapeutic, atau special sesuai kelompok katalog.
nominal_percent: Label persentase katalog 0–100. Kosong jika tidak ada pada sumber. Nilai ini bukan VLT atau transmisi yang terukur.
preview_hex: Warna utama/atas dalam format #RRGGBB. Kosong jika data warna tidak tersedia; jangan menggantinya dengan warna yang ditebak.
preview_mid_hex: Warna tengah gradasi #RRGGBB, jika tersedia. Pada contoh Solid nilainya sama dengan warna utama.
preview_bottom_hex: Warna bawah gradasi #RRGGBB, jika tersedia. Pada contoh Solid nilainya sama dengan warna utama.
reference_note: Catatan singkat tentang acuan warna, batasan ilustrasi, atau kebutuhan tindak lanjut.
requires_physical_sample: TRUE bila pemesanan warna membutuhkan contoh lensa fisik. FALSE bila tidak diwajibkan oleh data acuan.
override_reference: Tetap FALSE untuk pembaruan biasa. TRUE digunakan secara sengaja untuk mengganti referensi yang berkonflik, disertai manual_reference.
manual_reference: Acuan pengganti yang jelas bila override_reference=TRUE, misalnya kode sampel fisik dan tanggal pemeriksaan. Jangan diisi dengan acuan yang belum ada.
Warna pratinjau: Warna layar merupakan ilustrasi. Hasil tinting dapat berbeda menurut bahan lensa, indeks, coating, dan pencahayaan.
Sumber contoh: Master tinting Leinz Lens Studio; kode 01S dan 02G berstatus matched terhadap lembar contoh warna yang sudah tersedia.

TEMPLATE IMPOR SKU
File: sku-template.csv / sku-template.xlsx
Sebelum digunakan: Hapus atau ganti baris contoh dengan data yang akan diimpor. Pertahankan nama dan urutan header pada baris pertama.
Alur impor: Pilih file di menu Manage, periksa pratinjau dan pesan validasi, lalu terapkan impor. Sheet Petunjuk diabaikan oleh importer.
Format angka: Isi angka sebagai angka Excel, bukan formula. Pada CSV gunakan titik desimal. File contoh CSV memakai UTF-8 BOM dan pemisah koma.
Nilai kosong: Kosong berarti tidak diisi; 0 adalah angka nol. Jangan memakai formula, simbol satuan, atau tanda s/d pada kolom angka.
Pilihan aktif: Isi TRUE atau FALSE untuk kolom status. FALSE menyimpan entri tanpa mengaktifkannya dalam pilihan simulator.
Contoh nonaktif: DEMO-IMPORT adalah contoh baru dengan sku_active=FALSE, bukan SKU produksi. Ganti kode, nama, rentang, dan assignment sesuai produk yang disetujui.
Blank acuan: Contoh memakai blank nyata DMO / SPHG60, indeks 1.60, BC 1.00, diameter 75.00 mm. Range finish contoh berada dalam cakupan aturan blank tersebut.
Satu baris: Satu baris mewakili satu assignment blank fisik pada satu SKU dan indeks. Ulangi baris untuk menambah blank; gunakan metadata dan range yang sama pada SKU/indeks yang sama.
Mengimpor ulang: Impor mengganti seluruh indeks dan assignment untuk setiap SKU yang tercantum. Sertakan seluruh konfigurasi SKU tersebut; SKU lain tetap tersimpan.
sku_code / sku_name: Kode unik dan nama produk finish. Kode yang sama tanpa membedakan huruf besar/kecil memperbarui SKU yang sudah ada.
sku_active: TRUE untuk SKU aktif. FALSE menyimpan konfigurasi tanpa mengaktifkan SKU untuk pilihan simulator.
index: Indeks lensa: 1.50, 1.56, 1.57, 1.60, 1.67, atau 1.74, sesuai daftar indeks simulator.
index_enabled: TRUE mengaktifkan indeks pada SKU. FALSE menonaktifkan indeks tersebut. Semua baris dengan SKU/indeks sama harus memiliki status yang sama.
sph_min / sph_max: Range SPH finish/SKU dalam dioptri. Minimum tidak boleh melebihi maksimum. Ini tidak mengganti range bahan baku.
cyl_min / cyl_max: Range CYL finish/SKU dalam dioptri, menggunakan konvensi minus/zero. Isi 0 dan 0 bila hanya CYL nol.
add_min / add_max: Range ADD finish/SKU dalam dioptri. Isi 0 dan 0 untuk tanpa ADD.
supplier / LensCode: Kode supplier dan produk bahan baku yang sudah ada pada master. Indeks produk harus sesuai kolom index.
base_curve / diameter: Base curve (D) dan diameter (mm) harus menunjuk blank fisik yang tersedia. CT/ET diambil dari master blank, tidak dimasukkan ulang di SKU.
Indeks nonaktif: Untuk indeks nonaktif tanpa assignment, kolom supplier, LensCode, base_curve dan diameter dapat dikosongkan bersama.
Kecocokan resep: Resep harus lolos range SKU serta satu aturan SPH/CYL/ADD blank sekaligus. Assignment tidak menjamin stok maupun kecukupan diameter untuk semua frame.
Sumber contoh: Kode SKU dan range finish adalah contoh nonaktif. Identitas serta spesifikasi blank diambil dari master bahan baku Leinz Lens Studio.
