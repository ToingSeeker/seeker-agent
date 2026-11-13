// Telegram, through the Bot API with long polling: nothing has to be reachable
// from the internet. In a group the bot answers only when it is mentioned,
// replied to, or given a /command.
const API = 'https://api.telegram.org';
const POLL_SECONDS = 30;
const RETRY_MS = 3000;

export default function telegram({ token, api = API, fetch: request = fetch, log = () => {}, retryMs = RETRY_MS }) {
  let running = false;
  let poll = null;
  let me = { id: 0, username: '' };

  /** One Bot API call. The address holds the token, so errors never quote it. */
  async function call(method, body, signal) {
    let res;
    try {
      res = await request(`${api}/bot${token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}), signal });
    } catch (err) {
      if (signal?.aborted) throw err;
      throw new Error(`Telegram could not be reached (${err.cause?.code ?? err.name})`);
    }
    const data = await res.json().catch(() => ({}));
    if (!data.ok) throw Object.assign(new Error(`Telegram refused ${method}: ${data.description ?? res.status}`), { status: res.status });
    return data.result;
  }

  return {
    limit: 4000,
    async start(onMessage) {
      me = await call('getMe');
      log(`connected as @${me.username}`);
      running = true;
      let offset = 0;
      while (running) {
        poll = new AbortController();
        let updates;
        try {
          updates = await call('getUpdates', { offset, timeout: POLL_SECONDS, allowed_updates: ['message'] }, poll.signal);
        } catch (err) {
          if (!running) break;
          // A wrong token or a second copy polling the same bot does not get better by waiting.
          if (err.status === 401 || err.status === 409) throw err;
          log(err.message);
          await new Promise((resolve) => setTimeout(resolve, retryMs));
          continue;
        }
        for (const update of updates) {
          offset = Math.max(offset, update.update_id + 1);
          const m = update.message;
          if (!m?.text || !m.from || m.from.is_bot) continue;
          let text = m.text;
          if (m.chat.type !== 'private') {
            const mention = new RegExp(`@${me.username}\\b`, 'i');
            const meant = mention.test(text) || m.reply_to_message?.from?.id === me.id || text.startsWith('/');
            if (!meant) continue;
            text = text.replace(mention, '').trim();
          }
          onMessage({ chat: String(m.chat.id), user: String(m.from.id), userName: m.from.username ?? m.from.first_name ?? '', text });
        }
      }
    },
    stop() {
      running = false;
      poll?.abort();
    },
    send: (chat, text) => call('sendMessage', { chat_id: chat, text, link_preview_options: { is_disabled: true } }),
    typing: (chat) => call('sendChatAction', { chat_id: chat, action: 'typing' }),
  };
}
