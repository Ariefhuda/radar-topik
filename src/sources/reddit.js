import { XMLParser } from 'fast-xml-parser';

const UA = 'radar-topik/1.0 (personal keyword monitor)';
let token = null;

async function getToken(id, secret) {
  if (token) return token;
  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': UA,
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`Reddit login HTTP ${res.status}`);
  token = (await res.json()).access_token;
  return token;
}

async function searchOAuth(query, id, secret) {
  const t = await getToken(id, secret);
  const res = await fetch(
    `https://oauth.reddit.com/search?q=${encodeURIComponent(query)}&sort=new&t=day&limit=25&raw_json=1`,
    { headers: { authorization: `Bearer ${t}`, 'user-agent': UA } },
  );
  if (!res.ok) throw new Error(`Reddit HTTP ${res.status}`);
  const json = await res.json();
  return json.data.children.map(({ data: p }) => ({
    source: 'reddit',
    id: p.name,
    text: `${p.title}\n${p.selftext ?? ''}`.trim(),
    url: `https://www.reddit.com${p.permalink}`,
    author: `r/${p.subreddit} · u/${p.author}`,
    date: p.created_utc * 1000,
  }));
}

// Tanpa app Reddit: pakai RSS publik (sering diblokir dari server cloud, tapi dicoba saja).
const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
async function searchRss(query) {
  const res = await fetch(
    `https://www.reddit.com/search.rss?q=${encodeURIComponent(query)}&sort=new&t=day&type=link`,
    { headers: { 'user-agent': UA } },
  );
  if (!res.ok) throw new Error(`Reddit RSS HTTP ${res.status} (isi REDDIT_CLIENT_ID/SECRET agar lebih stabil)`);
  const feed = xmlParser.parse(await res.text())?.feed;
  const raw = feed?.entry ?? [];
  return (Array.isArray(raw) ? raw : [raw])
    .filter((e) => String(e.id).startsWith('t3_')) // t3_ = postingan, t5_ = subreddit
    .map((e) => ({
    source: 'reddit',
    id: String(e.id),
    text: String(e.title ?? ''),
    url: String(e.link?.href ?? ''),
    author: String(e.category?.label ?? ''),
    date: Date.parse(e.published ?? e.updated) || Date.now(),
  }));
}

export function searchReddit(query, { clientId, clientSecret } = {}) {
  return clientId && clientSecret ? searchOAuth(query, clientId, clientSecret) : searchRss(query);
}
