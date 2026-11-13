// Drives each provider adapter against a scripted stand-in for the real service.
import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { DEFAULTS } from '../src/config.mjs';
import { createProvider, needsKey, providerDefs, toClaudeMessages, toOpenAIMessages } from '../src/providers.mjs';
import { TOOL_BY_NAME, toolSpecs, validateArgs } from '../src/tools.mjs';

async function server(handler) {
  const requests = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const request = { method: req.method, url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null };
      requests.push(request);
      handler(request, res);
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${srv.address().port}`, requests, close: () => srv.close() };
}

const sse = (res, events) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.end(events.map((e) => (typeof e === 'string' ? `data: ${e}\n\n` : `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)).join(''));
};

const collect = async (stream) => {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
};

const history = [
  { role: 'user', content: 'read it' },
  { role: 'assistant', content: 'ok', tool_calls: [{ id: 'c1', function: { name: 'read_file', arguments: { path: 'a.js' } } }, { id: 'c2', function: { name: 'bash', arguments: { command: 'ls' } } }] },
  { role: 'tool', tool_name: 'read_file', tool_call_id: 'c1', content: 'file body' },
  { role: 'tool', tool_name: 'bash', tool_call_id: 'c2', content: 'Error: boom' },
  { role: 'user', content: 'next' },
];

test('history converts to the OpenAI shape', () => {
  const out = toOpenAIMessages('SYS', history);
  assert.deepEqual(out[0], { role: 'system', content: 'SYS' });
  assert.deepEqual(out[2].tool_calls[0], { id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.js"}' } });
  assert.deepEqual(out[3], { role: 'tool', tool_call_id: 'c1', content: 'file body' });
  assert.equal(toOpenAIMessages('S', [{ role: 'assistant', content: '', tool_calls: [{ id: 'x', function: { name: 'bash', arguments: {} } }] }])[1].content, null);
});

test('history converts to the Claude shape, with tool results grouped in one user turn', () => {
  const out = toClaudeMessages(history);
  assert.deepEqual(out.map((m) => m.role), ['user', 'assistant', 'user', 'user']);
  assert.deepEqual(out[1].content, [
    { type: 'text', text: 'ok' },
    { type: 'tool_use', id: 'c1', name: 'read_file', input: { path: 'a.js' } },
    { type: 'tool_use', id: 'c2', name: 'bash', input: { command: 'ls' } },
  ]);
  assert.deepEqual(out[2].content, [
    { type: 'tool_result', tool_use_id: 'c1', content: 'file body' },
    { type: 'tool_result', tool_use_id: 'c2', content: 'Error: boom', is_error: true },
  ]);
  // Claude's own reply goes back verbatim, thinking blocks included.
  const blocks = [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'text', text: 'hi' }];
  assert.equal(toClaudeMessages([{ role: 'assistant', content: 'hi', blocks }])[0].content, blocks);
  assert.deepEqual(toClaudeMessages([{ role: 'assistant', content: '' }]), [], 'an empty assistant turn is dropped');
});

test('OpenAI-compatible provider: lists chat models and streams text, reasoning and fragmented tool calls', async () => {
  const fake = await server((req, res) => {
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'zeta-chat', context_length: 64000 }, { id: 'text-embedding-3' }, { id: 'alpha-chat' }, { id: 'whisper-1' }] }));
    }
    sse(res, [
      JSON.stringify({ choices: [{ delta: { reasoning_content: 'hmm' } }] }),
      JSON.stringify({ choices: [{ delta: { content: 'Hel' } }] }),
      JSON.stringify({ choices: [{ delta: { content: 'lo' } }] }),
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_9', function: { name: 'read_file', arguments: '{"pa' } }] } }] }),
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"a.js"}' } }] } }] }),
      JSON.stringify({ choices: [], usage: { prompt_tokens: 120, completion_tokens: 30 } }),
      '[DONE]',
    ]);
  });
  const config = { ...DEFAULTS, providers: { mine: { baseUrl: `${fake.url}/v1`, apiKey: 'sk-test' } } };
  const provider = createProvider('mine', config);

  assert.deepEqual(await provider.listModels(), [{ name: 'alpha-chat', context: null }, { name: 'zeta-chat', context: 64000 }]);
  assert.deepEqual(await provider.describe('zeta-chat'), { tools: true, thinking: false, vision: true, context: 64000 });

  const chunks = await collect(provider.chat({ model: 'zeta-chat', system: 'SYS', messages: history, tools: toolSpecs() }));
  fake.close();
  assert.deepEqual(chunks.slice(0, 3).map((c) => c.message), [{ thinking: 'hmm' }, { content: 'Hel' }, { content: 'lo' }]);
  const last = chunks.at(-1);
  assert.deepEqual(last.message.tool_calls, [{ id: 'call_9', function: { name: 'read_file', arguments: { path: 'a.js' } } }]);
  assert.equal(last.done, true);
  assert.equal(last.prompt_eval_count, 120);
  assert.equal(last.eval_count, 30);

  const sent = fake.requests.at(-1);
  assert.equal(sent.url, '/v1/chat/completions');
  assert.equal(sent.headers.authorization, 'Bearer sk-test');
  assert.equal(sent.body.messages[0].role, 'system');
  assert.equal(sent.body.tools[0].type, 'function');
});

