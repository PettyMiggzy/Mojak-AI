import { cors, originOk } from './_lib/cors.js';
import { verifyErc20Transfer } from './_lib/chain.js';
import { setUnlock, isUnlocked, seenTx } from './_lib/store.js';

const MOJAK = process.env.MOJAK_TOKEN;
const DEAD = process.env.DEAD_ADDR || '0x000000000000000000000000000000000000dEaD';
const BURN = process.env.BURN_UNLOCK_AMOUNT || '5000000000000000000000'; // 5,000 * 1e18
const isAddr = (a) => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a);

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (!originOk(req)) return res.status(403).json({ error: 'forbidden origin' });
  const op = (req.query?.op) || 'status';

  try {
    if (op === 'status') {
      const w = req.query.wallet;
      if (!isAddr(w)) return res.status(400).json({ error: 'bad wallet' });
      return res.status(200).json({ wallet: w, unlocked: await isUnlocked(w) });
    }

    if (op === 'claim') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
      if (!MOJAK) return res.status(500).json({ error: 'MOJAK_TOKEN not set' });
      let body = req.body; if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
      const { wallet, txHash } = body || {};
      if (!isAddr(wallet)) return res.status(400).json({ error: 'bad wallet' });
      if (await seenTx(txHash)) return res.status(409).json({ error: 'tx already used' });
      const { from, amount } = await verifyErc20Transfer(txHash, MOJAK, DEAD, BURN);
      if (from !== wallet.toLowerCase()) return res.status(400).json({ error: 'burn sender != wallet' });
      await setUnlock(wallet);
      return res.status(200).json({ unlocked: true, burned: amount.toString() });
    }

    return res.status(400).json({ error: 'unknown op (status|claim)' });
  } catch (e) {
    return res.status(400).json({ error: String(e.message || e).slice(0, 200) });
  }
}
