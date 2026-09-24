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

  async read(file) {
    if (!window.XLSX) throw new Error('Library Excel belum termuat (butuh internet)');
    const wb = XLSX.read(await IO.readFile(file, 'buffer'), { type: 'array' });
    const out = { file: file.name, sheets: {} };
    for (const name of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '' })
        .map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [String(k).trim().toUpperCase(), typeof v === 'string' ? v.trim() : v])));
      const k = this.kind(rows[0] ? Object.keys(rows[0]) : [], name);
      if (k && !out.sheets[k]) out.sheets[k] = { name, rows };
    }
    if (!Object.keys(out.sheets).length) throw new Error('Tidak ada sheet GIS yang dikenali (TRAFO / TIANG / APP / JTM / JTR)');
    const S = out.sheets;
    const feeders = new Map();
    const count = (rows, key) => rows.forEach(r => { const f = this.fdr(r); if (f) { const c = feeders.get(f) || { trafo: 0, tiang: 0, app: 0 }; c[key]++; feeders.set(f, c); } });
    if (S.trafo) count(S.trafo.rows, 'trafo');
    if (S.tiang) count(S.tiang.rows, 'tiang');
    if (S.app) count(S.app.rows, 'app');
    out.feeders = [...feeders.entries()].sort((a, b) => a[0].localeCompare(b[0]));
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
    const inF = r => !this.fdr(r) || F.has(this.fdr(r));
    const rep = { warn: [] };
    const trafoRows = (S.trafo?.rows || []).filter(inF);
    const poles = (S.tiang?.rows || []).filter(inF).map(r => ({ r, p: this.ll(r) })).filter(x => x.p);
    const tmPoles = poles.filter(x => !this.isTR(x.r)), trPoles = poles.filter(x => this.isTR(x.r));
    const apps = (S.app?.rows || []).filter(inF).map(r => ({ r, p: this.ll(r) })).filter(x => x.p);
    const jtrRows = S.jtr?.rows || [];

    Store.mutate(d => {
      if (o.replace) {
        const gone = new Set(d.assets.filter(a => a.src === 'gis').map(a => a.id));
        d.assets = d.assets.filter(a => !gone.has(a.id));
        d.lines = d.lines.filter(l => !gone.has(l.from) && !gone.has(l.to));
        d.customers = [];
      }
      if (!d.assets.length && d.meta.name === 'Proyek Baru') d.meta.name = 'Sistem ' + [...F].join(' – ');
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
      for (const [i, j] of this.mst(tm.map(t => t.p))) {
        const A = tm[i].a, B = tm[j].a, len = Geo.dist(tm[i].p, tm[j].p);
        const gap = len > o.gapM;
        Store._newLine({ from: A.id, to: B.id, level: 'JTM', conductor: o.tmCond, feeder: A.feeder === B.feeder ? A.feeder : (A.feeder || B.feeder),
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
          if (near) {
            const gap = near.d > o.gapM;
            Store._newLine({ from: near.t.a.id, to: a.id, level: 'JTM', conductor: o.tmCond, feeder, auto: true, gap,
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
        const r = jtrRows.find(r => String(r.LOCATION).trim() === gd && String(r.JURUSAN).trim() === String(+jur || jur));
        return r ? [r.JENIS_KABEL, r.UKURAN_KAWAT].filter(Boolean).join(' ') : 'LVTC';
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
            Store._newLine({ from: best.a.id, to: a.id, level: 'JTR', conductor: cond, feeder: ga.feeder, auto: true,
              note: `JTR ${x.code} jurusan ${jur} (dari urutan nomor tiang)` });
            placed.push({ p: p.p, a });
            rep.tr++; rep.jtr++;
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
      rep.gap ? `⚠ ${rep.gap} ruas JTM lebih dari ${o.gapM} m (garis putus-putus merah di peta) — kemungkinan ada tiang yang belum terdata; cek lapangan` : 'Tidak ada celah JTM yang mencurigakan',
      `Gardu distribusi: ${rep.gd}` + (rep.gdEst.length ? ` (posisi ${rep.gdEst.length} gardu diestimasi dari tiang TR/pelanggan)` : ''),
      rep.noKva ? `⚠ ${rep.noKva} gardu belum ada kapasitas kVA di GIS — isi di peta agar % pembebanan trafo bisa dihitung` : '',
      `Tiang TR: ${rep.tr} → ${rep.jtr} ruas JTR`,
      `Pelanggan (APP): ${rep.app}` + (rep.appNoVa ? ` (${rep.appNoVa} tanpa daya kontrak)` : '') + ` → beban gardu diestimasi = daya tersambung × ${o.cf}`,
      !hasSrc ? '👉 Langkah berikutnya: tambahkan aset PLTD / sumber di peta, lalu sambungkan ke tiang TM awal penyulang agar SLD & analisis bisa dimulai dari sumber' : '',
      ...rep.warn,
    ].filter(Boolean);
  },

  /* ---------- UI di tab Data ---------- */
  card() {
    return `<section class="card gis">
      <h3>Import data GIS PLN <small class="muted">(ArcGIS "Table To Excel")</small></h3>
      <p class="small muted">File .xlsx berisi sheet TRAFO_DISTRIBUSI, TIANG, APP, JTM, JTR (boleh sebagian). Jaringan JTM yang belum punya garis akan
        <b>direkonstruksi otomatis</b> dari posisi tiang, posisi gardu diestimasi dari tiang TR nomor 01, dan beban dari daya pelanggan.</p>
      <label class="btn primary file">⬆ Pilih file GIS (.xlsx)<input type="file" accept=".xlsx,.xls" id="gisFile"></label>
      <div id="gisPrev"></div>
    </section>`;
  },
  bind(el) {
    const inp = el.querySelector('#gisFile');
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      const box = el.querySelector('#gisPrev');
      box.innerHTML = '<p class="muted">Membaca file…</p>';
      try { await this.read(f); this.renderPreview(); }
      catch (e) { box.innerHTML = `<div class="warnbox">Gagal membaca ${esc(f.name)}: ${esc(e.message)}</div>`; }
      inp.value = '';
    };
    if (this.parsed) this.renderPreview();
  },
  renderPreview() {
    const box = document.getElementById('gisPrev'); if (!box) return;
    const P = this.parsed, S = P.sheets;
    const tiang = S.tiang?.rows || [];
    const nTR = tiang.filter(r => this.isTR(r)).length;
    const hasOld = Store.data.assets.some(a => a.src === 'gis');
    box.innerHTML = `
      <div class="okbox"><b>${esc(P.file)}</b>
        <table class="kv">
          ${S.trafo ? `<tr><td>Gardu / trafo</td><td>${S.trafo.rows.length} (sheet ${esc(S.trafo.name)}) ${S.trafo.rows.some(r => this.ll(r)) ? '' : '· <span class="warn">tanpa koordinat → diestimasi</span>'}</td></tr>` : ''}
          ${S.tiang ? `<tr><td>Tiang</td><td>${tiang.length} = ${tiang.length - nTR} TM + ${nTR} TR</td></tr>` : ''}
          ${S.app ? `<tr><td>Pelanggan (APP)</td><td>${S.app.rows.length}</td></tr>` : ''}
          ${S.jtm ? `<tr><td>JTM</td><td>${S.jtm.rows.length} baris · <span class="warn">tanpa geometri → direkonstruksi dari tiang</span></td></tr>` : ''}
          ${S.jtr ? `<tr><td>JTR</td><td>${S.jtr.rows.length} baris (dipakai untuk jenis kabel & panjang per jurusan)</td></tr>` : ''}
        </table>
      </div>
      <h4>Penyulang yang diimport</h4>
      <div class="chips">${P.feeders.map(([f, c]) => `<label class="chip sel"><input type="checkbox" class="gisF" value="${esc(f)}" checked> ${esc(f)} <small class="muted">${c.trafo} GD · ${c.tiang} tiang · ${c.app} APP</small></label>`).join('')}</div>
      <div class="grid2">
        <label class="f"><span>Penghantar JTM (default)</span><select id="gisCond">${MapView.condOptions('AAAC-70')}</select></label>
        <label class="f"><span>Faktor kebersamaan beban</span><input id="gisCf" value="0.4" inputmode="decimal"></label>
        <label class="f"><span>Tandai celah JTM bila > (m)</span><input id="gisGap" value="150" inputmode="decimal"></label>
        <label class="f"><span>Gardu menempel tiang TM bila ≤ (m)</span><input id="gisSnap" value="80" inputmode="decimal"></label>
      </div>
      ${hasOld ? '<label class="chk"><input type="checkbox" id="gisReplace" checked> Ganti hasil import GIS sebelumnya (hindari data ganda)</label>' : ''}
      <p class="hint">Faktor kebersamaan: beban gardu ≈ total daya kontrak pelanggan × faktor ini (umumnya 0,3–0,5 untuk rumah tangga). Ganti dengan hasil ukur beban bila ada.</p>
      <button class="btn primary" id="gisRun">Import & rekonstruksi jaringan</button>
      <div id="gisLog"></div>`;
    box.querySelector('#gisRun').onclick = () => {
      const feeders = [...box.querySelectorAll('.gisF:checked')].map(c => c.value);
      if (!feeders.length) return App.toast('Pilih minimal satu penyulang');
      const o = {
        feeders, tmCond: box.querySelector('#gisCond').value,
        cf: num(box.querySelector('#gisCf').value) ?? 0.4, gapM: num(box.querySelector('#gisGap').value) ?? 150,
        snapGardu: num(box.querySelector('#gisSnap').value) ?? 80, replace: !!box.querySelector('#gisReplace')?.checked,
      };
      App.toast('Memproses…');
      setTimeout(() => {
        try {
          const msgs = this.run(o);
          this.lastLog = msgs;
          MapView.fitAll();
          const log = document.getElementById('gisLog');
          if (log) log.innerHTML = `<div class="okbox"><b>Import selesai</b><ul>${msgs.map(m => `<li>${esc(m)}</li>`).join('')}</ul>
            <button class="btn" onclick="App.show('map')">Lihat di peta</button> <button class="btn" onclick="App.show('sld')">Lihat SLD</button></div>`;
        } catch (e) { console.error(e); App.toast('Gagal import: ' + e.message); }
      }, 30);
    };
    if (this.lastLog) box.querySelector('#gisLog').innerHTML = `<div class="okbox"><b>Import terakhir</b><ul>${this.lastLog.map(m => `<li>${esc(m)}</li>`).join('')}</ul></div>`;
  },
};
