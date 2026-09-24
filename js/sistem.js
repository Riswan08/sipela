'use strict';
/* ============================================================
 * Referensi sistem kelistrikan UP3 Masohi: ULP → Sistem → Penyulang
 * (sumber: Data Sistem Per Penyulang.xlsx, Sep 2026). Bisa ditambah/diedit.
 * ============================================================ */

const ULP_CODES = { '41410': 'BULA', '41420': 'PIRU', '41430': 'MASOHI', '41440': 'KOBISONTA', '41450': 'KAIRATU' };

const SISTEM_REF = [
  {"ulp": "MASOHI", "sistem": "Masohi", "penyulang": ["Lesane", "Letwaru", "Amahai", "Tamilouw", "Makariki"]},
  {"ulp": "MASOHI", "sistem": "Laimu", "penyulang": ["Atiahu", "Salamahu", "BSJ1", "BSJ2", "Express Laimu"]},
  {"ulp": "MASOHI", "sistem": "Werinama", "penyulang": ["Bemo", "Batuasa"]},
  {"ulp": "MASOHI", "sistem": "Pasanea", "penyulang": ["Saleman", "Gale - Gale"]},
  {"ulp": "KAIRATU", "sistem": "Kairatu", "penyulang": ["Rumahkay", "Kairatu", "Waisarisa", "Waiselang"]},
  {"ulp": "PIRU", "sistem": "Piru", "penyulang": ["Morekau", "Tanopol", "Uhe", "Kawa", "Nagalema"]},
  {"ulp": "PIRU", "sistem": "Taniwel", "penyulang": ["Walakone", "Mornaten", "Riring"]},
  {"ulp": "PIRU", "sistem": "Buano", "penyulang": ["Buano", "Valentine"]},
  {"ulp": "PIRU", "sistem": "Luhu", "penyulang": ["Kambelu", "Warau", "Hulung"]},
  {"ulp": "KOBISONTA", "sistem": "Kobisonta", "penyulang": ["Samal", "Pasahari", "Loping Mulyo", "Tanah Merah"]},
  {"ulp": "KOBISONTA", "sistem": "Pasahari", "penyulang": ["WLI-PSR 1", "WLI-PSR 2", "Kobisonta"]},
  {"ulp": "KOBISONTA", "sistem": "Wahai", "penyulang": ["Air Besar", "Malaku"]},
  {"ulp": "KOBISONTA", "sistem": "Oping / Olong", "penyulang": ["WLI-OPG 1", "WLI-OPG 2", "Olong"]},
  {"ulp": "BULA", "sistem": "Bula", "penyulang": ["Hote", "Pandopo", "Wailola", "Bula", "Waru"]},
  {"ulp": "BULA", "sistem": "Kiandarat", "penyulang": ["Kwaos", "Waras - Waras"]},
  {"ulp": "BULA", "sistem": "Amarsekaru", "penyulang": ["Sera", "Wawasa"]},
  {"ulp": "BULA", "sistem": "Effa", "penyulang": ["Lahema", "Ilili"]},
  {"ulp": "BULA", "sistem": "Geser", "penyulang": ["Geser"]},
  {"ulp": "BULA", "sistem": "Keffing", "penyulang": ["JTR-KFG"]},
  {"ulp": "BULA", "sistem": "Kesui", "penyulang": ["Utta", "Sumelang"]},
  {"ulp": "BULA", "sistem": "Kilmury", "penyulang": ["Kilbon", "Selor"]},
  {"ulp": "BULA", "sistem": "Kwamor", "penyulang": ["JTR-KWR"]},
  {"ulp": "BULA", "sistem": "Namalomin", "penyulang": ["Kiltay", "Mar"]},
  {"ulp": "BULA", "sistem": "Ondor", "penyulang": ["Ondor", "Kilkoda"]},
  {"ulp": "BULA", "sistem": "Pulau Panjang", "penyulang": ["Lalasa", "Argam"]},
  {"ulp": "BULA", "sistem": "Teor", "penyulang": ["Rumalusi", "Rumoy"]},
];

// nama penyulang di GIS yang berbeda ejaan/penamaan dengan daftar sistem
const FEEDER_ALIAS = {
  'LESANE/KOTA A': 'Lesane', 'LETWARU/KOTA B': 'Letwaru', 'TAMILOW': 'Tamilouw', 'ATUAHU': 'Atiahu',
  'MOREKAU/KOTA B': 'Morekau', 'TANOPOL/KOTA A': 'Tanopol', 'UTA': 'Utta', 'RUMOI': 'Rumoy',
  'KILMURI': '@Kilmury', 'KEFFING': '@Keffing', 'OPING': '@Oping / Olong', 'EKSPRESS': 'Express Laimu',
};

const SistemRef = {
  norm(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); },
  lev(a, b) {
    const m = a.length, n = b.length, D = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
    for (let j = 1; j <= n; j++) D[0][j] = j;
    for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
      D[i][j] = Math.min(D[i - 1][j] + 1, D[i][j - 1] + 1, D[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return D[m][n];
  },
  ulpOfOwner(owner) {
    const m = String(owner || '').match(/(\d{5})/);
    if (m && ULP_CODES[m[1]]) return ULP_CODES[m[1]];
    const n = String(owner || '').toUpperCase();
    return Object.values(ULP_CODES).find(u => n.includes(u)) || '';
  },
  ulps() { return [...new Set(SISTEM_REF.map(s => s.ulp))]; },
  systemsOf(ulp) { return SISTEM_REF.filter(s => !ulp || s.ulp === ulp); },
  // cari sistem untuk nama penyulang GIS → {sistem, ulp, penyulang, how}
  match(feederName, ulpHint) {
    const raw = String(feederName || '').trim().toUpperCase();
    if (!raw) return null;
    const alias = FEEDER_ALIAS[raw];
    if (alias) {
      if (alias.startsWith('@')) { const s = SISTEM_REF.find(x => x.sistem === alias.slice(1)); return s && { ...s, penyulang: raw, how: 'alias' }; }
      const s = SISTEM_REF.find(x => x.penyulang.includes(alias)); if (s) return { ...s, penyulang: alias, how: 'alias' };
    }
    const n = this.norm(raw.replace(/\/.*$/, ''));
    let best = null;
    for (const s of SISTEM_REF) {
      for (const p of s.penyulang) {
        const d = this.lev(n, this.norm(p));
        // beda ejaan maksimal 1 huruf, dan bila ULP diketahui harus di ULP yang sama
        const ok = d === 0 || (d === 1 && n.length >= 5 && (!ulpHint || s.ulp === ulpHint));
        if (ok && (!best || d < best.d)) best = { ...s, penyulang: p, d, how: d ? 'mirip' : 'sama' };
      }
      const ds = this.lev(n, this.norm(s.sistem));
      if (ds === 0 && !best) best = { ...s, penyulang: raw, d: 0, how: 'nama sistem' };
    }
    return best;
  },
};
