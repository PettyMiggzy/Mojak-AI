// Public, read-only MOJAK burn stats (balanceOf 0xdead + totalSupply). CORS-open so
// the meter can be embedded on the main site too.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  const MOJAK = process.env.MOJAK_TOKEN || '0x84Ea11d047A8bB23149a2d79C3B14Ab5B5907777';
  const RPC = process.env.MONAD_RPC || 'https://rpc.monad.xyz';
  const DEAD = '0x000000000000000000000000000000000000dEaD';
  async function call(data) {
    const r = await fetch(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: MOJAK, data }, 'latest'] }) });
    const j = await r.json();
    return BigInt(j.result || '0x0');
  }
  try {
    const burned = await call('0x70a08231' + DEAD.slice(2).toLowerCase().padStart(64, '0'));
    const supply = await call('0x18160ddd');
    const b = Number(burned / (10n ** 18n));
    const s = Number(supply / (10n ** 18n)) || 1;
    res.status(200).json({ burnedTokens: b, supplyTokens: s, pct: (b / s) * 100, raw: burned.toString() });
  } catch (e) { res.status(502).json({ error: 'rpc' }); }
}
