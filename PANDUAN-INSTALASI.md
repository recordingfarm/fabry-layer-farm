# Panduan Instalasi — Fabry Layer Farm SIM (v2.0)

Panduan ini untuk pemula. Ikuti urutannya, jangan loncat. Total waktu sekitar 30–45 menit.

**Gambaran besarnya:**

- **Backend** (otak + database) = Google Apps Script + Google Sheets. Hanya jadi "API", tidak menampilkan halaman.
- **Frontend** (tampilan yang dilihat pengguna) = file di folder ini, ditaruh di **GitHub Pages**.
- Frontend bicara ke backend lewat satu alamat: **URL `/exec`** dari Apps Script.

Yang Anda butuhkan: akun Google, akun GitHub (gratis), komputer Windows/Mac/Linux.

---

## BAGIAN A — Pasang Backend (Google Apps Script)

> Ini proyek Apps Script **baru**. Jangan pakai proyek lama, supaya data lama tidak ikut tersambung.

### A1. Buat proyek
1. Buka https://script.google.com → **Proyek baru** (New project).
2. Klik nama proyek "Untitled project" di atas → ganti jadi `Fabry Layer Farm API`.

### A2. Tempel kode `Kode.gs`
1. Di editor ada file bernama `Code.gs`. Klik, **hapus semua isinya**.
2. Buka file `Kode.gs` yang saya berikan (pakai Notepad), **Ctrl+A → Ctrl+C**.
3. Tempel ke editor Apps Script (**Ctrl+V**), lalu klik ikon **Simpan** (💾).

### A3. Tempel `appsscript.json`
1. Klik ikon roda gigi ⚙️ **Project Settings** (kiri) → centang **Show "appsscript.json" manifest file in editor**.
2. Kembali ke **Editor** (ikon `< >`), klik `appsscript.json`, hapus isinya, tempel isi file `appsscript.json` dari saya, **Simpan**.

### A4. Buat database otomatis (sekali saja)
1. Di bagian atas editor, pilih fungsi **`setupAppEnvironment`** pada dropdown, klik **▶ Run**.
2. Muncul "Authorization required" → **Review permissions** → pilih akun Google Anda → **Advanced** → **Go to Fabry Layer Farm API (unsafe)** → **Allow**. (Peringatan ini normal karena skrip buatan sendiri.)
3. Tunggu sampai **Execution log** menulis selesai. Folder `SIM_Kandang_Layer_v2` dan spreadsheet `DB_SIM_Kandang_Layer_v2` kini ada di Google Drive Anda.

Akun yang otomatis dibuat (PIN semuanya **123456**):

| Username | Peran | Bisa apa |
|---|---|---|
| `pemilik` | Pemilik | Akses penuh: dashboard, input, riwayat (edit/hapus), obat & vaksin, Kelola (flok, pengguna, pengaturan) |
| `admin` | Admin | Dashboard, input harian, obat & vaksin, riwayat 7 hari milik sendiri. **Tanpa** menu Kelola, tanpa edit/hapus |
| `anakkandang` | Anak Kandang | Input harian, obat & vaksin, riwayat 7 hari miliknya |

Ingin `admin` juga akses penuh? Login sebagai `pemilik` → Kelola → Pengguna → Edit `admin` → ubah Peran jadi Pemilik.

### A5. Terbitkan sebagai Web App
1. Klik **Deploy** (kanan atas) → **New deployment**.
2. Klik ikon roda gigi di samping "Select type" → **Web app**.
3. Isi: **Execute as: Me**, **Who has access: Anyone**.
4. Klik **Deploy**. Salin **Web app URL** (berakhiran `/exec`). **Simpan di Notepad.**

### A6. Tes backend
Tempel URL `/exec` tadi di tab browser baru. Harus muncul teks JSON seperti:

```
{"success":true,"data":{"app":"Fabry Layer Farm SIM","status":"online"},"message":"API Fabry Layer Farm SIM aktif."}
```

Kalau muncul itu, backend sukses. Kalau yang muncul halaman login Google, ulangi A5 dan pastikan **Who has access = Anyone**.

---

## BAGIAN B — Isi alamat backend di frontend

1. Ekstrak `fabry-layer-farm.zip` (klik kanan → Extract All). Hasilnya folder **`fabry-layer-farm`**.
2. Buka `fabry-layer-farm\js\config.js` dengan Notepad.
3. Ganti tulisan `GANTI_DENGAN_URL_EXEC_APPS_SCRIPT_ANDA` dengan URL `/exec` Anda (tetap di dalam tanda kutip `' '`):

```js
const GAS_URL = 'https://script.google.com/macros/s/AKfycb.../exec';
```
4. Simpan.

---

## BAGIAN C — Deploy ke GitHub Pages

### Folder yang dipakai
Folder kerja Anda adalah **`fabry-layer-farm`** (hasil ekstrak ZIP). **Di folder inilah `git init` dijalankan.** Bukan folder di atasnya, bukan masuk lebih dalam. Isinya harus langsung terlihat `index.html`, `css`, `js`, `assets`.

### C1. Pasang Git
- Windows: https://git-scm.com/download/win → install, klik Next terus (default).
- Mac: buka Terminal, ketik `git --version`, ikuti tawaran install.

Cek: buka PowerShell, ketik `git --version` → muncul nomor versi.

### C2. Akun GitHub
Daftar di https://github.com. Username Anda jadi bagian alamat situs: `username.github.io`.

### C3. Kenalkan diri ke Git (sekali seumur komputer)
```
git config --global user.name "Nama Anda"
git config --global user.email "email-akun-github@gmail.com"
```

