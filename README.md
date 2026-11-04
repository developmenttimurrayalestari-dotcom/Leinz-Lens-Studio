# Leinz Lens Studio

Simulator konsultasi tint dan ilustrasi bentuk lensa untuk PT Timur Raya Lestari.
Versi 2.1.1 menyediakan aplikasi server Node.js dengan database **MySQL 5.7.24**,
serta preview statis yang menyimpan data di browser. Keduanya memakai antarmuka
dan model perhitungan yang sama. Aplikasi belum mengirim order atau terhubung
langsung ke perhitungan produksi Lensware.

## Paket source code dan database lengkap

Paket **Leinz-Lens-Studio-2.1.1-Full-Source-Database.zip** memiliki folder utama
`leinz-lens-studio`. Mulai dari [MULAI_DI_SINI.md](MULAI_DI_SINI.md) untuk urutan
instalasi singkat, atau [panduan impor database](docs/DATABASE_IMPORT.md) untuk
memasang skema dan master melalui berkas SQL.

| Isi paket | Lokasi |
| --- | --- |
| Frontend siap disajikan, source simulator, dan aset | `dist/` |
| Backend Node.js, autentikasi, dan akses MySQL | `server/` |
| SQL gabungan skema dan seluruh master sumber | [database/leinz-schema-and-master-data.sql](database/leinz-schema-and-master-data.sql) |
| Migrasi skema yang dipakai perintah CLI | `database/001_initial.sql`, `database/002_managed_catalogs.sql` |
| Katalog master sumber dalam JSON | `dist/assets/materials.json`, `dist/assets/shapes.json`, `dist/assets/tints.json` |
| Konfigurasi contoh | `.env.example` |
| Panduan instalasi Windows/Linux | [docs/INSTALL_MYSQL57.md](docs/INSTALL_MYSQL57.md) |
| QA paket lengkap ini | [docs/QA_RELEASE_2_1_1.md](docs/QA_RELEASE_2_1_1.md) |
| Log pengujian paket lengkap ini | `docs/qa-results/2.1.1-full/` |

SQL dan jalur CLI memuat katalog sumber yang sama: **19 produk material,
186 blank, 2.026 aturan power, 13 frame shape, dan 66 tinting**. Master SKU awal
berisi **0 SKU**. Konfigurasi SKU perusahaan yang tersimpan di browser atau
server lain tidak tersedia dalam source ini. Screenshot **CREA2** menunjukkan
contoh pilihan, tetapi tidak memuat seluruh assignment blank dan batas power;
konfigurasi tersebut tidak direkonstruksi dari gambar. Ekspor Master SKU dari
instalasi asal, lalu impor melalui **Manage → Master SKU** untuk memindahkannya.

## Instalasi versi MySQL

Paket menggunakan **Node.js 22.x atau 24.x** dan **MySQL 5.7.24**, dengan dependency
terkunci pada `package-lock.json`. Siapkan database, akun database, dan `.env`
sesuai [panduan instalasi](docs/INSTALL_MYSQL57.md). Tidak tersedia akun atau
password database maupun aplikasi bawaan.

Setelah ekstraksi, jalankan dari folder `leinz-lens-studio`:

```sh
npm ci
npm run build
npm test
```

Pilih **satu** cara untuk membuat skema dan mengisi master:

| Jalur | Langkah |
| --- | --- |
| Otomatis melalui CLI aplikasi | Jalankan `npm run db:migrate`, kemudian `npm run db:seed`. |
| Impor SQL manual untuk database baru | Impor `database/leinz-schema-and-master-data.sql` mengikuti [DATABASE_IMPORT.md](docs/DATABASE_IMPORT.md). Langkah ini menggantikan kedua perintah CLI di atas pada instalasi awal. |

Sesudah salah satu jalur selesai, buat akun login aplikasi dan mulai layanan:

```sh
npm run admin:create
npm run doctor
npm start
```

`admin:create` meminta password baru **8–128 karakter**. Buka alamat browser yang
persis sama dengan `APP_URL` pada `.env`, termasuk protokol dan port. Status
penyimpanan setelah login harus menampilkan **MySQL**. Pada Windows PowerShell,
gunakan `npm.cmd` bila `npm.ps1` diblokir oleh kebijakan eksekusi.

Kode JavaScript dijalankan langsung. `npm run build` memeriksa sintaks seluruh
source, keberadaan aset HTML, dan JSON katalog; tidak memerlukan compiler C/C++,
Python, generator katalog, atau proses transpile untuk menjalankan aplikasi.
Hasil build, instalasi, impor database, dan batas QA paket lengkap ini dicatat
di [laporan QA release 2.1.1](docs/QA_RELEASE_2_1_1.md). Laporan
[QA tata letak 2.1.1](docs/QA_2_1_1.md), [QA 2.1](docs/QA_2_1.md), dan log lamanya
dipertahankan sebagai catatan historis; bukan pengganti hasil uji release ini.

## Pembaruan versi 2.1.1

