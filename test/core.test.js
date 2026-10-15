import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matches, searchQuery, hasExcluded } from '../src/match.js';
import { handleUpdates } from '../src/commands.js';
import { parseChannelPage } from '../src/sources/telegramChannel.js';
import { collectPosts, parseCookieString } from '../src/sources/threads.js';

test('matches: semua kata wajib ada, kata "-" menolak', () => {
  assert.ok(matches('Bagi-bagi VPS GRATIS hari ini!', 'vps gratis'));
  assert.ok(!matches('VPS murah', 'vps gratis'));
  assert.ok(!matches('jual vps gratis setup', 'vps gratis -jual'));
  assert.ok(matches('Kebakaran hutan di Riau', 'kebakaran hutan'));
  assert.equal(searchQuery('vps gratis -jual -sewa'), 'vps gratis');
  assert.ok(hasExcluded('Sewa VPS', 'vps -sewa'));
});

const msg = (id, text, chat = 42) => ({ update_id: id, message: { chat: { id: chat }, text } });

test('perintah: tanpa TELEGRAM_CHAT_ID, bot memberi tahu chat id', () => {
  const s = { topics: [], channels: [], telegramOffset: 0 };
  const r = handleUpdates(s, [msg(5, '/start')], undefined);
  assert.match(r[0].html, /42/);
  assert.equal(s.telegramOffset, 6);
});

test('perintah: tambah, list, hapus, channel; orang lain diabaikan', () => {
  const s = { topics: [], channels: [], telegramOffset: 0 };
  handleUpdates(s, [msg(1, '/tambah vps gratis -jual'), msg(2, '/tambah VPS gratis -jual')], '42', 1000);
  assert.deepEqual(s.topics, [{ q: 'vps gratis -jual', addedAt: 1000 }]);

  handleUpdates(s, [msg(3, '/channel https://t.me/s/VpsFreeID'), msg(4, '/channel @abc_def')], '42');
  assert.deepEqual(s.channels, ['VpsFreeID', 'abc_def']);

  const intruder = handleUpdates(s, [msg(5, '/hapus 1', 999)], '42');
  assert.equal(intruder.length, 0);
  assert.equal(s.topics.length, 1);

  handleUpdates(s, [msg(6, '/hapus 1'), msg(7, '/hapuschannel abc_def')], '42');
  assert.equal(s.topics.length, 0);
  assert.deepEqual(s.channels, ['VpsFreeID']);
  assert.equal(s.telegramOffset, 8);
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

test('collectPosts menemukan postingan Threads di JSON bersarang', () => {
  const json = {
    data: { searchResults: { edges: [{ node: { thread: { thread_items: [{ post: {
      code: 'ABC123', taken_at: 1760000000, user: { username: 'budi' }, caption: { text: 'bagi vps gratis' },
    } }] } } }] } },
  };
  const [post] = collectPosts(json).values();
  assert.equal(post.url, 'https://www.threads.com/@budi/post/ABC123');
  assert.equal(post.text, 'bagi vps gratis');
  assert.equal(post.date, 1760000000 * 1000);
});

test('parseCookieString', () => {
  const c = parseCookieString('sessionid=abc; csrftoken=x=y');
  assert.equal(c.length, 4);
  assert.deepEqual([c[0].name, c[0].value, c[2].value], ['sessionid', 'abc', 'x=y']);
});
