// Minimal streaming HTTP on node:http. fetch is avoided for model requests
// because it gives up after 5 minutes without response headers, and a cold
// local model with a long prompt can take longer than that to produce a token.
import http from 'node:http';
import https from 'node:https';

export class HttpError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export function isConnectionRefused(err) {
  return err?.code === 'ECONNREFUSED' || err?.errors?.some?.((e) => e.code === 'ECONNREFUSED');
}

/** Resolves with the response once headers arrive; the body is still streaming. */
export function open(url, { method = 'GET', body, headers = {}, signal } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const all = data ? { 'content-type': 'application/json', 'content-length': data.length, ...headers } : headers;
    const req = lib.request(u, { method, signal, headers: all }, resolve);
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

export async function readAll(res) {
  res.setEncoding('utf8');
  let text = '';
  for await (const chunk of res) text += chunk;
  return text;
}

/** Pulls a readable message out of the error bodies the various APIs send. */
export function errorText(text) {
  try {
    let body = JSON.parse(text);
    if (Array.isArray(body)) body = body[0];
    const error = body?.error ?? body;
    return (typeof error === 'string' ? error : (error?.message ?? error?.detail)) || text;
  } catch {
    return text.trim().slice(0, 300) || 'empty response';
  }
}

export async function requestJson(url, opts) {
  const res = await open(url, opts);
  const text = await readAll(res);
  if (res.statusCode >= 400) throw new HttpError(errorText(text), res.statusCode);
  return JSON.parse(text);
}

/** Yields each complete line of a streaming response. */
export async function* lines(res) {
  res.setEncoding('utf8');
  let buffer = '';
  for await (const part of res) {
    buffer += part;
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) yield line;
    }
  }
  if (buffer.trim()) yield buffer.trim();
}
