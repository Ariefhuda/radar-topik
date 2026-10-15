const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function createBot(token) {
  async function api(method, body) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.ok) return json.result;
      if (json.error_code === 429) {
        await sleep(((json.parameters?.retry_after ?? 3) + 1) * 1000);
        continue;
      }
      throw new Error(`Telegram ${method}: ${json.description}`);
    }
    throw new Error(`Telegram ${method}: terlalu banyak percobaan`);
  }

  return {
    getUpdates: (offset) => api('getUpdates', { offset, timeout: 0, allowed_updates: ['message'] }),
    async send(chatId, html, { preview = true } = {}) {
      await api('sendMessage', { chat_id: chatId, text: html, parse_mode: 'HTML', link_preview_options: { is_disabled: !preview } });
      await sleep(1100); // batas Telegram ±1 pesan/detik per chat
    },
  };
}
