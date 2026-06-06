import crypto from 'crypto';
import { cors } from './_lib/cors.js';
import { getStats } from './_lib/store.js';

function safeEq(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  const key = process.env.ADMIN_KEY;
  const given = req.query?.key || req.headers['x-admin-key'] || '';
  if (!key || !safeEq(given, key)) return res.status(401).json({ error: 'unauthorized' });
  try {
    return res.status(200).json(await getStats());
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e).slice(0, 200) });
  }
}
