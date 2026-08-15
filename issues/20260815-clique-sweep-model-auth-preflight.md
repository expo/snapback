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

## Status 2026-08-15 — items 1 and 2 done; item 3 blocked on two credentials

Landed in the sweep harness at `/Users/ccheever/clique-0121-20260814`, which is
not a git repository, so this ticket is the only record in version control.

**Item 1 (real preflight) — done.** `scripts/preflight.sh` previously only ran
`test -r` against credential *files*. It now performs a live mini-completion per
model credential (Claude Opus 5, GPT-5.6 Sol, Grok 4.6) and a real create+drop
DDL probe for the Supabase packet, aggregates every failure, and refuses to
start with the complete list rather than exiting at the first one. Probe
outcomes are written to `receipts/{model-*,provider-*}` beside `preflight.txt`.

**Item 2 (bounded retry) — done.** `retry-opus-after-sweep.sh` was an unbounded
`while true` at 300 s spacing. It is now capped at five failed preflights
(~20 min), after which it writes `logs/OPUS-RETRY-ACTION-REQUIRED.txt`, logs
unmistakably, emits a macOS notification, and exits 0 so launchd cannot restart
another failure cycle. `status.sh` surfaces that file. The 169 stale
per-attempt receipts were archived (not deleted) under
`receipts/archive/opus-retry-unbounded-20260815/`; future attempts overwrite one
stable receipt.

**Additional hole found and closed.** The original preflight *did* have a
`test -r "$HOME/.grok/auth.json"` and that file does not exist, yet the sweep
started anyway — so a file-existence gate was not even being enforced. The
sequencer now also runs a just-in-time model probe before each model's first
pending lane, closing the multi-hour time-of-check/time-of-use gap that let Grok
auth lapse between preflight and the grok lanes hours later.

**Correction to this ticket's diagnosis.** The ticket says the Opus lanes need
"a human `claude` re-login on the box." That is not sufficient on its own: a
direct `claude -p ... --model claude-opus-5` from an ordinary shell returned
`is_error:false` at 2026-08-15 18:12Z while the LaunchAgent's own tick three
minutes later still logged `401 OAuth access token has expired`. The credential
works; the launchd context cannot use it. Whoever picks up item 3 should expect
to fix the agent's credential access, not just re-login. The new bounded retry
means this now surfaces in ~20 minutes instead of spinning for 14 hours.

**Item 3 — still open, needs a human.** Verified by re-running the new
preflight independently (exit 70, no lane started):

- `grok` has no credential at all — `~/.grok/auth.json` is absent. Needs
  `grok login --device-code` or `XAI_API_KEY`.
- The Supabase packet has `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`
  but `SUPABASE_DB_URL` is still the literal placeholder `postgresql://...` and
  there is no PAT / management token, so DDL remains impossible. Needs a
  DDL-capable credential or a re-scope to a local Supabase deployment.

The exact operator procedure is in `~/clique-0121-20260814/RECOVERY.md`. The
sweep was deliberately not restarted and no lane status was altered. Close this
ticket once those two credentials are supplied and the sequencer has filled the
14 missing cells.

## Update 2026-08-15 (later) — grok resolved; one blocker left

Re-ran `scripts/preflight.sh` after the author supplied credentials. All three
model probes now pass live:

```
PASS model:claude-opus-5     live mini-completion returned READY
PASS model:gpt-5.6-sol       live mini-completion returned READY
PASS model:grok-4.6-build    live mini-completion returned READY
FAIL provider:supabase-ddl   SUPABASE_DB_URL is absent or a placeholder and no
                             SUPABASE_ACCESS_TOKEN/SUPABASE_MANAGEMENT_TOKEN
                             plus project ref is available
PREFLIGHT REFUSED: 1 problem(s); no lane may start
```

`~/.grok/auth.json` now exists, so the grok lanes are unblocked. The Supabase
packet is the only remaining blocker: `SUPABASE_DB_URL` in
`secrets/provider-secrets.md` is still the placeholder and no PAT / management
token is present.

A candidate credential exists at `~/Dropbox/APIKeys/supabase.txt` (113 bytes,
mode 600) but could not be read: every content read of that directory returns
`EINTR: interrupted system call`, including `ls`, which reports `total 0`.
Metadata reads succeed, the Dropbox daemon is running, and `~/Dropbox` resolves
to `~/Library/CloudStorage/Dropbox`. This is the macOS FileProvider returning
interrupted reads for unmaterialized placeholders; 12 retries over 60 s did not
hydrate it. The file must be materialized locally (open it once, or mark it
available offline) before the packet can be populated.

## Update 2026-08-15 (final) — preflight fully green; launch deferred to the author

The author supplied a Supabase personal access token via the repo's gitignored
`.agent-local-secrets.md`, and it was written into
`secrets/provider-secrets.md` as `SUPABASE_ACCESS_TOKEN` (mode 600, outside any
git repository). The probe derives the project ref from the packet's existing
`SUPABASE_URL`, so no separate ref was needed.

All four preflight gates now pass:

```
PASS model:claude-opus-5     live mini-completion returned READY
PASS model:gpt-5.6-sol       live mini-completion returned READY
PASS model:grok-4.6-build    live mini-completion returned READY
PASS provider:supabase-ddl   DDL probe created and dropped a table using the
                             Supabase Management API
preflight ok
```

`receipts/provider-supabase-ddl.json` records
`attempted/created/dropped/ok = true` — a real round-trip that cleaned up after
itself.

**Both original credential blockers are therefore closed.** What remains is
purely operational: 21 lanes have a terminal status, 7 succeeded, and the
14 authentication-failed cells are still empty. The author elected not to
launch the sequencer in this session, so that step is deliberately outstanding.

To finish, run `./scripts/run-matrix.sh` per `RECOVERY.md` §4. **Run it from an
ordinary interactive shell, not launchd** — RECOVERY.md §4 now carries the full
warning and the evidence for it. The sequencer skips the 7 successful lanes,
archives only recognized auth failures, and re-probes each model just before
that model's first pending lane.

Close this ticket once the 14 cells are filled.
