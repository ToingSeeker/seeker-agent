#!/usr/bin/env node
// market.mjs: the numbers behind a crypto market read, fetched from free public APIs and computed
// here, so the analysis quotes real values instead of guessed ones. Node 22+, no dependencies, no keys.
//
//   node market.mjs ta BTC --tf 1d,4h          indicators + levels from CLOSED candles only
//   node market.mjs derivs BTC                 perp funding, open interest, long/short, basis
//   node market.mjs fundamentals bitcoin       supply, valuation, drawdown (CoinGecko id)
//         [--llama aave]                       + TVL and fees from DefiLlama (protocol slug)
//   node market.mjs sentiment                  Fear & Greed, BTC dominance, total market cap
//   node market.mjs macro [--vs BTC]           DXY, US10Y, S&P 500, Nasdaq, gold, VIX + 90d corr
//   node market.mjs all BTC --cg bitcoin [--llama slug] [--tf 1d,4h]
//
// Every command prints one JSON object. A section whose source failed holds { error } and the rest
// still prints; the caller must report that gap rather than fill it in.

import { pathToFileURL } from 'node:url';

const UA = { 'user-agent': 'Mozilla/5.0 (seeker crypto-market-analysis)', accept: 'application/json' };
const TIMEOUT = 20_000;

async function getJson(url) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${new URL(url).host}`);
  return res.json();
}

const round = (n, d = 4) => (n == null || !Number.isFinite(n) ? null : Number(n.toFixed(d)));
const last = (arr) => arr[arr.length - 1];
const iso = (ms) => new Date(ms).toISOString();

// ---------------------------------------------------------------- indicators (pure, exported)

/** Exponential moving average; null until `period` values have been seen (seeded with their SMA). */
export function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) out[i] = prev = values[i] * k + prev * (1 - k);
  return out;
}

/** Simple moving average; null until `period` values. */
export function sma(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Wilder's RSI. */
export function rsi(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  const value = () => (loss === 0 ? 100 : 100 - 100 / (1 + gain / loss));
  out[period] = value();
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = value();
  }
  return out;
}

/** MACD line, signal line and histogram. */
export function macd(closes, fast = 12, slow = 26, signal = 9) {
  const f = ema(closes, fast);
  const s = ema(closes, slow);
  const line = closes.map((_, i) => (f[i] == null || s[i] == null ? null : f[i] - s[i]));
  const start = line.findIndex((v) => v != null);
  const sig = new Array(closes.length).fill(null);
  if (start >= 0) ema(line.slice(start), signal).forEach((v, j) => (sig[start + j] = v));
  return { line, signal: sig, hist: line.map((v, i) => (v == null || sig[i] == null ? null : v - sig[i])) };
}

/** Wilder's average true range. */
export function atr(candles, period = 14) {
  const out = new Array(candles.length).fill(null);
  const tr = candles.map((c, i) => (i === 0 ? c.h - c.l : Math.max(c.h - c.l, Math.abs(c.h - candles[i - 1].c), Math.abs(c.l - candles[i - 1].c))));
  if (candles.length < period + 1) return out;
  let prev = tr.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  out[period] = prev;
  for (let i = period + 1; i < candles.length; i++) out[i] = prev = (prev * (period - 1) + tr[i]) / period;
  return out;
}

/** Bollinger bands (population standard deviation). */
export function bollinger(closes, period = 20, mult = 2) {
  const mid = sma(closes, period);
  return closes.map((_, i) => {
    if (mid[i] == null) return null;
    const win = closes.slice(i - period + 1, i + 1);
    const sd = Math.sqrt(win.reduce((a, v) => a + (v - mid[i]) ** 2, 0) / period);
    return { mid: mid[i], upper: mid[i] + mult * sd, lower: mid[i] - mult * sd, widthPct: ((2 * mult * sd) / mid[i]) * 100 };
  });
}

/** Swing highs/lows: a bar whose high (low) is the extreme of the `side` bars on each side. */
export function swings(candles, side = 3) {
  const highs = [];
  const lows = [];
  for (let i = side; i < candles.length - side; i++) {
    const win = candles.slice(i - side, i + side + 1);
    if (candles[i].h === Math.max(...win.map((c) => c.h))) highs.push({ i, t: candles[i].t, price: candles[i].h });
    if (candles[i].l === Math.min(...win.map((c) => c.l))) lows.push({ i, t: candles[i].t, price: candles[i].l });
  }
  return { highs, lows };
}

/** Merge swing prices that sit within `tolPct` of each other into levels with a touch count. */
export function clusterLevels(prices, tolPct = 0.75) {
  const sorted = [...prices].sort((a, b) => a - b);
  const levels = [];
  for (const p of sorted) {
    const lvl = levels[levels.length - 1];
    if (lvl && ((p - lvl.price) / lvl.price) * 100 <= tolPct) {
      lvl.sum += p;
      lvl.touches += 1;
      lvl.price = lvl.sum / lvl.touches;
    } else levels.push({ price: p, sum: p, touches: 1 });
  }
  return levels.map(({ price, touches }) => ({ price, touches }));
}

/** Pearson correlation of two equal-length series. */
export function correlation(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 3) return null;
  const ma = a.slice(0, n).reduce((x, y) => x + y, 0) / n;
  const mb = b.slice(0, n).reduce((x, y) => x + y, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : null;
}

const pct = (from, to) => (from ? ((to - from) / from) * 100 : null);

/** Label the swing structure from the last two swing highs and lows. */
export function structure({ highs, lows }) {
  if (highs.length < 2 || lows.length < 2) return 'unclear (too few swings)';
  const hh = last(highs).price > highs[highs.length - 2].price;
  const hl = last(lows).price > lows[lows.length - 2].price;
  if (hh && hl) return 'higher highs + higher lows (uptrend structure)';
  if (!hh && !hl) return 'lower highs + lower lows (downtrend structure)';
  return hh ? 'higher high but lower low (expanding / transition)' : 'lower high but higher low (contracting / range)';
}

/** Everything the technical section needs from a list of CLOSED candles, oldest first. */
export function summarize(candles) {
  const closes = candles.map((c) => c.c);
  const close = last(closes);
  const at = (series) => last(series);
  const e20 = at(ema(closes, 20));
  const e50 = at(ema(closes, 50));
  const e200 = at(ema(closes, 200));
  const m = macd(closes);
  const a = at(atr(candles));
  const bb = at(bollinger(closes));
  const vols = candles.map((c) => c.v);
  const vAvg = at(sma(vols, 20));
  const sw = swings(candles);
  // Levels closer together than half an ATR are one zone, not two.
  const tolPct = Math.min(3, Math.max(0.5, ((a ?? 0) / close) * 50));
  const levels = clusterLevels([...sw.highs, ...sw.lows].map((s) => s.price), tolPct);
  const below = levels.filter((l) => l.price < close).sort((x, y) => y.price - x.price).slice(0, 3);
  const above = levels.filter((l) => l.price > close).sort((x, y) => x.price - y.price).slice(0, 3);
  const ago = (n) => (closes.length > n ? round(pct(closes[closes.length - 1 - n], close), 2) : null);
  const hi = Math.max(...candles.map((c) => c.h));
  const lo = Math.min(...candles.map((c) => c.l));
  const stack = e20 != null && e50 != null && e200 != null
    ? close > e20 && e20 > e50 && e50 > e200 ? 'bullish stack (close > EMA20 > EMA50 > EMA200)'
      : close < e20 && e20 < e50 && e50 < e200 ? 'bearish stack (close < EMA20 < EMA50 < EMA200)'
        : 'mixed'
    : 'not enough history for EMA200';
  const hist = m.hist.filter((v) => v != null);
  return {
    lastClosedCandle: last(candles).t,
    candles: candles.length,
    close: round(close, 8),
    ema: { 20: round(e20, 8), 50: round(e50, 8), 200: round(e200, 8), stack },
    priceVsEma200Pct: round(pct(e200, close), 2),
    rsi14: round(at(rsi(closes)), 2),
    macd: {
      line: round(at(m.line), 8),
      signal: round(at(m.signal), 8),
      hist: round(last(hist), 8),
      histRising: hist.length > 1 ? last(hist) > hist[hist.length - 2] : null,
    },
    atr14: round(a, 8),
    atrPct: round((a / close) * 100, 2),
    bollinger: bb && { upper: round(bb.upper, 8), mid: round(bb.mid, 8), lower: round(bb.lower, 8), widthPct: round(bb.widthPct, 2) },
    volumeVs20Avg: round(last(vols) / vAvg, 2),
    returnsPct: { '1': ago(1), '7': ago(7), '30': ago(30), '90': ago(90) },
    range: { high: round(hi, 8), low: round(lo, 8), fromHighPct: round(pct(hi, close), 2), fromLowPct: round(pct(lo, close), 2) },
    structure: structure(sw),
    lastSwingHigh: last(sw.highs) ?? null,
    lastSwingLow: last(sw.lows) ?? null,
    support: below.map((l) => ({ price: round(l.price, 8), touches: l.touches, distPct: round(pct(close, l.price), 2) })),
    resistance: above.map((l) => ({ price: round(l.price, 8), touches: l.touches, distPct: round(pct(close, l.price), 2) })),
  };
}

// ---------------------------------------------------------------- data sources

/** "btc" -> "BTCUSDT"; a pair that already names its quote is kept. */
export function pair(symbol) {
  const s = String(symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!s) throw new Error('give a symbol, e.g. BTC');
  return /(USDT|USDC|FDUSD|BUSD|TUSD|BTC|ETH|BNB|EUR|TRY)$/.test(s) && s.length > 4 ? s : `${s}USDT`;
}

const MS = { '15m': 9e5, '1h': 3.6e6, '4h': 1.44e7, '1d': 8.64e7, '1w': 6.048e8 };
const OKX_BAR = { '15m': '15m', '1h': '1H', '4h': '4H', '1d': '1Dutc', '1w': '1Wutc' };

/** Closed candles, oldest first. Binance's public market-data mirror, then OKX. */
export async function candles(symbol, tf = '1d', limit = 300) {
  if (!MS[tf]) throw new Error(`timeframe must be one of ${Object.keys(MS).join(', ')}`);
  const p = pair(symbol);
  const now = Date.now();
  const closed = (list) => list.filter((c) => c.t + MS[tf] <= now);
  try {
    const rows = await getJson(`https://data-api.binance.vision/api/v3/klines?symbol=${p}&interval=${tf}&limit=${limit + 1}`);
    if (!rows.length) throw new Error('no candles');
    return { source: 'binance spot', pair: p, list: closed(rows.map((k) => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[7] }))) };
  } catch (binanceError) {
    const inst = p.replace(/(USDT|USDC|BTC|ETH)$/, '-$1');
    try {
      const out = [];
      let after = '';
      while (out.length < limit) {
        const res = await getJson(`https://www.okx.com/api/v5/market/history-candles?instId=${inst}&bar=${OKX_BAR[tf]}&limit=100${after}`);
        if (res.code !== '0' || !res.data?.length) break;
        out.push(...res.data);
        after = `&after=${last(res.data)[0]}`;
      }
      if (!out.length) throw new Error(`no OKX candles for ${inst}`);
      const list = out.map((k) => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[7], done: k[8] === '1' })).reverse();
      return { source: 'okx spot', pair: inst, list: closed(list.filter((c) => c.done !== false)).slice(-limit), note: `binance failed: ${binanceError.message}` };
    } catch (okxError) {
      throw new Error(`binance: ${binanceError.message}; okx: ${okxError.message}`);
    }
  }
}

