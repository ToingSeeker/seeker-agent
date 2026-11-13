import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { Agent } from './agent.mjs';
import { matchCommands, resolveModel, runCommand } from './commands.mjs';
import { RemoteDaemon, remoteCredentials, stayAwake } from './remote.mjs';
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
  seeker cron tick           run scheduled jobs that are due (for the system scheduler); seeker cron list shows them

Options:
      --provider <id>  where the model runs: ollama, lmstudio, claude-code, anthropic, openai, google,
                       xai, deepseek, mistral, groq, openrouter, … (default: last used)
  -m, --model <name>   model to use on that provider
  -c, --continue       continue the last conversation in this folder
  -p, --print          answer once, no interactive prompt
      --yolo           do not ask before editing files or running commands
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
    else if (a === '-c' || a === '--continue') opts.continue = true;
    else if (a === '--yolo') opts.yolo = true;
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

  const cronCommand = opts.prompt[0] === 'cron' && ['tick', 'list'].includes(opts.prompt[1]) && opts.prompt.length === 2 ? opts.prompt[1] : null;
  const serve = opts.prompt.length === 1 && opts.prompt[0] === 'serve';
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
  if (piped && hasInput && !remote && !cronCommand && !serve) {
    const stdin = await readStdin();
    if (stdin) prompt = prompt ? `${prompt}\n\n<stdin>\n${stdin}\n</stdin>` : stdin;
  }
  const print = Boolean(opts.print) || piped || remote || Boolean(cronCommand) || serve;
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
    const hub = new McpHub({ servers: readServers(config, cwd) });
    await hub.connectAll();
    // One agent per project folder. Approval is always asked for here: a phone may be lost or
    // borrowed, so "run without asking" is never available remotely.
    const build = async (folder, remoteUi, asker, current) => {
      const agent = new Agent({ config, ui: remoteUi, permissions: new Permissions({ mode: 'ask', cwd: folder, ask: asker, autoLearn: config.autoLearn }), provider: createProvider(config.provider, config), info: current, cwd: folder });
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
  const permissions = new Permissions({ mode: config.permissionMode, cwd, ask: term ? permissionAsker(ui, term) : null, autoLearn: config.autoLearn });
  const agent = new Agent({ config, ui, permissions, provider, info, cwd });
  const session = new Session(cwd);
  agent.session = session;
  // A one-shot run exits as soon as it has answered; there is no quiet moment to learn in.
  agent.allowReview = !print;
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
      }),
  });
  ui.attach(screen);
  screen.start();
  ui.startMascot();
  ui.welcome({
    cwd,
    model: config.model,
    limit: agent.contextLimit(),
    provider: agent.provider,
    used: agent.contextTokens(),
    git: gitInfo(cwd),
    instructionFiles: agent.instructionFiles,
    skillCount: agent.skills.length,
    yolo: permissions.mode === 'auto',
  });
  if (!agent.caps.tools) ui.warn(`  ⚠ ${config.model} cannot call tools — it can only chat. Switch with /model.`);
  if (opts.continue && agent.messages.length) ui.notice(`  Continuing the previous conversation (${agent.messages.length} messages).`);

  const exit = () => {
    session.save(agent.messages, agent.model);
    agent.shellHooks?.run('on_session_end').catch(() => {});
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
  agent.hooks.askUser = async ({ question, options }) => {
    ui.toolLine(c.accent(question));
    if (options.length) {
      const items = [...options.map((label) => ({ label })), { label: 'Something else…', hint: 'type your own answer' }];
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
  if (Object.keys(config.hooks ?? {}).length) {
    const { Hooks } = await import('./hooks.mjs');
    agent.shellHooks = new Hooks({ config, cwd, sessionId: session.file, warn: (text) => ui.warn(`  ⚠ ${text}`) });
    const waiting = agent.shellHooks.unapproved.length;
    if (waiting) ui.notice(`  ${waiting} shell hook${waiting > 1 ? 's are' : ' is'} configured but not approved yet, so ${waiting > 1 ? 'they do' : 'it does'} not run. Review with /hooks.`);
    agent.shellHooks.run('on_session_start').catch(() => {});
  }

  // Servers start in the background so the prompt is usable at once.
  if (!agent.provider.ownTools) hub.connectAll().then(reportServers);

  // Outside a prompt the only key that matters is Ctrl+C, which stops the agent.
  term.onInterrupt = () => {
    if (agent.busy) agent.interrupt();
  };

  // `typed` is set for what the user typed themself: only that text has its @ references expanded.
  const turn = async (text, typed = false) => {
    await agent.runTurn(text, { references: typed });
    session.save(agent.messages, agent.model);
  };

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
      ui.startSpinner('Checking the goal');
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
      const result = await runCommand(due.prompt, { agent, ui, term, config, permissions, session, hub, autonomy: getAutonomy }).catch((err) => ui.error(`  ${err.message}`));
      if (result?.prompt) await turn(result.prompt);
    } else await turn(due.prompt);
    if (due.kind === 'loop') for (const line of await autonomy.completeLoopTick({ interrupted: agent.interrupted, response: due.prompt.startsWith('/') ? '' : lastReply() })) ui.notice(`  ${line}`);
    if (due.kind === 'goal') await pursueGoal();
    watchSchedule();
  };

  const suggest = (text) =>
    matchCommands(text, agent.skills)
      .slice(0, 6)
      .map(([name, description]) => `  ${c.accent(name.padEnd(12))} ${c.dim(truncate(description, Math.max(10, ui.cols() - 18)))}`);
  const complete = (text) => {
    const [first] = matchCommands(text, agent.skills);
    return first && first[0] !== text ? `${first[0]} ` : null;
  };

  if (prompt) {
    ui.userEcho(prompt);
    await turn(prompt, true);
  }


  for (;;) {
    ui.ensureNewline();
    const input = await term.readInput({ placeholder: 'Ask Seeker to build, fix, or explore…', suggest, complete });
    if (input === null) break;
    const text = input.trim();
    if (!text) {
      await runDue();
      continue;
    }
    ui.userEcho(text);

    if (text.startsWith('!')) {
      const result = await TOOL_BY_NAME.get('bash').run({ command: text.slice(1) }, { cwd, state: {} }).catch((e) => ({ output: e.message }));
      ui.line(result.output);
      continue;
    }
    if (text.startsWith('/')) {
      let result;
      try {
        result = await runCommand(text, { agent, ui, term, config, permissions, session, hub, autonomy: getAutonomy });
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
    await turn(text, true);
    await pursueGoal();
  }
  exit();
}
