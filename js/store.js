'use strict';
/* ============================================================
 * SIPELA — Store: model data, penyimpanan lokal, undo, geo helper
 * ============================================================ */

const STORAGE_KEY = 'sipela.v1';
const LEGACY_KEYS = ['sipersis.v1'];

// Jenis aset jaringan distribusi. sw = peralatan hubung (punya status NO/NC),
// load = punya kapasitas kVA (dipakai di analisis beban & drop tegangan).
const ASSET_TYPES = {
  PLTD:  { label: 'PLTD / Pembangkit',        short: 'PL',  color: '#9f1239', source: true },
  GI:    { label: 'Gardu Induk',              short: 'GI',  color: '#b91c1c', source: true },
  GH:    { label: 'Gardu Hubung',             short: 'GH',  color: '#7c3aed' },
  GD:    { label: 'Gardu Distribusi / Trafo', short: 'GD',  color: '#0369a1', load: true },
  REC:   { label: 'Recloser / PMT',           short: 'R',   color: '#c2410c', sw: true },
  LBS:   { label: 'LBS / Saklar / DS',        short: 'S',   color: '#15803d', sw: true },
  FCO:   { label: 'FCO / Fuse Cut Out',       short: 'F',   color: '#a16207', sw: true },
  PTM:   { label: 'Pelanggan TM',             short: 'P',   color: '#be185d', load: true },
  TIANG: { label: 'Tiang / Titik Percabangan', short: 'T',  color: '#475569' },
};

// Nilai impedansi default (Ω/km) — pendekatan umum, WAJIB disesuaikan dengan
// SPLN / data pabrikan yang berlaku di unit Anda (bisa diedit di menu Data).
const DEFAULT_CONDUCTORS = [
  { code: 'AAAC-70',   name: 'AAAC 70 mm²',               r: 0.4608, x: 0.3572, kha: 255 },
  { code: 'AAAC-150',  name: 'AAAC 150 mm²',              r: 0.2162, x: 0.3305, kha: 425 },
  { code: 'AAAC-240',  name: 'AAAC 240 mm²',              r: 0.1344, x: 0.3158, kha: 585 },
  { code: 'AAACS-150', name: 'AAAC-S 150 mm² (berisolasi)', r: 0.2162, x: 0.3305, kha: 425 },
  { code: 'MVTIC-150', name: 'MVTIC 3×150 mm²',           r: 0.2060, x: 0.1000, kha: 255 },
  { code: 'XLPE-240',  name: 'N2XSEFGbY 3×240 mm² (SKTM)', r: 0.1250, x: 0.0970, kha: 400 },
];

const DEFAULT_PARAMS = {
  kv: 20,          // tegangan nominal (kV fasa-fasa)
  pf: 0.85,        // faktor daya beban
  loadPct: 60,     // beban default trafo bila belum ada hasil ukur (% kVA)
  dropLimit: 5,    // batas drop tegangan yang ditandai (%)
  snapM: 25,       // toleransi snap ujung saluran ke aset saat import KML (m)
  csvSep: ';',     // pemisah CSV (Excel Indonesia memakai ;)
};

function emptyData() {
  return {
    meta: { name: 'Proyek Baru', created: new Date().toISOString(), updated: null },
    assets: [],
    lines: [],
    customers: [],   // titik pelanggan (APP) dari GIS: {lat,lng,gd,idpel,va,feeder}
    conductors: JSON.parse(JSON.stringify(DEFAULT_CONDUCTORS)),
    params: { ...DEFAULT_PARAMS },
  };
}

const Geo = {
  R: 6371008.8,
  // jarak garis lurus (haversine) dalam meter, titik = [lat, lng]
  dist(a, b) {
    const k = Math.PI / 180;
    const dLat = (b[0] - a[0]) * k, dLng = (b[1] - a[1]) * k;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * k) * Math.cos(b[0] * k) * Math.sin(dLng / 2) ** 2;
    return 2 * this.R * Math.asin(Math.min(1, Math.sqrt(s)));
  },
  pathLen(pts) {
    let s = 0;
    for (let i = 1; i < pts.length; i++) s += this.dist(pts[i - 1], pts[i]);
    return s;
  },
  // geser titik sejauh dx (timur) dan dy (utara) meter
  offset(lat, lng, dx, dy) {
    return [lat + (dy / this.R) * 180 / Math.PI,
            lng + (dx / (this.R * Math.cos(lat * Math.PI / 180))) * 180 / Math.PI];
  },
};

