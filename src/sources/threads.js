// Threads tidak punya pencarian publik gratis tanpa App Review, jadi di sini kita
// membuka threads.com memakai cookie login akun kamu sendiri, lalu membaca data
// postingan dari JSON yang dimuat halaman. Melanggar aturan Threads → pakai akun cadangan.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export function parseCookieString(str) {
  const cookies = [];
  for (const part of (str || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const name = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    for (const domain of ['.threads.com', '.threads.net']) {
      cookies.push({ name, value, domain, path: '/', secure: true, sameSite: 'Lax' });
    }
  }
  return cookies;
}

const isPost = (p) => p && typeof p.code === 'string' && p.taken_at && p.user?.username;

function toItem(p, text = p.caption?.text ?? '') {
  const user = p.user.username;
  return {
    source: 'threads',
    id: p.code,
    text,
    url: `https://www.threads.com/@${user}/post/${p.code}`,
    author: `@${user}`,
    date: Number(p.taken_at) * 1000,
    likes: p.like_count ?? undefined,
  };
}

// Cari postingan di JSON apa pun (struktur Threads sering berubah, jadi dicari
// berdasarkan bentuknya). Utas berisi beberapa bagian dari penulis yang sama
// digabung jadi satu item supaya notifikasinya tidak terpecah.
export function collectPosts(node, found = new Map()) {
  found.absorbed ??= new Set();
  if (!node || typeof node !== 'object') return found;
  if (Array.isArray(node)) {
    for (const v of node) collectPosts(v, found);
    return found;
  }
  if (Array.isArray(node.thread_items)) {
    const posts = node.thread_items.map((t) => t?.post).filter(isPost);
    if (posts.length) {
      const head = posts[0];
      const parts = [head];
      for (const p of posts.slice(1)) {
        if (p.user.username !== head.user.username) break;
        parts.push(p);
      }
      for (const p of parts.slice(1)) {
        found.absorbed.add(p.code);
        found.delete(p.code);
      }
      if (!found.absorbed.has(head.code)) {
        found.set(head.code, toItem(head, parts.map((p) => p.caption?.text ?? '').join('\n\n')));
      }
      // Bagian dari penulis lain (balasan) tetap diproses sendiri-sendiri.
      for (const p of posts.slice(parts.length)) collectPosts(p, found);
      return found;
    }
  }
  if (isPost(node) && !found.absorbed.has(node.code) && !found.has(node.code)) {
    found.set(node.code, toItem(node));
  }
  for (const v of Object.values(node)) collectPosts(v, found);
  return found;
}

export async function openThreads(cookieString) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const context = await browser.newContext({ userAgent: UA, locale: 'id-ID', viewport: { width: 1280, height: 900 } });
  await context.addCookies(parseCookieString(cookieString));
  const page = await context.newPage();

  async function scrape(url, { clickRecent = false } = {}) {
    const found = new Map();
    const onResponse = async (res) => {
      const type = res.headers()['content-type'] || '';
      if (!/json|javascript|text\/plain/.test(type)) return;
      try {
        collectPosts(JSON.parse((await res.text()).replace(/^for \(;;\);/, '')), found);
      } catch {}
    };
    page.on('response', onResponse);
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(4500);
      const body = await page.innerText('body').catch(() => '');
      if (/\/login/.test(page.url()) || /Log in or sign up for Threads|Masuk atau daftar ke Threads/i.test(body)) {
        throw new Error('Belum login — cookie Threads kedaluwarsa / tidak valid. Ambil ulang THREADS_COOKIES.');
      }
      if (clickRecent) {
        // Tab "Terbaru" supaya yang muncul postingan baru, bukan yang populer.
        const recent = page.getByRole('tab', { name: /^(Recent|Terbaru)$/i }).or(page.getByText(/^(Recent|Terbaru)$/i));
        if (await recent.first().isVisible().catch(() => false)) {
          await recent.first().click().catch(() => {});
          await page.waitForTimeout(3500);
        }
      }
      await page.mouse.wheel(0, 4000);
      await page.waitForTimeout(2500);
      // Data awal halaman juga disisipkan di <script type="application/json">.
      for (const s of await page.$$eval('script[type="application/json"]', (els) => els.map((e) => e.textContent))) {
        try {
          collectPosts(JSON.parse(s), found);
        } catch {}
      }
    } finally {
      page.off('response', onResponse);
    }
    return [...found.values()];
  }

  return {
    search: (q) => scrape(`https://www.threads.com/search?q=${encodeURIComponent(q)}&serp_type=default`, { clickRecent: true }),
    async profile(username) {
      const items = await scrape(`https://www.threads.com/@${encodeURIComponent(username)}`);
      return items.filter((i) => i.author.toLowerCase() === `@${username.toLowerCase()}`);
    },
    close: () => browser.close(),
  };
}
