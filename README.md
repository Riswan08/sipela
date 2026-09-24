# SIPELA — Sistem Informasi Perencanaan Listrik Distribusi & Aset

> *Pela* dalam budaya Maluku adalah ikatan persaudaraan antar negeri yang saling menolong. Semangat yang sama ada di jaringan distribusi: penyulang saling *back-up* lewat titik manuver (tie).

Aplikasi web untuk **membangun sendiri data jaringan distribusi 20 kV** ketika data SLD dan jarak antar aset belum tersedia.
Tidak butuh server atau database: semua data tersimpan otomatis di browser, dan bisa di-backup ke file.

## Cara menjalankan

**Cara cepat (laptop):** klik dua kali `index.html` (butuh internet untuk peta).

**Disarankan (supaya fitur GPS aktif):** jalankan server lokal di folder ini:

```bash
python3 -m http.server 8765
```

lalu buka http://localhost:8765

> Fitur GPS di HP hanya jalan kalau aplikasi dibuka lewat `https://` (misalnya di-hosting di GitHub Pages / Netlify / server internal) atau `localhost`.

## Fitur

| Menu | Fungsi |
|---|---|
| **Peta** | Tambah aset (PLTD, GI, GH, Gardu/Trafo, Recloser, LBS, FCO, Pelanggan TM, Tiang) dengan klik peta, **tempel titik koordinat** (desimal/DMS dari Google Maps atau GIS), atau **GPS saat survei**. Gambar saluran mengikuti jalur (titik belok) dan **panjangnya dihitung otomatis**. Ada layer satelit untuk menelusuri jalur tiang, plus alat ukur jarak. |
| **SLD** | **Single Line Diagram otomatis** dari topologi: trunk lurus, cabang turun, titik buka (NO) & tie antar penyulang ditandai. Bisa zoom/geser, ekspor SVG/PNG, dan cetak A3. |
| **Aset / Saluran** | Tabel yang bisa difilter dan diurutkan, rekap panjang (kms) per penyulang & penghantar, ekspor CSV. |
| **Analisis** | Beban hilir, arus, % KHA, **drop tegangan kumulatif**, dan estimasi susut per seksi. **Jarak antar aset** lewat jaringan maupun garis lurus, dan jarak dari satu aset ke semua aset sejenis (misalnya trafo → GH terdekat). |
| **Data** | Import **Excel / CSV / KML / KMZ (Google Earth)**, ekspor Excel / KML / GeoJSON (QGIS), backup/pulihkan JSON, tabel impedansi penghantar, dan parameter. |

## Import data GIS PLN (ArcGIS "Table To Excel")

Di tab **Data → Import data GIS PLN**, pilih file .xlsx hasil ekspor GIS (sheet TRAFO_DISTRIBUSI, TIANG, APP, JTM, JTR, boleh sebagian). Sheet dikenali dari kolomnya, jadi bisa dipakai untuk sistem lain yang diekspor dengan cara yang sama.

Data GIS biasanya belum lengkap untuk kebutuhan perencanaan, jadi aplikasi melengkapinya secara otomatis:

| Kondisi data GIS | Yang dilakukan aplikasi |
|---|---|
| JTM tanpa geometri | Tiang TM disambung dengan *Minimum Spanning Tree* (jalur terpendek antar tiang). Ruas yang lebih panjang dari batas ditandai **merah putus-putus** untuk dicek. |
| Gardu tanpa koordinat | Posisi diestimasi dari tiang TR nomor 01 tiap jurusan, lalu ditempelkan ke tiang TM terdekat (gardu portal). |
| Kapasitas trafo kosong | Beban diestimasi dari Σ daya kontrak pelanggan × faktor kebersamaan (default 0,4). |
| Tiang TR bernomor | JTR dirangkai sesuai urutan nomor tiang per jurusan. Jenis kabel diambil dari sheet JTR. |
| Titik pelanggan (APP) | Ditampilkan sebagai layer *Pelanggan (APP)*, dengan jumlah pelanggan, daya tersambung, dan jarak pelanggan terjauh per gardu. |

