# MOJAK AI — Backend Audit Brief

Audit target: everything under `/api`. Zero runtime deps, ESM, Vercel serverless (Node 18+). Static front-end is `index.html` + `docs.html`; the Bloomer tab is still **simulated** (no wallet/deposit flow wired yet) — only `/api/chat` Doomer is called live from the UI. Backend is correct in isolation; not yet exercised end-to-end.

## What it is
One brand (MOJAK), two models. **Doomer** = free cope chat (rate-limited) + burn-to-unlock your own Telegram bot. **Bloomer** = paid builder, charge-before-act, USD-pegged credits funded by MON. Model providers are never named to users.

## Endpoints
- `api/chat.js` — Doomer (free, rate-limited) + Bloomer (debit-before-act) + image gen. Crisis check on both tiers. Records real cost + revenue per call.
- `api/meter.js` — `?op=quote|balance|credit`. `credit` verifies a MON deposit tx on-chain → USD-pegged credits (deduped).
- `api/unlock.js` — `?op=status|claim`. Verifies MOJAK→dead burn → unlock flag.
- `api/tg.js` — `?op=register` (gated by unlock; encrypts bot token; `setWebhook` w/ secret) + webhook handler (secret-token verify, crisis check, Doomer reply). Doomer-only.
- `api/admin.js` — owner-gated (`ADMIN_KEY`, timingSafeEqual) revenue/cost/margin + daily + per-action.
- `api/health.js` — config booleans only (no provider names, no secrets).

## Lib
`cors` (origin allowlist) · `store` (Upstash/Vercel KV REST + in-memory fallback: token-bucket rate limit via Lua EVAL, USD-credit balances, tx dedupe, unlock flags, bot registry, stats) · `price` (CoinGecko MON/USD + cache + staleness guard) · `chain` (raw JSON-RPC: native + ERC20 transfer verify w/ confirmations) · `prompts` (Doomer/Bloomer system + persona builder + ACTIONS price/cap table) · `crisis` (regex prefilter → free moderation → care payload) · `llm` (provider-abstracted, hard max_tokens cap, internal only) · `cryptobox` (AES-256-GCM) · `rates` (real $/token + $/image cost math).

## Money model
- Balances are integer **micro-USD** (USD-pegged). Deposits convert MON→USD at deposit-time price; actions cost fixed USD, so MON volatility can't flip margin.
- `ACTIONS` (prompts.js): chat/hype $0.05, plan $0.10, art $0.10/image, code $0.20, bot $0.25. Doomer free.
- Real cost computed from actual token usage (`rates.TEXT_RATES`) / per-image (`rates.IMAGE_COST`). Margin = revenue − cost in `getStats()`.

## PLEASE SCRUTINIZE (load-bearing)
1. **Meter atomicity (`store.js`)** — `debitBalance` = `DECRBY` then refund-if-negative (conservative, never overspends; may falsely reject a concurrent call). Token bucket = atomic Lua `EVAL`. **In-memory fallback is NOT concurrency-safe and resets on cold start — meter is unsafe without Redis.** Decide whether to hard-fail when Redis is absent.
2. **`chain.js` verification** — confirmations, `status==1`, recipient match, `seenTx` dedupe, sender==wallet. Gaps to weigh: chain reorgs; deposits routed through a contract (only direct native transfers are detected); `Number(value)/1e18` precision in `meter.js credit`.
3. **`crisis.js`** — regex → free moderation `self-harm/intent`; errs toward care on any error/missing key. Verify threshold + that it runs before any model call (it does in chat.js + tg.js).
4. **`tg.js` + `cryptobox.js`** — AES-256-GCM token-at-rest, `TOKEN_ENC_KEY` (32-byte hex) required, constant-time secret compare, opaque botId in path, register gated by burn-unlock.
5. **Key/tech exposure** — `llm.js` is internal (no public proxy endpoint). Confirm no provider/model name or key leaks via responses or error strings (errors are sliced; could still echo upstream text — tighten if needed).
6. **`admin.js`** — `ADMIN_KEY` gate via timingSafeEqual; 401 if unset.
7. **CORS / origin** — browser endpoints allowlist `ai.mojakcto.xyz` + `mojakcto.xyz`; tg webhook is server-to-server (secret header).

## Env (set in Vercel — see `.env.example`)
Min for Doomer-live: `GROQ_API_KEY` (+ `OPENAI_API_KEY` for crisis classifier). Bloomer/meter/TG also need: `OPENAI_API_KEY`, `UPSTASH_REDIS_REST_URL`/`TOKEN`, `TREASURY_ADDR`, `MOJAK_TOKEN`, `TOKEN_ENC_KEY` (`openssl rand -hex 32`), `ADMIN_KEY`. Treasury = `0xe7a31fd91a6f2ab0c73db3b7d0954a6a3acc7ab5`.

## Known not-done (frontend, out of audit scope)
Bloomer wallet connect + MON deposit + real `/api/chat` + `/api/meter` wiring + rendering returned images. Backend is ready for it.
