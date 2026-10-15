// Threads tidak punya pencarian publik gratis tanpa App Review, jadi di sini kita
// membuka halaman pencarian threads.com memakai cookie login akun kamu sendiri,
// lalu membaca data postingan dari JSON yang dimuat halaman tersebut.
// Melanggar aturan Threads → sarannya pakai akun cadangan.

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

// Cari objek postingan di dalam JSON apa pun (struktur Threads sering berubah,
// jadi kita cari berdasarkan bentuknya, bukan jalurnya).
export function collectPosts(node, found = new Map()) {
  if (!node || typeof node !== 'object') return found;
  if (Array.isArray(node)) {
    for (const v of node) collectPosts(v, found);
    return found;
  }
  if (typeof node.code === 'string' && node.taken_at && node.user?.username) {
    const user = node.user.username;
    found.set(node.code, {
      source: 'threads',
      id: node.code,
      text: node.caption?.text ?? '',
      url: `https://www.threads.com/@${user}/post/${node.code}`,
      author: `@${user}`,
      date: Number(node.taken_at) * 1000,
    });
  }
  for (const v of Object.values(node)) collectPosts(v, found);
  return found;
}

export async function searchThreads(queries, cookieString) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ userAgent: UA, locale: 'id-ID', viewport: { width: 1280, height: 900 } });
    await context.addCookies(parseCookieString(cookieString));
    const page = await context.newPage();
    const results = new Map();

    for (const q of queries) {
      const found = new Map();
      const onResponse = async (res) => {
        const type = res.headers()['content-type'] || '';
        if (!/json|javascript|text\/plain/.test(type)) return;
        try {
          const body = (await res.text()).replace(/^for \(;;\);/, '');
          collectPosts(JSON.parse(body), found);
        } catch {}
      };
      page.on('response', onResponse);

      await page.goto(`https://www.threads.com/search?q=${encodeURIComponent(q)}&serp_type=default`, {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      });
      await page.waitForTimeout(5000);
      const body = await page.innerText('body').catch(() => '');
      if (/\/login/.test(page.url()) || /Log in or sign up for Threads|Masuk atau daftar ke Threads/i.test(body)) {
        throw new Error('Belum login — cookie Threads kedaluwarsa / tidak valid. Ambil ulang THREADS_COOKIES.');
      }
      // Pindah ke tab "Terbaru" kalau ada, supaya yang muncul postingan baru, bukan populer.
      const recent = page.getByRole('tab', { name: /^(Recent|Terbaru)$/i }).or(page.getByText(/^(Recent|Terbaru)$/i));
      if (await recent.first().isVisible().catch(() => false)) {
        await recent.first().click().catch(() => {});
        await page.waitForTimeout(4000);
      }
      await page.mouse.wheel(0, 4000);
      await page.waitForTimeout(3000);

      // Data awal halaman juga disisipkan di <script type="application/json">.
      const scripts = await page.$$eval('script[type="application/json"]', (els) => els.map((e) => e.textContent));
      for (const s of scripts) {
        try {
          collectPosts(JSON.parse(s), found);
        } catch {}
      }

      page.off('response', onResponse);
      results.set(q, [...found.values()]);
    }
    return results;
  } finally {
    await browser.close();
  }
}
