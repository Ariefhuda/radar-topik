import * as cheerio from 'cheerio';

export function parseTrending(html) {
  const $ = cheerio.load(html);
  return $('article.Box-row')
    .map((_, el) => {
      const r = $(el);
      const path = (r.find('h2 a').attr('href') || '').replace(/^\//, '');
      return {
        repo: path,
        url: `https://github.com/${path}`,
        desc: r.find('p').first().text().trim().replace(/\s+/g, ' '),
        lang: r.find('[itemprop=programmingLanguage]').text().trim(),
        stars: r.find('a[href$="/stargazers"]').first().text().trim(),
        today: (r.find('span.float-sm-right').text().match(/[\d.,]+/) || [''])[0],
      };
    })
    .get()
    .filter((x) => x.repo);
}

export async function fetchTrending(since = 'daily') {
  const res = await fetch(`https://github.com/trending?since=${since}`, { headers: { 'user-agent': 'Mozilla/5.0 radar-topik' } });
  if (!res.ok) throw new Error(`GitHub Trending HTTP ${res.status}`);
  return parseTrending(await res.text());
}
