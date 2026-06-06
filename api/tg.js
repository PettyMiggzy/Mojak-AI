import crypto from 'crypto';
import { cors, originOk } from './_lib/cors.js';
import { rateLimit, isUnlocked, saveBot, getBot, track } from './_lib/store.js';
import { textCostMicro } from './_lib/rates.js';
import { crisisCheck } from './_lib/crisis.js';
import { chatLLM } from './_lib/llm.js';
import { buildDoomerSystem } from './_lib/prompts.js';
import { encrypt, decrypt } from './_lib/cryptobox.js';

const isAddr = (a) => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a);
const base = (req) => process.env.PUBLIC_BASE_URL || `https://${req.headers.host}`;
const tg = (token, method, payload) =>
  fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  }).then(r => r.json());

function safeEq(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export default async function handler(req, res) {
  const op = req.query?.op || '';

  // ---- register a user's bot (called from the web, gated by burn-unlock) ----
  if (op === 'register') {
    // Browser-called: handle CORS preflight + set allow-origin. (The webhook
    // path below is server-to-server from Telegram and intentionally skips CORS.)
    if (cors(req, res)) return;
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
    if (!originOk(req)) return res.status(403).json({ error: 'forbidden origin' });
    let body = req.body; if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    const { botToken, wallet, tier = 'doomer', persona } = body || {};
    if (tier !== 'doomer') return res.status(400).json({ error: 'telegram BYO is doomer-only for now' });
    if (!isAddr(wallet)) return res.status(400).json({ error: 'bad wallet' });
    if (!(await isUnlocked(wallet))) return res.status(402).json({ error: 'burn MOJAK to unlock first' });
    if (typeof botToken !== 'string' || !/^\d+:[\w-]{30,}$/.test(botToken)) return res.status(400).json({ error: 'bad bot token' });

    const me = await tg(botToken, 'getMe', {});
    if (!me.ok) return res.status(400).json({ error: 'token rejected by telegram' });

    // Bound the owner-supplied persona before storing / injecting into the prompt.
    const cleanPersona = {
      name: String(persona?.name || '').slice(0, 40),
      traits: Array.isArray(persona?.traits) ? persona.traits.slice(0, 8).map(t => String(t).slice(0, 40)) : [],
    };

    const botId = crypto.randomBytes(12).toString('hex');
    const secret = crypto.randomBytes(24).toString('hex');
    await saveBot(botId, { tokenEnc: encrypt(botToken), tier, secret, owner: wallet.toLowerCase(), persona: JSON.stringify(cleanPersona) });
    const wh = await tg(botToken, 'setWebhook', { url: `${base(req)}/api/tg?botId=${botId}`, secret_token: secret, drop_pending_updates: true });
    if (!wh.ok) return res.status(502).json({ error: 'setWebhook failed', detail: wh.description });
    return res.status(200).json({ ok: true, botId, botUsername: me.result?.username });
  }

  // ---- telegram webhook (server-to-server; verified by secret token) ----
  if (req.method !== 'POST') return res.status(200).json({ ok: true });
  const botId = req.query?.botId;
  const bot = botId && await getBot(botId);
  if (!bot) return res.status(404).json({ error: 'unknown bot' });
  if (!safeEq(req.headers['x-telegram-bot-api-secret-token'] || '', bot.secret))
    return res.status(401).json({ error: 'bad secret' });

  let update = req.body; if (typeof update === 'string') { try { update = JSON.parse(update); } catch { update = {}; } }
  const msg = update?.message;
  const text = msg?.text;
  const chatId = msg?.chat?.id;
  if (!text || !chatId) return res.status(200).json({ ok: true });

  let token;
  try { token = decrypt(bot.tokenEnc); } catch { return res.status(500).json({ error: 'token decrypt failed' }); }

  try {
    const c = await crisisCheck(text);
    if (c.crisis) { await tg(token, 'sendMessage', { chat_id: chatId, text: c.reply }); return res.status(200).json({ ok: true }); }

    const rl = await rateLimit('tg:' + botId + ':' + chatId, 15, 15 / 60);
    if (!rl.allowed) return res.status(200).json({ ok: true });

    let persona = {}; try { persona = JSON.parse(bot.persona || '{}'); } catch {}
    const out = await chatLLM({ tier: 'doomer', maxTokens: 350, messages: [{ role: 'system', content: buildDoomerSystem(persona) }, { role: 'user', content: text.slice(0, 2000) }] });
    await track({ costMicro: textCostMicro(out.model, out.usage), tier: 'doomer', action: 'tg' });
    await tg(token, 'sendMessage', { chat_id: chatId, text: out.text || '...' });
  } catch (e) {
    await tg(token, 'sendMessage', { chat_id: chatId, text: 'brain lagged, try again 😵‍💫' }).catch(() => {});
  }
  return res.status(200).json({ ok: true });
}
