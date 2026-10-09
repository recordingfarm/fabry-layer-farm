// ============================================================
// Lapisan komunikasi ke backend Google Apps Script (REST API)
// Semua permintaan: POST teks JSON { action, token, args }.
// WAJIB Content-Type text/plain agar browser tidak mengirim
// preflight CORS (yang ditolak Apps Script).
// ============================================================
const API_TIMEOUT_MS = 60000;

function gasUrlOk() {
  return typeof GAS_URL === 'string' && GAS_URL.indexOf('https://script.google.com/') === 0;
}

function post(fn, args, quiet) {
  // Konvensi: argumen pertama adalah token (kecuali loginPin).
  const token = fn === 'loginPin' ? '' : String(args.shift() || '');
  if (!quiet) busy(1);
  if (!gasUrlOk()) {
    if (!quiet) busy(-1);
    return Promise.reject(new Error('GAS_URL belum diisi di js/config.js'));
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS);
  return fetch(GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: fn, token: token, args: args }),
    signal: ctrl.signal,
    redirect: 'follow'
  })
    .then(r => r.json())
    .then(res => {
      if (res && res.success === false && res.message === 'SESI_HABIS') {
        forceLogout('Sesi berakhir. Silakan masuk kembali.');
        throw new Error('SESI_HABIS');
      }
      return res;
    })
    .finally(() => { clearTimeout(timer); if (!quiet) busy(-1); });
}

/** Panggilan biasa (menampilkan bilah progres di atas). */
function api(fn) { return post(fn, Array.prototype.slice.call(arguments, 1), false); }
/** Panggilan latar belakang (tanpa bilah progres) untuk prefetch & penyegaran diam-diam. */
function apiBg(fn) { return post(fn, Array.prototype.slice.call(arguments, 1), true); }

/** "Bangunkan" Apps Script begitu halaman terbuka, agar login/permintaan pertama tidak kena cold start. */
function wakeBackend() {
  if (!gasUrlOk()) return;
  try { fetch(GAS_URL, { method: 'GET', mode: 'no-cors', cache: 'no-store' }).catch(() => {}); } catch (e) { /* abaikan */ }
}
wakeBackend();
