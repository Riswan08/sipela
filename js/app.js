'use strict';
/* ============================================================
 * App: navigasi tampilan, tab SLD, datalist, toast, undo
 * ============================================================ */

const SldView = {
  rootId: null, opt: { stopOpen: true, showLen: true, showCond: true, showName: true, hidePoles: true, collapse: true, showJTR: false, legend: true, perFeeder: true, fillGaps: true },
  render() {
    const el = document.getElementById('view-sld');
    const src = [...AnalysisView.sources(), ...Store.data.assets.filter(a => a.type === 'GD').sort((a, b) => String(a.code).localeCompare(b.code))];
    if (!this.rootId || !Store.asset(this.rootId)) this.rootId = src[0]?.id || Store.data.assets[0]?.id || null;
    const cur = Store.asset(this.rootId);
    const inList = src.some(a => a.id === this.rootId);
    el.innerHTML = `
      <div class="toolbar wrap">
        <label class="f"><span>Mulai dari</span><select id="sRoot">
          ${!inList && cur ? `<option value="${cur.id}" selected>${esc(cur.code)} — ${esc(ASSET_TYPES[cur.type].label)}</option>` : ''}
          ${src.map(a => `<option value="${a.id}" ${a.id === this.rootId ? 'selected' : ''}>${esc(a.code)} — ${esc(ASSET_TYPES[a.type].label)}</option>`).join('')}</select></label>
        <label class="chk"><input type="checkbox" data-so="stopOpen" ${this.opt.stopOpen ? 'checked' : ''}> Berhenti di saklar NO</label>
        <label class="chk"><input type="checkbox" data-so="showLen" ${this.opt.showLen ? 'checked' : ''}> Panjang</label>
        <label class="chk"><input type="checkbox" data-so="showCond" ${this.opt.showCond ? 'checked' : ''}> Jenis penghantar</label>
        <label class="chk"><input type="checkbox" data-so="showName" ${this.opt.showName ? 'checked' : ''}> Nama</label>
        <label class="chk"><input type="checkbox" data-so="collapse" ${this.opt.collapse ? 'checked' : ''}> Ringkas tiang lurus</label>
        <label class="chk"><input type="checkbox" data-so="hidePoles" ${this.opt.hidePoles ? 'checked' : ''}> Sembunyikan label tiang</label>
        <label class="chk"><input type="checkbox" data-so="showJTR" ${this.opt.showJTR ? 'checked' : ''}> Tampilkan JTR</label>
        <label class="chk"><input type="checkbox" data-so="legend" ${this.opt.legend ? 'checked' : ''}> Keterangan & kop gambar</label>
        <label class="chk"><input type="checkbox" data-so="perFeeder" ${this.opt.perFeeder ? 'checked' : ''}> Satu keluaran per penyulang</label>
        <label class="chk"><input type="checkbox" data-so="fillGaps" ${this.opt.fillGaps !== false ? 'checked' : ''}> Lengkapi sampai ujung (celah merah)</label>
        <span class="spacer"></span>
        <button class="btn" onclick="SLD.zoom(0.8)">＋</button><button class="btn" onclick="SLD.zoom(1.25)">－</button><button class="btn" onclick="SLD.fit()">Pas</button>
        <button class="btn" onclick="SLD.exportSvg()">⬇ SVG</button><button class="btn" onclick="SLD.exportPng()">⬇ PNG</button><button class="btn" onclick="SLD.print()">🖨 Cetak</button>
      </div>
      <div class="toolbar wrap kop-edit">
        <span class="muted small">Kop:</span>
        <label class="f sm"><span>Nomor gambar</span><input data-kp="drawingNo" value="${esc(Store.data.params.drawingNo || '')}"></label>
        <label class="f"><span>Diperiksa</span><input data-kp="checkedBy" value="${esc(Store.data.params.checkedBy || '')}" placeholder="nama / jabatan"></label>
        <label class="f"><span>Disetujui</span><input data-kp="approvedBy" value="${esc(Store.data.params.approvedBy || '')}" placeholder="nama / jabatan"></label>
        <span class="muted small">Kolom "Digambar" berisi cap SIPELA.</span>
      </div>
      <div id="sldInfo" class="sld-info muted">${Store.data.assets.some(a => ASSET_TYPES[a.type]?.source) ? 'Scroll untuk zoom, geser untuk pan, klik simbol → lokasi di peta (Shift+klik = SLD dari aset itu).' : '⚠ Belum ada PLTD/GI sebagai sumber — SLD sementara digambar dari aset terpilih. Tambahkan PLTD di peta lalu sambungkan ke jaringan.'}</div>
      <div id="sldWrap"></div>
      <div class="legend">${Object.entries(ASSET_TYPES).map(([k, T]) => `<span><svg width="34" height="30" viewBox="-17 -15 34 30"><line x1="-17" x2="17" stroke="#1f2937" stroke-width="2"/>${SLD.symbol({ type: k, status: 'NC' })}</svg>${T.label}</span>`).join('')}
        <span><svg width="34" height="30" viewBox="-17 -15 34 30"><line x1="-17" x2="17" stroke="#1f2937" stroke-width="2"/>${SLD.symbol({ type: 'LBS', status: 'NO' })}</svg>Saklar NO</span>
        <span><svg width="40" height="12"><line x1="0" y1="6" x2="40" y2="6" stroke="#1f2937" stroke-width="2" stroke-dasharray="10 4 2 4"/></svg>Kabel tanah</span>
        <span><svg width="40" height="12"><line x1="0" y1="6" x2="40" y2="6" stroke="#dc2626" stroke-width="1.5" stroke-dasharray="4 3"/></svg>Tie / titik buka</span></div>`;
    el.querySelector('#sRoot').onchange = e => { this.rootId = e.target.value; this.draw(); };
    el.querySelectorAll('[data-so]').forEach(c => c.onchange = () => { this.opt[c.dataset.so] = c.checked; this.draw(); });
    el.querySelectorAll('[data-kp]').forEach(i => i.onchange = () => { Store.data.params[i.dataset.kp] = i.value.trim(); Store.persist(); this.draw(); });
    SLD.loadLogo();
    this.draw();
  },
  draw() {
    const wrap = document.getElementById('sldWrap');
    if (!this.rootId) { wrap.innerHTML = '<div class="empty center"><p>Belum ada data. Tambahkan aset di Peta atau import data GIS di tab Data.</p></div>'; return; }
    const svg = SLD.render(this.rootId, this.opt);
    if (!svg) { wrap.innerHTML = '<p class="pad">Tidak dapat menggambar SLD.</p>'; return; }
    SLD.mount(wrap, svg);
    const reach = SLD.tree ? SLD.tree.nodes.size : 0, total = Store.data.assets.filter(a => a.sub !== 'TR').length;
    if (SLD.tree?.gaps) document.getElementById('sldInfo').innerHTML = `<span class="muted">${SLD.tree.gaps} sambungan <span style="color:#dc2626">merah putus-putus</span> = kelompok jaringan yang belum tertaging di GIS, digantung ke titik terdekat penyulangnya (jarak garis lurus). Verifikasi & sambungkan di peta bila sudah pasti.</span>`;
    else if (SLD.tree?.missing) document.getElementById('sldInfo').innerHTML = `<span class="muted">${SLD.tree.missing} aset terhubung tetapi tidak tergambar karena tidak berada di jalur penyulangnya sendiri (label penyulang GIS berbeda). Matikan "Satu keluaran per penyulang" untuk melihat semuanya.</span>`;
    const root = Store.asset(this.rootId);
    if (ASSET_TYPES[root?.type]?.source && total > 5 && reach < total * 0.5) {
      const hasOut = SLD.tree.root.children.length > 0;
      document.getElementById('sldInfo').innerHTML = hasOut
        ? `<span class="muted">${esc(root.code)} menjangkau ${reach} dari ${total} aset. Sisanya berada di kelompok jaringan yang terputus (celah data GIS / tiang belum terdata) — lihat ruas merah putus-putus di peta, sambungkan manual bila memang satu jalur.</span>`
        : `<span class="warn">⚠ ${esc(root.code)} hanya menjangkau ${reach} dari ${total} aset.</span> Kemungkinan pembangkit belum tersambung ke tiang TM jaringan.
        <button class="btn sm primary" onclick="App.focusAsset('${root.id}'); setTimeout(() => MapView.autoConnect('${root.id}'), 300)">⚡ Sambungkan ke jaringan terdekat</button>`;
    }
  },
};

