'use strict';
/* ============================================================
 * SLD: Single Line Diagram otomatis dari topologi jaringan
 * Tata letak: trunk (cabang terpanjang) lurus horizontal, percabangan turun ke bawah.
 * ============================================================ */

const SLD = {
  gapX: 180, gapY: 130, pad: 90,
  vb: null, size: null, rootId: null,

  build(rootId, opt) {
    const t = Net.tree(rootId, { respectOpen: opt.stopOpen, jtmOnly: !opt.showJTR });
    if (!t.root) return null;
    if (opt.collapse) this.collapse(t);
    // tinggi subtree (untuk menentukan trunk) — iteratif pasca-urut
    for (let i = t.order.length - 1; i >= 0; i--) {
      const n = t.order[i];
      n.h = n.children.length ? 1 + Math.max(...n.children.map(c => c.h)) : 0;
      n.children.sort((a, b) => b.h - a.h || a.dist - b.dist);
    }
    t.order.forEach(n => { n.col = n.parent ? t.nodes.get(n.parent).col + 1 : 0; });

    // penempatan baris dengan kontur per kolom agar cabang rapat tanpa bertabrakan
    const place = (n) => {
      if (!n.children.length) return new Map([[n.col, [0, 0]]]);
      let acc = null, lastOff = 0;
      n.children.forEach((c, i) => {
        const cc = place(c);
        let shift = 0;
        if (i > 0) {
          shift = lastOff + 1;
          for (const [col, [mn]] of cc) { const o = acc.get(col); if (o) shift = Math.max(shift, o[1] - mn + 1); }
        }
        c.off = shift; lastOff = shift;
        if (!acc) acc = new Map();
        for (const [col, [mn, mx]] of cc) {
          const o = acc.get(col);
          acc.set(col, o ? [Math.min(o[0], mn + shift), Math.max(o[1], mx + shift)] : [mn + shift, mx + shift]);
        }
      });
      const merge = (col, mn, mx) => { const o = acc.get(col); acc.set(col, o ? [Math.min(o[0], mn), Math.max(o[1], mx)] : [mn, mx]); };
      merge(n.col, 0, 0);
      merge(n.col + 1, 0, lastOff);
      return acc;
    };
    place(t.root);
    t.root.row = 0;
    t.order.forEach(n => { if (n.parent) n.row = t.nodes.get(n.parent).row + n.off; });
    return t;
  },

  // gabungkan rangkaian tiang lurus (tiang dengan satu cabang lanjut) menjadi satu ruas
  collapse(t) {
    const tieAt = new Set(t.ties.map(x => x.a));
    const keep = n => !(n.asset.type === 'TIANG' && n.children.length === 1 && !tieAt.has(n.id));
    const stack = [t.root];
    while (stack.length) {
      const n = stack.pop();
      n.children = n.children.map(c => {
        let len = Store.lineLength(c.line), first = c.line, k = 1;
        while (!keep(c)) { c = c.children[0]; len += Store.lineLength(c.line); k++; }
        if (k > 1) c.line = { id: 'v' + c.id, level: first.level, conductor: first.conductor, feeder: first.feeder, lengthM: len, spans: k, gap: first.gap };
        c.parent = n.id;
        return c;
      });
      stack.push(...n.children);
    }
    const order = [], st = [t.root];
    while (st.length) { const n = st.pop(); order.push(n); for (let i = n.children.length - 1; i >= 0; i--) st.push(n.children[i]); }
    t.order = order;
  },

  // Simbol mengikuti gaya SLD PLN (hitam = NC/close, putih = NO/open)
  symbol(a) {
    const T = ASSET_TYPES[a.type] || ASSET_TYPES.TIANG, c = T.color, open = Net.isOpen(a);
    const K = '#111', fill = open ? '#fff' : K, txt = open ? K : '#fff';
    const scada = a.scada ? `<rect x="-16" y="-34" width="32" height="11" fill="#fde047" stroke="#111" stroke-width=".8"/><text y="-25.5" text-anchor="middle" font-size="7" font-weight="700" fill="#111">SCADA</text>` : '';
    switch (a.type) {
      case 'PLTD': return `<circle r="16" fill="#fff" stroke="${K}" stroke-width="2"/>
        <text y="6" text-anchor="middle" font-weight="700" font-size="16" fill="${K}">G</text>${scada}`;
      case 'GI': return `<rect x="-26" y="-20" width="52" height="40" fill="#fff" stroke="${K}" stroke-width="2"/>
        <line x1="-8" y1="-13" x2="-8" y2="13" stroke="${K}" stroke-width="3"/><line x1="-8" y1="0" x2="10" y2="0" stroke="${K}" stroke-width="2"/><rect x="8" y="-5" width="10" height="10" fill="${K}"/>
        <text y="30" text-anchor="middle" font-size="8" font-weight="700" fill="${K}">GI</text>${scada}`;
      case 'GH': return `<rect x="-20" y="-16" width="40" height="32" fill="#e5e7eb" stroke="${K}" stroke-width="2"/>
        <text y="4" text-anchor="middle" font-weight="700" font-size="11" fill="${K}">GH</text>${scada}`;
      case 'GD': {
        if (a.mount === 'beton') return `<rect x="-12" y="-12" width="24" height="24" fill="#fff" stroke="${K}" stroke-width="1.8"/><path d="M-8 9L0-8 8 9Z" fill="${K}"/>${scada}`;
        // gardu trafo tiang (portal/cantol): bentuk "spade"
        const col = a.rusak ? '#dc2626' : a.aktif === false ? '#2563eb' : K;
        return `<path d="M0-14C-9-6-12-1-12 3a12 12 0 0 0 24 0c0-4-3-9-12-17z" fill="${col}"/><rect x="-2" y="6" width="4" height="9" fill="${col}"/>${a.mount === 'cantol' ? '' : `<line x1="-9" y1="15" x2="9" y2="15" stroke="${col}" stroke-width="2"/>`}${scada}`;
      }
      case 'PTM': return `<rect x="-13" y="-13" width="26" height="26" fill="#fff" stroke="${K}" stroke-width="2"/>
        <text y="4" text-anchor="middle" font-size="9" font-weight="700" fill="${K}">kWh</text>${scada}`;
      case 'REC': return `<rect x="-13" y="-13" width="26" height="26" fill="${fill}" stroke="${K}" stroke-width="2"/>
        <text y="5" text-anchor="middle" font-size="13" font-weight="700" fill="${txt}">R</text>${scada}`;
      case 'LBS': {
        if (a.sub === 'sect') return `<rect x="-13" y="-13" width="26" height="26" fill="${fill}" stroke="${K}" stroke-width="2"/><text y="5" text-anchor="middle" font-size="13" font-weight="700" fill="${txt}">S</text>${scada}`;
        if (a.sub === 'motor') return `<circle r="13" fill="${fill}" stroke="${K}" stroke-width="2"/><text y="5" text-anchor="middle" font-size="13" font-weight="700" fill="${txt}">M</text>${scada}`;
        // LBS manual: lingkaran dengan "dasi kupu-kupu"
        return `<circle r="13" fill="#fff" stroke="${K}" stroke-width="2"/><path d="M-9-6L0 0-9 6Z" fill="${K}"/><path d="M9-6L0 0 9 6Z" fill="${K}"/>${open ? `<line x1="-4" y1="-9" x2="4" y2="9" stroke="#dc2626" stroke-width="2.5"/>` : ''}${scada}`;
      }
      case 'FCO': return `<rect x="-16" y="-8" width="32" height="16" fill="#fff" stroke="${K}" stroke-width="1.8"/>
        <path d="M-12 0c4-8 8-8 12 0s8 8 12 0" fill="none" stroke="${open ? '#dc2626' : K}" stroke-width="1.6"/>${scada}`;
      default: return `<circle r="4.5" fill="#334155"/>`;
    }
  },

  // panel "Keterangan" (legenda) + kop gambar, gaya SLD PLN
  legendPanel(x, y, w, root, count) {
    const P = Store.data.params, M = Store.data.meta;
    const row = (sym, label, dy, sym2, label2) => `<g transform="translate(${x + 30},${dy})">${sym}<text x="26" y="4" class="lg">${label}</text>${sym2 ? `<g transform="translate(${w / 2 - 6},0)">${sym2}<text x="26" y="4" class="lg">${label2}</text></g>` : ''}</g>`;
    const S = (t, extra = {}) => `<g transform="scale(.75)">${this.symbol({ type: t, status: 'NC', ...extra })}</g>`;
    const O = (t, extra = {}) => `<g transform="scale(.75)">${this.symbol({ type: t, status: 'NO', ...extra })}</g>`;
    const items = [
      [S('PLTD'), 'Generator pembangkit'],
      [`<g transform="scale(.75)"><circle cx="-6" r="8" fill="none" stroke="#111" stroke-width="2"/><circle cx="6" r="8" fill="none" stroke="#111" stroke-width="2"/></g>`, 'Transformator'],
      [S('GI'), 'Gardu Induk', S('GH'), 'Gardu Hubung'],
      [`<line x1="-14" y1="0" x2="14" y2="0" stroke="#111" stroke-width="2"/>`, 'JTM 20 kV', `<line x1="-14" y1="0" x2="14" y2="0" stroke="#111" stroke-width="2" stroke-dasharray="8 3 2 3"/>`, 'Kabel tanah 20 kV'],
      [`<line x1="-14" y1="0" x2="14" y2="0" stroke="#78716c" stroke-width="2" stroke-dasharray="5 4"/>`, 'JTR (tegangan rendah)', `<line x1="-14" y1="0" x2="14" y2="0" stroke="#dc2626" stroke-width="1.5" stroke-dasharray="4 3"/>`, 'Tie / manuver antar penyulang'],
      [S('REC'), 'Recloser 20 kV (NC)', O('REC'), 'Recloser 20 kV (NO)'],
      [S('LBS', { sub: 'motor' }), 'LBS Motorised 20 kV (NC)', O('LBS', { sub: 'motor' }), 'LBS Motorised 20 kV (NO)'],
      [S('LBS', { sub: 'sect' }), 'Sectionalizer 20 kV (NC)', O('LBS', { sub: 'sect' }), 'Sectionalizer 20 kV (NO)'],
      [S('LBS'), 'LBS Manual 20 kV', S('FCO'), 'Fuse Cut Out'],
      [S('GD', { mount: 'beton' }), 'Gardu Beton', S('GD'), 'Gardu Trafo Tiang (2 tiang)'],
      [S('GD', { aktif: false }), 'Gardu Tiang Belum Aktif', S('GD', { rusak: true }), 'Gardu Tiang Rusak'],
      [S('GD', { mount: 'cantol' }), 'Gardu Cantol (1 tiang)', S('PTM'), 'Pelanggan TM (APP)'],
      [`<rect x="-16" y="-6" width="32" height="12" fill="#fde047" stroke="#111" stroke-width=".8"/><text y="3" text-anchor="middle" font-size="7" font-weight="700">SCADA</text>`, 'Key Point SCADA', `<circle r="4.5" fill="#334155"/>`, 'Tiang / titik percabangan'],
    ];
    let dy = y + 42;
    const rows = items.map(it => { const r = row(it[0], it[1], dy, it[2], it[3]); dy += 30; return r; });
    const legendH = dy - y + 4;
    // kop gambar
    const ky = y + legendH + 10, lh = 24;
    const sistem = M.sistem || M.name.replace(/^Sistem\s+/i, '');
    const fields = [['UIW', P.uiw], ['UP3', P.up3], ['ULP', M.ulp || '-'], ['Sistem', sistem], ['Penyulang / sumber', `${root.feeder || ''} ${root.code}`.trim()],
      ['Nomor Gambar', P.drawingNo || ''], ['Tanggal', new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })]];
    const kop = `<rect x="${x}" y="${ky}" width="${w}" height="${72 + fields.length * lh + 70}" fill="#fff" stroke="#111" stroke-width="1.5"/>
      <text x="${x + w / 2}" y="${ky + 30}" text-anchor="middle" class="kt">SINGLE LINE DIAGRAM</text>
      <text x="${x + w / 2}" y="${ky + 56}" text-anchor="middle" class="kt">${esc((sistem ? 'SISTEM ' + sistem : M.name).toUpperCase())}</text>
      <line x1="${x}" y1="${ky + 68}" x2="${x + w}" y2="${ky + 68}" stroke="#111"/>
      ${fields.map((f, i) => `<line x1="${x}" y1="${ky + 68 + (i + 1) * lh}" x2="${x + w}" y2="${ky + 68 + (i + 1) * lh}" stroke="#111" stroke-width=".8"/>
        <text x="${x + 8}" y="${ky + 68 + i * lh + 16}" class="kf">${esc(f[0])}</text><text x="${x + 128}" y="${ky + 68 + i * lh + 16}" class="kf">: ${esc(String(f[1] ?? ''))}</text>`).join('')}
      ${['Digambar', 'Diperiksa', 'Disetujui'].map((h, i) => { const cx = x + i * w / 3, val = [P.drawnBy, P.checkedBy, P.approvedBy][i] || ''; const ty = ky + 68 + fields.length * lh;
        return `<line x1="${cx}" y1="${ty}" x2="${cx}" y2="${ty + 70}" stroke="#111" stroke-width=".8"/><text x="${cx + w / 6}" y="${ty + 16}" text-anchor="middle" class="kf" font-weight="700">${h}</text>
          <line x1="${cx}" y1="${ty + 22}" x2="${cx + w / 3}" y2="${ty + 22}" stroke="#111" stroke-width=".8"/><text x="${cx + w / 6}" y="${ty + 60}" text-anchor="middle" class="kf">${esc(val)}</text>`; }).join('')}
      <text x="${x + w}" y="${ky + 72 + fields.length * lh + 70 + 14}" text-anchor="end" class="sub">${count} aset · digambar otomatis SIPELA — verifikasi lapangan diperlukan</text>`;
    return { svg: `<rect x="${x}" y="${y}" width="${w}" height="${legendH}" fill="#f1f5f9" stroke="#111" stroke-width="1"/>
      <text x="${x + 14}" y="${y + 24}" class="kt" font-size="14">Keterangan :</text>${rows.join('')}${kop}`, h: legendH + 10 + 72 + fields.length * lh + 70 + 24 };
  },

  render(rootId, opt = {}) {
    opt = { stopOpen: true, showLen: true, showName: true, hidePoles: false, collapse: true, showJTR: false, legend: true, ...opt };
    const t = this.build(rootId, opt);
    if (!t) return null;
    const { gapX, gapY, pad } = this;
    const X = n => pad + n.col * gapX, Y = n => pad + 40 + n.row * gapY;
    let maxCol = 0, maxRow = 0;
    t.order.forEach(n => { maxCol = Math.max(maxCol, n.col); maxRow = Math.max(maxRow, n.row); });
    const PW = opt.legend ? 430 : 0;  // lebar panel keterangan + kop di kanan
    const W = pad * 2 + maxCol * gapX + 120 + PW, H = pad * 2 + 40 + maxRow * gapY + 40;
    const edges = [], labels = [], nodes = [], ties = [];

    for (const n of t.order) {
      const x = X(n), y = Y(n);
      // garis dari parent
      if (n.parent) {
        const p = t.nodes.get(n.parent), px = X(p), py = Y(p), l = n.line;
        const color = l.level === 'JTR' ? '#64748b' : '#1f2937';
        const dash = l.level === 'JTR' ? ' stroke-dasharray="6 4"' : /XLPE|SKTM|N2X/i.test(l.conductor) ? ' stroke-dasharray="10 4 2 4"' : '';
        let sx;
        if (n.row === p.row) { sx = px; edges.push(`<line x1="${px}" y1="${y}" x2="${x}" y2="${y}" stroke="${color}" stroke-width="2"${dash}/>`); }
        else { sx = px + gapX / 2; edges.push(`<path d="M${px} ${py}H${sx}V${y}H${x}" fill="none" stroke="${color}" stroke-width="2"${dash}/>`); }
        if (opt.showLen) {
          const mx = (sx + x) / 2;
          const feederTag = (!p.parent && l.feeder) ? `<text x="${mx}" y="${y - 26}" text-anchor="middle" class="fdr" fill="${feederColor(l.feeder)}">${esc(l.feeder)}</text>` : '';
          labels.push(`${feederTag}<text x="${mx}" y="${y - 7}" text-anchor="middle" class="len">${fmt.m(Store.lineLength(l))}</text>
            <text x="${mx}" y="${y + 15}" text-anchor="middle" class="cond">${esc(l.conductor)}${l.spans ? ` · ${l.spans} gawang` : ''}</text>`);
        }
      }
      const a = n.asset;
      const pole = a.type === 'TIANG';
      let lbl = '';
      if (!(pole && opt.hidePoles)) {
        const lines = [`<tspan x="0" dy="0" class="code">${esc(a.code)}${Net.isOpen(a) ? ' (NO)' : ''}</tspan>`];
        if (opt.showName && a.name && a.name !== a.code) lines.push(`<tspan x="0" dy="13">${esc(a.name.length > 26 ? a.name.slice(0, 25) + '…' : a.name)}</tspan>`);
        if (ASSET_TYPES[a.type]?.load && a.kva) lines.push(`<tspan x="0" dy="13">${fmt.n(a.kva, 0)} kVA${num(a.loadPct) != null ? ' · ' + fmt.n(a.loadPct, 0) + '%' : ''}</tspan>`);
        lbl = `<text y="${pole ? 18 : 34}" text-anchor="middle" class="lbl">${lines.join('')}</text>`;
      }
      nodes.push(`<g class="node" data-id="${a.id}" transform="translate(${x},${y})"><title>${esc(ASSET_TYPES[a.type]?.label)} ${esc(a.code)}</title>${this.symbol(a)}${lbl}</g>`);
    }
    // titik buka / loop ke jaringan lain
    for (const tie of t.ties) {
      const n = t.nodes.get(tie.a); if (!n) continue;
      const other = Store.asset(tie.b);
      const x = X(n), y = Y(n);
      const k = ties.filter(s => s.id === n.id).length;
      ties.push({ id: n.id, svg: `<g class="tie"><path d="M${x} ${y - 6}V${y - 42 - k * 14}H${x + 14}" fill="none" stroke="#dc2626" stroke-width="1.5" stroke-dasharray="4 3"/>
        <text x="${x + 17}" y="${y - 38 - k * 14}" class="tie-t">⇄ ${esc(other?.code)} ${other?.feeder && other.feeder !== n.asset.feeder ? '(' + esc(other.feeder) + ')' : ''} · ${fmt.m(Store.lineLength(tie.line))}</text></g>` });
    }
    const root = t.root.asset;
    const title = `<g class="titleblk"><text x="${pad - 50}" y="36" class="ttl">SINGLE LINE DIAGRAM — ${esc(root.code)} ${esc(root.name || '')}</text>
      <text x="${pad - 50}" y="54" class="sub">${esc(Store.data.meta.name)} · ${t.order.length} aset · digambar otomatis ${new Date().toLocaleDateString('id-ID')} · verifikasi lapangan diperlukan</text></g>`;
    let panel = '', Hfinal = Math.max(H, 200);
    if (opt.legend) {
      const lp = this.legendPanel(W - PW + 10, 20, PW - 30, root, t.order.length);
      panel = lp.svg; Hfinal = Math.max(Hfinal, lp.h + 40);
    }
    this.size = [W, Hfinal];
    this.rootId = rootId;
    this.tree = t;
    return `<svg xmlns="http://www.w3.org/2000/svg" id="sldSvg" viewBox="0 0 ${W} ${this.size[1]}" width="${W}" height="${this.size[1]}" font-family="Arial, Helvetica, sans-serif">
      <style>
        .len{font-size:11px;font-weight:700;fill:#111827}.cond{font-size:10px;fill:#6b7280}.fdr{font-size:12px;font-weight:700}
        .lbl{font-size:11px;fill:#374151}.lbl .code{font-weight:700;fill:#111827}.tie-t{font-size:10px;fill:#dc2626}
        .ttl{font-size:16px;font-weight:700;fill:#111827}.sub{font-size:11px;fill:#6b7280}.node{cursor:pointer}
        .lg{font-size:11px;fill:#111}.kt{font-size:20px;font-weight:700;fill:#111}.kf{font-size:12px;fill:#111}
      </style>
      <rect width="100%" height="100%" fill="#fff"/>${title}${edges.join('')}${labels.join('')}${ties.map(s => s.svg).join('')}${nodes.join('')}${panel}
    </svg>`;
  },

  /* ---------- tampilan interaktif (pan / zoom) ---------- */
  mount(wrap, svgText) {
    wrap.innerHTML = svgText;
    const svg = wrap.querySelector('svg');
    svg.removeAttribute('width'); svg.removeAttribute('height');
    this.svg = svg; this.wrap = wrap;
    this.fit();
    if (wrap._bound) return;
    wrap._bound = true;
    wrap.addEventListener('wheel', e => {
      e.preventDefault();
      const f = e.deltaY > 0 ? 1.15 : 1 / 1.15;
      const r = wrap.getBoundingClientRect();
      const px = this.vb[0] + (e.clientX - r.left) / r.width * this.vb[2];
      const py = this.vb[1] + (e.clientY - r.top) / r.height * this.vb[3];
      this.setVb([px - (px - this.vb[0]) * f, py - (py - this.vb[1]) * f, this.vb[2] * f, this.vb[3] * f]);
    }, { passive: false });
    let drag = null;
    wrap.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, vb: [...this.vb], moved: false }; });
    window.addEventListener('pointermove', e => {
      if (!drag) return;
      const r = wrap.getBoundingClientRect();
      const dx = (e.clientX - drag.x) / r.width * drag.vb[2], dy = (e.clientY - drag.y) / r.height * drag.vb[3];
      if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 4) drag.moved = true;
      if (drag.moved) this.setVb([drag.vb[0] - dx, drag.vb[1] - dy, drag.vb[2], drag.vb[3]]);
    });
    window.addEventListener('pointerup', e => {
      if (drag && !drag.moved) {
        const g = e.target.closest && e.target.closest('.node');
        if (g) this.onNodeClick(g.dataset.id);
      }
      drag = null;
    });
  },
  setVb(vb) {
    // jaga rasio aspek wadah
    const r = this.wrap.getBoundingClientRect();
    const ar = r.width / Math.max(1, r.height);
    if (vb[2] / vb[3] > ar) vb[3] = vb[2] / ar; else vb[2] = vb[3] * ar;
    this.vb = vb;
    this.svg.setAttribute('viewBox', vb.join(' '));
  },
  fit() {
    const [W, H] = this.size;
    const r = this.wrap.getBoundingClientRect();
    const ar = r.width / Math.max(1, r.height);
    let w = W, h = H;
    if (w / h > ar) h = w / ar; else w = h * ar;
    // jangan terlalu kecil untuk diagram panjang: minimal skala 0.35
    const minScale = 0.35;
    if (r.width / w < minScale) { w = r.width / minScale; h = w / ar; }
    this.setVb([0, 0, w, h]);
  },
  zoom(f) { const [x, y, w, h] = this.vb; this.setVb([x + w * (1 - f) / 2, y + h * (1 - f) / 2, w * f, h * f]); },
  onNodeClick(id) {
    const a = Store.asset(id); if (!a) return;
    const el = document.getElementById('sldInfo');
    const n = this.tree?.nodes.get(id);
    el.innerHTML = `<b>${esc(a.code)}</b> ${esc(a.name)} · ${esc(ASSET_TYPES[a.type]?.label)}${a.kva ? ' · ' + fmt.n(a.kva, 0) + ' kVA' : ''}
      ${n ? ` · jarak dari sumber <b>${fmt.m(n.dist)}</b>` : ''}
      <button class="btn sm" onclick="App.focusAsset('${a.id}')">Lihat di peta</button>
      <button class="btn sm" onclick="App.showSld('${a.id}')">SLD dari sini</button>`;
  },

  /* ---------- ekspor ---------- */
  fullSvgText() {
    const clone = this.svg.cloneNode(true);
    const [W, H] = this.size;
    clone.setAttribute('viewBox', `0 0 ${W} ${H}`);
    clone.setAttribute('width', W); clone.setAttribute('height', H);
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
  },
  fileBase() { return 'SLD_' + (Store.asset(this.rootId)?.code || 'jaringan').replace(/[^\w-]+/g, '_'); },
  exportSvg() { IO.download(this.fileBase() + '.svg', this.fullSvgText(), 'image/svg+xml'); },
  exportPng() {
    const [W, H] = this.size;
    const scale = Math.min(2, 16000 / W, 16000 / H);
    const img = new Image();
    const url = URL.createObjectURL(new Blob([this.fullSvgText()], { type: 'image/svg+xml' }));
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = Math.round(W * scale); c.height = Math.round(H * scale);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob(b => IO.downloadBlob(this.fileBase() + '.png', b), 'image/png');
    };
    img.onerror = () => App.toast('Gagal membuat PNG — gunakan ekspor SVG');
    img.src = url;
  },
  print() {
    const w = window.open('', '_blank');
    if (!w) return App.toast('Pop-up diblokir browser');
    w.document.write(`<html><head><title>${this.fileBase()}</title><style>@page{size:A3 landscape;margin:8mm}body{margin:0}svg{width:100%;height:auto}</style></head><body>${this.fullSvgText().replace(/^<\?xml[^>]*>/, '')}</body></html>`);
    w.document.close();
    setTimeout(() => w.print(), 400);
  },
};
