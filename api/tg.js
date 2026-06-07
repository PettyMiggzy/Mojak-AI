import crypto from 'crypto';
import { cors, originOk } from './_lib/cors.js';
import { rateLimit, isUnlocked, saveBot, getBot, track, debitBalance, creditBalance, getBalance } from './_lib/store.js';
import { textCostMicro, imageCostMicro } from './_lib/rates.js';
import { crisisCheck } from './_lib/crisis.js';
import { chatLLM, genImage } from './_lib/llm.js';
import { buildDoomerSystem, BLOOMER_SYS, ACTIONS } from './_lib/prompts.js';
import { encrypt, decrypt } from './_lib/cryptobox.js';

const isAddr = (a) => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a);
const base = (req) => process.env.PUBLIC_BASE_URL || `https://${req.headers.host}`;
const tg = (token, method, payload) =>
  fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  }).then(r => r.json());

async function tgPhoto(token, chatId, dataUrl, caption) {
  const s = String(dataUrl); const b64 = s.includes(',') ? s.split(',')[1] : s;
  const fd = new FormData();
  fd.append('chat_id', String(chatId));
  if (caption) fd.append('caption', caption);
  fd.append('photo', new Blob([Buffer.from(b64, 'base64')], { type: 'image/png' }), 'mojak.png');
  return fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: 'POST', body: fd }).then(r => r.json());
}

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
    if (tier !== 'doomer' && tier !== 'bloomer') return res.status(400).json({ error: 'unknown tier' });
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
    if (tier === 'bloomer') await tg(botToken, 'setMyCommands', { commands: [{ command: 'meme', description: 'make a meme — /meme your idea' }, { command: 'image', description: 'generate an image — /image your prompt' }] }).catch(() => {});
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
    let persona = {}; try { persona = JSON.parse(bot.persona || '{}'); } catch {}

    const c = await crisisCheck(text);
    if (c.crisis) { await tg(token, 'sendMessage', { chat_id: chatId, text: c.reply }); return res.status(200).json({ ok: true }); }

    if (text.trim() === '/start') {
      const hi = bot.tier === 'bloomer'
        ? 'gm. i\'m ' + (persona.name || 'Bloomer') + ' — i build. ask for code, plans, copy or hype, or send /meme <idea> for an image. (runs on the owner\'s credits.)'
        : 'gm. i\'m ' + (persona.name || 'your Doomer') + '. vent to me about the trenches — i\'m here for the cope.';
      await tg(token, 'sendMessage', { chat_id: chatId, text: hi });
      return res.status(200).json({ ok: true });
    }

    if (bot.tier === 'bloomer') {
      const owner = bot.owner;
      const imgCmd = text.match(/^\/(meme|image|img|draw|pic)\b\s*([\s\S]*)/i);
      const action = imgCmd ? 'art' : 'chat';
      const spec = ACTIONS[action] || ACTIONS.chat;
      const micro = Math.round(spec.usd * 1e6);
      if (!(await rateLimit('tgb:' + botId + ':' + chatId, 8, 8 / 60)).allowed) return res.status(200).json({ ok: true });
      if ((await getBalance(owner)) < micro) { await tg(token, 'sendMessage', { chat_id: chatId, text: '\u26a1 this bot\'s credits are empty — the owner can top up at ai.mojakcto.xyz to keep it running.' }); return res.status(200).json({ ok: true }); }
      await debitBalance(owner, micro);
      try {
        if (imgCmd) {
          const prompt = ((imgCmd[2] || '').trim() || 'a purple feels-guy meme').slice(0, 500);
          await tg(token, 'sendChatAction', { chat_id: chatId, action: 'upload_photo' }).catch(() => {});
          const img = await genImage({ prompt, n: 1 });
          if (img.images && img.images.length) { await track({ revenueMicro: micro, costMicro: imageCostMicro(img.model, img.n), tier: 'bloomer', action: 'tgimg' }); await tgPhoto(token, chatId, img.images[0]); }
          else { await creditBalance(owner, micro); await tg(token, 'sendMessage', { chat_id: chatId, text: 'image failed — refunded, try again.' }); }
        } else {
          const out = await chatLLM({ tier: 'bloomer', maxTokens: spec.max, messages: [{ role: 'system', content: BLOOMER_SYS }, { role: 'user', content: text.slice(0, 2000) }] });
          await track({ revenueMicro: micro, costMicro: textCostMicro(out.model, out.usage), tier: 'bloomer', action: 'tg' });
          await tg(token, 'sendMessage', { chat_id: chatId, text: out.text || '...' });
        }
      } catch (e) { await creditBalance(owner, micro).catch(() => {}); await tg(token, 'sendMessage', { chat_id: chatId, text: 'hiccup — refunded, try again.' }).catch(() => {}); }
      return res.status(200).json({ ok: true });
    }

    const rl = await rateLimit('tg:' + botId + ':' + chatId, 15, 15 / 60);
    if (!rl.allowed) return res.status(200).json({ ok: true });
    const out = await chatLLM({ tier: 'doomer', maxTokens: 350, messages: [{ role: 'system', content: buildDoomerSystem(persona) }, { role: 'user', content: text.slice(0, 2000) }] });
    await track({ costMicro: textCostMicro(out.model, out.usage), tier: 'doomer', action: 'tg' });
    await tg(token, 'sendMessage', { chat_id: chatId, text: out.text || '...' });
  } catch (e) {
    await tg(token, 'sendMessage', { chat_id: chatId, text: 'brain lagged, try again 😵‍💫' }).catch(() => {});
  }
  return res.status(200).json({ ok: true });
}
