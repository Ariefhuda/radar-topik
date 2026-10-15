import { readFileSync, writeFileSync } from 'node:fs';

const FILE = new URL('../data/state.json', import.meta.url);
const SEEN_TTL = 14 * 24 * 3600 * 1000;
const DIGEST_MAX = 150;

export function loadState() {
  let s = {};
  try {
    s = JSON.parse(readFileSync(FILE, 'utf8'));
  } catch {}
  return {
    topics: (s.topics ?? []).map((t) => ({ mode: 'instant', ...t })),
    accounts: s.accounts ?? [],
    channels: s.channels ?? [],
    seen: s.seen ?? {},
    digest: s.digest ?? [],
    lastDigest: s.lastDigest ?? '',
    threadsCursor: s.threadsCursor ?? 0,
    trending: s.trending ?? { on: true, last: '' },
    telegramOffset: s.telegramOffset ?? 0,
    errors: s.errors ?? {},
  };
}

export function saveState(state) {
  const cutoff = Date.now() - SEEN_TTL;
  for (const [k, t] of Object.entries(state.seen)) if (t < cutoff) delete state.seen[k];
  state.digest = state.digest.slice(-DIGEST_MAX);
  delete state.digestNow;
  delete state.trendingNow;
  writeFileSync(FILE, JSON.stringify(state, null, 2) + '\n');
}
