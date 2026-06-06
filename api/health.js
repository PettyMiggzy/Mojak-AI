import { cors } from './_lib/cors.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  const e = process.env;
  const has = (...keys) => keys.some(k => !!e[k]);
  // Mirror llm.js provider→key mapping so health reflects the ACTUAL configured
  // provider (e.g. doomer is fine if DOOMER_PROVIDER=openai + OPENAI_API_KEY set).
  const KEY_ENV = { groq: 'GROQ_API_KEY', openai: 'OPENAI_API_KEY', openrouter: 'OPENROUTER_API_KEY' };
  const providerReady = (p) => !!e[KEY_ENV[p] || ''];
  return res.status(200).json({
    ok: true,
    services: {
      doomer: providerReady(e.DOOMER_PROVIDER || 'groq'),
      bloomer: providerReady(e.BLOOMER_PROVIDER || 'openai'),
      imageGen: has('OPENAI_API_KEY'),
      crisis: has('OPENAI_API_KEY'),
      store: has('UPSTASH_REDIS_REST_URL', 'KV_REST_API_URL'),
      meter: !!e.TREASURY_ADDR && has('UPSTASH_REDIS_REST_URL', 'KV_REST_API_URL'),
      burnUnlock: !!e.MOJAK_TOKEN,
      telegram: !!e.TOKEN_ENC_KEY,
      adminDashboard: !!e.ADMIN_KEY,
    },
  });
}
