'use strict';
/**
 * ============================================================
 * Layer Farm SIM — Frontend (JavaScript.html)
 * Arsitektur SPA: doGet() hanya sekali; semua navigasi lewat navigateTo().
 * Token sesi disimpan di memori (App.token), TIDAK PERNAH di URL.
 * ============================================================
 */

const TZ = 'Asia/Jakarta';

// Logo aplikasi: maskot ayam (PNG transparan 360px, disematkan langsung agar tidak bergantung pada layanan luar).
// Dipakai di layar muat, login, header, dan sidebar.
const APP_LOGO = 'assets/logo.png';

const App = {
  token: null, user: null, config: {}, floks: [], petugas: [],
  page: null, seq: 0, flokId: null, confirmFn: null, charts: {},
  input: { tanggal: null, ctx: null, form: null },
  obat: { tanggal: null, ctx: null, form: null },
  riwayat: { tab: 'harian', q: '', sesi: '', periode: 7, flok: '', data: null },
  dash: { hari: 7, groupBy: 'hari', flok: '', data: null },
  kelola: { tab: 'flok', data: null }
};

// ════════════════════════════════════════════════════════
// BAGIAN 1: UTILITAS
// ════════════════════════════════════════════════════════

const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

function esc(v) {
  return String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* diabaikan */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* diabaikan */ } }
};

// ════════════════════════════════════════════════════════
// CACHE ANTARMUKA (stale-while-revalidate)
// Halaman yang pernah dibuka tampil INSTAN dari cache, lalu disegarkan diam-diam
// di latar belakang. Cache dihapus otomatis setiap ada perubahan data & saat logout.
// ════════════════════════════════════════════════════════
const RC = new Map();
const RC_FRESH_MS = 15000;     // data lebih muda dari ini dianggap segar (tidak perlu cek server)
const rcKey = (fn, args) => (App.user ? App.user.email : '?') + '|' + fn + '|' + JSON.stringify(args);
function rcGet(k) {
  let e = RC.get(k);
  if (!e) {
    const raw = store.get('rc:' + k);
    if (raw) { try { e = JSON.parse(raw); RC.set(k, e); } catch (x) { e = null; } }
  }
  return e || null;
}
function rcSet(k, res) {
  const e = { t: Date.now(), res: res };
  RC.set(k, e);
  if (store.get('agl_token')) store.set('rc:' + k, JSON.stringify(e));
}
function rcHas(fn, args) { return !!rcGet(rcKey(fn, args)); }
function rcClear() {
  RC.clear();
  try { Object.keys(localStorage).filter(k => k.indexOf('rc:') === 0).forEach(k => localStorage.removeItem(k)); } catch (e) { /* abaikan */ }
}
const clone = o => JSON.parse(JSON.stringify(o));
function typing() { const a = document.activeElement; return !!a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && !!a.closest('#app-container'); }

/**
 * Ambil data dengan cache. Ada cache -> kembalikan langsung (0 ms) & segarkan di latar belakang;
 * onFresh dipanggil hanya jika isi dari server ternyata berbeda. Tidak ada cache -> tunggu server.
 */
async function swr(fn, args, onFresh) {
  const k = rcKey(fn, args), e = rcGet(k);
  if (e) {
    if (Date.now() - e.t > RC_FRESH_MS) {
      apiBg(fn, App.token, ...args).then(res => {
        if (!res || !res.success) return;
        const sama = JSON.stringify(res.data) === JSON.stringify(e.res.data);
        rcSet(k, res);
        if (!sama && onFresh) onFresh(clone(res));
      }).catch(() => {});
    }
    return clone(e.res);
  }
  const res = await call(fn, App.token, ...args);
  if (res) rcSet(k, res);
  return res;
}

// Argumen baku tiap halaman (dipakai render & prefetch agar kunci cache sama)
const inputDate = () => isOwner() ? (App.input.tanggal || hariIniWIB()) : hariIniWIB();
const obatDate = () => isOwner() ? (App.obat.tanggal || hariIniWIB()) : hariIniWIB();
const argsRiwayat = () => [{ hari: isOwner() ? App.riwayat.periode : 7, flok_id: App.riwayat.flok }];
const argsDash = () => { const f = currentFlok(); return [{ flok_id: App.dash.flok || (f ? f.flok_id : ''), hari: App.dash.hari, groupBy: App.dash.groupBy }]; };

/** Muat diam-diam halaman lain agar perpindahan menu terasa instan. */
let warmTimer = null;
function warm(delay) {
  clearTimeout(warmTimer);
  warmTimer = setTimeout(async () => {
    if (!App.user || !App.token) return;
    const f = currentFlok();
    const jobs = [];
    if (f) {
      jobs.push(['getInputContext', [f.flok_id, inputDate()]]);
      jobs.push(['getObatContext', [f.flok_id, obatDate()]]);
    }
    jobs.push(['getRiwayat', argsRiwayat()]);
    if (isOwner() || isAdmin()) jobs.push(['getDashboard', argsDash()]);
    if (isOwner()) jobs.push(['getKelola', []]);
    for (const j of jobs) {
      if (!App.user) return;
      const k = rcKey(j[0], j[1]), e = rcGet(k);
      if (e && Date.now() - e.t < RC_FRESH_MS * 4) continue;
      try { const r = await apiBg(j[0], App.token, ...j[1]); if (r && r.success) rcSet(k, r); } catch (x) { /* abaikan */ }
    }
  }, delay === undefined ? 400 : delay);
}

const nf0 = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });
function fInt(n) { return (n === null || n === undefined || isNaN(n)) ? '-' : nf0.format(n); }
function fDec(n, d) {
  if (n === null || n === undefined || isNaN(n)) return '-';
  return Number(n).toLocaleString('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d });
}
function cap(s) { return s === 'PAGI' ? 'Pagi' : (s === 'SORE' ? 'Sore' : s); }

function hariIniWIB() { return new Date().toLocaleDateString('en-CA', { timeZone: TZ }); }
function jamWIB() { return new Date().toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }); }
function tglObj(s) { const p = String(s).split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])); }
function tglPanjang(s) {
  if (!s) return '-';
  return tglObj(s).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}
function tglPendek(s) {
  if (!s) return '-';
  return tglObj(s).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

const cfgNum = (k, d) => { const v = Number(String(App.config[k]).replace(',', '.')); return isFinite(v) ? v : d; };
const cfgList = k => String(App.config[k] || '').split(',').map(s => s.trim()).filter(Boolean);

function isOwner() { return !!App.user && App.user.peran === 'PEMILIK'; }
function isAdmin() { return !!App.user && App.user.peran === 'ADMIN'; }
function roleLabel(p) { return p === 'PEMILIK' ? 'Pemilik' : (p === 'ADMIN' ? 'Admin' : 'Anak Kandang'); }
function activeFloks() { return App.floks.filter(f => f.status === 'AKTIF'); }
function currentFlok() {
  const a = activeFloks();
  if (!a.length) return null;
  let f = a.find(x => x.flok_id === App.flokId);
  if (!f) { f = a[0]; App.flokId = f.flok_id; }
  return f;
}
function syncFlok(f) {
  if (!f) return;
  const i = App.floks.findIndex(x => x.flok_id === f.flok_id);
  if (i >= 0) App.floks[i] = f; else App.floks.push(f);
}

// ── Toast ──
function toast(msg, type) {
  const icons = { success: 'bi-check-circle-fill', error: 'bi-exclamation-octagon-fill', warn: 'bi-exclamation-triangle-fill', info: 'bi-info-circle-fill' };
  const t = type || 'info';
  const el = document.createElement('div');
  el.className = 'toast t-' + t;
  el.setAttribute('role', t === 'error' ? 'alert' : 'status');
  el.innerHTML = '<i class="bi ' + icons[t] + '"></i><span>' + esc(msg) + '</span>';
  $('#toastRoot').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 260); }, t === 'error' ? 5200 : 3200);
}

// ── Progres & tombol sibuk ──
let busyCount = 0;
function busy(delta) {
  busyCount = Math.max(0, busyCount + delta);
  $('#topProgress').classList.toggle('on', busyCount > 0);
}
function setBusyBtn(btn, on, text) {
  if (!btn) return;
  if (on) {
    if (btn.dataset.orig === undefined) btn.dataset.orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span> ' + esc(text || 'Memproses...');
  } else {
    if (btn.dataset.orig !== undefined) { btn.innerHTML = btn.dataset.orig; delete btn.dataset.orig; }
    btn.disabled = false;
  }
}

/** Panggil server; bila gagal tampilkan toast dan kembalikan null. */
async function call(fn, ...args) {
  try {
    const res = await api(fn, ...args);
    if (!res || !res.success) { toast((res && res.message) || 'Terjadi kesalahan.', 'error'); return null; }
    if (!/^get/.test(fn)) { rcClear(); warm(1500); }   // data berubah -> buang cache lama, isi ulang di latar belakang
    return res;
  } catch (e) {
    if (e && e.message === 'SESI_HABIS') return null;
    toast(e && /GAS_URL/.test(e.message) ? e.message : 'Gagal terhubung ke server. Periksa koneksi internet Anda.', 'error');
    return null;
  }
}

// ── Lembar modal (bottom sheet) ──
function openSheet(title, html) {
  $('#sheetRoot').innerHTML =
    '<div class="sheet-backdrop" onclick="if(event.target===this)closeSheet()">' +
    '<div class="sheet" role="dialog" aria-modal="true" aria-label="' + esc(title) + '">' +
    '<div class="sheet-head"><h3>' + esc(title) + '</h3>' +
    '<button class="icon-btn" aria-label="Tutup" onclick="closeSheet()"><i class="bi bi-x-lg"></i></button></div>' +
    html + '</div></div>';
  document.body.classList.add('no-scroll');
}
function closeSheet() {
  const r = $('#sheetRoot');
  if (r) r.innerHTML = '';
  document.body.classList.remove('no-scroll');
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

function confirmSheet(o) {
  App.confirmFn = o.onOk;
  const rows = (o.rows || []).map(r => '<div class="sum-row"><span>' + esc(r[0]) + '</span><strong>' + esc(r[1]) + '</strong></div>').join('');
  openSheet(o.title,
    (o.note ? '<p class="sheet-note">' + esc(o.note) + '</p>' : '') +
    '<div class="sum">' + rows + '</div>' +
    '<div class="sheet-actions">' +
    '<button class="btn btn-soft" onclick="closeSheet()">' + esc(o.cancelText || 'Periksa Lagi') + '</button>' +
    '<button class="btn ' + (o.danger ? 'btn-danger' : 'btn-primary') + '" id="confirmOkBtn" onclick="runConfirm()">' + esc(o.okText || 'Ya, Simpan') + '</button>' +
    '</div>');
}
async function runConfirm() {
  const fn = App.confirmFn;
  if (!fn) return;
  const btn = $('#confirmOkBtn');
  setBusyBtn(btn, true, 'Memproses...');
  try { await fn(); } finally { setBusyBtn(btn, false); }
}

function skeleton() {
  return '<div class="skel" style="height:150px"></div><div class="skel" style="height:72px"></div>' +
    '<div class="skel" style="height:190px"></div><div class="skel" style="height:150px"></div>';
}
function errorCard(msg, retry) {
  return '<section class="card empty"><i class="bi bi-wifi-off"></i><strong>' + esc(msg) + '</strong>' +
    '<p class="sm">Periksa koneksi internet lalu coba lagi.</p>' +
    '<button class="btn btn-primary" onclick="' + retry + '"><i class="bi bi-arrow-repeat"></i> Muat Ulang</button></section>';
}
function emptyFlokHtml() {
  return '<section class="card empty"><i class="bi bi-house-add"></i><strong>Belum ada flok aktif</strong>' +
    '<p class="sm">' + (isOwner() ? 'Tambahkan flok terlebih dahulu di menu Kelola.' : 'Hubungi pemilik kandang untuk menambahkan flok.') + '</p>' +
    (isOwner() ? '<button class="btn btn-primary" onclick="navigateTo(\'kelola\')">Buka Kelola</button>' : '') + '</section>';
}

// ── Tema ──
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  store.set('agl_theme', t);
  const m = document.querySelector('meta[name="theme-color"]');
  if (m) m.setAttribute('content', t === 'dark' ? '#1B0D0C' : '#ff3a3a');
}
function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  const sw = $('#themeSw');
  if (sw) sw.checked = next === 'dark';
  if (App.page === 'dashboard' && App.dash.data) paintDashboard();
}

// ════════════════════════════════════════════════════════
// BAGIAN 2: LOGIN, SESI, KERANGKA APLIKASI
// ════════════════════════════════════════════════════════

/** Pasang logo ke semua elemen .js-logo (layar muat, header, sidebar). */
function pasangLogo() {
  $$('.js-logo').forEach(el => { el.innerHTML = '<img src="' + APP_LOGO + '" alt="Logo Fabry Layer Farm">'; });
}

