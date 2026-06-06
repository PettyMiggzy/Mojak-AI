# COPE AGENTS — Build-Feasibility & Cost-Minimization Research

> One brand, one token (**MOJAK**), two agents. Cheapest viable build on the existing
> Dirty Jenny stack (Vercel zero-dep serverless + static HTML, Monad mainnet chain 143).
> Research pass: **June 2026**. All prices/addresses verified against the sources listed
> at the bottom; anything that couldn't be independently confirmed is **flagged inline**.

---

## 0. TL;DR — the cheapest stack that actually works

| Layer | Cheapest viable choice | Cost |
|---|---|---|
| **Cope tier model (Product A)** | Groq **Llama 3.1 8B** (`$0.05`/`$0.08` per Mtok) | **~$0.0000136 / message** (~$13.60 per *million* msgs) |
| Cope tier — dev/early | **Cerebras free tier** (1M tok/day) or Groq free tier | **$0** up to ~4,300 msgs/day |
| **Smart tier model (Product B)** | **GPT-5 mini** (`$0.25`/`$2.00`) or **Gemini 3 Flash** (`$0.50`/`$3.00`) | ~$0.005 / worst-case action |
| **Hosting / wrapper API** | Stay on **Vercel** (repo already there); CPU-time billing favors I/O-wait wrappers | $0 Hobby → $20/mo Pro |
| Telegram webhook (optional split) | **Cloudflare Workers free** (100k req/day, always warm) | $0 |
| **State (meter, KB, rate limits, banlist)** | **Supabase free** (already an env option in repo) | $0 (watch 7-day pause) |
| **Crisis classifier** | **OpenAI Moderation API** (`self-harm/intent`) | **$0 — free, off usage limits** |
| **MON/USD price** | CoinGecko (`monad`) + on-chain Uniswap V3 TWAP fallback | $0 |
| **Template deploys** | **EIP-1167 clone factory** (OZ `Clones`) | gas only |

**Bottom line:** Product A runs at effectively zero marginal cost — a Mojak burn-to-unlock
model is more than enough to cover it. Product B has real per-action cost, so it needs the
**meter** (charge-before-act, USD-pegged, hard token cap). Both are buildable on the
existing Vercel + Monad codebase with **no new runtime dependencies** beyond HTTP calls.

---

## 1. Model costs — both tiers (verified June 2026)

### Cope tier (Product A) — short "cope chatter", ~150 in + 80 out tokens/msg

| Provider / model | $/Mtok in | $/Mtok out | Per-msg | Notes |
|---|---|---|---|---|
| **Groq Llama 3.1 8B** ✅ cheapest paid | 0.05 | 0.08 | **$0.0000136** | 30 RPM / ~1k RPD free tier; batch+cache ~½ |
| Groq Llama 3.3 70B | 0.59 | 0.79 | $0.000152 | step-up quality |
| **Cerebras free** ✅ most free volume | — | — | **$0** | 1M tok/day, 30 RPM, no card (8k ctx cap on free) |
| DeepSeek V3 | 0.14 | 0.28 | $0.000043 | off-peak 50% off; cache 10% |
| Gemini 2.5 Flash-Lite | 0.10 | 0.40 | $0.000047 | free tier in AI Studio |
| Gemini 3 Flash | 0.50 | 3.00 | $0.000315 | free tier in AI Studio |
| OpenRouter `:free` models | 0 | 0 | $0 | 20 RPM; 50/day (<10 credits) or 1,000/day |

**Recommendation:** Groq Llama 3.1 8B as the paid default (cheapest at scale + low latency);
Cerebras/Groq/OpenRouter free tiers to drive dev and early-user cost to **$0**. Keep a
provider abstraction so you can fail over (see §10).

### Smart tier (Product B) — codegen / dev guidance

