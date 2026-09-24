'use strict';
/* ============================================================
 * App: navigasi tampilan, tab SLD, datalist, toast, undo
 * ============================================================ */

const SldView = {
  rootId: null, opt: { stopOpen: true, showLen: true, showName: true, hidePoles: false },
  render() {
    const el = document.getElementById('view-sld');
    const src = AnalysisView.sources();
    if (!this.rootId || !Store.asset(this.rootId)) this.rootId = src[0]?.id || Store.data.assets[0]?.id || null;
    const cur = Store.asset(this.rootId);
    const inList = src.some(a => a.id === this.rootId);
    el.innerHTML = `
      <div class="toolbar wrap">
        <label class="f"><span>Mulai dari</span><select id="sRoot">
          ${!inList && cur ? `<option value="${cur.id}" selected>${esc(cur.code)} — ${esc(ASSET_TYPES[cur.type].label)}</option>` : ''}
          ${src.map(a => `<option value="${a.id}" ${a.id === this.rootId ? 'selected' : ''}>${esc(a.code)} — ${esc(ASSET_TYPES[a.type].label)}</option>`).join('')}</select></label>
        <label class="chk"><input type="checkbox" data-so="stopOpen" ${this.opt.stopOpen ? 'checked' : ''}> Berhenti di saklar NO</label>
        <label class="chk"><input type="checkbox" data-so="showLen" ${this.opt.showLen ? 'checked' : ''}> Panjang & penghantar</label>
        <label class="chk"><input type="checkbox" data-so="showName" ${this.opt.showName ? 'checked' : ''}> Nama</label>
        <label class="chk"><input type="checkbox" data-so="hidePoles" ${this.opt.hidePoles ? 'checked' : ''}> Sembunyikan label tiang</label>
        <span class="spacer"></span>
        <button class="btn" onclick="SLD.zoom(0.8)">＋</button><button class="btn" onclick="SLD.zoom(1.25)">－</button><button class="btn" onclick="SLD.fit()">Pas</button>
        <button class="btn" onclick="SLD.exportSvg()">⬇ SVG</button><button class="btn" onclick="SLD.exportPng()">⬇ PNG</button><button class="btn" onclick="SLD.print()">🖨 Cetak</button>
      </div>
      <div id="sldInfo" class="sld-info muted">Scroll untuk zoom, geser untuk pan, klik simbol untuk info.</div>
      <div id="sldWrap"></div>
      <div class="legend">${Object.entries(ASSET_TYPES).map(([k, T]) => `<span><svg width="34" height="30" viewBox="-17 -15 34 30"><line x1="-17" x2="17" stroke="#1f2937" stroke-width="2"/>${SLD.symbol({ type: k, status: 'NC' })}</svg>${T.label}</span>`).join('')}
        <span><svg width="34" height="30" viewBox="-17 -15 34 30"><line x1="-17" x2="17" stroke="#1f2937" stroke-width="2"/>${SLD.symbol({ type: 'LBS', status: 'NO' })}</svg>Saklar NO</span>
        <span><svg width="40" height="12"><line x1="0" y1="6" x2="40" y2="6" stroke="#1f2937" stroke-width="2" stroke-dasharray="10 4 2 4"/></svg>Kabel tanah</span>
        <span><svg width="40" height="12"><line x1="0" y1="6" x2="40" y2="6" stroke="#dc2626" stroke-width="1.5" stroke-dasharray="4 3"/></svg>Tie / titik buka</span></div>`;
    el.querySelector('#sRoot').onchange = e => { this.rootId = e.target.value; this.draw(); };
    el.querySelectorAll('[data-so]').forEach(c => c.onchange = () => { this.opt[c.dataset.so] = c.checked; this.draw(); });
    this.draw();
  },
  draw() {
    const wrap = document.getElementById('sldWrap');
    if (!this.rootId) { wrap.innerHTML = '<div class="empty center"><p>Belum ada data. Tambahkan aset di Peta atau muat data contoh di tab Data.</p></div>'; return; }
    const svg = SLD.render(this.rootId, this.opt);
    if (!svg) { wrap.innerHTML = '<p class="pad">Tidak dapat menggambar SLD.</p>'; return; }
    SLD.mount(wrap, svg);
  },
};

const App = {
  view: 'map',
  views: { map: null, sld: SldView, assets: AssetsView, lines: LinesView, analysis: AnalysisView, data: DataView },

  init() {
    Store.load();
    document.querySelectorAll('#nav button').forEach(b => b.onclick = () => this.show(b.dataset.view));
    document.getElementById('btnUndo').onclick = () => this.undo();
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); this.undo(); }
    });
    Store.on(reason => this.onChange(reason));
    MapView.init();
    this.refreshCommon();
    const v = (location.hash || '').slice(1);
    if (this.views[v] !== undefined) this.show(v);
    window.addEventListener('resize', () => { if (this.view === 'sld' && SLD.svg) SLD.fit(); });
  },

  onChange() {
    this.refreshCommon();
    MapView.render();
    if (this.view === 'map') MapView.renderModeOpts();
    const v = this.views[this.view];
    if (v) v.render();
  },

  refreshCommon() {
    document.getElementById('projName').textContent = Store.data.meta.name;
    document.getElementById('dlAssets').innerHTML = Store.data.assets.map(a => `<option value="${esc(a.code)}">${esc(ASSET_TYPES[a.type]?.short)} ${esc(a.name)}</option>`).join('');
    document.getElementById('dlFeeders').innerHTML = Store.feeders().map(f => `<option value="${esc(f)}">`).join('');
    const s = document.getElementById('saveState');
    s.textContent = Store.saveOk ? (Store.data.meta.updated ? 'Tersimpan ✓' : '') : 'Gagal simpan!';
    s.className = Store.saveOk ? 'muted' : 'bad';
    document.getElementById('btnUndo').disabled = !Store.undoStack.length;
  },

  show(view) {
    this.view = view;
    history.replaceState(null, '', '#' + view);
    document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    document.querySelectorAll('.view').forEach(s => s.classList.toggle('active', s.id === 'view-' + view));
    if (view === 'map') setTimeout(() => MapView.map.invalidateSize(), 0);
    else this.views[view].render();
  },

  undo() { if (Store.undo()) this.toast('Perubahan terakhir dibatalkan'); else this.toast('Tidak ada yang bisa di-undo'); },

  focusAsset(id) {
    this.show('map');
    MapView.setMode('select');
    MapView.select('asset', id, true);
  },
  showSld(id) { SldView.rootId = id; this.show('sld'); },
  showDistance(code) { AnalysisView.distA = code; AnalysisView.fromCode = code; this.show('analysis'); },

  toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('on');
    clearTimeout(this._tt); this._tt = setTimeout(() => t.classList.remove('on'), 3200);
  },
};

window.addEventListener('DOMContentLoaded', () => {
  if (!window.L) {
    document.getElementById('map').innerHTML = '<div class="empty center"><h3>Peta tidak termuat</h3><p>Library peta (Leaflet) butuh koneksi internet saat pertama dibuka.</p></div>';
  }
  try { App.init(); } catch (e) { console.error(e); alert('Gagal memulai aplikasi: ' + e.message); }
});