function renderLogin(msg) {
  $('#appShell').hidden = true;
  const v = $('#loginView');
  v.hidden = false;
  v.innerHTML =
    '<div class="login-wrap"><div class="login-card card">' +
    '<div class="login-logo"><img src="' + APP_LOGO + '" alt="Logo Fabry Layer Farm"></div>' +
    '<h1>Fabry Layer Farm <span class="badge b-gold">SIM</span></h1>' +
    '<p class="muted sm" style="margin-top:4px">Recording harian kandang layer</p>' +
    '<form onsubmit="doLogin(event)" novalidate>' +
    '<label class="lbl" for="lg_user">Username</label>' +
    '<input id="lg_user" class="input" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="mis. admin atau pemilik">' +
    '<label class="lbl" for="lg_pin">PIN</label>' +
    '<div class="pin-wrap"><input id="lg_pin" class="input" type="password" inputmode="numeric" autocomplete="current-password" maxlength="8" placeholder="••••••">' +
    '<button type="button" class="icon-btn" aria-label="Tampilkan atau sembunyikan PIN" onclick="togglePin()"><i class="bi bi-eye" id="pinEye"></i></button></div>' +
    '<label class="check"><input type="checkbox" id="lg_remember" checked> Ingat saya di perangkat ini</label>' +
    '<div id="lg_err" class="form-error" role="alert" ' + (msg ? '' : 'hidden') + '>' + esc(msg || '') + '</div>' +
    '<button class="btn btn-primary btn-xl btn-block" id="lg_btn" type="submit">Masuk</button>' +
    '</form>' +
    '<p class="foot-note"><i class="bi bi-shield-lock"></i> Hanya akun yang didaftarkan pemilik yang dapat masuk.</p>' +
    '</div></div>';
}
function togglePin() {
  const i = $('#lg_pin');
  const show = i.type === 'password';
  i.type = show ? 'text' : 'password';
  $('#pinEye').className = 'bi ' + (show ? 'bi-eye-slash' : 'bi-eye');
}
function showLoginErr(m) {
  const e = $('#lg_err');
  if (!e) return;
  e.textContent = m;
  e.hidden = false;
}

async function doLogin(ev) {
  ev.preventDefault();
  const u = $('#lg_user').value.trim();
  const p = $('#lg_pin').value.trim();
  $('#lg_err').hidden = true;
  if (!u || !p) { showLoginErr('Isi username dan PIN terlebih dahulu.'); return; }
  const btn = $('#lg_btn');
  const remember = $('#lg_remember').checked;
  setBusyBtn(btn, true, 'Memeriksa...');
  try {
    const res = await api('loginPin', u, p);
    if (!res.success) { showLoginErr(res.message); return; }
    App.token = res.data.token;
    if (remember) store.set('agl_token', App.token); else store.del('agl_token');
    if (res.data.boot && res.data.boot.user) { saveBoot(res.data.boot); applyBootstrap(res.data.boot); showShell(); }
    else await enterApp();
  } catch (e) {
    showLoginErr('Tidak dapat terhubung ke server. Periksa koneksi internet Anda.');
  } finally {
    setBusyBtn(btn, false);
  }
}

function saveBoot(d) { if (store.get('agl_token')) store.set('agl_boot', JSON.stringify({ token: App.token, data: d })); }
function applyBootstrap(d) {
  App.user = d.user; App.config = d.config; App.floks = d.floks; App.petugas = d.petugas;
}
function showShell() {
  $('#loginView').hidden = true;
  $('#loginView').innerHTML = '';
  $('#appShell').hidden = false;
  buildShell();
  navigateTo((isOwner() || isAdmin()) ? 'dashboard' : 'input');
  warm(600);
}

/** Masuk ke aplikasi. fromCache=true: tampil seketika dari data tersimpan, lalu disegarkan diam-diam. */
async function enterApp(fromCache) {
  if (fromCache) {
    const raw = store.get('agl_boot');
    if (raw) {
      try {
        const b = JSON.parse(raw);
        if (b && b.token === App.token && b.data && b.data.user) {
          applyBootstrap(b.data);
          showShell();
          apiBg('getBootstrap', App.token).then(res => {
            if (!res || !res.success) return;
            saveBoot(res.data);
            applyBootstrap(res.data);
            renderHeader();
          }).catch(() => {});
          return;
        }
      } catch (e) { /* cache rusak, lanjut ke server */ }
    }
  }
  const res = await api('getBootstrap', App.token);
  if (!res.success) {
    App.token = null;
    store.del('agl_token');
    renderLogin(res.message === 'SESI_HABIS' ? '' : res.message);
    return;
  }
  saveBoot(res.data);
  applyBootstrap(res.data);
  showShell();
}

async function refreshBootstrap() {
  const res = await call('getBootstrap', App.token);
  if (!res) return;
  saveBoot(res.data);
  applyBootstrap(res.data);
  renderHeader();
}

function resetAppState() {
  destroyCharts();
  rcClear(); store.del('agl_boot');
  App.floks = []; App.config = {}; App.petugas = []; App.flokId = null; App.page = null;
  App.input = { tanggal: null, ctx: null, form: null };
  App.obat = { tanggal: null, ctx: null, form: null };
  App.riwayat = { tab: 'harian', q: '', sesi: '', periode: 7, flok: '', data: null };
  App.dash = { hari: 7, groupBy: 'hari', flok: '', data: null };
  App.kelola = { tab: 'flok', data: null };
}
function forceLogout(msg) {
  App.token = null; App.user = null;
  store.del('agl_token');
  resetAppState();
  closeSheet();
  renderLogin(msg || '');
}
function logout() {
  const t = App.token;
  if (t) { api('logout', t).catch(() => {}); }
  forceLogout('');
}

function navItems() {
  if (isOwner()) {
    return [
      { id: 'dashboard', label: 'Dashboard', icon: 'bi-graph-up-arrow' },
      { id: 'input', label: 'Input Harian', short: 'Input', icon: 'bi-pencil-square' },
      { id: 'riwayat', label: 'Riwayat', icon: 'bi-clock-history' },
      { id: 'obat', label: 'Obat & Vaksin', short: 'Obat/Vaksin', icon: 'bi-capsule' },
      { id: 'kelola', label: 'Kelola', icon: 'bi-sliders' }
    ];
  }
  const dasbor = isAdmin() ? [{ id: 'dashboard', label: 'Dashboard', icon: 'bi-graph-up-arrow' }] : [];
  return dasbor.concat([
    { id: 'input', label: 'Input Harian', icon: 'bi-pencil-square' },
    { id: 'riwayat', label: 'Riwayat 7 Hari', icon: 'bi-clock-history' },
    { id: 'obat', label: 'Obat & Vaksin', icon: 'bi-capsule' },
    { id: 'profil', label: 'Profil', icon: 'bi-person-vcard' }
  ]);
}

function buildShell() {
  const items = navItems();
  $('#bottomNav').innerHTML = items.map(i =>
    '<button class="bn-item" data-page="' + i.id + '" onclick="navigateTo(\'' + i.id + '\')" aria-label="' + esc(i.label) + '">' +
    '<span class="bn-ico"><i class="bi ' + i.icon + '"></i></span><span>' + esc(i.short || i.label) + '</span></button>').join('');
  const side = items.concat(isOwner() ? [{ id: 'profil', label: 'Profil', icon: 'bi-person-vcard' }] : []);
  $('#sideNav').innerHTML = side.map(i =>
    '<button class="sd-item" data-page="' + i.id + '" onclick="navigateTo(\'' + i.id + '\')"><i class="bi ' + i.icon + '"></i><span>' + esc(i.label) + '</span></button>').join('');
  renderHeader();
}

function renderHeader() {
  const f = activeFloks()[0];
  $('#hdrStatus').innerHTML = f
    ? '<span class="dot"></span> ' + esc(f.nama_flok) + ' • Aktif • <span id="hdrTime">' + jamWIB() + '</span> WIB'
    : '<span class="dot off"></span> Belum ada flok aktif';
  $('#hdrUser').textContent = App.user.nama;
  $('#hdrRole').textContent = roleLabel(App.user.peran);
}
setInterval(() => { const t = $('#hdrTime'); if (t) t.textContent = jamWIB(); }, 20000);

const PAGES = {
  dashboard: () => renderDashboard(), input: () => renderInput(), riwayat: () => renderRiwayat(),
  obat: () => renderObat(), kelola: () => renderKelola(), profil: () => renderProfil()
};