async function technical(symbol, tfs) {
  const out = {};
  for (const tf of tfs) {
    try {
      const { source, pair: p, list, note } = await candles(symbol, tf);
      if (list.length < 30) throw new Error(`only ${list.length} closed candles for ${p} ${tf}`);
      out[tf] = { source, pair: p, ...(note ? { note } : {}), ...summarize(list) };
      out[tf].lastClosedCandle = iso(out[tf].lastClosedCandle);
      for (const k of ['lastSwingHigh', 'lastSwingLow']) if (out[tf][k]) out[tf][k] = { price: round(out[tf][k].price, 8), t: iso(out[tf][k].t) };
    } catch (e) {
      out[tf] = { error: e.message };
    }
  }
  return out;
}

async function derivatives(symbol) {
  const p = pair(symbol).replace(/(USDC|FDUSD|BUSD|TUSD)$/, 'USDT');
  const F = 'https://fapi.binance.com';
  const out = { source: 'binance usd-m perpetual', pair: p };
  const part = async (key, fn) => {
    try {
      out[key] = await fn();
    } catch (e) {
      out[key] = { error: e.message };
    }
  };
  await part('funding', async () => {
    const pi = await getJson(`${F}/fapi/v1/premiumIndex?symbol=${p}`);
    const hist = await getJson(`${F}/fapi/v1/fundingRate?symbol=${p}&limit=21`);
    const rates = hist.map((h) => +h.fundingRate);
    const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
    return {
      lastPct: round(+pi.lastFundingRate * 100, 4),
      avg3dPct: round(avg(rates.slice(-9)) * 100, 4),
      avg7dPct: round(avg(rates) * 100, 4),
      annualizedPct: round(+pi.lastFundingRate * 3 * 365 * 100, 1),
      markPrice: round(+pi.markPrice, 8),
      indexPrice: round(+pi.indexPrice, 8),
      basisPct: round(pct(+pi.indexPrice, +pi.markPrice), 4),
    };
  });
  await part('openInterest', async () => {
    const h = await getJson(`${F}/futures/data/openInterestHist?symbol=${p}&period=1h&limit=168`);
    const usd = h.map((x) => +x.sumOpenInterestValue);
    return {
      usd: round(last(usd), 0),
      change24hPct: round(pct(usd[usd.length - 25], last(usd)), 2),
      change7dPct: round(pct(usd[0], last(usd)), 2),
    };
  });
  await part('longShort', async () => {
    const acc = await getJson(`${F}/futures/data/globalLongShortAccountRatio?symbol=${p}&period=1h&limit=1`);
    const top = await getJson(`${F}/futures/data/topLongShortPositionRatio?symbol=${p}&period=1h&limit=1`);
    return { allAccountsRatio: round(+acc[0]?.longShortRatio, 3), topTraderPositionRatio: round(+top[0]?.longShortRatio, 3) };
  });
  return out;
}