test('OpenAI-compatible provider: a rejected key is reported with a hint, and the usage option is dropped if refused', async () => {
  let calls = 0;
  const fake = await server((req, res) => {
    if (req.url.endsWith('/models')) {
      res.writeHead(401, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'Incorrect API key provided' } }));
    }
    if (calls++ === 0) {
      res.writeHead(400, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'Unrecognized request argument: stream_options' } }));
    }
    sse(res, [JSON.stringify({ choices: [{ delta: { content: 'ok' } }] }), '[DONE]']);
  });
  const provider = createProvider('mine', { ...DEFAULTS, providers: { mine: { baseUrl: fake.url } } });
  await assert.rejects(provider.listModels(), /mine: Incorrect API key provided — check the API key/);
  const chunks = await collect(provider.chat({ model: 'm', system: 's', messages: [{ role: 'user', content: 'hi' }] }));
  fake.close();
  assert.equal(chunks[0].message.content, 'ok');
  assert.equal(fake.requests.at(-1).body.stream_options, undefined);
});

test('Claude provider: streams through the SDK, asks for summarised thinking and refusal fallback, returns blocks for replay', async () => {
  const meta = { id: 'claude-opus-5-5', type: 'model', display_name: 'Claude Opus 5.5', max_input_tokens: 1000000, max_tokens: 128000, capabilities: { thinking: { supported: true, types: { adaptive: { supported: true } } } } };
  const fake = await server((req, res) => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(meta));
    }
    sse(res, [
      { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: meta.id, content: [], stop_reason: null, usage: { input_tokens: 50, cache_read_input_tokens: 150, output_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'plan' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Reading.' } },
      { type: 'content_block_stop', index: 1 },
      { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: {} } },
      { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"path":' } },
      { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '"a.js"}' } },
      { type: 'content_block_stop', index: 2 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 40 } },
      { type: 'message_stop' },
    ]);
  });
  const config = { ...DEFAULTS, providers: { anthropic: { apiKey: 'sk-ant-test', baseUrl: fake.url } } };
  const provider = createProvider('anthropic', config);

  assert.deepEqual(await provider.describe('claude-opus-5-5'), { tools: true, thinking: true, vision: true, context: 1000000 });
  const chunks = await collect(provider.chat({ model: 'claude-opus-5-5', system: 'SYS', messages: history, tools: toolSpecs() }));
  fake.close();

  assert.deepEqual(chunks.slice(0, 2).map((c) => c.message), [{ thinking: 'plan' }, { content: 'Reading.' }]);
  const last = chunks.at(-1);
  assert.deepEqual(last.message.tool_calls, [{ id: 'toolu_1', function: { name: 'read_file', arguments: { path: 'a.js' } } }]);
  assert.deepEqual(last.message.blocks.map((b) => b.type), ['thinking', 'text', 'tool_use']);
  assert.equal(last.message.blocks[0].signature, 'sig');
  assert.equal(last.prompt_eval_count, 200);
  assert.equal(last.eval_count, 40);

  const sent = fake.requests.at(-1);
  assert.match(sent.url, /^\/v1\/messages/);
  // Which header carries the credential is the SDK's business; it only has to arrive.
  assert.match(`${sent.headers['x-api-key']} ${sent.headers.authorization}`, /sk-ant-test/);
  assert.match(sent.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
  assert.equal(sent.body.fallbacks, 'default');
  assert.deepEqual(sent.body.thinking, { type: 'adaptive', display: 'summarized' });
  assert.equal(sent.body.max_tokens, 64000);
  assert.equal(sent.body.system, 'SYS');
  assert.equal(sent.body.stream, true);
  assert.equal(sent.body.tools[0].eager_input_streaming, true);
  assert.ok(sent.body.tools[0].input_schema && !sent.body.tools[0].function);
  assert.equal(sent.body.messages[2].content[1].is_error, true);
});

