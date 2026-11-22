// What helpers spend, and the limit on it (`swarmBudget`).
//
// Every agent adds up what its replies cost: tokens, and dollars where the reply has a price
// (the provider stated one, or its per-token or Anthropic list price is known; a local model costs
// nothing; for Claude Code, a subscription, the dollars are what it would cost on the API).
// A helper's spend also goes to its parent, which keeps the total of all its helpers for the
// message it is answering. When `swarmBudget` is set and that total passes it, every running
// helper is stopped, no new one starts, and the parent is told so: it still answers, with what
// was done. The parent's own replies are not counted against the limit, so it can always report.
//
// `swarmBudget`: '' (no limit), a number of tokens ('500k', '2m', '800000'), or dollars ('$2', '2usd').
import { chargeOf, costOf } from '../remote-server/public/usage.js';

const whole = (n) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

export const blankSpent = () => ({ tokens: 0, usd: 0, unpriced: 0 });

/** The budget written in a setting: { tokens } or { usd }; null for no limit; undefined when it cannot be read. */
export function parseBudget(raw) {
  const text = String(raw ?? '').trim().toLowerCase().replace(/[\s,_]/g, '');
  if (['', 'off', 'none', '0', '-'].includes(text)) return null;
  let m = text.match(/^\$(\d+(?:\.\d+)?)$/) ?? text.match(/^(\d+(?:\.\d+)?)(?:\$|usd)$/);
  if (m) return Number(m[1]) > 0 ? { usd: Number(m[1]) } : undefined;
  m = text.match(/^(\d+(?:\.\d+)?)(k|m)?(?:tokens?)?$/);
  if (!m) return undefined;
  const tokens = Math.round(Number(m[1]) * (m[2] === 'm' ? 1e6 : m[2] === 'k' ? 1e3 : 1));
  return tokens >= 1000 ? { tokens } : undefined;
}

/** The setting as it is saved: the same text, tidied; '' for no limit. */
export function budgetSetting(raw) {
  const budget = parseBudget(raw);
  if (budget === undefined) return undefined;
  return budget ? describeBudget(budget) : '';
}

const count = (n) => (n >= 1e6 ? `${+(n / 1e6).toFixed(2)}m` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}k` : String(n));
const dollars = (usd) => `$${usd >= 1 ? usd.toFixed(2) : usd >= 0.01 ? usd.toFixed(3) : usd.toFixed(4)}`;

export const describeBudget = (budget) => (budget.usd != null ? dollars(budget.usd) : count(budget.tokens));

/** "12.3k tokens, ≈$0.041", with the tokens that have no price said apart. */
export function describeSpent(spent) {
  const parts = [`${count(spent.tokens)} tokens`];
  const priced = spent.tokens - spent.unpriced;
  if (priced > 0 && spent.usd > 0) parts.push(`≈${dollars(spent.usd)}`);
  if (spent.unpriced > 0 && priced > 0) parts.push(`${count(spent.unpriced)} of them unpriced`);
  return parts.join(', ');
}

/**
 * What one reply cost: its tokens, and its dollars (0 for a local model, null when unknown).
 * `spent` is the reply's counts as a provider gives them ({ input, cached, output, cost, models }).
 */
export function replyCost(spent, { provider, model, local = false, at = Date.now() } = {}) {
  const tokens = whole(spent?.input) + whole(spent?.output);
  if (local) return { tokens, usd: 0 };
  const parts = spent?.models?.length ? spent.models : [{ ...spent, model }];
  let usd = 0;
  for (const part of parts) {
    const name = String(part.model ?? model ?? '');
    // The provider's own charge or per-token price; otherwise Anthropic's list price for its models
    // (for Claude Code, a subscription, that is what the tokens would cost on the API, not a bill).
    const charge = chargeOf(provider, name.toLowerCase(), part, at) ?? costOf(provider, name, { input: whole(part.input), cached: whole(part.cached), written: whole(part.written), output: whole(part.output) });
    if (charge == null) return { tokens, usd: null };
    usd += charge;
  }
  return { tokens, usd };
}

/** Adds one reply's cost to a running total. */
export function addSpent(total, { tokens, usd }) {
  total.tokens += tokens;
  if (usd == null) total.unpriced += tokens;
  else total.usd += usd;
  return total;
}

/** Whether `spent` has passed `budget`. A dollar budget counts only what has a price. */
export const overBudget = (spent, budget) => Boolean(budget) && (budget.usd != null ? spent.usd >= budget.usd : spent.tokens >= budget.tokens);
