'use strict';
/* ============================================================
 * IO: import/ekspor Excel, CSV, KML/KMZ (Google Earth), GeoJSON, backup JSON
 * ============================================================ */

const ASSET_COLS = ['jenis', 'kode', 'nama', 'penyulang', 'lat', 'lng', 'kva', 'beban_persen', 'status', 'merk', 'tahun', 'keterangan'];
const LINE_COLS = ['dari_kode', 'ke_kode', 'penyulang', 'level', 'penghantar', 'panjang_m', 'panjang_peta_m', 'keterangan', 'jalur'];

const ALIAS = {
  jenis: ['jenis', 'type', 'tipe', 'jenis_aset', 'kategori'],
  kode: ['kode', 'code', 'id', 'no', 'no_gardu', 'nomor', 'kode_aset'],
  nama: ['nama', 'name', 'lokasi', 'alamat', 'nama_gardu'],
  penyulang: ['penyulang', 'feeder', 'pyl', 'nama_penyulang'],
  lat: ['lat', 'latitude', 'lintang', 'y'],
  lng: ['lng', 'lon', 'long', 'longitude', 'bujur', 'x'],
  kva: ['kva', 'daya', 'kapasitas', 'daya_kva', 'kapasitas_kva'],
  beban_persen: ['beban_persen', 'beban', 'beban_%', 'load', 'persen_beban', 'pembebanan'],
  status: ['status', 'kondisi_operasi', 'no/nc'],
  merk: ['merk', 'merek', 'brand', 'pabrikan'],
  tahun: ['tahun', 'tahun_operasi', 'year'],
  keterangan: ['keterangan', 'ket', 'note', 'catatan'],
  dari_kode: ['dari_kode', 'dari', 'from', 'asal'],
  ke_kode: ['ke_kode', 'ke', 'to', 'tujuan'],
  level: ['level', 'jaringan', 'jenis_jaringan'],
  penghantar: ['penghantar', 'konduktor', 'conductor', 'jenis_penghantar', 'kabel'],
  panjang_m: ['panjang_m', 'panjang', 'length', 'jarak', 'jarak_m', 'panjang_meter'],
  jalur: ['jalur', 'path', 'koordinat_jalur'],
};

function normKey(k) { return String(k).trim().toLowerCase().replace(/\s+/g, '_'); }
function pick(row, key) {
  for (const k of ALIAS[key] || [key]) if (row[k] != null && row[k] !== '') return row[k];
  return '';
}

function guessType(text) {
  const s = ' ' + String(text || '').toUpperCase() + ' ';
  if (ASSET_TYPES[s.trim()]) return s.trim();
  if (/\bGI\b|GARDU INDUK/.test(s)) return 'GI';
  if (/\bGH\b|GARDU HUBUNG/.test(s)) return 'GH';
  if (/RECLOSER|\bREC\b|\bPMT\b|\bRC\b/.test(s)) return 'REC';
  if (/\bLBS\b|SAKLAR|\bSSO\b|SECTIONALI[SZ]ER|\bDS\b|\bABSW\b|\bAVS\b/.test(s)) return 'LBS';
  if (/\bFCO\b|FUSE|CUT ?OUT/.test(s)) return 'FCO';
  if (/PELANGGAN|\bPTM\b|\bAPP TM\b/.test(s)) return 'PTM';
  if (/TIANG|\bTM ?\d|\bPOLE\b|\bTG\b|PERCABANGAN/.test(s)) return 'TIANG';
  if (/\bGD\b|GARDU|TRAFO|TRANSFORMATOR|\bGTT\b|\bKTT\b|\bGTB\b|\bGB\b|\bGT\b|\bKVA\b/.test(s)) return 'GD';
  return null;
}

// cari/daftarkan penghantar dari teks bebas
function resolveConductor(txt) {
  const raw = String(txt || '').trim();
  if (!raw) return 'AAAC-150';
  const n = s => s.toUpperCase().replace(/[\s\-_×xX²2]*MM[²2]?/g, '').replace(/[^A-Z0-9]/g, '');
  const found = Store.data.conductors.find(c => c.code === raw || n(c.code) === n(raw) || n(c.name) === n(raw));
  if (found) return found.code;
  const base = Store.conductor('AAAC-150') || Store.data.conductors[0];
  Store.data.conductors.push({ code: raw, name: raw + ' (perlu dicek R/X)', r: base.r, x: base.x, kha: base.kha });
  return raw;
}