test('Claude provider: a refusal and a tool call cut off at the output limit are errors, not actions', async () => {
  const meta = { id: 'claude-haiku-4-5', type: 'model', max_input_tokens: 200000, max_tokens: 64000, capabilities: { thinking: { supported: true, types: { adaptive: { supported: false } } } } };
  const replies = [
    [
      { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: meta.id, content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } },
      { type: 'message_delta', delta: { stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber' } }, usage: { output_tokens: 0 } },
      { type: 'message_stop' },
    ],
    [
      { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: meta.id, content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_2', name: 'write_file', input: {} } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"path":"a.js"}' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: 64000 } },
      { type: 'message_stop' },
    ],
  ];
  const fake = await server((req, res) => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(meta));
    }
    sse(res, replies.shift());
  });
  const provider = createProvider('anthropic', { ...DEFAULTS, providers: { anthropic: { apiKey: 'k', baseUrl: fake.url } } });
  const ask = () => collect(provider.chat({ model: 'claude-haiku-4-5', system: 's', messages: [{ role: 'user', content: 'x' }], tools: toolSpecs() }));
  await assert.rejects(ask(), /Claude declined this request/);
  await assert.rejects(ask(), /output limit in the middle of a tool call/);
  fake.close();
  // This older model has no adaptive thinking and no server-side fallback, so neither is sent.
  assert.equal(fake.requests.at(-1).body.thinking, undefined);
  assert.equal(fake.requests.at(-1).body.fallbacks, undefined);
});

test('tool arguments are checked against the schema before anything runs', () => {
  const write = TOOL_BY_NAME.get('write_file');
  assert.equal(validateArgs(write, { path: 'a', content: 'x' }), null);
  assert.equal(validateArgs(write, { file_path: 'a', content: 'x' }), null, 'the path alias is accepted');
  assert.equal(validateArgs(write, { path: 'a' }), 'missing required argument: content');
  assert.equal(validateArgs(write, { path: 'a', content: 5 }), 'argument "content" must be string');
  assert.equal(validateArgs(write, { INVALID_JSON: '{"pa' }), 'the arguments were not valid JSON');
  assert.equal(validateArgs(write, 'nope'), 'arguments must be a JSON object');
  assert.equal(validateArgs(TOOL_BY_NAME.get('read_file'), { path: 'a', offset: '10' }), null, 'numbers sent as text are tolerated');
});