const App = {
  view: 'map',
  views: { map: null, sld: SldView, assets: AssetsView, lines: LinesView, analysis: AnalysisView, data: DataView },

  async init() {
    const ro = Auth.readOnly();
    document.body.classList.toggle('ro', ro);
    const badge = document.getElementById('userBadge');
    badge.textContent = ro ? '👁 Tamu · hanya lihat' : '🛡 Admin · ' + Auth.name();
    badge.className = 'badge ' + (ro ? 'tamu' : 'admin');
    document.getElementById('btnLogout').onclick = () => { if (confirm('Keluar dari SIPELA?')) Auth.logout(); };
    await Store.load();
    const sel = document.getElementById('sysSel'), ulp = document.getElementById('ulpSel');
    sel.onchange = async () => {
      if (sel.value === '__new') { this.newSystem(); this.refreshCommon(); return; }
      if (sel.value.startsWith('__ref:')) {
        // sistem dari daftar referensi yang belum punya data: buat entri kosong
        const ref = SISTEM_REF.find(s => s.sistem === sel.value.slice(6));
        await Store.createSystem('Sistem ' + ref.sistem, null, { ulp: ref.ulp, sistem: ref.sistem });
        this.toast(`Sistem ${ref.sistem} dibuat (masih kosong) — import GIS atau tambah aset di peta`);
        return;
      }
      await Store.switchTo(sel.value);
    };
    const vm = ([...document.scripts].find(s => /app\.js\?v=/.test(s.src))?.src.match(/v=(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})/) || []);
    if (vm.length) document.getElementById("appVer").textContent = `v${vm[1]}.${vm[2]}.${vm[3]}-${vm[4]}${vm[5]}`;
    ulp.onchange = () => { this.ulpFilter = ulp.value; this.refreshCommon(); const first = this.systemsFiltered()[0]; if (first && !this.systemsFiltered().some(s => s.id === Store.current)) Store.switchTo(first.id); };
    document.querySelectorAll('#nav button').forEach(b => b.onclick = () => this.show(b.dataset.view));
    document.getElementById('btnUndo').onclick = () => this.undo();
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); this.undo(); }
    });
    Store.on(reason => reason === 'saved' ? this.refreshCommon() : this.onChange(reason));
    Store.on(reason => { if (reason === 'system') { MapView.sel = null; MapView.fitAll(); } });
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

  async newSystem(name) {
    name = name ?? prompt('Nama sistem baru (mis. Sistem Buano):', '');
    if (name == null) return null;
    const id = await Store.createSystem(name.trim() || 'Sistem baru', null, { ulp: this.ulpFilter || '' });
    this.toast(`Sistem "${Store.data.meta.name}" dibuat`);
    return id;
  },

  ulpFilter: '',
  systemsFiltered() {
    const list = Store.systems.filter(s => !this.ulpFilter || (s.ulp || '') === this.ulpFilter);
    return list.sort((a, b) => (a.ulp || '').localeCompare(b.ulp || '') || a.name.localeCompare(b.name, 'id'));
  },
  refreshCommon() {
    const ulpSel = document.getElementById('ulpSel'), sel = document.getElementById('sysSel');
    // ULP: gabungan daftar referensi UP3 dan ULP yang ada di data
    const ulps = [...new Set([...SistemRef.ulps(), ...Store.systems.map(s => s.ulp).filter(Boolean)])].sort();
    ulpSel.innerHTML = `<option value="">Semua ULP</option>` + ulps.map(u => `<option value="${esc(u)}" ${u === this.ulpFilter ? 'selected' : ''}>ULP ${esc(u)}</option>`).join('');
    if (this.ulpFilter && !ulps.includes(this.ulpFilter)) this.ulpFilter = '';
    const list = this.systemsFiltered();
    const cur = Store.system();
    const opts = list.map(s => `<option value="${s.id}" ${s.id === Store.current ? 'selected' : ''}>${esc(s.name)}${!this.ulpFilter && s.ulp ? ` (${esc(s.ulp)})` : ''}</option>`);
    if (cur && !list.some(s => s.id === cur.id)) opts.unshift(`<option value="${cur.id}" selected>${esc(cur.name)}</option>`);
    // sistem dari daftar referensi yang belum punya data
    const have = new Set(Store.systems.map(s => s.sistem).filter(Boolean));
    const refs = SistemRef.systemsOf(this.ulpFilter).filter(r => !have.has(r.sistem));
    const refOpts = refs.map(r => `<option value="__ref:${esc(r.sistem)}">${esc(r.sistem)}${!this.ulpFilter ? ` (${esc(r.ulp)})` : ''} — belum ada data</option>`);
    sel.innerHTML = opts.join('') + (Auth.readOnly() ? '' : (refOpts.length ? `<optgroup label="Belum diimport (${refOpts.length})">${refOpts.join('')}</optgroup>` : '') + '<option value="__new">＋ Sistem baru…</option>');
    sel.value = Store.current;
    document.getElementById('dlAssets').innerHTML = Store.data.assets.map(a => `<option value="${esc(a.code)}">${esc(ASSET_TYPES[a.type]?.short)} ${esc(a.name)}</option>`).join('');
    document.getElementById('dlFeeders').innerHTML = Store.feeders().map(f => `<option value="${esc(f)}">`).join('');
    const s = document.getElementById('saveState');
    s.textContent = Store.saveOk ? (Store.data.meta.updated ? 'Tersimpan ✓' : '') : 'Gagal simpan! Unduh backup.';
    s.className = Store.saveOk ? 'muted' : 'bad';
    document.getElementById('btnUndo').disabled = !Store.undoStack.length;
  },

  show(view) {
    if (view === 'data' && Auth.readOnly()) { this.toast('Tab Data hanya untuk admin'); view = 'map'; }
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
