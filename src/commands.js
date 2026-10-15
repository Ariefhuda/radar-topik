import { escapeHtml } from './telegram.js';

const HELP = `<b>Radar Topik</b> — perintah:
/tambah &lt;topik&gt; — pantau topik baru
   contoh: <code>/tambah vps gratis -jual -sewa</code>
   (kata berawalan - artinya postingan dengan kata itu diabaikan)
/hapus &lt;nomor&gt; — hapus topik (lihat nomor di /list)
/list — daftar topik &amp; channel
/channel &lt;nama&gt; — pantau channel Telegram publik
   contoh: <code>/channel vpsgratisan</code>
/hapuschannel &lt;nama&gt; — berhenti memantau channel
/bantuan — pesan ini

Catatan: bot mengecek tiap ±5–15 menit, jadi balasan perintah juga bisa telat segitu.`;

function cleanChannel(arg) {
  return arg
    .trim()
    .replace(/^https?:\/\/t\.me\/(s\/)?/i, '')
    .replace(/^@/, '')
    .split(/[/?\s]/)[0];
}

function listText(state) {
  const topics = state.topics.length
    ? state.topics.map((t, i) => `${i + 1}. ${escapeHtml(t.q)}`).join('\n')
    : '(belum ada — pakai /tambah)';
  const channels = state.channels.length
    ? state.channels.map((c) => `• @${escapeHtml(c)}`).join('\n')
    : '(belum ada — pakai /channel)';
  return `<b>Topik:</b>\n${topics}\n\n<b>Channel Telegram:</b>\n${channels}`;
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
      case '/tambah': {
        if (!arg) { reply('Tulis topiknya, contoh: <code>/tambah vps gratis</code>'); break; }
        if (state.topics.some((t) => t.q.toLowerCase() === arg.toLowerCase())) {
          reply('Topik itu sudah ada.');
          break;
        }
        state.topics.push({ q: arg, addedAt: now });
        reply(`✅ Topik ditambahkan: <b>${escapeHtml(arg)}</b>\nMulai sekarang postingan baru soal ini akan dikirim ke sini.`);
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
      case '/list':
        reply(listText(state));
        break;
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
      default:
        if (cmd.startsWith('/')) reply('Perintah tidak dikenal. Ketik /bantuan');
    }
  }
  return replies;
}
