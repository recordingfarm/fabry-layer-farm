// ============================================================
// Lapisan komunikasi ke backend Google Apps Script (REST API)
// Semua permintaan: POST teks JSON { action, token, args }.
// WAJIB Content-Type text/plain agar browser tidak mengirim
// preflight CORS (yang ditolak Apps Script).
// ============================================================
const API_TIMEOUT_MS = 60000;

function api(fn) {
  const args = Array.prototype.slice.call(arguments, 1);
  // Konvensi lama: argumen pertama adalah token (kecuali loginPin).
  const token = fn === 'loginPin' ? '' : String(args.shift() || '');
  busy(1);

  if (!GAS_URL || GAS_URL.indexOf('https://script.google.com/') !== 0) {
    busy(-1);
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
    .finally(() => { clearTimeout(timer); busy(-1); });
}
