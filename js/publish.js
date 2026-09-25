'use strict';
/* ============================================================
 * Publish: publikasi data ke GitHub Pages agar tamu bisa melihat.
 * Admin → API GitHub (token fine-grained, Contents: write) → data/*.json
 * Tamu   → memuat data/systems.json + data/sys-<id>.json (hanya baca)
 * ============================================================ */

const Publish = {
  REPO: 'Riswan08/sipela', BRANCH: 'main', DIR: 'data',
  TOKEN_KEY: 'sipela.ghtoken',
  token() { try { return localStorage.getItem(this.TOKEN_KEY) || ''; } catch { return ''; } },
  setToken(t) { try { t ? localStorage.setItem(this.TOKEN_KEY, t) : localStorage.removeItem(this.TOKEN_KEY); } catch {} },

  /* ---------- sisi tamu: memuat data publikasi ---------- */
  async fetchIndex() {
    try {
      const r = await fetch(`${this.DIR}/systems.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!r.ok) return null;
      return await r.json();
    } catch { return null; }
  },
  async fetchSystem(id) {
    const r = await fetch(`${this.DIR}/sys-${id}.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error('Data sistem tidak ditemukan di publikasi');
    const main = await r.json();
    let cust = [];
    if (main.nCustomers) { try { const c = await fetch(`${this.DIR}/sys-${id}-cust.json?t=${Date.now()}`, { cache: 'no-store' }); if (c.ok) cust = await c.json(); } catch {} }
    return this.expand(main, cust);
  },

  /* ---------- sisi admin: push ke GitHub ---------- */
  b64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  },
  async api(path, opt = {}) {
    const r = await fetch(`https://api.github.com/repos/${this.REPO}/contents/${path}`, {
      ...opt, headers: { Authorization: 'Bearer ' + this.token(), Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opt.headers || {}) },
    });
    if (r.status === 404 && (!opt.method || opt.method === 'GET')) return null;
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${j.message || r.statusText || 'gagal'}`);
    return j;
  },
  // data sistem diperkecil untuk publikasi: pelanggan dipisah, koordinat 6 desimal, kolom kosong dibuang
  compact(d) {
    const r6 = v => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v);
    const clean = o => { const x = {}; for (const [k, v] of Object.entries(o)) { if (v === null || v === undefined || v === '' || v === false) continue; x[k] = (k === 'lat' || k === 'lng') ? r6(v) : v; } return x; };
    const main = { ...d, assets: d.assets.map(clean), lines: d.lines.map(l => clean({ ...l, path: (l.path || []).map(p => [r6(p[0]), r6(p[1])]) })), customers: [], nCustomers: (d.customers || []).length };
    const cust = (d.customers || []).map(c => [r6(c.lat), r6(c.lng), c.gd || '', c.idpel || '', c.va ?? null, c.feeder || '']);
    return { main, cust };
  },
  expand(main, cust) {
    const d = { ...main };
    d.customers = (cust || []).map(c => ({ lat: c[0], lng: c[1], gd: c[2], idpel: c[3], va: c[4], feeder: c[5] }));
    return d;
  },
  // periksa token: apakah repo terlihat & boleh ditulis
  async testToken() {
    const r = await fetch(`https://api.github.com/repos/${this.REPO}`, { headers: { Authorization: 'Bearer ' + this.token(), Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) throw new Error('Token tidak valid / kedaluwarsa (401)');
    if (r.status === 404) throw new Error('Repo sipela tidak terlihat oleh token (404) — di token, "Repository access" harus memilih repo sipela');
    if (!r.ok) throw new Error(j.message || ('HTTP ' + r.status));
    const push = !!(j.permissions && j.permissions.push);
    if (!push) throw new Error('Token hanya bisa membaca. Di token → Permissions → Repository permissions → Contents harus "Read and write" (lalu simpan / regenerate)');
    return `Token OK: repo ${j.full_name} terlihat, izin tulis ✓`;
  },
  async putFile(path, content, message) {
    const cur = await this.api(path + `?ref=${this.BRANCH}`);
    const body = { message, content: this.b64(content), branch: this.BRANCH };
    if (cur && cur.sha) body.sha = cur.sha;
    return this.api(path, { method: 'PUT', body: JSON.stringify(body) });
  },
  async publishAll(log = () => {}) {
    if (!this.token()) throw new Error('Token GitHub belum diisi');
    await Store.flush();
    const stamp = new Date().toISOString();
    const list = [];
    let i = 0;
    for (const s of Store.systems) {
      i++;
      const d = s.id === Store.current ? Store.data : Store.normalize(await DB.get('sys:' + s.id));
      const { main, cust } = this.compact(d);
      const txt = JSON.stringify(main), ctxt = JSON.stringify(cust);
      log(`(${i}/${Store.systems.length}) ${s.name}: ${((txt.length + ctxt.length) / 1024 / 1024).toFixed(1)} MB …`);
      // GitHub membatasi laju commit beruntun (secondary rate limit, HTTP 403/429): tunggu lalu ulangi
      const tryPut = async (path, content, msg) => {
        for (let k = 0; k < 6; k++) {
          try { const r = await this.putFile(path, content, msg); await new Promise(r2 => setTimeout(r2, 1200)); return r; }
          catch (e) {
            const rate = /HTTP (403|429)/.test(e.message) && /rate|abuse|secondary|wait/i.test(e.message) || /HTTP 429/.test(e.message);
            const transient = /HTTP (409|5\d\d)/.test(e.message);
            if (k === 5 || !(rate || transient)) throw new Error(`${s.name} (${path.split('/').pop()}): ${e.message}`);
            const wait = rate ? 60000 : 3000;
            log(`  … ${rate ? 'GitHub minta jeda (batas laju)' : 'gangguan sementara'}, menunggu ${wait / 1000} s lalu mengulang`);
            await new Promise(r2 => setTimeout(r2, wait));
          }
        }
      };
      await tryPut(`${this.DIR}/sys-${s.id}.json`, txt, `Publikasi data ${s.name}`);
      if (cust.length) await tryPut(`${this.DIR}/sys-${s.id}-cust.json`, ctxt, `Publikasi pelanggan ${s.name}`);
      list.push({ id: s.id, name: s.name, ulp: s.ulp || '', sistem: s.sistem || '', updated: d.meta.updated, assets: d.assets.length, lines: d.lines.length, customers: (d.customers || []).length });
    }
    const index = { publishedAt: stamp, publishedBy: (typeof Auth !== 'undefined' && Auth.name()) || 'admin', current: Store.current, systems: list };
    await this.putFile(`${this.DIR}/systems.json`, JSON.stringify(index), `Publikasi indeks sistem (${list.length} sistem)`);
    log(`Selesai: ${list.length} sistem dipublikasikan. GitHub Pages butuh ±1–2 menit sebelum tamu melihat versi baru.`);
    return index;
  },
  // ambil data publikasi ke perangkat ini (admin di laptop/HP lain)
  async pullAll(log = () => {}) {
    const idx = await this.fetchIndex();
    if (!idx) throw new Error('Belum ada data publikasi');
    let i = 0;
    for (const s of idx.systems) {
      i++;
      log(`(${i}/${idx.systems.length}) ${s.name} …`);
      const d = Store.normalize(await this.fetchSystem(s.id));
      await DB.set('sys:' + s.id, d);
      const ex = Store.systems.find(x => x.id === s.id);
      const entry = { id: s.id, name: d.meta.name, ulp: d.meta.ulp || '', sistem: d.meta.sistem || '', updated: d.meta.updated, assets: d.assets.length, lines: d.lines.length };
      if (ex) Object.assign(ex, entry); else Store.systems.push(entry);
      if (s.id === Store.current) { Store.data = d; Store._idx = null; }
    }
    await DB.set('systems', Store.systems);
    Store.emit('system');
    log(`Selesai: ${idx.systems.length} sistem diambil (publikasi ${fmt.date(idx.publishedAt)}).`);
  },

  /* ---------- UI (tab Data, admin) ---------- */
  card() {
    return `<section class="card pub">
      <h3>Publikasikan data untuk tamu</h3>
      <p class="small muted">Data tersimpan di browser ini. Dengan publikasi, seluruh sistem dikirim ke GitHub (folder <code>data/</code>) dan tamu di perangkat mana pun akan melihat data yang sama (hanya baca).</p>
      <div id="pubInfo" class="muted small">Memeriksa publikasi terakhir…</div>
      <label class="f"><span>Token GitHub (fine-grained, hanya repo sipela, izin <b>Contents: Read and write</b>)</span>
        <input type="password" id="ghToken" value="${esc(this.token())}" placeholder="github_pat_…" autocomplete="off"></label>
      <p class="hint">Cara membuat token: GitHub → Settings → Developer settings → Personal access tokens → Fine-grained → Generate: Repository access = <b>Only select repositories: sipela</b>, Permissions → Contents = <b>Read and write</b>. Token disimpan hanya di browser ini.</p>
      <div class="btnrow">
        <button class="btn" id="pubTest">🔑 Uji token</button>
        <button class="btn primary" id="pubRun">⬆ Publikasikan semua sistem</button>
        <button class="btn" id="pubPull">⬇ Ambil data publikasi ke perangkat ini</button>
      </div>
      <div id="pubLog"></div>
    </section>`;
  },
  async bind(el) {
    const tok = el.querySelector('#ghToken');
    tok.onchange = () => this.setToken(tok.value.trim());
    const log = el.querySelector('#pubLog'), lines = [];
    const say = m => { lines.push(m); log.innerHTML = `<div class="okbox"><ul>${lines.slice(-8).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`; };
    el.querySelector('#pubTest').onclick = async () => {
      this.setToken(tok.value.trim());
      lines.length = 0;
      try { say(await this.testToken()); } catch (e) { say('Gagal: ' + e.message); }
    };
    el.querySelector('#pubRun').onclick = async () => {
      this.setToken(tok.value.trim());
      try { await this.testToken(); } catch (e) { lines.length = 0; say('Gagal: ' + e.message); return; }
      const n = Store.systems.length;
      if (!confirm(`Publikasikan ${n} sistem ke GitHub Pages? Data yang sudah dipublikasikan sebelumnya akan diganti.`)) return;
      lines.length = 0; el.querySelector('#pubRun').disabled = true;
      try { await this.publishAll(say); this.showInfo(el); }
      catch (e) { say('Gagal: ' + e.message + (/Resource not accessible/i.test(e.message) ? ' — izin Contents pada token masih Read-only; ubah ke "Read and write" di pengaturan token, lalu coba lagi' : '')); }
      el.querySelector('#pubRun').disabled = false;
    };
    el.querySelector('#pubPull').onclick = async () => {
      if (!confirm('Ambil semua sistem dari publikasi ke perangkat ini? Sistem dengan id yang sama akan diganti.')) return;
      lines.length = 0;
      try { await this.pullAll(say); } catch (e) { say('Gagal: ' + e.message); }
    };
    this.showInfo(el);
  },
  async showInfo(el) {
    const idx = await this.fetchIndex();
    const info = el.querySelector('#pubInfo'); if (!info) return;
    info.innerHTML = idx
      ? `Publikasi terakhir: <b>${fmt.date(idx.publishedAt)}</b> oleh ${esc(idx.publishedBy)} · ${idx.systems.length} sistem · ${fmt.n(idx.systems.reduce((s, x) => s + (x.assets || 0), 0), 0)} aset`
      : 'Belum ada data yang dipublikasikan.';
  },
};
