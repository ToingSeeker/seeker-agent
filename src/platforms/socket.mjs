// A WebSocket that is opened again whenever it closes, for the chat platforms
// that deliver messages over one (Discord, Slack). Node's own WebSocket is used.
const RECONNECT_MS = 5000;

/**
 * @param {object} opts
 * @param {() => Promise<string>} opts.address      where to connect; asked again for every connection
 * @param {(data: object, send: (data: object) => void, reconnect: () => void) => void} opts.onMessage
 * @param {() => void} [opts.onClose]
 * @param {(line: string) => void} [opts.log]
 * @returns {{ run: () => Promise<void>, stop: () => void }} run() resolves after stop(), and rejects when no address can be had at the start
 */
export function keptSocket({ address, onMessage, onClose = () => {}, log = () => {}, WebSocket: Socket = globalThis.WebSocket, reconnectMs = RECONNECT_MS }) {
  let running = false;
  let socket = null;
  let wake = null;

  const once = (url) =>
    new Promise((resolve) => {
      socket = new Socket(url);
      const send = (data) => socket.readyState === 1 && socket.send(JSON.stringify(data));
      const reconnect = () => socket.close();
      socket.addEventListener('message', (event) => {
        let data;
        try {
          data = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
        } catch {
          return;
        }
        onMessage(data, send, reconnect);
      });
      socket.addEventListener('error', () => {});
      socket.addEventListener('close', () => {
        onClose();
        resolve();
      });
    });

  return {
    async run() {
      running = true;
      let first = true;
      while (running) {
        let url;
        try {
          url = await address();
        } catch (err) {
          if (first) throw err;
          log(err.message);
        }
        first = false;
        if (url) await once(url);
        if (!running) break;
        log('connection lost — connecting again');
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, reconnectMs);
          wake = () => (clearTimeout(timer), resolve());
        });
      }
    },
    stop() {
      running = false;
      wake?.();
      socket?.close();
    },
  };
}