Pengaturan **SKU produk finish**, **indeks**, dan **produk bahan baku** sekarang
berada di area **Perbandingan pasangan A/B**. Tombol **Pilihan A / Pilihan B**
menentukan pasangan yang sedang diatur, dengan penanda aktif yang mengikuti
judul pengaturan dan tint terpilih.

Panel **Frame & resep** menampilkan **Bentuk & ukuran frame** lalu
**Resep uji & sentrasi** di atas **Tint terpilih**. Dropdown frame shape membuat
ukuran A/B/DBL serta input resep lebih cepat dijangkau; thumbnail bentuk tetap
tersedia melalui **Lihat galeri bentuk**. Dropdown dan galeri memakai pilihan
bentuk yang sama. Bentuk yang diarsipkan tetap diberi penanda ketika dipulihkan
dari konsultasi lama.

Frame, ukuran dan resep berlaku untuk kedua pasangan A/B. SKU, indeks, bahan,
dan tint mengikuti pasangan aktif. Pada layar sempit, panel Frame & resep
ditampilkan lebih dahulu, dengan urutan keyboard sesuai urutan halaman.

Pembaruan **2.1.0 → 2.1.1 tidak memerlukan migrasi database baru**. Pertahankan
`.env` dan database yang digunakan, perbarui paket aplikasi, lalu restart
layanan dan muat ulang halaman browser. Jika versi sebelumnya masih **di bawah
2.1**, ikuti langkah migrasi 2.1 dalam
[panduan instalasi](docs/INSTALL_MYSQL57.md), termasuk `db:migrate` dan `db:seed`.
Rumus CT/ET, data master, dan skema penyimpanan tidak berubah pada patch ini.

## Pembaruan versi 2.1.0

Menu utama menjadi **Studio lensa** dan **Manage**. Manage menampung empat tab:

| Tab | Yang dapat dikelola |
| --- | --- |
| Blank / Raw Material | Produk, supplier, indeks, diameter, BC, CT/ET bahan, aturan SPH/CYL/ADD, dan profil finishing opsional |
| Frame Shape | Nama, ukuran awal A/B, kontur, tambah/salin bentuk, arsip dan aktivasi kembali |
| Manage Tinting | Kode, nama, Solid/Gradasi, kelompok, warna digital, label persentase dan acuan |
| Master SKU | Indeks yang tersedia, assignment supplier/produk/blank dan rentang power produk finish |

Pemeriksaan kandidat blank tersedia dari **Cek kecocokan blank**. Lembar acuan
warna dipindah ke **Manage Tinting → Lihat lembar acuan warna**. Semua master
dapat diekspor sebagai satu JSON dan diimpor melalui tinjauan perubahan.
Identitas master yang sudah ada dipertahankan; status arsip menonaktifkan pilihan
baru tanpa menghapus relasi riwayat. Master SKU tetap memiliki format impor
terpisah. Data katalog 1.59 tetap disimpan, tetapi tidak menjadi indeks simulator.

Pada server, ketiga katalog master disimpan atomik di MySQL. Migrasi 002 menambah
revisi bersama sehingga jumlah tabel menjadi tujuh. Dua sesi tidak dapat
menimpa perubahan master tanpa konflik yang terlihat. `db:seed` hanya mengisi
katalog yang belum ada, sehingga aman dijalankan setelah master diedit. Bootstrap,
refresh master, dan unduhan katalog terautentikasi membaca data database terbaru.
Seluruh akun aplikasi yang masuk dapat mengelola master; belum ada role operator
khusus atau pembatasan per jenis master.

Perhitungan CT/ET kini memakai sag permukaan depan sferis dan belakang torik,
hubungan daya back vertex, serta batas **minimum CT dan minimum ET terpisah**.
Profil dapat diatur pada produk atau blank; profil blank terpilih mendapat
prioritas. Pengaturan **Perhitungan CT / ET** di Studio dapat memakai override
konsultasi yang diterapkan pada pasangan A dan B. Profil, sumber parameter dan
hasil model ikut tersimpan dalam JSON konsultasi. Impor konsultasi memvalidasi
profil tersebut sebelum menerapkannya.

Target 10–20% lebih tipis tidak diterapkan sebagai pengali. Nilai dapat berkurang
sesuai parameter finishing yang benar, resep, indeks dan geometri frame. CT/ET
bahan baku tidak dianggap sebagai CT/ET finish, dan BC mentah tidak otomatis
dianggap sebagai power permukaan karena konvensi supplier belum diketahui.
Default minimum CT/ET tetap 1,5 mm, dengan power depan +4 D sebagai asumsi yang
terlihat. Radius terukur atau kurva dengan indeks acuan dapat diisi bila tersedia.
Data asferis/freeform dan hasil ukur produksi belum tersedia, sehingga hasil
belum dinyatakan identik dengan Lensware. Model tidak otomatis menurunkan batas
ketebalan untuk full rim, half rimless, atau rimless.

Permukaan lensa kini lebih transparan, dengan pantulan mengikuti kelengkungan,
kilau tepi kontinu dan bayangan lembut. Rendering tetap ilustrasi konsultasi;
warna bukan pengukuran transmisi/VLT atau simulasi coating tertentu.
Rincian persamaan dan batas validitas tersedia di
[dokumentasi model optik](docs/OPTICS_MODEL.md).