const IO = {
  /* ---------- util unduh ---------- */
  downloadBlob(name, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },
  download(name, text, type = 'text/plain') { this.downloadBlob(name, new Blob([text], { type: type + ';charset=utf-8' })); },
  stamp() { return new Date().toISOString().slice(0, 10); },
  base() { return (Store.data.meta.name || 'proyek').replace(/[^\w-]+/g, '_'); },
  readFile(file, as = 'text') {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result); r.onerror = rej;
      as === 'buffer' ? r.readAsArrayBuffer(file) : r.readAsText(file);
    });
  },

  /* ---------- CSV ---------- */
  parseCSV(text) {
    text = text.replace(/^﻿/, '');
    if (/^sep=./i.test(text)) text = text.slice(text.indexOf('\n') + 1);
    const first = text.split(/\r?\n/)[0];
    const cnt = ch => first.split(ch).length;
    const delim = [';', ',', '\t'].sort((a, b) => cnt(b) - cnt(a))[0];
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === delim) { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cur); rows.push(row); row = []; cur = '';
      } else cur += c;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    const head = (rows.shift() || []).map(normKey);
    return rows.filter(r => r.some(v => String(v).trim() !== '')).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
  },
  toCSV(rows, cols) {
    const sep = Store.data.params.csvSep || ';';
    const cell = v => {
      if (v == null) return '';
      let s = typeof v === 'number' && sep === ';' ? String(v).replace('.', ',') : String(v);
      return /["\n\r;,]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return '﻿' + [cols.join(sep), ...rows.map(r => cols.map(c => cell(r[c])).join(sep))].join('\r\n');
  },

  assetRows() {
    return Store.data.assets.map(a => ({
      jenis: a.type, kode: a.code, nama: a.name, penyulang: a.feeder, lat: a.lat, lng: a.lng,
      kva: num(a.kva), beban_persen: num(a.loadPct), status: ASSET_TYPES[a.type]?.sw ? a.status : '',
      merk: a.merk, tahun: a.tahun, keterangan: a.note,
    }));
  },
  lineRows() {
    return Store.data.lines.map(l => ({
      dari_kode: Store.asset(l.from)?.code, ke_kode: Store.asset(l.to)?.code, penyulang: l.feeder, level: l.level,
      penghantar: l.conductor, panjang_m: num(l.lengthM), panjang_peta_m: Math.round(Store.lineGeoLength(l)),
      keterangan: l.note, jalur: (l.path || []).map(p => p.join(' ')).join('|'),
    }));
  },

  /* ---------- impor tabel (dipakai CSV & Excel) ---------- */
  importAssetRows(rows) {
    let add = 0, upd = 0; const skip = [];
    Store.mutate(() => {
      rows.forEach((r, i) => {
        const lat = num(pick(r, 'lat')), lng = num(pick(r, 'lng'));
        const code = String(pick(r, 'kode')).trim();
        const type = guessType(pick(r, 'jenis')) || guessType(code) || guessType(pick(r, 'nama'));
        if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180) { skip.push(`baris ${i + 2}: koordinat tidak valid`); return; }
        const status = /\bNO\b|OPEN|BUKA/i.test(pick(r, 'status')) ? 'NO' : 'NC';
        const v = {
          lat, lng, name: String(pick(r, 'nama')), feeder: String(pick(r, 'penyulang')),
          kva: num(pick(r, 'kva')), loadPct: num(pick(r, 'beban_persen')), status,
          merk: String(pick(r, 'merk')), tahun: String(pick(r, 'tahun')), note: String(pick(r, 'keterangan')),
        };
        const ex = code && Store.byCode(code);
        if (ex) { Object.assign(ex, v, type ? { type } : {}); upd++; }
        else { Store._newAsset({ ...v, type: type || 'GD', code }); add++; }
      });
    }, 'import');
    return { add, upd, skip };
  },
  importLineRows(rows) {
    let add = 0; const skip = [];
    Store.mutate(() => {
      rows.forEach((r, i) => {
        const a = Store.byCode(pick(r, 'dari_kode')), b = Store.byCode(pick(r, 'ke_kode'));
        if (!a || !b) { skip.push(`baris ${i + 2}: kode ${!a ? pick(r, 'dari_kode') : pick(r, 'ke_kode')} tidak ada di data aset`); return; }
        const path = String(pick(r, 'jalur') || '').split('|').map(s => s.trim().split(/[\s,]+/).map(Number)).filter(p => p.length === 2 && p.every(isFinite));
        Store._newLine({
          from: a.id, to: b.id, path, feeder: String(pick(r, 'penyulang') || a.feeder || ''),
          level: /JTR|TR\b/i.test(pick(r, 'level')) ? 'JTR' : 'JTM',
          conductor: resolveConductor(pick(r, 'penghantar')), lengthM: num(pick(r, 'panjang_m')),
          note: String(pick(r, 'keterangan')),
        });
        add++;
      });
    }, 'import');
    return { add, skip };
  },

  /* ---------- Excel ---------- */
  exportExcel() {
    if (!window.XLSX) return App.toast('Library Excel belum termuat (butuh internet). Gunakan ekspor CSV.');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(this.assetRows(), { header: ASSET_COLS }), 'Aset');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(this.lineRows(), { header: LINE_COLS }), 'Saluran');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(Store.data.conductors.map(c => ({ kode: c.code, nama: c.name, r_ohm_km: c.r, x_ohm_km: c.x, kha_a: c.kha }))), 'Penghantar');
    XLSX.writeFile(wb, `${this.base()}_${this.stamp()}.xlsx`);
  },
  templateExcel() {
    if (!window.XLSX) return this.download('template_aset.csv', this.toCSV([], ASSET_COLS), 'text/csv');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
      { jenis: 'GI', kode: 'GI-01', nama: 'GI Contoh', penyulang: '', lat: -5.135, lng: 119.42, kva: '', beban_persen: '', status: '', merk: '', tahun: '', keterangan: '' },
      { jenis: 'GD', kode: 'KB001', nama: 'Jl. Merdeka', penyulang: 'MAWAR', lat: -5.1342, lng: 119.4288, kva: 160, beban_persen: 72, status: '', merk: 'Trafindo', tahun: 2018, keterangan: 'hasil ukur Jan 2026' },
      { jenis: 'LBS', kode: 'LBS-01', nama: 'Tie Mawar-Melati', penyulang: 'MAWAR', lat: -5.131, lng: 119.435, kva: '', beban_persen: '', status: 'NO', merk: '', tahun: '', keterangan: '' },
    ], { header: ASSET_COLS }), 'Aset');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
      { dari_kode: 'GI-01', ke_kode: 'KB001', penyulang: 'MAWAR', level: 'JTM', penghantar: 'AAAC-150', panjang_m: 1250, panjang_peta_m: '', keterangan: 'panjang_m boleh kosong → dihitung dari koordinat', jalur: '' },
    ], { header: LINE_COLS }), 'Saluran');
    XLSX.writeFile(wb, 'Template_Import_SIPERSIS.xlsx');
  },
  async importExcel(file) {
    if (!window.XLSX) throw new Error('Library Excel belum termuat (butuh internet)');
    const wb = XLSX.read(await this.readFile(file, 'buffer'), { type: 'array' });
    const sheet = name => {
      const s = wb.SheetNames.find(n => n.toLowerCase().includes(name));
      return s ? XLSX.utils.sheet_to_json(wb.Sheets[s], { defval: '' }).map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [normKey(k), v]))) : null;
    };
    let aRows = sheet('aset') || sheet('gardu') || sheet('asset');
    const lRows = sheet('saluran') || sheet('jaringan') || sheet('line');
    if (!aRows && !lRows) aRows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }).map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [normKey(k), v])));
    const out = [];
    if (aRows) { const r = this.importAssetRows(aRows); out.push(`Aset: ${r.add} baru, ${r.upd} diperbarui`, ...r.skip); }
    if (lRows) { const r = this.importLineRows(lRows); out.push(`Saluran: ${r.add} baru`, ...r.skip); }
    return out;
  },
  async importCSV(file, kind) {
    const rows = this.parseCSV(await this.readFile(file));
    const isLine = kind === 'lines' || (rows[0] && (pick(rows[0], 'dari_kode') !== '' || 'dari_kode' in rows[0]));
    if (isLine) { const r = this.importLineRows(rows); return [`Saluran: ${r.add} baru`, ...r.skip]; }
    const r = this.importAssetRows(rows); return [`Aset: ${r.add} baru, ${r.upd} diperbarui`, ...r.skip];
  },

  /* ---------- KML / KMZ ---------- */
  async importKml(file, defaultType) {
    let text;
    if (/\.kmz$/i.test(file.name)) {
      if (!window.JSZip) throw new Error('Library KMZ belum termuat (butuh internet). Ekstrak KMZ jadi KML dulu.');
      const zip = await JSZip.loadAsync(await this.readFile(file, 'buffer'));
      const kmlName = Object.keys(zip.files).find(n => /\.kml$/i.test(n));
      if (!kmlName) throw new Error('Tidak ada file .kml di dalam KMZ');
      text = await zip.file(kmlName).async('string');
    } else text = await this.readFile(file);
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('File KML tidak valid');
    const P = Store.data.params;
    const pms = [...doc.getElementsByTagName('Placemark')];
    const txt = (el, tag) => el.getElementsByTagName(tag)[0]?.textContent.trim() || '';
    const folderOf = el => { const names = []; let p = el.parentElement; while (p) { if (/^(Folder|Document)$/.test(p.tagName)) { const n = [...p.children].find(c => c.tagName === 'name'); if (n) names.push(n.textContent.trim()); } p = p.parentElement; } return names; };
    const coords = s => s.trim().split(/\s+/).map(c => c.split(',').map(Number)).filter(c => c.length >= 2 && isFinite(c[0]) && isFinite(c[1])).map(c => [+c[1].toFixed(7), +c[0].toFixed(7)]);
    let nA = 0, nL = 0, nT = 0;
    Store.mutate(() => {
      const lineJobs = [];
      for (const pm of pms) {
        const name = txt(pm, 'name'), desc = txt(pm, 'description').replace(/<[^>]+>/g, ' ');
        const folders = folderOf(pm);
        const feeder = (folders.find(f => /PENYULANG|FEEDER|\bPYL\b/i.test(f)) || '').replace(/^(PENYULANG|FEEDER|PYL)\s*/i, '').trim();
        for (const pt of pm.getElementsByTagName('Point')) {
          const c = coords(txt(pt, 'coordinates'))[0]; if (!c) continue;
          const type = guessType(name) || guessType(folders.join(' ')) || guessType(desc) || defaultType;
          const kva = num((desc.match(/(\d{2,4})\s*kVA/i) || name.match(/(\d{2,4})\s*kVA/i) || [])[1]);
          const ex = name && Store.byCode(name);
          if (ex) { ex.lat = c[0]; ex.lng = c[1]; continue; }
          Store._newAsset({ type, code: name || '', name: '', lat: c[0], lng: c[1], feeder, kva, note: desc.slice(0, 300) });
          nA++;
        }
        for (const ls of pm.getElementsByTagName('LineString')) {
          const c = coords(txt(ls, 'coordinates'));
          if (c.length >= 2) lineJobs.push({ c, name, feeder, desc });
        }
      }
      // saluran: ujung di-snap ke aset terdekat, jika tidak ada dibuat tiang
      const snapM = num(P.snapM) || 25;
      const snap = (p, feeder) => {
        let best = null;
        for (const a of Store.data.assets) { const d = Geo.dist(p, [a.lat, a.lng]); if (d <= snapM && (!best || d < best.d)) best = { a, d }; }
        if (best) return best.a.id;
        nT++;
        return Store._newAsset({ type: 'TIANG', lat: p[0], lng: p[1], feeder }).id;
      };
      for (const j of lineJobs) {
        const from = snap(j.c[0], j.feeder), to = snap(j.c[j.c.length - 1], j.feeder);
        if (from === to) continue;
        const cond = (j.name + ' ' + j.desc).match(/(AAAC-?S?|MVTIC|XLPE|N2XSEFGBY|A3CS)\s*-?\s*\d{2,3}/i);
        Store._newLine({ from, to, path: j.c.slice(1, -1), feeder: j.feeder || Store.asset(from).feeder, conductor: cond ? resolveConductor(cond[0].replace(/\s+/g, '-').toUpperCase()) : 'AAAC-150', note: j.name });
        nL++;
      }
    }, 'import');
    return [`KML: ${nA} aset, ${nL} saluran, ${nT} tiang otomatis dibuat di ujung saluran`];
  },

  exportKml() {
    const styles = Object.entries(ASSET_TYPES).map(([k, T]) => {
      const c = T.color.slice(1); const abgr = 'ff' + c.slice(4, 6) + c.slice(2, 4) + c.slice(0, 2);
      return `<Style id="s${k}"><IconStyle><color>${abgr}</color><scale>${k === 'TIANG' ? 0.5 : 0.9}</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon></IconStyle></Style>`;
    }).join('');
    const desc = a => esc([ASSET_TYPES[a.type]?.label, a.name, a.feeder && 'Penyulang ' + a.feeder, a.kva && a.kva + ' kVA', ASSET_TYPES[a.type]?.sw && a.status, a.note].filter(Boolean).join(' | '));
    const folders = Object.keys(ASSET_TYPES).map(k => {
      const list = Store.data.assets.filter(a => a.type === k);
      if (!list.length) return '';
      return `<Folder><name>${esc(ASSET_TYPES[k].label)}</name>${list.map(a => `<Placemark><name>${esc(a.code)}</name><description>${desc(a)}</description><styleUrl>#s${k}</styleUrl><Point><coordinates>${a.lng},${a.lat},0</coordinates></Point></Placemark>`).join('')}</Folder>`;
    }).join('');
    const lines = Store.data.lines.map(l => {
      const p = Store.linePoints(l); if (!p) return '';
      const c = feederColor(l.feeder).slice(1);
      return `<Placemark><name>${esc(Store.asset(l.from).code)} - ${esc(Store.asset(l.to).code)}</name><description>${esc(`${l.level} ${l.conductor} | ${Math.round(Store.lineLength(l))} m | ${l.feeder || ''}`)}</description><Style><LineStyle><color>ff${c.slice(4, 6)}${c.slice(2, 4)}${c.slice(0, 2)}</color><width>3</width></LineStyle></Style><LineString><tessellate>1</tessellate><coordinates>${p.map(x => `${x[1]},${x[0]},0`).join(' ')}</coordinates></LineString></Placemark>`;
    }).join('');
    const kml = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(Store.data.meta.name)}</name>${styles}${folders}<Folder><name>Saluran</name>${lines}</Folder></Document></kml>`;
    this.download(`${this.base()}_${this.stamp()}.kml`, kml, 'application/vnd.google-earth.kml+xml');
  },

  exportGeoJSON() {
    const f = [
      ...Store.data.assets.map(a => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [a.lng, a.lat] }, properties: { kind: 'aset', jenis: a.type, kode: a.code, nama: a.name, penyulang: a.feeder, kva: a.kva, beban_persen: a.loadPct, status: a.status, keterangan: a.note } })),
      ...Store.data.lines.map(l => { const p = Store.linePoints(l); return p && { type: 'Feature', geometry: { type: 'LineString', coordinates: p.map(x => [x[1], x[0]]) }, properties: { kind: 'saluran', dari: Store.asset(l.from).code, ke: Store.asset(l.to).code, penyulang: l.feeder, level: l.level, penghantar: l.conductor, panjang_m: Math.round(Store.lineLength(l)) } }; }).filter(Boolean),
    ];
    this.download(`${this.base()}_${this.stamp()}.geojson`, JSON.stringify({ type: 'FeatureCollection', features: f }), 'application/geo+json');
  },

  /* ---------- backup ---------- */
  exportJson() { this.download(`${this.base()}_backup_${this.stamp()}.json`, JSON.stringify(Store.data, null, 1), 'application/json'); },
  async importJson(file) {
    const d = JSON.parse(await this.readFile(file));
    if (!d || !Array.isArray(d.assets)) throw new Error('Bukan file backup SIPERSIS');
    Store.replace(d);
    return [`Backup dipulihkan: ${d.assets.length} aset, ${(d.lines || []).length} saluran`];
  },

  /* ---------- data contoh (fiktif) ---------- */
  loadSample() {
    if (Store.data.assets.length && !confirm('Data contoh akan DITAMBAHKAN ke data yang ada. Lanjut?')) return;
    const O = [-5.1350, 119.4200];
    const P = (dx, dy) => Geo.offset(O[0], O[1], dx, dy).map(v => +v.toFixed(7));
    const A = [
      ['GI', 'GI-CONTOH', 'GI Contoh 150/20 kV', '', 0, 0],
      // Penyulang MAWAR (ke timur)
      ['REC', 'REC-MWR1', 'Recloser Mawar 1', 'MAWAR', 350, 20],
      ['TIANG', 'TM-MWR-12', 'Percabangan Jl. Anggrek', 'MAWAR', 1100, 60],
      ['GD', 'KB001', 'Jl. Anggrek', 'MAWAR', 1120, 330, 100, 78],
      ['LBS', 'LBS-MWR1', 'LBS Pasar', 'MAWAR', 1800, 90],
      ['TIANG', 'TM-MWR-31', 'Simpang Pasar', 'MAWAR', 2400, 110],
      ['GD', 'KB002', 'Pasar Sentral', 'MAWAR', 2420, -160, 160, 91],
      ['GH', 'GH-KOTA', 'Gardu Hubung Kota', 'MAWAR', 3300, 160],
      ['GD', 'KB003', 'Perumahan Griya', 'MAWAR', 3320, 580, 200, 64],
      ['GD', 'KB004', 'Jl. Pelabuhan', 'MAWAR', 3850, 150, 250, 55],
      ['FCO', 'FCO-MWR5', 'FCO Lorong 5', 'MAWAR', 3300, -180],
      ['GD', 'KB005', 'Lorong 5', 'MAWAR', 3310, -430, 50, 102],
      // Penyulang MELATI (ke utara)
      ['REC', 'REC-MLT1', 'Recloser Melati 1', 'MELATI', 20, 420],
      ['TIANG', 'TM-MLT-20', 'Simpang Masjid', 'MELATI', 60, 1300],
      ['GD', 'KB101', 'Masjid Raya', 'MELATI', -260, 1320, 100, 48],
      ['PTM', 'PTM-HOTEL', 'Hotel Contoh (PTM)', 'MELATI', -420, 2050, 555, 60],
      ['TIANG', 'TM-MLT-41', 'Simpang Kampus', 'MELATI', 900, 1900],
      ['GD', 'KB102', 'Kampus', 'MELATI', 920, 2230, 160, 70],
      ['GD', 'KB103', 'Jl. Veteran', 'MELATI', 1700, 1950, 100, 85],
      ['LBS', 'LBS-TIE-1', 'Titik buka Melati–Mawar', 'MELATI', 2600, 1300, null, null, 'NO'],
    ];
    const L = [
      ['GI-CONTOH', 'REC-MWR1', 'XLPE-240', 'MAWAR'], ['REC-MWR1', 'TM-MWR-12', 'AAAC-240', 'MAWAR'],
      ['TM-MWR-12', 'KB001', 'AAAC-70', 'MAWAR'], ['TM-MWR-12', 'LBS-MWR1', 'AAAC-240', 'MAWAR'],
      ['LBS-MWR1', 'TM-MWR-31', 'AAAC-240', 'MAWAR'], ['TM-MWR-31', 'KB002', 'AAAC-70', 'MAWAR'],
      ['TM-MWR-31', 'GH-KOTA', 'AAAC-150', 'MAWAR'], ['GH-KOTA', 'KB003', 'AAAC-150', 'MAWAR'],
      ['GH-KOTA', 'KB004', 'AAAC-150', 'MAWAR'], ['GH-KOTA', 'FCO-MWR5', 'AAAC-70', 'MAWAR'], ['FCO-MWR5', 'KB005', 'AAAC-70', 'MAWAR'],
      ['GI-CONTOH', 'REC-MLT1', 'XLPE-240', 'MELATI'], ['REC-MLT1', 'TM-MLT-20', 'AAAC-150', 'MELATI'],
      ['TM-MLT-20', 'KB101', 'AAAC-70', 'MELATI'], ['TM-MLT-20', 'PTM-HOTEL', 'AAAC-150', 'MELATI'],
      ['TM-MLT-20', 'TM-MLT-41', 'AAAC-150', 'MELATI'], ['TM-MLT-41', 'KB102', 'AAAC-70', 'MELATI'],
      ['TM-MLT-41', 'KB103', 'AAAC-150', 'MELATI'], ['KB103', 'LBS-TIE-1', 'AAAC-150', 'MELATI'], ['LBS-TIE-1', 'GH-KOTA', 'AAAC-150', 'MAWAR'],
    ];
    Store.mutate(() => {
      if (!Store.data.assets.length) Store.data.meta.name = 'Contoh — ULP Fiktif';
      const map = {};
      A.forEach(([type, code, name, feeder, dx, dy, kva, lp, status]) => {
        let c = code; while (Store.byCode(c)) c += '*';
        const [lat, lng] = P(dx, dy);
        map[code] = Store._newAsset({ type, code: c, name, feeder, lat, lng, kva: kva ?? null, loadPct: lp ?? null, status: status || 'NC' }).id;
      });
      L.forEach(([f, t, cond, feeder]) => Store._newLine({ from: map[f], to: map[t], conductor: cond, feeder, level: 'JTM' }));
    }, 'import');
    MapView.fitAll();
    App.toast('Data contoh dimuat — coba buka tab SLD & Analisis');
  },
};
