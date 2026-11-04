# Model CT/ET dan tampilan lensa

## Perubahan pada kalkulasi

Versi ini mengganti pendekatan ketebalan kuadratik dengan **permukaan depan
sferis dan permukaan belakang torik**, memakai sag eksak dan koreksi back-vertex
power. Nilai yang ditampilkan dan geometri preview berasal dari model yang sama.

Hasil tetap merupakan estimasi berdasarkan parameter yang dimasukkan. Data
produksi pembanding belum tersedia, sehingga `productionVerified` tetap `false`
dan `calibrationStatus` tetap `unverified`, termasuk ketika sumber parameter
ditandai `lab` oleh pengguna. Penandaan sumber mencatat asal input; penandaan itu
bukan bukti bahwa simulator telah cocok dengan lensa jadi.

**Tidak ada faktor pengali 0,8 atau 0,9 pada hasil CT/ET.** Mengurangi seluruh
hasil sebesar 10–20% tanpa mengubah parameter fisik akan menghasilkan ketebalan
yang tidak sesuai dengan permukaan dan power yang dihitung.

## Profil yang digunakan

Profil dapat ditentukan untuk produk bahan, blank tertentu, atau override pada
Studio. Blank dan mata kanan/kiri dapat memiliki profil berbeda. Aplikasi tidak
menganggap angka BC pada CSV lama sebagai true front curve: konvensi BC tersebut
belum diberikan pada sumber. Sebagai contoh penting, tabel resmi ZEISS memisahkan
nominal base, true front curve pada indeks acuan 1.530, dan radius dalam mm.
Ketiganya tidak selalu mempunyai angka yang sama. [Sumber ZEISS, halaman 2 PDF](https://www.zeiss.com/content/dam/vis-b2b/usa/downloads/pdfs/sfsv2023.pdf).

| Field | Makna | Default |
| --- | --- | --- |
| `minCenterMm` | Batas minimum ketebalan pada pusat optik untuk konstruksi model | 1,5 mm |
| `minEdgeMm` | Batas minimum ketebalan sepanjang kontur hasil edging | 1,5 mm |
| `frontPowerD` | Power kurva depan sesuai basis yang dipilih | 4,00 D |
| `frontCurveBasis` | `material` untuk power pada indeks bahan; `reference-index` untuk power alat/indeks acuan | `material` |
| `curveReferenceIndex` | Indeks acuan ketika basis `reference-index` dipilih | 1,530 |
| `frontRadiusMm` | Radius depan eksplisit; bila terisi, mempunyai prioritas terhadap `frontPowerD` | Tidak diisi |
| `frontConic`, `backConic` | Hanya nilai 0 didukung pada model sferis/torik ini | 0 |
| `source` | `assumption` atau `lab` | `assumption` |
| `reference` | Catatan sumber parameter; wajib ketika sumber `lab` | Kosong |

Batas input minimum CT/ET 0,5–10 mm adalah batas perangkat lunak, **bukan
rekomendasi produksi untuk semua bahan atau mounting**. Gunakan ketentuan lab,
supplier, dan pemasangan yang berlaku. Default tetap 1,5 mm karena belum ada
ketentuan spesifik Timur Raya Lestari yang membenarkan batas lebih rendah.

Nilai `ct`/`et` pada master blank tetap berarti ketebalan **bahan baku**. Nilai itu
tidak dipakai sebagai ketebalan finish, minimum finish, atau pengganti desain
permukaan. Kecukupan volume bahan untuk seluruh proses surfacing belum dibuktikan
hanya dengan pemeriksaan diameter dan dua nilai CT/ET blank.

## Persamaan dan satuan

Semua koordinat serta ketebalan dalam model memakai mm. Power memakai dioptri.
`n` adalah indeks bahan yang dipilih. Koordinat setiap mata dipusatkan pada pusat
optiknya, sehingga perubahan PD, DBL, dan tinggi sentrasi mengubah lokasi
pengukuran terhadap kontur frame.

Sag sferis dengan curvature bertanda `c = 1/R` dihitung secara stabil:

```text
s(c, ρ²) = c × ρ² / (1 + sqrt(1 − c² × ρ²))
```

Ini setara dengan bentuk geometrik `R − sqrt(R² − ρ²)` untuk radius positif,
tanpa kehilangan presisi akibat pengurangan dua angka besar pada kurva yang
sangat datar. Sag eksak diperlukan ketika pendekatan sag sederhana tidak cukup
akurat; pendekatan lama mengabaikan suku orde lebih tinggi.
[OptiCampus, bagian Appendix: Exact Sagitta Formula](https://opticampus.opti.vision/cecourse.php?url=high_powered/).

Konversi kurva depan:

```text
Basis material:        c₁ = frontPowerD / [1000 × (n − 1)]
Basis indeks acuan:    c₁ = frontPowerD / [1000 × (n_ref − 1)]
Radius eksplisit:      c₁ = 1 / frontRadiusMm
Power depan aktual:   F₁ = 1000 × (n − 1) × c₁
```

Resep dibaca sebagai back-vertex power pada dua meridian utama: `P₁ = SPH` dan
`P₂ = SPH + CYL`. Untuk suatu CT `t` dalam mm, belakang tiap meridian dihitung:

```text
F₁ pada vertex belakang = F₁ / [1 − t × F₁ / (1000 × n)]
F₂,j                    = Pj − F₁ pada vertex belakang
c₂,j                    = −F₂,j / [1000 × (n − 1)]
```

Koreksi ketebalan ini mempertahankan power vertex yang diminta, bukan sekadar
menyamakan penjumlahan kurva depan dan belakang. Dasar back-vertex power dan
perbedaan terhadap nominal thin-lens power dibahas pada materi pendidikan
[National Academy of Opticianry — Lens Powers](https://www.nao.org/wp-content/uploads/2020/04/Lens-Powers.pdf).

Untuk rear toric, `u` searah axis dan `v` tegak lurus axis. Dengan dua curvature
utama `cu` dan `cv`, model memakai patch torus:

```text
sv      = s(cv, v²)
cu_eff  = cu / (1 − cu × sv)
s_back  = sv + s(cu_eff, u²)
T(x,y)  = CT + s_back(x,y) − s_front(x,y)
```

Kedua radius sama menghasilkan sphere; keduanya nol menghasilkan plane. Resep
plus-cylinder ditransposisikan ke minus-cylinder sebelum konstruksi torus agar
dua penulisan resep yang ekuivalen memberikan geometri yang sama.

CT diselesaikan secara iteratif karena mengubah power permukaan belakang.
Solusi harus memenuhi `CT ≥ minCenterMm` serta `T(x,y) ≥ minEdgeMm` pada seluruh
kontur. Ekstrem sepanjang segmen kontur dicari dari turunan medan ketebalan,
bukan hanya dari titik sudut. CT hanya dilaporkan ketika pusat optik berada di
dalam outline. Maksimum seluruh lensa memperhitungkan batas dan pusat optik.

Jika radius tidak mencakup aperture, input tidak didukung, atau batas ketebalan
tidak dapat dipenuhi, hasil dinyatakan tidak tersedia. Renderer menggunakan
placeholder datar tanpa menampilkan CT/ET dari placeholder tersebut. Square
root yang tidak valid tidak dipotong menjadi angka yang tampak masuk akal.

## Mengapa pengurangan ketebalan tidak selalu 10–20%

Contoh komputasi model, bukan hasil pengukuran lab: indeks 1.60, SPH −4.00 D,
CYL 0, kontur lingkaran berdiameter 50 mm, kurva depan aktual 4 D, tanpa
desentrasi. Batas minimum edge tetap 1,5 mm.

| Minimum CT yang dimasukkan | CT hasil | ET maksimum hasil |
| --- | ---: | ---: |
| 1,50 mm | 1,50000 mm | 3,69988 mm |
| 1,20 mm | 1,20000 mm | 3,39816 mm |

Menurunkan batas CT pada contoh tersebut sebesar 20% membuat CT turun 20%,
sedangkan ET maksimum turun sekitar **8,15%**. Sag dan koreksi power tetap
dihitung kembali. Pengaturan 1,2 mm hanya contoh untuk menunjukkan perilaku
model; kelayakannya harus ditetapkan lab. Model sag eksak juga dapat menghasilkan
ET lebih besar daripada pendekatan kuadratik lama pada parameter yang sama.

## Lingkup yang belum dimodelkan

Konstruksi ini adalah **frame-optimized surfacing**, yang mencari CT untuk
kontur finish yang dipilih. Itu tidak mengubah CT fisik lensa stock yang sudah
selesai dibuat. Pada lensa plus stock, mengurangi bentuk melalui edging tidak
mengurangi CT yang telah terbentuk. [OptiCampus, bagian Minimum Blank Size](https://opticampus.opti.vision/cecourse.php?url=high_powered/).

Desain asferik/freeform proprietary, progresif atau segmen multifokal, prism,
wrap, pantoscopic tilt, vertex distance, bevel/groove, pengeboran, coating,
allowance proses, dan ketercukupan volume raw blank belum dihitung. ADD masih
berfungsi pada pemeriksaan aturan power bahan/SKU, bukan pada permukaan
progresif. Angka indeks katalog bersifat nominal; jika indeks material aktual
berbeda, hasil juga dapat berbeda.

Untuk menguji kecocokan terhadap produksi diperlukan pasangan data dengan
resep, indeks aktual, true base/radius, desain, contour trace, ukuran frame,
sentrasi R/L, diameter/blank, mounting, minimum CT/ET yang dipakai, serta hasil
CT dan ET terukur beserta lokasi pengukurannya. Selisih model terhadap hasil lab
perlu dihitung sebelum menentukan toleransi akurasi atau klaim identik.

## Tampilan lensa

Lensa clear dibuat lebih transparan; tepi menggunakan pencahayaan menyerupai
permukaan poles, rim halus, bayangan lembut, dan pantulan lampu yang mengikuti
permukaan. Intensitas sheen mengikuti tren Fresnel terhadap indeks dan sudut
pandang, memakai pendekatan Schlick. [PBRT — Fresnel Incidence Effects](https://www.pbr-book.org/3ed-2018/Reflection_Models/Fresnel_Incidence_Effects).

Ini pencahayaan ilustratif berbasis Canvas, bukan ray tracing spektral penuh.
Preview tidak mengklaim coating AR tertentu maupun transmisi/VLT terukur. Nilai
persen pada referensi tint tidak diubah menjadi angka opacity fisik. RGB tint
tetap berasal dari referensi/input pengguna dengan lapisan transparansi visual.

## Pengujian

```sh
node --test tools/test-optics.mjs
node tools/test-viewer.mjs
```

Suite optik membandingkan sag terhadap geometri lingkaran independen, CT plus
terhadap persamaan front/back terpisah, back-vertex power tiap meridian,
konversi indeks acuan/radius, transposisi cylinder, turunan analitik terhadap
finite differences, serta ekstrem batas/interior terhadap sampling rapat.
Kasus invalid tidak menghasilkan CT/ET palsu. Suite viewer mempertahankan
regresi 13 shape, R/L, camera, tint, anotasi, frame/mounting, dan tangkai.
