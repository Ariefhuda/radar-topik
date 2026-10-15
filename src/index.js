import { loadState, saveState } from './state.js';
import { createBot, escapeHtml } from './telegram.js';
import { handleUpdates } from './commands.js';
import { matches, hasExcluded, booleanQuery, queryCombos, badges, isSpam } from './match.js';
import { searchGoogleNews } from './sources/googlenews.js';
import { searchReddit } from './sources/reddit.js';
import { fetchChannel } from './sources/telegramChannel.js';
import { openThreads } from './sources/threads.js';
import { fetchTrending } from './sources/githubTrending.js';

const env = process.env;
const MAX_PER_RUN = 15;
const MAX_AGE = 24 * 3600 * 1000;
const GRACE = 1 * 3600 * 1000; // postingan sedikit sebelum topik ditambahkan masih dikirim
const ERROR_NOTIFY_EVERY = 6 * 3600 * 1000;
const THREADS_PAGES_PER_RUN = 10; // sisanya bergiliran di putaran berikutnya
const DIGEST_HOURS_WIB = [8, 19];
const LABEL = { threads: '🧵 Threads', telegram: '✈️ Telegram', reddit: '👽 Reddit', news: '📰 Berita' };
const ICON = { threads: '🧵', telegram: '✈️', reddit: '👽', news: '📰' };

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

// 2. Kumpulkan postingan dari semua sumber. "target" = topik atau akun yang memicu postingan.
const errors = [];
const collected = []; // { target, item }

async function attempt(name, fn) {
  try {
    await fn();
    delete state.errors[name];
  } catch (e) {
    console.error(`[${name}]`, e.message);
    errors.push({ name, message: e.message });
  }
}

if (owner && (state.topics.length || state.accounts.length)) {
  // Threads & Reddit hasilnya longgar, jadi semua kata topik wajib ada.
  // Berita cukup buang kata pengecualian (judul sering pakai sinonim, mis. "karhutla").
  const add = (topics, items, strict = true) => {
    for (const topic of topics) {
      for (const item of items) {
        if (strict ? matches(item.text, topic.q) : !hasExcluded(item.text, topic.q)) collected.push({ target: topic, item });
      }
    }
  };

  if (env.THREADS_COOKIES) {
    const byQuery = new Map();
    for (const t of state.topics) for (const q of queryCombos(t.q)) byQuery.set(q, [...(byQuery.get(q) ?? []), t]);
    const jobs = [
      ...[...byQuery].map(([q, topics]) => ({ name: `threads:"${q}"`, run: (th) => th.search(q), topics })),
      ...state.accounts.map((a) => ({
        name: `threads:@${a.u}`,
        run: (th) => th.profile(a.u),
        account: { q: `@${a.u}`, mode: a.mode, addedAt: a.addedAt },
      })),
    ];
    const take = Math.min(THREADS_PAGES_PER_RUN, jobs.length);
    const start = state.threadsCursor % Math.max(jobs.length, 1);
    state.threadsCursor = start + take;

    await attempt('threads', async () => {
      const th = await openThreads(env.THREADS_COOKIES);
      try {
        for (let i = 0; i < take; i++) {
          const job = jobs[(start + i) % jobs.length];
          try {
            const items = await job.run(th);
            if (job.account) for (const item of items) collected.push({ target: job.account, item });
            else add(job.topics, items);
            delete state.errors[job.name];
          } catch (e) {
            if (/cookie/i.test(e.message)) throw e; // percuma lanjut kalau belum login
            console.error(`[${job.name}]`, e.message);
            errors.push({ name: job.name, message: e.message });
          }
        }
      } finally {
        await th.close();
      }
    });
  }

  if (state.topics.length) {
    await attempt('reddit', async () => {
      for (const t of state.topics) {
        add([t], await searchReddit(booleanQuery(t.q), { clientId: env.REDDIT_CLIENT_ID, clientSecret: env.REDDIT_CLIENT_SECRET }));
      }
    });

    await attempt('news', async () => {
      for (const t of state.topics) {
        add([t], await searchGoogleNews(booleanQuery(t.q)), false);
        await new Promise((r) => setTimeout(r, 1500)); // jeda supaya tidak ditolak (HTTP 503)
      }
    });

    // Channel Telegram: ambil pesan terbaru, lalu saring sendiri per topik.
    for (const ch of state.channels) {
      await attempt(`channel:${ch}`, async () => add(state.topics, await fetchChannel(ch)));
    }
  }
}

// 3. Saring yang baru, lalu bagi ke notif langsung atau ringkasan.
const fresh = [];
const queued = new Set();
for (const { target, item } of collected) {
  const key = `${item.source}:${item.id}`;
  const isNew = !state.seen[key] && !queued.has(key);
  state.seen[key] ??= now;
  if (!isNew) continue;
  if (item.date < now - MAX_AGE || item.date < target.addedAt - GRACE || isSpam(item.text)) continue;
  queued.add(key);
  fresh.push({ target, item, ...badges(item.text) });
}

const instant = fresh.filter((f) => f.target.mode !== 'digest');
for (const f of fresh.filter((f) => f.target.mode === 'digest')) {
  state.digest.push({
    t: f.target.q, s: f.item.source, a: f.item.author, x: f.item.text.replace(/\s+/g, ' ').slice(0, 180),
    u: f.item.url, d: f.item.date, urgent: f.urgent, warn: f.warnings.length > 0,
  });
}