async function fundamentals(id, llama) {
  const out = {};
  try {
    const d = await getJson(`https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}?localization=false&tickers=false&community_data=false&developer_data=false&sparkline=false`);
    const m = d.market_data;
    const mcap = m.market_cap?.usd;
    const fdv = m.fully_diluted_valuation?.usd;
    out.coingecko = {
      id: d.id,
      name: d.name,
      symbol: d.symbol?.toUpperCase(),
      categories: d.categories?.filter(Boolean),
      genesisDate: d.genesis_date,
      hashingAlgorithm: d.hashing_algorithm,
      homepage: d.links?.homepage?.find(Boolean) ?? null,
      priceUsd: m.current_price?.usd,
      marketCapUsd: mcap,
      marketCapRank: d.market_cap_rank,
      fdvUsd: fdv,
      mcapToFdv: round(mcap && fdv ? mcap / fdv : null, 3),
      circulatingSupply: m.circulating_supply,
      totalSupply: m.total_supply,
      maxSupply: m.max_supply,
      unlockedPct: round(m.max_supply || m.total_supply ? (m.circulating_supply / (m.max_supply || m.total_supply)) * 100 : null, 1),
      volume24hUsd: m.total_volume?.usd,
      volumeToMcapPct: round(mcap ? (m.total_volume?.usd / mcap) * 100 : null, 2),
      athUsd: m.ath?.usd,
      athDate: m.ath_date?.usd,
      fromAthPct: round(m.ath_change_percentage?.usd, 2),
      change: {
        '7dPct': round(m.price_change_percentage_7d, 2),
        '30dPct': round(m.price_change_percentage_30d, 2),
        '1yPct': round(m.price_change_percentage_1y, 2),
      },
      tvlUsd: m.total_value_locked?.usd ?? null,
      mcapToTvl: m.mcap_to_tvl_ratio ?? null,
      lastUpdated: m.last_updated,
    };
  } catch (e) {
    out.coingecko = { error: `${e.message} (is "${id}" the CoinGecko id? e.g. bitcoin, ethereum, solana)` };
  }
  if (llama) {
    try {
      const p = await getJson(`https://api.llama.fi/protocol/${encodeURIComponent(llama)}`);
      const tvl = (p.tvl || []).map((x) => x.totalLiquidityUSD);
      out.defillama = {
        name: p.name,
        category: p.category,
        chains: p.chains,
        tvlUsd: round(last(tvl), 0),
        tvlChange30dPct: round(tvl.length > 30 ? pct(tvl[tvl.length - 31], last(tvl)) : null, 2),
      };
    } catch (e) {
      out.defillama = { error: e.message };
    }
    for (const [key, type] of [['fees', 'dailyFees'], ['revenue', 'dailyRevenue']]) {
      try {
        const f = await getJson(`https://api.llama.fi/summary/fees/${encodeURIComponent(llama)}?dataType=${type}`);
        out.defillama = { ...out.defillama, [`${key}24hUsd`]: f.total24h ?? null, [`${key}30dUsd`]: f.total30d ?? null };
      } catch (e) {
        out.defillama = { ...out.defillama, [`${key}Error`]: e.message };
      }
    }
  }
  return out;
}

