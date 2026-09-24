'use strict';
/* ============================================================
 * GisImport: import ekspor GIS PLN (ArcGIS "Table To Excel")
 * Sheet dikenali dari kolomnya: TRAFO_DISTRIBUSI, TIANG, APP, JTM, JTR.
 * Karena JTM tidak punya geometri, jaringan direkonstruksi:
 *  - tiang TM disambung dengan Minimum Spanning Tree (jarak terpendek)
 *  - posisi gardu diestimasi dari tiang TR nomor 01 tiap jurusan
 *  - JTR dirangkai dari urutan nomor tiang TR per jurusan
 *  - beban gardu diestimasi dari daya kontrak pelanggan (APP)
 * ============================================================ */

const GisImport = {
  parsed: null,

  kind(headers, name) {
    const h = new Set(headers);
    if (h.has('KAPASITAS_TRAFO') || h.has('MERK_TRAFO')) return 'trafo';
    if (h.has('JENIS_TIANG') || h.has('LOCATION_GARDU')) return 'tiang';
    if (h.has('ID_PELANGGAN') || h.has('DAYA_KONTRAK')) return 'app';
    if (h.has('UKURAN_PENGHANTAR_TM') || h.has('JENIS_JTM')) return 'jtm';
    if (h.has('UKURAN_KAWAT') && h.has('JURUSAN')) return 'jtr';
    const n = name.toUpperCase();
    return ['TRAFO', 'TIANG', 'APP', 'JTM', 'JTR'].find(k => n.includes(k))?.toLowerCase() || null;
  },

  // baca workbook: hanya sheet yang dikenali yang diproses (sheet STLTR puluhan ribu baris dilewati)
  async read(file, onProgress = () => {}) {
    if (!window.XLSX) throw new Error('Library Excel belum termuat (butuh internet)');
    onProgress('Membaca file… (file besar bisa 10–60 detik)');
    await new Promise(r => setTimeout(r, 30));
    const buf = await IO.readFile(file, 'buffer');
    const names = XLSX.read(buf, { type: 'array', bookSheets: true }).SheetNames;
    const wanted = names.filter(n => !/STL/i.test(n));
    const wb = XLSX.read(buf, { type: 'array', sheets: wanted });
    const out = { file: file.name, sheets: {} };
    for (const name of wanted) {
      const ws = wb.Sheets[name]; if (!ws) continue;
      const arr = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      if (!arr.length) continue;
      const hdr = arr[0].map(h => String(h).trim().toUpperCase());
      const k = this.kind(hdr, name);
      if (!k || out.sheets[k]) continue;
      const rows = [];
      for (let i = 1; i < arr.length; i++) {
        const a = arr[i]; if (!a.length) continue;
        const o = {};
        for (let j = 0; j < hdr.length; j++) { const v = a[j]; if (v !== '' && v != null) o[hdr[j]] = typeof v === 'string' ? v.trim() : v; }
        rows.push(o);
      }
      out.sheets[k] = { name, rows };
      onProgress(`Sheet ${name}: ${rows.length} baris`);
    }
    wb.Sheets = null;
    if (!Object.keys(out.sheets).length) throw new Error('Tidak ada sheet GIS yang dikenali (TRAFO / TIANG / APP / JTM / JTR)');
    const S = out.sheets, feeders = new Map();
    // tiang dengan kolom PENYULANG kosong: ikut penyulang tiang terdekat (≤ 300 m)
    if (S.tiang) {
      const withF = [], without = [];
      S.tiang.rows.forEach(r => { const p = this.ll(r); if (!p) return; (this.fdr(r) ? withF : without).push({ r, p }); });
      const cell = 0.003, grid = new Map(), key = (la, ln) => Math.floor(la / cell) + ':' + Math.floor(ln / cell);
      withF.forEach(x => { const k = key(x.p[0], x.p[1]); (grid.get(k) || grid.set(k, []).get(k)).push(x); });
      let fixed = 0;
      for (const x of without) {
        let best = null;
        const ci = Math.floor(x.p[0] / cell), cj = Math.floor(x.p[1] / cell);
        for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (const y of grid.get((ci + di) + ':' + (cj + dj)) || []) {
          const d = Geo.dist(x.p, y.p); if (d <= 300 && (!best || d < best.d)) best = { y, d };
        }
        if (best) { x.r.PENYULANG = this.fdr(best.y.r); x.r._feederGuess = true; fixed++; }
      }
      out.feederGuessed = fixed;
      onProgress(`${fixed} tiang tanpa penyulang ditetapkan ke penyulang tiang terdekat`);
    }
    // rekap per penyulang: jumlah baris & ULP pemilik (dari OWNER_ASET)
    const count = (rows, key) => rows.forEach(r => {
      const f = this.fdr(r); if (!f) { out.noFeeder = (out.noFeeder || 0) + 1; return; }
      const c = feeders.get(f) || { trafo: 0, tiang: 0, app: 0, owners: {} };
      c[key]++;
      const u = SistemRef.ulpOfOwner(r.OWNER_ASET || r.OWNER_PEMELIHARAAN); if (u) c.owners[u] = (c.owners[u] || 0) + 1;
      feeders.set(f, c);
    });
    if (S.trafo) count(S.trafo.rows, 'trafo');
    if (S.tiang) count(S.tiang.rows, 'tiang');
    if (S.app) count(S.app.rows, 'app');
    // komposisi kode ukuran penghantar TM per penyulang (bobot = Shape_Length) dari sheet JTM
    const condOf = new Map(); out.condCodes = new Set();
    (S.jtm?.rows || []).forEach(r => {
      const f = this.fdr(r); const code = String(r.UKURAN_PENGHANTAR_TM ?? '').trim();
      if (!f || !code) return;
      const w = num(r.SHAPE_LENGTH) ?? num(r.PANJANG_HANTARAN) ?? 1;
      const c = condOf.get(f) || {}; c[code] = (c[code] || 0) + w; condOf.set(f, c); out.condCodes.add(code);
    });
    out.condCodes = [...out.condCodes].sort();
    out.condMap = Object.assign({ '1': 'AAAC-35', '2': 'AAAC-70', '3': 'AAAC-150', '4': 'AAAC-240' }, (await DB.get('condMap')) || {});
    const saved = (await DB.get('feederMap')) || {};
    out.feeders = [...feeders.entries()].map(([name, c]) => {
      const ulp = Object.entries(c.owners).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
      const m = SistemRef.match(name, ulp);
      const sistem = saved[name] !== undefined ? saved[name] : (m ? m.sistem : '');
      const comp = condOf.get(name);
      const total = comp ? Object.values(comp).reduce((a, b) => a + b, 0) : 0;
      const cond = comp ? Object.entries(comp).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ code: k, pct: Math.round(v / total * 100) })) : [];
      return { name, ...c, ulp, sistem, cond, how: saved[name] !== undefined ? 'tersimpan' : (m ? m.how : '') };
    }).sort((a, b) => (a.ulp || 'ZZ').localeCompare(b.ulp || 'ZZ') || a.sistem.localeCompare(b.sistem) || a.name.localeCompare(b.name));
    this.parsed = out;
    return out;
  },

  fdr(r) { return String(r.PENYULANG || '').trim().toUpperCase(); },
  ll(r) {
    const lat = num(r.LATITUDEY ?? r.LATITUDE ?? r.LAT), lng = num(r.LONGITUDEX ?? r.LONGITUDE ?? r.LNG);
    return lat != null && lng != null && lat !== 0 && lng !== 0 && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lat, lng] : null;
  },
  isTR(r) {
    return String(r.SUBCLASS) === '2' || !!r.LOCATION_GARDU || /^TR/i.test(r.KODE_KONSTRUKSI_1 || '');
  },
  poleNo(r) { const m = String(r.ASSETNUM || r.DESCRIPTION || '').match(/(\d+)\D*$/); return m ? +m[1] : 9999; },
  jurusan(r) {
    const m = String(r.KODE_HANTARAN || '').match(/[-\s](\w+)$/) || String(r.DESCRIPTION || '').match(/-(\w+)-\w+$/);
    return m ? m[1] : '1';
  },

  // Prim O(n²) pada bidang datar lokal (cukup untuk ribuan tiang)
  mst(pts) {
    const n = pts.length, edges = [];
    if (n < 2) return edges;
    const k = Math.PI / 180, cos = Math.cos(pts[0][0] * k), R = Geo.R;
    const X = pts.map(p => p[1] * k * cos * R), Y = pts.map(p => p[0] * k * R);
    const inT = new Uint8Array(n), best = new Float64Array(n).fill(Infinity), par = new Int32Array(n).fill(-1);
    best[0] = 0;
    for (let it = 0; it < n; it++) {
      let u = -1, bu = Infinity;
      for (let i = 0; i < n; i++) if (!inT[i] && best[i] < bu) { bu = best[i]; u = i; }
      if (u < 0) break;
      inT[u] = 1;
      if (par[u] >= 0) edges.push([par[u], u]);
      for (let i = 0; i < n; i++) if (!inT[i]) {
        const d = Math.hypot(X[i] - X[u], Y[i] - Y[u]);
        if (d < best[i]) { best[i] = d; par[i] = u; }
      }
    }
    return edges;
  },

  run(o) {
    const S = this.parsed.sheets, F = new Set(o.feeders);
    const inF = r => F.has(this.fdr(r));
    const rep = { warn: [] };
    const trafoRows = (S.trafo?.rows || []).filter(inF);
    const poles = (S.tiang?.rows || []).filter(inF).map(r => ({ r, p: this.ll(r) })).filter(x => x.p);
    const tmPoles = poles.filter(x => !this.isTR(x.r)), trPoles = poles.filter(x => this.isTR(x.r));
    const apps = (S.app?.rows || []).filter(inF).map(r => ({ r, p: this.ll(r) })).filter(x => x.p);
    const jtrRows = S.jtr?.rows || [];
    // penghantar JTM tiap penyulang = kode dominan di sheet JTM (dipetakan lewat o.condMap), jika tidak ada pakai default
    const condMap = o.condMap || {};
    const feederCond = {}, condNote = [];
    (this.parsed.feeders || []).forEach(f => {
      if (!F.has(f.name)) return;
      const top = (f.cond || []).find(c => condMap[c.code]);
      feederCond[f.name] = top ? condMap[top.code] : o.tmCond;
      if (f.cond && f.cond.length) condNote.push(`${f.name}: ${f.cond.map(c => `${condMap[c.code] || 'kode ' + c.code} ${c.pct}%`).join(', ')}`);
    });
    const condFor = f => feederCond[f] || o.tmCond;

    Store.mutateNoUndo(d => {
      if (o.replace) {
        const gone = new Set(d.assets.filter(a => a.src === 'gis').map(a => a.id));
        d.assets = d.assets.filter(a => !gone.has(a.id));
        d.lines = d.lines.filter(l => !gone.has(l.from) && !gone.has(l.to));
        d.customers = [];
      }
      if (!d.assets.length && /^(Proyek Baru|Sistem \d+|Sistem baru)$/.test(d.meta.name)) d.meta.name = 'Sistem ' + (d.meta.sistem || [...F].join(' – '));
      // warna berbeda untuk tiap penyulang di sistem ini
      d.feederColors = d.feederColors || {};
      [...F].sort().forEach(f => { if (!d.feederColors[f]) { const used = new Set(Object.values(d.feederColors)); d.feederColors[f] = FEEDER_COLORS.find(c => !used.has(c)) || feederColor(f); } });
      const mk = a => Store._newAsset({ src: 'gis', ...a });

      /* 1. tiang TM (duplikat < 0,5 m digabung) */
      const tm = [];
      for (const x of tmPoles) {
        if (tm.some(t => Math.abs(t.p[0] - x.p[0]) < 1e-5 && Geo.dist(t.p, x.p) < 0.5)) { rep.dup = (rep.dup || 0) + 1; continue; }
        const r = x.r;
        const a = mk({ type: 'TIANG', code: 'TM-' + (r.OBJECTID || tm.length + 1), lat: x.p[0], lng: x.p[1], feeder: this.fdr(r),
          note: [r.KODE_KONSTRUKSI_1 && 'Konstruksi ' + r.KODE_KONSTRUKSI_1, r.UKURAN_TIANG && 'Tiang ' + r.UKURAN_TIANG].filter(Boolean).join(' · ') });
        tm.push({ p: x.p, a });
      }
      rep.tm = tm.length;

      /* 2. rekonstruksi JTM dengan MST */
      rep.jtm = 0; rep.gap = 0; rep.jtmM = 0;
      rep.split = 0;
      for (const [i, j] of this.mst(tm.map(t => t.p))) {
        const A = tm[i].a, B = tm[j].a, len = Geo.dist(tm[i].p, tm[j].p);
        if (len > o.maxEdgeM) { rep.split++; continue; } // terlalu jauh: biarkan terpisah, jangan dipaksa tersambung
        const gap = len > o.gapM;
        const fd = A.feeder === B.feeder ? A.feeder : (A.feeder || B.feeder);
        Store._newLine({ from: A.id, to: B.id, level: 'JTM', conductor: condFor(fd), feeder: fd,
          auto: true, gap, note: 'Rekonstruksi otomatis (MST)' + (gap ? ` · celah ${Math.round(len)} m — cek lapangan` : '') });
        rep.jtm++; rep.jtmM += len; if (gap) rep.gap++;
      }

      /* 3. gardu distribusi */
      const gardu = new Map(); // kode -> info
      const g = code => { code = String(code || '').trim(); if (!code) return null; if (!gardu.has(code)) gardu.set(code, { code, trafo: null, tr: [], app: [] }); return gardu.get(code); };
      trafoRows.forEach(r => { const x = g(r.LOCATION || r.DESCRIPTION); if (x) x.trafo = r; });
      trPoles.forEach(x => { const y = g(x.r.LOCATION_GARDU || String(x.r.KODE_HANTARAN || '').replace(/[-\s]\w+$/, '')); if (y) y.tr.push(x); });
      apps.forEach(x => { const y = g(x.r.LOCATION); if (y) y.app.push(x); });
      rep.gd = 0; rep.gdEst = [];
      const assetOf = new Map();
      for (const x of gardu.values()) {
        const t = x.trafo || {};
        let pos = this.ll(t), how = 'koordinat GIS';
        if (!pos && x.tr.length) {
          const firsts = x.tr.filter(p => this.poleNo(p.r) === 1);
          const base = firsts.length ? firsts : [x.tr.reduce((m, p) => this.poleNo(p.r) < this.poleNo(m.r) ? p : m)];
          pos = [base.reduce((s, p) => s + p.p[0], 0) / base.length, base.reduce((s, p) => s + p.p[1], 0) / base.length];
          how = `estimasi dari ${base.length} tiang TR awal jurusan`;
        }
        if (!pos && x.app.length) {
          pos = [x.app.reduce((s, p) => s + p.p[0], 0) / x.app.length, x.app.reduce((s, p) => s + p.p[1], 0) / x.app.length];
          how = 'estimasi dari titik tengah pelanggan (kurang akurat)';
        }
        if (!pos) { rep.warn.push(`Gardu ${x.code}: tidak ada koordinat, tiang TR, maupun pelanggan — dilewati`); continue; }
        const feeder = this.fdr(t) || this.fdr(x.tr[0]?.r || {}) || this.fdr(x.app[0]?.r || {});
        const props = {
          type: 'GD', code: x.code, name: String(t.STREETADDRESS || t.FORMATTEDADDRESS || ''), feeder,
          kva: num(String(t.KAPASITAS_TRAFO || '').replace(/[^\d.,]/g, '')), merk: String(t.MERK_TRAFO || t.MANUFACTURER || ''),
          tahun: String(t.TH_BUAT || ''), phase: t.FASA ? String(t.FASA) : '',
        };
        // gardu portal berada di tiang TM: pakai tiang TM terdekat bila dekat
        let near = null;
        for (const tp of tm) { const dd = Geo.dist(pos, tp.p); if (!near || dd < near.d) near = { t: tp, d: dd }; }
        let a;
        if (near && near.d <= o.snapGardu && near.t.a.type === 'TIANG') {
          a = near.t.a;
          Object.assign(a, props, { note: `Posisi ${how}, di tiang TM ${a.code} (±${Math.round(near.d)} m). ${a.note || ''}`.trim() });
        } else {
          a = mk({ ...props, lat: +pos[0].toFixed(7), lng: +pos[1].toFixed(7), note: `Posisi ${how}` });
          if (near && near.d > o.maxEdgeM) { rep.gdFar = (rep.gdFar || 0) + 1; near = null; }
          if (near) {
            const gap = near.d > o.gapM;
            Store._newLine({ from: near.t.a.id, to: a.id, level: 'JTM', conductor: condFor(feeder), feeder, auto: true, gap,
              note: `Sambungan gardu estimasi (${Math.round(near.d)} m)` + (gap ? ' — cek lapangan' : '') });
          }
        }
        if (how.startsWith('estimasi')) rep.gdEst.push(x.code);
        if (!props.kva) rep.noKva = (rep.noKva || 0) + 1;

        /* pelanggan & estimasi beban */
        const va = x.app.reduce((s, c) => s + (num(c.r.DAYA_KONTRAK) || 0), 0);
        a.nCust = x.app.length;
        a.connKva = +(va / 1000).toFixed(1);
        a.loadKva = va ? +(va / 1000 * o.cf).toFixed(1) : null;
        a.loadSrc = va ? `estimasi: daya tersambung × faktor kebersamaan ${o.cf}` : '';
        a.custMaxM = x.app.length ? Math.round(Math.max(...x.app.map(c => Geo.dist([a.lat, a.lng], c.p)))) : null;
        const jtr = jtrRows.filter(r => String(r.LOCATION).trim() === x.code);
        a.jtrGisM = jtr.length ? Math.round(jtr.reduce((s, r) => s + (num(r.SHAPE_LENGTH) ?? (num(r.PANJANG_HANTARAN) || 0) * 1000), 0)) : null;
        assetOf.set(x.code, a);
        rep.gd++;
      }

      /* 4. JTR dari urutan nomor tiang */
      rep.tr = 0; rep.jtr = 0;
      const kabel = (gd, jur) => {
        const r = jtrRows.find(r => String(r.LOCATION).trim() === gd && String(r.JURUSAN ?? r.SIRKUIT ?? '').trim() === String(+jur || jur));
        const s = r ? [r.JENIS_KABEL, r.UKURAN_KAWAT].filter(Boolean).join(' ') : '';
        return s || 'LVTC';
      };
      for (const x of gardu.values()) {
        const ga = assetOf.get(x.code); if (!ga) continue;
        const byJur = new Map();
        x.tr.forEach(p => { const j = this.jurusan(p.r); if (!byJur.has(j)) byJur.set(j, []); byJur.get(j).push(p); });
        for (const [jur, list] of byJur) {
          list.sort((a, b) => this.poleNo(a.r) - this.poleNo(b.r));
          const placed = [{ p: [ga.lat, ga.lng], a: ga }];
          const cond = kabel(x.code, jur);
          for (const p of list) {
            const a = mk({ type: 'TIANG', sub: 'TR', code: p.r.DESCRIPTION || `${x.code}-${jur}-${this.poleNo(p.r)}`, lat: p.p[0], lng: p.p[1],
              feeder: ga.feeder, note: ['Tiang TR jurusan ' + jur, p.r.KODE_KONSTRUKSI_1, p.r.UKURAN_TIANG && 'Tiang ' + p.r.UKURAN_TIANG].filter(Boolean).join(' · ') });
            let best = placed[0], bd = Infinity;
            for (const q of placed) { const dd = Geo.dist(q.p, p.p); if (dd < bd) { bd = dd; best = q; } }
            rep.tr++;
            if (bd > o.maxEdgeM) { rep.trFar = (rep.trFar || 0) + 1; placed.push({ p: p.p, a }); continue; } // tiang TR jauh: jangan dipaksa
            Store._newLine({ from: best.a.id, to: a.id, level: 'JTR', conductor: cond, feeder: ga.feeder, auto: true,
              note: `JTR ${x.code} jurusan ${jur} (dari urutan nomor tiang)` });
            placed.push({ p: p.p, a });
            rep.jtr++;
          }
        }
      }

      /* 5. pelanggan (APP) */
      d.customers = (d.customers || []).concat(apps.map(x => ({
        lat: x.p[0], lng: x.p[1], gd: String(x.r.LOCATION || ''), idpel: String(x.r.ID_PELANGGAN || ''),
        va: num(x.r.DAYA_KONTRAK), feeder: this.fdr(x.r),
      })));
      rep.app = apps.length;
      rep.appNoVa = apps.filter(x => !num(x.r.DAYA_KONTRAK)).length;
    }, 'import');

    const hasSrc = Store.data.assets.some(a => ASSET_TYPES[a.type]?.source);
    return [
      `Tiang TM: ${rep.tm}${rep.dup ? ` (${rep.dup} duplikat digabung)` : ''} → ${rep.jtm} ruas JTM direkonstruksi, total ${fmt.m(rep.jtmM)}`,
      condNote.length ? `Penghantar JTM per penyulang (dari sheet JTM GIS, dipakai yang dominan): ${condNote.join(' · ')}` : `Sheet JTM tidak memuat ukuran penghantar — dipakai default ${o.tmCond}`,
      rep.gap ? `⚠ ${rep.gap} ruas JTM lebih dari ${o.gapM} m (garis putus-putus merah di peta) — kemungkinan ada tiang yang belum terdata; cek lapangan` : 'Tidak ada celah JTM yang mencurigakan',
      rep.split ? `⚠ Jaringan JTM terpisah menjadi ${rep.split + 1} kelompok (jarak antar kelompok > ${o.maxEdgeM} m) — sambungkan manual bila memang satu penyulang` : '',
      rep.gdFar ? `⚠ ${rep.gdFar} gardu tidak disambungkan karena tiang TM terdekat > ${o.maxEdgeM} m — kemungkinan tiang TM-nya belum terdata` : '',
      `Gardu distribusi: ${rep.gd}` + (rep.gdEst.length ? ` (posisi ${rep.gdEst.length} gardu diestimasi dari tiang TR/pelanggan)` : ''),
      rep.noKva ? `⚠ ${rep.noKva} gardu belum ada kapasitas kVA di GIS — isi di peta agar % pembebanan trafo bisa dihitung` : '',
      `Tiang TR: ${rep.tr} → ${rep.jtr} ruas JTR` + (rep.trFar ? ` (${rep.trFar} tiang TR terlalu jauh dari gardunya, tidak disambung)` : ''),
      `Pelanggan (APP): ${rep.app}` + (rep.appNoVa ? ` (${rep.appNoVa} tanpa daya kontrak)` : '') + ` → beban gardu diestimasi = daya tersambung × ${o.cf}`,
      !hasSrc ? '👉 Langkah berikutnya: tambahkan aset PLTD / sumber di peta, lalu sambungkan ke tiang TM awal penyulang agar SLD & analisis bisa dimulai dari sumber' : '',
      ...rep.warn,
    ].filter(Boolean);
  },

  /* ---------- import banyak sistem sekaligus ---------- */
  async importAll(groups, o, log) {
    // groups: [{sistem, ulp, feeders:[...]}]
    const done = [];
    let i = 0;
    for (const g of groups) {
      i++;
      log(`(${i}/${groups.length}) ${g.sistem}: ${g.feeders.join(', ')} …`);
      await new Promise(r => setTimeout(r, 20));
      const existing = Store.systems.find(s => (s.sistem || s.name) === g.sistem);
      if (existing) await Store.switchTo(existing.id);
      else await Store.createSystem('Sistem ' + g.sistem, null, { ulp: g.ulp, sistem: g.sistem });
      const msgs = this.run({ ...o, feeders: g.feeders, replace: !!existing });
      done.push({ sistem: g.sistem, id: Store.current, msgs, assets: Store.data.assets.length });
      log(`(${i}/${groups.length}) ${g.sistem}: ${Store.data.assets.length} aset ✓`);
      await Store.flush();
    }
    return done;
  },

  /* ---------- UI di tab Data ---------- */
  condText(f) {
    if (!f.cond || !f.cond.length) return '<span class="muted">tidak ada di JTM</span>';
    const m = this.parsed.condMap || {};
    return f.cond.map((c, i) => `<span class="${i ? 'muted' : ''}">${esc(m[c.code] || 'kode ' + c.code)} ${c.pct}%</span>`).join(', ');
  },
  card() {
    return `<section class="card gis">
      <h3>Import data GIS PLN <small class="muted">(ArcGIS "Table To Excel")</small></h3>
      <p class="small muted">File .xlsx berisi sheet TRAFO_DISTRIBUSI, TIANG, APP, JTM, JTR (boleh sebagian, boleh seluruh UP3 sekaligus). Penyulang dikelompokkan otomatis
        ke <b>sistem</b> sesuai daftar ULP → Sistem → Penyulang; jaringan JTM <b>direkonstruksi</b> dari posisi tiang, posisi gardu diestimasi, beban dari daya pelanggan.</p>
      <label class="btn primary file">⬆ Pilih file GIS (.xlsx)<input type="file" accept=".xlsx,.xls" id="gisFile"></label>
      <div id="gisPrev"></div>
    </section>`;
  },
  bind(el) {
    const inp = el.querySelector('#gisFile');
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      const box = el.querySelector('#gisPrev');
      box.innerHTML = '<p class="muted" id="gisProg">Membaca file…</p>';
      try { await this.read(f, m => { const p = document.getElementById('gisProg'); if (p) p.textContent = m; }); this.renderPreview(); }
      catch (e) { console.error(e); box.innerHTML = `<div class="warnbox">Gagal membaca ${esc(f.name)}: ${esc(e.message)}</div>`; }
      inp.value = '';
    };
    if (this.parsed) this.renderPreview();
  },
  renderPreview() {
    const box = document.getElementById('gisPrev'); if (!box) return;
    const P = this.parsed, S = P.sheets;
    const tiang = S.tiang?.rows || [];
    const nTR = tiang.filter(r => this.isTR(r)).length;
    const sysOpts = (sel, ulp) => {
      const list = SistemRef.systemsOf('');
      const byUlp = {};
      list.forEach(s => (byUlp[s.ulp] = byUlp[s.ulp] || []).push(s));
      const order = Object.keys(byUlp).sort((a, b) => (a === ulp ? -1 : b === ulp ? 1 : a.localeCompare(b)));
      return `<option value="">— lewati —</option>` + order.map(u => `<optgroup label="ULP ${esc(u)}">${byUlp[u].map(s =>
        `<option value="${esc(s.sistem)}" ${s.sistem === sel ? 'selected' : ''}>${esc(s.sistem)}</option>`).join('')}</optgroup>`).join('');
    };
    const nUnk = P.feeders.filter(f => !f.sistem).length;
    box.innerHTML = `
      <div class="okbox"><b>${esc(P.file)}</b>
        <table class="kv">
          ${S.trafo ? `<tr><td>Gardu / trafo</td><td>${S.trafo.rows.length} ${S.trafo.rows.some(r => this.ll(r)) ? '' : '· <span class="warn">tanpa koordinat → diestimasi</span>'}</td></tr>` : ''}
          ${S.tiang ? `<tr><td>Tiang</td><td>${tiang.length} = ${tiang.length - nTR} TM + ${nTR} TR</td></tr>` : ''}
          ${S.app ? `<tr><td>Pelanggan (APP)</td><td>${S.app.rows.length}</td></tr>` : ''}
          ${S.jtm ? `<tr><td>JTM</td><td>${S.jtm.rows.length} baris · <span class="warn">tanpa geometri → direkonstruksi dari tiang</span></td></tr>` : ''}
          ${S.jtr ? `<tr><td>JTR</td><td>${S.jtr.rows.length} baris</td></tr>` : ''}
          ${P.feederGuessed ? `<tr><td>Tiang tanpa penyulang</td><td>${P.feederGuessed} tiang ditetapkan ke penyulang tiang terdekat (≤ 300 m)</td></tr>` : ''}
          ${P.noFeeder ? `<tr><td>Tanpa penyulang</td><td class="warn">${P.noFeeder} baris dilewati (kolom PENYULANG kosong, tak ada tiang berpenyulang di dekatnya)</td></tr>` : ''}
        </table>
      </div>
      <h4>Pengelompokan penyulang → sistem <small class="muted">(${P.feeders.length} penyulang${nUnk ? `, <span class="warn">${nUnk} belum ditetapkan</span>` : ''})</small></h4>
      <div class="wiz tbl-wrap short"><table>
        <thead><tr><th>Penyulang (GIS)</th><th>ULP</th><th>Data</th><th>Penghantar (GIS)</th><th>Sistem tujuan</th><th></th></tr></thead>
        <tbody>${P.feeders.map((f, i) => `<tr class="${!f.sistem ? 'unk' : ''}">
          <td><b>${esc(f.name)}</b></td><td>${esc(f.ulp || '?')}</td>
          <td class="small muted">${f.trafo} GD · ${f.tiang} tiang · ${f.app} APP</td>
          <td class="small" data-cond="${i}">${this.condText(f)}</td>
          <td><select data-fi="${i}">${sysOpts(f.sistem, f.ulp)}</select></td>
          <td class="small muted">${f.how === 'sama' ? '✓' : f.how === 'alias' || f.how === 'mirip' ? '≈ ' + f.how : f.how === 'tersimpan' ? '💾' : '<span class="warn">pilih</span>'}</td></tr>`).join('')}</tbody>
      </table></div>
      <p class="hint">Penyulang yang belum dikenal (kuning) silakan pilih sistemnya, atau biarkan "lewati". Pilihan disimpan dan dipakai lagi pada import berikutnya.</p>
      ${P.condCodes.length ? `<h4>Kode ukuran penghantar TM di GIS → jenis penghantar</h4>
      <p class="hint">Sheet JTM memakai kode angka (kolom UKURAN_PENGHANTAR_TM). Pastikan pemetaannya sesuai domain GIS unit Anda; pilihan disimpan.</p>
      <div class="grid3">${P.condCodes.map(c => `<label class="f"><span>Kode ${esc(c)} ${P.condMap[c] ? '' : '<span class="warn">(belum dipetakan)</span>'}</span>
        <select data-cc="${esc(c)}"><option value="">— pakai default —</option>${Store.data.conductors.map(x => `<option value="${esc(x.code)}" ${P.condMap[c] === x.code ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>`).join('')}</div>` : ''}
      <div class="grid2">
        <label class="f"><span>Penghantar JTM default (bila penyulang tak punya data JTM)</span><select id="gisCond">${MapView.condOptions('AAAC-70')}</select></label>
        <label class="f"><span>Faktor kebersamaan beban</span><input id="gisCf" value="0.4" inputmode="decimal"></label>
        <label class="f"><span>Tandai celah JTM bila > (m)</span><input id="gisGap" value="150" inputmode="decimal"></label>
        <label class="f"><span>Gardu menempel tiang TM bila ≤ (m)</span><input id="gisSnap" value="80" inputmode="decimal"></label>
        <label class="f"><span>Jangan sambung bila jarak > (m)</span><input id="gisMax" value="1500" inputmode="decimal"></label>
      </div>
      <label class="chk"><input type="radio" name="gisMode" value="split" checked> Pisah per sistem — tiap sistem jadi entri sendiri di dropdown (sistem yang sudah ada diperbarui)</label>
      <label class="chk"><input type="radio" name="gisMode" value="one"> Gabung semua ke sistem aktif "<b>${esc(Store.data.meta.name)}</b>" (hasil import GIS lama di sistem ini diganti)</label>
      <button class="btn primary" id="gisRun">Import</button>
      <div id="gisLog"></div>`;
    box.querySelectorAll('select[data-cc]').forEach(sel => sel.onchange = () => {
      P.condMap[sel.dataset.cc] = sel.value;
      DB.set('condMap', P.condMap);
      box.querySelectorAll('[data-cond]').forEach(td => { td.innerHTML = this.condText(P.feeders[+td.dataset.cond]); });
    });
    box.querySelectorAll('select[data-fi]').forEach(sel => sel.onchange = () => {
      const f = P.feeders[+sel.dataset.fi]; f.sistem = sel.value; f.how = 'tersimpan';
      sel.closest('tr').classList.toggle('unk', !f.sistem);
      DB.get('feederMap').then(m => { m = m || {}; m[f.name] = f.sistem; return DB.set('feederMap', m); });
    });
    box.querySelector('#gisRun').onclick = async () => {
      const o = {
        tmCond: box.querySelector('#gisCond').value,
        cf: num(box.querySelector('#gisCf').value) ?? 0.4, gapM: num(box.querySelector('#gisGap').value) ?? 150,
        snapGardu: num(box.querySelector('#gisSnap').value) ?? 80, maxEdgeM: num(box.querySelector('#gisMax').value) ?? 1500,
        condMap: P.condMap,
      };
      const mode = box.querySelector('input[name=gisMode]:checked').value;
      const chosen = P.feeders.filter(f => f.sistem);
      if (!chosen.length) return App.toast('Belum ada penyulang yang ditetapkan ke sistem');
      const logEl = box.querySelector('#gisLog');
      const lines = [];
      const log = m => { lines.push(m); logEl.innerHTML = `<div class="okbox"><b>Proses import</b><ul>${lines.slice(-12).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`; };
      box.querySelector('#gisRun').disabled = true;
      try {
        if (mode === 'one') {
          const msgs = this.run({ ...o, feeders: chosen.map(f => f.name), replace: true });
          this.lastLog = msgs;
          MapView.fitAll();
          logEl.innerHTML = `<div class="okbox"><b>Import selesai</b><ul>${msgs.map(m => `<li>${esc(m)}</li>`).join('')}</ul>
            <button class="btn" onclick="App.show('map')">Lihat di peta</button> <button class="btn" onclick="App.show('sld')">Lihat SLD</button></div>`;
        } else {
          const groups = new Map();
          chosen.forEach(f => { const g = groups.get(f.sistem) || { sistem: f.sistem, ulp: SistemRef.systemsOf('').find(s => s.sistem === f.sistem)?.ulp || f.ulp, feeders: [] }; g.feeders.push(f.name); groups.set(f.sistem, g); });
          const done = await this.importAll([...groups.values()], o, log);
          this.lastLog = done.map(d => `${d.sistem}: ${d.assets} aset`);
          const warnAll = done.flatMap(d => d.msgs.filter(m => m.startsWith('⚠')).map(m => `${d.sistem} — ${m}`));
          logEl.innerHTML = `<div class="okbox"><b>Import selesai: ${done.length} sistem</b>
            <ul>${done.map(d => `<li><b>${esc(d.sistem)}</b>: ${d.assets} aset — <a href="#" data-open="${d.id}">buka</a></li>`).join('')}</ul>
            ${warnAll.length ? `<details><summary>⚠ ${warnAll.length} catatan</summary><ul>${warnAll.slice(0, 60).map(m => `<li>${esc(m)}</li>`).join('')}</ul></details>` : ''}
            <p class="hint">Pilih sistem lewat dropdown ULP / Sistem di kiri atas. Tambahkan PLTD tiap sistem lalu klik "Sambung ke jaringan terdekat".</p></div>`;
          logEl.querySelectorAll('[data-open]').forEach(a => a.onclick = e => { e.preventDefault(); Store.switchTo(a.dataset.open).then(() => App.show('map')); });
          MapView.fitAll();
        }
      } catch (e) { console.error(e); logEl.innerHTML = `<div class="warnbox">Gagal import: ${esc(e.message)}</div>`; }
      box.querySelector('#gisRun').disabled = false;
    };
  },
};
