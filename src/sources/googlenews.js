import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({ ignoreAttributes: true });

export async function searchGoogleNews(query) {
  const url =
    `https://news.google.com/rss/search?q=${encodeURIComponent(query + ' when:1d')}` +
    '&hl=id&gl=ID&ceid=ID:id';
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 radar-topik' } });
  if (!res.ok) throw new Error(`Google News HTTP ${res.status}`);
  const xml = parser.parse(await res.text());
  const raw = xml?.rss?.channel?.item ?? [];
  return (Array.isArray(raw) ? raw : [raw]).map((it) => ({
    source: 'news',
    id: String(it.guid ?? it.link),
    text: String(it.title ?? ''),
    url: String(it.link),
    author: typeof it.source === 'string' ? it.source : '',
    date: Date.parse(it.pubDate) || Date.now(),
  }));
}
