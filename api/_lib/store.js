// Persistence layer. Uses Upstash/Vercel KV (Redis REST) when configured,
// else an in-memory fallback (NON-PERSISTENT — dev only; meter is unsafe without Redis).
const URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOK = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const useRedis = !!(URL && TOK);
if (!useRedis) console.warn('[store] No Redis env set — in-memory fallback (non-persistent). Set UPSTASH_REDIS_REST_URL/TOKEN before production.');

async function r(cmd) {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  if (!res.ok) throw new Error('redis ' + res.status);
  return (await res.json()).result;
}

// ---- in-memory fallback primitives ----
const mem = new Map();
const memHash = new Map();
const now = () => Date.now() / 1000;

// ---- token-bucket rate limit (atomic in Redis via EVAL) ----
const BUCKET = `
local k=KEYS[1] local cap=tonumber(ARGV[1]) local refill=tonumber(ARGV[2])
local now=tonumber(ARGV[3]) local cost=tonumber(ARGV[4])
local d=redis.call('HMGET',k,'t','ts') local tok=tonumber(d[1]) local ts=tonumber(d[2])
if tok==nil then tok=cap ts=now end
tok=math.min(cap, tok + math.max(0,now-ts)*refill)
local ok=0 if tok>=cost then tok=tok-cost ok=1 end
redis.call('HMSET',k,'t',tok,'ts',now) redis.call('EXPIRE',k,math.ceil(cap/refill)+2)
return {ok, math.floor(tok)}`;

export async function rateLimit(key, cap, refillPerSec, cost = 1) {
  if (useRedis) {
    const out = await r(['EVAL', BUCKET, '1', 'rl:' + key, cap, refillPerSec, now(), cost]);
    return { allowed: out[0] === 1, remaining: out[1] };
  }
  const k = 'rl:' + key;
  const s = mem.get(k) || { t: cap, ts: now() };
  s.t = Math.min(cap, s.t + Math.max(0, now() - s.ts) * refillPerSec);
  s.ts = now();
  let allowed = false;
  if (s.t >= cost) { s.t -= cost; allowed = true; }
  mem.set(k, s);
  return { allowed, remaining: Math.floor(s.t) };
}

// ---- USD-credit balances (integer micro-USD) ----
export async function creditBalance(wallet, micro) {
  if (useRedis) return Number(await r(['INCRBY', 'bal:' + wallet, micro]));
  const k = 'bal:' + wallet, v = (mem.get(k) || 0) + micro; mem.set(k, v); return v;
}
export async function debitBalance(wallet, micro) {
  if (useRedis) {
    const v = Number(await r(['DECRBY', 'bal:' + wallet, micro]));
    if (v < 0) { await r(['INCRBY', 'bal:' + wallet, micro]); return false; }
    return true;
  }
  const k = 'bal:' + wallet, cur = mem.get(k) || 0;
  if (cur < micro) return false;
  mem.set(k, cur - micro); return true;
}
export async function getBalance(wallet) {
  if (useRedis) return Number((await r(['GET', 'bal:' + wallet])) || 0);
  return mem.get('bal:' + wallet) || 0;
}

// ---- tx dedupe (returns true if ALREADY seen) ----
export async function seenTx(hash) {
  const h = hash.toLowerCase();
  if (useRedis) return (await r(['SADD', 'seen:tx', h])) === 0;
  const k = 'seen:tx';
  const set = mem.get(k) || new Set();
  const had = set.has(h); set.add(h); mem.set(k, set); return had;
}

// ---- doomer burn unlock ----
export async function setUnlock(wallet) {
  if (useRedis) return r(['SET', 'unlock:' + wallet, '1']);
  mem.set('unlock:' + wallet, '1');
}
export async function isUnlocked(wallet) {
  if (useRedis) return (await r(['GET', 'unlock:' + wallet])) === '1';
  return mem.get('unlock:' + wallet) === '1';
}

// ---- bot registry (BYO telegram) ----
export async function saveBot(id, obj) {
  if (useRedis) { const a = ['HSET', 'bot:' + id]; for (const k in obj) a.push(k, obj[k]); return r(a); }
  memHash.set('bot:' + id, { ...obj });
}
export async function getBot(id) {
  if (useRedis) {
    const flat = await r(['HGETALL', 'bot:' + id]);
    if (!flat || !flat.length) return null;
    const o = {}; for (let i = 0; i < flat.length; i += 2) o[flat[i]] = flat[i + 1]; return o;
  }
  return memHash.get('bot:' + id) || null;
}

// ---- generic kv (price cache etc) ----
export async function kvGet(key) {
  if (useRedis) return await r(['GET', key]);
  const e = mem.get('kv:' + key);
  if (e && (!e.exp || e.exp > now())) return e.v;
  return null;
}
export async function kvSet(key, val, ttlSec) {
  if (useRedis) return r(ttlSec ? ['SET', key, val, 'EX', ttlSec] : ['SET', key, val]);
  mem.set('kv:' + key, { v: val, exp: ttlSec ? now() + ttlSec : 0 });
}


const STAT = (k) => 'stat:' + k;
export async function track({ revenueMicro = 0, costMicro = 0, tier = 'bloomer', action = 'chat' } = {}) {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const ops = [['calls', 1], ['calls:' + tier + ':' + action, 1]];
  if (revenueMicro) ops.push(['rev', revenueMicro], ['rev:' + day, revenueMicro]);
  if (costMicro) ops.push(['cost', costMicro], ['cost:' + day, costMicro]);
  if (useRedis) { await Promise.all(ops.map(([k, v]) => r(['INCRBY', STAT(k), v]))); }
  else { for (const [k, v] of ops) { const kk = STAT(k); mem.set(kk, (mem.get(kk) || 0) + v); } }
}
async function statGet(k) {
  const kk = STAT(k);
  if (useRedis) return Number((await r(['GET', kk])) || 0);
  return mem.get(kk) || 0;
}
export async function getStats() {
  const t0 = Date.now();
  const days = [...Array(7)].map((_, i) => new Date(t0 - i * 864e5).toISOString().slice(0, 10).replace(/-/g, ''));
  const [rev, cost, calls] = await Promise.all([statGet('rev'), statGet('cost'), statGet('calls')]);
  const daily = [];
  for (const d of days) { const [rv, ct] = await Promise.all([statGet('rev:' + d), statGet('cost:' + d)]); daily.push({ day: d, revenueUsd: rv / 1e6, costUsd: ct / 1e6, marginUsd: (rv - ct) / 1e6 }); }
  const actions = {};
  for (const t of ['bloomer', 'doomer']) for (const a of ['chat', 'code', 'plan', 'bot', 'art', 'hype', 'tg']) { const c = await statGet('calls:' + t + ':' + a); if (c) actions[t + ':' + a] = c; }
  return { totals: { revenueUsd: rev / 1e6, costUsd: cost / 1e6, marginUsd: (rev - cost) / 1e6, calls }, daily, actions };
}
