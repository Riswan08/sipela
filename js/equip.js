'use strict';
/* ============================================================
 * EquipImport: import "Data Aset" peralatan (CB penyulang, LBS, Recloser,
 * PMCB, FCO, GH, titik percabangan) beserta zona/section, merk, RTU, kondisi.
 * Peralatan ditempelkan ke tiang TM terdekat di sistem aktif sehingga
 * langsung masuk topologi & SLD. CB penyulang membentuk aset Gardu Induk.
 * ============================================================ */

const EquipImport = {
  parsed: null,

  typeOf(name) {
    const n = String(name || '').toUpperCase().trim();
    if (/^CB\b|^PMT\b|^OUTGOING/.test(n)) return { type: 'REC', sub: 'cb' };
    if (/^PMCB/.test(n)) return { type: 'REC', sub: 'pmcb' };
    if (/^REC|RECLOSER/.test(n)) return { type: 'REC', sub: '' };
    if (/^LBS|^SSO|^SECTION/.test(n)) return { type: 'LBS', sub: '' };
    if (/^FCO|FUSE/.test(n)) return { type: 'FCO', sub: '' };
    if (/^GH\b|GARDU HUBUNG/.test(n)) return { type: 'GH', sub: '' };
    if (/^GI\b|GARDU INDUK/.test(n)) return { type: 'GI', sub: '' };
    if (/^PERC|PERCABANGAN|^TP\b|^LRG\b|^LORONG|^GG\b/.test(n)) return { type: 'TIANG', sub: '' };
    if (/^GD\b|^GT\b|TRAFO/.test(n)) return { type: 'GD', sub: '' };
    return { type: 'LBS', sub: '' };
  },
  // ambil kolom: cocok persis dulu, lalu yang diawali nama (kolom terpendek diutamakan, mis. "Nama Peralatan" bukan "Nama Peralatan Tujuan …")
  col(r, ...keys) {
    const hs = Object.keys(r).sort((a, b) => a.length - b.length);
    for (const k of keys) {
      const K = k.toUpperCase();
      const hit = hs.find(h => h.toUpperCase() === K) || hs.find(h => h.toUpperCase().startsWith(K));
      if (hit && r[hit] !== '' && r[hit] != null) return r[hit];
    }
    return '';
  },

  async read(file) {
    if (!window.XLSX) throw new Error('Library Excel belum termuat (butuh internet)');
    const wb = XLSX.read(await IO.readFile(file, 'buffer'), { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames.find(n => /aset|peralatan/i.test(n)) || wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(ws, { defval: '' }).map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [String(k).trim(), typeof v === 'string' ? v.trim() : v])));
    const rows = raw.map((r, i) => {
      const name = String(this.col(r, 'Nama Peralatan') || '').trim();
      const lat = num(this.col(r, 'Latitude', 'Lat')), lng = num(String(this.col(r, 'Longitude', 'Long', 'Lng')).trim());
      const t = this.typeOf(name);
      const rtu = /ada/i.test(String(this.col(r, 'RTU'))) && !/tidak/i.test(String(this.col(r, 'RTU')));
      return {
        i, name, ...t, lat, lng, ok: lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180,
        sistem: String(this.col(r, 'Sistem') || '').trim(), feeder: String(this.col(r, 'Penyulang') || '').trim().toUpperCase(),
        zona: String(this.col(r, 'Zona') || ''), section: String(this.col(r, 'Section') || ''), merk: String(this.col(r, 'Merk') || ''),
        rtu, kondisi: String(this.col(r, 'Kondisi') || ''), nCust: num(this.col(r, 'Jumlah Pelanggan')),
        cond: [this.col(r, 'Jenis Penghantar'), this.col(r, 'Kapasitas Penghantar')].filter(Boolean).join(' '),
        kmsSection: num(this.col(r, 'Panjang Jaringan')), parent: String(this.col(r, 'Cabang / Lateral') || ''),
        kva: num(this.col(r, 'Daya Trafo')),
      };
    }).filter(r => r.name);
    this.parsed = { file: file.name, rows };
    return this.parsed;
  },

  // nama penyulang di file (ref) → nama penyulang di sistem aktif (GIS), mis. LETWARU → LETWARU/KOTA B
  feederMap() {
    const map = {};
    for (const g of Store.feeders()) {
      const m = SistemRef.match(g, Store.data.meta.ulp);
      map[SistemRef.norm(g)] = g;
      if (m) map[SistemRef.norm(m.penyulang)] = g;
    }
    return map;
  },
  nearestPole(p, maxM, feeder) {
    let best = null;
    for (const a of Store.data.assets) {
      if (a.type !== 'TIANG' || a.sub === 'TR') continue;
      if (feeder && a.feeder && a.feeder !== feeder) continue;
      const box = maxM / 100000; // ≈ derajat; saring kasar sebelum hitung jarak
      if (Math.abs(a.lat - p[0]) > box || Math.abs(a.lng - p[1]) > box) continue;
      const d = Geo.dist(p, [a.lat, a.lng]);
      if (d <= maxM && (!best || d < best.d)) best = { a, d };
    }
    return best;
  },

  run(o) {
    const mineAll = this.parsed.rows.filter(r => !o.sistem || !r.sistem || SistemRef.norm(r.sistem) === SistemRef.norm(o.sistem));
    const rows = mineAll.filter(r => r.ok), noCoord = mineAll.filter(r => !r.ok);
    const fmap = this.feederMap();
    const rep = { conv: 0, add: 0, link: 0, alone: 0, upd: 0, gi: null, skipped: this.parsed.rows.length - mineAll.length, pending: 0, warn: [] };
    Store.mutate(d => {
      // peralatan tanpa koordinat: simpan sebagai "belum bertikor" untuk ditempatkan lewat peta
      d.pending = d.pending || [];
      for (const r of noCoord) {
        if (Store.byCode(r.name) || d.pending.some(p => p.name === r.name)) continue;
        d.pending.push({ name: r.name, type: r.type, sub: r.type === 'LBS' ? (r.rtu ? 'motor' : '') : r.sub, feeder: fmap[SistemRef.norm(r.feeder)] || r.feeder,
          merk: r.merk, scada: r.rtu, zona: r.zona, section: r.section, kondisi: r.kondisi, nCust: r.nCust, parent: r.parent, kva: r.kva });
        rep.pending++;
      }
      // 1. Gardu Induk dari titik CB penyulang (semua CB biasanya di koordinat GI yang sama)
      const cbs = rows.filter(r => r.sub === 'cb');
      let gi = d.assets.find(a => a.type === 'GI');
      if (cbs.length && !gi) {
        const lat = cbs.reduce((s, r) => s + r.lat, 0) / cbs.length, lng = cbs.reduce((s, r) => s + r.lng, 0) / cbs.length;
        gi = Store._newAsset({ type: 'GI', code: 'GI ' + (d.meta.sistem || d.meta.name).toUpperCase().replace(/^SISTEM\s+/, ''), name: 'Gardu Induk', lat: +lat.toFixed(7), lng: +lng.toFixed(7), scada: true, src: 'equip' });
        rep.gi = gi.code;
      }
      for (const r of rows) {
        const feeder = fmap[SistemRef.norm(r.feeder)] || r.feeder;
        const props = {
          code: r.name, name: r.name, feeder, merk: r.merk, scada: r.rtu, zona: r.zona, section: r.section, kondisi: r.kondisi,
          sub: r.type === 'LBS' ? (r.rtu ? 'motor' : '') : r.sub, status: 'NC', src: 'equip',
          note: [r.zona && r.section ? `${r.zona} / ${r.section}` : '', r.cond ? 'Penghantar ' + r.cond : '', r.nCust != null ? `${fmt.n(r.nCust, 0)} pelanggan hilir` : '',
            r.kmsSection ? `panjang section ${r.kmsSection} kms` : '', r.parent ? 'cabang dari ' + r.parent : '', r.kondisi && !/baik/i.test(r.kondisi) ? 'Kondisi: ' + r.kondisi : ''].filter(Boolean).join(' · '),
        };
        if (r.kva) props.kva = r.kva;
        const p = [r.lat, r.lng];
        const ex = Store.byCode(r.name);
        if (ex) { Object.assign(ex, props, { lat: ex.lat, lng: ex.lng }); rep.upd++; continue; }
        // CB penyulang: dipasang di tiang TM pertama penyulang itu dari GI, lalu GI disambung ke sana
        if (r.sub === 'cb' && gi) {
          const near = this.nearestPole(p, o.maxLinkM, feeder);
          if (near) {
            Object.assign(near.a, props, { type: 'REC' });
            if (!Store.linesOf(gi.id).some(l => l.from === near.a.id || l.to === near.a.id))
              Store._newLine({ from: gi.id, to: near.a.id, level: 'JTM', conductor: 'XLPE-240', feeder, note: `Outgoing ${r.name} dari GI` });
            rep.conv++; rep.link++;
          } else {
            // tiang penyulang ini tidak ada di dekat GI: CB dibuat di sisi GI, disambung ke jalur penyulang terdekat dengan ruas bertanda
            const k = d.assets.filter(a => a.sub === 'cb').length;
            const cb = Store._newAsset({ ...props, type: 'REC', lat: +(gi.lat + 0.0002 * (k + 1)).toFixed(7), lng: +(gi.lng + 0.0002).toFixed(7) });
            Store._newLine({ from: gi.id, to: cb.id, level: 'JTM', conductor: 'XLPE-240', feeder, note: `Outgoing ${r.name} dari GI` });
            const far = this.nearestPole(p, 15000, feeder);
            if (far) { Store._newLine({ from: cb.id, to: far.a.id, level: 'JTM', conductor: Store.linesOf(far.a.id)[0]?.conductor || 'AAAC-150', feeder, auto: true, gap: true, note: `Jalur ${feeder} dari GI ke ${far.a.code} belum terdata di GIS (${Math.round(far.d)} m garis lurus) — cek lapangan` }); rep.warn.push(`${r.name}: tiang TM ${feeder} terdekat ${Math.round(far.d)} m dari GI — disambung dengan ruas bertanda merah`); }
            else rep.warn.push(`${r.name}: tidak ada tiang TM penyulang ${feeder} — CB dibuat di GI, belum tersambung ke jalur`);
            rep.add++;
          }
          continue;
        }
        const near = this.nearestPole(p, o.snapM, feeder) || (!feeder ? this.nearestPole(p, o.snapM) : null);
        if (near && r.type !== 'GH') {
          // ubah tiang menjadi peralatan (sambungan tetap)
          Object.assign(near.a, props, { type: r.type });
          rep.conv++;
        } else {
          const a = Store._newAsset({ ...props, type: r.type, lat: r.lat, lng: r.lng });
          const far = this.nearestPole(p, o.maxLinkM, feeder) || (!feeder ? this.nearestPole(p, o.maxLinkM) : null);
          if (far) { Store._newLine({ from: far.a.id, to: a.id, level: 'JTM', conductor: Store.linesOf(far.a.id)[0]?.conductor || 'AAAC-70', feeder, auto: true, note: `Sambungan otomatis ke ${r.name} (${Math.round(far.d)} m)` }); rep.link++; }
          else { rep.alone++; rep.warn.push(`${r.name}: tidak ada tiang TM dalam ${o.maxLinkM} m — belum tersambung`); }
          rep.add++;
        }
      }
    }, 'import');
    return [
      rep.gi ? `Gardu Induk dibuat: ${rep.gi} (dari koordinat CB penyulang)` : '',
      `${rep.conv} peralatan dipasang di tiang TM terdekat (≤ ${o.snapM} m), ${rep.add} dibuat sebagai aset baru (${rep.link} disambung otomatis, ${rep.alone} belum tersambung), ${rep.upd} diperbarui`,
      rep.pending ? `${rep.pending} peralatan tanpa koordinat disimpan di daftar "belum bertikor" — tempatkan lewat tab Peta (klik peta / tempel koordinat)` : '',
      rep.skipped ? `${rep.skipped} baris milik sistem lain dilewati` : '',
      ...rep.warn,
    ].filter(Boolean);
  },

  // tempatkan peralatan dari daftar pending di koordinat p: menempel ke tiang TM terdekat (≤ snapM) atau aset baru + sambung otomatis
  place(idx, p, o = { snapM: 80, maxLinkM: 1500 }) {
    const pd = Store.data.pending[idx]; if (!pd) return null;
    const props = { code: pd.name, name: pd.name, feeder: pd.feeder, merk: pd.merk, scada: pd.scada, zona: pd.zona, section: pd.section, kondisi: pd.kondisi,
      sub: pd.sub || '', status: 'NC', src: 'equip', kva: pd.kva ?? null,
      note: [pd.zona && pd.section ? `${pd.zona} / ${pd.section}` : '', pd.nCust != null ? `${fmt.n(pd.nCust, 0)} pelanggan hilir` : '', pd.parent ? 'cabang dari ' + pd.parent : ''].filter(Boolean).join(' · ') };
    let result = null;
    Store.mutate(d => {
      const near = this.nearestPole(p, o.snapM, pd.feeder) || (!pd.feeder ? this.nearestPole(p, o.snapM) : null);
      if (near && pd.type !== 'GH' && pd.type !== 'GI') { Object.assign(near.a, props, { type: pd.type }); result = { a: near.a, how: `dipasang di tiang ${near.a.code}` }; }
      else {
        const a = Store._newAsset({ ...props, type: pd.type, lat: p[0], lng: p[1] });
        const far = this.nearestPole(p, o.maxLinkM, pd.feeder) || (!pd.feeder ? this.nearestPole(p, o.maxLinkM) : null);
        if (far) { Store._newLine({ from: far.a.id, to: a.id, level: 'JTM', conductor: Store.linesOf(far.a.id)[0]?.conductor || 'AAAC-70', feeder: pd.feeder, auto: true, note: `Sambungan otomatis (${Math.round(far.d)} m)` }); result = { a, how: `disambung ke ${far.a.code} (${Math.round(far.d)} m)` }; }
        else result = { a, how: 'belum tersambung — tidak ada tiang TM dalam ' + o.maxLinkM + ' m' };
      }
      d.pending.splice(idx, 1);
    }, 'asset');
    return result;
  },

  /* ---------- UI ---------- */
  card() {
    return `<section class="card">
      <h3>Import peralatan (Data Aset: CB, LBS, Recloser, FCO, GH)</h3>
      <p class="small muted">File .xlsx "Data Aset" dengan kolom Nama Peralatan, Penyulang, Zona, Section, Latitude/Longitude, Merk, RTU, Kondisi. Peralatan ditempelkan ke tiang TM terdekat di <b>sistem aktif</b> sehingga muncul di SLD; CB penyulang membentuk Gardu Induk; RTU "Ada" = Key Point SCADA.</p>
      <label class="btn file">⬆ Pilih file Data Aset<input type="file" accept=".xlsx,.xls" id="eqFile"></label>
      <div id="eqPrev"></div>
    </section>`;
  },
  bind(el) {
    const inp = el.querySelector('#eqFile');
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      const box = el.querySelector('#eqPrev');
      try { await this.read(f); this.renderPreview(); }
      catch (e) { console.error(e); box.innerHTML = `<div class="warnbox">Gagal membaca ${esc(f.name)}: ${esc(e.message)}</div>`; }
      inp.value = '';
    };
    if (this.parsed) this.renderPreview();
  },
  renderPreview() {
    const box = document.getElementById('eqPrev'); if (!box) return;
    const P = this.parsed, cur = Store.data.meta.sistem || Store.data.meta.name.replace(/^Sistem\s+/i, '');
    const ok = P.rows.filter(r => r.ok), mine = ok.filter(r => !r.sistem || SistemRef.norm(r.sistem) === SistemRef.norm(cur));
    const bySys = {}; ok.forEach(r => { bySys[r.sistem || '?'] = (bySys[r.sistem || '?'] || 0) + 1; });
    box.innerHTML = `
      <div class="okbox"><b>${esc(P.file)}</b>: ${P.rows.length} peralatan, ${ok.length} punya koordinat (${Object.entries(bySys).map(([k, v]) => `${esc(k)} ${v}`).join(', ')}).
        ${P.rows.length - ok.length ? `<br><span class="warn">${P.rows.length - ok.length} tanpa koordinat dilewati:</span> <span class="small">${P.rows.filter(r => !r.ok).map(r => esc(r.name)).join(', ')}</span>` : ''}</div>
      <p>Sistem aktif: <b>${esc(cur)}</b> → <b>${mine.length}</b> peralatan akan diimport${mine.length !== ok.length ? ` (${ok.length - mine.length} milik sistem lain — pindah sistem lalu import lagi)` : ''}.</p>
      <div class="tbl-wrap short"><table class="tbl compact"><thead><tr><th>Peralatan</th><th>Jenis</th><th>Penyulang</th><th>Zona/Section</th><th>RTU</th><th>Merk</th><th>Kondisi</th></tr></thead>
        <tbody>${mine.map(r => `<tr><td><b>${esc(r.name)}</b></td><td>${esc(ASSET_TYPES[r.type]?.short)}${r.sub ? ' ' + esc(r.sub) : ''}</td><td>${esc(r.feeder)}</td><td class="small">${esc(r.zona)} / ${esc(r.section)}</td><td>${r.rtu ? 'SCADA' : ''}</td><td class="small">${esc(r.merk)}</td><td>${esc(r.kondisi)}</td></tr>`).join('')}</tbody></table></div>
      <div class="grid2">
        <label class="f"><span>Pasang di tiang TM bila jarak ≤ (m)</span><input id="eqSnap" value="80"></label>
        <label class="f"><span>Sambung otomatis bila jarak ≤ (m)</span><input id="eqMax" value="1500"></label>
      </div>
      <button class="btn primary" id="eqRun" ${mine.length ? '' : 'disabled'}>Import ${mine.length} peralatan ke ${esc(cur)}</button>
      <div id="eqLog"></div>`;
    box.querySelector('#eqRun').onclick = () => {
      const msgs = this.run({ sistem: cur, snapM: num(box.querySelector('#eqSnap').value) ?? 80, maxLinkM: num(box.querySelector('#eqMax').value) ?? 1500 });
      box.querySelector('#eqLog').innerHTML = `<div class="okbox"><b>Import selesai</b><ul>${msgs.map(m => `<li>${esc(m)}</li>`).join('')}</ul>
        <button class="btn" onclick="App.show('map')">Lihat di peta</button> <button class="btn" onclick="App.show('sld')">Lihat SLD</button></div>`;
    };
  },
};
