'use strict';
/* ============================================================
 * Net: topologi jaringan, jarak jaringan (Dijkstra), pohon penyulang,
 *      analisis beban, drop tegangan & susut
 * ============================================================ */

class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(v) {
    const a = this.a; a.push(v);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]]; i = p;
    }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}

const Net = {
  isOpen(a) { return !!(a && ASSET_TYPES[a.type]?.sw && a.status === 'NO'); },

  // jtmOnly = abaikan JTR (untuk SLD & analisis tegangan menengah)
  graph(opts = {}) {
    const g = new Map();
    Store.data.assets.forEach(a => g.set(a.id, []));
    Store.data.lines.forEach(l => {
      if (!g.has(l.from) || !g.has(l.to) || l.from === l.to) return;
      if (opts.jtmOnly && l.level === 'JTR') return;
      const len = Store.lineLength(l);
      g.get(l.from).push({ to: l.to, line: l, len });
      g.get(l.to).push({ to: l.from, line: l, len });
    });
    return g;
  },

  // Dijkstra dari src. respectOpen = tidak melewati saklar berstatus NO.
  shortest(src, opts = {}) {
    const g = opts.graph || this.graph(opts);
    const dist = new Map([[src, 0]]), prev = new Map(), done = new Set();
    const pq = new MinHeap();
    pq.push([0, src]);
    while (pq.size) {
      const [d, u] = pq.pop();
      if (done.has(u)) continue;
      done.add(u);
      if (opts.respectOpen && u !== src && this.isOpen(Store.asset(u))) continue;
      for (const e of g.get(u) || []) {
        const nd = d + e.len;
        if (nd < (dist.get(e.to) ?? Infinity)) {
          dist.set(e.to, nd);
          prev.set(e.to, { from: u, line: e.line });
          pq.push([nd, e.to]);
        }
      }
    }
    return { dist, prev };
  },

  path(src, dst, opts = {}) {
    const { dist, prev } = this.shortest(src, opts);
    if (!dist.has(dst)) return null;
    const nodes = [dst], lines = [];
    let c = dst;
    while (c !== src) {
      const p = prev.get(c);
      lines.unshift(p.line); nodes.unshift(p.from); c = p.from;
    }
    return { length: dist.get(dst), nodes, lines };
  },

  // Pohon radial dari sumber (untuk SLD & analisis). ties = saluran di luar pohon
  // (loop / titik buka ke penyulang lain).
  tree(root, opts = { respectOpen: true }) {
    const { dist, prev } = this.shortest(root, opts);
    const nodes = new Map();
    for (const [id, d] of dist) {
      const p = prev.get(id);
      nodes.set(id, { id, asset: Store.asset(id), dist: d, parent: p ? p.from : null, line: p ? p.line : null, children: [] });
    }
    for (const n of nodes.values()) if (n.parent != null) nodes.get(n.parent).children.push(n);
    const treeLines = new Set();
    nodes.forEach(n => n.line && treeLines.add(n.line.id));
    const ties = [];
    Store.data.lines.forEach(l => {
      if (treeLines.has(l.id) || (opts.jtmOnly && l.level === 'JTR')) return;
      const inF = nodes.has(l.from), inT = nodes.has(l.to);
      if (inF || inT) ties.push({ line: l, a: inF ? l.from : l.to, b: inF ? l.to : l.from, bothIn: inF && inT });
    });
    // urutan pre-order (iteratif, aman untuk penyulang panjang)
    const order = [], st = nodes.get(root) ? [nodes.get(root)] : [];
    while (st.length) {
      const n = st.pop(); order.push(n);
      for (let i = n.children.length - 1; i >= 0; i--) st.push(n.children[i]);
    }
    return { root: nodes.get(root), nodes, ties, order };
  },

  // Analisis aliran beban sederhana (metode jatuh tegangan per seksi, beban terpusat di gardu)
  analyze(rootId) {
    const P = Store.data.params;
    const t = this.tree(rootId, { respectOpen: true, jtmOnly: true });
    if (!t.root) return null;
    const V = num(P.kv) || 20, pf = Math.min(1, Math.max(0.1, num(P.pf) || 0.85));
    const sinf = Math.sqrt(1 - pf * pf);
    const fallback = Store.conductor('AAAC-150') || Store.data.conductors[0];
    const warn = new Set();

    for (let i = t.order.length - 1; i >= 0; i--) {
      const n = t.order[i], a = n.asset;
      const isLoad = ASSET_TYPES[a.type]?.load;
      const kva = isLoad ? (num(a.kva) || 0) : 0;
      const lp = num(a.loadPct) ?? (num(P.loadPct) ?? 60);
      n.ownCap = kva;
      // beban hasil ukur / estimasi (kVA) diutamakan, jika kosong pakai kapasitas × % beban
      const lk = isLoad ? num(a.loadKva) : null;
      n.ownLoad = lk != null ? lk : kva * lp / 100;
      if (isLoad && !kva && lk == null) warn.add(`${a.code}: kapasitas kVA & beban belum diisi (dianggap 0)`);
      else if (isLoad && !kva) warn.add(`${a.code}: kapasitas kVA belum diisi (beban memakai estimasi ${fmt.n(lk, 1)} kVA)`);
      n.load = n.ownLoad + n.children.reduce((s, c) => s + c.load, 0);
      n.cap = n.ownCap + n.children.reduce((s, c) => s + c.cap, 0);
    }
    let lossKW = 0, totalM = 0;
    for (const n of t.order) {
      if (!n.parent) { n.dropPct = 0; n.I = n.load / (Math.sqrt(3) * V); continue; }
      const p = t.nodes.get(n.parent), l = n.line;
      let c = Store.conductor(l.conductor);
      if (!c) { c = fallback; warn.add(`Penghantar "${l.conductor || '-'}" tidak dikenal, dipakai ${fallback.code}`); }
      const Lm = Store.lineLength(l), Lkm = Lm / 1000;
      totalM += Lm;
      const I = n.load / (Math.sqrt(3) * V);                       // A
      const dV = Math.sqrt(3) * I * (c.r * pf + c.x * sinf) * Lkm;  // V (fasa-fasa)
      n.I = I;
      n.segDropPct = dV / (V * 1000) * 100;
      n.dropPct = p.dropPct + n.segDropPct;
      n.loadingPct = c.kha ? I / c.kha * 100 : null;
      n.segLossKW = 3 * I * I * c.r * Lkm / 1000;
      n.cond = c.code;
      lossKW += n.segLossKW;
    }
    const nodes = t.order;
    const loads = nodes.filter(n => ASSET_TYPES[n.asset.type]?.load);
    const maxDrop = nodes.reduce((m, n) => (n.dropPct > m.dropPct ? n : m), t.root);
    const far = nodes.reduce((m, n) => (n.dist > m.dist ? n : m), t.root);
    const loadKW = t.root.load * pf;
    return {
      t, nodes, warn: [...warn],
      summary: {
        count: nodes.length, trafo: loads.length, totalKm: totalM / 1000,
        cap: t.root.cap, load: t.root.load, I: t.root.I,
        maxDrop, far, lossKW, lossPct: loadKW ? lossKW / loadKW * 100 : 0,
        overDrop: nodes.filter(n => n.dropPct > (num(P.dropLimit) ?? 5)).length,
        overLoad: nodes.filter(n => n.loadingPct > 100).length,
      },
    };
  },

  // aset terdekat per jenis (jarak jaringan & garis lurus)
  nearest(id, types) {
    const a = Store.asset(id);
    if (!a) return [];
    const { dist } = this.shortest(id);
    return types.map(type => {
      let net = null, air = null;
      for (const b of Store.data.assets) {
        if (b.type !== type || b.id === id) continue;
        const d = dist.get(b.id);
        if (d != null && (!net || d < net.d)) net = { a: b, d };
        const s = Geo.dist([a.lat, a.lng], [b.lat, b.lng]);
        if (!air || s < air.d) air = { a: b, d: s };
      }
      return { type, net, air };
    });
  },
};