/** SATU-SATUNYA cara berpindah halaman. Tidak mengubah URL. */
function navigateTo(page) {
  if (!PAGES[page]) return;
  if (!isOwner() && (page === 'kelola' || (page === 'dashboard' && !isAdmin()))) page = 'input';
  App.page = page;
  App.seq++;
  destroyCharts();
  closeSheet();
  $$('[data-page]').forEach(b => {
    const on = b.dataset.page === page;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  $('#app-container').classList.toggle('narrow', page === 'input' || page === 'obat' || page === 'profil');
  window.scrollTo({ top: 0 });
  PAGES[page]();
}

// ════════════════════════════════════════════════════════
// BAGIAN 3: INPUT HARIAN
// ════════════════════════════════════════════════════════

function resetInputForm() { App.input.form = { telur: '', kg: '', mati: 0, afkir: 0, pakan: '', catatan: '' }; }

async function renderInput() {
  const seq = App.seq;
  const c = $('#app-container');
  const flok = currentFlok();
  if (!flok) { c.innerHTML = emptyFlokHtml(); return; }
  if (!App.input.form) resetInputForm();
  App.input.tanggal = inputDate();
  const args = [flok.flok_id, App.input.tanggal];
  if (!rcHas('getInputContext', args)) c.innerHTML = skeleton();
  const apply = r => { App.input.ctx = r.data; syncFlok(r.data.flok); };
  const res = await swr('getInputContext', args, r => {
    if (seq !== App.seq) return;
    apply(r);
    if (!typing()) paintInput();
  });
  if (seq !== App.seq) return;
  if (!res) { c.innerHTML = errorCard('Gagal memuat form input.', 'renderInput()'); return; }
  apply(res);
  paintInput();
}

function onFlokChange(id) { App.flokId = id; resetInputForm(); App.obat.ctx = null; if (App.page === 'obat') renderObat(); else renderInput(); }
function onTanggalChange(v) { if (!v) return; App.input.tanggal = v; renderInput(); }

function flokSelectHtml() {
  const a = activeFloks();
  if (a.length < 2) return '';
  return '<div class="card" style="padding:12px"><label class="lbl" for="selFlok" style="margin:0 0 6px">Pilih Flok</label>' +
    '<select id="selFlok" class="input" onchange="onFlokChange(this.value)">' +
    a.map(f => '<option value="' + esc(f.flok_id) + '"' + (f.flok_id === App.flokId ? ' selected' : '') + '>' + esc(f.nama_flok) + (f.strain ? ' — ' + esc(f.strain) : '') + '</option>').join('') +
    '</select></div>';
}

function faseLabel(umur) { return umur < 19 ? 'Fase Pra-produksi' : 'Layer Produktif'; }

function paintInput() {
  if (App.page !== 'input') return;
  const c = $('#app-container');
  const ctx = App.input.ctx;
  const flok = ctx.flok;
  const rec = ctx.rec;

  const tglBlok = isOwner()
    ? '<input id="f_tanggal" class="input" type="date" style="min-height:40px;width:auto;font-size:13px" max="' + hariIniWIB() + '" min="' + esc(flok.tanggal_masuk) + '" value="' + esc(ctx.tanggal) + '" onchange="onTanggalChange(this.value)" aria-label="Tanggal pencatatan">'
    : '<span class="badge b-gold"><i class="bi bi-lock-fill"></i> Kunci Server</span>';

  const info =
    '<section class="card info-card">' +
    '<div class="row-between"><div class="row gap8"><i class="bi bi-calendar3 ico-pri"></i><strong>' + esc(tglPanjang(ctx.tanggal)) + '</strong></div>' + tglBlok + '</div>' +
    '<div class="flok-row"><div><div class="eyebrow">KANDANG AKTIF</div>' +
    '<h2 class="flok-name">' + esc(flok.nama_flok) + (flok.strain ? ' — ' + esc(flok.strain) : '') + '</h2>' +
    '<p class="muted sm">' + faseLabel(flok.umur_minggu) + ' • Umur ' + flok.umur_minggu + ' Minggu</p></div>' +
    '<div class="pop-box"><span>Populasi Hidup</span><strong>' + fInt(flok.populasi_sekarang) + '</strong><small>ekor</small></div></div></section>';

  c.innerHTML = flokSelectHtml() + info + (rec ? lockedCard(rec) : formCards(flok));
  if (!rec) updateDerived();
}

function lockedCard(rec) {
  const tot = rec.deplesi_mati + rec.deplesi_afkir;
  const rows = [
    ['Telur', fInt(rec.telur_butir) + ' butir'],
    ['Total berat telur', rec.telur_butir > 0 ? fDec(rec.telur_kg, 1) + ' kg' : '-'],
    ['Rata-rata bobot', rec.telur_butir > 0 ? fDec(rec.berat_telur_rata2_gram, 1) + ' gr' : '-'],
    ['Deplesi', tot + ' ekor (mati ' + rec.deplesi_mati + ', afkir ' + rec.deplesi_afkir + ')'],
    ['Pakan', fDec(rec.pakan_kg, 1) + ' kg']
  ].map(r => '<div class="sum-row"><span>' + esc(r[0]) + '</span><strong>' + esc(r[1]) + '</strong></div>').join('');
  return '<section class="card"><div class="card-head"><span class="ico-badge ok"><i class="bi bi-check-circle-fill"></i></span>' +
    '<div><h3>Rekap harian sudah tersimpan</h3><p class="muted sm">Diinput ' + esc(rec.diinput_oleh) + ' • ' + esc((rec.waktu_input || '').slice(11, 16)) + ' WIB</p></div></div>' +
    '<div class="sum">' + rows + '</div>' +
    (rec.catatan ? '<p class="rec-note" style="margin-top:12px">' + esc(rec.catatan) + '</p>' : '') +
    '<p class="sheet-note" style="margin-top:12px">' +
    (isOwner() ? 'Untuk mengoreksi data ini, buka menu Riwayat.' : 'Data yang sudah tersimpan tidak dapat diubah. Hubungi pemilik kandang bila ada kesalahan input.') + '</p>' +
    (isOwner() ? '<button class="btn btn-soft btn-block" style="margin-top:12px" onclick="navigateTo(\'riwayat\')">Buka Riwayat</button>' : '') +
    '</section>';
}

function formCards(flok) {
  const F = App.input.form;
  const tags = cfgList('tag_kondisi').map(t => '<button type="button" class="chip" data-t="' + esc(t) + '" onclick="addTag(\'f_catatan\',this.dataset.t)">+ ' + esc(t) + '</button>').join('');
  return '' +
    // Telur
    '<section class="card"><div class="card-head"><span class="ico-badge gold"><i class="bi bi-egg-fried"></i></span>' +
    '<div><h3>Hasil Telur Hari Ini</h3><p class="muted sm">Jumlah butir semua grade</p></div><span class="badge b-gold">Fokus Utama</span></div>' +
    '<div class="stepper"><button type="button" class="step-btn minus" onclick="stepField(\'telur\',-10,0)" aria-label="Kurangi 10 butir">−10</button>' +
    '<input id="f_telur" class="num-input" type="number" inputmode="numeric" min="0" step="1" placeholder="0" value="' + esc(F.telur) + '" oninput="onFormInput()" aria-label="Jumlah telur (butir)">' +
    '<button type="button" class="step-btn plus" onclick="stepField(\'telur\',10,0)" aria-label="Tambah 10 butir">+10</button></div>' +
    '<label class="lbl" for="f_kg">Total Berat Telur</label>' +
    '<div class="stepper"><button type="button" class="step-btn minus" onclick="stepField(\'kg\',-1,0)" aria-label="Kurangi 1 kilogram">−1</button>' +
    '<div class="input-unit"><input id="f_kg" class="input" type="number" inputmode="decimal" min="0" step="0.1" placeholder="0" value="' + esc(F.kg) + '" oninput="onFormInput()" aria-label="Total berat telur (kg)" style="text-align:center;padding-left:14px"><span>Kilogram</span></div>' +
    '<button type="button" class="step-btn plus" onclick="stepField(\'kg\',1,0)" aria-label="Tambah 1 kilogram">+1</button></div>' +
    '<p class="field-hint">Timbang semua telur hari ini. Rata-rata bobot dihitung otomatis di bawah.</p></section>' +
    // Berat
    '<section class="card"><div class="card-head"><span class="ico-badge pri"><i class="bi bi-speedometer2"></i></span>' +
    '<div><h3>Rata-rata Bobot Telur</h3><p class="muted sm">Standar ' + esc(flok.strain || 'strain') + ': ' + fDec(cfgNum('berat_min', 61), 0) + ' – ' + fDec(cfgNum('berat_max', 64), 0) + ' gr • otomatis</p></div>' +
    '<span class="badge b-muted" id="d_beratBadge">Menunggu data</span></div>' +
    '<div class="avg-box" aria-live="polite"><strong id="d_avg">-</strong><span>gram / butir</span></div>' +
    '<p class="field-hint" id="d_avgFormula">Dihitung dari total kg ÷ jumlah butir.</p></section>' +
    // Deplesi
    '<section class="card"><div class="card-head"><span class="ico-badge coral"><i class="bi bi-heart-pulse"></i></span>' +
    '<div><h3>Deplesi Populasi Hari Ini</h3><p class="muted sm">Mati dan afkir fisik</p></div><span class="badge b-ok" id="d_deplBadge">0 Ekor</span></div>' +
    '<div class="depl-grid">' + deplBox('mati', 'MATI', F.mati) + deplBox('afkir', 'AFKIR', F.afkir) + '</div>' +
    '<p class="status-line" id="d_deplMsg"></p></section>' +
    // Pakan
    '<section class="card"><div class="card-head"><span class="ico-badge pri"><i class="bi bi-box-seam"></i></span>' +
    '<div><h3>Pakan Diberikan Hari Ini</h3><p class="muted sm" id="d_pakanCtx"></p></div></div>' +
    '<div class="stepper"><button type="button" class="step-btn minus" onclick="stepField(\'pakan\',-5,0)" aria-label="Kurangi 5 kilogram">−5</button>' +
    '<div class="input-unit"><input id="f_pakan" class="input" type="number" inputmode="decimal" min="0" step="0.5" placeholder="0" value="' + esc(F.pakan) + '" oninput="onFormInput()" aria-label="Pakan diberikan (kg)" style="text-align:center;padding-left:14px"><span>Kilogram</span></div>' +
    '<button type="button" class="step-btn plus" style="background:var(--pri-surface);color:var(--pri-ink)" onclick="stepField(\'pakan\',5,0)" aria-label="Tambah 5 kilogram">+5</button></div>' +
    '<div class="pakan-stats"><div><small>Rasio Pakan Hari Ini</small><strong id="d_rasio">-</strong></div>' +
    '<div class="r"><small>Total Pakan Kumulatif</small><strong id="d_kum">-</strong></div></div></section>' +
    // Catatan
    '<section class="card"><div class="card-head"><span class="ico-badge sky"><i class="bi bi-journal-text"></i></span>' +
    '<div><h3>Catatan Kondisi Kandang</h3><p class="muted sm">Sentuh tag cepat untuk mengisi</p></div></div>' +
    '<div class="tags">' + tags + '</div>' +
    '<textarea id="f_catatan" class="input" maxlength="300" placeholder="Tuliskan catatan tambahan lapangan..." oninput="onFormInput()" aria-label="Catatan tambahan">' + esc(F.catatan) + '</textarea></section>' +
    '<div class="lock-note"><span class="dot"></span><span>Data aman: dikunci server &amp; langsung tersimpan ke Sheets</span><i class="bi bi-cloud-check"></i></div>' +
    '<div class="savebar"><button class="btn btn-primary btn-xl btn-block" onclick="submitInput()"><i class="bi bi-save"></i> Simpan Rekap Harian</button>' +
    '<div class="savebar-sub"><button class="link-btn" type="button" onclick="resetInputUi()"><i class="bi bi-arrow-counterclockwise"></i> Atur Ulang Form</button>' +
    (isOwner() ? '' : '<span>Setelah disimpan, data tidak bisa diubah anak kandang</span>') + '</div></div>';
}

function deplBox(id, label, val) {
  const warna = id === 'mati' ? 'var(--coral-text)' : 'var(--gold-text)';
  return '<div class="depl-box"><label for="f_' + id + '" style="color:' + warna + '">' + label + '</label>' +
    '<div class="mini-stepper"><button type="button" class="mini" onclick="stepField(\'' + id + '\',-1,0)" aria-label="Kurangi ' + label.toLowerCase() + '">−</button>' +
    '<input id="f_' + id + '" type="number" inputmode="numeric" min="0" step="1" value="' + esc(val) + '" oninput="onFormInput()" aria-label="Jumlah ' + label.toLowerCase() + ' (ekor)">' +
    '<button type="button" class="mini" onclick="stepField(\'' + id + '\',1,0)" aria-label="Tambah ' + label.toLowerCase() + '">+</button></div><small>ekor</small></div>';
}

function numVal(id) {
  const el = $('#' + id);
  if (!el) return NaN;
  const v = String(el.value).trim().replace(',', '.');
  return v === '' ? NaN : Number(v);
}
function onFormInput() {
  const F = App.input.form;
  F.telur = $('#f_telur').value; F.kg = $('#f_kg').value;
  F.mati = $('#f_mati').value; F.afkir = $('#f_afkir').value;
  F.pakan = $('#f_pakan').value; F.catatan = $('#f_catatan').value;
  $$('.invalid').forEach(e => e.classList.remove('invalid'));
  updateDerived();
}
function stepField(id, delta, min) {
  const el = $('#f_' + id);
  let v = numVal('f_' + id);
  if (isNaN(v)) v = 0;
  el.value = Math.max(min, Math.round((v + delta) * 10) / 10);
  onFormInput();
}
function setField(id, val) { $('#f_' + id).value = val; onFormInput(); }
function addTag(id, text) {
  const el = $('#' + id);
  const t = String(text).trim();
  const cur = el.value.trim();
  if (cur.split(/\s*;\s*/).indexOf(t) >= 0) return;
  el.value = cur ? cur + '; ' + t : t;
  el.dispatchEvent(new Event('input'));
}
function resetInputUi() { resetInputForm(); paintInput(); }

function updateDerived() {
  const ctx = App.input.ctx;
  if (!ctx || !$('#f_telur')) return;
  const pop = ctx.flok.populasi_sekarang;
  const telur = numVal('f_telur'), kg = numVal('f_kg');
  const mati = numVal('f_mati') || 0, afkir = numVal('f_afkir') || 0, pakan = numVal('f_pakan');

  // Rata-rata bobot otomatis = total kg × 1000 ÷ jumlah butir
  const berat = (telur > 0 && kg > 0) ? kg * 1000 / telur : NaN;
  $('#d_avg').textContent = isNaN(berat) ? '-' : fDec(berat, 1);
  $('#d_avgFormula').textContent = isNaN(berat) ? 'Dihitung dari total kg ÷ jumlah butir.'
    : fDec(kg, 1) + ' kg × 1000 ÷ ' + fInt(telur) + ' butir = ' + fDec(berat, 2) + ' gr/butir';

  const bmin = cfgNum('berat_min', 61), bmax = cfgNum('berat_max', 64);
  const bb = $('#d_beratBadge');
  if (isNaN(berat)) { bb.className = 'badge b-muted'; bb.textContent = 'Menunggu data'; }
  else if (berat < 30 || berat > 100) { bb.className = 'badge b-coral'; bb.textContent = 'Tidak wajar'; }
  else if (berat >= bmin && berat <= bmax) { bb.className = 'badge b-ok'; bb.textContent = 'Optimal'; }
  else { bb.className = 'badge b-gold'; bb.textContent = 'Di luar standar'; }

  const tot = mati + afkir;
  const basePop = pop;
  const pct = pop > 0 ? tot / pop * 100 : 0;
  const totHari = tot;
  const pctHari = basePop > 0 ? totHari / basePop * 100 : 0;
  const ambang = cfgNum('ambang_deplesi_persen', 0.1);
  const warn = pctHari > ambang;
  const db = $('#d_deplBadge');
  db.className = 'badge ' + (warn ? 'b-coral' : 'b-ok');
  db.textContent = tot + ' Ekor (' + fDec(pct, 2) + '%)';
  const dm = $('#d_deplMsg');
  dm.className = 'status-line' + (warn ? ' warn' : '');
  dm.innerHTML = '<i class="bi ' + (warn ? 'bi-exclamation-triangle-fill' : 'bi-check-circle') + '"></i><span>' +
    (warn ? 'Deplesi hari ini ' + totHari + ' ekor (' + fDec(pctHari, 2) + '%) melewati ambang ' + fDec(ambang, 2) + '%. Tulis penyebabnya di catatan.'
      : 'Status normal: total hari ini ' + totHari + ' ekor (' + fDec(pctHari, 2) + '%), ambang toleransi harian &lt; ' + fDec(ambang, 2) + '% (' + Math.floor(basePop * ambang / 100) + ' ekor)') + '</span>';

  const targetTotal = basePop * cfgNum('target_pakan_gram_per_ekor', 110) / 1000;
  $('#d_pakanCtx').textContent = 'Target pakan harian: ' + fDec(targetTotal, 0) + ' kg';
  const kum = isNaN(pakan) ? 0 : pakan;
  const zak = cfgNum('zak_kg', 50) || 50;
  $('#d_rasio').textContent = fDec(basePop > 0 ? kum * 1000 / basePop : 0, 1) + ' gr / ekor';
  $('#d_kum').textContent = fDec(kum, 0) + ' Kg (' + fDec(kum / zak, 1) + ' Zak)';
}

function submitInput() {
  const ctx = App.input.ctx;
  const pop = ctx.flok.populasi_sekarang;
  const telur = numVal('f_telur'), kgIn = numVal('f_kg'), mati = numVal('f_mati'), afkir = numVal('f_afkir'), pakan = numVal('f_pakan');
  const errs = [];
  const bulat = v => !isNaN(v) && v >= 0 && Number.isInteger(v);
  if (!bulat(telur)) errs.push(['f_telur', 'Isi jumlah telur (butir) dengan angka bulat.']);
  else if (telur > pop) errs.push(['f_telur', 'Jumlah telur melebihi populasi hidup. Periksa kembali.']);
  if (bulat(telur) && telur > 0) {
    if (isNaN(kgIn) || kgIn <= 0) errs.push(['f_kg', 'Isi total berat telur (kg).']);
    else {
      const avg = kgIn * 1000 / telur;
      if (avg < 30 || avg > 100) errs.push(['f_kg', 'Rata-rata bobot ' + fDec(avg, 1) + ' gr/butir tidak wajar (harus 30–100 gr). Periksa jumlah butir atau total kg.']);
    }
  }
  if (!bulat(mati)) errs.push(['f_mati', 'Isi jumlah ayam mati (boleh 0).']);
  if (!bulat(afkir)) errs.push(['f_afkir', 'Isi jumlah ayam afkir (boleh 0).']);
  if (bulat(mati) && bulat(afkir) && mati + afkir > pop) errs.push(['f_mati', 'Deplesi melebihi populasi hidup.']);
  if (isNaN(pakan) || pakan < 0) errs.push(['f_pakan', 'Isi jumlah pakan (kg).']);
  if (errs.length) {
    toast(errs[0][1], 'error');
    errs.forEach(e => { const el = $('#' + e[0]); if (el) el.classList.add('invalid'); });
    const first = $('#' + errs[0][0]);
    first.focus();
    first.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return;
  }
  const kgFinal = telur > 0 ? kgIn : 0;
  const beratFinal = telur > 0 ? kgFinal * 1000 / telur : 0;
  confirmSheet({
    title: 'Cek Sebelum Simpan',
    note: isOwner() ? '' : 'Setelah disimpan, data tidak dapat diubah oleh anak kandang. Pastikan angkanya benar.',
    rows: [
      ['Tanggal', tglPendek(ctx.tanggal)],
      ['Telur', fInt(telur) + ' butir'], ['Total berat telur', telur > 0 ? fDec(kgFinal, 1) + ' kg' : '-'],
      ['Rata-rata bobot', telur > 0 ? fDec(beratFinal, 1) + ' gr/butir' : '-'],
      ['Deplesi', (mati + afkir) + ' ekor (mati ' + mati + ', afkir ' + afkir + ')'], ['Pakan', fDec(pakan, 1) + ' kg']
    ],
    okText: 'Ya, Simpan',
    onOk: () => {
      const payload = {
        flok_id: ctx.flok.flok_id, tanggal: isOwner() ? ctx.tanggal : '',
        deplesi_mati: mati, deplesi_afkir: afkir, pakan_kg: pakan, telur_butir: telur,
        telur_kg: kgFinal, catatan: $('#f_catatan').value.trim()
      };
      // OPTIMISTIC UI: langsung tampil "tersimpan" (0 ms), kirim ke server di latar belakang.
      closeSheet();
      ctx.rec = {
        catatan_id: 'tmp', tanggal: ctx.tanggal, deplesi_mati: mati, deplesi_afkir: afkir, pakan_kg: pakan,
        telur_butir: telur, telur_kg: kgFinal, berat_telur_rata2_gram: beratFinal, catatan: payload.catatan,
        diinput_oleh: App.user.email, waktu_input: hariIniWIB() + ' ' + jamWIB() + ':00'
      };
      toast('Rekap harian tersimpan.', 'success');
      paintInput();
      call('simpanCatatanHarian', App.token, payload).then(res => {
        if (!res) {                       // gagal: kembalikan form dengan isian yang sama
          ctx.rec = null;
          if (App.input.ctx === ctx) paintInput();
          toast('Rekap belum tersimpan. Data Anda masih ada di form, silakan coba lagi.', 'error');
          return;
        }
        syncFlok(res.data.flok);
        ctx.flok = res.data.flok;
        if (ctx.rec) ctx.rec.catatan_id = res.data.catatan_id;
        resetInputForm();
        if (App.input.ctx === ctx) paintInput();
      });
    }
  });
}

// ════════════════════════════════════════════════════════
// BAGIAN 4: OBAT & VAKSIN
// ════════════════════════════════════════════════════════

const METODE_INFO = {
  'Tetes Mata': 'Intraokular', 'Air Minum': 'Water line', 'Suntik IM / SC': 'Otot dada / leher',
  'Spray Halus': 'Aerosol kandang', 'Campur Pakan': 'Dicampur ke pakan'
};
const METODE_VAKSIN = ['Tetes Mata', 'Air Minum', 'Suntik IM / SC', 'Spray Halus'];
const METODE_OBAT = ['Air Minum', 'Campur Pakan', 'Suntik IM / SC', 'Spray Halus'];

function resetObatForm(jenis) {
  App.obat.form = {
    jenis: jenis || 'VAKSIN', nama: '', metode: (jenis === 'OBAT' ? 'Air Minum' : 'Tetes Mata'),
    dosis: '1.0', waktu: Number(jamWIB().slice(0, 2)) < 12 ? 'PAGI' : 'SORE',
    petugas: App.user ? App.user.nama : '', lain: false, lainTeks: '', catatan: ''
  };
}

async function renderObat() {
  const seq = App.seq;
  const c = $('#app-container');
  const flok = currentFlok();
  if (!flok) { c.innerHTML = emptyFlokHtml(); return; }
  if (!App.obat.form) resetObatForm('VAKSIN');
  App.obat.tanggal = obatDate();
  const args = [flok.flok_id, App.obat.tanggal];
  if (!rcHas('getObatContext', args)) c.innerHTML = skeleton();
  const apply = r => { App.obat.ctx = r.data; syncFlok(r.data.flok); };
  const res = await swr('getObatContext', args, r => {
    if (seq !== App.seq) return;
    apply(r);
    if (!typing()) paintObat();
  });
  if (seq !== App.seq) return;
  if (!res) { c.innerHTML = errorCard('Gagal memuat form obat & vaksin.', 'renderObat()'); return; }
  apply(res);
  paintObat();
}

function setObatJenis(j) { resetObatForm(j); paintObat(); }
function onObatTanggal(v) { if (!v) return; App.obat.tanggal = v; renderObat(); }

function paintObat() {
  if (App.page !== 'obat') return;
  const c = $('#app-container');
  const ctx = App.obat.ctx, flok = ctx.flok, F = App.obat.form;
  const vaksin = F.jenis === 'VAKSIN';
  const tglBlok = isOwner()
    ? '<input class="input" type="date" style="min-height:40px;width:auto;font-size:13px" max="' + hariIniWIB() + '" min="' + esc(flok.tanggal_masuk) + '" value="' + esc(ctx.tanggal) + '" onchange="onObatTanggal(this.value)" aria-label="Tanggal aplikasi">'
    : '<span class="badge b-gold"><i class="bi bi-lock-fill"></i> Terkunci Server</span>';
  const lv = ctx.last_vaksin;
  const info =
    '<section class="card info-card"><div class="row-between"><div class="row gap8"><i class="bi bi-calendar3 ico-pri"></i><strong>' + esc(tglPanjang(ctx.tanggal)) + '</strong></div>' + tglBlok + '</div>' +
    '<div class="flok-row"><div class="row gap8"><span class="ico-badge pri"><i class="bi bi-house-heart"></i></span><div>' +
    '<h2 class="flok-name">' + esc(flok.nama_flok) + '</h2><p class="muted sm">' + (flok.strain ? esc(flok.strain) + ' • ' : '') + 'Umur ' + flok.umur_minggu + ' Mgg</p></div></div>' +
    '<div class="pop-box"><span>Populasi Aktif</span><strong>' + fInt(flok.populasi_sekarang) + '</strong><small>ekor</small></div></div>' +
    '<div class="vaksin-note"><i class="bi bi-shield-check"></i><span>' + (lv
      ? 'Vaksin Terakhir: <b>' + esc(lv.nama_produk) + '</b> (Umur ' + lv.umur_minggu + ' Mgg • ' + lv.hari_lalu + ' hari lalu)'
      : 'Belum ada catatan vaksinasi untuk flok ini.') + '</span></div></section>';

  const tabs = '<div class="seg" role="tablist">' +
    '<button role="tab" class="' + (vaksin ? 'active' : '') + '" aria-selected="' + vaksin + '" onclick="setObatJenis(\'VAKSIN\')"><i class="bi bi-shield-plus"></i> Vaksinasi</button>' +
    '<button role="tab" class="' + (!vaksin ? 'active' : '') + '" aria-selected="' + !vaksin + '" onclick="setObatJenis(\'OBAT\')"><i class="bi bi-capsule"></i> Obat &amp; Vitamin</button></div>';

  const katalog = cfgList(vaksin ? 'katalog_vaksin' : 'katalog_obat')
    .map(t => '<button type="button" class="chip" data-t="' + esc(t) + '" onclick="pickProduk(this.dataset.t)">+ ' + esc(t) + '</button>').join('');
  const metodes = (vaksin ? METODE_VAKSIN : METODE_OBAT).map(m =>
    '<label class="radio-card"><input type="radio" name="metode" value="' + esc(m) + '"' + (F.metode === m ? ' checked' : '') + ' onchange="onObatInput()"><span><i class="rd"></i><div><strong>' + esc(m) + '</strong><small>' + esc(METODE_INFO[m]) + '</small></div></span></label>').join('');
  const tags = cfgList('tag_reaksi').map(t => '<button type="button" class="chip" data-t="' + esc(t) + '" onclick="addTag(\'o_catatan\',this.dataset.t)">+ ' + esc(t) + '</button>').join('');
  const tim = App.petugas.length ? App.petugas : [App.user.nama];
  const medis = cfgList('tenaga_medis');
  const opt = n => '<option value="' + esc(n) + '"' + (!F.lain && n === F.petugas ? ' selected' : '') + '>' + esc(n) + '</option>';
  const petugasOpt = '<optgroup label="Tim Kandang">' + tim.map(opt).join('') + '</optgroup>' +
    (medis.length ? '<optgroup label="Tenaga Medis">' + medis.map(opt).join('') + '</optgroup>' : '') +
    '<option value="__lain__"' + (F.lain ? ' selected' : '') + '>Lainnya (ketik nama)...</option>';

  const form =
    '<section class="card"><div class="card-head"><span class="ico-badge pri"><i class="bi bi-eyedropper"></i></span><div><h3>Nama Produk / ' + (vaksin ? 'Vaksin' : 'Obat') + '</h3></div><span class="badge b-pri">Katalog SIM</span></div>' +
    '<div class="chip-scroll">' + katalog + '</div>' +
    '<input id="o_nama" class="input" maxlength="100" placeholder="Ketik nama produk" value="' + esc(F.nama) + '" oninput="onObatInput()" aria-label="Nama produk"></section>' +
    '<section class="card"><div class="card-head"><span class="ico-badge sky"><i class="bi bi-droplet-half"></i></span><div><h3>Metode Pemberian</h3></div></div><div class="radio-grid" role="radiogroup" aria-label="Metode pemberian">' + metodes + '</div></section>' +
    '<section class="card"><div class="card-head"><span class="ico-badge gold"><i class="bi bi-123"></i></span><div><h3>Dosis per Ekor / Volume</h3></div><span class="badge b-muted">Standar Lab</span></div>' +
    '<div class="stepper"><button type="button" class="step-btn minus" onclick="stepDosis(-0.1)" aria-label="Kurangi dosis">−</button>' +
    '<div class="input-unit"><input id="o_dosis" class="input" type="number" inputmode="decimal" min="0.1" step="0.1" value="' + esc(F.dosis) + '" oninput="onObatInput()" style="text-align:center;padding-left:14px;font-size:26px" aria-label="Dosis per ekor"><span>dosis / ekor</span></div>' +
    '<button type="button" class="step-btn plus" onclick="stepDosis(0.1)" aria-label="Tambah dosis">+</button></div>' +
    '<div class="calc-card"><i class="bi bi-box2"></i><div class="grow"><small id="o_calcLbl"></small><strong id="o_calcVal"></strong></div><span class="badge b-gold" id="o_calcBadge"></span></div></section>' +
    '<section class="card"><div class="form-grid two"><div><label class="lbl" style="margin-top:0">Waktu Aplikasi</label>' +
    '<div class="seg sm" role="group" aria-label="Waktu aplikasi"><button type="button" class="' + (F.waktu === 'PAGI' ? 'active' : '') + '" onclick="setObatWaktu(\'PAGI\')"><i class="bi bi-sun"></i> Pagi</button><button type="button" class="' + (F.waktu === 'SORE' ? 'active' : '') + '" onclick="setObatWaktu(\'SORE\')"><i class="bi bi-sunset"></i> Sore</button></div></div>' +
    '<div><label class="lbl" for="o_petugas" style="margin-top:0">Petugas / Tim</label><select id="o_petugas" class="input" onchange="onPetugasChange()">' + petugasOpt + '</select>' +
    '<div id="o_lainWrap" style="margin-top:8px"' + (F.lain ? '' : ' hidden') + '><input id="o_petugas_lain" class="input" maxlength="60" placeholder="Nama petugas / tenaga medis" value="' + esc(F.lainTeks) + '" oninput="onObatInput()" aria-label="Nama petugas atau tenaga medis"></div></div></div></section>' +
    '<section class="card"><div class="card-head"><span class="ico-badge sky"><i class="bi bi-journal-check"></i></span><div><h3>Reaksi &amp; Catatan Batch</h3><p class="muted sm">Ketik atau sentuh tag</p></div></div>' +
    '<div class="tags">' + tags + '</div>' +
    '<textarea id="o_catatan" class="input" maxlength="300" placeholder="Catatan no. lot, expired date, atau kondisi spuit..." oninput="onObatInput()" aria-label="Catatan batch">' + esc(F.catatan) + '</textarea></section>' +
    '<div class="savebar"><button class="btn btn-primary btn-xl btn-block" onclick="submitObat()"><i class="bi bi-save"></i> Simpan Catatan ' + (vaksin ? 'Vaksin' : 'Obat') + '</button>' +
    '<div class="savebar-sub"><button class="link-btn" type="button" onclick="resetObatForm(App.obat.form.jenis);paintObat()"><i class="bi bi-arrow-counterclockwise"></i> Reset Form Isian</button></div></div>';

  c.innerHTML = flokSelectHtml() + info + tabs + form;
  updateObatCalc();
}

function pickProduk(t) { $('#o_nama').value = t; onObatInput(); }
function stepDosis(d) {
  const el = $('#o_dosis');
  let v = Number(String(el.value).replace(',', '.'));
  if (!isFinite(v)) v = 1;
  el.value = Math.max(0.1, Math.round((v + d) * 10) / 10).toFixed(1);
  onObatInput();
}
function setObatWaktu(w) { onObatInput(); App.obat.form.waktu = w; paintObat(); }
function onObatInput() {
  const F = App.obat.form;
  if (!$('#o_nama')) return;
  F.nama = $('#o_nama').value;
  F.dosis = $('#o_dosis').value;
  const sel = $('#o_petugas').value;
  F.lain = sel === '__lain__';
  $('#o_lainWrap').hidden = !F.lain;
  if (F.lain) { F.lainTeks = $('#o_petugas_lain').value; F.petugas = F.lainTeks.trim(); } else { F.petugas = sel; }
  F.catatan = $('#o_catatan').value;
  const m = document.querySelector('input[name="metode"]:checked');
  if (m) F.metode = m.value;
  updateObatCalc();
}
function onPetugasChange() {
  onObatInput();
  if (App.obat.form.lain) { const el = $('#o_petugas_lain'); if (el) el.focus(); }
}
function obatKebutuhan() {
  const pop = App.obat.ctx.flok.populasi_sekarang;
  const dosis = Number(String(App.obat.form.dosis).replace(',', '.'));
  const cad = cfgNum('cadangan_vaksin_persen', 2);
  const perVial = cfgNum('dosis_per_vial', 500) || 500;
  const need = isFinite(dosis) && dosis > 0 ? Math.ceil(pop * dosis * (1 + cad / 100)) : 0;
  return { pop, dosis, cad, perVial, need, vial: Math.ceil(need / perVial) };
}
function updateObatCalc() {
  if (!$('#o_calcVal')) return;
  const k = obatKebutuhan();
  const vaksin = App.obat.form.jenis === 'VAKSIN';
  $('#o_calcLbl').textContent = 'Kebutuhan Flok (' + fInt(k.pop) + ' Ekor)';
  $('#o_calcVal').textContent = vaksin
    ? '~' + fInt(k.need) + ' Dosis (' + k.vial + ' Vial @ ' + fInt(k.perVial) + ' ds)'
    : '~' + fInt(k.need) + ' dosis total';
  $('#o_calcBadge').textContent = '+' + fDec(k.cad, 0) + '% Cadangan';
}

function submitObat() {
  onObatInput();
  const O = App.obat, F = O.form, ctx = O.ctx;
  const k = obatKebutuhan();
  const err = (id, m) => { toast(m, 'error'); const el = $('#' + id); if (el) { el.classList.add('invalid'); el.focus(); el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } };
  if (!F.nama.trim()) { err('o_nama', 'Isi nama produk terlebih dahulu.'); return; }
  if (!(k.dosis > 0)) { err('o_dosis', 'Dosis per ekor harus lebih dari 0.'); return; }
  if (!F.petugas) { err(F.lain ? 'o_petugas_lain' : 'o_petugas', 'Isi nama petugas atau tenaga medis.'); return; }
  confirmSheet({
    title: 'Cek Sebelum Simpan',
    note: isOwner() ? '' : 'Setelah disimpan, data tidak dapat diubah oleh anak kandang.',
    rows: [
      ['Tanggal', tglPendek(ctx.tanggal)], ['Jenis', F.jenis === 'VAKSIN' ? 'Vaksinasi' : 'Obat & Vitamin'],
      ['Produk', F.nama.trim()], ['Metode', F.metode], ['Dosis', fDec(k.dosis, 1) + ' dosis / ekor'],
      ['Kebutuhan flok', '~' + fInt(k.need) + ' dosis'], ['Waktu', cap(F.waktu)], ['Petugas', F.petugas]
    ],
    onOk: () => {
      const payload = {
        flok_id: ctx.flok.flok_id, tanggal: isOwner() ? ctx.tanggal : '', jenis: F.jenis, nama_produk: F.nama.trim(),
        metode: F.metode, dosis_per_ekor: k.dosis, waktu: F.waktu, petugas: F.petugas, catatan: F.catatan.trim()
      };
      const snapshot = JSON.parse(JSON.stringify(F));
      closeSheet();
      toast('Catatan ' + (F.jenis === 'VAKSIN' ? 'vaksinasi' : 'obat') + ' tersimpan.', 'success');
      resetObatForm(F.jenis);
      paintObat();
      call('simpanObatVaksin', App.token, payload).then(res => {
        if (res) { apiBg('getObatContext', App.token, ctx.flok.flok_id, App.obat.tanggal).then(r => { if (r && r.success) { App.obat.ctx = r.data; syncFlok(r.data.flok); if (!typing()) paintObat(); } }).catch(() => {}); return; }
        App.obat.form = snapshot;           // gagal: pulihkan isian agar tidak perlu mengetik ulang
        if (App.page === 'obat') paintObat();
        toast('Catatan belum tersimpan. Isian dikembalikan, silakan coba lagi.', 'error');
      });
    }
  });
}

// ════════════════════════════════════════════════════════
// BAGIAN 5: RIWAYAT
// ════════════════════════════════════════════════════════

async function renderRiwayat() {
  const seq = App.seq;
  const c = $('#app-container');
  const R = App.riwayat;
  const args = argsRiwayat();
  if (!rcHas('getRiwayat', args)) c.innerHTML = skeleton();
  const res = await swr('getRiwayat', args, r => {
    if (seq !== App.seq) return;
    R.data = r.data;
    if (!typing()) paintRiwayat();
  });
  if (seq !== App.seq) return;
  if (!res) { c.innerHTML = errorCard('Gagal memuat riwayat.', 'renderRiwayat()'); return; }
  R.data = res.data;
  paintRiwayat();
}

function paintRiwayat() {
  if (App.page !== 'riwayat') return;
  const R = App.riwayat;
  const c = $('#app-container');
  const harian = R.tab === 'harian';
  const flokOpt = App.floks.length > 1
    ? '<select class="input" aria-label="Filter flok" onchange="App.riwayat.flok=this.value;renderRiwayat()"><option value="">Semua flok</option>' +
    App.floks.map(f => '<option value="' + esc(f.flok_id) + '"' + (R.flok === f.flok_id ? ' selected' : '') + '>' + esc(f.nama_flok) + '</option>').join('') + '</select>' : '';
  const periode = isOwner()
    ? '<select class="input" aria-label="Periode" onchange="App.riwayat.periode=Number(this.value);renderRiwayat()">' +
    [[7, '7 hari terakhir'], [30, '30 hari terakhir'], [90, '90 hari terakhir'], [0, 'Semua data']].map(p => '<option value="' + p[0] + '"' + (R.periode === p[0] ? ' selected' : '') + '>' + p[1] + '</option>').join('') + '</select>' : '';
  c.innerHTML =
    '<div class="dash-top"><h2>' + (isOwner() ? 'Riwayat Catatan' : 'Riwayat 7 Hari') + '</h2></div>' +
    '<div class="seg" role="tablist"><button role="tab" class="' + (harian ? 'active' : '') + '" onclick="App.riwayat.tab=\'harian\';paintRiwayat()"><i class="bi bi-egg-fried"></i> Harian</button>' +
    '<button role="tab" class="' + (!harian ? 'active' : '') + '" onclick="App.riwayat.tab=\'obat\';paintRiwayat()"><i class="bi bi-capsule"></i> Obat &amp; Vaksin</button></div>' +
    '<div class="card filter-card"><div class="search"><i class="bi bi-search"></i><input class="input" type="search" placeholder="Cari catatan, produk, atau petugas" value="' + esc(R.q) + '" oninput="App.riwayat.q=this.value;paintRiwayatList()" aria-label="Cari riwayat"></div>' +
    (periode || flokOpt ? '<div class="filter-grid">' + periode + flokOpt + '</div>' : '') + '</div>' +
    '<div id="riwayatList" class="page" style="gap:10px;animation:none"></div>';
  paintRiwayatList();
}

function paintRiwayatList() {
  const R = App.riwayat;
  const box = $('#riwayatList');
  if (!box || !R.data) return;
  const q = R.q.trim().toLowerCase();
  const owner = isOwner();
  let html = '';

  if (R.tab === 'harian') {
    const items = R.data.harian.filter(r =>
      (!q || (r.catatan + ' ' + r.diinput_oleh + ' ' + r.tanggal).toLowerCase().indexOf(q) >= 0));
    if (!items.length) { box.innerHTML = '<section class="card empty"><i class="bi bi-inbox"></i><strong>Belum ada catatan</strong><p class="sm">Catatan harian yang sesuai filter akan tampil di sini.</p></section>'; return; }
    let last = '';
    const totalTgl = {};
    items.forEach(r => { totalTgl[r.tanggal] = (totalTgl[r.tanggal] || 0) + r.telur_butir; });
    items.forEach(r => {
      if (r.tanggal !== last) {
        last = r.tanggal;
        html += '<div class="day-head"><strong>' + esc(tglPendek(r.tanggal)) + '</strong><span class="badge b-sky"><i class="bi bi-egg-fried"></i> ' + fInt(totalTgl[r.tanggal]) + ' butir</span></div>';
      }
      const tot = r.deplesi_mati + r.deplesi_afkir;
      html += '<article class="rec"><div class="rec-top"><span class="badge b-gold"><i class="bi bi-egg-fried"></i> Rekap Harian</span>' +
        '<span class="meta">Umur ' + r.umur_minggu + ' Mgg • ' + esc(r.diinput_oleh) + ' • ' + esc((r.waktu_input || '').slice(11, 16)) + '</span>' +
        (owner ? '<div class="rec-actions"><button class="icon-btn sm" aria-label="Koreksi catatan" onclick="editCatatan(\'' + esc(r.catatan_id) + '\')"><i class="bi bi-pencil"></i></button>' +
          '<button class="icon-btn sm danger" aria-label="Hapus catatan" onclick="hapusItem(\'harian\',\'' + esc(r.catatan_id) + '\')"><i class="bi bi-trash3"></i></button></div>' : '') + '</div>' +
        '<div class="rec-grid"><div><small>Telur</small><strong>' + fInt(r.telur_butir) + '</strong></div>' +
        '<div><small>Rata² Bobot</small><strong>' + (r.telur_butir > 0 ? fDec(r.berat_telur_rata2_gram, 1) + ' g' : '-') + '</strong></div>' +
        '<div><small>Deplesi</small><strong>' + tot + '</strong></div>' +
        '<div><small>Pakan</small><strong>' + fDec(r.pakan_kg, 1) + ' kg</strong></div></div>' +
        '<p class="xs muted">Total telur ' + fDec(r.telur_kg, 1) + ' kg' + (tot > 0 ? ' • Mati ' + r.deplesi_mati + ' • Afkir ' + r.deplesi_afkir : '') + '</p>' +
        (r.catatan ? '<p class="rec-note">' + esc(r.catatan) + '</p>' : '') +
        (r.diubah_oleh ? '<p class="xs muted"><i class="bi bi-pencil-square"></i> Dikoreksi ' + esc(r.diubah_oleh) + ' • ' + esc((r.waktu_ubah || '').slice(0, 16)) + '</p>' : '') + '</article>';
    });
  } else {
    const items = R.data.obat.filter(r =>
      (!q || (r.nama_produk + ' ' + r.petugas + ' ' + r.catatan + ' ' + r.metode).toLowerCase().indexOf(q) >= 0));
    if (!items.length) { box.innerHTML = '<section class="card empty"><i class="bi bi-inbox"></i><strong>Belum ada catatan obat/vaksin</strong><p class="sm">Catatan yang sesuai filter akan tampil di sini.</p></section>'; return; }
    let last = '';
    items.forEach(r => {
      if (r.tanggal !== last) { last = r.tanggal; html += '<div class="day-head"><strong>' + esc(tglPendek(r.tanggal)) + '</strong></div>'; }
      html += '<article class="rec"><div class="rec-top"><span class="badge ' + (r.jenis === 'VAKSIN' ? 'b-pri' : 'b-sky') + '"><i class="bi ' + (r.jenis === 'VAKSIN' ? 'bi-shield-plus' : 'bi-capsule') + '"></i> ' + (r.jenis === 'VAKSIN' ? 'Vaksin' : 'Obat') + '</span>' +
        '<span class="meta">Umur ' + r.umur_minggu + ' Mgg • ' + cap(r.waktu) + ' • ' + esc(r.petugas) + '</span>' +
        (owner ? '<div class="rec-actions"><button class="icon-btn sm danger" aria-label="Hapus catatan" onclick="hapusItem(\'obat\',\'' + esc(r.id) + '\')"><i class="bi bi-trash3"></i></button></div>' : '') + '</div>' +
        '<div><strong style="font-size:15px">' + esc(r.nama_produk) + '</strong><p class="sm muted">' + esc(r.dosis_cara) + ' • kebutuhan ~' + fInt(r.kebutuhan_dosis) + ' dosis</p></div>' +
        (r.catatan ? '<p class="rec-note">' + esc(r.catatan) + '</p>' : '') + '</article>';
    });
  }
  box.innerHTML = html;
}

function editCatatan(id) {
  const r = (App.riwayat.data.harian || []).find(x => x.catatan_id === id);
  if (!r) return;
  openSheet('Koreksi Catatan',
    '<div class="form-grid two">' +
    '<div><label class="lbl" for="e_tgl">Tanggal</label><input id="e_tgl" class="input" type="date" max="' + hariIniWIB() + '" value="' + esc(r.tanggal) + '"></div>' +
    '<div><label class="lbl" for="e_telur">Telur (butir)</label><input id="e_telur" class="input" type="number" inputmode="numeric" min="0" step="1" value="' + r.telur_butir + '"></div>' +
    '<div><label class="lbl" for="e_kg">Total berat telur (kg)</label><input id="e_kg" class="input" type="number" inputmode="decimal" step="0.1" min="0" value="' + r.telur_kg + '"></div>' +
    '<div><label class="lbl" for="e_mati">Deplesi mati (ekor)</label><input id="e_mati" class="input" type="number" inputmode="numeric" min="0" step="1" value="' + r.deplesi_mati + '"></div>' +
    '<div><label class="lbl" for="e_afkir">Deplesi afkir (ekor)</label><input id="e_afkir" class="input" type="number" inputmode="numeric" min="0" step="1" value="' + r.deplesi_afkir + '"></div>' +
    '<div><label class="lbl" for="e_pakan">Pakan (kg)</label><input id="e_pakan" class="input" type="number" inputmode="decimal" min="0" step="0.5" value="' + r.pakan_kg + '"></div></div>' +
    '<label class="lbl" for="e_cat">Catatan</label><textarea id="e_cat" class="input" maxlength="300">' + esc(r.catatan) + '</textarea>' +
    '<div class="sheet-actions"><button class="btn btn-soft" onclick="closeSheet()">Batal</button>' +
    '<button class="btn btn-primary" id="e_save" onclick="saveEdit(\'' + esc(r.catatan_id) + '\')">Simpan Koreksi</button></div>');
}
async function saveEdit(id) {
  const btn = $('#e_save');
  const v = k => $('#' + k).value;
  setBusyBtn(btn, true, 'Menyimpan...');
  const res = await call('updateCatatanHarian', App.token, {
    catatan_id: id, tanggal: v('e_tgl'), telur_butir: v('e_telur'), telur_kg: v('e_kg'),
    deplesi_mati: v('e_mati'), deplesi_afkir: v('e_afkir'), pakan_kg: v('e_pakan'), catatan: v('e_cat').trim()
  });
  setBusyBtn(btn, false);
  if (!res) return;
  closeSheet();
  toast(res.message, 'success');
  await refreshBootstrap();
  renderRiwayat();
}
function hapusItem(jenis, id) {
  confirmSheet({
    title: 'Hapus Catatan?', danger: true, cancelText: 'Batal', okText: 'Ya, Hapus',
    note: 'Catatan akan disembunyikan dari laporan dan populasi dihitung ulang. Data lama tetap tersimpan di Sheets sebagai arsip.',
    rows: [],
    onOk: async () => {
      const res = await call('hapusCatatan', App.token, jenis, id);
      if (!res) return;
      closeSheet();
      toast(res.message, 'success');
      await refreshBootstrap();
      renderRiwayat();
    }
  });
}

// ════════════════════════════════════════════════════════
// BAGIAN 6: DASHBOARD & GRAFIK
// ════════════════════════════════════════════════════════

function destroyCharts() {
  Object.keys(App.charts).forEach(k => { try { App.charts[k].destroy(); } catch (e) { /* diabaikan */ } });
  App.charts = {};
}

async function renderDashboard() {
  const seq = App.seq;
  const c = $('#app-container');
  const D = App.dash;
  if (!D.flok) { const f0 = currentFlok(); if (f0) D.flok = f0.flok_id; }
  const args = argsDash();
  if (!rcHas('getDashboard', args)) c.innerHTML = skeleton();
  const res = await swr('getDashboard', args, r => {
    if (seq !== App.seq) return;
    D.data = r.data; D.flok = r.data.flok.flok_id;
    paintDashboard();
  });
  if (seq !== App.seq) return;
  if (!res) { c.innerHTML = errorCard('Gagal memuat dashboard.', 'renderDashboard()'); return; }
  D.data = res.data;
  D.flok = res.data.flok.flok_id;
  paintDashboard();
}

function paintDashboard() {
  if (App.page !== 'dashboard') return;
  destroyCharts();
  const D = App.dash, d = D.data, c = $('#app-container');
  const usia = d.groupBy === 'usia';
  const k = d.kpi, hi = k.hari_ini;
  const flokSel = App.floks.length > 1
    ? '<select class="input" style="min-height:44px;width:auto" aria-label="Pilih flok" onchange="App.dash.flok=this.value;renderDashboard()">' +
    App.floks.map(f => '<option value="' + esc(f.flok_id) + '"' + (f.flok_id === D.flok ? ' selected' : '') + '>' + esc(f.nama_flok) + '</option>').join('') + '</select>' : '';
  const periode = usia ? '' :
    '<div class="seg sm" role="group" aria-label="Periode">' + [7, 30, 90].map(n =>
      '<button class="' + (D.hari === n ? 'active' : '') + '" onclick="App.dash.hari=' + n + ';renderDashboard()">' + n + ' Hari</button>').join('') + '</div>';
  const grup = '<div class="seg sm" role="group" aria-label="Kelompokkan data">' +
    '<button class="' + (!usia ? 'active' : '') + '" onclick="App.dash.groupBy=\'hari\';renderDashboard()">Per Tanggal</button>' +
    '<button class="' + (usia ? 'active' : '') + '" onclick="App.dash.groupBy=\'usia\';renderDashboard()">Per Usia</button></div>';

  const kpi =
    '<div class="kpi-grid">' +
    kpiCard('Populasi Hidup', fInt(k.populasi_sekarang), 'dari ' + fInt(k.populasi_awal) + ' ekor awal', 'bi-people-fill', 'pri') +
    kpiCard('Hen-Day Hari Ini', hi.ada ? fDec(hi.hen_day, 1) + '%' : '—', hi.ada ? fInt(hi.telur) + ' butir • ' + fDec(hi.telur_kg, 1) + ' kg' + (hi.lengkap ? '' : ' (sementara)') : 'belum ada data', 'bi-egg-fried', 'gold') +
    kpiCard('Deplesi Hari Ini', hi.ada ? fInt(hi.deplesi) : '—', hi.ada ? fDec(hi.deplesi_pct, 2) + '% dari populasi' : 'belum ada data', 'bi-heart-pulse', 'coral') +
    kpiCard('Umur Ayam', k.umur_minggu + ' Mgg', d.flok.nama_flok + (d.flok.strain ? ' • ' + d.flok.strain : ''), 'bi-calendar-week', 'sky') + '</div>';

  const insight = '<section class="insight"><h3><i class="bi bi-stars"></i> Analisis Otomatis</h3><ul>' + d.insights.map(i => '<li>' + esc(i) + '</li>').join('') + '</ul></section>';
  const sub = usia ? 'Rata-rata per minggu usia' : 'Hari ini ditandai merah';
  const chartCard = (id, judul, ket) => '<section class="card chart-card"><h3>' + judul + '</h3><span class="sm muted">' + ket + '</span><div class="chart-box"><canvas id="' + id + '" role="img" aria-label="' + esc(judul) + '"></canvas></div></section>';

  c.innerHTML =
    '<div class="dash-top"><h2>Analisis ' + esc(d.flok.nama_flok) + '</h2>' + flokSel + '</div>' +
    '<div class="dash-top">' + periode + grup + '</div>' + kpi + insight +
    '<div class="chart-grid">' +
    chartCard('ch1', 'Produksi Telur / Hen-Day (%)', sub) +
    chartCard('ch2', usia ? 'Deplesi per Minggu &amp; Kumulatif (%)' : 'Deplesi Harian &amp; Kumulatif (%)', 'Batang = deplesi, garis = kumulatif') +
    chartCard('ch3', 'Konsumsi Pakan per Ekor (gram)', 'Garis putus-putus = target') +
    chartCard('ch4', 'Rata-rata Bobot Telur (gram)', 'Garis putus-putus = batas standar') + '</div>';
  drawCharts(d);
}

function kpiCard(label, val, sub, icon, warna) {
  return '<div class="kpi"><div class="kpi-top"><label>' + esc(label) + '</label><span class="ico-badge ' + warna + '" style="width:34px;height:34px;font-size:16px"><i class="bi ' + icon + '"></i></span></div>' +
    '<strong>' + esc(val) + '</strong><small>' + esc(sub) + '</small></div>';
}

function drawCharts(d) {
  if (typeof Chart === 'undefined') {
    $$('.chart-box').forEach(b => { b.innerHTML = '<p class="muted sm" style="padding:24px;text-align:center">Pustaka grafik gagal dimuat. Periksa koneksi internet lalu muat ulang.</p>'; });
    return;
  }
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  const col = {
    muted: dark ? '#D2B8AE' : '#6B5648', grid: dark ? 'rgba(255,255,255,.1)' : 'rgba(43,20,16,.1)',
    soft: dark ? '#B3433F' : '#FFB8A8', pri: dark ? '#FF5A55' : '#ff3a3a', gold: '#FFC233',
    blue: dark ? '#60A5FA' : '#2563EB', green: dark ? '#4ADE80' : '#16A34A', rose: dark ? '#F472B6' : '#D6246E', amber: '#F59E0B'
  };
  Chart.defaults.font.family = "'Plus Jakarta Sans', system-ui, sans-serif";
  Chart.defaults.color = col.muted;
  const s = d.seri;
  const labels = s.map(x => x.label);
  const todayIdx = d.groupBy === 'hari' ? s.findIndex(x => x.tanggal === hariIniWIB()) : -1;
  const base = (extra) => Object.assign({
    responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
    plugins: { legend: { display: false, position: 'bottom', labels: { boxWidth: 12, usePointStyle: true } } },
    scales: {
      x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } },
      y: { grid: { color: col.grid }, beginAtZero: true }
    }
  }, extra || {});
  const empty = s.every(x => x.hen_day === null);
  if (empty) {
    $$('.chart-box').forEach(b => { b.innerHTML = '<p class="muted sm" style="padding:60px 16px;text-align:center">Belum ada data pada periode ini.</p>'; });
    return;
  }

  // 1. Hen-Day
  let o = base();
  o.scales.y = { grid: { color: col.grid }, min: 0, suggestedMax: 100, ticks: { callback: v => v + '%' } };
  o.plugins.tooltip = { callbacks: { label: c => ' Hen-Day: ' + fDec(c.parsed.y, 1) + '%', afterLabel: c => s[c.dataIndex].telur !== null ? ' ' + fInt(s[c.dataIndex].telur) + ' butir' : '' } };
  App.charts.ch1 = new Chart($('#ch1'), {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Hen-Day (%)', data: s.map(x => x.hen_day), backgroundColor: s.map((x, i) => i === todayIdx ? col.pri : col.soft), borderRadius: { topLeft: 8, topRight: 8 }, maxBarThickness: 36 }] },
    options: o
  });

  // 2. Deplesi
  o = base();
  o.plugins.legend.display = true;
  o.scales.y = { grid: { color: col.grid }, beginAtZero: true, title: { display: true, text: 'Deplesi (%)' }, ticks: { callback: v => v + '%' } };
  o.scales.y1 = { position: 'right', grid: { display: false }, beginAtZero: true, title: { display: true, text: 'Kumulatif (%)' }, ticks: { callback: v => v + '%' } };
  App.charts.ch2 = new Chart($('#ch2'), {
    data: {
      labels, datasets: [
        { type: 'bar', label: 'Deplesi (%)', data: s.map(x => x.deplesi_pct), backgroundColor: col.rose, borderRadius: { topLeft: 8, topRight: 8 }, maxBarThickness: 36, yAxisID: 'y' },
        { type: 'line', label: 'Kumulatif (%)', data: s.map(x => x.kum_pct), borderColor: col.amber, backgroundColor: col.amber, tension: .3, pointRadius: 3, spanGaps: true, yAxisID: 'y1' }
      ]
    },
    options: o
  });

  // 3. Pakan per ekor
  const target = d.standar.target_pakan_gr;
  o = base();
  o.plugins.legend.display = true;
  o.scales.y = { grid: { color: col.grid }, beginAtZero: false, suggestedMin: Math.max(0, target - 40), suggestedMax: target + 40 };
  App.charts.ch3 = new Chart($('#ch3'), {
    type: 'line',
    data: {
      labels, datasets: [
        { label: 'Pakan (gr/ekor)', data: s.map(x => x.pakan_gr), borderColor: col.blue, backgroundColor: col.blue, tension: .3, pointRadius: 3, spanGaps: true },
        { label: 'Target (' + fDec(target, 0) + ' gr)', data: s.map(() => target), borderColor: col.amber, borderDash: [6, 5], pointRadius: 0, borderWidth: 2 }
      ]
    },
    options: o
  });

  // 4. Bobot telur
  const bmin = d.standar.berat_min, bmax = d.standar.berat_max;
  o = base();
  o.plugins.legend.display = true;
  o.scales.y = { grid: { color: col.grid }, beginAtZero: false, suggestedMin: bmin - 3, suggestedMax: bmax + 3 };
  App.charts.ch4 = new Chart($('#ch4'), {
    type: 'line',
    data: {
      labels, datasets: [
        { label: 'Bobot (gr)', data: s.map(x => x.berat), borderColor: col.green, backgroundColor: col.green, tension: .3, pointRadius: 3, spanGaps: true },
        { label: 'Min ' + fDec(bmin, 0), data: s.map(() => bmin), borderColor: col.amber, borderDash: [6, 5], pointRadius: 0, borderWidth: 2 },
        { label: 'Maks ' + fDec(bmax, 0), data: s.map(() => bmax), borderColor: col.rose, borderDash: [6, 5], pointRadius: 0, borderWidth: 2 }
      ]
    },
    options: o
  });
}

