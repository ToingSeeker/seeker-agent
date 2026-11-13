// Slack, in Socket Mode: events arrive over a WebSocket that the app token
// opens, so no public address is needed; replies go out through the Web API
// with the bot token. The bot answers direct messages, and in a channel only
// when it is mentioned.
import { keptSocket } from './socket.mjs';

const API = 'https://slack.com/api';

export default function slack({ botToken, appToken, api = API, fetch: request = fetch, WebSocket, log = () => {}, reconnectMs }) {
  let me = '';
  let onMessage = () => {};

  async function call(method, token, body) {
    let res;
    try {
      res = await request(`${api}/${method}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(body ?? {}) });
    } catch (err) {
      throw new Error(`Slack could not be reached (${err.cause?.code ?? err.name})`);
    }
    const data = await res.json().catch(() => ({}));
    if (!data.ok) throw new Error(`Slack refused ${method}: ${data.error ?? res.status}`);
    return data;
  }

  const socket = keptSocket({
    WebSocket,
    log,
    reconnectMs,
    address: async () => {
      me ||= (await call('auth.test', botToken)).user_id;
      return (await call('apps.connections.open', appToken)).url;
    },
    onMessage: (data, send, reconnect) => {
      if (data.type === 'hello') return log('connected');
      if (data.type === 'disconnect') return reconnect();
      // Every event is acknowledged, or Slack sends it again.
      if (data.envelope_id) send({ envelope_id: data.envelope_id });
      const event = data.type === 'events_api' ? data.payload?.event : null;
      if (!event?.text || !event.user || event.bot_id || event.subtype) return;
      // A mention in a channel arrives as app_mention; plain channel messages are not for the bot.
      const direct = event.type === 'message' && event.channel_type === 'im';
      if (!direct && event.type !== 'app_mention') return;
      onMessage({ chat: String(event.channel), user: String(event.user), text: event.text.replace(new RegExp(`<@${me}>`, 'g'), '').trim() });
    },
  });

  return {
    limit: 3500,
    start(handler) {
      onMessage = handler;
      return socket.run();
    },
    stop: () => socket.stop(),
    send: (chat, text) => call('chat.postMessage', botToken, { channel: chat, text, unfurl_links: false }),
  };
}