const fmt = {
  m(v) {
    if (v == null || isNaN(v)) return '-';
    return v >= 1000
      ? (v / 1000).toLocaleString('id-ID', { maximumFractionDigits: 2 }) + ' km'
      : Math.round(v).toLocaleString('id-ID') + ' m';
  },
  n(v, d = 2) {
    return (v == null || v === '' || isNaN(v)) ? '-' : Number(v).toLocaleString('id-ID', { maximumFractionDigits: d });
  },
  date(iso) {
    return iso ? new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '-';
  },
};

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function num(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
  return isFinite(n) ? n : null;
}

// baca koordinat dari teks bebas: "-3.011, 127.95", "-3,011 127,95", DMS "3°0'39.7\"S 127°57'2.3\"E"
function parseCoord(txt) {
  let t = String(txt || '').trim();
  if (!t) return null;
  const dms = [...t.matchAll(/(\d+(?:[.,]\d+)?)\s*[°º]\s*(?:(\d+(?:[.,]\d+)?)\s*['′]\s*)?(?:(\d+(?:[.,]\d+)?)\s*["″]\s*)?\s*([NSEWUBTLnsewubtl])/g)];
  if (dms.length >= 2) {
    const v = m => { const f = x => parseFloat(String(x || 0).replace(',', '.')); let d = f(m[1]) + f(m[2]) / 60 + f(m[3]) / 3600; return /[SWBLswbl]/.test(m[4]) && !/[Uu]/.test(m[4]) ? -d : d; };
    const isLat = m => /[NSUSnsu]/.test(m[4]) && !/[LlBb]/.test(m[4]);
    const a = dms[0], b = dms[1];
    const lat = isLat(a) ? v(a) : v(b), lng = isLat(a) ? v(b) : v(a);
    return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [+lat.toFixed(7), +lng.toFixed(7)] : null;
  }
  // desimal: koma sebagai desimal hanya bila tidak ada titik dan ada 2 angka dipisah spasi/;
  let nums;
  if (!t.includes('.') && /\d,\d/.test(t) && /[\s;]/.test(t)) nums = t.split(/[\s;]+/).map(x => parseFloat(x.replace(',', '.')));
  else nums = t.split(/[\s,;]+/).map(parseFloat);
  nums = nums.filter(n => isFinite(n));
  if (nums.length < 2) return null;
  let [lat, lng] = nums;
  if (Math.abs(lat) > 90 && Math.abs(lng) <= 90) [lat, lng] = [lng, lat]; // tertukar
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [+lat.toFixed(7), +lng.toFixed(7)] : null;
}

// warna konsisten per penyulang
const FEEDER_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#db2777', '#65a30d', '#4f46e5', '#b45309'];
function feederColor(name) {
  if (!name) return '#64748b';
  let h = 0;
  for (const c of String(name).toUpperCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return FEEDER_COLORS[h % FEEDER_COLORS.length];
}

const Store = {
  data: emptyData(),
  undoStack: [],
  listeners: [],
  saveOk: true,

  load() {
    try {
      // data dari nama lama aplikasi tetap terbaca
      const raw = localStorage.getItem(STORAGE_KEY) ?? LEGACY_KEYS.map(k => localStorage.getItem(k)).find(Boolean);
      if (raw) this.data = this.normalize(JSON.parse(raw));
    } catch (e) { console.warn('Gagal memuat data', e); }
  },
  normalize(d) {
    const e = emptyData();
    d = d || {};
    return {
      meta: { ...e.meta, ...(d.meta || {}) },
      assets: Array.isArray(d.assets) ? d.assets : [],
      lines: Array.isArray(d.lines) ? d.lines : [],
      customers: Array.isArray(d.customers) ? d.customers : [],
      conductors: Array.isArray(d.conductors) && d.conductors.length ? d.conductors : e.conductors,
      params: { ...e.params, ...(d.params || {}) },
    };
  },
  persist() {
    this.data.meta.updated = new Date().toISOString();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data)); this.saveOk = true; }
    catch (e) { this.saveOk = false; console.error(e); }
  },
  on(fn) { this.listeners.push(fn); },
  emit(reason) { this.listeners.forEach(f => f(reason)); },
  snapshot() {
    this.undoStack.push(JSON.stringify(this.data));
    if (this.undoStack.length > 30) this.undoStack.shift();
  },
  // semua perubahan data lewat sini agar bisa di-undo & tersimpan otomatis
  mutate(fn, reason = 'change') {
    this.snapshot();
    this._idx = null;
    const r = fn(this.data);
    this._idx = null;
    this.persist();
    this.emit(reason);
    return r;
  },
  undo() {
    const s = this.undoStack.pop();
    if (!s) return false;
    this.data = JSON.parse(s);
    this._idx = null;
    this.persist();
    this.emit('undo');
    return true;
  },
  replace(d) { this.mutate(() => { this.data = this.normalize(d); }, 'replace'); },

  uid(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); },
  asset(id) {
    if (!this._idx) this._idx = new Map(this.data.assets.map(a => [a.id, a]));
    return this._idx.get(id) || this.data.assets.find(a => a.id === id);
  },
  line(id) { return this.data.lines.find(l => l.id === id); },
  byCode(code) {
    const c = String(code ?? '').trim().toLowerCase();
    return c ? this.data.assets.find(a => String(a.code || '').trim().toLowerCase() === c) : undefined;
  },
  conductor(code) { return this.data.conductors.find(c => c.code === code); },
  feeders() {
    const s = new Set();
    this.data.assets.forEach(a => a.feeder && s.add(a.feeder));
    this.data.lines.forEach(l => l.feeder && s.add(l.feeder));
    return [...s].sort();
  },
  nextCode(type) {
    let i = this.data.assets.filter(a => a.type === type).length + 1, code;
    do { code = type + '-' + String(i).padStart(3, '0'); i++; } while (this.byCode(code));
    return code;
  },
  // dipanggil DI DALAM mutate()
  _newAsset(a) {
    const x = { id: this.uid('a'), type: 'GD', code: '', name: '', feeder: '', lat: 0, lng: 0,
      kva: null, loadPct: null, status: 'NC', merk: '', tahun: '', note: '', ...a };
    if (!x.code) x.code = this.nextCode(x.type);
    this.data.assets.push(x);
    return x;
  },
  _newLine(l) {
    const x = { id: this.uid('l'), from: null, to: null, path: [], conductor: 'AAAC-150', feeder: '',
      level: 'JTM', lengthM: null, note: '', ...l };
    this.data.lines.push(x);
    return x;
  },
  addAsset(a) { return this.mutate(() => this._newAsset(a), 'asset'); },
  addLine(l) { return this.mutate(() => this._newLine(l), 'line'); },
  deleteAsset(id) {
    this.mutate(d => {
      d.assets = d.assets.filter(a => a.id !== id);
      d.lines = d.lines.filter(l => l.from !== id && l.to !== id);
    }, 'delete');
  },
  deleteLine(id) { this.mutate(d => { d.lines = d.lines.filter(l => l.id !== id); }, 'delete'); },

  linePoints(l) {
    const a = this.asset(l.from), b = this.asset(l.to);
    if (!a || !b) return null;
    return [[a.lat, a.lng], ...(l.path || []), [b.lat, b.lng]];
  },
  lineGeoLength(l) { const p = this.linePoints(l); return p ? Geo.pathLen(p) : 0; },
  // panjang manual (hasil ukur lapangan) diutamakan, jika kosong pakai panjang dari peta
  lineLength(l) { return num(l.lengthM) > 0 ? num(l.lengthM) : this.lineGeoLength(l); },
  linesOf(id) { return this.data.lines.filter(l => l.from === id || l.to === id); },
};
