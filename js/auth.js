'use strict';
/* ============================================================
 * Auth: sesi masuk (tamu = hanya melihat, admin = akses penuh).
 * Sesi disimpan di browser oleh login.html. Ini pembatasan tampilan &
 * perubahan data di sisi klien (aplikasi statis tanpa server).
 * ============================================================ */
const Auth = {
  KEY: 'sipela.auth',
  get() { try { return JSON.parse(sessionStorage.getItem(this.KEY) || localStorage.getItem(this.KEY) || 'null'); } catch { return null; } },
  role() { return this.get()?.role || null; },
  name() { return this.get()?.name || ''; },
  readOnly() { return this.role() !== 'admin'; },
  logout() {
    // keluar harus instan: batalkan penulisan tertunda & render yang sedang berjalan, lalu ganti halaman
    try { if (window.Store) { clearTimeout(Store._pt); Store._pending = null; } if (window.MapView) MapView._renderToken = (MapView._renderToken || 0) + 1; } catch {}
    try { sessionStorage.removeItem(this.KEY); localStorage.removeItem(this.KEY); } catch {}
    location.replace('login.html');
  },
  require() {
    if (this.role()) return true;
    location.replace('login.html?next=' + encodeURIComponent(location.pathname.split('/').pop() || 'index.html') + (location.hash || ''));
    return false;
  },
};
Auth.require();
