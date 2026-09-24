'use strict';
/* ============================================================
 * MapView: peta aset, mode gambar (aset/saluran/ukur), editor properti
 * ============================================================ */

const MapView = {
  map: null,
  mode: 'select',
  sel: null,              // {kind:'asset'|'line', id}
  draft: null,            // saluran yang sedang digambar
  measurePts: [],
  lastAssetId: null,
  markers: new Map(),
  polylines: new Map(),
  opts: { type: 'GD', autoConnect: false, conductor: 'AAAC-150', feeder: '', level: 'JTM', allowDrag: false },

  init() {
    const map = this.map = L.map('map', { zoomControl: true, doubleClickZoom: false, preferCanvas: true }).setView([-2.5, 118], 5);
    const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      { maxZoom: 21, maxNativeZoom: 19, attribution: '© OpenStreetMap' });
    const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 21, maxNativeZoom: 19, attribution: 'Citra © Esri' });
    const hyb = L.layerGroup([
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 21, maxNativeZoom: 19, attribution: 'Citra © Esri' }),
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 21, maxNativeZoom: 19 }),
    ]);
    osm.addTo(map);
    this.custLayer = L.layerGroup().addTo(map);
    L.control.layers({ 'Jalan (OSM)': osm, 'Satelit': sat, 'Satelit + Label': hyb }, { 'Pelanggan (APP)': this.custLayer }).addTo(map);
    L.control.scale({ imperial: false }).addTo(map);
    this.legendCtl = L.control({ position: 'bottomleft' });
    this.legendCtl.onAdd = () => { const div = L.DomUtil.create('div', 'map-legend'); L.DomEvent.disableClickPropagation(div); this.legendEl = div; return div; };
    this.legendCtl.addTo(map);
    map.on('moveend', () => this.renderCustomers());

    this.lineLayer = L.layerGroup().addTo(map);
    this.hlLayer = L.layerGroup().addTo(map);
    this.assetLayer = L.layerGroup().addTo(map);
    this.draftLayer = L.layerGroup().addTo(map);

    map.on('click', e => this.onMapClick(e.latlng));
    map.on('mousemove', e => this.onMove(e.latlng));
    map.on('zoomend', () => this.updateLabelClass());
    this.updateLabelClass();

    document.querySelectorAll('#modeSeg button').forEach(b => b.onclick = () => this.setMode(b.dataset.mode));
    document.getElementById('btnGps').onclick = () => this.locate(false);
    const search = document.getElementById('mapSearch');
    search.onchange = () => {
      const a = Store.byCode(search.value) || Store.data.assets.find(x => (x.name || '').toLowerCase() === search.value.toLowerCase());
      if (a) { this.select('asset', a.id, true); search.value = ''; }
      else App.toast('Aset tidak ditemukan');
    };
    document.addEventListener('keydown', e => {
      if (App.view !== 'map' || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
      if (e.key === 'Escape') { this.cancelDraft(); this.measurePts = []; this.renderDraft(); this.renderModeOpts(); }
      if (e.key === 'Enter' && this.mode === 'line') this.finishDraftAtNewPole();
      if (e.key === 'Delete' && this.sel) this.deleteSelected();
    });
    this.setMode('select');
    this.render();
    this.fitAll();
  },

  updateLabelClass() {
    document.getElementById('map').classList.toggle('show-labels', this.map.getZoom() >= 16);
  },

  fitAll() {
    const pts = Store.data.assets.map(a => [a.lat, a.lng]);
    if (pts.length) this.map.fitBounds(pts, { padding: [40, 40], maxZoom: 17 });
  },

  setMode(m) {
    this.mode = m;
    this.cancelDraft();
    this.measurePts = [];
    this.renderDraft();
    document.querySelectorAll('#modeSeg button').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
    document.getElementById('map').dataset.mode = m;
    this.renderModeOpts();
    this.render();
  },

  /* ---------------- render layer ---------------- */
  iconFor(a) {
    const T = ASSET_TYPES[a.type] || ASSET_TYPES.TIANG;
    const cls = ['mk', 'mk-' + a.type, Net.isOpen(a) ? 'open' : '', this.isSel('asset', a.id) ? 'sel' : ''].join(' ');
    const size = a.type === 'TIANG' ? 12 : T.source ? 30 : 24;
    return L.divIcon({
      className: 'mk-wrap',
      html: `<div class="${cls}" style="--c:${T.color};width:${size}px;height:${size}px">${a.type === 'TIANG' ? '' : T.short}</div>` +
            `<div class="mk-label">${esc(a.code)}${Net.isOpen(a) ? ' (NO)' : ''}</div>`,
      iconSize: [size, size], iconAnchor: [size / 2, size / 2],
    });
  },
  isSel(kind, id) { return this.sel && this.sel.kind === kind && this.sel.id === id; },

  render() {
    if (!this.map) return;
    this.assetLayer.clearLayers(); this.lineLayer.clearLayers();
    this.markers.clear(); this.polylines.clear();
    for (const l of Store.data.lines) {
      const pts = Store.linePoints(l);
      if (!pts) continue;
      const pl = L.polyline(pts, this.lineStyle(l)).addTo(this.lineLayer);
      pl.options.bubblingMouseEvents = false;
      pl.bindTooltip(() => `${esc(Store.asset(l.from)?.code)} → ${esc(Store.asset(l.to)?.code)}<br>${fmt.m(Store.lineLength(l))} · ${esc(l.conductor)}${l.feeder ? ' · ' + esc(l.feeder) : ''}`, { sticky: true });
      pl.on('click', e => {
        if (this.mode === 'select') this.select('line', l.id);
        else this.onMapClick(e.latlng);
      });
      this.polylines.set(l.id, pl);
    }
    for (const a of Store.data.assets) {
      if (a.lat == null || a.lng == null) continue;
      if (a.type === 'TIANG') {
        const cm = L.circleMarker([a.lat, a.lng], { ...this.poleStyle(a), bubblingMouseEvents: false });
        cm.bindTooltip(() => `<b>${esc(a.code)}</b>${a.sub === 'TR' ? ' (tiang TR)' : ''}${a.note ? '<br>' + esc(a.note) : ''}`, { direction: 'top' });
        cm.on('click', () => this.onAssetClick(a.id));
        cm.addTo(this.assetLayer);
        this.markers.set(a.id, cm);
        continue;
      }
      const mk = L.marker([a.lat, a.lng], { icon: this.iconFor(a), draggable: this.mode === 'select' && this.opts.allowDrag, zIndexOffset: a.type === 'TIANG' ? 0 : 500 });
      mk.bindTooltip(`<b>${esc(a.code)}</b> ${esc(a.name)}<br>${esc(ASSET_TYPES[a.type]?.label)}${a.kva ? ' · ' + fmt.n(a.kva, 0) + ' kVA' : ''}`, { direction: 'top', offset: [0, -10] });
      mk.on('click', () => this.onAssetClick(a.id));
      mk.on('dragend', e => {
        const p = e.target.getLatLng();
        Store.mutate(() => { const x = Store.asset(a.id); x.lat = +p.lat.toFixed(7); x.lng = +p.lng.toFixed(7); }, 'move');
      });
      mk.addTo(this.assetLayer);
      this.markers.set(a.id, mk);
    }
    this.renderCustomers();
    this.renderLegend();
    this.renderEditor();
  },
  poleStyle(a) {
    const sel = this.isSel('asset', a.id), tr = a.sub === 'TR';
    return { radius: sel ? 7 : tr ? 2.5 : 3.5, color: sel ? '#facc15' : tr ? '#64748b' : '#1e293b', weight: sel ? 3 : 1,
      fillColor: tr ? '#cbd5e1' : '#475569', fillOpacity: 1 };
  },
  renderLegend() {
    if (!this.legendEl) return;
    const lens = {};
    Store.data.lines.forEach(l => { if (l.feeder && l.level !== 'JTR') lens[l.feeder] = (lens[l.feeder] || 0) + Store.lineLength(l); });
    const names = Object.keys(lens).sort();
    if (!names.length) { this.legendEl.style.display = 'none'; return; }
    this.legendEl.style.display = '';
    this.legendEl.innerHTML = `<b>Penyulang (klik untuk zoom)</b>` + names.map(f =>
      `<div class="fl" data-f="${esc(f)}"><i style="--c:${feederColor(f)}"></i>${esc(f)} <small>${fmt.m(lens[f])}</small></div>`).join('');
    this.legendEl.querySelectorAll('.fl').forEach(el => el.onclick = () => {
      const pts = [];
      Store.data.lines.forEach(l => { if (l.feeder === el.dataset.f) { const p = Store.linePoints(l); if (p) pts.push(p[0], p[p.length - 1]); } });
      if (pts.length) this.map.fitBounds(pts, { padding: [30, 30] });
    });
  },
  // pelanggan hanya digambar saat zoom dekat & di area tampak (bisa puluhan ribu titik)
  renderCustomers() {
    const cs = Store.data.customers || [];
    this.custLayer.clearLayers();
    if (!cs.length || this.map.getZoom() < 15) return;
    const b = this.map.getBounds().pad(0.2);
    let n = 0;
    for (const c of cs) {
      if (!b.contains([c.lat, c.lng])) continue;
      if (++n > 6000) break;
      L.circleMarker([c.lat, c.lng], { radius: 2.5, color: '#b45309', weight: 1, fillColor: '#fbbf24', fillOpacity: 0.9, interactive: true, bubblingMouseEvents: true })
        .bindTooltip(`Pelanggan ${esc(c.idpel || '-')}<br>${c.va ? fmt.n(c.va, 0) + ' VA' : 'daya ?'} · gardu ${esc(c.gd)}`)
        .addTo(this.custLayer);
    }
  },
  lineStyle(l) {
    const sel = this.isSel('line', l.id);
    return {
      color: sel ? '#facc15' : l.gap ? '#dc2626' : l.level === 'JTR' ? '#78716c' : feederColor(l.feeder),
      weight: sel ? 7 : l.level === 'JTR' ? 2 : 4,
      opacity: 0.9,
      dashArray: l.gap ? '4 6' : l.level === 'JTR' ? '5 4' : (/XLPE|SKTM|N2X/i.test(l.conductor) ? '10 4 2 4' : null),
    };
  },

  select(kind, id, pan = false) {
    const prev = this.sel;
    this.sel = id ? { kind, id } : null;
    // perbarui tampilan elemen lama & baru saja
    [prev, this.sel].forEach(s => {
      if (!s) return;
      if (s.kind === 'asset') {
        const a = Store.asset(s.id), m = this.markers.get(s.id);
        if (a && m) { if (m.setIcon) m.setIcon(this.iconFor(a)); else { m.setStyle(this.poleStyle(a)); m.setRadius(this.poleStyle(a).radius); } }
      }
      else { const l = Store.line(s.id), p = this.polylines.get(s.id); if (l && p) { p.setStyle(this.lineStyle(l)); if (this.isSel('line', l.id)) p.bringToFront(); } }
    });
    if (kind === 'asset' && id) this.lastAssetId = id;
    if (pan && id) {
      if (kind === 'asset') { const a = Store.asset(id); this.map.setView([a.lat, a.lng], Math.max(this.map.getZoom(), 17)); }
      else { const p = Store.linePoints(Store.line(id)); if (p) this.map.fitBounds(p, { padding: [60, 60], maxZoom: 18 }); }
    }
    this.renderEditor();
  },

  highlight(lines, color = '#facc15', fit = true, colorFn = null) {
    this.hlLayer.clearLayers();
    const all = [];
    lines.forEach(l => {
      const p = Store.linePoints(l); if (!p) return;
      all.push(...p);
      L.polyline(p, { color: colorFn ? colorFn(l) : color, weight: 9, opacity: 0.75, interactive: false }).addTo(this.hlLayer);
    });
    if (fit && all.length) this.map.fitBounds(all, { padding: [50, 50] });
  },
  clearHighlight() { this.hlLayer.clearLayers(); },

  /* ---------------- interaksi ---------------- */
  onAssetClick(id) {
    if (this.mode === 'line') {
      if (!this.draft) { this.draft = { from: id, pts: [] }; this.renderDraft(); this.renderModeOpts(); return; }
      if (id === this.draft.from) { App.toast('Klik aset tujuan yang berbeda'); return; }
      this.finishDraft(id);
      return;
    }
    if (this.mode === 'measure') { const a = Store.asset(id); this.measurePts.push([a.lat, a.lng]); this.renderDraft(); this.renderModeOpts(); return; }
    if (this.mode === 'asset') { this.lastAssetId = id; this.select('asset', id); App.toast(`Sambung otomatis dari ${Store.asset(id).code}`); return; }
    this.select('asset', id);
  },

  // aset terdekat dari titik klik, dalam jarak layar (piksel) — agar tiang kecil mudah dikenai
  snapAsset(ll, px = 14) {
    const c = this.map.latLngToContainerPoint(ll);
    let best = null;
    for (const a of Store.data.assets) {
      if (Math.abs(a.lat - ll.lat) > 0.01 || Math.abs(a.lng - ll.lng) > 0.01) continue;
      const d = c.distanceTo(this.map.latLngToContainerPoint([a.lat, a.lng]));
      if (d <= px && (!best || d < best.d)) best = { a, d };
    }
    return best?.a || null;
  },

  onMapClick(ll) {
    const p = [+ll.lat.toFixed(7), +ll.lng.toFixed(7)];
    if (this.mode === 'asset') {
      if (this.placing != null) return this.placePending(p);
      return this.placeAsset(p);
    }
    if (this.mode === 'line') {
      const near = this.snapAsset(ll);
      if (near) return this.onAssetClick(near.id);
      if (!this.draft) { App.toast('Klik aset awal terlebih dahulu'); return; }
      this.draft.pts.push(p); this.renderDraft(); this.renderModeOpts(); return;
    }
    if (this.mode === 'measure') { this.measurePts.push(p); this.renderDraft(); this.renderModeOpts(); return; }
    if (this.sel) this.select(null, null);
  },

  onMove(ll) {
    this.mouse = [ll.lat, ll.lng];
    if ((this.mode === 'line' && this.draft) || (this.mode === 'measure' && this.measurePts.length)) this.renderDraft();
  },

  // penempatan peralatan dari daftar "belum bertikor"
  startPlacing(idx) {
    this.placing = idx;
    this.setMode('asset');
    const pd = Store.data.pending[idx];
    App.toast(`Klik posisi ${pd.name} di peta, atau tempel koordinatnya di panel`);
  },
  placePending(p) {
    const idx = this.placing; this.placing = null;
    const r = EquipImport.place(idx, p);
    if (!r) return;
    this.select('asset', r.a.id, true);
    App.toast(`${r.a.code}: ${r.how}`);
    this.renderModeOpts();
  },

  placeAsset(p, extra = {}) {
    const o = this.opts;
    const prevId = o.autoConnect ? this.lastAssetId : null;
    const a = Store.mutate(() => {
      const prev = prevId && Store.asset(prevId);
      const x = Store._newAsset({ type: o.type, lat: p[0], lng: p[1], feeder: o.feeder || prev?.feeder || '', ...extra });
      if (prev) Store._newLine({ from: prev.id, to: x.id, conductor: o.conductor, feeder: x.feeder, level: o.level });
      return x;
    }, 'asset');
    this.lastAssetId = a.id;
    this.select('asset', a.id);
    App.toast(`${a.code} ditambahkan` + (prevId && Store.asset(prevId) ? ` & disambung dari ${Store.asset(prevId).code}` : ''));
  },

  finishDraft(toId) {
    const d = this.draft, o = this.opts;
    const from = Store.asset(d.from), to = Store.asset(toId);
    const l = Store.addLine({ from: d.from, to: toId, path: d.pts, conductor: o.conductor, level: o.level, feeder: o.feeder || from.feeder || to.feeder || '' });
    this.draft = null;
    this.renderDraft();
    this.select('line', l.id);
    this.renderModeOpts();
    App.toast(`Saluran ${from.code} → ${to.code}: ${fmt.m(Store.lineLength(l))}`);
    if (ASSET_TYPES[from.type]?.source || ASSET_TYPES[to.type]?.source) setTimeout(() => App.showSld(ASSET_TYPES[from.type]?.source ? from.id : to.id), 600);
  },
  // selesai di titik terakhir dengan membuat tiang baru
  finishDraftAtNewPole() {
    const d = this.draft;
    if (!d || !d.pts.length) return;
    const end = d.pts.pop();
    const near = this.snapAsset(L.latLng(end), 20);
    if (near && near.id !== d.from) { this.finishDraft(near.id); return; }
    const o = this.opts;
    const l = Store.mutate(() => {
      const from = Store.asset(d.from);
      const t = Store._newAsset({ type: 'TIANG', lat: end[0], lng: end[1], feeder: o.feeder || from.feeder || '' });
      return Store._newLine({ from: d.from, to: t.id, path: d.pts, conductor: o.conductor, level: o.level, feeder: o.feeder || from.feeder || '' });
    }, 'line');
    this.draft = null;
    this.renderDraft(); this.select('line', l.id); this.renderModeOpts();
  },
  cancelDraft() { this.draft = null; },

  renderDraft() {
    this.draftLayer.clearLayers();
    let pts = null;
    if (this.mode === 'line' && this.draft) {
      const a = Store.asset(this.draft.from);
      pts = [[a.lat, a.lng], ...this.draft.pts];
      L.circleMarker([a.lat, a.lng], { radius: 14, color: '#facc15', weight: 3, fill: false, interactive: false }).addTo(this.draftLayer);
    } else if (this.mode === 'measure' && this.measurePts.length) {
      pts = [...this.measurePts];
      pts.forEach(p => L.circleMarker(p, { radius: 4, color: '#111', weight: 2, fillColor: '#fff', fillOpacity: 1, interactive: false }).addTo(this.draftLayer));
    }
    if (!pts) return;
    const full = this.mouse ? [...pts, this.mouse] : pts;
    L.polyline(pts, { color: '#111827', weight: 3, dashArray: '6 6', interactive: false }).addTo(this.draftLayer);
    if (this.mouse) {
      L.polyline([pts[pts.length - 1], this.mouse], { color: '#6b7280', weight: 2, dashArray: '2 6', interactive: false }).addTo(this.draftLayer);
      const el = document.getElementById('draftLen');
      if (el) el.textContent = fmt.m(Geo.pathLen(full));
    }
  },

  locate(addAsset) {
    if (!navigator.geolocation) return App.toast('Perangkat tidak mendukung GPS');
    if (!window.isSecureContext) return App.toast('GPS butuh https:// atau localhost (lihat README)');
    App.toast('Mengambil lokasi GPS…');
    navigator.geolocation.getCurrentPosition(pos => {
      const p = [pos.coords.latitude, pos.coords.longitude], acc = pos.coords.accuracy;
      this.draftLayer.clearLayers();
      L.circle(p, { radius: acc, color: '#2563eb', weight: 1, fillOpacity: 0.1, interactive: false }).addTo(this.draftLayer);
      L.circleMarker(p, { radius: 7, color: '#fff', weight: 2, fillColor: '#2563eb', fillOpacity: 1, interactive: false }).addTo(this.draftLayer);
      this.map.setView(p, Math.max(this.map.getZoom(), 18));
      if (addAsset) { this.placeAsset([+p[0].toFixed(7), +p[1].toFixed(7)]); }
      App.toast(`Akurasi GPS ±${Math.round(acc)} m` + (acc > 15 ? ' — tunggu sinyal lebih baik bila perlu' : ''));
    }, err => App.toast('GPS gagal: ' + err.message), { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  },

  deleteSelected() {
    const s = this.sel; if (!s) return;
    if (s.kind === 'asset') {
      const a = Store.asset(s.id), n = Store.linesOf(s.id).length;
      if (!confirm(`Hapus ${a.code}${n ? ` beserta ${n} saluran tersambung` : ''}?`)) return;
      this.sel = null; Store.deleteAsset(s.id);
    } else {
      if (!confirm('Hapus saluran ini?')) return;
      this.sel = null; Store.deleteLine(s.id);
    }
  },

  /* ---------------- panel ---------------- */
  condOptions(sel) {
    const list = Store.data.conductors.map(c => `<option value="${esc(c.code)}" ${c.code === sel ? 'selected' : ''}>${esc(c.name)}</option>`);
    if (sel && !Store.conductor(sel)) list.unshift(`<option value="${esc(sel)}" selected>${esc(sel)} (tidak dikenal)</option>`);
    return list.join('');
  },

  renderModeOpts() {
    const el = document.getElementById('modeOpts'), o = this.opts;
    const pend = Store.data.pending || [];
    if (this.placing != null && !pend[this.placing]) this.placing = null;
    const pendHtml = this.mode === 'asset' && (pend.length || this.placing != null) ? `
      ${this.placing != null ? `<div class="placing">📍 Menempatkan <b>${esc(pend[this.placing].name)}</b> (${esc(pend[this.placing].feeder)}). Klik posisinya di peta atau tempel koordinat di bawah.
        <button class="btn sm" id="btnPlaceCancel">Batal</button></div>` : ''}
      <details class="coord" ${pend.length && this.placing == null ? 'open' : ''}><summary>Peralatan belum bertikor (${pend.length})</summary>
        <ul class="pending">${pend.map((x, i) => `<li><span class="nm" title="${esc(x.name)}"><b>${esc(ASSET_TYPES[x.type]?.short)}</b> ${esc(x.name)} <small class="muted">${esc(x.feeder)}${x.zona ? ' · ' + esc(x.zona) : ''}</small></span>
          <button class="btn sm" data-place="${i}">Tempatkan</button><button class="btn sm danger" data-unpend="${i}" title="Hapus dari daftar">✕</button></li>`).join('')}</ul>
      </details>` : '';
    const common = `
      <div class="grid2">
        <label class="f"><span>Penghantar</span><select data-o="conductor">${this.condOptions(o.conductor)}</select></label>
        <label class="f"><span>Level</span><select data-o="level"><option ${o.level === 'JTM' ? 'selected' : ''}>JTM</option><option ${o.level === 'JTR' ? 'selected' : ''}>JTR</option></select></label>
      </div>
      <label class="f"><span>Penyulang</span><input data-o="feeder" list="dlFeeders" value="${esc(o.feeder)}" placeholder="kosong = ikut aset asal"></label>`;
    let h = '';
    if (this.mode === 'select') {
      h = `<p class="hint">Klik aset/saluran untuk melihat & mengubah data. <kbd>Del</kbd> menghapus yang dipilih.</p>
        <label class="chk"><input type="checkbox" data-o="allowDrag" ${o.allowDrag ? 'checked' : ''}> Izinkan geser posisi aset</label>`;
    } else if (this.mode === 'asset') {
      h = `<div class="typegrid">${Object.entries(ASSET_TYPES).map(([k, T]) =>
            `<button data-type="${k}" class="${o.type === k ? 'active' : ''}" style="--c:${T.color}"><i></i>${T.label}</button>`).join('')}</div>
        <p class="hint">Klik peta untuk menaruh aset. Klik aset lain untuk menjadikannya titik sambung.</p>
        <label class="chk"><input type="checkbox" data-o="autoConnect" ${o.autoConnect ? 'checked' : ''}> Sambung otomatis dari aset terakhir${o.autoConnect && Store.asset(this.lastAssetId) ? ` (<b>${esc(Store.asset(this.lastAssetId).code)}</b>)` : ''}</label>
        ${o.autoConnect ? common : `<label class="f"><span>Penyulang</span><input data-o="feeder" list="dlFeeders" value="${esc(o.feeder)}"></label>`}
        ${pendHtml}
        <button class="btn primary block" id="btnGpsAdd">📍 Tambah aset di posisi GPS saya</button>
        <details class="coord" ${this.coordOpen || this.placing != null ? 'open' : ''}><summary>${this.placing != null ? 'Tempel koordinat peralatan' : 'Tambah lewat titik koordinat'}</summary>
          <label class="f"><span>Koordinat (lat, lng)</span><input id="coordIn" placeholder="-3.0110318, 127.9506499" autocomplete="off"></label>
          <div class="grid2">
            <label class="f"><span>Kode</span><input id="coordCode" placeholder="mis. PLTD-BUANO"></label>
            <label class="f"><span>Nama</span><input id="coordName" placeholder="mis. PLTD Buano"></label>
          </div>
          <p class="hint">Bisa tempel dari Google Maps/GIS: <code>-3,0110 127,9506</code>, <code>-3.0110, 127.9506</code>, atau DMS <code>3°0'39.7"S 127°57'2.3"E</code>.</p>
          <button class="btn primary block" id="btnCoordAdd">${this.placing != null ? 'Tempatkan ' + esc(pend[this.placing].name) + ' di koordinat ini' : 'Tambah ' + esc(ASSET_TYPES[o.type].label) + ' di koordinat ini'}</button>
        </details>`;
    } else if (this.mode === 'line') {
      h = `<p class="hint">${this.draft
          ? `Dari <b>${esc(Store.asset(this.draft.from)?.code)}</b> — klik peta untuk titik belok, klik aset tujuan untuk selesai. Panjang: <b id="draftLen">-</b><br><kbd>Enter</kbd> = akhiri dengan tiang baru, <kbd>Esc</kbd> = batal.`
          : 'Klik <b>aset awal</b>, lalu (opsional) klik titik belok di peta mengikuti jalur, lalu klik <b>aset tujuan</b>.'}</p>${common}`;
    } else if (this.mode === 'measure') {
      h = `<p class="hint">Klik titik-titik di peta/aset untuk mengukur jarak. <kbd>Esc</kbd> untuk ulang.</p>
        <div class="big">Jarak: <b id="draftLen">${fmt.m(Geo.pathLen(this.measurePts))}</b></div>`;
    }
    el.innerHTML = h;
    el.querySelectorAll('[data-o]').forEach(i => i.onchange = () => {
      this.opts[i.dataset.o] = i.type === 'checkbox' ? i.checked : i.value;
      if (i.dataset.o === 'allowDrag') this.render();
      if (i.dataset.o === 'autoConnect') this.renderModeOpts();
    });
    el.querySelectorAll('[data-type]').forEach(b => b.onclick = () => { this.opts.type = b.dataset.type; this.renderModeOpts(); });
    const g = el.querySelector('#btnGpsAdd'); if (g) g.onclick = () => this.locate(true);
    const det = el.querySelector('details.coord'); if (det) det.ontoggle = () => { this.coordOpen = det.open; };
    el.querySelectorAll('[data-place]').forEach(b => b.onclick = () => this.startPlacing(+b.dataset.place));
    el.querySelectorAll('[data-unpend]').forEach(b => b.onclick = () => { if (confirm('Hapus dari daftar belum bertikor?')) Store.mutate(d => { d.pending.splice(+b.dataset.unpend, 1); }, 'edit'); });
    const pc = el.querySelector('#btnPlaceCancel'); if (pc) pc.onclick = () => { this.placing = null; this.renderModeOpts(); };
    const c = el.querySelector('#btnCoordAdd');
    if (c) c.onclick = () => {
      const p = parseCoord(el.querySelector('#coordIn').value);
      if (!p) return App.toast('Koordinat tidak dikenali — pakai format "lat, lng"');
      if (this.placing != null) { this.placePending(p); this.map.setView(p, Math.max(this.map.getZoom(), 16)); return; }
      const code = el.querySelector('#coordCode').value.trim(), name = el.querySelector('#coordName').value.trim();
      if (code && Store.byCode(code)) return App.toast(`Kode ${code} sudah dipakai aset lain`);
      this.placeAsset(p, { code, name });
      this.map.setView(p, Math.max(this.map.getZoom(), 16));
    };
  },

  renderEditor() {
    const el = document.getElementById('editor');
    if (!el) return;
    const s = this.sel;
    if (!s || (s.kind === 'asset' ? !Store.asset(s.id) : !Store.line(s.id))) { this.sel = null; el.innerHTML = this.summaryHtml(); return; }
    el.innerHTML = s.kind === 'asset' ? this.assetForm(Store.asset(s.id)) : this.lineForm(Store.line(s.id));
    el.querySelectorAll('[data-k]').forEach(inp => inp.onchange = () => {
      const k = inp.dataset.k;
      let v = inp.type === 'checkbox' ? inp.checked : inp.value;
      if (inp.dataset.num !== undefined) v = num(v);
      if (k === 'kondisi') { Store.mutate(() => { const o = Store.asset(s.id); o.rusak = v === 'rusak'; o.aktif = v === 'belum' ? false : true; }, 'edit'); return; }
      if (k === 'code' && v && Store.byCode(v) && Store.byCode(v).id !== s.id) { App.toast(`Kode ${v} sudah dipakai aset lain`); inp.value = Store.asset(s.id).code; return; }
      Store.mutate(() => { const o = s.kind === 'asset' ? Store.asset(s.id) : Store.line(s.id); o[k] = v; }, 'edit');
    });
    el.querySelectorAll('[data-sel]').forEach(b => b.onclick = () => { const [k, id] = b.dataset.sel.split(':'); this.select(k, id, true); });
    el.querySelectorAll('[data-act]').forEach(b => b.onclick = () => this.action(b.dataset.act));
  },

  action(act) {
    const s = this.sel;
    if (act === 'delete') return this.deleteSelected();
    if (act === 'zoom') return this.select(s.kind, s.id, true);
    if (act === 'sld') return App.showSld(s.id);
    if (act === 'dist') return App.showDistance(Store.asset(s.id).code);
    if (act === 'reverse') return Store.mutate(() => { const l = Store.line(s.id); [l.from, l.to] = [l.to, l.from]; l.path = (l.path || []).slice().reverse(); }, 'edit');
    if (act === 'clearpath') return Store.mutate(() => { Store.line(s.id).path = []; }, 'edit');
    if (act === 'toggle') return Store.mutate(() => { const a = Store.asset(s.id); a.status = a.status === 'NO' ? 'NC' : 'NO'; }, 'edit');
    if (act === 'connect') { this.setMode('line'); this.draft = { from: s.id, pts: [] }; this.renderModeOpts(); this.renderDraft(); }
    if (act === 'autoconnect') return this.autoConnect(s.id);
  },

  // sambungkan aset ke aset jaringan terdekat (tiang TM / gardu / GH) dengan satu ruas JTM
  autoConnect(id) {
    const a = Store.asset(id);
    const linked = new Set(Store.linesOf(id).map(l => l.from === id ? l.to : l.from));
    let best = null;
    for (const b of Store.data.assets) {
      if (b.id === id || linked.has(b.id) || b.sub === 'TR' || ASSET_TYPES[b.type]?.source) continue;
      if (b.type === 'TIANG' && !Store.linesOf(b.id).some(l => l.level === 'JTM')) continue; // tiang yatim
      const d = Geo.dist([a.lat, a.lng], [b.lat, b.lng]);
      if (!best || d < best.d) best = { b, d };
    }
    if (!best) return App.toast('Tidak ada aset jaringan untuk disambung');
    if (best.d > 2000 && !confirm(`Aset jaringan terdekat (${best.b.code}) berjarak ${fmt.m(best.d)}. Tetap sambungkan?`)) return;
    const l = Store.addLine({ from: id, to: best.b.id, conductor: this.opts.conductor, level: 'JTM', feeder: a.feeder || best.b.feeder || '', note: 'Sambungan otomatis ke aset terdekat' });
    this.select('line', l.id);
    const T = ASSET_TYPES[a.type];
    App.toast(`${a.code} disambung ke ${best.b.code} (${fmt.m(best.d)})` + (T?.source ? ' — buka tab SLD' : ''));
    if (T?.source) setTimeout(() => App.showSld(id), 600);
  },

  assetForm(a) {
    const T = ASSET_TYPES[a.type] || {};
    const lines = Store.linesOf(a.id);
    let near = '';
    if (!T.source) {
      const res = Net.nearest(a.id, ['PLTD', 'GI', 'GH'].filter(t => Store.data.assets.some(x => x.type === t)));
      near = res.map(r => `<tr><td>${ASSET_TYPES[r.type].short} terdekat</td><td>${r.net
        ? `<a href="#" data-sel="asset:${r.net.a.id}">${esc(r.net.a.code)}</a> via jaringan <b>${fmt.m(r.net.d)}</b>`
        : '<span class="muted">tidak tersambung</span>'}${r.air ? `<br><span class="muted">garis lurus: ${esc(r.air.a.code)} ${fmt.m(r.air.d)}</span>` : ''}</td></tr>`).join('');
    }
    return `
      <div class="ed-head"><span class="dot" style="background:${T.color}"></span>${esc(T.label)}
        <button class="x" onclick="MapView.select(null,null)">✕</button></div>
      <label class="f"><span>Jenis</span><select data-k="type">${Object.entries(ASSET_TYPES).map(([k, t]) => `<option value="${k}" ${k === a.type ? 'selected' : ''}>${t.label}</option>`).join('')}</select></label>
      <div class="grid2">
        <label class="f"><span>Kode / No. Gardu</span><input data-k="code" value="${esc(a.code)}"></label>
        <label class="f"><span>Penyulang</span><input data-k="feeder" list="dlFeeders" value="${esc(a.feeder)}"></label>
      </div>
      <label class="f"><span>Nama / Lokasi</span><input data-k="name" value="${esc(a.name)}"></label>
      <div class="grid2">
        <label class="f"><span>Latitude</span><input data-k="lat" data-num value="${a.lat ?? ''}"></label>
        <label class="f"><span>Longitude</span><input data-k="lng" data-num value="${a.lng ?? ''}"></label>
      </div>
      ${T.load ? `<div class="grid2">
        <label class="f"><span>Kapasitas (kVA)</span><input data-k="kva" data-num inputmode="decimal" value="${a.kva ?? ''}"></label>
        <label class="f"><span>Beban (kVA) ukur/estimasi</span><input data-k="loadKva" data-num inputmode="decimal" value="${a.loadKva ?? ''}" placeholder="atau isi % beban →"></label>
        <label class="f"><span>Beban terukur (%)</span><input data-k="loadPct" data-num inputmode="decimal" value="${a.loadPct ?? ''}" placeholder="default ${Store.data.params.loadPct}%"></label>
        ${num(a.kva) && num(a.loadKva) != null ? `<div class="f"><span>Pembebanan trafo</span><b class="${a.loadKva / a.kva > 1 ? 'bad' : a.loadKva / a.kva > 0.8 ? 'warn' : ''}">${fmt.n(a.loadKva / a.kva * 100, 0)} %</b></div>` : ''}
        <label class="f"><span>Merk</span><input data-k="merk" value="${esc(a.merk)}"></label>
        <label class="f"><span>Tahun</span><input data-k="tahun" value="${esc(a.tahun)}"></label>
      </div>` : ''}
      ${a.nCust != null ? `<table class="kv">
        <tr><td>Pelanggan (APP)</td><td><b>${fmt.n(a.nCust, 0)}</b> · daya tersambung ${fmt.n(a.connKva, 1)} kVA</td></tr>
        ${a.loadSrc ? `<tr><td>Beban</td><td>${esc(a.loadSrc)}</td></tr>` : ''}
        ${a.custMaxM != null ? `<tr><td>Pelanggan terjauh</td><td class="${a.custMaxM > 500 ? 'warn' : ''}">${fmt.m(a.custMaxM)} (garis lurus)</td></tr>` : ''}
        ${a.jtrGisM != null ? `<tr><td>Panjang JTR (GIS)</td><td>${fmt.m(a.jtrGisM)}</td></tr>` : ''}
      </table>` : ''}
      ${a.type === 'REC' ? `<label class="f"><span>Jenis</span><select data-k="sub"><option value="" ${!a.sub ? 'selected' : ''}>Recloser</option><option value="cb" ${a.sub === 'cb' ? 'selected' : ''}>CB / PMT outgoing penyulang</option><option value="pmcb" ${a.sub === 'pmcb' ? 'selected' : ''}>PMCB</option></select></label>` : ''}
      ${a.zona || a.section ? `<p class="hint">Zona/Section: <b>${esc(a.zona)} / ${esc(a.section)}</b>${a.kondisi ? ' · Kondisi: ' + esc(a.kondisi) : ''}</p>` : ''}
      ${a.type === 'LBS' ? `<label class="f"><span>Jenis saklar</span><select data-k="sub"><option value="" ${!a.sub ? 'selected' : ''}>LBS manual</option><option value="motor" ${a.sub === 'motor' ? 'selected' : ''}>LBS motorised (M)</option><option value="sect" ${a.sub === 'sect' ? 'selected' : ''}>Sectionalizer (S)</option></select></label>` : ''}
      ${a.type === 'GD' ? `<div class="grid2"><label class="f"><span>Jenis gardu</span><select data-k="mount"><option value="" ${!a.mount ? 'selected' : ''}>Trafo tiang / portal (2 tiang)</option><option value="cantol" ${a.mount === 'cantol' ? 'selected' : ''}>Cantol (1 tiang)</option><option value="beton" ${a.mount === 'beton' ? 'selected' : ''}>Gardu beton</option></select></label>
        <label class="f"><span>Kondisi</span><select data-k="kondisi"><option value="" ${!a.rusak && a.aktif !== false ? 'selected' : ''}>Aktif</option><option value="belum" ${a.aktif === false ? 'selected' : ''}>Belum aktif</option><option value="rusak" ${a.rusak ? 'selected' : ''}>Rusak</option></select></label></div>` : ''}
      ${a.type !== 'TIANG' ? `<label class="chk"><input type="checkbox" data-k="scada" ${a.scada ? 'checked' : ''}> Key Point SCADA</label>` : ''}
      ${T.sw ? `<label class="f"><span>Status operasi</span><select data-k="status"><option value="NC" ${a.status !== 'NO' ? 'selected' : ''}>NC — Normally Close (masuk)</option><option value="NO" ${a.status === 'NO' ? 'selected' : ''}>NO — Normally Open (titik buka)</option></select></label>` : ''}
      <label class="f"><span>Keterangan</span><textarea data-k="note" rows="2">${esc(a.note)}</textarea></label>
      <div class="btnrow">
        <button class="btn" data-act="zoom">🔍 Zoom</button>
        <button class="btn" data-act="connect">〰 Sambung</button>
        ${!lines.length || T.source ? '<button class="btn primary" data-act="autoconnect">⚡ Sambung ke jaringan terdekat</button>' : ''}
        <button class="btn" data-act="sld">SLD</button>
        <button class="btn" data-act="dist">📏 Jarak</button>
        <button class="btn danger" data-act="delete">Hapus</button>
      </div>
      <h4>Saluran tersambung (${lines.length})</h4>
      <ul class="mini">${lines.map(l => {
        const o = Store.asset(l.from === a.id ? l.to : l.from);
        return `<li><a href="#" data-sel="line:${l.id}">↔ ${esc(o?.code)}</a> · ${fmt.m(Store.lineLength(l))} · ${esc(l.conductor)}</li>`;
      }).join('') || '<li class="muted">Belum tersambung</li>'}</ul>
      ${near ? `<h4>Jarak ke sumber</h4><table class="kv">${near}</table>` : ''}`;
  },

  lineForm(l) {
    const a = Store.asset(l.from), b = Store.asset(l.to);
    const geo = Store.lineGeoLength(l);
    return `
      <div class="ed-head"><span class="dot" style="background:${feederColor(l.feeder)}"></span>Saluran ${esc(l.level)}
        <button class="x" onclick="MapView.select(null,null)">✕</button></div>
      <p class="route"><a href="#" data-sel="asset:${a?.id}">${esc(a?.code)}</a> → <a href="#" data-sel="asset:${b?.id}">${esc(b?.code)}</a></p>
      <div class="big">${fmt.m(Store.lineLength(l))} <small>${num(l.lengthM) > 0 ? '(ukur manual)' : '(dari peta)'}</small></div>
      <div class="grid2">
        <label class="f"><span>Penghantar</span><select data-k="conductor">${this.condOptions(l.conductor)}</select></label>
        <label class="f"><span>Level</span><select data-k="level"><option ${l.level === 'JTM' ? 'selected' : ''}>JTM</option><option ${l.level === 'JTR' ? 'selected' : ''}>JTR</option></select></label>
      </div>
      <label class="f"><span>Penyulang</span><input data-k="feeder" list="dlFeeders" value="${esc(l.feeder)}"></label>
      <div class="grid2">
        <label class="f"><span>Panjang di peta</span><input disabled value="${Math.round(geo)} m"></label>
        <label class="f"><span>Panjang ukur (m)</span><input data-k="lengthM" data-num inputmode="decimal" value="${l.lengthM ?? ''}" placeholder="opsional"></label>
      </div>
      ${l.auto ? `<div class="warnbox small">Ruas ini <b>hasil rekonstruksi otomatis</b>${l.gap ? ' dan <b>panjangnya mencurigakan</b>' : ''} — verifikasi di lapangan/citra satelit, lalu hapus atau perbaiki bila salah.</div>` : ''}
      <p class="hint">Titik belok: ${(l.path || []).length}. Isi "panjang ukur" bila ada data meteran/as-built — nilai ini dipakai di perhitungan.</p>
      <label class="f"><span>Keterangan</span><textarea data-k="note" rows="2">${esc(l.note)}</textarea></label>
      <div class="btnrow">
        <button class="btn" data-act="zoom">🔍 Zoom</button>
        <button class="btn" data-act="reverse">⇄ Balik arah</button>
        ${(l.path || []).length ? '<button class="btn" data-act="clearpath">Luruskan</button>' : ''}
        <button class="btn danger" data-act="delete">Hapus</button>
      </div>`;
  },

  summaryHtml() {
    const d = Store.data;
    const byType = Object.keys(ASSET_TYPES).map(k => [k, d.assets.filter(a => a.type === k).length]).filter(x => x[1]);
    const feeders = {};
    let jtrM = 0;
    d.lines.forEach(l => { if (l.level === 'JTR') { jtrM += Store.lineLength(l); return; } const f = l.feeder || '(tanpa penyulang)'; feeders[f] = (feeders[f] || 0) + Store.lineLength(l); });
    if (!d.assets.length) return `
      <div class="empty">
        <h3>Mulai dari sini</h3>
        <ol>
          <li>Pilih mode <b>➕ Aset</b>, pilih jenis, lalu klik di peta (atau pakai GPS saat survei).</li>
          <li>Pilih mode <b>〰 Saluran</b> untuk menyambung antar aset — jarak dihitung otomatis.</li>
          <li>Buka tab <b>SLD</b> untuk diagram segaris otomatis.</li>
        </ol>
        <p>Punya data GIS PLN, Excel, atau KML/KMZ? Import di tab <b>Data</b>.</p>
      </div>`;
    return `
      <h4>Ringkasan ${esc(d.meta.name)}</h4>
      <div class="chips">${byType.map(([k, n]) => `<span class="chip" style="--c:${ASSET_TYPES[k].color}"><i></i>${ASSET_TYPES[k].short} ${n}</span>`).join('')}</div>
      <table class="kv">
        <tr><td>Total aset</td><td><b>${d.assets.length}</b></td></tr>
        <tr><td>JTM</td><td><b>${d.lines.filter(l => l.level !== 'JTR').length}</b> ruas · ${fmt.m(Object.values(feeders).reduce((s, v) => s + v, 0))}</td></tr>
        ${jtrM ? `<tr><td>JTR</td><td><b>${d.lines.filter(l => l.level === 'JTR').length}</b> ruas · ${fmt.m(jtrM)}</td></tr>` : ''}
        ${(d.customers || []).length ? `<tr><td>Pelanggan (APP)</td><td><b>${fmt.n(d.customers.length, 0)}</b></td></tr>` : ''}
        ${(d.pending || []).length ? `<tr><td>Peralatan belum bertikor</td><td class="warn">${d.pending.length} — tempatkan lewat mode ➕ Aset</td></tr>` : ''}
        ${d.lines.some(l => l.gap) ? `<tr><td>Ruas perlu dicek</td><td class="bad">${d.lines.filter(l => l.gap).length} ruas (merah putus-putus)</td></tr>` : ''}
        <tr><td>Kapasitas trafo</td><td><b>${fmt.n(d.assets.filter(a => a.type === 'GD').reduce((s, a) => s + (num(a.kva) || 0), 0), 0)} kVA</b></td></tr>
      </table>
      <h4>Panjang JTM per penyulang</h4>
      <ul class="mini">${Object.entries(feeders).sort().map(([f, m]) => `<li><span class="sw" style="background:${feederColor(f === '(tanpa penyulang)' ? '' : f)}"></span>${esc(f)} — <b>${fmt.m(m)}</b></li>`).join('')}</ul>
      <p class="hint">Tip: gunakan layer <b>Satelit</b> (kanan atas peta) untuk menelusuri jalur tiang dari citra.</p>`;
  },
};
