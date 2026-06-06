import { kvGet, kvSet } from './store.js';

const ID = process.env.COINGECKO_ID || 'monad';
const FRESH_MS = 60_000;
const STALE_MAX_MS = 10 * 60_000;
let memCache = null;

export async function monUsd() {
  const t = Date.now();
  let cached = null;
  try { const v = await kvGet('price:monusd'); if (v) cached = JSON.parse(v); } catch {}
  if (!cached && memCache) cached = memCache;
  if (cached && t - cached.ts < FRESH_MS) return { usd: cached.usd, ts: cached.ts, stale: false };

  try {
    const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ID}&vs_currencies=usd`,
      { headers: process.env.COINGECKO_KEY ? { 'x-cg-pro-api-key': process.env.COINGECKO_KEY } : {} });
    const j = await res.json();
    const usd = j?.[ID]?.usd;
    if (typeof usd === 'number' && usd > 0) {
      const o = { usd, ts: t };
      memCache = o;
      try { await kvSet('price:monusd', JSON.stringify(o), 120); } catch {}
      return { usd, ts: t, stale: false };
    }
    throw new Error('bad price payload');
  } catch (e) {
    if (cached && t - cached.ts < STALE_MAX_MS) return { usd: cached.usd, ts: cached.ts, stale: true };
    throw new Error('MON/USD price unavailable');
  }
}