Setelah import, **tambahkan PLTD/GI sebagai sumber** (lewat titik koordinat), lalu klik **⚡ Sambung ke jaringan terdekat** — SLD langsung tergambar. Saat menggambar saluran manual, klik yang jatuh dekat tiang otomatis menempel ke tiang itu. SLD otomatis meringkas rangkaian tiang lurus menjadi satu ruas (dengan jumlah gawang).

## Import seluruh UP3 sekaligus (26 sistem)

Daftar **ULP → Sistem → Penyulang** UP3 Masohi tertanam di `js/sistem.js` (sumber: *Data Sistem Per Penyulang.xlsx*). Saat file GIS seluruh UP3 diimport, wizard mengelompokkan tiap penyulang ke sistemnya (nama beda ejaan seperti TAMILOW→Tamilouw ditangani), menampilkan tabel untuk dikoreksi, lalu membuat/memperbarui satu entri sistem per sistem. Pilihan penyulang yang Anda tetapkan manual disimpan untuk import berikutnya. Dropdown **ULP** dan **Sistem** ada di kiri atas; setiap penyulang dalam satu sistem diberi warna berbeda (legenda di kiri bawah peta, klik untuk zoom).

Jenis penghantar JTM diambil dari sheet JTM (kolom `UKURAN_PENGHANTAR_TM`, berupa kode angka): wizard menampilkan pemetaan kode → penghantar (default 1=35, 2=70, 3=150, 4=240 mm²; kode lain Anda tetapkan, pilihan disimpan), dan tiap penyulang memakai penghantar yang dominan menurut panjang di GIS karena JTM di GIS tidak punya geometri per ruas.

Pengaman rekonstruksi: tiang dengan kolom PENYULANG kosong mengikuti penyulang tiang terdekat (≤ 300 m); ruas JTM/JTR dan sambungan gardu yang lebih jauh dari batas (default 1.500 m) tidak dibuat, sehingga jaringan boleh terpecah beberapa kelompok daripada tersambung palsu puluhan km.

## Banyak sistem dalam satu aplikasi

Setiap sistem kelistrikan (misalnya Buano, Kairatu, Masohi) disimpan terpisah. Pindah sistem lewat menu di kiri atas; buat, buka, atau hapus sistem di tab **Data → Sistem**. Saat import GIS, centang "Import ke sistem baru" agar tiap file masuk ke sistemnya sendiri. Data disimpan di IndexedDB browser (kapasitas ratusan MB), tetap unduh backup (.json) per sistem secara rutin.

## Alur kerja yang disarankan

1. **Kumpulkan data yang sudah ada**, misalnya daftar gardu (Excel), KMZ hasil survei, atau data dari aplikasi lain. Unduh **Template** di menu Data, isi, lalu import.
2. **Lengkapi di peta.** Pakai layer Satelit untuk menelusuri jalur JTM, lalu sambungkan aset dengan mode *Saluran*.
3. **Survei lapangan dengan HP.** Aktifkan mode *Aset* dan centang "Sambung otomatis", lalu tekan "Tambah aset di posisi GPS" di setiap tiang/gardu. Saluran akan terbentuk sendiri.
4. Kalau ada panjang hasil ukur (as-built), isi **Panjang ukur** di saluran tersebut. Nilai ini lebih diutamakan daripada panjang dari peta.
5. Buka **SLD** dan **Analisis**, lalu ekspor untuk laporan.
6. **Unduh backup (.json) secara rutin.** Data browser bisa hilang jika cache dibersihkan.

## Catatan teknis

- Impedansi penghantar default adalah **nilai pendekatan**. Sesuaikan dengan SPLN/data pabrikan di menu Data.
- Analisis memakai metode beban terpusat di gardu: ΔV = √3·I·(R cosφ + X sinφ)·L. Beban = kVA × % beban terukur (atau % default). Hasilnya cocok untuk kajian awal/perencanaan, bukan pengganti studi aliran daya lengkap (ETAP/DIgSILENT).
- Perhitungan pohon penyulang berhenti di saklar berstatus **NO**, sehingga konfigurasi normal bisa diubah cukup dengan mengganti status LBS.
- Struktur kode: `js/store.js` (data), `js/calc.js` (graf, Dijkstra, analisis), `js/map.js` (peta), `js/sld.js` (SLD), `js/io.js` (import/ekspor), `js/views.js` (tabel & analisis), `js/app.js` (navigasi).
