const RPC = process.env.MONAD_RPC || 'https://rpc.monad.xyz';
const MIN_CONF = BigInt(process.env.MIN_CONFIRMATIONS || '2');
const TRANSFER_SIG = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const TX_RE = /^0x[0-9a-fA-F]{64}$/;

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = await res.json();
  if (j.error) throw new Error('rpc: ' + j.error.message);
  return j.result;
}
const big = (h) => BigInt(h);
const addr = (a) => (a || '').toLowerCase();

// Verify a direct native MON transfer to `to` worth at least minWei.
export async function verifyNativeTransfer(txHash, to, minWei) {
  if (!TX_RE.test(txHash)) throw new Error('bad txHash');
  const tx = await rpc('eth_getTransactionByHash', [txHash]);
  if (!tx) throw new Error('tx not found');
  const rc = await rpc('eth_getTransactionReceipt', [txHash]);
  if (!rc) throw new Error('no receipt (pending?)');
  if (big(rc.status) !== 1n) throw new Error('tx failed');
  if (addr(tx.to) !== addr(to)) throw new Error('wrong recipient');
  const value = big(tx.value);
  if (value < BigInt(minWei)) throw new Error('amount too low');
  const head = big(await rpc('eth_blockNumber', []));
  if (head - big(rc.blockNumber) + 1n < MIN_CONF) throw new Error('not enough confirmations');
  return { from: addr(tx.from), value };
}

// Verify an ERC20 Transfer of `token` to `to` of at least minAmount (e.g. burn to 0xdead).
export async function verifyErc20Transfer(txHash, token, to, minAmount) {
  if (!TX_RE.test(txHash)) throw new Error('bad txHash');
  const rc = await rpc('eth_getTransactionReceipt', [txHash]);
  if (!rc) throw new Error('no receipt (pending?)');
  if (big(rc.status) !== 1n) throw new Error('tx failed');
  const t = addr(token), dst = addr(to);
  let hit = null;
  for (const log of rc.logs || []) {
    if (addr(log.address) !== t) continue;
    if ((log.topics?.length || 0) < 3) continue; // standard ERC20 Transfer = [sig, from, to]
    if ((log.topics[0] || '').toLowerCase() !== TRANSFER_SIG) continue;
    if (('0x' + log.topics[2].slice(26)).toLowerCase() !== dst) continue;
    const amt = big(log.data);
    if (amt >= BigInt(minAmount)) { hit = { from: ('0x' + log.topics[1].slice(26)).toLowerCase(), amount: amt }; break; }
  }
  if (!hit) throw new Error('no matching transfer in tx');
  const head = big(await rpc('eth_blockNumber', []));
  if (head - big(rc.blockNumber) + 1n < MIN_CONF) throw new Error('not enough confirmations');
  return hit;
}
