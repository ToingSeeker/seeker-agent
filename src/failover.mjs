// What to do when a model request fails: try another API key for the same
// provider, wait and retry, or move to a backup provider.
//
// Config:
//   "fallback": [{ "provider": "openrouter", "model": "anthropic/claude-sonnet-5.5" }, { "provider": "ollama", "model": "qwen3.5:27b" }]
//   "providers": { "openai": { "apiKeys": ["sk-a…", "sk-b…"], "keyStrategy": "fill_first" } }

// How long a key is left alone after the service turned it away.
const COOLDOWN_MS = {
  rate_limit: 60 * 60 * 1000, // 429
  billing: 60 * 60 * 1000, // 402
  auth: 5 * 60 * 1000, // 401/403
};
// The only key of a provider is never benched for long: there is nothing else to use.
const SOLE_KEY_COOLDOWN_MS = 60 * 1000;
// A wait the service asks for is honoured up to this long.
const MAX_RETRY_AFTER_MS = 600 * 1000;
export const MAX_RETRIES = 3;

/**
 * Sorts a failed request into what can be done about it.
 *   rate_limit  the service is throttling this key          → other key, else wait, else fallback
 *   billing     the account is out of credit                → other key, else fallback
 *   auth        the key is rejected                         → other key, else fallback
 *   overloaded  the service is busy or down (5xx, 529)      → retry, then fallback
 *   network     no answer at all (refused, reset, timeout)  → retry, then fallback
 *   not_found   that model does not exist there             → fallback
 *   fatal       the request itself is wrong (400, too long) → nothing helps; show it
 */
export function classify(err) {
  const status = err?.status ?? err?.statusCode ?? null;
  const text = `${err?.message ?? ''} ${err?.code ?? ''}`.toLowerCase();
  if (status === 429 || /rate.?limit|too many requests|quota exceeded|resource.?exhausted/.test(text)) {
    // Some services report an empty wallet as a rate limit.
    return /insufficient.?(quota|credit|balance|funds)|billing|payment required|exceeded your current quota/.test(text) ? 'billing' : 'rate_limit';
  }
  if (status === 402 || /insufficient.?(quota|credit|balance|funds)|payment required/.test(text)) return 'billing';
  if (status === 401 || status === 403 || /invalid.?api.?key|incorrect api key|unauthori[sz]ed|api key was rejected/.test(text)) return 'auth';
  if (status === 404 || /model.{0,40}(not found|does not exist|not available)|no such model/.test(text)) return 'not_found';
  if (status === 529 || (status >= 500 && status <= 599) || /overloaded|service unavailable|bad gateway|gateway timeout|internal server error/.test(text)) return 'overloaded';
  const code = err?.code ?? err?.cause?.code ?? err?.errors?.[0]?.code;
  if (['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT'].includes(code)) return 'network';
  if (/could not connect|socket hang up|network|timed? ?out|fetch failed|is not running/.test(text)) return 'network';
  return 'fatal';
}

/** Seconds the service asked us to wait, read from its error text ("try again in 12.5s", "retry after 30"). */
export function retryAfterMs(err) {
  const header = err?.retryAfter ?? err?.headers?.['retry-after'];
  if (header && /^\d+(\.\d+)?$/.test(String(header))) return Math.min(MAX_RETRY_AFTER_MS, Number(header) * 1000);
  const m = /(?:try again|retry) (?:in|after)\s+(\d+(?:\.\d+)?)\s*(ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)?\b/i.exec(err?.message ?? '');
  if (!m) return null;
  const n = Number(m[1]);
  const unit = (m[2] ?? 's').toLowerCase();
  const ms = unit === 'ms' ? n : unit.startsWith('h') ? n * 3_600_000 : unit.startsWith('m') ? n * 60_000 : n * 1000;
  return Math.min(MAX_RETRY_AFTER_MS, ms);
}

/** min(2s × 2^attempt, 60s) plus up to half of that again, so parallel sessions do not retry in step. */
export function backoffMs(attempt) {
  const delay = Math.min(2000 * 2 ** attempt, 60_000);
  return delay + Math.floor(Math.random() * delay * 0.5);
}

/**
 * The API keys of one provider, handed out one at a time. A key the service turned away
 * rests for a while and the next one takes over.
 */
export class KeyPool {
  /** @param {string[]} keys  @param {'fill_first'|'round_robin'|'least_used'|'random'} strategy */
  constructor(keys, strategy = 'fill_first', now = () => Date.now()) {
    this.keys = [...new Set(keys.filter((k) => typeof k === 'string' && k.trim()))].map((key) => ({ key, restingUntil: 0, reason: null, used: 0 }));
    this.strategy = strategy;
    this.now = now;
    this.cursor = 0;
    this.current = null;
  }

  get size() {
    return this.keys.length;
  }