test('provider registry: custom entries, key lookup and who needs a key', () => {
  const config = { ...DEFAULTS, providers: { openai: { apiKey: 'sk' }, work: { baseUrl: 'http://localhost:9000/v1' } } };
  const defs = providerDefs(config);
  const by = (id) => defs.find((d) => d.id === id);
  assert.ok(defs.length >= 16 && by('work').custom && by('work').local);
  assert.equal(needsKey(by('ollama'), config), false);
  assert.equal(needsKey(by('openai'), config), false);
  assert.equal(needsKey(by('groq'), { ...config, providers: {} }) || Boolean(process.env.GROQ_API_KEY), true);
  assert.equal(needsKey(by('anthropic'), config), false, 'Claude may sign in without a stored key');
  assert.throws(() => createProvider('nope', config), /Unknown provider "nope"/);
});

test('Claude Code provider: runs as a full agent, reports its tool activity and asks before acting', async () => {
  const { claudeCodeProvider } = await import('../src/claude-code.mjs');
  const calls = [];
  // A stand-in for the Agent SDK's query(): records what it was given and plays a scripted turn.
  const query = ({ prompt, options }) => {
    calls.push({ prompt, options });
    return (async function* () {
      const delta = (d) => ({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_delta', index: 0, delta: d } });
      yield { type: 'system', subtype: 'init', session_id: 'sess-1' };
      if (options.resume) {
        yield delta({ type: 'text_delta', text: 'Second answer.' });
        yield { type: 'result', subtype: 'success', is_error: false, session_id: 'sess-1', usage: { input_tokens: 5, output_tokens: 5 } };
        return;
      }
      yield delta({ type: 'thinking_delta', thinking: 'hm' });
      yield delta({ type: 'text_delta', text: 'Fixing it.' });
      const edit = { type: 'tool_use', id: 'toolu_1', name: 'Edit', input: { file_path: 'calc.js', old_string: 'a', new_string: 'b' } };
      yield { type: 'assistant', parent_tool_use_id: null, message: { content: [edit], usage: { input_tokens: 10, cache_read_input_tokens: 190, output_tokens: 30 } } };
      const verdict = await options.canUseTool('Edit', edit.input, { toolUseID: 'toolu_1', signal: new AbortController().signal });
      yield { type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', is_error: verdict.behavior !== 'allow', content: verdict.behavior === 'allow' ? 'updated' : verdict.message }] } };
      // What a sub-agent does is not shown as the main agent's own activity.
      yield { type: 'assistant', parent_tool_use_id: 'toolu_9', message: { content: [{ type: 'tool_use', id: 'sub', name: 'Bash', input: {} }] } };
      yield delta({ type: 'text_delta', text: ' Done.' });
      yield { type: 'result', subtype: 'success', is_error: false, session_id: 'sess-1', usage: { input_tokens: 400, output_tokens: 60 } };
    })();
  };
  const def = { id: 'claude-code', label: 'Claude Code', kind: 'claude-code', context: 200000, ownTools: true };
  const provider = claudeCodeProvider(def, { ...DEFAULTS, providers: {} }, { query });

  const asked = [];
  const hooks = { permission: async (request) => (asked.push(request), { ok: true }) };
  const messages = [{ role: 'user', content: 'fix the bug' }];
  const first = await collect(provider.chat({ model: 'opus', system: 'NOTES', messages, hooks, cwd: '/work' }));

  assert.deepEqual(first.map((c) => c.activity?.kind ?? Object.keys(c.message)[0] ?? 'done'), ['thinking', 'content', 'start', 'end', 'content', 'done']);
  assert.deepEqual(first[2].activity, { kind: 'start', id: 'toolu_1', name: 'Edit', input: { file_path: 'calc.js', old_string: 'a', new_string: 'b' } });
  assert.deepEqual(first[3].activity, { kind: 'end', id: 'toolu_1', ok: true, output: 'updated' });
  assert.deepEqual(asked, [{ id: 'toolu_1', name: 'Edit', input: { file_path: 'calc.js', old_string: 'a', new_string: 'b' } }]);
  assert.equal(first.at(-1).prompt_eval_count, 200, "context size is the last model call's, not the turn's running total");

  const { options } = calls[0];
  assert.equal(calls[0].prompt, 'fix the bug');
  assert.equal(options.cwd, '/work');
  assert.equal(options.model, 'opus');
  assert.deepEqual(options.systemPrompt, { type: 'preset', preset: 'claude_code', append: 'NOTES' });
  assert.equal(options.tools, undefined, "Claude Code's own tools are left on");
  assert.equal(options.disallowedTools, undefined);
  assert.equal(options.permissionMode, undefined, 'approvals are never bypassed');
  assert.deepEqual(options.settingSources, []);
  assert.equal(options.resume, undefined);

  // The next message continues the same session and sends only what is new.
  messages.push({ role: 'assistant', content: 'Fixing it. Done.' }, { role: 'user', content: 'thanks, now test it' });
  const second = await collect(provider.chat({ model: 'opus', system: 'NOTES', messages, hooks, cwd: '/work' }));
  assert.equal(second[0].message.content, 'Second answer.');
  assert.equal(calls[1].options.resume, 'sess-1');
  assert.equal(calls[1].prompt, 'thanks, now test it');

  // A declined action is passed back to Claude Code as a refusal, with the user's words.
  const declined = claudeCodeProvider(def, { ...DEFAULTS, providers: {} }, { query });
  const out = await collect(declined.chat({ model: 'opus', system: 'NOTES', messages: [{ role: 'user', content: 'x' }], hooks: { permission: async () => ({ ok: false, reason: 'The user declined' }) } }));
  assert.deepEqual(out.find((c) => c.activity?.kind === 'end').activity, { kind: 'end', id: 'toolu_1', ok: false, output: 'The user declined' });

  // A history that no longer matches the session (after /compact or /clear) starts a new one.
  await collect(provider.chat({ model: 'opus', system: 'NOTES', messages: [{ role: 'user', content: 'summary' }, { role: 'assistant', content: 'ok' }, { role: 'user', content: 'go on' }], hooks }));
  assert.equal(calls.at(-1).options.resume, undefined);
  assert.match(calls.at(-1).prompt, /already under way[\s\S]*<user>\nsummary\n<\/user>[\s\S]*<assistant>\nok\n<\/assistant>[\s\S]*<user>\ngo on\n<\/user>/);
});

test('Claude Code tools are described for display and classified for approval', async () => {
  const { describeExternal } = await import('../src/external-tools.mjs');
  assert.equal(describeExternal('Read', { file_path: 'a.js' }).risk, undefined, 'reading needs no approval');
  assert.equal(describeExternal('Read', { file_path: 'a.js' }).note('1\n2\n'), '2 lines');
  const edit = describeExternal('Edit', { file_path: 'a.js', old_string: 'x\ny', new_string: 'z' });
  assert.deepEqual([edit.risk, edit.path, edit.diff.removed, edit.diff.added], ['write', 'a.js', ['x', 'y'], ['z']]);
  assert.deepEqual([describeExternal('Bash', { command: 'npm test' }).risk, describeExternal('Bash', { command: 'npm test' }).command], ['exec', 'npm test']);
  assert.equal(describeExternal('WebFetch', { url: 'https://x.dev' }).risk, 'net');
  assert.equal(describeExternal('mcp__db__query', { sql: 'select 1' }).risk, 'other', 'anything unknown is asked about');
  assert.equal(describeExternal('TodoWrite', { todos: [{ content: 'a', status: 'completed' }] }).display(''), '☑ a');
});

test('permissions: a provider tool with no specific rule is asked about, then allowed by name', async () => {
  const { Permissions } = await import('../src/permissions.mjs');
  let asked = 0;
  const perms = new Permissions({ mode: 'ask', cwd: '/w', ask: async (q) => (asked++, q.always ? 'a' : 'y') });
  const tool = { name: 'WebSearch', risk: 'other' };
  assert.ok((await perms.check(tool, {})).ok);
  assert.ok((await perms.check(tool, {})).ok);
  assert.equal(asked, 1);
  assert.equal((await new Permissions({ mode: 'ask', cwd: '/w', ask: null }).check(tool, {})).ok, false);
});
