import { readFileSync, writeFileSync } from 'node:fs';

const FILE = new URL('../data/state.json', import.meta.url);
const SEEN_TTL = 14 * 24 * 3600 * 1000;

export function loadState() {
  let s = {};
  try {
    s = JSON.parse(readFileSync(FILE, 'utf8'));
  } catch {}
  return {
    topics: s.topics ?? [],
    channels: s.channels ?? [],
    seen: s.seen ?? {},
    telegramOffset: s.telegramOffset ?? 0,
    errors: s.errors ?? {},
  };
}

export function saveState(state) {
  const cutoff = Date.now() - SEEN_TTL;
  for (const [k, t] of Object.entries(state.seen)) if (t < cutoff) delete state.seen[k];
  writeFileSync(FILE, JSON.stringify(state, null, 2) + '\n');
}
