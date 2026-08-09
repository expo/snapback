# snapback verify trust gaps: vacuous green, foreign codes in receipts, schema never validates

**Status:** Open
**Opened:** 2026-08-08 · **Severity:** P1 · **Area:** snapback-cli verify.mjs / verify-receipt schema / guide/testing/verify.md

From the 2026-08-08 agentic surface audit (LLP 0202 theme 6). The verify
receipt's identity binding is genuinely strong (pre-execution byte digests,
0600 atomic writes, identity-incomplete hard gate); these gaps are at the
seams around it:

1. **Bare `snapback verify` is a vacuous green.** With no `--config` the CLI
   substitutes `defaultVerifyConfig` — zero profiles
   (`packages/snapback-cli/index.mjs:3554`; `verify.mjs:383-392`);
   `not-claimed` is in the passing set (`:879`); receipt is
   `ok: true, status: 'passed'`, exit 0, no acceptance evidence. Every
   shipped template carries the convention file
   (`templates/*/snapback.verify.config.mjs`) but it is never
   auto-discovered — so the obvious command in a scaffolded app proves
   nothing while looking green. Fix: auto-discover the convention config;
   when genuinely zero profiles register, exit non-zero or emit a
   machine-distinct `passed-without-acceptance` status.
2. **Foreign codes break the stable-code contract.** Three catch sites pass
   raw Node `error.code` into `diagnostic.code`
   (`verify.mjs:296,727,805`) — a mistyped backend dir yields
   `code: "ENOENT"` via unguarded `realpathSync` (`:363,416`); same class at
   `packages/snapback-cli/cli.mjs:9`. The schema permits it
   (`code` is only `minLength: 1`). Fix: wrap as `details.causeCode` under a
   `SNAPBACK_VERIFY_*` code (pattern already at `:860-866`); tighten the
   schema to `^SNAPBACK_[A-Z0-9_]+$`.
3. **The committed `verify-receipt.schema.json` validates nothing.**
   `validateVerifyReceipt` does three hand-rolled checks
   (`verify.mjs:952-964`); no test or runtime path loads the schema (ajv is
   already a dependency and the deploy family has key-set gates). No drift
   today (hand-diffed) — the finding is the missing gate. Fix: validate one
   real emitted receipt in `verify.test.mjs`.
4. **Target-blindness.** Stage 2 unconditionally injects the local packaged
   runtime probe (`index.mjs:3556-3573`), so a `cloudflare-do-sqlite-v8` app
   cannot reach acceptance and the recommended repair
   (`runtime-qualify --persist`) is irrelevant to its target. Fix: skip with
   an explicit non-claim when the target profile is non-local; register a
   Cloudflare acceptance adapter (remote runner exists:
   `cloudflare/test/acceptance.remote.all-aboard.mjs`).
5. **Smaller:** three of five `recommendedNext.command` values are prose and
   one carries an unfilled `<backend-dir>` placeholder (`verify.mjs:61-81`)
   — split into `command` (runnable or null) + `instruction`; no per-profile
   timeout (`:714-720`, hung profile hangs forever, no receipt) — add
   `--timeout-ms` + `SNAPBACK_VERIFY_PROFILE_TIMEOUT`; CLI help declares
   `output: 'snapback.verify.v1 receipt'` vs the real
   `snapback.verify-receipt.v1` (`index.mjs:2976`) — bind help `output:`
   strings to exported schema-version constants in a test; the CLI
   positional backend dir resolves against the config file, not cwd
   (`verify.mjs:374`) — resolve against cwd or document.
