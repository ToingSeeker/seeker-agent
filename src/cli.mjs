import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { Agent } from './agent.mjs';
import { BUILT_IN, COMMANDS, isSlashCommand, matchCommands, resolveModel, runCommand, runPhoneCommand } from './commands.mjs';
import { Picker } from './picker.mjs';
import { OUTPUT_FORMATS, attachJson } from './json-output.mjs';
import { RemoteDaemon, Workspace, processGone, remoteCredentials, stayAwake } from './remote.mjs';
import { saveImages, startsWithFile } from './images.mjs';
import { TerminalLink, teeUi, terminalId } from './link.mjs';
import { VERSION, loadConfig, normalizeHost, saveConfig } from './config.mjs';
import { Terminal } from './input.mjs';
import { isConnectionRefused, version } from './ollama.mjs';
import { createProvider } from './providers.mjs';
import { Permissions } from './permissions.mjs';
import { Screen } from './screen.mjs';
import { Session } from './session.mjs';
import { McpHub, readServers } from './mcp.mjs';
import { pickList } from './menu.mjs';
import { TOOL_BY_NAME, stopAllProcesses } from './tools.mjs';
import { UI, gitInfo, tildify, truncate } from './ui.mjs';

const USAGE = `SEEKER v${VERSION} — your local coding companion, running on Ollama

Usage:
  seeker                     start an interactive session in this folder
                             (in a message: @file:path  @file:path:10-40  @folder:dir  @diff  @staged  @git:3  @url:https://…)
  seeker "fix the login bug" start with a first message
  seeker -p "explain repo"   answer once and exit (pipeable)
  cat log.txt | seeker -p "what caused this error?"
  seeker remote              let your phone control SEEKER on this machine (see: seeker remote --setup)
  seeker serve               offer SEEKER as an OpenAI-compatible API on this machine (needs SEEKER_API_KEY; --port 8642)
  seeker gateway             answer in Telegram, Discord or Slack (tokens and allow lists in the config: see the README)
  seeker acp                 run as an agent inside an editor that speaks the Agent Client Protocol (Zed, …)
  seeker doctor              check what SEEKER needs on this machine and say how to fix what is missing
  seeker cron tick           run scheduled jobs that are due (for the system scheduler); seeker cron list shows them

Options:
      --provider <id>  where the model runs: ollama, lmstudio, claude-code, anthropic, openai, google,
                       xai, deepseek, mistral, groq, openrouter, … (default: last used)
  -m, --model <name>   model to use on that provider
  -c, --continue       continue the last conversation in this folder
  -p, --print          answer once, no interactive prompt
      --output <fmt>   with -p: text (default), json (one object at the end), stream-json (one per line);
                       --json is short for --output json
      --yolo           do not ask before editing files or running commands (risky ones still ask)
      --full-access    ask about nothing at all: risky commands, files outside the folder, secrets
      --plan           start in plan mode: look and propose, change nothing until /plan go
      --ctx <tokens>   context window for Ollama models (default 32768)
      --no-think       turn thinking mode off
      --no-checkpoints do not snapshot files before changing them (no /rollback)
      --host <url>     Ollama server address
  -v, --version
  -h, --help`;