| Model | $/Mtok in | $/Mtok out | Verdict |
|---|---|---|---|
| GPT-4o-mini | 0.15 | 0.60 | cheapest overall, but weakest codegen — fallback only |
| **GPT-5 mini** ✅ | 0.25 | 2.00 | **best $/capability** for the smart tier |
| GPT-5 nano | 0.05 | 0.40 | cheap, lighter reasoning |
| **Gemini 3 Flash** ✅ | 0.50 | 3.00 | strong, huge context, great value |
| Claude Haiku 4.5 | 1.00 | 5.00 | capable coder, cheapest Claude (200k ctx) |
| GPT-5 | 1.25 | 10.00 | hardest reasoning, step-up |
| Gemini 3.1 Pro | 2.00 | 12.00 | step-up, 200k+ ctx |
| Claude Sonnet 4.6 | 3.00 | 15.00 | step-up, 1M ctx |

**Recommendation:** GPT-5 mini **or** Gemini 3 Flash as the default smart brain; route the
hardest deploys/audits to GPT-5 / Sonnet 4.6 and bill those as a premium action.

> ⚠️ **Flagged:** A GPT-5.4 / 5.5 family appeared in third-party trackers
> (5.4-mini ≈ `$0.75`/`$4.50`) but could **not** be confirmed on openai.com — verify before
> relying on it. DeepSeek/Together/Gemini third-party rates should be cross-checked on the
> official pricing pages. Claude prices are authoritative.

---

## 2. The METER — charge-before-act, USD-pegged, hard-capped (mission-critical)

This is the single thing that protects your key. Design:

1. **Price each action to a USD target, not a fixed MON amount.** Pull live MON/USD and
   convert at request time so a MON dump can't flip your margin negative.
2. **Charge before the action runs.** Debit/verify MON (or a credit balance funded by MON)
   *before* calling the upstream model. No upstream call on an unpaid request, ever.
3. **Hard-cap per-call token usage.** Set `max_tokens` (output) and a max input/context per
   action so worst-case cost is bounded and known. Price = worst-case cost × margin.
4. **Per-wallet rate + spend caps** on top (see §9), so a single wallet can't drain the key.

**Worst-case pricing math (example, GPT-5 mini smart action):**
- Worst case ≈ 4k input + 2k output → `(4000×0.25 + 2000×2.00)/1e6 = $0.005`.
- Charge a **$0.05–0.10 USD target** per smart action → **10–20× margin** (covers image/codegen
  spikes, moderation, overhead, and funds the burn loop).
- At MON ≈ `$0.021`: `$0.05 / 0.021 ≈ 2.4 MON` — **recalculated live each request.**

**Live MON/USD price sources (cheapest → most robust):**
- **CoinGecko** — coin id `monad`: `GET /api/v3/simple/price?ids=monad&vs_currencies=usd`
  (free; Pro endpoint + `x-cg-pro-api-key` for higher limits). Cache ~30–60s.
- **On-chain Uniswap V3 TWAP** (WMON/USDC pool `observe()`) — manipulation-resistant fallback
  if CoinGecko is down or lagging.
- **Pyth / Chainlink** MON/USD feeds exist on Monad mainnet but the exact Pyth mainnet feed ID
  was **not confirmed** (only a beta feed documented) — verify before wiring. ⚠️
- **Pattern:** primary = CoinGecko (cheap, simple), sanity-check against TWAP, add a
  staleness guard (reject/await if the last good price is older than N seconds).

---

## 3. Cope tier ≠ meter — use Mojak burn-to-unlock

Because the cope agent is near-free to run, **don't meter it per message** — gate it by a
one-time (or tier-based) **Mojak burn** to create/unlock/customize the persona. Cheapest patterns:

1. **Off-chain proof-of-burn (cheapest, no contract):** user sends MOJAK to the dead address
   `0x…dEaD`; backend reads the burn tx on-chain, dedupes by tx hash (replay guard), unlocks
   the persona off-chain. Note: transfer-to-dead does **not** reduce `totalSupply`.
2. **On-chain burn (trustless):** a contract pulls + `burnFrom` after `approve`, emits an
   event, sets `unlocked[user]=true`. Costs gas + a contract, but verifiable.
3. **Hold-gating (contrast only):** require a minimum balance — reversible, not a true burn.
   (The repo already does balance-gating in the radar/HIV feature, so the plumbing exists.)