## Pembaruan versi 2.0.0

- Backend HTTP menyajikan frontend dan API dari origin yang sama, dengan login,
  sesi tersimpan di MySQL, password scrypt, cookie HttpOnly/SameSite, dan CSRF.
- Katalog tint, bahan baku, dan bentuk lensa dibaca dari database setelah login.
  Master SKU dipakai bersama; draft dan riwayat konsultasi terpisah per akun.
- Penyimpanan menunggu konfirmasi server. Konflik revisi ditolak dengan HTTP 409,
  dan kegagalan jaringan ditampilkan tanpa beralih diam-diam ke data browser.
- Draft tetap tersedia untuk pemulihan. Retry merekonsiliasi respons penyimpanan
  yang terputus; halaman memperingatkan sebelum ditutup jika ada perubahan tertunda.
- Riwayat dapat menerima ekspor JSON konsultasi versi 1.3 melalui tinjauan impor.
  Master SKU tetap diimpor terpisah dengan pemeriksaan supplier, indeks, dan blank.
- Batas 1.000 SKU diperiksa pada penambahan, perubahan, dan impor. Riwayat yang
  memiliki metadata rusak tidak lagi membuat panel riwayat gagal dibuka.
- Generator sumber opsional tidak lagi bergantung pada lokasi upload workspace.

`runtime-config.js` pada server selalu menyatakan mode MySQL. Berkas statis
menyatakan mode browser secara eksplisit. Preview pada Sites memakai mode browser;
untuk memakai database perusahaan, instal paket server dan atur `.env`.
`MYSQL_PASSWORD` dan seluruh konfigurasi server tidak disajikan ke browser.

## Pembaruan versi 1.5.0

Preview memiliki kontrol **Tampilkan frame** dan **Tampilkan tangkai**, serta
pilihan **Full Rim**, **Half Rimless**, dan **Rimless**. Kontrol tersebut berlaku
bersama untuk pasangan A dan B agar perbandingan indeks memakai tampilan frame
yang sama. Frame dan tangkai mengikuti rotasi kamera, termasuk putaran 360°.

- Full Rim mengelilingi seluruh kontur lensa.
- Half Rimless memakai bingkai bagian atas dan penahan bawah yang tipis.
- Rimless memakai sambungan dan sekrup kecil tanpa bingkai keliling.
- Menyembunyikan tangkai mempertahankan rim/sambungan, bridge, dan engsel depan.
- Menyembunyikan frame menampilkan lensa saja. Jenis frame dan preferensi tangkai
  tetap tersimpan dan dipulihkan ketika frame ditampilkan kembali.

Frame dibentuk sebagai lapisan visual terpisah dari mesh optik. Perubahan jenis
frame atau visibilitasnya tidak mengubah kontur lensa, A/B/DBL, CT/ET, sentrasi,
atau pemeriksaan diameter blank. Proporsi tangkai bersifat ilustratif dan tidak
menetapkan panjang manufaktur maupun kelayakan pengeboran/pemasangan rimless.
Canvas menyesuaikan area tampilan agar lensa beserta tangkai muat pada zoom awal.

Pilihan tampilan tersimpan bersama state dan riwayat konsultasi, tampil pada
ringkasan dan PNG, serta diekspor sebagai `preview.frameDisplay` pada JSON.
`visible`, `style`, dan `templesVisible` menjelaskan tampilan efektif, sedangkan
`templesEnabled` mempertahankan preferensi tangkai ketika frame disembunyikan.
State lama tanpa pengaturan tersebut memakai Full Rim dengan tangkai terlihat.

Pengujian mencakup seluruh 13 shape pada ketiga jenis frame, posisi sambungan
nasal/temporal, show/hide masing-masing komponen, proyeksi desktop/mobile, rotasi
penuh, dan ketetapan mesh serta metrik ketebalan ketika kontrol frame berubah.

## Pembaruan versi 1.4.1

Katalog frame kini berisi 13 bentuk: sembilan referensi Lensware 001–009 dan
empat varian yang mengikuti SVG lampiran pengguna. Browline dihapus. Kontur
varian tambahan diambil dari bukaan lensa di dalam rim pada `rounded.svg`,
`cateye.svg`, `rectangle.svg`, dan `square.svg`, bukan dibentuk sebagai lingkaran
atau persegi geometris. Sisi kiri pada SVG menjadi kontur R kanonis, lalu viewer
mencerminkannya untuk pasangan kanan–kiri sesuai susunan sisi pemakai.

| Kode stabil | Nama | SVG acuan | A × B awal (mm) |
| --- | --- | --- | --- |
| `round` | Rounded / Bulat | `rounded.svg` | 50 × 44,6 |
| `cat-eye` | Cat-eye | `cateye.svg` | 54 × 41,8 |
| `rectangle` | Rectangle | `rectangle.svg` | 54 × 39,7 |
| `square` | Square | `square.svg` | 50 × 41,4 |