// Kalau kebanyakan, ambil yang paling baru, lalu kirim urut dari yang terlama.
instant.sort((a, b) => b.item.date - a.item.date);
const toSend = instant.slice(0, MAX_PER_RUN).reverse();

const wib = (ms) => new Date(ms).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'short', timeStyle: 'short' });

function formatInstant({ target, item, urgent, warnings }) {
  const text = item.text.length > 700 ? item.text.slice(0, 700) + '…' : item.text;
  const likes = item.likes ? ` · ❤️ ${item.likes}` : '';
  return (
    `${urgent ? '🔥 ' : ''}${LABEL[item.source] ?? item.source} · <b>${escapeHtml(target.q)}</b>\n` +
    `${escapeHtml(item.author)} · ${wib(item.date)} WIB${likes}\n` +
    (warnings.length ? `⚠️ <b>Hati-hati:</b> ${escapeHtml(warnings.join(', '))}\n` : '') +
    `\n${escapeHtml(text)}\n\n<a href="${escapeHtml(item.url)}">Buka postingan</a>`
  );
}

// Ringkasan: dikelompokkan per topik, dipecah per ±3800 karakter (batas Telegram 4096).
function formatDigest(entries) {
  const groups = new Map();
  for (const e of [...entries].sort((a, b) => b.d - a.d)) groups.set(e.t, [...(groups.get(e.t) ?? []), e]);
  const blocks = [];
  for (const [t, list] of groups) {
    blocks.push(`\n<b>${escapeHtml(t)}</b> (${list.length})`);
    for (const e of list) {
      blocks.push(
        `${e.urgent ? '🔥' : '•'}${e.warn ? '⚠️' : ''} ${ICON[e.s] ?? ''} ${escapeHtml(e.x)} — <a href="${escapeHtml(e.u)}">${escapeHtml(e.a || 'buka')}</a>`,
      );
    }
  }
  const messages = [];
  let cur = `📋 <b>Ringkasan</b> — ${entries.length} postingan`;
  for (const b of blocks) {
    if (cur.length + b.length > 3800) {
      messages.push(cur);
      cur = '📋 <i>(lanjutan)</i>';
    }
    cur += '\n' + b;
  }
  return [...messages, cur];
}

function digestSlot(ms) {
  const d = new Date(ms + 7 * 3600 * 1000); // WIB = UTC+7
  const passed = DIGEST_HOURS_WIB.filter((h) => d.getUTCHours() >= h);
  return passed.length ? `${d.toISOString().slice(0, 10)}-${passed.at(-1)}` : null;
}

if (owner) {
  for (const f of toSend) await bot.send(owner, formatInstant(f));
  if (instant.length > MAX_PER_RUN) {
    await bot.send(owner, `…dan ${instant.length - MAX_PER_RUN} postingan lama lain dilewati (terlalu banyak sekaligus). Coba perketat topiknya.`);
  }

  const slot = digestSlot(now);
  const slotDue = slot && slot !== state.lastDigest;
  if ((slotDue || state.digestNow) && state.digest.length) {
    for (const m of formatDigest(state.digest)) await bot.send(owner, m);
    state.digest = [];
  }
  if (slotDue) state.lastDigest = slot;

  // GitHub Trending: sekali sehari mulai jam 08.00 WIB, atau saat diminta lewat /trending.
  const wibNow = new Date(now + 7 * 3600 * 1000);
  const today = wibNow.toISOString().slice(0, 10);
  const trendingDue = state.trending.on && wibNow.getUTCHours() >= 8 && state.trending.last !== today;
  if (trendingDue || state.trendingNow) {
    await attempt('github-trending', async () => {
      const repos = (await fetchTrending()).slice(0, 12);
      const lines = repos.map(
        (r, i) =>
          `${i + 1}. <a href="${escapeHtml(r.url)}">${escapeHtml(r.repo)}</a>` +
          ` — ⭐ +${escapeHtml(r.today)} hari ini${r.lang ? ` · ${escapeHtml(r.lang)}` : ''}` +
          (r.desc ? `\n<i>${escapeHtml(r.desc.length > 130 ? r.desc.slice(0, 130) + '…' : r.desc)}</i>` : ''),
      );
      await bot.send(owner, `🐙 <b>GitHub Trending hari ini</b>\n\n${lines.join('\n\n')}`);
      if (trendingDue) state.trending.last = today;
    });
  }

  // Kabari error sumber, tapi jangan spam: paling sering sekali per 6 jam per sumber.
  for (const e of errors) {
    if (now - (state.errors[e.name] ?? 0) < ERROR_NOTIFY_EVERY) continue;
    state.errors[e.name] = now;
    await bot.send(owner, `⚠️ Sumber <b>${escapeHtml(e.name)}</b> gagal: ${escapeHtml(e.message)}`);
  }
}

saveState(state);
console.log(
  `Selesai: ${collected.length} cocok, ${toSend.length} dikirim langsung, ` +
    `${fresh.length - instant.length} masuk ringkasan, ${errors.length} error.`,
);
