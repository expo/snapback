# Clique sweep ops: 14 of 21 lanes burned on model credentials; provider packets need end-to-end preflight

**Filed:** 2026-08-15 · **Source:** clique-0121 exploratory sweep (LA Durand,
`~/clique-0121-20260814`) · **Systems:** Benchmark harness / sweep ops

**Related:** `issues/20260727-backend-bakeoff-improvement-program.md`,
LLP 0201 (Clique benchmark), LLP 0236 (cross-model authoring friction)

## Problem

The 2026-08-14 sweep planned 21 lanes (3 models × 7 backends) and got valid
builds from 7:

- All 7 `opus5-*` lanes exited in ~3–4 s with zero tokens: the Claude OAuth
  access token had expired before the sweep reached them. The companion
  retry LaunchAgent (`com.snapback.clique-0121-opus-retry`) is still
  looping every 300 s on a failing auth preflight (checked 2026-08-15
  ~17:20Z) — it needs a human `claude` re-login on the box and will
  otherwise spin indefinitely.
- All 7 `grok46-*` lanes exited in ~1–2 s: the grok CLI was not signed in
  ("run `grok login --device-code` … or set `XAI_API_KEY`").
- The `sol-supabase` lane aborted at M1 because the provider packet's
  Supabase block had hosted data-plane keys but no DDL-capable credential
  (no PAT / management token), so no schema could ever be installed. The
  lane correctly refused to fake it.

The sequencer's serial design meant these were discovered hours into the
run. All of this is recoverable — the lanes are idempotent and the retry
scaffolding exists — but the next sweep should not be able to start in this
state.

## Suggested fix

1. Sequencer preflight, before lane 1: one real mini-completion per model
   credential and one real DDL-capable operation per provider packet
   (create+drop a probe object). Refuse to start, loudly, listing every
   failing credential.
2. Bound the retry agent: N failed preflights → surface a visible ticket /
   notification instead of silent 5-minute loops.
3. For this run: re-auth Claude and Grok on Durand and let the idempotent
   sequencer fill the 14 missing cells; fix or re-scope the Supabase
   packet. The instrument, prompts, and receipts are already in place.