A/B awal merupakan contoh ukuran dengan rasio yang mengikuti bukaan lensa SVG;
SVG tidak menetapkan ukuran manufaktur dalam mm. A/B dapat diedit dengan langkah
0,1 mm. DBL, PD, tinggi sentrasi, dan resep tetap mengikuti input pengguna.
Picker Studio dan dropdown Data bahan memakai jalur pemilihan yang sama, dengan
empat tombol baru tersusun dua kolom. Memilih kembali bentuk yang aktif
mempertahankan ukuran kustom.

Saat memuat state versi lama, pilihan Browline dialihkan ke Rounded. Ukuran
awal lama pada empat preset disesuaikan sekali ke rasio SVG, sedangkan ukuran
kustom dipertahankan. `shapeRevision` menandai migrasi ini; setelah itu ukuran
yang disimpan tidak diterapkan ulang sebagai default. Sembilan objek 001–009
beserta titiknya tetap identik.

`tools/add-frame-shapes.mjs` menelusuri kurva Bézier aperture secara deterministik
menggunakan sumber asli di `tools/shape-references/`. Metadata mencatat nama
file, SHA-256, path/subpath, bounds SVG, rasio asli, dan revisi geometri. Sumber
tersebut dibedakan dari screenshot Lensware pada katalog dan JSON konsultasi.
Semua bentuk menggunakan kontur halus yang sama untuk preview, CT/ET ilustratif,
dan pemeriksaan diameter blank. Nama bentuk juga tercantum pada ringkasan dan PNG.

Validasi membandingkan hasil renderer terhadap kurva aperture SVG melalui sampling
independen. Deviasi maksimum empat bentuk pada ukuran contoh adalah 0,0098–0,0159
mm; ini mengukur kesetiaan model pada gambar sumber, bukan presisi manufaktur.
Pengujian juga mencakup pencerminan R/L, perubahan mode kontur, kesamaan outline
viewer/pemeriksaan blank, serta kelestarian sembilan bentuk asli.

## Pembaruan versi 1.3.2

CT tiap mata kini juga ditampilkan langsung pada preview sebagai label **CT · L**
dan **CT · R** dalam mm, dengan penunjuk ke pusat optik masing-masing lensa.
Nilainya berasal dari model ketebalan yang sama dengan ringkasan CT/ET. Posisi
penunjuk mengikuti rotasi dan zoom, dan ikut masuk ke PNG serta snapshot
ringkasan. CT tidak ditampilkan untuk mata yang pusat optiknya berada di luar
kontur, atau ketika data frame/sentrasi belum valid.

## Anotasi versi 1.3.1

Ukuran kini digambar langsung pada canvas di dekat lensa: panah lebar A di atas
lensa, tinggi B di samping, DBL di antara kedua lensa, dan penunjuk ketebalan
maksimum menuju lokasi pada model. Posisi anotasi mengikuti rotasi dan zoom;
angka tetap ukuran frame/model dalam mm, bukan panjang proyeksi layar. CT/ET
ditampilkan dalam satu baris ringkas tepat di bawah gambar. PNG dan snapshot
ringkasan menyertakan anotasi karena penanda menjadi bagian dari canvas.

## Metrik versi 1.3

Setiap kartu pasangan A/B menampilkan **ketebalan maksimum**, **CT pusat optik**,
**rentang ET tepi**, **lebar A**, **tinggi B**, dan **jembatan DBL** dalam mm.
Ketebalan maksimum memakai nilai terbesar dari kedua mata. Ringkasan di bawah
preview membandingkan maksimum A/B dalam mm dan persen; selisih dihitung dari
angka dua desimal yang ditampilkan pada kartu. Ukuran frame dan metrik ketebalan
ikut diperbarui saat indeks, resep, bentuk frame, atau sentrasi berubah.

Angka ketebalan berasal dari model 3D yang sama dengan preview. Pada versi 2.1,
minimum CT dan ET dapat diatur terpisah; default masing-masing 1,5 mm.
Angka tersebut belum merupakan hasil
produksi Lensware dan tidak diambil dari CT/ET bahan baku. CT hanya tersedia
bila pusat optik berada dalam kontur lensa; CT pasangan berupa rentang jika
kedua mata berbeda. ET merupakan rentang seluruh tepi kedua lensa. Bila data
frame atau sentrasi tidak valid, angka ketebalan ditahan sampai diperbaiki.

Supplier blank tidak ditampilkan pada Studio, judul kandidat Data bahan, atau
ringkasan konsultasi. Pemilihan bahan tetap mencakup produk yang diizinkan SKU
dan indeks, dengan ID bahan yang tetap berbeda. Assignment supplier pada Master
SKU dan identitas sumber pada JSON tetap tersedia untuk pengelolaan internal.
Ukuran serta metrik model juga tersedia pada ringkasan, gambar PNG, dan ekspor
JSON konsultasi. Susunan preview tetap L kiri layar dan R kanan layar.

## Fitur simulator

