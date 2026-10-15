// Topik ditulis seperti: "vps|server gratis|free -jual -sewa"
// - Kata dipisah spasi = semuanya wajib ada.
// - Kata dipisah "|" = salah satu saja cukup (vps ATAU server).
// - Kata berawalan "-" = postingan yang memuat kata itu diabaikan.

export function normalize(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');
}

export function parseTopic(raw) {
  const words = normalize(raw).split(/\s+/).filter(Boolean);
  return {
    groups: words
      .filter((w) => !w.startsWith('-'))
      .map((w) => w.split('|').filter(Boolean))
      .filter((g) => g.length),
    exclude: words.filter((w) => w.startsWith('-') && w.length > 1).map((w) => w.slice(1)),
  };
}

// Untuk Google News & Reddit yang mengerti OR: "(vps OR server) (gratis OR free)".
export function booleanQuery(raw) {
  return parseTopic(raw)
    .groups.map((g) => (g.length > 1 ? `(${g.join(' OR ')})` : g[0]))
    .join(' ');
}

// Threads tidak mengerti OR, jadi dipecah jadi kombinasi: "vps gratis", "server gratis", ...
export function queryCombos(raw, max = 6) {
  let combos = [[]];
  for (const g of parseTopic(raw).groups) {
    combos = combos.flatMap((c) => g.map((w) => [...c, w]));
    if (combos.length > max * 4) combos = combos.slice(0, max * 4);
  }
  return combos.slice(0, max).map((c) => c.join(' ')).filter(Boolean);
}

export function hasExcluded(text, raw) {
  const t = normalize(text);
  return parseTopic(raw).exclude.some((w) => t.includes(w));
}

export function matches(text, raw) {
  const t = normalize(text);
  const { groups } = parseTopic(raw);
  return groups.length > 0 && groups.every((g) => g.some((w) => t.includes(w))) && !hasExcluded(text, raw);
}

// Spam judi online & sejenisnya dibuang untuk semua topik.
const SPAM = /slot ?gacor|\bgacor\b|\bjudi\b|\btogel\b|\bcasino\b|\bmaxwin\b|\bscatter\b|\bjackpot\b|\w*bet\d+|#\w*bet\b|\brm ?\d+\b|link alternatif|\bdepo(sit)? \d+/i;
export const isSpam = (text) => SPAM.test(text || '');

// Penanda di notifikasi.
const URGENT = /kuota terbatas|slot terbatas|terbatas|hari ini|deadline|batas akhir|ditutup|segera|buruan|limited|first come|siapa cepat|tinggal \d+|hanya \d+ (orang|slot)/i;
const SCAM = [
  [/\.apk\b/i, 'ada file .apk'],
  [/\b(kode )?otp\b|kode verifikasi|\bpin\b/i, 'menyebut OTP/PIN'],
  [/biaya (admin|administrasi|pendaftaran|pencairan)/i, 'minta biaya admin/pendaftaran'],
  [/transfer (dulu|terlebih dahulu)|deposit/i, 'minta transfer/deposit'],
];

export function badges(text) {
  const t = text || '';
  return {
    urgent: URGENT.test(t),
    warnings: SCAM.filter(([re]) => re.test(t)).map(([, why]) => why),
  };
}
