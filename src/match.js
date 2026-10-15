// Topik ditulis seperti: "vps gratis -jual -sewa"
// Kata biasa harus ada semua, kata berawalan "-" tidak boleh ada.

export function normalize(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');
}

export function parseTopic(raw) {
  const words = normalize(raw).split(/\s+/).filter(Boolean);
  return {
    include: words.filter((w) => !w.startsWith('-')),
    exclude: words.filter((w) => w.startsWith('-') && w.length > 1).map((w) => w.slice(1)),
  };
}

// Kata kunci yang dikirim ke mesin pencari platform (tanpa kata pengecualian).
export function searchQuery(raw) {
  return parseTopic(raw).include.join(' ');
}

export function hasExcluded(text, raw) {
  const t = normalize(text);
  return parseTopic(raw).exclude.some((w) => t.includes(w));
}

export function matches(text, raw) {
  const t = normalize(text);
  const { include } = parseTopic(raw);
  return include.length > 0 && include.every((w) => t.includes(w)) && !hasExcluded(text, raw);
}