Versi 1.2 menambahkan Master SKU produk finish, pemeriksaan diameter blank dari
kontur frame dan sentrasi masing-masing mata, serta pemilihan blank R/L secara
eksplisit. Setiap kartu A/B tetap memuat pasangan R/L. Pilih indeks langsung pada
masing-masing kartu, gunakan **Samakan warna** untuk menyalin tint pilihan aktif,
dan bandingkan dalam tampilan depan, samping, belakang, atau perspektif.
Rotasi manual horizontal/vertikal mendukung satu putaran penuh; **Putar 360°**
menjalankan rotasi otomatis yang dapat dijeda.

- Perbandingan dua indeks/tint pada pasangan kanan–kiri dengan shape dan resep uji yang sama.
- Katalog 66 kode Lensware: 46 solid dan 20 gradasi, dengan pencarian dan kategori.
- Warna referensi dari PDF, termasuk gradasi tiga titik bila tersedia.
- Pilihan khusus CON, CONG, dan NOTE dengan warna digital serta catatan konsultasi.
- Tiga belas shape ilustratif: referensi Lensware 001–009 serta Rounded/Bulat,
  Cat-eye, Rectangle, dan Square sesuai empat SVG acuan pengguna.
- Full Rim, Half Rimless, dan Rimless dengan show/hide frame serta tangkai yang
  berlaku pada kedua pasangan indeks dan mengikuti rotasi preview.
- Enam indeks TRL: 1.50, 1.56, 1.57, 1.60, 1.67, dan 1.74.
- Master SKU dengan indeks aktif, rentang power finish, dan assignment supplier,
  produk bahan baku, serta spesifikasi blank yang diizinkan per indeks.
- Kebutuhan diameter R/L berdasarkan shape, A/B, DBL, PD monokular, tinggi pusat
  optik, dan allowance diameter total yang dapat disesuaikan.
- Kandidat blank yang memenuhi rentang finish SKU, aturan power bahan baku, dan
  kebutuhan diameter masing-masing mata; tabel juga menampilkan alasan penolakan.
- Gambar cutting R/L, pilihan diameter dan BC eksplisit, serta jejak baris CSV
  untuk spesifikasi bahan baku yang dipilih.
- Simpan pilihan di browser, buka kembali, ekspor JSON, cetak/PDF browser, dan PNG.

## Sumber yang digunakan

1. `tint code lensware untuk umum.csv`: kode, nama, dan jenis tint asli.
2. `LEMBAR CONTOH WARNA-REVISI-21-12-2023-CTP-EMBEDED-SAMPLE FILE VECTOR.pdf`:
   sampel warna dan ketentuan contoh fisik. Warna layar bukan pengukuran terkalibrasi.
3. `DMO UNV OSA(1).csv`: CSV bahan baku pengganti yang diterima pengguna sebagai
   sumber yang benar. CSV sebelumnya tidak dipakai.
4. `image(1).png`: screenshot default shape Lensware 001–009.
5. `tools/shape-references/{rounded,cateye,rectangle,square}.svg`: sumber kurva
   bukaan lensa empat varian tambahan; ditelusuri oleh `tools/add-frame-shapes.mjs`.

Metadata sumber dan jejak baris tersedia pada JSON aset. Skrip ekstraksi ada pada
`tools/`; lampiran asli tidak disertakan di direktori publik. Hasil ekstraksi yang
dipakai aplikasi berada di `dist/assets/`.
Regenerasi merupakan pekerjaan pengembang yang opsional dan membutuhkan sumber
asli serta dependensi Python yang disebut pada skrip:

```sh
python tools/prepare-materials-shapes.py --materials-csv "/path/DMO UNV OSA(1).csv" --shape-image "/path/image(1).png"
node tools/add-frame-shapes.mjs
python tools/extract-tints.py --csv "/path/tint code lensware untuk umum.csv" --pdf "/path/LEMBAR CONTOH WARNA-REVISI-21-12-2023-CTP-EMBEDED-SAMPLE FILE VECTOR.pdf"
```

Perintah kedua menambahkan kembali empat kontur SVG setelah regenerasi sumber.
Generator mempertahankan seluruh objek asli 001–009 dan dapat dijalankan ulang
tanpa menggandakan preset.
Generator tint membutuhkan PyMuPDF dan Pillow, serta CSV dan PDF asli melalui
`--csv` dan `--pdf`. Pilihan `--assets` dapat mengarahkan hasil ke direktori lain;
tanpa pilihan ini hasil ditulis ke `dist/assets/` setelah input divalidasi.

## Keputusan data

- **42S:** CSV menyebut Orange 527 70%, PDF menyebut 80%. Kode tetap tersedia,
  tetapi pratinjau warna dinonaktifkan sampai acuan dikonfirmasi.
- **37S dan 38S:** nama/kategori mengikuti CSV; perbedaan nama PDF diberi catatan.
- **19 varian:** solid atau gradasi diturunkan dari satu swatch PDF dan ditandai
  sebagai ilustrasi. Tidak dianggap profil pewarnaan produksi yang lengkap.
- **400, CON, CONG, NOTE:** tidak memiliki swatch PDF. 400 tidak diberi warna
  tebakan. Warna pilihan pengguna pada tiga kode lainnya disimpan sebagai ilustrasi.
  CON/CONG memerlukan contoh lensa fisik; NOTE memerlukan contoh fisik bila warna
  berada di luar katalog.