// ════════════════════════════════════════════════════════
// BAGIAN 7: KELOLA (FLOK, PENGGUNA, PENGATURAN)
// ════════════════════════════════════════════════════════

async function renderKelola() {
  const seq = App.seq;
  const c = $('#app-container');
  if (!rcHas('getKelola', [])) c.innerHTML = skeleton();
  const res = await swr('getKelola', [], r => {
    if (seq !== App.seq) return;
    App.kelola.data = r.data;
    if (!typing()) paintKelola();
  });
  if (seq !== App.seq) return;
  if (!res) { c.innerHTML = errorCard('Gagal memuat menu Kelola.', 'renderKelola()'); return; }
  App.kelola.data = res.data;
  paintKelola();
}

function paintKelola() {
  if (App.page !== 'kelola') return;
  const K = App.kelola, d = K.data, c = $('#app-container');
  const tab = (id, label, icon) => '<button role="tab" class="' + (K.tab === id ? 'active' : '') + '" onclick="App.kelola.tab=\'' + id + '\';paintKelola()"><i class="bi ' + icon + '"></i> ' + label + '</button>';
  let body = '';

  if (K.tab === 'flok') {
    body = '<section class="card list-card"><div class="row-between"><h3 style="font-size:16px">Daftar Flok</h3><button class="btn btn-primary btn-sm" onclick="flokSheet(\'\')"><i class="bi bi-plus-lg"></i> Tambah</button></div>' +
      (d.floks.length ? d.floks.map(f => {
        const id = esc(f.flok_id);
        const aktif = f.status === 'AKTIF';
        return '<div class="item-row wrap"><span class="ico-badge ' + (aktif ? 'pri' : 'sky') + '"><i class="bi bi-house-heart"></i></span>' +
          '<div class="grow"><strong>' + esc(f.nama_flok) + (f.strain ? ' — ' + esc(f.strain) : '') + '</strong>' +
          '<span>Masuk ' + esc(tglPendek(f.tanggal_masuk)) + ' • Umur ' + f.umur_minggu + ' Mgg</span>' +
          '<div class="item-badges"><span class="badge ' + (aktif ? 'b-ok' : 'b-muted') + '">' + (aktif ? 'Aktif' : 'Selesai') + '</span>' +
          '<span class="badge b-sky">' + fInt(f.populasi_sekarang) + ' / ' + fInt(f.populasi_awal) + ' ekor</span>' +
          '<span class="badge ' + (f.ada_sheet ? 'b-ok' : 'b-coral') + '"><i class="bi bi-file-earmark-spreadsheet"></i> ' + (f.ada_sheet ? 'Sheet: ' + esc(f.nama_sheet) : 'Sheet belum ada') + '</span></div></div>' +
          '<div class="item-actions">' +
          '<button class="btn btn-soft btn-sm" onclick="flokSheet(\'' + id + '\')"><i class="bi bi-pencil"></i> Edit</button>' +
          '<button class="btn btn-soft btn-sm" onclick="updateSheetFlok(\'' + id + '\',this)"><i class="bi bi-arrow-repeat"></i> Update</button>' +
          '<button class="btn btn-soft btn-sm" onclick="unduhFlok(\'' + id + '\',this)"><i class="bi bi-download"></i> Unduh</button>' +
          '<button class="btn btn-soft btn-sm" onclick="toggleFlok(\'' + id + '\',\'' + (aktif ? 'SELESAI' : 'AKTIF') + '\')"><i class="bi ' + (aktif ? 'bi-archive' : 'bi-arrow-counterclockwise') + '"></i> ' + (aktif ? 'Tutup' : 'Aktifkan') + '</button>' +
          '<button class="btn btn-sm btn-dsoft" onclick="hapusFlokSheet(\'' + id + '\')"><i class="bi bi-trash3"></i> Hapus</button></div></div>';
      }).join('') : '<p class="muted sm">Belum ada flok.</p>') + '</section>' +
      '<p class="field-hint" style="padding:0 6px"><i class="bi bi-info-circle"></i> Setiap flok punya sheet rekap (mingguan &amp; harian) di Google Sheets yang terisi otomatis dari input harian. Koreksi data lewat menu Riwayat, bukan langsung di sheet. <b>Update</b> menyusun ulang sheet, <b>Unduh</b> mengambil file Excel-nya.</p>';
  } else if (K.tab === 'pengguna') {
    body = '<section class="card list-card"><div class="row-between"><h3 style="font-size:16px">Pengguna</h3><button class="btn btn-primary btn-sm" onclick="userSheet(\'\')"><i class="bi bi-person-plus"></i> Tambah</button></div>' +
      d.users.map(u =>
        '<div class="item-row wrap"><span class="ico-badge ' + (u.peran === 'PEMILIK' ? 'gold' : 'pri') + '"><i class="bi bi-person"></i></span>' +
        '<div class="grow"><strong>' + esc(u.nama) + (u.saya ? ' <span class="badge b-sky">Anda</span>' : '') + '</strong><span>Username: ' + esc(u.email) + '</span>' +
        '<div class="item-badges"><span class="badge ' + (u.peran === 'PEMILIK' ? 'b-gold' : 'b-pri') + '">' + roleLabel(u.peran) + '</span>' +
        '<span class="badge ' + (u.status === 'AKTIF' ? 'b-ok' : 'b-coral') + '">' + (u.status === 'AKTIF' ? 'Aktif' : 'Nonaktif') + '</span></div></div>' +
        '<div class="item-actions">' +
        '<button class="btn btn-soft btn-sm" onclick="userSheet(\'' + esc(u.email) + '\')"><i class="bi bi-pencil"></i> Edit</button>' +
        '<button class="btn btn-soft btn-sm" onclick="resetPinUser(\'' + esc(u.email) + '\')"><i class="bi bi-key"></i> Reset PIN</button>' +
        (u.saya ? '' : '<button class="btn btn-sm btn-dsoft" onclick="hapusUserSheet(\'' + esc(u.email) + '\')"><i class="bi bi-trash3"></i> Hapus</button>') +
        '</div></div>').join('') + '</section>' +
      '<p class="field-hint" style="padding:0 6px"><i class="bi bi-info-circle"></i> <b>Reset PIN</b> mengembalikan PIN pengguna ke <b>123456</b>. Pengguna yang dihapus tidak bisa masuk lagi, tetapi catatan yang pernah ia input tetap tersimpan.</p>';
  } else {
    const cf = d.config;
    const f = (k, label, type, hint) => '<div><label class="lbl" for="c_' + k + '">' + label + '</label>' +
      (type === 'area' ? '<textarea id="c_' + k + '" class="input" maxlength="400">' + esc(cf[k]) + '</textarea>'
        : '<input id="c_' + k + '" class="input" ' + (type === 'num' ? 'type="number" inputmode="decimal" step="any" min="0"' : 'maxlength="60"') + ' value="' + esc(cf[k]) + '">') +
      (hint ? '<p class="field-hint">' + hint + '</p>' : '') + '</div>';
    body = '<section class="card"><h3 style="font-size:16px;margin-bottom:4px">Pengaturan Aplikasi</h3><p class="muted sm">Berlaku untuk semua pengguna.</p>' +
      '<div class="form-grid two">' +
      f('nama_kandang', 'Nama Kandang', 'txt') +
      f('ambang_deplesi_persen', 'Ambang Deplesi Harian (%)', 'num', 'Di atas angka ini, peringatan merah muncul.') +
      f('target_pakan_gram_per_ekor', 'Target Pakan (gr/ekor/hari)', 'num') +
      f('zak_kg', 'Berat 1 Zak Pakan (kg)', 'num') +
      f('berat_min', 'Bobot Telur Minimum (gr)', 'num') +
      f('berat_max', 'Bobot Telur Maksimum (gr)', 'num') +
      f('dosis_per_vial', 'Dosis per Vial Vaksin', 'num') +
      f('cadangan_vaksin_persen', 'Cadangan Vaksin (%)', 'num') + '</div>' +
      f('katalog_vaksin', 'Katalog Vaksin', 'area', 'Pisahkan dengan koma.') +
      f('katalog_obat', 'Katalog Obat & Vitamin', 'area', 'Pisahkan dengan koma.') +
      f('tag_kondisi', 'Tag Cepat Kondisi Kandang', 'area', 'Pisahkan dengan koma.') +
      f('tag_reaksi', 'Tag Cepat Reaksi Vaksin/Obat', 'area', 'Pisahkan dengan koma.') +
      f('tenaga_medis', 'Daftar Tenaga Medis', 'area', 'Muncul di pilihan Petugas / Tim pada form Obat & Vaksin. Pisahkan dengan koma, mis. drh. Andi (Dokter Hewan), Budi (Paramedis).') +
      '<button class="btn btn-primary btn-block" id="cfgSave" style="margin-top:16px" onclick="saveConfig()"><i class="bi bi-save"></i> Simpan Pengaturan</button></section>';
  }

  c.innerHTML = '<div class="dash-top"><h2>Kelola</h2></div>' +
    '<div class="seg" role="tablist">' + tab('flok', 'Flok', 'bi-house-heart') + tab('pengguna', 'Pengguna', 'bi-people') + tab('pengaturan', 'Pengaturan', 'bi-gear') + '</div>' + body;
}

