import { cors, originOk } from './_lib/cors.js';
import { monUsd } from './_lib/price.js';
import { verifyNativeTransfer } from './_lib/chain.js';
import { creditBalance, getBalance, seenTx } from './_lib/store.js';
import { ACTIONS } from './_lib/prompts.js';

const TREASURY = process.env.TREASURY_ADDR;
const isAddr = (a) => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a);

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (!originOk(req)) return res.status(403).json({ error: 'forbidden origin' });
  const op = (req.query?.op) || '';

  try {
    if (op === 'quote') {
      const action = req.query.action || 'chat';
      const spec = ACTIONS[action] || ACTIONS.chat;
      const { usd, stale } = await monUsd();
      return res.status(200).json({ action, usd: spec.usd, mon: +(spec.usd / usd).toFixed(4), monUsd: usd, stale });
    }

    if (op === 'balance') {
      const w = req.query.wallet;
      if (!isAddr(w)) return res.status(400).json({ error: 'bad wallet' });
      return res.status(200).json({ wallet: w, balanceUsd: (await getBalance(w)) / 1e6 });
    }

    if (op === 'credit') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
      if (!TREASURY) return res.status(500).json({ error: 'TREASURY_ADDR not set' });
      let body = req.body; if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
      const { wallet, txHash } = body || {};
      if (!isAddr(wallet)) return res.status(400).json({ error: 'bad wallet' });
      if (await seenTx(txHash)) return res.status(409).json({ error: 'tx already credited' });
      const { from, value } = await verifyNativeTransfer(txHash, TREASURY, 1n);
      if (from !== wallet.toLowerCase()) return res.status(400).json({ error: 'tx sender != wallet' });
      const { usd } = await monUsd();
      const monAmt = Number(value) / 1e18;
      const micro = Math.floor(monAmt * usd * 1e6);
      if (micro <= 0) return res.status(400).json({ error: 'credit too small' });
      await creditBalance(wallet, micro);
      return res.status(200).json({ creditedUsd: micro / 1e6, balanceUsd: (await getBalance(wallet)) / 1e6, monAmt, monUsd: usd });
    }

    return res.status(400).json({ error: 'unknown op (quote|balance|credit)' });
  } catch (e) {
    return res.status(400).json({ error: String(e.message || e).slice(0, 200) });
  }
}
