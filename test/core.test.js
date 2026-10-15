import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matches, booleanQuery, queryCombos, hasExcluded, badges, isSpam } from '../src/match.js';
import { handleUpdates } from '../src/commands.js';
import { parseChannelPage } from '../src/sources/telegramChannel.js';
import { collectPosts, parseCookieString } from '../src/sources/threads.js';
import { parseTrending } from '../src/sources/githubTrending.js';

test('matches: spasi = semua wajib, | = salah satu, - = tolak', () => {
  assert.ok(matches('Bagi-bagi VPS GRATIS hari ini!', 'vps gratis'));
  assert.ok(!matches('VPS murah', 'vps gratis'));
  assert.ok(!matches('jual vps gratis setup', 'vps gratis -jual'));
  assert.ok(matches('Giveaway server 1 bulan', 'vps|server|cloud gratis|free|giveaway'));
  assert.ok(!matches('Server down lagi', 'vps|server|cloud gratis|free|giveaway'));
  assert.ok(hasExcluded('Sewa VPS', 'vps -sewa'));
});

test('query untuk mesin pencari', () => {
  assert.equal(booleanQuery('vps|server gratis -jual'), '(vps OR server) gratis');
  assert.deepEqual(queryCombos('vps|server gratis|free -jual'), ['vps gratis', 'vps free', 'server gratis', 'server free']);
  assert.equal(queryCombos('a|b|c d|e|f g|h').length, 6);
});

test('isSpam membuang judol tapi bukan info gratisan biasa', () => {
  for (const s of ['FREE CREDIT 💰 RM30 #ttbet11', 'slot gacor maxwin hari ini', 'link alternatif togel', 'depo 10k bonus']) assert.ok(isSpam(s), s);
  for (const s of ['VPS gratis 1 bulan', 'Free credit $100 Azure for Students', 'Pelatihan gratis bersertifikat, slot terbatas']) assert.ok(!isSpam(s), s);
});

test('badges: 🔥 mendesak dan ⚠️ penipuan', () => {
  assert.ok(badges('Kuota terbatas, daftar sekarang').urgent);
  assert.ok(!badges('Info pelatihan').urgent);
  assert.deepEqual(badges('Download bansos.apk lalu masukkan kode OTP').warnings, ['ada file .apk', 'menyebut OTP/PIN']);
  assert.deepEqual(badges('Webinar gratis, daftar di link').warnings, []);
});

const msg = (id, text, chat = 42) => ({ update_id: id, message: { chat: { id: chat }, text } });
const blank = () => ({ topics: [], accounts: [], channels: [], digest: [], trending: { on: true, last: '' }, telegramOffset: 0 });

test('perintah: tanpa TELEGRAM_CHAT_ID, bot memberi tahu chat id', () => {
  const s = blank();
  const r = handleUpdates(s, [msg(5, '/start')], undefined);
  assert.match(r[0].html, /42/);
  assert.equal(s.telegramOffset, 6);
});

test('perintah: tambah/ringkas, akun, channel, hapus; orang lain diabaikan', () => {
  const s = blank();
  handleUpdates(s, [msg(1, '/tambah vps gratis -jual'), msg(2, '/ringkas webinar gratis')], '42', 1000);
  assert.deepEqual(s.topics, [
    { q: 'vps gratis -jual', mode: 'instant', addedAt: 1000 },
    { q: 'webinar gratis', mode: 'digest', addedAt: 1000 },
  ]);
  handleUpdates(s, [msg(3, '/tambah WEBINAR gratis')], '42');
  assert.equal(s.topics[1].mode, 'instant');

  handleUpdates(s, [msg(4, '/akun @updatepelatihan ringkas'), msg(5, '/akun https://www.threads.com/@yanuar.code')], '42', 2000);
  assert.deepEqual(s.accounts, [
    { u: 'updatepelatihan', mode: 'digest', addedAt: 2000 },
    { u: 'yanuar.code', mode: 'instant', addedAt: 2000 },
  ]);

  handleUpdates(s, [msg(6, '/channel https://t.me/s/VpsFreeID')], '42');
  assert.deepEqual(s.channels, ['VpsFreeID']);

  assert.equal(handleUpdates(s, [msg(7, '/hapus 1', 999)], '42').length, 0);
  assert.equal(s.topics.length, 2);

  handleUpdates(s, [msg(8, '/hapus 1'), msg(9, '/hapusakun yanuar.code'), msg(10, '/hapuschannel vpsfreeid')], '42');
  assert.equal(s.topics.length, 1);
  assert.deepEqual(s.accounts.map((a) => a.u), ['updatepelatihan']);
  assert.deepEqual(s.channels, []);
  assert.equal(s.telegramOffset, 11);
});