async function updateSheetFlok(id, btn) {
  setBusyBtn(btn, true, 'Memperbarui...');
  const res = await call('sinkronSheetFlok', App.token, id);
  setBusyBtn(btn, false);
  if (!res) return;
  toast(res.message, 'success');
  renderKelola();
}

async function unduhFlok(id, btn) {
  setBusyBtn(btn, true, 'Menyiapkan...');
  const res = await call('unduhSheetFlok', App.token, id);
  setBusyBtn(btn, false);
  if (!res) return;
  try {
    const bin = atob(res.data.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: res.data.mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = res.data.nama_file;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
    toast('Mengunduh ' + res.data.nama_file, 'success');
  } catch (e) {
    toast('Browser memblokir unduhan. Buka aplikasi langsung (bukan di dalam halaman Blogger) lalu coba lagi.', 'error');
  }
}

function hapusFlokSheet(id) {
  const f = App.kelola.data.floks.find(x => x.flok_id === id);
  if (!f) return;
  openSheet('Hapus Flok',
    '<p class="sheet-note" style="background:var(--coral-surface);color:var(--coral-text)"><b>Tindakan ini tidak bisa dibatalkan dari aplikasi.</b> ' +
    'Sheet <b>' + esc(f.nama_sheet || f.nama_flok) + '</b> akan dihapus dan <b>' + fInt(f.jumlah_catatan) + ' catatan harian</b> flok ini disembunyikan dari aplikasi. ' +
    'Datanya tetap tersimpan sebagai arsip di sheet CATATAN_HARIAN (status DIHAPUS).</p>' +
    '<label class="lbl" for="h_konfirm">Ketik nama flok <b>' + esc(f.nama_flok) + '</b> untuk konfirmasi</label>' +
    '<input id="h_konfirm" class="input" autocomplete="off" autocapitalize="none" placeholder="' + esc(f.nama_flok) + '" oninput="cekHapusFlok(\'' + esc(id) + '\')">' +
    '<div class="sheet-actions"><button class="btn btn-soft" onclick="closeSheet()">Batal</button>' +
    '<button class="btn btn-danger" id="h_ok" disabled onclick="konfirmHapusFlok(\'' + esc(id) + '\')"><i class="bi bi-trash3"></i> Hapus Flok</button></div>');
}
function cekHapusFlok(id) {
  const f = App.kelola.data.floks.find(x => x.flok_id === id);
  const ok = f && $('#h_konfirm').value.trim().toLowerCase() === f.nama_flok.trim().toLowerCase();
  $('#h_ok').disabled = !ok;
}
async function konfirmHapusFlok(id) {
  const btn = $('#h_ok');
  setBusyBtn(btn, true, 'Menghapus...');
  const res = await call('hapusFlok', App.token, id, $('#h_konfirm').value);
  setBusyBtn(btn, false);
  if (!res) return;
  closeSheet();
  toast(res.message, 'success');
  if (App.flokId === id) App.flokId = null;
  resetInputForm();
  App.input.ctx = null; App.obat.ctx = null;
  await refreshBootstrap();
  renderKelola();
}

function flokSheet(id) {
  const f = id ? App.kelola.data.floks.find(x => x.flok_id === id) : { nama_flok: '', strain: '', tanggal_masuk: '', umur_masuk_minggu: '', populasi_awal: '', jumlah_catatan: 0 };
  if (!f) return;
  const lock = f.jumlah_catatan > 0 ? ' disabled' : '';
  openSheet(id ? 'Edit Flok' : 'Tambah Flok',
    '<div class="form-grid two">' +
    '<div><label class="lbl" for="k_nama">Nama Flok</label><input id="k_nama" class="input" maxlength="40" value="' + esc(f.nama_flok) + '" placeholder="mis. Flok 02"></div>' +
    '<div><label class="lbl" for="k_strain">Strain</label><input id="k_strain" class="input" maxlength="40" value="' + esc(f.strain) + '" placeholder="mis. Lohmann Brown"></div>' +
    '<div><label class="lbl" for="k_tgl">Tanggal Ayam Masuk</label><input id="k_tgl" class="input" type="date" max="' + hariIniWIB() + '" value="' + esc(f.tanggal_masuk) + '"' + lock + '></div>' +
    '<div><label class="lbl" for="k_umur">Umur Saat Masuk (minggu)</label><input id="k_umur" class="input" type="number" inputmode="numeric" min="0" step="1" value="' + esc(f.umur_masuk_minggu) + '"' + lock + '></div>' +
    '<div><label class="lbl" for="k_pop">Populasi Awal (ekor)</label><input id="k_pop" class="input" type="number" inputmode="numeric" min="1" step="1" value="' + esc(f.populasi_awal) + '"' + lock + '></div></div>' +
    (lock ? '<p class="sheet-note" style="margin-top:12px">Tanggal masuk, umur masuk, dan populasi awal dikunci karena flok sudah punya catatan.</p>' : '') +
    '<div class="sheet-actions"><button class="btn btn-soft" onclick="closeSheet()">Batal</button><button class="btn btn-primary" id="k_save" onclick="saveFlok(\'' + esc(id) + '\')">Simpan</button></div>');
}
async function saveFlok(id) {
  const btn = $('#k_save');
  setBusyBtn(btn, true, 'Menyimpan...');
  const res = await call('simpanFlok', App.token, {
    flok_id: id, nama_flok: $('#k_nama').value, strain: $('#k_strain').value, tanggal_masuk: $('#k_tgl').value,
    umur_masuk_minggu: $('#k_umur').value, populasi_awal: $('#k_pop').value
  });
  setBusyBtn(btn, false);
  if (!res) return;
  closeSheet();
  toast(res.message, 'success');
  await refreshBootstrap();
  renderKelola();
}
function toggleFlok(id, status) {
  confirmSheet({
    title: status === 'SELESAI' ? 'Tutup Flok?' : 'Aktifkan Flok?', cancelText: 'Batal', okText: 'Ya, Lanjutkan', danger: status === 'SELESAI',
    note: status === 'SELESAI' ? 'Flok yang ditutup tidak muncul di form input. Data lama tetap tersimpan.' : 'Flok akan muncul kembali di form input.',
    rows: [],
    onOk: async () => {
      const res = await call('ubahStatusFlok', App.token, id, status);
      if (!res) return;
      closeSheet();
      toast(res.message, 'success');
      await refreshBootstrap();
      renderKelola();
    }
  });
}

function userSheet(email) {
  const u = email ? App.kelola.data.users.find(x => x.email === email) : { email: '', nama: '', peran: 'ANAK_KANDANG', status: 'AKTIF' };
  if (!u) return;
  openSheet(email ? 'Edit Pengguna' : 'Tambah Pengguna',
    '<div class="form-grid two">' +
    '<div><label class="lbl" for="u_email">Username</label><input id="u_email" class="input" maxlength="60" autocapitalize="none" value="' + esc(u.email) + '"' + (email ? ' disabled' : '') + ' placeholder="mis. budi"></div>' +
    '<div><label class="lbl" for="u_nama">Nama</label><input id="u_nama" class="input" maxlength="60" value="' + esc(u.nama) + '"></div>' +
    '<div><label class="lbl" for="u_peran">Peran</label><select id="u_peran" class="input"><option value="ANAK_KANDANG"' + (u.peran === 'ANAK_KANDANG' ? ' selected' : '') + '>Anak Kandang</option><option value="ADMIN"' + (u.peran === 'ADMIN' ? ' selected' : '') + '>Admin</option><option value="PEMILIK"' + (u.peran === 'PEMILIK' ? ' selected' : '') + '>Pemilik</option></select></div>' +
    '<div><label class="lbl" for="u_status">Status</label><select id="u_status" class="input"><option value="AKTIF"' + (u.status === 'AKTIF' ? ' selected' : '') + '>Aktif</option><option value="NONAKTIF"' + (u.status === 'NONAKTIF' ? ' selected' : '') + '>Nonaktif</option></select></div></div>' +
    '<label class="lbl" for="u_pin">' + (email ? 'PIN Baru (kosongkan jika tidak diubah)' : 'PIN (4–8 angka)') + '</label>' +
    '<input id="u_pin" class="input" type="password" inputmode="numeric" maxlength="8" autocomplete="new-password" placeholder="' + (email ? '••••••' : 'Kosongkan = 123456') + '">' +
    (email ? '' : '<p class="field-hint">Jika dikosongkan, PIN awal otomatis <b>123456</b>.</p>') +
    '<div class="sheet-actions"><button class="btn btn-soft" onclick="closeSheet()">Batal</button><button class="btn btn-primary" id="u_save" onclick="saveUser(\'' + esc(email) + '\')">Simpan</button></div>');
}
async function saveUser(email) {
  const btn = $('#u_save');
  setBusyBtn(btn, true, 'Menyimpan...');
  const res = await call('simpanUser', App.token, {
    mode: email ? 'ubah' : 'baru', email: email || $('#u_email').value, nama: $('#u_nama').value,
    peran: $('#u_peran').value, status: $('#u_status').value, pin: $('#u_pin').value
  });
  setBusyBtn(btn, false);
  if (!res) return;
  closeSheet();
  toast(res.message, 'success');
  await refreshBootstrap();
  renderKelola();
}
function resetPinUser(email) {
  const u = App.kelola.data.users.find(x => x.email === email);
  if (!u) return;
  confirmSheet({
    title: 'Reset PIN ke 123456?', cancelText: 'Batal', okText: 'Ya, Reset PIN',
    note: 'Sesi login pengguna ini akan berakhir dan ia harus masuk dengan PIN 123456. Minta ia segera menggantinya di menu Profil.',
    rows: [['Nama', u.nama], ['Username', u.email]],
    onOk: async () => {
      const res = await call('resetPinUser', App.token, email);
      if (!res) return;
      closeSheet();
      toast(res.message, 'success');
      renderKelola();
    }
  });
}

function hapusUserSheet(email) {
  const u = App.kelola.data.users.find(x => x.email === email);
  if (!u) return;
  confirmSheet({
    title: 'Hapus Pengguna?', danger: true, cancelText: 'Batal', okText: 'Ya, Hapus',
    note: 'Pengguna tidak bisa masuk lagi. Catatan harian dan obat/vaksin yang pernah ia input tetap tersimpan.',
    rows: [['Nama', u.nama], ['Username', u.email], ['Peran', roleLabel(u.peran)]],
    onOk: async () => {
      const res = await call('hapusUser', App.token, email);
      if (!res) return;
      closeSheet();
      toast(res.message, 'success');
      await refreshBootstrap();
      renderKelola();
    }
  });
}

async function saveConfig() {
  const keys = ['nama_kandang', 'ambang_deplesi_persen', 'target_pakan_gram_per_ekor', 'zak_kg', 'berat_min', 'berat_max', 'dosis_per_vial', 'cadangan_vaksin_persen', 'katalog_vaksin', 'katalog_obat', 'tag_kondisi', 'tag_reaksi', 'tenaga_medis'];
  const payload = {};
  keys.forEach(k => { const el = $('#c_' + k); if (el) payload[k] = el.value; });
  const btn = $('#cfgSave');
  setBusyBtn(btn, true, 'Menyimpan...');
  const res = await call('simpanConfig', App.token, payload);
  setBusyBtn(btn, false);
  if (!res) return;
  toast(res.message, 'success');
  await refreshBootstrap();
  renderKelola();
}

// ════════════════════════════════════════════════════════
// BAGIAN 8: PROFIL
// ════════════════════════════════════════════════════════

function renderProfil() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  $('#app-container').innerHTML =
    '<section class="card"><div class="profile-head"><div class="avatar"><i class="bi bi-person"></i></div><div>' +
    '<h2 style="font-size:20px;font-weight:800">' + esc(App.user.nama) + '</h2><p class="muted sm">' + esc(App.user.email) + '</p>' +
    '<span class="badge b-pri" style="margin-top:6px">' + roleLabel(App.user.peran) + '</span></div></div></section>' +
    '<section class="card"><div class="switch-row"><div><strong>Mode Gelap</strong><p class="muted sm">Lebih nyaman dipakai malam hari</p></div>' +
    '<label class="switch"><input type="checkbox" id="themeSw" ' + (dark ? 'checked' : '') + ' onchange="toggleTheme()" aria-label="Mode gelap"><span></span></label></div></section>' +
    '<section class="card"><div class="card-head"><span class="ico-badge gold"><i class="bi bi-key"></i></span><div><h3>Ganti PIN</h3><p class="muted sm">Setelah diganti, Anda perlu masuk kembali</p></div></div>' +
    '<label class="lbl" for="p_lama" style="margin-top:0">PIN Lama</label><input id="p_lama" class="input" type="password" inputmode="numeric" maxlength="8" autocomplete="current-password">' +
    '<label class="lbl" for="p_baru">PIN Baru (4–8 angka)</label><input id="p_baru" class="input" type="password" inputmode="numeric" maxlength="8" autocomplete="new-password">' +
    '<label class="lbl" for="p_ulang">Ulangi PIN Baru</label><input id="p_ulang" class="input" type="password" inputmode="numeric" maxlength="8" autocomplete="new-password">' +
    '<button class="btn btn-primary btn-block" id="p_save" style="margin-top:16px" onclick="savePin()">Ganti PIN</button></section>' +
    '<button class="btn btn-soft btn-block" onclick="logout()"><i class="bi bi-box-arrow-right"></i> Keluar</button>' +
    '<p class="foot-note">Fabry Layer Farm SIM v2.1 • Zona waktu WIB</p>';
}
async function savePin() {
  const lama = $('#p_lama').value.trim(), baru = $('#p_baru').value.trim(), ulang = $('#p_ulang').value.trim();
  if (!lama || !baru) { toast('Isi PIN lama dan PIN baru.', 'error'); return; }
  if (!/^\d{4,8}$/.test(baru)) { toast('PIN baru harus 4–8 digit angka.', 'error'); return; }
  if (baru !== ulang) { toast('Konfirmasi PIN baru tidak sama.', 'error'); return; }
  const btn = $('#p_save');
  setBusyBtn(btn, true, 'Menyimpan...');
  const res = await call('gantiPinSendiri', App.token, lama, baru);
  setBusyBtn(btn, false);
  if (!res) return;
  forceLogout('PIN berhasil diganti. Silakan masuk dengan PIN baru.');
}

// ════════════════════════════════════════════════════════
// BAGIAN 9: INISIALISASI
// ════════════════════════════════════════════════════════

function hideBoot() {
  const b = $('#bootOverlay');
  if (!b) return;
  b.classList.add('out');
  setTimeout(() => { b.style.display = 'none'; }, 350);
}

pasangLogo();

document.addEventListener('DOMContentLoaded', async () => {
  applyTheme(store.get('agl_theme') === 'dark' ? 'dark' : 'light');
  const t = store.get('agl_token');
  if (t) {
    App.token = t;
    try { await enterApp(true); } catch (e) { if ($('#loginView').hidden) renderLogin(); }
  } else {
    renderLogin();
  }
  hideBoot();
});