async function sentiment() {
  const out = {};
  try {
    const fg = (await getJson('https://api.alternative.me/fng/?limit=30')).data.map((d) => ({ v: +d.value, c: d.value_classification }));
    out.fearGreed = {
      now: fg[0].v,
      label: fg[0].c,
      avg7d: round(fg.slice(0, 7).reduce((a, d) => a + d.v, 0) / 7, 1),
      avg30d: round(fg.reduce((a, d) => a + d.v, 0) / fg.length, 1),
    };
  } catch (e) {
    out.fearGreed = { error: e.message };
  }
  try {
    const g = (await getJson('https://api.coingecko.com/api/v3/global')).data;
    out.global = {
      totalMarketCapUsd: round(g.total_market_cap?.usd, 0),
      marketCapChange24hPct: round(g.market_cap_change_percentage_24h_usd, 2),
      btcDominancePct: round(g.market_cap_percentage?.btc, 2),
      ethDominancePct: round(g.market_cap_percentage?.eth, 2),
      stablecoinSharePct: round((g.market_cap_percentage?.usdt ?? 0) + (g.market_cap_percentage?.usdc ?? 0), 2),
    };
  } catch (e) {
    out.global = { error: e.message };
  }
  return out;
}

const MACRO = { DXY: 'DX-Y.NYB', US10Y: '^TNX', SPX: '^GSPC', NDX: '^IXIC', GOLD: 'GC=F', VIX: '^VIX' };