### C4. Buat repository
1. github.com → tombol **+** → **New repository**.
2. Repository name: `fabry-layer-farm`.
3. Pilih **Public**. **Jangan** centang README, .gitignore, atau license.
4. **Create repository**. Biarkan halamannya terbuka.

### C5. Masuk ke folder yang benar
Di File Explorer buka folder `fabry-layer-farm`, klik address bar, ketik `powershell`, Enter. Lalu cek isinya:
```
dir
```
Harus terlihat `index.html`, `css`, `js`, `assets`, `README.md`. **Kalau yang terlihat folder lain (mis. `fabry-layer-farm` lagi), Anda terlalu tinggi — masuk dulu (`cd fabry-layer-farm`) sampai `dir` menampilkan `index.html`.** Jangan lanjut sebelum itu benar.

### C6. Kirim ke GitHub (satu per satu)
```
git init
git add .
git commit -m "Upload pertama"
git branch -M main
git remote add origin https://github.com/USERNAME/fabry-layer-farm.git
git push -u origin main
```
(Ganti `USERNAME` dengan username GitHub Anda. Titik di `git add .` wajib ada.)

Saat diminta **Username**: username GitHub. **Password**: tempel **Personal Access Token** (lihat C7). Saat mengetik/menempel token layar terlihat kosong — itu normal, tekan Enter.

Sukses jika muncul `* [new branch] main -> main`.

### C7. Personal Access Token
GitHub tidak menerima password biasa untuk `git push`.
1. Buka https://github.com/settings/tokens → **Generate new token (classic)**.
2. Note: `git-push`; Expiration: 90 days; centang **repo**.
3. **Generate token**, salin (`ghp_...`) dan simpan — hanya tampil sekali.
4. Ulangi `git push -u origin main`, tempel token sebagai password.

### C8. Aktifkan GitHub Pages
1. Di repo: **Settings** → **Pages** (menu kiri).
2. Source: **Deploy from a branch**. Branch: **main**, folder **/ (root)** → **Save**.
3. Tunggu 1–2 menit, refresh. Centang **Enforce HTTPS** bila ada.
4. Situs Anda: `https://USERNAME.github.io/fabry-layer-farm/`

### C9. Coba login
Buka situs → masuk `pemilik` / `123456`. **Segera ganti PIN** di menu Profil. Lalu coba input data harian.

---

## Update di kemudian hari

**Ubah tampilan/frontend** (dari folder `fabry-layer-farm`):
```
git add .
git commit -m "Perubahan"
git push
```
Tunggu 1–2 menit, lalu **Ctrl+Shift+R**.

**Ubah backend (`Kode.gs`)**: tempel kode baru, lalu **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**. URL `/exec` tidak berubah. Kalau memilih "New deployment", URL berganti dan `config.js` harus diperbarui.

---

## Troubleshooting

| Gejala | Penyebab & solusi |
|---|---|
| Situs GitHub 404 | `git init` dijalankan di folder yang salah. Cek di halaman repo: `index.html` harus terlihat di daftar paling atas. Perbaiki: masuk folder yang benar, `git init`, `git add .`, `git commit -m "fix"`, `git push -u origin main --force` |
| Halaman polos tanpa warna | Folder `css`/`js` tidak ikut terkirim. Jangan upload lewat web GitHub; pakai langkah C6 |
| "GAS_URL belum diisi" | `js/config.js` belum diisi (Bagian B), lalu push ulang |
| "Gagal terhubung ke server" | URL `/exec` salah, atau akses belum "Anyone" (A5), atau internet putus. Tes URL di browser (A6) |
| `Password authentication is not supported` | Pakai Personal Access Token (C7) |
| `remote origin already exists` | Lewati, lanjut `git push -u origin main` |
| `fatal: not a git repository` | Belum `git init`, atau salah folder |
| Login: "Username atau PIN salah" | Pakai username kecil semua. 5x salah terkunci 15 menit. Jalankan `siapkanAkunLogin` dari editor Apps Script untuk memulihkan `admin` & `pemilik` ke PIN 123456 |
| Lupa PIN pemilik | Editor Apps Script → jalankan `daruratResetPinPemilik`, PIN baru muncul di Execution log |
| Perubahan tak muncul | Tunggu 2 menit lalu Ctrl+Shift+R, atau buka jendela Incognito |
| Respons pertama lambat | Wajar (Apps Script "bangun" dulu ±2–5 detik) |

## Catatan keamanan
- URL `/exec` bersifat publik, tapi semua data hanya bisa diakses dengan login (username + PIN) dan peran dicek di server.
- Ganti PIN bawaan `123456` segera.
- Jangan membagikan Personal Access Token ke siapa pun.

## Glosarium singkat
- **Repository (repo)**: folder proyek di GitHub.
- **Commit**: "foto" kondisi file pada satu waktu.
- **Push**: mengirim commit dari komputer ke GitHub.
- **Branch `main`**: jalur utama proyek.
- **GitHub Pages**: layanan gratis GitHub untuk menayangkan situs statis.
- **Web App URL (`/exec`)**: alamat backend Apps Script.

## Catatan kecepatan (v2.1)
- Halaman yang pernah dibuka tampil langsung dari cache, lalu disegarkan diam-diam. Menu lain dimuat otomatis di latar belakang.
- Tombol Simpan langsung menampilkan "tersimpan"; pengiriman ke server berjalan di belakang. Jika gagal, isian dikembalikan ke form.
- Backend menyimpan hasil baca di CacheService dan otomatis dibersihkan setiap ada data berubah. Bila Anda mengedit Google Sheet **langsung** (bukan lewat aplikasi), tampilan bisa tertinggal hingga ±10 menit.
- Setelah mengganti `Kode.gs`: Deploy → Manage deployments → Edit → New version.