**Mojak loop (Product B):** MON collected by the meter → covers API cost → **margin buys +
burns MOJAK** (`burn()` if `ERC20Burnable`, else transfer to `0x…dEaD`). Cope agent: direct
burn-to-unlock, since running cost ≈ $0.

---

## 4. Hosting & the Telegram BYO-bot (multi-tenant)

### Where to run it
- **Vercel (recommended — you're already here):** Hobby free; Pro $20/mo. Functions now billed
  on **active CPU + memory time**, and **I/O wait (awaiting model/DB) does NOT count as active
  CPU** — ideal for a wrapper that mostly waits on upstream. Function max duration 300s (Hobby),
  up to 800s (Pro). 4.5 MB request/response cap (stream large Telegram media around it).
- **Cloudflare Workers free (optional split for webhooks):** 100k req/day, always warm, no
  cold-deploy cost, no egress charge; 10ms CPU free (fine for a thin webhook that offloads work).
  Good if Telegram webhook volume gets noisy and you want to keep it off Vercel's budget.
- Avoid for this: Railway/Fly (no real free tier in 2026), Supabase Edge (free projects pause
  after 7 days idle — bad for a bot backend unless kept warm).

### Telegram BYO-bot — confirmed feasible, multi-tenant on one endpoint
- **Use webhooks, not long-polling.** Polling needs a persistent process (incompatible with
  serverless billing). `setWebhook` auto-disables `getUpdates`. HTTPS on port 443/80/88/8443.
- **Routing many user bots through one endpoint:** put an **opaque `botId`** (not the raw token)
  in the webhook path: `https://yourapp/api/tg/{botId}`. The update body does **not** contain the
  token, so routing must come from the path. Telegram's FAQ explicitly endorses a secret path.
- **Authenticity:** set a per-bot **`secret_token`** in `setWebhook`; Telegram echoes it in the
  `X-Telegram-Bot-Api-Secret-Token` header on every call — constant-time compare to verify.
  (Telegram does **not** sign/HMAC the body; the secret header + secret path are the only built-in
  signals. Published Telegram IP ranges are **not** official — don't rely on IP allowlists alone. ⚠️)
- **Token storage:** encrypt at rest, key by tenant, never log, never expose to the browser.
- **Rate limits are per-bot** (~1 msg/s per chat, 20/min per group, ~30/s global) — so BYO
  naturally distributes load; *your host* limits are the real bottleneck, not Telegram's.

**BYO-bot flow:** user pastes @BotFather token → backend encrypts + stores → calls `setWebhook`
with `{opaqueBotId}` path + random `secret_token` → each update: resolve tenant from path, verify
header, decrypt token, run cope/co-pilot logic, reply via Bot API.

---

## 5. Curated Monad knowledge base (the moat)

Keep these as a **maintained KB the agent reads from** — never trust the model's stale training.

**Confirmed (high confidence):**
- **Mainnet LIVE** (launched Nov 24, 2025). **Chain ID = 143** ✅ (testnet is 10143 — don't confuse).
- Native token **MON** (initial supply 100B; gas + staking).
- **Public RPCs:** `rpc.monad.xyz` (QuickNode, 25 rps), `rpc1.monad.xyz` (Alchemy, 15 rps),
  `rpc2.monad.xyz` (Goldsky), `rpc3.monad.xyz` (Ankr), `rpc-mainnet.monadinfra.com`.
  WSS equivalents exist. (Repo already proxies RPC via `MONAD_RPC` env — keep that pattern.)
- **Explorers:** monadvision.com, monadscan.com, monad.socialscan.io.
- **Uniswap V3 deployed** (from Uniswap's own deploy docs — re-verify on-chain before prod):
  - Factory `0x204faca1764b154221e35c0d20abb3c525710498`
  - SwapRouter02 `0xfe31f71c1b106eac32f1a19239c9a9a72ddfb900`
  - UniversalRouter `0x0d97dc33264bfc1c226207428a79b26757fb9dc3`
  - QuoterV2 `0x661e93cca42afacb172121ef892830ca3b70f08d`
  - NonfungiblePositionManager `0x7197e214c0b767cfb76fb734ab638e2c192f4e53`
  - Permit2 `0x000000000022D473030F116dDEE9F6B43aC78BA3` (canonical, all chains)
  - WMON `0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A`
- **DexScreener** supports Monad (chain slug `monad`); lists nad.fun, Uniswap, PancakeSwap, OctoSwap.
- **Bridges:** official **Monad Native Bridge (Wormhole)** at monadbridge.com; also LayerZero,
  Axelar, Hyperlane, deBridge.
- **Contract verification:** Explorer UI, Foundry (`forge verify-contract`), or Hardhat; a unified
  verification API can hit all three explorers. (Verify the current **mainnet** verifier URL —
  the documented Sourcify-style endpoint example was testnet. ⚠️)

**nad.fun:** Monad's pump.fun-style bonding-curve launchpad; tokens graduate to Uniswap V3 at
~432 MON mcap. Read the correct router via its **Lens contract** rather than hardcoding routers.
⚠️ **Specific nad.fun contract addresses NOT confirmed** — pull from the Naddotfun GitHub and
verify on an explorer before use. (Repo already proxies nad.fun reads via `api/nadfun.js`.)

**KB maintenance:** store as versioned JSON/markdown in-repo (e.g. `docs/monad-kb.json`), inject
relevant slices into the system prompt per query, and treat every address as "verify on-chain
before any write/deploy." This is the moat — keep it current.

---

## 6. Template-deploy rails (only audited templates auto-ship)

- **Pattern: EIP-1167 minimal-proxy "clones" from a curated factory** (OpenZeppelin `Clones`).
  A tiny proxy delegatecalls a **fixed, pre-audited implementation**; the AI/user only supplies
  **initializer parameters**, never new bytecode.
- Factory **whitelists** which implementations can be cloned; params are **validated/bounded
  on-chain**. Clones can't use constructors → use a re-init-guarded `initialize(...)` (OZ
  `Initializable`).
- **Result:** the AI can only instantiate vetted templates (token / claim / buybot) with
  constrained params, and can **never free-write or auto-ship arbitrary contract code**. Raw
  AI-written Solidity stays **guide-only** (Product B's GUIDES mode), never auto-deployed.
- Repo already ships an audited `contracts/BuildABitch.sol` + `api/deployer.js` — extend that into
  the factory/clone model rather than letting the model emit deployable bytecode.

---

## 7. Crisis tripwire (Product A) — narrow, cheap, supported

The exact behavior you specced is buildable and cheap. **Two-stage design:**

1. **Cheap regex/keyword prefilter** flags *candidate* messages only (catches phrasing; does not
   itself trigger the care response).
2. **Free classifier on candidates:** OpenAI **Moderation API** (`omni-moderation-latest`) — it's
   **free and doesn't count against usage limits** — has a dedicated **`self-harm/intent`** category
   ("user expresses they are engaging or intend to engage in self-harm"), which is almost exactly
   the tripwire signal. Use a high threshold to separate genuine intent from dark trader humor.
3. **On genuine intent:** drop the bit, respond with care, surface resources, then resume normal
   savage mode afterward.

**Why not keyword-only:** research (the "Just a Scratch" paper; clinical classification studies)
confirms lexical matching can't separate hyperbole ("gonna kms after that rug") from serious
intent — even good classifiers misjudge ~1 in 10. For an *edgy* bot whose users expect dark humor,
false positives are especially damaging, so the free classifier gate is worth it.

**Resources to surface (triple-checked, current):**
- **US: call or text `988`** (Suicide & Crisis Lifeline; legacy `1-800-273-8255` still routes there).
- **Text `HOME` to `741741`** (Crisis Text Line, US).
- **Outside the US: findahelpline.com** (vetted global directory); befrienders.org as backup.
- **Immediate danger: call 911 / local emergency services.**

**Disclaimer posture (industry-standard, not legal advice — have a lawyer review final ToS):**
state the bot is **not a substitute for professional care**, is **not monitored in real time by a
human**, and direct at-risk users to 988 / emergency services. Detect → surface resources →
disclaim → hand off; never imply clinical capability or rescue.

---

## 8. Moderation / abuse (protect the shared key)

- **Rate limit with a token bucket per wallet/user/IP** (predictable average + controlled bursts).
  **Avoid fixed-window** (boundary amplification lets a user send ~2× the limit at the reset edge).
- **Free content filter:** the same OpenAI Moderation API doubles as a general filter at $0.
  Azure AI Content Safety (free tier, then ~$0.001/req) is a paid fallback. ⚠️ verify Azure price.
- **Partition counters by key** (wallet/user/IP), not one global counter; **banlist** abusive
  wallets (the repo already has banlist/gating infra to reuse).
- Return `429` with `RateLimit-*` and `Retry-After` headers. Cheapest robust store = Supabase
  (already a repo env option) or Redis token-bucket keyed per wallet.

---

## 9. ToS / legal (so the account doesn't get nuked)

- **Wrappers are explicitly ALLOWED.** OpenAI Services Agreement **§2.2** grants the right to
  "integrate the Services into Customer Applications and to make Customer Applications available
  to End Users." Groq Services Agreement **§3.1** says the same. End users hitting the model
  *through your product* is fine.
- **Reselling raw access is PROHIBITED.** OpenAI **§3.1** ("may not resell or lease access to its
  Account") and **§3.3(g)** (no buying/selling/transferring API keys); Groq **§3.2 / §6.3(c)**
  (no resell/sublicense except via the §18 authorized-reseller path). **A thin pass-through proxy
  for a markup = the classic violation.** Your product layer (personas, meter, KB, Monad tooling)
  is what makes it a "Customer Application," not a reseller.
- **You're responsible for your end users.** OpenAI **§3.2 / §8.1** — must obtain consents,
  must suspend abusive end users on request, must not circumvent rate limits (**§3.3(h)–(i)**).
  → This is exactly why §8's moderation + per-wallet caps are non-optional.
- **Disclose AI use.** OpenAI Usage Policies require "clear disclosure that AI is being used" and
  bar high-stakes **financial** automation without human review — relevant to a crypto co-pilot;
  keep it advisory + GUIDES mode, user signs everything. ⚠️ exact wording behind a 403, verify live.
  Groq **§6.3(f)** bars stripping AI provenance/watermark metadata.
- **Keep an open-model fallback.** Both providers can suspend/terminate (OpenAI §8.1) or unilaterally
  modify the service (§2.3). A self-hosted/loose-terms open model (Llama/Mistral, or Groq/OpenRouter
  open models) removes the single point of failure if an account is throttled or banned.

> ⚠️ Verbatim clauses pulled from OpenAI's CDN PDF and Groq's docs (high confidence). The OpenAI
> *Usage Policies* HTML 403s to bots — confirm exact disclosure/financial wording on the live page.
> An alleged Groq "April-2026 §1.5(c) service-bureau" clause was **not** confirmable — disregard
> until verified.

---

## 10. Risks locked in (from the brief, with the mitigation)

| # | Risk | Mitigation (researched) |
|---|---|---|
| 1 | Key bleeds from unmetered calls | **Charge-before-act + hard token cap + per-wallet rate/spend caps** (§2, §8) |
| 2 | MON volatility flips margin negative | **USD-pegged pricing recalced from live MON/USD** each request; staleness guard (§2) |
| 3 | Unsafe auto-deploys | **EIP-1167 clone factory, audited templates only; raw AI Solidity is guide-only** (§6) |
| 4 | Edgy bot mishandles real crisis | **Regex prefilter → free Moderation `self-harm/intent` → care + 988/741741/findahelpline** (§7) |
| 5 | Guidance confidently wrong (stale LLM) | **Curated in-repo Monad KB injected per query; verify addresses on-chain** (§5) |
| 6 | Provider ToS / ban risk | **Build as a Customer Application (allowed), moderate end users, keep open-model fallback** (§9) |
| 7 | Telegram token leakage (BYO) | **Encrypt at rest, opaque botId in path, per-bot secret_token header verify** (§4) |

---

## 11. Concrete cheapest-build stack (tailored to this repo)

**Reuse what's already here:** Vercel zero-dep serverless functions, the proxy pattern
(`api/rpc.js`, `api/nadfun.js`), origin guards/allowlists, optional Supabase, RPC-via-env,
balance-gating, and `contracts/BuildABitch.sol` + `api/deployer.js`.

**Add (no new runtime deps — all plain `fetch`):**
1. `api/llm.js` — **wrapper API**: provider-abstracted (`groq` | `openai` | `gemini` | `openrouter`),
   keys in env, hard `max_tokens` cap, origin guard. Cope tier → Groq 8B; smart tier → GPT-5 mini.
2. `api/meter.js` — **charge-before-act meter**: live MON/USD (CoinGecko + TWAP fallback),
   USD-target → MON conversion, per-wallet spend/rate caps, debit before forwarding to `llm.js`.
3. `api/tg.js` (or a Cloudflare Worker) — **Telegram BYO-bot webhook**: `/api/tg/{botId}`,
   `secret_token` header verify, encrypted token store (Supabase), routes to cope/co-pilot logic.
4. `api/crisis.js` — **tripwire**: regex prefilter → free OpenAI Moderation `self-harm/intent` →
   care response payload (988 / HOME 741741 / findahelpline).
5. `docs/monad-kb.json` — **curated KB** (addresses, RPCs, steps) injected into prompts.
6. `contracts/` factory — **EIP-1167 clone factory** wrapping the audited templates; AI fills
   params only; Mojak `burn()` integration for the loop.
7. Web chat widget on the site + the BYO-token plug-in (both products offer it).

**Cost at launch:** $0 (free tiers) → ~$20/mo (Vercel Pro) at scale. Product A funded by Mojak
burns; Product B funded by the USD-pegged MON meter with 10–20× margin feeding the burn loop.

---

## Sources

**Models/pricing:** groq.com/pricing · console.groq.com/docs/rate-limits · cerebras.ai/pricing ·
api-docs.deepseek.com/quick_start/pricing · ai.google.dev/gemini-api/docs/pricing ·
together.ai/pricing · openrouter.ai/docs · developers.openai.com/api/docs/pricing ·
openai.com/api/pricing
**Hosting/Telegram:** vercel.com/docs/functions/limitations · vercel.com/pricing ·
developers.cloudflare.com/workers/platform/limits · deno.com/deploy/pricing · supabase.com/pricing ·
railway.com/pricing · fly.io/pricing · core.telegram.org/bots/api#setwebhook · core.telegram.org/bots/faq
**Monad:** docs.monad.xyz/developer-essentials/network-information ·
developers.uniswap.org/contracts/v3/reference/deployments/monad-deployments ·
docs.monad.xyz/tooling-and-infra/oracles · docs.monad.xyz/tooling-and-infra/cross-chain ·
docs.monad.xyz/guides/verify-smart-contract/foundry ·
wormhole.com/blog/monad-is-live-with-native-bridge-powered-by-wormhole · coingecko.com/en/coins/monad ·
docs.coingecko.com/reference/simple-price · data.chain.link/feeds/monad/monad/mon-usd · dexscreener.com/monad
**Crisis/moderation:** arxiv.org/html/2506.05073v1 · ncbi.nlm.nih.gov/pmc/articles/PMC12881907 ·
988lifeline.org · samhsa.gov/mental-health/988 · crisistextline.org · findahelpline.com · befrienders.org ·
developers.openai.com/api/docs/guides/moderation · help.openai.com/en/articles/4936833 ·
azure.microsoft.com/en-us/pricing/details/content-safety ·
blog.arcjet.com/rate-limiting-algorithms-token-bucket-vs-sliding-window-vs-fixed-window
**Legal:** cdn.openai.com/osa/openai-services-agreement.pdf (§2.2, §3.1, §3.2, §3.3, §8.1, §2.3) ·
openai.com/policies/usage-policies · console.groq.com/docs/legal/services-agreement (§3.1, §3.2, §6.3, §18) ·
console.groq.com/docs/legal/ai-policy

> **Verify-before-prod checklist:** GPT-5.x sub-tier prices · nad.fun contract addresses ·
> Pyth MON/USD mainnet feed ID · Chainlink MON/USD aggregator address · Monad mainnet verifier URL ·
> all Uniswap addresses on-chain · OpenAI Usage Policies exact wording · Azure Content Safety price.
