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

  symbol(a) {
    const T = ASSET_TYPES[a.type] || ASSET_TYPES.TIANG, c = T.color, open = Net.isOpen(a);
    switch (a.type) {
      case 'PLTD': return `<circle r="22" fill="#fff" stroke="${c}" stroke-width="2.5"/>
        <path d="M-11 0c3.5-9 7.5-9 11 0s7.5 9 11 0" fill="none" stroke="${c}" stroke-width="2.5"/>
        <text y="-26" text-anchor="middle" font-weight="700" font-size="11" fill="${c}">PLTD</text>`;
      case 'GI': return `<rect x="-30" y="-22" width="60" height="44" rx="3" fill="#fff" stroke="${c}" stroke-width="2.5"/>
        <line x1="30" y1="-16" x2="30" y2="16" stroke="${c}" stroke-width="6"/>
        <text y="5" text-anchor="middle" font-weight="700" font-size="15" fill="${c}">GI</text>`;
      case 'GH': return `<rect x="-20" y="-20" width="40" height="40" fill="#fff" stroke="${c}" stroke-width="2.5"/>
        <line x1="-14" y1="-9" x2="14" y2="-9" stroke="${c}" stroke-width="4"/>
        <text y="12" text-anchor="middle" font-weight="700" font-size="12" fill="${c}">GH</text>`;
      case 'GD': return `<circle cx="-7" r="11" fill="#fff" stroke="${c}" stroke-width="2.2"/>
        <circle cx="7" r="11" fill="#fff" fill-opacity=".6" stroke="${c}" stroke-width="2.2"/>`;
      case 'PTM': return `<rect x="-13" y="-13" width="26" height="26" fill="#fff" stroke="${c}" stroke-width="2.2"/>
        <text y="4" text-anchor="middle" font-size="9" font-weight="700" fill="${c}">kWh</text>`;
      case 'REC': return `<rect x="-13" y="-13" width="26" height="26" fill="${open ? '#fff' : c}" stroke="${open ? '#dc2626' : c}" stroke-width="2.2"/>
        <text y="5" text-anchor="middle" font-size="13" font-weight="700" fill="${open ? '#dc2626' : '#fff'}">R</text>`;
      case 'LBS': return `<rect x="-16" y="-14" width="32" height="20" fill="#fff"/>
        <line x1="-16" y1="0" x2="-8" y2="0" stroke="#1f2937" stroke-width="2"/><line x1="10" y1="0" x2="16" y2="0" stroke="#1f2937" stroke-width="2"/>
        <circle cx="-8" r="2.5" fill="${c}"/><circle cx="10" r="2.5" fill="${c}"/>
        <line x1="-8" y1="0" x2="${open ? 7 : 10}" y2="${open ? -12 : 0}" stroke="${open ? '#dc2626' : c}" stroke-width="3" stroke-linecap="round"/>`;
      case 'FCO': return `<rect x="-12" y="-6" width="24" height="12" fill="#fff" stroke="${open ? '#dc2626' : c}" stroke-width="2"/>
        ${open ? '' : `<line x1="-12" y1="0" x2="12" y2="0" stroke="${c}" stroke-width="1.5"/>`}`;
      default: return `<circle r="4.5" fill="#334155"/>`;
    }
  },

  render(rootId, opt = {}) {
    opt = { stopOpen: true, showLen: true, showName: true, hidePoles: false, collapse: true, showJTR: false, ...opt };
    const t = this.build(rootId, opt);
    if (!t) return null;
    const { gapX, gapY, pad } = this;
    const X = n => pad + n.col * gapX, Y = n => pad + 40 + n.row * gapY;
    let maxCol = 0, maxRow = 0;
    t.order.forEach(n => { maxCol = Math.max(maxCol, n.col); maxRow = Math.max(maxRow, n.row); });
    const W = pad * 2 + maxCol * gapX + 120, H = pad * 2 + 40 + maxRow * gapY + 40;
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
    this.size = [W, Math.max(H, 200)];
    this.rootId = rootId;
    this.tree = t;
    return `<svg xmlns="http://www.w3.org/2000/svg" id="sldSvg" viewBox="0 0 ${W} ${this.size[1]}" width="${W}" height="${this.size[1]}" font-family="Arial, Helvetica, sans-serif">
      <style>
        .len{font-size:11px;font-weight:700;fill:#111827}.cond{font-size:10px;fill:#6b7280}.fdr{font-size:12px;font-weight:700}
        .lbl{font-size:11px;fill:#374151}.lbl .code{font-weight:700;fill:#111827}.tie-t{font-size:10px;fill:#dc2626}
        .ttl{font-size:16px;font-weight:700;fill:#111827}.sub{font-size:11px;fill:#6b7280}.node{cursor:pointer}
      </style>
      <rect width="100%" height="100%" fill="#fff"/>${title}${edges.join('')}${labels.join('')}${ties.map(s => s.svg).join('')}${nodes.join('')}
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
