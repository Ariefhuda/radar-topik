import { escapeHtml } from './telegram.js';

const HELP = `<b>Radar Topik</b> — perintah:

<b>Topik</b>
/tambah &lt;topik&gt; — notif <b>langsung</b> tiap ada postingan baru
/ringkas &lt;topik&gt; — dikumpulkan jadi <b>ringkasan</b> jam 08.00 &amp; 19.00 WIB
/hapus &lt;nomor&gt; — hapus topik (nomor ada di /list)

Cara menulis topik:
• spasi = semua kata wajib ada
• <code>|</code> = salah satu cukup
• <code>-kata</code> = abaikan postingan dengan kata itu
contoh: <code>/tambah vps|server|cloud gratis|free|giveaway -jual</code>

<b>Akun Threads</b> (semua postingannya dikirim)
/akun &lt;username&gt; — notif langsung
/akun &lt;username&gt; ringkas — masuk ringkasan
/hapusakun &lt;username&gt;

<b>Channel Telegram publik</b> (disaring pakai topik)
/channel &lt;nama&gt; · /hapuschannel &lt;nama&gt;

/list — lihat semua · /ringkasan — kirim ringkasan sekarang

Tanda: 🔥 = ada kata "terbatas/deadline/hari ini", ⚠️ = ciri penipuan (apk, OTP/PIN, biaya admin, transfer).
Bot mengecek tiap ±5 menit, jadi balasan perintah bisa telat segitu.`;

function cleanName(arg, re) {
  return (arg || '')
    .trim()
    .replace(re, '')
    .replace(/^@/, '')
    .split(/[/?\s]/)[0];
}
const cleanChannel = (a) => cleanName(a, /^https?:\/\/t\.me\/(s\/)?/i);
const cleanAccount = (a) => cleanName(a, /^https?:\/\/(www\.)?threads\.(com|net)\//i);

const modeIcon = (m) => (m === 'digest' ? '📋' : '⚡');

function listText(state) {
  const topics = state.topics.length
    ? state.topics.map((t, i) => `${i + 1}. ${modeIcon(t.mode)} ${escapeHtml(t.q)}`).join('\n')
    : '(belum ada — pakai /tambah)';
  const accounts = state.accounts.length
    ? state.accounts.map((a) => `• ${modeIcon(a.mode)} @${escapeHtml(a.u)}`).join('\n')
    : '(belum ada — pakai /akun)';
  const channels = state.channels.length
    ? state.channels.map((c) => `• @${escapeHtml(c)}`).join('\n')
    : '(belum ada — pakai /channel)';
  return (
    `<b>Topik:</b>\n${topics}\n\n<b>Akun Threads:</b>\n${accounts}\n\n<b>Channel Telegram:</b>\n${channels}\n\n` +
    `⚡ = langsung · 📋 = ringkasan (${state.digest.length} menunggu)`
  );
}

// Mengubah state sesuai perintah, mengembalikan daftar balasan {chatId, html}.
export function handleUpdates(state, updates, ownerChatId, now = Date.now()) {
  const replies = [];
  for (const u of updates) {
    state.telegramOffset = Math.max(state.telegramOffset, u.update_id + 1);
    const msg = u.message;
    if (!msg?.text) continue;
    const chatId = String(msg.chat.id);
    const [rawCmd, ...rest] = msg.text.trim().split(/\s+/);
    const cmd = rawCmd.toLowerCase().replace(/@.*$/, '');
    const arg = rest.join(' ').trim();
    const reply = (html) => replies.push({ chatId, html });

    if (!ownerChatId) {
      reply(
        `Chat ID kamu: <code>${chatId}</code>\nSimpan angka ini sebagai secret <b>TELEGRAM_CHAT_ID</b> di GitHub, lalu kirim /bantuan lagi.`,
      );
      continue;
    }
    if (chatId !== String(ownerChatId)) continue; // abaikan orang lain

    switch (cmd) {
      case '/start':
      case '/bantuan':
      case '/help':
        reply(HELP);
        break;
      case '/tambah':
      case '/ringkas': {
        const mode = cmd === '/ringkas' ? 'digest' : 'instant';
        if (!arg) { reply(`Tulis topiknya, contoh: <code>${cmd} vps gratis</code>`); break; }
        const existing = state.topics.find((t) => t.q.toLowerCase() === arg.toLowerCase());
        if (existing) {
          existing.mode = mode;
          reply(`Topik itu sudah ada — mode diubah jadi ${modeIcon(mode)} ${mode === 'digest' ? 'ringkasan' : 'langsung'}.`);
          break;
        }
        state.topics.push({ q: arg, mode, addedAt: now });
        reply(
          `✅ ${modeIcon(mode)} Topik ditambahkan: <b>${escapeHtml(arg)}</b>\n` +
            (mode === 'digest' ? 'Postingan baru dikumpulkan ke ringkasan 08.00 & 19.00 WIB.' : 'Postingan baru langsung dikirim ke sini.'),
        );
        break;
      }
      case '/hapus': {
        const n = Number(arg);
        if (!Number.isInteger(n) || n < 1 || n > state.topics.length) {
          reply('Nomor tidak valid. Lihat nomornya di /list');
          break;
        }
        const [removed] = state.topics.splice(n - 1, 1);
        reply(`🗑 Topik dihapus: <b>${escapeHtml(removed.q)}</b>`);
        break;
      }
      case '/akun': {
        const [name, opt] = [cleanAccount(rest[0]), (rest[1] || '').toLowerCase()];
        if (!/^[A-Za-z0-9_.]{2,30}$/.test(name)) { reply('Contoh: <code>/akun updatepelatihan</code>'); break; }
        const mode = opt.startsWith('ringkas') ? 'digest' : 'instant';
        const existing = state.accounts.find((a) => a.u.toLowerCase() === name.toLowerCase());
        if (existing) existing.mode = mode;
        else state.accounts.push({ u: name, mode, addedAt: now });
        reply(`✅ ${modeIcon(mode)} Akun Threads dipantau: @${escapeHtml(name)}`);
        break;
      }
      case '/hapusakun': {
        const name = cleanAccount(arg).toLowerCase();
        const before = state.accounts.length;
        state.accounts = state.accounts.filter((a) => a.u.toLowerCase() !== name);
        reply(before === state.accounts.length ? 'Akun itu tidak ada di daftar.' : `🗑 Akun dihapus: @${escapeHtml(name)}`);
        break;
      }
      case '/channel': {
        const name = cleanChannel(arg);
        if (!/^[A-Za-z0-9_]{4,}$/.test(name)) { reply('Contoh: <code>/channel namachannel</code>'); break; }
        if (!state.channels.includes(name)) state.channels.push(name);
        reply(`✅ Channel dipantau: @${escapeHtml(name)}\n(harus channel publik yang bisa dibuka di t.me/s/${escapeHtml(name)})`);
        break;
      }
      case '/hapuschannel': {
        const name = cleanChannel(arg);
        const before = state.channels.length;
        state.channels = state.channels.filter((c) => c.toLowerCase() !== name.toLowerCase());
        reply(before === state.channels.length ? 'Channel itu tidak ada di daftar.' : `🗑 Channel dihapus: @${escapeHtml(name)}`);
        break;
      }
      case '/list':
        reply(listText(state));
        break;
      case '/ringkasan':
        if (state.digest.length) state.digestNow = true;
        else reply('Ringkasan masih kosong.');
        break;
      default:
        if (cmd.startsWith('/')) reply('Perintah tidak dikenal. Ketik /bantuan');
    }
  }
  return replies;
}
