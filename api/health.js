import { cors } from './_lib/cors.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  const e = process.env;
  const has = (...keys) => keys.some(k => !!e[k]);
  return res.status(200).json({
    ok: true,
    services: {
      doomer: has('GROQ_API_KEY', 'OPENROUTER_API_KEY'),
      bloomer: has('OPENAI_API_KEY'),
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
