// Ollama's native API. Its streamed chunk — { message: { content, thinking,
// tool_calls }, done, prompt_eval_count, eval_count, eval_duration } — is also
// the shape every other provider adapter converts its own stream into.
import { HttpError, isConnectionRefused, lines, open, readAll, errorText, requestJson } from './http.mjs';

export { isConnectionRefused };
export const OllamaError = HttpError;

export const version = (host) => requestJson(`${host}/api/version`);

export async function listModels(host) {
  const { models = [] } = await requestJson(`${host}/api/tags`);
  return models.map((m) => ({ name: m.name, size: m.size }));
}

/** Returns e.g. ['completion', 'tools', 'thinking']. */
export async function capabilities(host, model) {
  const info = await requestJson(`${host}/api/show`, { method: 'POST', body: { model } });
  return info.capabilities || [];
}

/** Streams /api/chat, yielding each chunk as Ollama sends it. */
export async function* chatStream({ host, model, messages, tools, think, options, keepAlive, signal }) {
  const body = { model, messages, stream: true, options, keep_alive: keepAlive };
  if (tools?.length) body.tools = tools;
  if (think !== undefined) body.think = think;

  const res = await open(`${host}/api/chat`, { method: 'POST', body, signal });
  if (res.statusCode >= 400) throw new HttpError(errorText(await readAll(res)), res.statusCode);
  for await (const line of lines(res)) {
    const chunk = JSON.parse(line);
    if (chunk.error) throw new HttpError(chunk.error);
    yield chunk;
  }
}
