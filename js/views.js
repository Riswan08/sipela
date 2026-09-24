'use strict';
/* ============================================================
 * Views: tabel aset, tabel saluran, analisis & jarak, data/pengaturan
 * ============================================================ */

function sortRows(rows, key, dir) {
  return rows.sort((a, b) => {
    const x = a[key], y = b[key];
    if (typeof x === 'number' || typeof y === 'number') return ((x ?? -Infinity) - (y ?? -Infinity)) * dir;
    return String(x ?? '').localeCompare(String(y ?? ''), 'id', { numeric: true }) * dir;
  });
}
function tableHtml(cols, rows, sort, rowAttr = () => '') {
  return `<table class="tbl"><thead><tr>${cols.map(c => `<th data-sort="${c.k}" class="${c.num ? 'num' : ''}">${c.t}${sort.key === c.k ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr ${rowAttr(r)}>${cols.map(c => `<td class="${c.num ? 'num' : ''}">${c.f ? c.f(r) : esc(r[c.k])}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${cols.length}" class="muted center">Tidak ada data</td></tr>`}</tbody></table>`;
}
function bindSort(el, sort, rerender) {
  el.querySelectorAll('th[data-sort]').forEach(th => th.onclick = () => {
    sort.dir = sort.key === th.dataset.sort ? -sort.dir : 1; sort.key = th.dataset.sort; rerender();
  });
}

const AssetsView = {
  sort: { key: 'code', dir: 1 }, q: '', type: '', feeder: '',
  render() {
    const el = document.getElementById('view-assets');
    const T = ASSET_TYPES;
    const deg = new Map();
    Store.data.lines.forEach(l => { deg.set(l.from, (deg.get(l.from) || 0) + 1); deg.set(l.to, (deg.get(l.to) || 0) + 1); });
    let rows = Store.data.assets.map(a => ({ ...a, typeLabel: T[a.type]?.short, kvaN: num(a.kva), lpN: num(a.loadPct), loadKvaN: num(a.loadKva), nLines: deg.get(a.id) || 0 }));
    const q = this.q.toLowerCase();
    rows = rows.filter(r => (!this.type || r.type === this.type) && (!this.feeder || r.feeder === this.feeder) &&
      (!q || [r.code, r.name, r.feeder, r.note, r.merk].some(v => String(v || '').toLowerCase().includes(q))));
    sortRows(rows, this.sort.key, this.sort.dir);
    const cap = rows.reduce((s, r) => s + (T[r.type]?.load ? r.kvaN || 0 : 0), 0);
    const cols = [
      { k: 'type', t: 'Jenis', f: r => `<span class="chip" style="--c:${T[r.type]?.color}"><i></i>${esc(r.typeLabel)}</span>` },
      { k: 'code', t: 'Kode', f: r => `<b>${esc(r.code)}</b>` },
      { k: 'name', t: 'Nama / Lokasi' },
      { k: 'feeder', t: 'Penyulang' },
      { k: 'kvaN', t: 'kVA', num: 1, f: r => fmt.n(r.kvaN, 0) },
      { k: 'nCust', t: 'Plg', num: 1, f: r => r.nCust != null ? fmt.n(r.nCust, 0) : '' },
      { k: 'loadKvaN', t: 'Beban kVA', num: 1, f: r => r.loadKvaN != null ? fmt.n(r.loadKvaN, 1) : '' },
      { k: 'lpN', t: 'Beban %', num: 1, f: r => r.lpN == null ? '' : `<span class="${r.lpN > 100 ? 'bad' : r.lpN > 80 ? 'warn' : ''}">${fmt.n(r.lpN, 0)}</span>` },
      { k: 'status', t: 'Status', f: r => T[r.type]?.sw ? (r.status === 'NO' ? '<span class="bad">NO</span>' : 'NC') : '' },
      { k: 'lat', t: 'Lat', num: 1, f: r => fmt.n(r.lat, 6) },
      { k: 'lng', t: 'Lng', num: 1, f: r => fmt.n(r.lng, 6) },
      { k: 'nLines', t: 'Sambungan', num: 1, f: r => r.nLines ? r.nLines : '<span class="bad">0</span>' },
    ];
    el.innerHTML = `
      <div class="toolbar">
        <input type="search" id="aq" placeholder="Cari kode, nama, merk…" value="${esc(this.q)}">
        <select id="atype"><option value="">Semua jenis</option>${Object.entries(T).map(([k, t]) => `<option value="${k}" ${k === this.type ? 'selected' : ''}>${t.label}</option>`).join('')}</select>
        <select id="afeeder"><option value="">Semua penyulang</option>${Store.feeders().map(f => `<option ${f === this.feeder ? 'selected' : ''}>${esc(f)}</option>`).join('')}</select>
        <span class="spacer"></span>
        <span class="muted">${rows.length} aset · ${fmt.n(cap, 0)} kVA</span>
        <button class="btn" id="aCsv">⬇ CSV</button>
      </div>
      <div class="tbl-wrap">${tableHtml(cols, rows, this.sort, r => `data-id="${r.id}"`)}</div>
      <p class="hint pad">Klik baris untuk membuka di peta. Aset dengan sambungan <span class="bad">0</span> belum terhubung ke jaringan.</p>`;
    el.querySelector('#aq').oninput = e => { this.q = e.target.value; this.renderKeepFocus('aq'); };
    el.querySelector('#atype').onchange = e => { this.type = e.target.value; this.render(); };
    el.querySelector('#afeeder').onchange = e => { this.feeder = e.target.value; this.render(); };
    el.querySelector('#aCsv').onclick = () => IO.download(`aset_${IO.stamp()}.csv`, IO.toCSV(IO.assetRows(), ASSET_COLS), 'text/csv');
    el.querySelectorAll('tbody tr[data-id]').forEach(tr => tr.onclick = () => App.focusAsset(tr.dataset.id));
    bindSort(el, this.sort, () => this.render());
  },
  renderKeepFocus(id) {
    const pos = document.getElementById(id).selectionStart;
    this.render();
    const i = document.getElementById(id); i.focus(); i.setSelectionRange(pos, pos);
  },
};

const LinesView = {
  sort: { key: 'feeder', dir: 1 }, q: '', feeder: '',
  render() {
    const el = document.getElementById('view-lines');
    let rows = Store.data.lines.map(l => ({
      id: l.id, from: Store.asset(l.from)?.code, to: Store.asset(l.to)?.code, feeder: l.feeder, level: l.level,
      conductor: l.conductor, len: Store.lineLength(l), geo: Store.lineGeoLength(l), manual: num(l.lengthM) > 0, note: l.note,
    }));
    const q = this.q.toLowerCase();
    rows = rows.filter(r => (!this.feeder || r.feeder === this.feeder) && (!q || [r.from, r.to, r.conductor, r.note].some(v => String(v || '').toLowerCase().includes(q))));
    sortRows(rows, this.sort.key, this.sort.dir);
    // rekap per penyulang & penghantar
    const rekap = {};
    rows.forEach(r => { const k = (r.feeder || '(tanpa)') + '|' + r.level + '|' + r.conductor; rekap[k] = (rekap[k] || 0) + r.len; });
    const cols = [
      { k: 'from', t: 'Dari', f: r => `<b>${esc(r.from)}</b>` }, { k: 'to', t: 'Ke', f: r => `<b>${esc(r.to)}</b>` },
      { k: 'feeder', t: 'Penyulang', f: r => r.feeder ? `<span class="sw" style="background:${feederColor(r.feeder)}"></span>${esc(r.feeder)}` : '' },
      { k: 'level', t: 'Level' }, { k: 'conductor', t: 'Penghantar', f: r => Store.conductor(r.conductor) || r.level === 'JTR' ? esc(r.conductor) : `<span class="warn">${esc(r.conductor)} ?</span>` },
      { k: 'len', t: 'Panjang (m)', num: 1, f: r => fmt.n(r.len, 0) + (r.manual ? ' <small class="muted">ukur</small>' : '') },
      { k: 'geo', t: 'Di peta (m)', num: 1, f: r => fmt.n(r.geo, 0) },
      { k: 'note', t: 'Keterangan' },
    ];
    el.innerHTML = `
      <div class="toolbar">
        <input type="search" id="lq" placeholder="Cari kode / penghantar…" value="${esc(this.q)}">
        <select id="lfeeder"><option value="">Semua penyulang</option>${Store.feeders().map(f => `<option ${f === this.feeder ? 'selected' : ''}>${esc(f)}</option>`).join('')}</select>
        <span class="spacer"></span>
        <span class="muted">${rows.length} ruas · ${fmt.m(rows.reduce((s, r) => s + r.len, 0))}</span>
        <button class="btn" id="lCsv">⬇ CSV</button>
      </div>
      <details class="rekap"><summary>Rekap panjang per penyulang & penghantar</summary>
        <table class="tbl compact"><thead><tr><th>Penyulang</th><th>Level</th><th>Penghantar</th><th class="num">Panjang (kms)</th></tr></thead>
        <tbody>${Object.entries(rekap).sort().map(([k, v]) => { const [f, lv, c] = k.split('|'); return `<tr><td>${esc(f)}</td><td>${lv}</td><td>${esc(c)}</td><td class="num">${fmt.n(v / 1000, 3)}</td></tr>`; }).join('')}</tbody></table>
      </details>
      <div class="tbl-wrap">${tableHtml(cols, rows, this.sort, r => `data-id="${r.id}"`)}</div>`;
    el.querySelector('#lq').oninput = e => { this.q = e.target.value; AssetsView.renderKeepFocus.call(this, 'lq'); };
    el.querySelector('#lfeeder').onchange = e => { this.feeder = e.target.value; this.render(); };
    el.querySelector('#lCsv').onclick = () => IO.download(`saluran_${IO.stamp()}.csv`, IO.toCSV(IO.lineRows(), LINE_COLS), 'text/csv');
    el.querySelectorAll('tbody tr[data-id]').forEach(tr => tr.onclick = () => { App.show('map'); MapView.select('line', tr.dataset.id, true); });
    bindSort(el, this.sort, () => this.render());
  },
};

const AnalysisView = {
  rootId: null, result: null, distA: '', distB: '', fromCode: '', fromType: 'GD',
  sources() {
    const order = ['PLTD', 'GI', 'GH', 'REC', 'LBS'];
    return Store.data.assets.filter(a => order.includes(a.type)).sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || String(a.code).localeCompare(b.code));
  },
  render() {
    const el = document.getElementById('view-analysis');
    const P = Store.data.params;
    const src = this.sources();
    if (!this.rootId || !Store.asset(this.rootId)) this.rootId = src[0]?.id || null;
    el.innerHTML = `
      <div class="cards2">
        <section class="card">
          <h3>Analisis penyulang: beban, drop tegangan & susut</h3>
          <div class="toolbar wrap">
            <label class="f"><span>Sumber</span><select id="anRoot">${src.map(a => `<option value="${a.id}" ${a.id === this.rootId ? 'selected' : ''}>${esc(a.code)} — ${esc(ASSET_TYPES[a.type].label)}</option>`).join('') || '<option>(belum ada GI/GH)</option>'}</select></label>
            <label class="f sm"><span>Tegangan (kV)</span><input data-p="kv" value="${P.kv}"></label>
            <label class="f sm"><span>cos φ</span><input data-p="pf" value="${P.pf}"></label>
            <label class="f sm"><span>Beban default %</span><input data-p="loadPct" value="${P.loadPct}"></label>
            <label class="f sm"><span>Batas drop %</span><input data-p="dropLimit" value="${P.dropLimit}"></label>
            <button class="btn primary" id="anRun">Hitung</button>
          </div>
          <label class="chk"><input type="checkbox" id="anPoles" ${this.showPoles ? 'checked' : ''}> Tampilkan tiang di tabel hasil</label>
          <div id="anOut"><p class="hint">Pilih sumber (PLTD/GI/GH/Recloser) lalu klik <b>Hitung</b>. Perhitungan hanya pada JTM dan berhenti di saklar berstatus NO.</p></div>
        </section>
        <section class="card">
          <h3>Jarak antar aset</h3>
          <div class="toolbar wrap">
            <label class="f"><span>Dari</span><input id="dA" list="dlAssets" value="${esc(this.distA)}" placeholder="kode aset"></label>
            <label class="f"><span>Ke</span><input id="dB" list="dlAssets" value="${esc(this.distB)}" placeholder="kode aset"></label>
            <button class="btn primary" id="dRun">Hitung jarak</button>
          </div>
          <div id="dOut"></div>
          <h3 class="mt">Jarak dari satu aset ke semua aset sejenis</h3>
          <div class="toolbar wrap">
            <label class="f"><span>Dari</span><input id="fA" list="dlAssets" value="${esc(this.fromCode)}" placeholder="kode aset"></label>
            <label class="f"><span>Ke jenis</span><select id="fT">${Object.entries(ASSET_TYPES).map(([k, t]) => `<option value="${k}" ${k === this.fromType ? 'selected' : ''}>${t.label}</option>`).join('')}</select></label>
            <button class="btn primary" id="fRun">Tampilkan</button>
          </div>
          <div id="fOut"></div>
        </section>
      </div>`;
    el.querySelector('#anRoot').onchange = e => { this.rootId = e.target.value; };
    el.querySelectorAll('[data-p]').forEach(i => i.onchange = () => Store.mutate(() => { Store.data.params[i.dataset.p] = num(i.value) ?? Store.data.params[i.dataset.p]; }, 'params'));
    el.querySelector('#anRun').onclick = () => this.run();
    el.querySelector('#anPoles').onchange = e => { this.showPoles = e.target.checked; if (this.result) this.run(); };
    el.querySelector('#dRun').onclick = () => { this.distA = el.querySelector('#dA').value; this.distB = el.querySelector('#dB').value; this.dist(); };
    el.querySelector('#fRun').onclick = () => { this.fromCode = el.querySelector('#fA').value; this.fromType = el.querySelector('#fT').value; this.distAll(); };
    if (this.result) this.run();
    if (this.distA && this.distB) this.dist(true);
    if (this.fromCode) this.distAll();
  },

  run() {
    const r = this.result = Net.analyze(this.rootId);
    const out = document.getElementById('anOut');
    if (!r) { out.innerHTML = '<p class="bad">Sumber tidak valid.</p>'; return; }
    const S = r.summary, P = Store.data.params, lim = num(P.dropLimit) ?? 5;
    const rows = r.nodes.filter(n => n.parent);
    const shown = this.showPoles ? rows : rows.filter(n => n.asset.type !== 'TIANG');
    const col = v => v > lim ? 'bad' : v > lim * 0.8 ? 'warn' : 'ok';
    out.innerHTML = `
      <div class="stats">
        <div><span>Panjang jaringan</span><b>${fmt.n(S.totalKm, 2)} kms</b></div>
        <div><span>Trafo / PTM</span><b>${S.trafo}</b></div>
        <div><span>Kapasitas</span><b>${fmt.n(S.cap, 0)} kVA</b></div>
        <div><span>Estimasi beban</span><b>${fmt.n(S.load, 0)} kVA</b><small>${fmt.n(S.I, 1)} A di sumber</small></div>
        <div class="${col(S.maxDrop.dropPct)}"><span>Drop terbesar</span><b>${fmt.n(S.maxDrop.dropPct, 2)} %</b><small>di ${esc(S.maxDrop.asset.code)}</small></div>
        <div><span>Titik terjauh</span><b>${fmt.m(S.far.dist)}</b><small>${esc(S.far.asset.code)}</small></div>
        <div><span>Susut (estimasi)</span><b>${fmt.n(S.lossKW, 1)} kW</b><small>${fmt.n(S.lossPct, 2)} % dari beban</small></div>
        <div class="${S.overDrop || S.overLoad ? 'bad' : 'ok'}"><span>Pelanggaran</span><b>${S.overDrop} drop · ${S.overLoad} KHA</b></div>
      </div>
      ${r.warn.length ? `<details class="warnbox"><summary>⚠ ${r.warn.length} catatan data</summary><ul>${r.warn.slice(0, 50).map(w => `<li>${esc(w)}</li>`).join('')}</ul></details>` : ''}
      <div class="toolbar"><button class="btn" id="anMap">Warnai drop tegangan di peta</button><button class="btn" id="anCsv">⬇ CSV hasil</button><span class="spacer"></span><span class="muted small">Metode: beban terpusat di gardu, ΔV = √3·I·(R cosφ + X sinφ)·L</span></div>
      <div class="tbl-wrap short">${tableHtml([
        { k: 'code', t: 'Aset', f: n => `<b>${esc(n.asset.code)}</b> <small class="muted">${esc(ASSET_TYPES[n.asset.type]?.short)}</small>` },
        { k: 'dist', t: 'Jarak dr sumber', num: 1, f: n => fmt.m(n.dist) },
        { k: 'cond', t: 'Penghantar', f: n => esc(n.cond) },
        { k: 'load', t: 'Beban hilir (kVA)', num: 1, f: n => fmt.n(n.load, 0) },
        { k: 'I', t: 'Arus (A)', num: 1, f: n => fmt.n(n.I, 1) },
        { k: 'loadingPct', t: '% KHA', num: 1, f: n => `<span class="${n.loadingPct > 100 ? 'bad' : n.loadingPct > 80 ? 'warn' : ''}">${fmt.n(n.loadingPct, 1)}</span>` },
        { k: 'dropPct', t: 'Drop kumulatif %', num: 1, f: n => `<span class="${col(n.dropPct)}">${fmt.n(n.dropPct, 3)}</span>` },
        { k: 'segLossKW', t: 'Susut (kW)', num: 1, f: n => fmt.n(n.segLossKW, 2) },
      ], shown, {}, n => `data-id="${n.id}"`)}</div>
      ${shown.length < rows.length ? `<p class="hint">${rows.length - shown.length} tiang disembunyikan dari tabel (tetap dihitung).</p>` : ''}`;
    out.querySelectorAll('tbody tr[data-id]').forEach(tr => tr.onclick = () => App.focusAsset(tr.dataset.id));
    out.querySelector('#anMap').onclick = () => {
      const byLine = new Map(rows.map(n => [n.line.id, n.dropPct]));
      App.show('map');
      MapView.highlight(rows.map(n => n.line), null, true, l => { const v = byLine.get(l.id) / lim; return v > 1 ? '#dc2626' : v > 0.8 ? '#f59e0b' : v > 0.5 ? '#facc15' : '#22c55e'; });
      App.toast('Hijau < 50% batas · kuning · oranye > 80% · merah melebihi batas drop');
    };
    out.querySelector('#anCsv').onclick = () => IO.download(`analisis_${Store.asset(this.rootId).code}_${IO.stamp()}.csv`, IO.toCSV(rows.map(n => ({
      aset: n.asset.code, jenis: n.asset.type, nama: n.asset.name, dari: Store.asset(n.parent)?.code, jarak_sumber_m: Math.round(n.dist),
      penghantar: n.cond, panjang_seksi_m: Math.round(Store.lineLength(n.line)), kva_terpasang: num(n.asset.kva), beban_hilir_kva: +n.load.toFixed(1),
      arus_a: +n.I.toFixed(2), persen_kha: n.loadingPct == null ? '' : +n.loadingPct.toFixed(1), drop_persen: +n.dropPct.toFixed(3), susut_kw: +n.segLossKW.toFixed(3),
    })), ['aset', 'jenis', 'nama', 'dari', 'jarak_sumber_m', 'penghantar', 'panjang_seksi_m', 'kva_terpasang', 'beban_hilir_kva', 'arus_a', 'persen_kha', 'drop_persen', 'susut_kw']), 'text/csv');
  },

  dist(silent) {
    const out = document.getElementById('dOut');
    const a = Store.byCode(this.distA), b = Store.byCode(this.distB);
    if (!a || !b) { out.innerHTML = `<p class="bad">Kode ${!a ? esc(this.distA) : esc(this.distB)} tidak ditemukan.</p>`; return; }
    const air = Geo.dist([a.lat, a.lng], [b.lat, b.lng]);
    const p = Net.path(a.id, b.id);
    out.innerHTML = `
      <div class="stats">
        <div><span>Garis lurus</span><b>${fmt.m(air)}</b></div>
        <div><span>Via jaringan</span><b>${p ? fmt.m(p.length) : '—'}</b><small>${p ? p.lines.length + ' ruas' : 'tidak tersambung'}</small></div>
        ${p ? `<div><span>Rasio jalur/lurus</span><b>${fmt.n(p.length / Math.max(air, 1), 2)}×</b></div>` : ''}
      </div>
      ${p ? `<p class="route small">${p.nodes.map(id => esc(Store.asset(id).code)).join(' → ')}</p><button class="btn" id="dMap">Tampilkan jalur di peta</button>` : ''}`;
    const btn = out.querySelector('#dMap');
    if (btn) btn.onclick = () => { App.show('map'); MapView.highlight(p.lines); };
    if (!silent && p) MapView.highlight(p.lines, '#facc15', false);
  },

  distAll() {
    const out = document.getElementById('fOut');
    const a = Store.byCode(this.fromCode);
    if (!a) { out.innerHTML = `<p class="bad">Kode tidak ditemukan.</p>`; return; }
    const { dist } = Net.shortest(a.id);
    const rows = Store.data.assets.filter(b => b.type === this.fromType && b.id !== a.id).map(b => ({
      id: b.id, code: b.code, name: b.name, feeder: b.feeder, air: Geo.dist([a.lat, a.lng], [b.lat, b.lng]), net: dist.get(b.id) ?? null,
    })).sort((x, y) => (x.net ?? Infinity) - (y.net ?? Infinity) || x.air - y.air);
    out.innerHTML = `<div class="tbl-wrap short">${tableHtml([
      { k: 'code', t: 'Kode', f: r => `<b>${esc(r.code)}</b>` }, { k: 'name', t: 'Nama' }, { k: 'feeder', t: 'Penyulang' },
      { k: 'net', t: 'Via jaringan', num: 1, f: r => r.net == null ? '<span class="muted">tdk tersambung</span>' : fmt.m(r.net) },
      { k: 'air', t: 'Garis lurus', num: 1, f: r => fmt.m(r.air) },
    ], rows, {}, r => `data-code="${esc(r.code)}"`)}</div>
    <div class="toolbar"><button class="btn" id="fCsv">⬇ CSV</button><span class="muted small">Klik baris untuk melihat jalurnya.</span></div>`;
    out.querySelectorAll('tbody tr[data-code]').forEach(tr => tr.onclick = () => {
      this.distA = a.code; this.distB = tr.dataset.code;
      document.getElementById('dA').value = this.distA; document.getElementById('dB').value = this.distB; this.dist();
      document.getElementById('dOut').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    out.querySelector('#fCsv').onclick = () => IO.download(`jarak_dari_${a.code}_${IO.stamp()}.csv`, IO.toCSV(rows.map(r => ({ dari: a.code, ke: r.code, nama: r.name, penyulang: r.feeder, jarak_jaringan_m: r.net == null ? '' : Math.round(r.net), jarak_lurus_m: Math.round(r.air) })), ['dari', 'ke', 'nama', 'penyulang', 'jarak_jaringan_m', 'jarak_lurus_m']), 'text/csv');
  },
};

const DataView = {
  render() {
    const el = document.getElementById('view-data');
    const d = Store.data, P = d.params;
    el.innerHTML = `
      <div class="cards2">
        ${GisImport.card()}
        <section class="card">
          <h3>Sistem</h3>
          <ul class="syslist">${Store.systems.map(s => `<li class="${s.id === Store.current ? 'cur' : ''}">
            <span>${s.id === Store.current ? '▶ ' : ''}${esc(s.name)}</span>
            <span class="meta">${s.assets ?? 0} aset · ${s.lines ?? 0} saluran · ${fmt.date(s.updated)}</span>
            ${s.id !== Store.current ? `<button class="btn sm" data-sys="${s.id}">Buka</button>` : '<span class="muted small">aktif</span>'}</li>`).join('')}</ul>
          <button class="btn" id="bSysNew">＋ Sistem baru</button>
          <p class="hint">Tiap sistem (mis. Buano, Kairatu, Masohi) disimpan terpisah. Pindah sistem lewat menu di kiri atas.</p>
          <h4>Hapus satu sistem</h4>
          <div class="toolbar wrap" style="padding:0">
            <label class="f"><span>Pilih sistem yang dihapus</span><select id="sysDelSel">${Store.systems.map(s => `<option value="${s.id}">${esc(s.name)} (${s.assets ?? 0} aset)</option>`).join('')}</select></label>
            <button class="btn danger" id="bSysDel">🗑 Hapus sistem ini</button>
          </div>
          <p class="hint">Hanya sistem yang dipilih yang dihapus; sistem lain tidak tersentuh. Tidak bisa di-undo — unduh backup dulu bila ragu.</p>
          <h3 class="mt">Sistem aktif</h3>
          <label class="f"><span>Nama sistem</span><input id="pName" value="${esc(d.meta.name)}"></label>
          <p class="muted small">Dibuat ${fmt.date(d.meta.created)} · terakhir disimpan ${fmt.date(d.meta.updated)} · ${d.assets.length} aset, ${d.lines.length} saluran.
          Data tersimpan otomatis di browser ini. <b>Rutin unduh backup</b> agar aman & bisa dipindah ke perangkat lain.</p>
          <div class="btnrow">
            <button class="btn primary" id="bJson">⬇ Backup (.json)</button>
            <label class="btn file">⬆ Pulihkan backup<input type="file" accept=".json" data-imp="json"></label>
          </div>

          <h3 class="mt">Import data</h3>
          <div class="imp">
            <div><b>Excel (.xlsx)</b><p class="small muted">Sheet "Aset" dan "Saluran". Kolom fleksibel (kode, jenis, lat, lng, kva, penyulang…). Kode yang sama akan diperbarui.</p>
              <label class="btn file">⬆ Pilih Excel<input type="file" accept=".xlsx,.xls" data-imp="xlsx"></label> <button class="btn" id="bTpl">⬇ Template</button></div>
            <div><b>CSV</b><p class="small muted">Data aset atau saluran (dideteksi dari header). Pemisah ; atau , otomatis.</p>
              <label class="btn file">⬆ Pilih CSV<input type="file" accept=".csv,.txt" data-imp="csv"></label></div>
            <div><b>Google Earth (.kml / .kmz)</b><p class="small muted">Titik → aset (jenis ditebak dari nama/folder), garis → saluran. Ujung garis di-snap ke aset ≤ ${P.snapM} m, jika tidak ada dibuat tiang.</p>
              <label class="f"><span>Jenis bila tidak dikenali</span><select id="kmlType">${Object.entries(ASSET_TYPES).map(([k, t]) => `<option value="${k}" ${k === 'TIANG' ? 'selected' : ''}>${t.label}</option>`).join('')}</select></label>
              <label class="btn file">⬆ Pilih KML/KMZ<input type="file" accept=".kml,.kmz" data-imp="kml"></label></div>
          </div>
          <div id="impLog"></div>

          <h3 class="mt">Ekspor</h3>
          <div class="btnrow">
            <button class="btn" id="bXlsx">⬇ Excel (.xlsx)</button>
            <button class="btn" id="bKml">⬇ Google Earth (.kml)</button>
            <button class="btn" id="bGeo">⬇ GeoJSON (QGIS/ArcGIS)</button>
          </div>

          <h3 class="mt">Lainnya</h3>
          <div class="btnrow">
            <button class="btn danger" id="bClear">Kosongkan isi sistem "${esc(d.meta.name)}"</button>
          </div>
          <p class="hint">Menghapus aset, saluran & pelanggan di sistem aktif saja (sistemnya tetap ada, bisa di-undo).</p>
        </section>

        <section class="card">
          <h3>Tabel penghantar (impedansi)</h3>
          <p class="small muted">Nilai default adalah pendekatan umum — <b>sesuaikan dengan SPLN/data pabrikan</b> sebelum dipakai untuk keputusan.</p>
          <div class="tbl-wrap"><table class="tbl compact edit">
            <thead><tr><th>Kode</th><th>Nama</th><th class="num">R (Ω/km)</th><th class="num">X (Ω/km)</th><th class="num">KHA (A)</th><th></th></tr></thead>
            <tbody>${d.conductors.map((c, i) => `<tr>
              <td><input data-c="${i}" data-f="code" value="${esc(c.code)}"></td><td><input data-c="${i}" data-f="name" value="${esc(c.name)}"></td>
              <td><input data-c="${i}" data-f="r" data-num value="${c.r}"></td><td><input data-c="${i}" data-f="x" data-num value="${c.x}"></td>
              <td><input data-c="${i}" data-f="kha" data-num value="${c.kha ?? ''}"></td><td><button class="btn sm danger" data-cdel="${i}">✕</button></td></tr>`).join('')}</tbody>
          </table></div>
          <button class="btn" id="bCadd">+ Tambah penghantar</button>

          <h3 class="mt">Kop gambar SLD</h3>
          <div class="grid3">
            <label class="f"><span>UIW</span><input data-ps="uiw" value="${esc(P.uiw)}"></label>
            <label class="f"><span>UP3</span><input data-ps="up3" value="${esc(P.up3)}"></label>
            <label class="f"><span>Nomor gambar</span><input data-ps="drawingNo" value="${esc(P.drawingNo)}"></label>
            <label class="f"><span>Digambar</span><input data-ps="drawnBy" value="${esc(P.drawnBy)}"></label>
            <label class="f"><span>Diperiksa</span><input data-ps="checkedBy" value="${esc(P.checkedBy)}"></label>
            <label class="f"><span>Disetujui</span><input data-ps="approvedBy" value="${esc(P.approvedBy)}"></label>
          </div>
          <p class="hint">ULP dan nama sistem diambil dari data sistem aktif; tanggal otomatis saat gambar dibuat.</p>
          <h3 class="mt">Parameter</h3>
          <div class="grid3">
            <label class="f"><span>Tegangan (kV)</span><input data-p="kv" value="${P.kv}"></label>
            <label class="f"><span>cos φ</span><input data-p="pf" value="${P.pf}"></label>
            <label class="f"><span>Beban default (%)</span><input data-p="loadPct" value="${P.loadPct}"></label>
            <label class="f"><span>Batas drop (%)</span><input data-p="dropLimit" value="${P.dropLimit}"></label>
            <label class="f"><span>Snap KML (m)</span><input data-p="snapM" value="${P.snapM}"></label>
            <label class="f"><span>Pemisah CSV</span><select data-ps="csvSep"><option value=";" ${P.csvSep === ';' ? 'selected' : ''}>; (Excel Indonesia)</option><option value="," ${P.csvSep === ',' ? 'selected' : ''}>, (internasional)</option></select></label>
          </div>
        </section>
      </div>`;
    GisImport.bind(el);
    el.querySelector('#pName').onchange = e => Store.mutate(() => { Store.data.meta.name = e.target.value.trim() || 'Sistem'; }, 'meta');
    el.querySelector('#bSysNew').onclick = () => App.newSystem();
    el.querySelectorAll('[data-sys]').forEach(b => b.onclick = () => Store.switchTo(b.dataset.sys));
    el.querySelector('#bSysDel').onclick = () => {
      const s = Store.system(el.querySelector('#sysDelSel').value);
      if (!s) return;
      const typed = prompt(`Hapus sistem "${s.name}" (${s.assets ?? 0} aset) secara PERMANEN?\nKetik nama sistemnya untuk konfirmasi:`);
      if (typed == null) return;
      if (typed.trim().toLowerCase() !== s.name.trim().toLowerCase()) return App.toast('Nama tidak cocok — sistem tidak dihapus');
      Store.deleteSystem(s.id).then(() => App.toast(`Sistem "${s.name}" dihapus`));
    };
    el.querySelector('#bJson').onclick = () => IO.exportJson();
    el.querySelector('#bTpl').onclick = () => IO.templateExcel();
    el.querySelector('#bXlsx').onclick = () => IO.exportExcel();
    el.querySelector('#bKml').onclick = () => IO.exportKml();
    el.querySelector('#bGeo').onclick = () => IO.exportGeoJSON();
    el.querySelector('#bClear').onclick = () => {
      if (!confirm(`Kosongkan isi sistem "${Store.data.meta.name}" saja (aset, saluran & pelanggan)? Sistem lain tidak terpengaruh. Masih bisa di-undo selama halaman belum ditutup.`)) return;
      Store.mutate(d => { d.assets = []; d.lines = []; d.customers = []; }, 'clear');
    };
    el.querySelectorAll('input[type=file][data-imp]').forEach(inp => inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      const log = el.querySelector('#impLog');
      try {
        const kind = inp.dataset.imp;
        const msgs = kind === 'json' ? await IO.importJson(f) : kind === 'xlsx' ? await IO.importExcel(f)
          : kind === 'csv' ? await IO.importCSV(f) : await IO.importKml(f, el.querySelector('#kmlType').value);
        document.getElementById('impLog').innerHTML = `<div class="okbox"><b>${esc(f.name)}</b><ul>${msgs.slice(0, 40).map(m => `<li>${esc(m)}</li>`).join('')}${msgs.length > 40 ? `<li>… ${msgs.length - 40} lagi</li>` : ''}</ul></div>`;
        MapView.fitAll();
      } catch (e) {
        log.innerHTML = `<div class="warnbox">Gagal import ${esc(f.name)}: ${esc(e.message)}</div>`;
      }
      inp.value = '';
    });
    el.querySelectorAll('[data-c]').forEach(i => i.onchange = () => Store.mutate(() => {
      const c = Store.data.conductors[+i.dataset.c], f = i.dataset.f;
      if (f === 'code') { const old = c.code; c.code = i.value.trim(); Store.data.lines.forEach(l => { if (l.conductor === old) l.conductor = c.code; }); }
      else c[f] = i.dataset.num !== undefined ? num(i.value) : i.value;
    }, 'cond'));
    el.querySelectorAll('[data-cdel]').forEach(b => b.onclick = () => {
      const c = Store.data.conductors[+b.dataset.cdel];
      const used = Store.data.lines.filter(l => l.conductor === c.code).length;
      if (used && !confirm(`${c.code} dipakai ${used} saluran. Tetap hapus?`)) return;
      Store.mutate(d => { d.conductors.splice(+b.dataset.cdel, 1); }, 'cond');
    });
    el.querySelector('#bCadd').onclick = () => Store.mutate(d => { d.conductors.push({ code: 'BARU-' + (d.conductors.length + 1), name: 'Penghantar baru', r: 0.2162, x: 0.3305, kha: 425 }); }, 'cond');
    el.querySelectorAll('[data-p]').forEach(i => i.onchange = () => Store.mutate(() => { Store.data.params[i.dataset.p] = num(i.value) ?? Store.data.params[i.dataset.p]; }, 'params'));
    el.querySelectorAll('[data-ps]').forEach(i => i.onchange = () => Store.mutate(() => { Store.data.params[i.dataset.ps] = i.value; }, 'params'));
  },
};