  #available() {
    return this.keys.filter((k) => k.restingUntil <= this.now());
  }

  /** The key to use for the next request, or null when every key is resting. */
  pick() {
    const free = this.#available();
    if (!free.length) return null;
    let chosen;
    if (this.strategy === 'round_robin') {
      chosen = free[this.cursor++ % free.length];
    } else if (this.strategy === 'least_used') {
      chosen = free.reduce((a, b) => (b.used < a.used ? b : a));
    } else if (this.strategy === 'random') {
      chosen = free[Math.floor(Math.random() * free.length)];
    } else {
      // fill_first: stay on one key until it is turned away.
      chosen = this.current && free.includes(this.current) ? this.current : free[0];
    }
    chosen.used++;
    this.current = chosen;
    return chosen.key;
  }

  /** The key in use, without counting a request against it; picks one if none is in use. */
  active() {
    if (this.current && this.current.restingUntil <= this.now()) return this.current.key;
    const free = this.#available();
    if (!free.length) return null;
    this.current = free[0];
    return this.current.key;
  }

  /** Rests the key that was just used. Returns true if another key is ready to take over. */
  rest(kind, err) {
    if (!this.current || !COOLDOWN_MS[kind]) return false;
    const asked = kind === 'rate_limit' ? retryAfterMs(err) : null;
    const sole = this.keys.length === 1 && kind !== 'billing';
    this.current.restingUntil = this.now() + (asked ?? (sole ? SOLE_KEY_COOLDOWN_MS : COOLDOWN_MS[kind]));
    this.current.reason = kind;
    this.current = null;
    return this.#available().length > 0;
  }

  /** For /status: how many keys there are and how many are resting. */
  summary() {
    const resting = this.keys.length - this.#available().length;
    return { total: this.keys.length, resting };
  }
}

/** The keys set for a provider: the environment variable first, then `apiKey`, then `apiKeys`. */
export function keysFor(def, config) {
  const entry = config.providers?.[def.id] ?? {};
  const fromEnv = def.env && process.env[def.env] ? [process.env[def.env]] : [];
  return [...fromEnv, ...(entry.apiKey ? [entry.apiKey] : []), ...(Array.isArray(entry.apiKeys) ? entry.apiKeys : [])];
}

/** The backup chain from config, with entries that cannot work removed. */
export function fallbackChain(config) {
  const list = Array.isArray(config.fallback) ? config.fallback : config.fallback ? [config.fallback] : [];
  return list.filter((f) => f && typeof f.provider === 'string' && typeof f.model === 'string' && f.provider && f.model).map((f) => ({ provider: f.provider, model: f.model }));
}

/**
 * Decides the next move after a failed request.
 * @param {object} state
 * @param {Error}  state.err
 * @param {number} state.attempt     retries already made on this provider for this request
 * @param {KeyPool|null} state.pool  the current provider's keys
 * @param {boolean} state.hasFallback  a backup provider is still untried
 * @returns {{ action: 'rotate'|'retry'|'fallback'|'fail', kind: string, delayMs?: number }}
 */
export function decide({ err, attempt, pool, hasFallback, local = false }) {
  const kind = classify(err);
  if (kind === 'fatal') return { action: 'fail', kind };
  if (kind === 'rate_limit' || kind === 'billing' || kind === 'auth') {
    // A first 429 on a pooled key is retried once: a burst limit often clears within seconds.
    if (kind === 'rate_limit' && pool?.size > 1 && attempt === 0) return { action: 'retry', kind, delayMs: retryAfterMs(err) ?? backoffMs(0) };
    if (pool?.size > 1 && pool.rest(kind, err)) return { action: 'rotate', kind };
    // No other key: move to a backup at once rather than wait on a throttled or empty account.
    if (hasFallback) return { action: 'fallback', kind };
    // One key, no backup: a short throttle is worth waiting out; an empty wallet or a bad key is not.
    const wait = kind === 'rate_limit' ? (retryAfterMs(err) ?? backoffMs(attempt)) : null;
    if (wait !== null && wait <= 60_000 && attempt < MAX_RETRIES) return { action: 'retry', kind, delayMs: wait };
    return { action: 'fail', kind };
  }
  if (kind === 'not_found') return hasFallback ? { action: 'fallback', kind } : { action: 'fail', kind };
  // A model server on this machine that answers with an error is not busy with other people's requests:
  // the same request fails the same way, so it is reported at once instead of being waited on.
  if (kind === 'overloaded' && local) return hasFallback ? { action: 'fallback', kind } : { action: 'fail', kind };
  // overloaded / network: a busy service is left for a backup after two tries, the rest after three.
  const tries = hasFallback ? 2 : MAX_RETRIES;
  if (attempt < tries) return { action: 'retry', kind, delayMs: backoffMs(attempt) };
  return hasFallback ? { action: 'fallback', kind } : { action: 'fail', kind };
}

const REASON = {
  rate_limit: 'is rate limited',
  billing: 'is out of credit',
  auth: 'rejected the API key',
  overloaded: 'is overloaded or down',
  network: 'cannot be reached',
  not_found: 'does not have that model',
};
export const reasonText = (kind) => REASON[kind] ?? 'failed';
