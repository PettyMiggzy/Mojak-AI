# MOJAK AI — Backend Deep Audit Report

**Target:** `PettyMiggzy/Mojak-AI` @ `main` — everything under `/api` (6 endpoints + 9 `_lib` modules).
**Method:** Full read of every backend file, three review passes, plus a local logic test harness
(in-memory store path, cost math, AES-GCM roundtrip, crisis regex, dedupe retry semantics — all pass).
**Why this lives here:** this session is scoped to `pettymiggzy/dirty-jenny` and cannot push to
`Mojak-AI`. The fixes are delivered as `mojak-backend-audit.patch` (verified to apply cleanly on a
fresh `Mojak-AI` clone with `git apply`).

## How to apply
```bash
git clone https://github.com/PettyMiggzy/Mojak-AI.git
cd Mojak-AI
git apply /path/to/mojak-backend-audit.patch
# review, then commit
```

---

## Findings & fixes

### 1. HIGH — `seenTx` consumed the tx hash *before* on-chain verification (`meter.js`, `unlock.js`)
`seenTx()` performs an atomic Redis `SADD` — it **marks the hash as used as a side effect**. Both
`/api/meter?op=credit` and `/api/unlock?op=claim` called it as the *first* step, before
`verifyNativeTransfer` / `verifyErc20Transfer`.

**Impact (loss of funds / access):** any transient verification failure — RPC lag, `not enough
confirmations` (very common: users submit right after depositing), or a CoinGecko price hiccup —
still burned the hash. The legitimate deposit could then **never be credited** (`409 tx already
credited`), and a real 5,000-MOJAK burn could **never unlock** (`409 tx already used`). Real money
and real burns, permanently stuck.

**Fix:** verify on-chain first; only claim the hash (`seenTx`) once the deposit/burn is known-good,
immediately before the credit/unlock write. Added `unseenTx()` (Redis `SREM` / in-memory delete) and
wrapped the write so that if it fails the hash is released for retry. Atomic `SADD` still prevents
double-credit on concurrent submissions.

### 2. MEDIUM — provider identity leaked via error responses (`chat.js`)
The catch-all returned `detail: String(e.message).slice(0,200)`. On an upstream model error `llm.js`
throws `LLM 401 <body>` where the body can name the provider (e.g. an OpenAI 401 payload). This
violates the stated rule that model providers are never named to users.

**Fix:** log full detail server-side (`console.error`), return a generic `model unavailable` to the
client.

### 3. MEDIUM — `/api/tg?op=register` had no CORS handling (`tg.js`)
`register` is intended to be called from the browser (unlock-gated), but the handler never processed
the `OPTIONS` preflight or set `Access-Control-Allow-Origin`. A real browser `fetch` (JSON body ⇒
non-simple request ⇒ preflight) would fail before reaching the handler.

**Fix:** call `cors(req,res)` at the top of the `register` branch only. The webhook path stays
server-to-server (Telegram sends no `Origin`) and intentionally skips CORS.

### 4. MEDIUM — image action charged for zero images (`chat.js`)
`genImage` filters results to valid `b64_json`/`url`. If the provider returns a payload with neither,
`images` is `[]` but the user was still debited $0.10 and got nothing.

**Fix:** throw when `img.images` is empty so the existing refund path runs — never charge for nothing.

### 5. MEDIUM — free-tier rate limit trivially bypassable (`cors.js` `clientIp`)
Keyed off the left-most `x-forwarded-for`, which a client can prepend to forge/rotate "IPs" and bypass
the free Doomer limit (operator absorbs the LLM cost).

**Fix:** prefer the platform-set `x-real-ip` (Vercel overwrites it, so it can't be forged), fall back
to `x-forwarded-for` then the socket. Documented that IP-keyed limits are best-effort; money-gated
paths already key on wallet, not IP.

### 6. LOW — `verifyErc20Transfer` could throw on malformed logs (`chain.js`)
`log.topics[2]` was indexed without checking `topics.length`. A non-standard event sharing the
Transfer signature with < 3 topics would throw `TypeError` instead of being skipped.

**Fix:** `if ((log.topics?.length || 0) < 3) continue;` before indexing.

### 7. LOW — `/api/health` misreported `doomer`/`bloomer` readiness (`health.js`)
It checked `GROQ_API_KEY`/`OPENROUTER_API_KEY` for doomer regardless of `DOOMER_PROVIDER`. With
`DOOMER_PROVIDER=openai` it would report `doomer:false` while doomer actually worked.

**Fix:** mirror `llm.js`'s provider→key map and report readiness for the *configured* provider.

### 8. LOW — admin dashboard header blocked by CORS (`cors.js`)
`Access-Control-Allow-Headers` only allowed `Content-Type`, so a browser admin dashboard sending
`x-admin-key` would fail preflight (query-param `?key=` still worked).

**Fix:** allow `x-admin-key` too.

### 9. LOW — unbounded owner-supplied `persona` stored & injected (`tg.js`)
`persona` was stored as raw `JSON.stringify(persona)` and later interpolated into the bot's system
prompt. Unlock-gated (expensive to abuse) but unbounded.

**Fix:** normalize to `{ name: ≤40 chars, traits: ≤8 × ≤40 chars }` before storing.

### 10. LOW — unknown `action` skewed accounting (`chat.js`)
An unrecognized `action` fell back to chat pricing but was recorded verbatim in stats
(`calls:bloomer:<garbage>`), which `getStats()` never sums.

**Fix:** normalize to a known action and track that.

---

## Reviewed and confirmed correct (no change)
- **`cryptobox.js`** — AES-256-GCM, 12-byte IV, 16-byte tag, 32-byte key enforced. Roundtrip verified.
- **`store.js` token bucket** — atomic Lua `EVAL`; `debitBalance` is conservative (DECRBY + refund-if-negative), never overspends. Verified.
- **`rates.js`** — `micro = tokens × ($/1M)` and `image = $ × n × 1e6` are dimensionally correct. Verified.
- **`crisis.js`** — regex prefilter → free moderation, fails toward care on any error/missing key; runs before any model call in both `chat.js` and `tg.js`.
- **`admin.js` / `tg.js` secret** — `timingSafeEqual` with length pre-check; 401 when key unset.
- **`index.html` live Doomer path** — normal replies rendered via `textContent` (no XSS); only the static server crisis constant uses `innerHTML`.

## Documented design tradeoffs (not bugs — already noted in AUDIT.md)
- `MIN_CONFIRMATIONS=2` is shallow for deep-reorg safety (config knob; raise per risk tolerance).
- In-memory store fallback is non-persistent & not cross-instance safe — **Redis is required in prod** (already warned at startup).
- Only direct native transfers are detected for deposits; contract-routed deposits are out of scope.
- `Number(value)/1e18` in `meter.js credit` is fine for realistic deposit sizes.

## Verification performed
- `node --check` on all 15 backend files — pass (before and after patch).
- Logic harness (in-memory): dedupe claim/release, no-overspend debit, cost math, AES-GCM roundtrip,
  crisis regex true/false cases, and the verify-then-dedupe retry flow — all pass.
- `git apply --check` on a fresh `Mojak-AI` clone — applies cleanly; files valid post-patch.