- Persentase pada nama adalah label katalog, bukan opacity atau VLT. Tidak ada
  klaim spektral atau manfaat medis yang disimpulkan dari nama produk.
- Harga tercetak pada PDF revisi 2023 tidak digunakan sebagai harga penawaran.
- Data raw: 2.689 baris sumber, 19 kombinasi supplier/produk, 186 spesifikasi blank,
  2.026 aturan berbeda, dan 663 pengulangan identik yang ditandai melalui provenance.
- Indeks 1.59 tetap ada dalam data sumber, tetapi tidak diaktifkan di simulator.
- Pembacaan rentang inklusif dan CYL nol literal adalah asumsi yang harus
  dikonfirmasi ke Lensware. Kandidat tidak diurutkan sebagai rekomendasi produksi.
- CT/ET blank bukan ketebalan lensa jadi. CT/ET tidak dipakai sebagai hasil akhir.

## Master SKU dan assignment blank

Master SKU berada pada tab **Master SKU** dan awalnya kosong. Masukkan kode serta
nama produk perusahaan, aktifkan indeks yang tersedia, lalu isi batas minimum dan
maksimum SPH, CYL, dan ADD untuk setiap indeks aktif. Rentang bersifat inklusif,
CYL memakai konvensi minus, dan SKU tanpa ADD dapat memakai batas 0 sampai 0.
Batas power dan daftar blank harus ditetapkan secara eksplisit; aplikasi tidak
menganggap seluruh katalog bahan sebagai ketersediaan SKU.

Setiap assignment mengikat supplier, ID produk bahan baku, dan ID blank tertentu.
Pilihan blank menampilkan diameter, BC, CT, dan ET dari katalog. Kombinasi supplier
dan kode produk yang sama dapat memiliki beberapa diameter atau BC; izin pada
satu blank tidak otomatis mengizinkan seluruh blank produk tersebut. Identitas
supplier, produk, indeks, dan blank divalidasi saat menyimpan atau mengimpor.
Beberapa supplier dapat di-assign ke varian indeks yang sama.

Di studio, pilih SKU terlebih dahulu untuk membatasi indeks, produk bahan baku,
dan kandidat blank. Resep harus lolos **kedua** rentang: power finish pada SKU dan
aturan power bahan baku pada CSV. Mode **Katalog bahan · tanpa SKU** tersedia untuk
eksplorasi tanpa batas finish SKU. SKU yang hilang, diarsipkan/nonaktif, atau
indeksnya dinonaktifkan tetap diblokir; pilihan tersimpan tidak otomatis dialihkan
ke mode katalog.

Gunakan **Nonaktifkan** untuk mengarsipkan SKU tanpa menghapus konfigurasinya.
Aktifkan **Tampilkan SKU nonaktif** untuk membukanya atau mengaktifkan kembali.
Menonaktifkan satu indeks juga mempertahankan konfigurasi indeks tersebut.
**Ekspor JSON** menyimpan master dengan schema `trl-sku-catalog/1.0`.
**Impor JSON** memvalidasi seluruh berkas, menampilkan rencana perubahan, lalu
menggabungkan SKU berdasarkan ID atau kode setelah **Terapkan impor** dipilih.
Identitas SKU yang sudah ada dipertahankan dan SKU lain tidak dihapus.

Pada mode browser, master disimpan pada localStorage dengan key
`leinz-sku-catalog-v1`, hanya pada browser dan origin yang sama. Pada mode MySQL,
master tersimpan di server dan dapat dibuka oleh seluruh akun aplikasi; setiap
penyimpanan memeriksa revisi agar perubahan pengguna lain tidak tertimpa.
Gunakan ekspor master untuk pemindahan konfigurasi dan backup database untuk
cadangan lengkap versi server.
Ketersediaan SKU berarti izin pada katalog; belum menunjukkan jumlah stok gudang.

## Metode pemeriksaan diameter blank

Implementasi berada pada `dist/blank-engine.js`; penghubung dengan bentuk 3D berada
pada `LensViewer.screeningContour()` di `dist/lens-viewer.js`. Aplikasi memberikan
kontur akhir yang sama kepada gambar cutting dan pemeriksaan blank agar ukuran
yang diperiksa sesuai dengan outline 3D yang ditampilkan. Kontur screenshot
dihaluskan, kemudian dinormalisasi ke lebar A dan tinggi B. Engine tidak melakukan
penghalusan tambahan. Kontur ini tetap ilustratif, bukan tracing frame aktual.

Koordinat menggunakan pusat boxing sebagai titik nol, x ke kanan, dan y ke bawah.
Dalam koordinat perhitungan kanonis, R memakai kontur asli dan L memakai kontur
yang dicerminkan. Preview 3D mencerminkan tampilan kanonis ke susunan sisi pemakai
(L kiri layar, R kanan layar), tanpa mengubah angka atau identitas tiap mata.
Tinggi pusat optik dihitung dari batas bawah boxing, sehingga harus berada antara
0 dan B. Perhitungan menggunakan:

