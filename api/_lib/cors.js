const ALLOWED = (process.env.ALLOWED_ORIGINS ||
  'https://ai.mojakcto.xyz,https://mojakcto.xyz,https://www.mojakcto.xyz')
  .split(',').map(s => s.trim()).filter(Boolean);

export function cors(req, res) {
  const o = req.headers.origin;
  if (o && ALLOWED.includes(o)) res.setHeader('Access-Control-Allow-Origin', o);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST,GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}

export function originOk(req) {
  const o = req.headers.origin;
  return !o || ALLOWED.includes(o);
}

export function clientIp(req) {
  // Prefer the platform-set x-real-ip (Vercel overwrites it, so a client can't
  // forge it). Fall back to the left-most x-forwarded-for, then the socket.
  // NOTE: x-forwarded-for is client-prependable, so the free-tier rate limit it
  // keys is best-effort — keep money-gated paths on wallet identity, not IP.
  return (req.headers['x-real-ip'] || '').toString().trim() ||
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress || 'unknown';
}
