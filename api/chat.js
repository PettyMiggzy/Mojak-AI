import { cors, originOk, clientIp } from './_lib/cors.js';
import { rateLimit, debitBalance, creditBalance, getBalance, track, isUnlocked } from './_lib/store.js';
import { textCostMicro, imageCostMicro } from './_lib/rates.js';
import { crisisCheck } from './_lib/crisis.js';
import { chatLLM, genImage } from './_lib/llm.js';
import { DOOMER_SYS, BLOOMER_SYS, ACTIONS } from './_lib/prompts.js';

const isAddr = (a) => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a);

function clean(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-12)
    .map(m => ({ role: m.role, content: m.content.slice(0, 4000) }));
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!originOk(req)) return res.status(403).json({ error: 'forbidden origin' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const { tier, action, wallet, messages } = body || {};
  const msgs = clean(messages);
  if (!msgs.length) return res.status(400).json({ error: 'no messages' });
  const lastUser = [...msgs].reverse().find(m => m.role === 'user');

  // crisis tripwire on the latest user message (both tiers)
  if (lastUser) {
    const c = await crisisCheck(lastUser.content);
    if (c.crisis) return res.status(200).json({ crisis: true, reply: c.reply });
  }

  try {
    if (tier === 'bloomer') {
      if (!isAddr(wallet)) return res.status(400).json({ error: 'wallet required for bloomer' });
      const rl = await rateLimit('b:' + wallet, 30, 30 / 60);
      if (!rl.allowed) return res.status(429).json({ error: 'rate limited' });
      const act = ACTIONS[action] ? action : 'chat';
      const spec = ACTIONS[act];
      const micro = Math.round(spec.usd * 1e6);
      // Gate on balance but DO NOT debit yet. Charge ONLY after a successful result so a
      // slow or timed-out generation can never consume credit without delivering anything.
      if ((await getBalance(wallet)) < micro)
        return res.status(402).json({ error: 'insufficient balance', needUsd: spec.usd, balanceUsd: (await getBalance(wallet)) / 1e6 });
      if (spec.image) {
        const img = await genImage({ prompt: (lastUser?.content || 'a funny purple wojak cope meme'), n: spec.n || 1 });
        if (!img.images?.length) return res.status(502).json({ error: 'image failed \u2014 not charged, try again' });
        await debitBalance(wallet, micro); // charge ONLY now that the image exists
        await track({ revenueMicro: micro, costMicro: imageCostMicro(img.model, img.n), tier: 'bloomer', action: 'art' });
        return res.status(200).json({ images: img.images, costUsd: spec.usd, balanceUsd: (await getBalance(wallet)) / 1e6 });
      }
      const out = await chatLLM({ tier, maxTokens: spec.max, messages: [{ role: 'system', content: BLOOMER_SYS }, ...msgs] });
      await debitBalance(wallet, micro); // charge ONLY on success
      await track({ revenueMicro: micro, costMicro: textCostMicro(out.model, out.usage), tier: 'bloomer', action: act });
      return res.status(200).json({ reply: out.text, costUsd: spec.usd, balanceUsd: (await getBalance(wallet)) / 1e6 });
    }

    // doomer — gated: connect wallet + burn 1M MOJAK to unlock, then chat
    if (!isAddr(wallet)) return res.status(400).json({ error: 'connect wallet to use doomer' });
    if (!(await isUnlocked(wallet))) return res.status(402).json({ error: 'burn to unlock doomer' });
    const id = wallet;
    const rl = await rateLimit('d:' + id, 20, 20 / 60);
    if (!rl.allowed) return res.status(429).json({ error: 'slow down a sec', remaining: rl.remaining });
    const out = await chatLLM({ tier: 'doomer', maxTokens: 350, messages: [{ role: 'system', content: DOOMER_SYS }, ...msgs] });
    await track({ costMicro: textCostMicro(out.model, out.usage), tier: 'doomer', action: 'chat' });
    return res.status(200).json({ reply: out.text });
  } catch (e) {
    // Log full detail server-side only. Never echo upstream error text to the
    // client — it can reveal the model provider/identity (e.g. an OpenAI 401 body).
    console.error('[chat] error:', String(e?.message || e));
    return res.status(502).json({ error: 'model unavailable, try again in a moment' });
  }
}
