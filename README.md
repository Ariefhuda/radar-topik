# Radar Topik

Bot yang memantau **Threads, channel Telegram publik, Reddit, dan Google News** untuk topik pilihanmu,
lalu mengirim postingan baru ke Telegram. Gratis, tanpa server — berjalan di GitHub Actions tiap ±5–15 menit.

## Cara pakai (di chat bot Telegram)

| Perintah | Fungsi |
|---|---|
| `/tambah vps\|server gratis\|giveaway -jual` | ⚡ Notif langsung tiap ada postingan baru |
| `/ringkas webinar\|pelatihan gratis` | 📋 Dikumpulkan jadi ringkasan jam 08.00 & 19.00 WIB |
| `/hapus 1` | Hapus topik nomor 1 (lihat `/list`) |
| `/akun updatepelatihan` | Kirim semua postingan baru akun Threads ini (tambah `ringkas` di belakang untuk mode ringkasan) |
| `/hapusakun updatepelatihan` | Berhenti memantau akun |
| `/channel namachannel` | Pantau channel Telegram publik (`t.me/s/namachannel` harus bisa dibuka), disaring pakai topik |
| `/hapuschannel namachannel` | Berhenti memantau channel |
| `/list` | Lihat semua topik, akun, channel |
| `/ringkasan` | Kirim ringkasan sekarang |
| `/trending` | Kirim GitHub Trending sekarang (otomatis tiap 08.00 WIB; `/trending mati` / `/trending hidup`) |

Cara menulis topik: spasi = semua kata wajib ada · `|` = salah satu cukup · `-kata` = abaikan postingan dengan kata itu.

Tanda di notifikasi: 🔥 = menyebut "terbatas/deadline/hari ini", ⚠️ = ciri penipuan (file .apk, OTP/PIN, biaya admin, transfer).
Spam judi online dibuang otomatis.

Threads dicek bergiliran maksimal 10 halaman per putaran (supaya akun aman), jadi kalau topiknya banyak,
tiap kata kunci dicek tiap beberapa putaran. Balasan perintah ikut jadwal pengecekan.

## Setup

Semua disimpan sebagai **GitHub Secrets** (Settings → Secrets and variables → Actions), tidak terlihat publik.

1. **Bot Telegram** — chat [@BotFather](https://t.me/BotFather) → `/newbot` → salin token → secret `TELEGRAM_BOT_TOKEN`.
2. **Chat ID** — kirim `/start` ke bot kamu, jalankan workflow manual (tab Actions → radar → Run workflow).
   Bot membalas chat ID kamu → simpan sebagai secret `TELEGRAM_CHAT_ID`.
3. **Threads** (opsional, ⚠️ melanggar aturan Threads — pakai akun cadangan):
   login threads.com di browser → DevTools (F12) → Application → Cookies → `https://www.threads.com` →
   salin nilai `sessionid`, `csrftoken`, `ds_user_id` menjadi satu baris:
   `sessionid=...; csrftoken=...; ds_user_id=...` → secret `THREADS_COOKIES`.
   Kalau cookie kedaluwarsa, bot akan mengirim peringatan ⚠️ — ulangi langkah ini.
4. **Reddit** (opsional) — tanpa ini dipakai RSS publik yang sering diblokir (HTTP 429/403).
   Buat app tipe *script* di reddit.com/prefs/apps → secret `REDDIT_CLIENT_ID` & `REDDIT_CLIENT_SECRET`.

## Catatan

- Repo harus **publik** agar menit GitHub Actions tidak terbatas. Daftar topik (`data/state.json`) ikut terlihat publik.
- Hanya postingan ≤ 24 jam dan maksimal 1 jam sebelum topik ditambahkan yang dikirim; maksimal 15 notifikasi per putaran.
- Tes: `npm test`.
