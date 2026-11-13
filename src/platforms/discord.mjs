// Discord, through its gateway WebSocket (messages in) and REST API (messages
// out). The bot answers direct messages, and in a server only when it is
// mentioned — which is also why it needs no privileged "message content" intent.
import { keptSocket } from './socket.mjs';

const API = 'https://discord.com/api/v10';
// GUILDS | GUILD_MESSAGES | DIRECT_MESSAGES
const INTENTS = (1 << 0) | (1 << 9) | (1 << 12);

export default function discord({ token, api = API, fetch: request = fetch, WebSocket, log = () => {}, reconnectMs }) {
  let me = '';
  let beat = null;
  let sequence = null;
  let onMessage = () => {};

  async function call(method, path, body) {
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await request(`${api}${path}`, { method, headers: { authorization: `Bot ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      } catch (err) {
        throw new Error(`Discord could not be reached (${err.cause?.code ?? err.name})`);
      }
      const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
      // Told to slow down: wait as long as asked, once.
      if (res.status === 429 && attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(10_000, Math.ceil((Number(data.retry_after) || 1) * 1000))));
        continue;
      }
      if (!res.ok) throw Object.assign(new Error(`Discord refused ${method} ${path.replace(/\d{5,}/g, '…')}: ${data.message ?? res.status}`), { status: res.status });
      return data;
    }
  }

  const socket = keptSocket({
    WebSocket,
    log,
    reconnectMs,
    address: async () => `${(await call('GET', '/gateway/bot')).url}/?v=10&encoding=json`,
    onClose: () => clearInterval(beat),
    onMessage: ({ op, t, s, d }, send, reconnect) => {
      if (s != null) sequence = s;
      if (op === 10) {
        // Hello: keep the connection alive, then say who we are.
        clearInterval(beat);
        beat = setInterval(() => send({ op: 1, d: sequence }), d.heartbeat_interval);
        beat.unref?.();
        send({ op: 2, d: { token, intents: INTENTS, properties: { os: process.platform, browser: 'seeker', device: 'seeker' } } });
      } else if (op === 1) send({ op: 1, d: sequence });
      else if (op === 7 || op === 9) reconnect();
      else if (op === 0 && t === 'READY') {
        me = d.user.id;
        log(`connected as ${d.user.username}`);
      } else if (op === 0 && t === 'MESSAGE_CREATE') {
        if (!d.author || d.author.bot || !d.content) return;
        const mention = new RegExp(`<@!?${me}>`, 'g');
        if (d.guild_id && !mention.test(d.content)) return;
        onMessage({ chat: String(d.channel_id), user: String(d.author.id), userName: d.author.username ?? '', text: d.content.replace(mention, '').trim() });
      }
    },
  });

  return {
    limit: 1900,
    start(handler) {
      onMessage = handler;
      return socket.run();
    },
    stop() {
      clearInterval(beat);
      socket.stop();
    },
    send: (chat, text) => call('POST', `/channels/${chat}/messages`, { content: text, allowed_mentions: { parse: [] } }),
    typing: (chat) => call('POST', `/channels/${chat}/typing`),
  };
}
