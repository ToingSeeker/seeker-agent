// Conversations are saved per working directory so `seeker -c` and /resume can
// pick up where an earlier one in this folder left off.
import fs from 'node:fs';
import path from 'node:path';
import { HOME_DIR } from './config.mjs';

const dirFor = (cwd) => path.join(HOME_DIR, 'sessions', cwd.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'root');

function ago(date) {
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1440)}d ago`;
}

export class Session {
  constructor(cwd) {
    this.cwd = cwd;
    this.dir = dirFor(cwd);
    this.startNew();
  }

  startNew() {
    this.file = path.join(this.dir, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  }

  save(messages, model) {
    if (!messages.length) return;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify({ cwd: this.cwd, model, savedAt: new Date().toISOString(), messages }));
    } catch {
      // Losing history must never break the running conversation.
    }
  }

  #read(file) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      return Array.isArray(data.messages) ? data : null;
    } catch {
      return null;
    }
  }

  /** The newest saved conversations for this folder, newest first. */
  list(limit = 20) {
    let files;
    try {
      files = fs.readdirSync(this.dir).filter((f) => f.endsWith('.json')).sort().reverse().slice(0, limit);
    } catch {
      return [];
    }
    const sessions = [];
    for (const name of files) {
      const file = path.join(this.dir, name);
      const data = this.#read(file);
      if (!data?.messages.length) continue;
      const first = data.messages.find((m) => m.role === 'user')?.content ?? '';
      sessions.push({
        file,
        count: data.messages.length,
        when: ago(new Date(data.savedAt ?? fs.statSync(file).mtime)),
        preview: first.replace(/\s+/g, ' ').trim().slice(0, 60) || '(empty)',
      });
    }
    return sessions;
  }

  /** Loads a saved conversation and keeps writing to that same file. */
  load(file) {
    const data = this.#read(file);
    if (!data) return null;
    this.file = file;
    return data.messages;
  }

  loadLatest() {
    const [latest] = this.list(1);
    return latest ? this.load(latest.file) : null;
  }
}
