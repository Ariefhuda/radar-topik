import * as cheerio from 'cheerio';

// Halaman pratinjau publik t.me/s/<channel> berisi ±20 pesan terakhir.
export function parseChannelPage(html, channel) {
  const $ = cheerio.load(html);
  const items = [];
  $('.tgme_widget_message[data-post]').each((_, el) => {
    const m = $(el);
    const post = m.attr('data-post');
    const textEl = m.find('.tgme_widget_message_text').first();
    textEl.find('br').replaceWith('\n');
    const text = textEl.text().trim();
    if (!text) return;
    items.push({
      source: 'telegram',
      id: post,
      text,
      url: `https://t.me/${post}`,
      author: `@${channel}`,
      date: Date.parse(m.find('time[datetime]').last().attr('datetime')) || Date.now(),
    });
  });
  return items;
}

export async function fetchChannel(channel) {
  const res = await fetch(`https://t.me/s/${encodeURIComponent(channel)}`, {
    headers: { 'user-agent': 'Mozilla/5.0 radar-topik' },
  });
  if (!res.ok) throw new Error(`Channel @${channel} HTTP ${res.status}`);
  return parseChannelPage(await res.text(), channel);
}
