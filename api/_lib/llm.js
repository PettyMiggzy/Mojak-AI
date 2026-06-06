// Internal only (imported by chat.js / tg.js). Never exposed as a public proxy.
const PROVIDERS = {
  groq: { url: 'https://api.groq.com/openai/v1/chat/completions', keyEnv: 'GROQ_API_KEY', def: 'llama-3.1-8b-instant' },
  openai: { url: 'https://api.openai.com/v1/chat/completions', keyEnv: 'OPENAI_API_KEY', def: 'gpt-4o-mini' },
  openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions', keyEnv: 'OPENROUTER_API_KEY', def: 'meta-llama/llama-3.1-8b-instruct' },
};

export async function chatLLM({ tier, messages, maxTokens }) {
  const doomer = tier === 'doomer';
  const provider = doomer
    ? (process.env.DOOMER_PROVIDER || 'groq')
    : (process.env.BLOOMER_PROVIDER || 'openai');
  const p = PROVIDERS[provider];
  if (!p) throw new Error('unknown provider ' + provider);
  const key = process.env[p.keyEnv];
  if (!key) throw new Error(provider + ' not configured (' + p.keyEnv + ')');
  const model = doomer ? (process.env.DOOMER_MODEL || p.def) : (process.env.BLOOMER_MODEL || p.def);
  const cap = Math.min(maxTokens || 500, doomer ? 400 : 2500); // hard ceiling

  const res = await fetch(p.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, max_tokens: cap, temperature: doomer ? 1.0 : 0.7 }),
  });
  if (!res.ok) throw new Error('LLM ' + res.status + ' ' + (await res.text()).slice(0, 180));
  const j = await res.json();
  return (j.choices?.[0]?.message?.content || '').trim();
}
