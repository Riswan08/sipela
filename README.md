# SIPERSIS — Sistem Informasi Perencanaan Sistem Distribusi

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
| **Peta** | Tambah aset (GI, GH, Gardu/Trafo, Recloser, LBS, FCO, Pelanggan TM, Tiang) dengan klik peta atau **GPS saat survei**. Gambar saluran mengikuti jalur (titik belok) dan **panjangnya dihitung otomatis**. Ada layer satelit untuk menelusuri jalur tiang, plus alat ukur jarak. |
| **SLD** | **Single Line Diagram otomatis** dari topologi: trunk lurus, cabang turun, titik buka (NO) & tie antar penyulang ditandai. Bisa zoom/geser, ekspor SVG/PNG, dan cetak A3. |
| **Aset / Saluran** | Tabel yang bisa difilter dan diurutkan, rekap panjang (kms) per penyulang & penghantar, ekspor CSV. |
| **Analisis** | Beban hilir, arus, % KHA, **drop tegangan kumulatif**, dan estimasi susut per seksi. **Jarak antar aset** lewat jaringan maupun garis lurus, dan jarak dari satu aset ke semua aset sejenis (misalnya trafo → GH terdekat). |
| **Data** | Import **Excel / CSV / KML / KMZ (Google Earth)**, ekspor Excel / KML / GeoJSON (QGIS), backup/pulihkan JSON, tabel impedansi penghantar, dan parameter. |

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
