'use strict';
/* ============================================================
 * SIPELA — Store: model data, penyimpanan lokal, undo, geo helper
 * ============================================================ */

const STORAGE_KEY = 'sipela.v1';
const LEGACY_KEYS = ['sipersis.v1'];

// Jenis aset jaringan distribusi. sw = peralatan hubung (punya status NO/NC),
// load = punya kapasitas kVA (dipakai di analisis beban & drop tegangan).
const ASSET_TYPES = {
  PLTD:  { label: 'Pembangkit (PLTD/PLTMG/PLTS)', short: 'G', color: '#9f1239', source: true },
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
  { code: 'AAAC-35',   name: 'AAAC 35 mm²',               r: 0.9217, x: 0.3790, kha: 170 },
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
  uiw: 'Maluku dan Maluku Utara', up3: 'Masohi',   // kop gambar SLD
  drawnBy: '', checkedBy: '', approvedBy: '', drawingNo: '',
};

function emptyData() {
  return {
    meta: { name: 'Proyek Baru', ulp: '', sistem: '', created: new Date().toISOString(), updated: null },
    feederColors: {},  // warna tiap penyulang di sistem ini (ditetapkan saat import / bisa diubah)
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
const FEEDER_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#db2777', '#65a30d', '#4f46e5', '#b45309',
  '#0d9488', '#7c2d12', '#1d4ed8', '#be123c', '#4d7c0f', '#6d28d9', '#c2410c', '#0369a1', '#a21caf', '#854d0e'];
// warna penyulang: pakai penetapan di sistem aktif bila ada, jika tidak dari hash nama
function feederColor(name) {
  if (!name) return '#64748b';
  const fc = Store.data && Store.data.feederColors;
  if (fc && fc[name]) return fc[name];
  let h = 0;
  for (const c of String(name).toUpperCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return FEEDER_COLORS[h % FEEDER_COLORS.length];
}

/* Penyimpanan: IndexedDB (kapasitas besar, banyak sistem) dengan cadangan localStorage.
 * Kunci: 'systems' = daftar sistem, 'current' = id aktif, 'sys:<id>' = data tiap sistem. */
const DB = {
  _db: null,
  open() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((res, rej) => {
      if (!window.indexedDB) return rej(new Error('no idb'));
      const r = indexedDB.open('sipela', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(this._db = r.result);
      r.onerror = () => rej(r.error);
    });
  },
  async tx(mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction('kv', mode), st = t.objectStore('kv');
      const req = fn(st);
      t.oncomplete = () => res(req && req.result);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  },
  get(k) { return this.tx('readonly', st => st.get(k)).catch(() => { try { const v = localStorage.getItem('sipela:' + k); return v ? JSON.parse(v) : undefined; } catch { return undefined; } }); },
  set(k, v) { return this.tx('readwrite', st => st.put(v, k)).catch(() => { localStorage.setItem('sipela:' + k, JSON.stringify(v)); }); },
  del(k) { return this.tx('readwrite', st => st.delete(k)).catch(() => { localStorage.removeItem('sipela:' + k); }); },
};

const Store = {
  data: emptyData(),
  systems: [],        // [{id, name, updated, assets, lines}]
  current: null,
  undoStack: [],
  listeners: [],
  saveOk: true,

  async load() {
    // tamu: hanya data publikasi (dari GitHub Pages), tidak menyentuh penyimpanan lokal
    if (typeof Auth !== 'undefined' && Auth.readOnly()) return this.loadPublished();
    try {
      this.systems = (await DB.get('systems')) || [];
      this.current = await DB.get('current');
      if (!this.systems.length) {
        // migrasi dari penyimpanan lama (satu proyek di localStorage)
        const raw = [STORAGE_KEY, ...LEGACY_KEYS].map(k => localStorage.getItem(k)).find(Boolean);
        const d = raw ? this.normalize(JSON.parse(raw)) : emptyData();
        if (!raw) d.meta.name = 'Sistem 1';
        await this.createSystem(d.meta.name, d);
        [STORAGE_KEY, ...LEGACY_KEYS].forEach(k => localStorage.removeItem(k));
        return;
      }
      if (!this.systems.some(x => x.id === this.current)) this.current = this.systems[0].id;
      const d = await DB.get('sys:' + this.current);
      this.data = this.normalize(d);
    } catch (e) { console.warn('Gagal memuat data', e); }
  },
  async loadPublished() {
    this.published = null;
    try {
      const idx = await Publish.fetchIndex();
      if (!idx || !idx.systems.length) { this.systems = []; this.current = null; this.data = emptyData(); this.data.meta.name = 'Belum ada data publikasi'; return; }
      this.published = idx;
      this.systems = idx.systems.map(s => ({ ...s }));
      this.current = this.systems.some(s => s.id === idx.current) ? idx.current : this.systems[0].id;
      this._pubCache = new Map();
      this.data = await this.fetchPublished(this.current);
    } catch (e) { console.warn('Gagal memuat publikasi', e); this.systems = []; this.current = null; this.data = emptyData(); }
  },
  async fetchPublished(id) {
    if (this._pubCache.has(id)) return this._pubCache.get(id);
    const d = this.normalize(await Publish.fetchSystem(id));
    this._pubCache.set(id, d);
    return d;
  },
  system(id = this.current) { return this.systems.find(x => x.id === id); },
  async saveIndex(id = this.current, d = this.data) {
    const s = this.system(id);
    if (s) Object.assign(s, { name: d.meta.name, ulp: d.meta.ulp || '', sistem: d.meta.sistem || '', updated: d.meta.updated, assets: d.assets.length, lines: d.lines.length });
    await DB.set('systems', this.systems);
    await DB.set('current', this.current);
  },
  async createSystem(name, data, meta = {}) {
    if (typeof Auth !== "undefined" && Auth.readOnly()) { App.toast('Mode pengunjung: tidak bisa membuat sistem'); return null; }
    await this.flush();
    const id = this.uid('s');
    const d = data ? this.normalize(data) : emptyData();
    d.meta.name = name || d.meta.name || 'Sistem baru';
    Object.assign(d.meta, meta);
    d.meta.updated = new Date().toISOString();
    this.systems.push({ id, name: d.meta.name, ulp: d.meta.ulp || '', sistem: d.meta.sistem || '', updated: d.meta.updated, assets: d.assets.length, lines: d.lines.length });
    this.current = id; this.data = d; this.undoStack = []; this._idx = null;
    await DB.set('sys:' + id, d);
    await this.saveIndex();
    this.emit('system');
    return id;
  },
  async switchTo(id) {
    if (id === this.current || !this.system(id)) return;
    if (this.published) {
      this.current = id; this._idx = null;
      try { this.data = await this.fetchPublished(id); } catch (e) { App.toast('Gagal memuat sistem: ' + e.message); return; }
      this.emit('system');
      return;
    }
    await this.flush();
    this.current = id;
    this.data = this.normalize(await DB.get('sys:' + id));
    this.undoStack = []; this._idx = null;
    await DB.set('current', id);
    this.emit('system');
  },
  async deleteSystem(id) {
    if (typeof Auth !== "undefined" && Auth.readOnly()) { App.toast('Mode pengunjung: tidak bisa menghapus sistem'); return; }
    const i = this.systems.findIndex(x => x.id === id);
    if (i < 0) return;
    if (this._pending && this._pending.id === id) this._pending = null;
    await this.flush();
    this.systems.splice(i, 1);
    await DB.del('sys:' + id);
    if (id === this.current) {
      if (!this.systems.length) { await this.createSystem('Sistem 1'); return; }
      await this.switchTo(this.systems[0].id);
    }
    await this.saveIndex();
    this.emit('system');
  },
  normalize(d) {
    const e = emptyData();
    d = d || {};
    return {
      meta: { ...e.meta, ...(d.meta || {}) },
      assets: Array.isArray(d.assets) ? d.assets : [],
      lines: Array.isArray(d.lines) ? d.lines : [],
      customers: Array.isArray(d.customers) ? d.customers : [],
      pending: Array.isArray(d.pending) ? d.pending : [],   // peralatan dari Data Aset yang belum punya koordinat
      feederColors: d.feederColors && typeof d.feederColors === 'object' ? d.feederColors : {},
      conductors: Array.isArray(d.conductors) && d.conductors.length ? d.conductors : e.conductors,
      params: { ...e.params, ...(d.params || {}) },
    };
  },
  // simpan asinkron; penulisan digabung bila perubahan beruntun
  persist() {
    if (typeof Auth !== "undefined" && Auth.readOnly()) return;
    this.data.meta.updated = new Date().toISOString();
    this._pending = { id: this.current, d: this.data };
    clearTimeout(this._pt);
    this._pt = setTimeout(() => this.flush(), 150);
  },
  // tulis segera data yang tertunda (dipanggil sebelum pindah/buat/hapus sistem)
  async flush() {
    clearTimeout(this._pt);
    const p = this._pending; this._pending = null;
    if (!p) return;
    try {
      await DB.set('sys:' + p.id, p.d);
      await this.saveIndex(p.id, p.d);
      if (!this.saveOk) { this.saveOk = true; this.emit('saved'); }
    } catch (e) { this.saveOk = false; console.error(e); this.emit('saved'); }
  },
  on(fn) { this.listeners.push(fn); },
  emit(reason) { this.listeners.forEach(f => f(reason)); },
  snapshot() {
    this.undoStack.push(JSON.stringify(this.data));
    if (this.undoStack.length > 30) this.undoStack.shift();
  },
  // semua perubahan data lewat sini agar bisa di-undo & tersimpan otomatis
  // perubahan besar (import ribuan aset): tanpa snapshot undo agar hemat memori
  mutateNoUndo(fn, reason = 'import') {
    if (typeof Auth !== "undefined" && Auth.readOnly()) { App.toast('Mode pengunjung: hanya bisa melihat'); return null; }
    this.undoStack = [];
    this._idx = null;
    const r = fn(this.data);
    this._idx = null;
    this.persist();
    this.emit(reason);
    return r;
  },
  mutate(fn, reason = 'change') {
    if (typeof Auth !== "undefined" && Auth.readOnly()) { App.toast('Mode pengunjung: hanya bisa melihat, tidak bisa mengubah data'); return null; }
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