function parseArgs(argv) {
  const opts = { prompt: [] };
  const value = (i, flag) => {
    if (argv[i + 1] === undefined) throw new Error(`${flag} needs a value`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') opts.help = true;
    else if (a === '-v' || a === '--version') opts.version = true;
    else if (a === '-p' || a === '--print') opts.print = true;
    else if (a === '--json') opts.output = 'json';
    else if (a === '--output') opts.output = value(i++, a);
    else if (a === '-c' || a === '--continue') opts.continue = true;
    else if (a === '--yolo') opts.yolo = true;
    else if (a === '--full-access') opts.fullAccess = true;
    else if (a === '--plan') opts.plan = true;
    else if (a === '--no-think') opts.noThink = true;
    else if (a === '--no-checkpoints') opts.noCheckpoints = true;
    else if (a === '-m' || a === '--model') opts.model = value(i++, a);
    else if (a === '--provider') opts.provider = value(i++, a);
    else if (a === '--setup') opts.setup = true;
    else if (a === '--url') opts.url = value(i++, a);
    else if (a === '--port') opts.port = Number(value(i++, a));
    else if (a === '--ctx') opts.ctx = Number(value(i++, a));
    else if (a === '--host') opts.host = value(i++, a);
    else if (a === '--') {
      opts.prompt.push(...argv.slice(i + 1));
      break;
    } else if (a.startsWith('-') && a.length > 1) throw new Error(`unknown option: ${a}`);
    else opts.prompt.push(a);
  }
  return opts;
}

async function readStdin() {
  let text = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) text += chunk;
  return text.trim();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Makes sure Ollama answers, starting a local server if it is simply not running. */
async function ensureOllama(host, ui) {
  try {
    await version(host);
    return;
  } catch (err) {
    if (!isConnectionRefused(err)) throw err;
  }
  const local = /\/\/(127\.0\.0\.1|localhost)[:/]/.test(`${host}/`);
  if (!local) throw new Error(`Cannot reach Ollama at ${host}`);
  ui.startSpinner('Starting Ollama');
  try {
    const child = spawn('ollama', ['serve'], { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      try {
        await version(host);
        return;
      } catch {}
    }
  } finally {
    ui.stopSpinner();
  }
  throw new Error('Ollama is not running and could not be started. Run `ollama serve` or open the Ollama app, then try again.');
}

/**
 * Asks in the terminal and, while a phone can be reached, on the phone too: whichever answers first decides.
 * @param {Function} here  the terminal's own asker
 */
function eitherAsker(here, { port, term, ui, phone }) {
  return async (request) => {
    if (!port?.linked) return here(request);
    const there = phone(request);
    if (!there) return here(request);
    const first = await Promise.race([here(request).then((answer) => ({ answer, by: 'terminal' })), there.then((answer) => ({ answer, by: 'phone' }))]);
    if (first.by === 'terminal') {
      port.withdraw();
      return first.answer;
    }
    term.cancelWait(); // closes the question still open here
    if (first.answer !== null) ui.toolLine(ui.c.dim(`› answered on the phone: ${first.answer === 'y' ? 'yes' : first.answer === 'a' ? 'always' : first.answer === 'n' ? 'no' : first.answer}`));
    return first.answer;
  };
}

function permissionAsker(ui, term) {
  const { c } = ui;
  const sep = c.dim(' · ');
  return async ({ warning, always }) => {
    if (warning) ui.toolLine(c.yellow(`⚠ ${warning}`));
    const options = [`${c.bold('y')} yes`, always ? `${c.bold('a')} ${always}` : null, `${c.bold('n')} no`].filter(Boolean).join(sep);
    ui.toolLine(`${c.accent('Allow?')}  ${options}${sep}${c.dim('or say what to do instead')}`);
    for (;;) {
      const answer = await term.ask(`Allow?  y = yes${always ? ' · a = always' : ''} · n = no · or type what to do instead`);
      if (answer === null) return null;
      if (!answer) continue;
      ui.toolLine(c.dim(`› ${answer}`));
      const lower = answer.toLowerCase();
      if (['y', 'yes', 'ya', 'iya', 'ok', 'oke'].includes(lower)) return 'y';
      if (['a', 'always', 'selalu'].includes(lower)) return 'a';
      if (['n', 'no', 'tidak', 'g', 'ga', 'gak', 'nggak'].includes(lower)) return 'n';
      return answer;
    }
  };
}

export async function main(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    console.error(`seeker: ${err.message}\n\n${USAGE}`);
    process.exit(2);
  }
  if (opts.help) return console.log(USAGE);
  if (opts.output !== undefined) {
    if (!OUTPUT_FORMATS.includes(opts.output)) throw new Error(`--output is one of: ${OUTPUT_FORMATS.join(', ')}`);
    if (opts.output !== 'text') opts.print = true; // JSON is for a script: there is nobody to type
  }
  if (opts.version) return console.log(VERSION);

  const config = loadConfig();
  if (opts.host) config.host = normalizeHost(opts.host);
  if (opts.ctx) {
    if (!Number.isInteger(opts.ctx) || opts.ctx < 2048) throw new Error('--ctx needs a token count of at least 2048');
    config.numCtx = opts.ctx;
  }
  if (opts.noThink) config.think = false;
  if (opts.noCheckpoints) config.checkpoints = false;
  if (opts.yolo) config.permissionMode = 'auto';
  if (opts.fullAccess) config.permissionMode = 'full';

  if (opts.prompt.length === 1 && opts.prompt[0] === 'doctor') {
    const { diagnose, report } = await import('./doctor.mjs');
    const { colorDepth, terminalPalette } = await import('./theme.mjs');
    const c = terminalPalette(colorDepth(process.env, Boolean(process.stdout.isTTY)));
    const results = await diagnose({ config });
    const paint = (level, text) => ({ ok: c.green, warn: c.yellow, fail: c.red, info: c.dim })[level](text);
    console.log(report(results, paint).join('\n'));
    process.exit(results.some((r) => r.level === 'fail') ? 1 : 0);
  }

  const cronCommand = opts.prompt[0] === 'cron' && ['tick', 'list'].includes(opts.prompt[1]) && opts.prompt.length === 2 ? opts.prompt[1] : null;
  const serve = opts.prompt.length === 1 && opts.prompt[0] === 'serve';
  const gateway = opts.prompt.length === 1 && opts.prompt[0] === 'gateway';
  const acp = opts.prompt.length === 1 && opts.prompt[0] === 'acp';
  const remote = opts.prompt[0] === 'remote';
  if (remote) {
    opts.prompt.shift();
    if (opts.url) {
      let url;
      try {
        url = new URL(opts.url);
      } catch {
        throw new Error('--url needs the address of your relay, e.g. https://seeker-relay.up.railway.app');
      }
      if (url.protocol !== 'https:' && !/^(localhost|127\.0\.0\.1)$/.test(url.hostname)) throw new Error('The relay address must start with https://');
      config.remote = { ...(config.remote ?? {}), url: url.origin };
      saveConfig({ remote: config.remote });
    }
    const creds = remoteCredentials(config);
    if (opts.url && !opts.setup) {
      console.log(`Relay address saved: ${creds.url}\nNext:  seeker remote --setup   (pairs your phone)   ·   seeker remote   (starts it)`);
      return;
    }
    if (opts.setup || !creds.url) {
      const say = (line = '') => console.log(line);
      say('SEEKER remote — control this machine from your phone.\n');
      say('1. Deploy the relay (the folder remote-server/ in the seeker project) and give it this variable:');
      say(`\n     SEEKER_REMOTE_AUTH=${creds.authHash}\n`);
      say('   It only lets the relay recognise your devices; it cannot be used to read or send anything.');
      if (!creds.url) {
        say('\n2. Tell SEEKER where the relay is:   seeker remote --url https://<your-relay-address>');
        say('3. Then run   seeker remote --setup   again for the link to open on your phone.');
        return;
      }
      say(`\n2. Relay: ${creds.url}`);
      say('3. Open this link on your phone (it holds the secret — do not share it):');
      say(`\n     ${creds.phoneLink}\n`);
      if (process.platform === 'darwin') {
        const copy = spawn('pbcopy');
        copy.on('error', () => {});
        copy.stdin.end(creds.phoneLink);
        say('   It is on your clipboard now; with Handoff on, you can paste it on your iPhone.');
      }
      say('4. Start it:   seeker remote   (in the project folder, or: seeker remote ~/project-a ~/project-b)');
      return;
    }
  }

  let prompt = opts.prompt.join(' ').trim();
  const piped = !process.stdin.isTTY;
  // Only a pipe or a redirected file is input to read. Other non-terminals (a socket
  // left open by a parent process, as under an IDE or a job runner) never end.
  let hasInput = false;
  try {
    const stat = fs.fstatSync(0);
    hasInput = stat.isFIFO() || stat.isFile();
  } catch {}
  if (piped && hasInput && !remote && !cronCommand && !serve && !gateway && !acp) {
    const stdin = await readStdin();
    if (stdin) prompt = prompt ? `${prompt}\n\n<stdin>\n${stdin}\n</stdin>` : stdin;
  }
  const print = Boolean(opts.print) || piped || remote || Boolean(cronCommand) || serve || gateway || acp;
  if (print && !prompt && !remote && !cronCommand) {
    console.error('seeker: -p needs a message, e.g. seeker -p "explain this project"');
    process.exit(2);
  }

  const cwd = process.cwd();
  const ui = new UI({ print, showThinking: config.showThinking, animation: config.animation });

  /** Reaches a provider and settles on a model. Throws with a message fit to show the user. */
  const connect = async (id) => {
    const provider = createProvider(id, config);
    if (provider.kind === 'ollama') await ensureOllama(config.host, ui);
    let models;
    try {
      models = await provider.listModels();
    } catch (err) {
      if (isConnectionRefused(err)) throw new Error(`${provider.label} is not running.`);
      throw err;
    }
    if (!models.length) {
      throw new Error(provider.kind === 'ollama' ? 'Ollama has no models yet. Run: ollama pull qwen3.5:27b' : `${provider.label} lists no chat models.`);
    }
    const wanted = opts.model ?? config.providers?.[id]?.model ?? (id === config.provider ? config.model : null) ?? provider.defaultModel;
    let picked = wanted ? resolveModel(wanted, models) : null;
    if (!picked) {
      if (opts.model) throw new Error(`Model "${wanted}" is not available on ${provider.label}.`);
      if (provider.kind !== 'ollama') throw new Error(`No model chosen for ${provider.label} yet. Pass -m <model>, or start seeker and use /model.`);
      if (wanted) ui.warn(`Default model "${wanted}" was not found — using ${models[0].name}.`);
      picked = models[0];
    }
    return { provider, model: picked.name, info: await provider.describe(picked.name) };
  };

  let provider;
  let info;
  try {
    let connected;
    try {
      connected = await connect(opts.provider ?? config.provider);
    } catch (err) {
      // A cloud provider that cannot be reached must not lock the user out of fixing it with /model.
      if (opts.provider || config.provider === 'ollama' || print) throw err;
      ui.warn(`${err.message}\nFalling back to Ollama — use /model to switch back.`);
      connected = await connect('ollama');
    }
    ({ provider, info } = connected);
    config.provider = provider.id;
    config.model = connected.model;
  } catch (err) {
    ui.error(`seeker: ${err.message}`);
    process.exit(1);
  }

  if (acp) {
    // stdout carries the protocol and nothing else; everything for a person goes to stderr.
    const { runAcp } = await import('./acp.mjs');
    await runAcp({ config, info, input: process.stdin, output: process.stdout, log: (line) => console.error(`seeker acp · ${line}`) });
    stopAllProcesses();
    return;
  }

  if (gateway) {
    const { createGateway } = await import('./gateway.mjs');
    const log = (line) => console.error(`${new Date().toTimeString().slice(0, 8)}  ${line}`);
    const hub = new McpHub({ servers: readServers(config, cwd) });
    await hub.connectAll();
    const running = await createGateway({ config, cwd, info, tools: () => hub.tools(), log });
    if (!running) {
      ui.error('seeker: no chat platform is set up.\n  Put a bot token and your own user id in ~/.seeker/config.json, for example:\n  "gateway": { "telegram": { "token": "123:ABC…", "allow": ["123456789"] } }\n  (discord: token + allow · slack: botToken + appToken + allow — see the README)');
      process.exit(1);
    }
    console.error(`SEEKER gateway · ${config.model} via ${provider.label}\n${running.platforms.map((p) => `${p.name} (${p.allow.size} allowed)`).join(' · ')}\nFolder: ${cwd}   ·   every edit and command is asked about in the chat\nCtrl+C stops it.`);
    const stop = () => {
      running.stop();
      stopAllProcesses();
      hub.closeAll();
      setTimeout(() => process.exit(0), 300).unref();
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    await running.start();
    return;
  }

  if (serve) {
    const { DEFAULT_PORT, createApiServer } = await import('./api-server.mjs');
    const key = process.env.SEEKER_API_KEY || config.apiServer?.key;
    const port = opts.port || config.apiServer?.port || DEFAULT_PORT;
    let server;
    try {
      server = createApiServer({ config, key, cwd, info, log: (line) => console.error(`${new Date().toTimeString().slice(0, 8)}  ${line}`) });
    } catch (err) {
      ui.error(`seeker: ${err.message}\n  e.g.  SEEKER_API_KEY=$(openssl rand -hex 24) seeker serve`);
      process.exit(1);
    }
    server.on('error', (err) => {
      ui.error(`seeker: could not listen on port ${port}: ${err.message}`);
      process.exit(1);
    });
    // This machine only: anything else reaching it must be put in front of it deliberately.
    server.listen(port, '127.0.0.1', () => {
      console.error(`SEEKER API · ${config.model} via ${provider.label}\nhttp://127.0.0.1:${port}/v1   (OpenAI-compatible; every request needs the key)\nFolder: ${cwd}   ·   ${config.apiServer?.allowChanges === true ? 'requests MAY edit files and run commands' : 'read-only: requests cannot change files'}   ·   Ctrl+C stops it.`);
    });
    const stop = () => {
      stopAllProcesses();
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 500).unref();
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    return;
  }

  if (cronCommand) {
    const cron = await import('./cron.mjs');
    if (cronCommand === 'list') {
      const jobs = cron.readJobs();
      if (!jobs.length) console.log('No scheduled jobs. Ask SEEKER to schedule one ("every weekday at 9, check the open pull requests").');
      for (const j of jobs) console.log(`${j.id}  ${j.state.padEnd(9)}  ${j.schedule.display.padEnd(22)}  next ${j.next_run_at ?? '—'}  ${j.name}`);
      return;
    }
    const { tick } = await import('./cron-runner.mjs');
    const results = await tick({ config, info, deliver: (r) => console.log(r.error ? `✖ ${r.job.name}: ${r.error}` : r.silent ? `· ${r.job.name}: nothing to report` : `${cron.delivered(r.job, r.reply)}\n`) });
    if (!results.length) console.error('No jobs are due.');
    stopAllProcesses();
    return;
  }

  /** Runs due jobs every minute while this process lives; `deliver` shows a result to the user. */
  const startCron = (deliver) => {
    let running = false;
    const check = async () => {
      if (running) return;
      running = true;
      try {
        const cron = await import('./cron.mjs');
        if (cron.hasJobs()) await (await import('./cron-runner.mjs')).tick({ config, deliver: (r) => deliver(r, cron) });
      } catch {
      } finally {
        running = false;
      }
    };
    setTimeout(check, 5000).unref();
    setInterval(check, 60_000).unref();
  };

  if (remote) {
    const log = (line) => console.error(`${new Date().toTimeString().slice(0, 8)}  ${line}`);
    // Started by /restart: the one it replaces is still stopping, and holds the relay and the terminal link until it has.
    const replaces = Number(process.env.SEEKER_REPLACES);
    delete process.env.SEEKER_REPLACES;
    if (replaces) {
      log(`restarting: waiting for seeker remote ${replaces} to stop`);
      if (!(await processGone(replaces))) {
        log(`seeker remote ${replaces} did not stop, so this one does not start`);
        process.exit(1);
      }
    }
    const hub = new McpHub({ servers: readServers(config, cwd) });
    await hub.connectAll();
    // One agent per project folder. Approval follows the setting, which the phone can change too;
    // risky commands and files outside the folder are asked about either way.
    const build = async (folder, remoteUi, asker, current) => {
      const agent = new Agent({ config, ui: remoteUi, permissions: new Permissions({ mode: config.permissionMode, cwd: folder, ask: asker, autoLearn: config.autoLearn, daemonPid: process.pid }), provider: createProvider(config.provider, config), info: current, cwd: folder });
      agent.setExtraTools(hub.tools());
      agent.session = new Session(folder);
      return { agent, session: agent.session };
    };
    const named = opts.prompt.length ? opts.prompt : (config.remote.workspaces ?? []);
    const folders = [...new Set(named.length ? named : [cwd])];
    const daemon = new RemoteDaemon({ config, folders, build, info, log });
    const quit = async () => {
      log('stopping');
      await daemon.stop();
      stopAllProcesses();
      await hub.closeAll();
      process.exit(0);
    };
    daemon.quit = quit;
    process.on('SIGINT', quit);
    process.on('SIGTERM', quit);
    stayAwake();
    startCron((r, cron) => {
      if (r.silent) return;
      log(`cron · ${r.job.name}: ${r.error ? `failed (${r.error})` : 'done'}`);
      daemon.notify?.({ title: `Scheduled: ${r.job.name}`, body: (r.error ?? r.reply).replace(/\s+/g, ' ').slice(0, 160), tag: `cron-${r.job.id}` });
    });
    console.error(`SEEKER remote · ${config.model} via ${provider.label}\nrelay  ${config.remote.url}\nTo pair a phone: seeker remote --setup   ·   Ctrl+C stops it.\n`);
    try {
      await daemon.start();
    } catch (err) {
      ui.error(`seeker: ${err.message}`);
      process.exit(1);
    }
    return;
  }

  const screen = print ? null : new Screen({ header: (width) => ui.headerRows(width, { ready: agent.caps.tools, provider: agent.provider }), colors: ui.c });
  const term = print ? null : new Terminal(ui, screen);
  // An interactive session also shows on the phone while `seeker remote` runs on this machine:
  // `mirror` is the copy the phone sees, `port` the way to the daemon. With no daemon, both stay idle.
  const port = term ? new TerminalLink({ info }) : null;
  const mirror = port ? new Workspace(port, cwd, { id: terminalId(cwd), terminal: true }) : null;
  let phoneAsker = null;
  const permissions = new Permissions({ mode: config.permissionMode, cwd, ask: term ? eitherAsker(permissionAsker(ui, term), { port, term, ui, phone: (request) => phoneAsker?.(request) }) : null , autoLearn: config.autoLearn });
  if (opts.plan) permissions.planning = true;
  const agent = new Agent({ config, ui: mirror ? teeUi(ui, mirror.ui) : ui, permissions, provider, info, cwd });
  const session = new Session(cwd);
  agent.session = session;
  if (port) {
    // A conversation picked up here (-c, /resume) may still be open on the phone; the daemon closes that copy.
    const load = session.load.bind(session);
    session.load = (file) => {
      const messages = load(file);
      if (messages) port.claim(session.file);
      return messages;
    };
  }
  // A one-shot run exits as soon as it has answered; there is no quiet moment to learn in.
  agent.allowReview = !print;
  if (mirror) {
    port.build = async (_cwd, _ui, asker) => ((phoneAsker = asker), { agent, session });
    await mirror.open();
  }
  // Extra tools from MCP servers; they join the agent's tool list as each server comes up.
  const hub = new McpHub({ servers: readServers(config, cwd), onChange: (tools) => agent.setExtraTools(tools) });
  const reportServers = () => {
    for (const s of hub.status()) {
      if (s.status === 'ready') ui.notice(`  MCP · ${s.name} ready (${s.tools} tools)`);
      else if (s.status === 'failed') ui.warn(`  MCP · ${s.name} could not start: ${s.error}`);
      else if (s.status === 'untrusted') ui.notice(`  MCP · ${s.name} comes from this project and was not started. Review it with /mcp.`);
    }
  };

  if (opts.continue) {
    const previous = session.loadLatest();
    if (previous) agent.messages = previous;
    else ui.notice('No saved conversation in this folder yet — starting a new one.');
  }

  if (print) {
    // For a script: the answer and what was done as JSON on stdout, the readable activity still on stderr.
    const finish = opts.output && opts.output !== 'text' ? attachJson(ui, { stream: opts.output === 'stream-json', meta: { model: agent.model, provider: agent.provider.id, cwd } }) : null;
    if (!agent.caps.tools) ui.warn(`⚠ ${config.model} cannot call tools.`);
    process.on('SIGINT', () => {
      agent.interrupt();
      process.exitCode = 130;
    });
    if (!agent.provider.ownTools) {
      await hub.connectAll();
      for (const s of hub.status()) if (s.status === 'failed') ui.warn(`MCP · ${s.name} could not start: ${s.error}`);
    }
    await agent.runTurn(prompt, { references: true });
    if (finish && !finish(agent).ok && !process.exitCode) process.exitCode = 1;
    session.save(agent.messages, agent.model);
    stopAllProcesses();
    await hub.closeAll();
    return;
  }

  const { c } = ui;
  process.stdout.write(`\x1b]0;seeker — ${tildify(cwd)}\x07`);
  screen.setFooter({
    idle: 'Seeker is working… press Ctrl+C to cancel',
    hints: (width, exitArmed) => ui.hintBar(width, exitArmed),
    status: (width) =>
      ui.statusBar(width, {
        model: agent.model,
        cwd,
        used: agent.contextTokens(),
        limit: agent.contextLimit(),
        provider: agent.provider,
        tokensPerSecond: agent.lastStats?.tokensPerSecond,
        yolo: permissions.mode === 'auto',
        full: permissions.mode === 'full',
        plan: permissions.planning,
      }),
  });
  ui.attach(screen);
  screen.start();
  ui.startMascot();
  // The panel reads the agent at every paint, so /model and a growing conversation show up in it.
  const git = gitInfo(cwd);
  ui.welcome(() => ({
    cwd,
    model: agent.model,
    limit: agent.contextLimit(),
    provider: agent.provider,
    used: agent.contextTokens(),
    git,
    instructionFiles: agent.instructionFiles,
    skillCount: agent.skills.length,
    yolo: permissions.mode === 'auto',
    full: permissions.mode === 'full',
  }));
  if (!agent.caps.tools) ui.warn(`  ⚠ ${config.model} cannot call tools — it can only chat. Switch with /model.`);
  if (opts.continue && agent.messages.length) ui.notice(`  Continuing the previous conversation (${agent.messages.length} messages).`);

  const exit = () => {
    port.close();
    session.save(agent.messages, agent.model);
    agent.shellHooks?.run('on_session_end').catch(() => {});
    mods.unloadAll();
    stopAllProcesses();
    hub.closeAll();
    ui.stopSpinner();
    ui.stopMascot();
    screen.close();
    term.restore();
    process.stdout.write(`${c.dim('Goodbye.')}\n`);
    process.exit(0);
  };

  // The model's own questions to the user: a short list to choose from, or a typed answer.
  // `other: false` when only the options will do (SEEKER's own questions): no typed answer is offered.
  agent.hooks.askUser = async ({ question, options, other = true }) => {
    ui.toolLine(c.accent(question));
    if (options.length) {
      const items = [...options.map((label) => ({ label })), ...(other ? [{ label: 'Something else…', hint: 'type your own answer' }] : [])];
      const at = await pickList({ term, ui, title: question, items });
      if (at === -1) return null;
      if (at < options.length) {
        ui.toolLine(c.dim(`› ${options[at]}`));
        return options[at];
      }
    }
    const answer = await term.ask('Type your answer');
    if (answer) ui.toolLine(c.dim(`› ${answer}`));
    return answer || null;
  };

  // Housekeeping that must not delay the prompt: retire skills nobody uses, drop old snapshots.
  setTimeout(async () => {
    try {
      const report = (await import('./skill-manage.mjs')).curateIfDue();
      if (report?.archived.length) ui.notice(`  Curator: archived ${report.archived.length} unused skill${report.archived.length > 1 ? 's' : ''} SEEKER had written (${report.archived.join(', ')}). They are in ~/.seeker/skills/.archive.`);
      (await import('./checkpoints.mjs')).prune();
    } catch {}
  }, 3000).unref();

  // Scheduled jobs run while this session is open; a result is shown as soon as it is in.
  startCron((r, cron) => {
    if (r.error) ui.warn(`  ⏰ Scheduled job "${r.job.name}" failed: ${r.error}`);
    else if (!r.silent) ui.notice(`\n${cron.delivered(r.job, r.reply).split('\n').map((l) => `  ${l}`).join('\n')}\n  (saved to ${r.file})`);
  });
  agent.hooks.cronRun = async (id) => (await import('./cron-runner.mjs')).runNow(id, { config, info: agent.info });

  // The user's shell hooks, if any are configured.
  let shellHooks = null;
  if (Object.keys(config.hooks ?? {}).length) {
    const { Hooks } = await import('./hooks.mjs');
    shellHooks = new Hooks({ config, cwd, sessionId: session.file, warn: (text) => ui.warn(`  ⚠ ${text}`) });
    const waiting = shellHooks.unapproved.length;
    if (waiting) ui.notice(`  ${waiting} shell hook${waiting > 1 ? 's are' : ' is'} configured but not approved yet, so ${waiting > 1 ? 'they do' : 'it does'} not run. Review with /hooks.`);
  }
  // The user's mods (mods.mjs): approved ones load now; one approved later in /mods joins at once.
  const { Mods, chainHooks } = await import('./mods.mjs');
  const mods = new Mods({
    ui,
    cwd,
    info: () => ({ model: agent.model, provider: agent.provider.id }),
    refresh: () => screen.render(),
    height: () => screen.height,
    reserved: new Set([...BUILT_IN, ...COMMANDS.map(([name]) => name.slice(1))]),
  });
  const { crewRows } = await import('./crew.mjs');
  screen.setFooter({ panel: (width) => [...crewRows(agent, width, ui.c), ...mods.panelRows(width)], band: (width) => mods.bandRows(width) });
  // The helpers' panel moves with them, and the phone's copy of it too.
  agent.onCrew = () => {
    screen.render();
    mirror?.crewChanged();
  };
  {
    const report = await mods.loadAll();
    if (report.loaded.length) ui.notice(`  Mods on: ${report.loaded.join(', ')}`);
    if (report.waiting.length) ui.notice(`  ${report.waiting.length} mod${report.waiting.length > 1 ? 's are' : ' is'} not approved yet, so ${report.waiting.length > 1 ? 'they do' : 'it does'} not run (${report.waiting.join(', ')}). Review with /mods.`);
    for (const f of report.failed) ui.warn(`  ⚠ mod ${f.name} did not start: ${f.error}`);
  }
  agent.shellHooks = chainHooks(shellHooks, mods);
  // When SEEKER stops to ask, a hook or mod of the user's may want to say so (a sound, a notification).
  permissions.onAsk = (tool, args, warning) => agent.shellHooks.run('on_approval_request', { toolName: tool.name, extra: { summary: String(TOOL_BY_NAME.get(tool.name)?.summary?.(args) ?? args?.command ?? args?.url ?? '').slice(0, 500), warning: warning ?? null } }).catch(() => {});
  agent.shellHooks.run('on_session_start').catch(() => {});

  // Servers start in the background so the prompt is usable at once.
  if (!agent.provider.ownTools) hub.connectAll().then(reportServers);

  // Outside a prompt the only key that matters is Ctrl+C, which stops the agent.
  term.onInterrupt = () => {
    if (agent.busy) mirror.stop();
  };

  // Runs the turn and saves the conversation, keeping the phone's copy in step.
  // `typed` is set for what the user wrote themself: only that text has its @ references expanded.
  const turn = (text, { images = [], typed = false } = {}) => mirror.run(text, images, { references: typed });

  // From the phone. A picture by itself goes into the message being typed here, as a path, the way
  // a dragged file would; a message with words is a turn of its own, if the terminal is free for one.
  port.onStop = () => agent.busy && mirror.stop();
  port.onStopHelper = (id) => agent.stopHelper(id);
  port.onMessage = ({ text, images, locked }) => {
    if (!text) {
      if (!images.length) return;
      let files;
      try {
        files = saveImages(images);
      } catch (err) {
        return port.toast(`The picture could not be saved on your Mac: ${err.message}`);
      }
      term.typeIn(`${files.map((f) => (/\s/.test(f) ? `"${f}"` : f)).join(' ')} `);
      const what = images.length > 1 ? `${images.length} pictures are` : 'The picture is';
      return port.toast(term.reading ? `${what} in the message being typed in the terminal.` : `${what} waiting in the terminal's message box.`);
    }
    // A phone may be lost or borrowed: work that runs without asking is taken only from one behind its app lock.
    if (permissions.mode !== 'ask' && !locked) return port.toast(`This terminal session runs without asking (${permissions.mode === 'full' ? '--full-access' : '--yolo'}). Turn on the app lock (Settings → App lock) to give it tasks from the phone.`);
    if (agent.busy || !term.inject({ text, images })) port.toast(`${mirror.name} is busy in the terminal. Send it again when it has finished.`);
  };
  port.onHandoff = ({ name, busy, items }) => {
    if (busy) {
      // Both copies would write the same file: this one goes on in a file of its own instead.
      session.startNew();
      return ui.warn(`  ${name} is still at work on your phone, so it keeps its copy of this conversation. This one is saved separately; run seeker -c again once the phone has finished to pick up its last steps.`);
    }
    mirror.items = items;
    ui.notice(`  The phone's copy of this conversation was closed. It continues here, and the phone follows it as a terminal session.`);
  };
  port.start(() => ({ ...mirror.meta(), items: mirror.items }));

  // /goal, /loop and /heartbeat: made on first use, polled only while one of them is waiting for its time.
  let autonomy = null;
  let poll = null;
  const getAutonomy = async () => {
    if (!autonomy) {
      const { Autonomy } = await import('./autonomy.mjs');
      autonomy = new Autonomy({ ask: (system, user) => agent.ask(system, user), config });
    }
    return autonomy;
  };
  const watchSchedule = () => {
    if (autonomy?.active && !poll) {
      // Wakes the waiting prompt when something is due and nothing is being typed.
      poll = setInterval(() => {
        if (!autonomy.active) {
          clearInterval(poll);
          poll = null;
        } else if (!agent.busy && autonomy.hasDue()) term.wake();
      }, 2000);
      poll.unref();
    }
  };
  const lastReply = () => [...agent.messages].reverse().find((m) => m.role === 'assistant')?.content ?? '';
  /** After a message: while a goal is active, a judge decides whether SEEKER carries on by itself. */
  const pursueGoal = async () => {
    while (autonomy?.goal?.status === 'active' && !autonomy.goal.parkedUntil) {
      ui.startSpinner('Checking the goal', undefined, 'purple');
      const next = await autonomy.afterTurn({ interrupted: agent.interrupted, response: lastReply() }).finally(() => ui.stopSpinner());
      for (const line of next.lines) ui.notice(`  ${line}`);
      if (!next.prompt) break;
      ui.userEcho(next.label);
      await turn(next.prompt);
    }
    watchSchedule();
  };
  /** Runs whatever /loop, /heartbeat or a parked goal has due. */
  const runDue = async () => {
    const due = autonomy?.takeDue();
    if (!due) return;
    ui.userEcho(due.label);
    if (due.prompt.startsWith('/')) {
      const result = await runCommand(due.prompt, { agent, ui, term, config, permissions, session, hub, mods, autonomy: getAutonomy }).catch((err) => ui.error(`  ${err.message}`));
      if (result?.prompt) await turn(result.prompt);
    } else await turn(due.prompt);
    if (due.kind === 'loop') for (const line of await autonomy.completeLoopTick({ interrupted: agent.interrupted, response: due.prompt.startsWith('/') ? '' : lastReply() })) ui.notice(`  ${line}`);
    if (due.kind === 'goal') await pursueGoal();
    watchSchedule();
  };

  // The commands that match what is typed, in a list the arrow keys move through.
  const picker = new Picker((text) => matchCommands(text, agent.skills, mods.commands()));
  const suggest = ({ rows, selected, index, total, above, below }) => {
    if (!total) return [];
    const wide = Math.min(28, Math.max(12, ...rows.map(([name]) => name.length)));
    const lines = rows.map(([name, description], i) => {
      const label = truncate(name, wide).padEnd(wide);
      const about = truncate(description ?? '', Math.max(10, ui.cols() - wide - 6));
      return i === selected ? `${c.accent('›')} ${c.bold(c.accent(label))} ${about}` : `  ${c.accent(label)} ${c.dim(about)}`;
    });
    const more = [above && `↑ ${above} more`, below && `↓ ${below} more`].filter(Boolean).join(' · ');
    lines.push(c.dim(`  ${index + 1}/${total}${more ? ` · ${more}` : ''} · ↑↓ choose · Tab complete · Enter run · Esc close`));
    return lines;
  };
  const complete = (text) => {
    const [first] = matchCommands(text, agent.skills, mods.commands());
    return first && first[0] !== text ? `${first[0]} ` : null;
  };

  if (prompt) {
    ui.userEcho(prompt);
    await turn(prompt, { typed: true });
  }


  for (;;) {
    ui.ensureNewline();
    const input = await term.readInput({ placeholder: 'Ask Seeker to build, fix, or explore…', suggest, complete, picker });
    if (input === null) break;
    if (typeof input === 'object') {
      // Sent from the phone: never a `!` shell line. A /command or /skill runs as it would typed here, minus
      // what needs this terminal (a picker) or must not come from a phone (runPhoneCommand says which).
      if (!input.images.length && isSlashCommand(input.text)) {
        ui.userEcho(input.text);
        mirror.ui.user(input.text);
        let result;
        try {
          // agent.ui reaches both screens, so the phone sees what the command printed.
          result = await runPhoneCommand(input.text, { agent, ui: agent.ui, term: null, config, permissions, session, hub, mods, autonomy: getAutonomy, terminal: true, choose: (list) => mirror.ui.choose(list) });
        } catch (err) {
          agent.ui.warn(`  ${err.message}`);
          continue;
        }
        if (result?.prompt) {
          await mirror.run(result.prompt, [], { references: false, echo: false });
          await pursueGoal();
        }
        watchSchedule();
        continue;
      }
      const pictures = input.images.length ? `\n[${input.images.length} image${input.images.length > 1 ? 's' : ''} from the phone]` : '';
      ui.userEcho(`${input.text}${pictures}`);
      await turn(input.text, { images: input.images, typed: true });
      continue;
    }
    const text = input.trim();
    if (!text) {
      await runDue();
      continue;
    }
    // Files dragged in are shown by their short names, as they were in the box; the model gets the paths.
    ui.userEcho(term.shownAs(input).trim());

    if (text.startsWith('!')) {
      const result = await TOOL_BY_NAME.get('bash').run({ command: text.slice(1) }, { cwd, state: {} }).catch((e) => ({ output: e.message }));
      ui.line(result.output);
      continue;
    }
    // A path dragged in from the file manager also starts with a slash; it is a message, not a command.
    if (text.startsWith('/') && !startsWithFile(text, cwd)) {
      let result;
      try {
        result = await runCommand(text, { agent, ui, term, config, permissions, session, hub, mods, autonomy: getAutonomy });
      } catch (err) {
        ui.error(`  ${err.message}`);
        continue;
      }
      if (result === 'exit') break;
      if (result?.prompt) await turn(result.prompt);
      if (result?.prompt) await pursueGoal();
      watchSchedule();
      continue;
    }
    await turn(text, { typed: true });
    await pursueGoal();
  }
  exit();
}