test('/ringkasan menandai kirim sekarang hanya kalau ada isinya', () => {
  const s = blank();
  assert.match(handleUpdates(s, [msg(1, '/ringkasan')], '42')[0].html, /kosong/);
  s.digest.push({});
  handleUpdates(s, [msg(2, '/ringkasan')], '42');
  assert.equal(s.digestNow, true);
});

test('parser channel Telegram', () => {
  const html = `
    <div class="tgme_widget_message" data-post="vpsch/10">
      <div class="tgme_widget_message_text">Giveaway <b>VPS</b><br>gratis 1 bulan</div>
      <a class="tgme_widget_message_date"><time datetime="2026-10-15T08:00:00+00:00"></time></a>
    </div>
    <div class="tgme_widget_message" data-post="vpsch/11"><div class="tgme_widget_message_photo"></div></div>`;
  const items = parseChannelPage(html, 'vpsch');
  assert.equal(items.length, 1);
  assert.equal(items[0].text, 'Giveaway VPS\ngratis 1 bulan');
  assert.equal(items[0].url, 'https://t.me/vpsch/10');
  assert.equal(items[0].date, Date.parse('2026-10-15T08:00:00Z'));
});

const post = (code, user, text, extra = {}) => ({ code, taken_at: 1760000000, user: { username: user }, caption: { text }, ...extra });

test('collectPosts menemukan postingan Threads di JSON bersarang', () => {
  const json = { data: { edges: [{ node: { post: post('ABC', 'budi', 'bagi vps gratis', { like_count: 7 }) } }] } };
  const [p] = collectPosts(json).values();
  assert.equal(p.url, 'https://www.threads.com/@budi/post/ABC');
  assert.equal(p.text, 'bagi vps gratis');
  assert.equal(p.likes, 7);
  assert.equal(p.date, 1760000000 * 1000);
});

test('collectPosts menggabung utas bersambung dari penulis yang sama', () => {
  const found = new Map();
  collectPosts({ post: post('B', 'budi', 'bagian 2') }, found); // bagian kedua terlihat duluan
  collectPosts(
    { thread_items: [{ post: post('A', 'budi', 'bagian 1') }, { post: post('B', 'budi', 'bagian 2') }, { post: post('C', 'ani', 'balasan') }] },
    found,
  );
  collectPosts({ post: post('B', 'budi', 'bagian 2') }, found); // dan muncul lagi sesudahnya
  assert.deepEqual([...found.keys()].sort(), ['A', 'C']);
  assert.equal(found.get('A').text, 'bagian 1\n\nbagian 2');
});

test('parseCookieString', () => {
  const c = parseCookieString('sessionid=abc; csrftoken=x=y');
  assert.equal(c.length, 4);
  assert.deepEqual([c[0].name, c[0].value, c[2].value], ['sessionid', 'abc', 'x=y']);
});

test('/trending: kirim sekarang, mati, hidup', () => {
  const s = blank();
  handleUpdates(s, [msg(1, '/trending')], '42');
  assert.equal(s.trendingNow, true);
  handleUpdates(s, [msg(2, '/trending mati')], '42');
  assert.equal(s.trending.on, false);
  handleUpdates(s, [msg(3, '/trending hidup')], '42');
  assert.equal(s.trending.on, true);
});

test('parser GitHub Trending', () => {
  const html = `<article class="Box-row">
    <h2><a href="/owner/repo">owner / repo</a></h2>
    <p class="col-9">  Alat keren
      untuk agen  </p>
    <span itemprop="programmingLanguage">Python</span>
    <a href="/owner/repo/stargazers">1,234</a>
    <span class="d-inline-block float-sm-right">567 stars today</span>
  </article>`;
  assert.deepEqual(parseTrending(html), [
    { repo: 'owner/repo', url: 'https://github.com/owner/repo', desc: 'Alat keren untuk agen', lang: 'Python', stars: '1,234', today: '567' },
  ]);
});