- `Frame PD = A + DBL`.
- `OC_R.x = (A + DBL) / 2 − PD_R` dan `OC_L.x = PD_L − (A + DBL) / 2`.
- `OC_eye.y = B / 2 − tinggi_eye`.
- `ED = 2 × jarak maksimum dari pusat boxing ke titik kontur`.
- `Diameter minimum_eye = 2 × jarak maksimum dari OC_eye ke titik kontur_eye + allowance diameter total`.

ED dihitung dari kontur, bukan otomatis dari diagonal persegi panjang A/B.
Lingkaran blank diasumsikan berpusat pada pusat optik. Allowance awal **2 mm**
ditambahkan satu kali pada diameter total, bukan pada setiap radius. Nilai ini
adalah asumsi yang dapat diubah sesuai kebutuhan lab, bukan ketentuan produksi
yang telah dikonfirmasi. Perubahan A, B, DBL, PD, atau tinggi pusat optik dapat
mengubah diameter yang diperlukan; pengaruh DBL bergantung juga pada PD pasien.

Setiap spesifikasi blank diperiksa untuk R dan L secara terpisah. Kandidat harus
berasal dari produk dan indeks yang sesuai, diizinkan oleh SKU bila SKU dipilih,
lolos aturan power bahan, serta memiliki diameter yang cukup untuk mata tersebut.
Diameter yang persis memenuhi batas diterima dengan toleransi numerik `1e-7`.
Aplikasi hanya memakai diameter yang benar-benar tercantum pada produk tersebut;
diameter 75 atau 80 mm tidak dibuat sebagai pilihan bila tidak tersedia di katalog.

Diameter kandidat terkecil adalah acuan ketersediaan, bukan pemilihan BC otomatis.
Pengguna memilih blank R dan L secara eksplisit. Perubahan frame, resep, indeks,
produk, atau konfigurasi SKU memicu pemeriksaan ulang; pilihan blank yang tidak
lagi lolos untuk suatu mata dilepas, sementara pilihan mata lain yang masih valid
dipertahankan. **Semua & alasan** menampilkan spesifikasi yang ditolak beserta
alasan dan baris sumbernya. Pengulangan baris sumber tidak menggandakan jumlah
spesifikasi blank.

Pemeriksaan ini baru membuktikan kecukupan diameter dalam model. Tracing frame
aktual, sisa volume untuk surfacing, ketebalan akhir, prioritas BC, prism, blocking,
kelayakan desain, kompatibilitas tint–material, dan stok aktual belum diverifikasi.

## Geometri 3D

`lens-viewer.js` merender pasangan lensa dengan kontur yang dihaluskan, permukaan
dan sisi kontinu, serta arah gradasi yang mengikuti sumbu vertikal lensa. Kontur
screenshot memakai `contourMode: 'raster'`, 64 control points dan pengurangan noise
Gaussian. Kurva SVG memakai `contourMode: 'vector'`, 256 control points tanpa
Gaussian agar sudut acuan tetap terjaga. Keduanya memakai kurva periodik dan 256
titik akhir, lalu dinormalisasi kembali ke ukuran A/B. Supersampling canvas
mengurangi tepi bergerigi. Data tracing produksi belum tersedia.

SPH, CYL, AXIS, indeks, ukuran frame, PD monokular, dan tinggi pusat optik per mata
memengaruhi model ilustratif. DBL mengatur jarak pasangan dan ikut menentukan
pergeseran pusat optik melalui Frame PD. Posisi pusat optik yang sama dipakai pada
pemeriksaan blank dan permukaan 3D, sehingga R/L dapat berbeda ketika sentrasinya
berbeda. Minimum CT dan ET mengikuti profil finishing terpilih (default 1,5 mm).
Permukaan sferis/torik memakai sag eksak dan koreksi daya back vertex; model tidak
menggunakan CT/ET blank sebagai ketebalan finish atau menebak desain produksi
produk. **ADD hanya memengaruhi
eligibilitas power**, belum membentuk geometri progresif atau segmen multifokal.
R/L memakai resep uji SPH/CYL/AXIS/ADD yang sama. Masing-masing lensa berputar di
pusatnya agar tampilan samping tidak saling menutupi.

Renderer menerima `pairMode`, `bridgeMm`, `opticalCenters` per mata, `contourMode`,
`showFrame`, `frameStyle`, `showTemples`, `opticalProfiles: {R,L}`, dan `onRotationChange`.
`frameStyle` menerima `full-rim`, `half-rimless`, atau `rimless`. Renderer mandiri
tetap memakai `showFrame: false` secara default; aplikasi Studio mengaktifkan
frame sesuai state pengguna. `screeningContour(points, A, B, contourMode)` menerima
titik sumber serta A/B dan
mengembalikan outline akhir dalam koordinat x-kanan/y-bawah untuk engine blank.
Thumbnail menggunakan `smoothContour(points, contourMode)` dengan profil yang sama.
Berikan titik sumber asli kepada renderer; memasukkan hasil `screeningContour()`
kembali sebagai `shapePoints` akan menghaluskan kontur dua kali. Gunakan
`setAutoRotate(bool)` serta `isAutoRotating()` untuk animasi. Dengan kamera
sinkron, hanya satu viewer menjalankan animasi dan meneruskan kamera ke viewer
lain. Kedua sudut dibungkus secara periodik, tanpa pembatasan pitch. Animasi
berhenti ketika pengguna berinteraksi dan mengikuti preferensi reduced motion.