/** Daily closes keyed by UTC date. */
async function yahoo(ticker) {
  const d = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=6mo&interval=1d`);
  const r = d.chart?.result?.[0];
  if (!r) throw new Error(d.chart?.error?.description || 'no data');
  const rows = r.timestamp.map((t, i) => [new Date(t * 1000).toISOString().slice(0, 10), r.indicators.quote[0].close[i]]).filter(([, c]) => c != null);
  return new Map(rows);
}

async function macro(vs = 'BTC') {
  const out = { source: 'yahoo finance (unofficial, delayed; today\'s row may still be intraday)', asOf: null, series: {} };
  let crypto = null;
  try {
    const { list } = await candles(vs, '1d', 200);
    crypto = new Map(list.map((c) => [iso(c.t).slice(0, 10), c.c]));
  } catch (e) {
    out.correlationError = e.message;
  }
  for (const [name, ticker] of Object.entries(MACRO)) {
    try {
      const m = await yahoo(ticker);
      const dates = [...m.keys()];
      const closes = [...m.values()];
      const c = last(closes);
      const back = (n) => (closes.length > n ? round(pct(closes[closes.length - 1 - n], c), 2) : null);
      // A yield moves in basis points; a percent change of a percent misleads.
      const bps = (n) => (closes.length > n ? round((c - closes[closes.length - 1 - n]) * 100, 1) : null);
      const row = name === 'US10Y'
        ? { lastYieldPct: round(c, 3), date: last(dates), change5dBps: bps(5), change21dBps: bps(21), change63dBps: bps(63) }
        : { last: round(c, 3), date: last(dates), change5dPct: back(5), change21dPct: back(21), change63dPct: back(63) };
      if (crypto) {
        // Correlate daily returns on dates both markets traded, over the last 90 of them.
        const both = dates.filter((d) => crypto.has(d)).slice(-91);
        const ret = (map) => both.slice(1).map((d, i) => map.get(d) / map.get(both[i]) - 1);
        row[`corr90d_${vs.toUpperCase()}`] = both.length > 30 ? round(correlation(ret(m), ret(crypto)), 2) : null;
      }
      out.series[name] = row;
      out.asOf = out.asOf && out.asOf > row.date ? out.asOf : row.date;
    } catch (e) {
      out.series[name] = { error: e.message };
    }
  }
  return out;
}

// ---------------------------------------------------------------- cli

function parseArgs(argv) {
  const pos = [];
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) opt[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    else pos.push(argv[i]);
  }
  return { pos, opt };
}

const USAGE = 'usage: market.mjs ta <SYMBOL> [--tf 1d,4h] | derivs <SYMBOL> | fundamentals <coingecko-id> [--llama slug] | sentiment | macro [--vs BTC] | all <SYMBOL> --cg <id> [--llama slug] [--tf 1d,4h]';

export async function run(argv) {
  const { pos, opt } = parseArgs(argv);
  const [cmd, arg] = pos;
  const tfs = String(opt.tf || '1d,4h').split(',').map((s) => s.trim()).filter(Boolean);
  const stamp = { generatedAt: new Date().toISOString() };
  switch (cmd) {
    case 'ta':
      return { ...stamp, technical: await technical(arg, tfs) };
    case 'derivs':
      return { ...stamp, derivatives: await derivatives(arg) };
    case 'fundamentals':
      if (!arg) throw new Error('give the CoinGecko id, e.g. fundamentals solana');
      return { ...stamp, fundamentals: await fundamentals(arg, opt.llama) };
    case 'sentiment':
      return { ...stamp, sentiment: await sentiment() };
    case 'macro':
      return { ...stamp, macro: await macro(opt.vs || 'BTC') };
    case 'all': {
      if (!arg) throw new Error('give a symbol, e.g. all SOL --cg solana');
      const [t, d, f, s, m] = await Promise.all([
        technical(arg, tfs),
        derivatives(arg),
        opt.cg ? fundamentals(opt.cg, opt.llama) : { skipped: 'pass --cg <coingecko-id> for fundamentals' },
        sentiment(),
        macro(arg),
      ]);
      return { ...stamp, symbol: pair(arg), technical: t, derivatives: d, fundamentals: f, sentiment: s, macro: m };
    }
    default:
      throw new Error(USAGE);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  run(process.argv.slice(2)).then(
    (out) => console.log(JSON.stringify(out, null, 2)),
    (e) => {
      console.log(JSON.stringify({ ok: false, error: e.message }));
      process.exitCode = 1;
    },
  );
}
