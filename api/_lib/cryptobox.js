import crypto from 'crypto';

function key() {
  const k = process.env.TOKEN_ENC_KEY;
  if (!k) throw new Error('TOKEN_ENC_KEY missing (need 32-byte hex)');
  const b = Buffer.from(k, 'hex');
  if (b.length !== 32) throw new Error('TOKEN_ENC_KEY must be 32 bytes hex (64 chars)');
  return b;
}

export function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}

export function decrypt(b64) {
  const buf = Buffer.from(b64, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
}