## Ekspor dan pemulihan pilihan

JSON konsultasi memakai schema `trl-lens-consultation/1.3`. Setiap pilihan
menyimpan kode asli, produk, indeks, mode pasangan, kamera, catatan, warna
atas/tengah/bawah, asal preview, dan status pemetaan referensi. Ekspor juga memuat
snapshot SKU dan varian indeks, PD/tinggi R/L, hasil screening frame, allowance,
blank terpilih per mata, CT/ET bahan baku, margin diameter, aturan power yang cocok,
dan nomor baris CSV. Bila sebuah mata belum memiliki blank terpilih, nilainya
tetap `null`; kandidat acuan tidak disimpan sebagai pilihan otomatis.
`illustrativeThickness` memuat satuan, asumsi minimum, hasil tiap mata, dan
agregat pasangan dari `LensViewer.getThicknessMetrics()`. Nilainya mengukur
pemisahan permukaan sepanjang sumbu z model, tidak mengikuti rotasi kamera.
Ekstrem tepi dihitung pada setiap segmen kontur; ekstrem seluruh lensa juga
memperhitungkan pusat optik di dalam kontur. `productionVerified` selalu `false`.
`productionReady` dan `lenswareConnected` selalu `false`; `finishedThickness` dan
`productionGeometry` tetap `null` sampai integrasi hasil produksi tersedia.

Riwayat mode browser menggunakan localStorage pada browser dan origin yang sama.
Pada mode MySQL, draft dan riwayat disimpan berdasarkan akun login sehingga dapat
dibuka pada perangkat lain dengan akun yang sama. Gunakan ekspor JSON untuk
salinan mandiri; tombol **Impor konsultasi JSON** ada pada dialog **Tersimpan**.
Ekspor konsultasi dan ekspor Master SKU
merupakan dua berkas dengan tujuan berbeda: snapshot konsultasi tidak otomatis
memasang atau mengganti master SKU.

Pilihan lama tetap memakai key penyimpanan `leinz-lens-studio-state-v1` dan
`leinz-lens-studio-saved-v1`. Nilai lama `pd` dan `fittingHeight` disalin ke R/L
bila nilai per mata belum tersedia; allowance baru memakai nilai awal 2 mm.
Indeks, tint, dan catatan yang valid dipertahankan. Saat pilihan dibuka kembali,
assignment dan blank terpilih diperiksa terhadap master SKU serta katalog saat
ini. SKU yang tidak tersedia tetap ditandai bermasalah, dan blank yang tidak lagi
memenuhi syarat dilepas.

## Menjalankan dan memeriksa

Aplikasi tidak memakai dependensi CDN. Untuk versi server, jalankan perintah
instalasi di awal dokumen. Direktori `dist` juga dapat disajikan melalui HTTP
sebagai preview browser yang terpisah dari koneksi MySQL.

```sh
npm run build
npm test
```

Suite memeriksa geometri dan kesamaan kontur 3D/screening, pengaruh A/B/DBL
serta sentrasi per mata, batas diameter, ketersediaan katalog, rentang SKU dan bahan,
validitas assignment, provenance baris, validasi/impor master, perilaku viewer,
penyimpanan asynchronous, pemulihan konflik, autentikasi, dan impor konsultasi.
`npm run test:mysql` adalah integration test terpisah yang memerlukan database
disposable bernama `leinz_test_*` dan `LEINZ_ALLOW_TEST_DB=1`; skrip akan menghapus
data pengujian pada database tersebut. Jangan gunakan database operasional.

Verifikasi browser historis pada pengembangan sebelumnya mencakup pencarian 42S, pilihan custom CONG, pergantian indeks
dan shape, pembuatan serta nonaktivasi SKU, perubahan sentrasi, invalidasi blank,
simpan/buka pilihan, dan unduhan JSON/PNG. Fixture tanpa SKU dengan shape 001,
A 52/B 38/DBL 18 mm, PD R/L 31,5 mm, tinggi R/L 19 mm, allowance 2 mm, dan
SPH -4/CYL -1/ADD 0: DMO/SPHG60 menghasilkan satu blank (BC 3, diameter 75,
CT 8, ET 13; baris 45), sedangkan SOA/SPHW60 menghasilkan empat kandidat.
Jumlah kandidat berubah mengikuti kebutuhan diameter serta konfigurasi SKU.
Seluruh nilai CT/ET pada fixture tersebut berasal dari bahan baku.

Pada checkout Sites, konfigurasi deployment tersimpan pada `.openai/hosting.json`.
Pertahankan identitas project dan audience privat pada pembaruan berikutnya.
Berkas hosting tersebut tidak diperlukan untuk instalasi MySQL dan tidak
disertakan dalam ZIP server.
