import { loadState, saveState } from './state.js';
import { createBot, escapeHtml } from './telegram.js';
import { handleUpdates } from './commands.js';
import { matches, hasExcluded, searchQuery } from './match.js';
import { searchGoogleNews } from './sources/googlenews.js';
import { searchReddit } from './sources/reddit.js';
import { fetchChannel } from './sources/telegramChannel.js';
import { searchThreads } from './sources/threads.js';

const env = process.env;
const MAX_PER_RUN = 15;
const MAX_AGE = 24 * 3600 * 1000;
const GRACE = 1 * 3600 * 1000; // postingan sedikit sebelum topik ditambahkan masih dikirim
const ERROR_NOTIFY_EVERY = 6 * 3600 * 1000;
const LABEL = { threads: '🧵 Threads', telegram: '✈️ Telegram', reddit: '👽 Reddit', news: '📰 Berita' };

if (!env.TELEGRAM_BOT_TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN belum diisi.');
  process.exit(1);
}

const bot = createBot(env.TELEGRAM_BOT_TOKEN);
const owner = env.TELEGRAM_CHAT_ID;
const state = loadState();
const now = Date.now();

// 1. Proses perintah dari chat Telegram.
const updates = await bot.getUpdates(state.telegramOffset);
for (const r of handleUpdates(state, updates, owner, now)) await bot.send(r.chatId, r.html);

// 2. Kumpulkan postingan dari semua sumber.
const errors = [];
const collected = []; // { topic, item }

async function attempt(name, fn) {
  try {
    await fn();
    delete state.errors[name];
  } catch (e) {
    console.error(`[${name}]`, e.message);
    errors.push({ name, message: e.message });
  }
}

if (owner && state.topics.length) {
  const queries = [...new Set(state.topics.map((t) => searchQuery(t.q)))].filter(Boolean);
  const byQuery = (q) => state.topics.filter((t) => searchQuery(t.q) === q);

  // Sumber berbasis pencarian. Threads & Reddit hasilnya longgar (banyak yang nggak nyambung),
  // jadi semua kata topik wajib ada. Berita cukup buang kata pengecualian (judul sering pakai sinonim).
  const addSearchResults = (q, items, strict = true) => {
    for (const topic of byQuery(q)) {
      for (const item of items) {
        if (strict ? matches(item.text, topic.q) : !hasExcluded(item.text, topic.q)) collected.push({ topic, item });
      }
    }
  };

  if (env.THREADS_COOKIES) {
    await attempt('threads', async () => {
      const res = await searchThreads(queries, env.THREADS_COOKIES);
      for (const [q, items] of res) addSearchResults(q, items);
    });
  }

  await attempt('reddit', async () => {
    for (const q of queries) {
      addSearchResults(q, await searchReddit(q, { clientId: env.REDDIT_CLIENT_ID, clientSecret: env.REDDIT_CLIENT_SECRET }));
    }
  });

  await attempt('news', async () => {
    for (const q of queries) addSearchResults(q, await searchGoogleNews(q), false);
  });

  // Channel Telegram: ambil pesan terbaru, lalu saring sendiri per topik.
  for (const ch of state.channels) {
    await attempt(`channel:${ch}`, async () => {
      const items = await fetchChannel(ch);
      for (const topic of state.topics) {
        for (const item of items) if (matches(item.text, topic.q)) collected.push({ topic, item });
      }
    });
  }
}

// 3. Saring yang baru & kirim notifikasi.
const fresh = [];
const queued = new Set();
for (const { topic, item } of collected) {
  const key = `${item.source}:${item.id}`;
  const isNew = !state.seen[key] && !queued.has(key);
  state.seen[key] ??= now;
  if (!isNew) continue;
  if (item.date < now - MAX_AGE || item.date < topic.addedAt - GRACE) continue;
  queued.add(key);
  fresh.push({ topic, item });
}
// Kalau kebanyakan, ambil yang paling baru, lalu kirim urut dari yang terlama.
fresh.sort((a, b) => b.item.date - a.item.date);
const toSend = fresh.slice(0, MAX_PER_RUN).reverse();

function format({ topic, item }) {
  const text = item.text.length > 600 ? item.text.slice(0, 600) + '…' : item.text;
  const time = new Date(item.date).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'short', timeStyle: 'short' });
  return (
    `${LABEL[item.source] ?? item.source} · <b>${escapeHtml(topic.q)}</b>\n` +
    `${escapeHtml(item.author)} · ${time} WIB\n\n` +
    `${escapeHtml(text)}\n\n` +
    `<a href="${escapeHtml(item.url)}">Buka postingan</a>`
  );
}

if (owner) {
  for (const f of toSend) await bot.send(owner, format(f));
  if (fresh.length > MAX_PER_RUN) {
    await bot.send(owner, `…dan ${fresh.length - MAX_PER_RUN} postingan lama lain dilewati (terlalu banyak sekaligus). Coba perketat topiknya.`);
  }

  // Kabari error sumber, tapi jangan spam: paling sering sekali per 6 jam per sumber.
  for (const e of errors) {
    if (now - (state.errors[e.name] ?? 0) < ERROR_NOTIFY_EVERY) continue;
    state.errors[e.name] = now;
    await bot.send(owner, `⚠️ Sumber <b>${escapeHtml(e.name)}</b> gagal: ${escapeHtml(e.message)}`);
  }
}

saveState(state);
console.log(`Selesai: ${collected.length} cocok, ${fresh.length} baru dikirim, ${errors.length} sumber error.`);
