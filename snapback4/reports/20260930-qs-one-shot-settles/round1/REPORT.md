# QS round 1 — review corrections

Date: 2026-09-30. Branch: `sb4-intent/qs-one-shot-settles`.
Round 0: `1ba9363a63`. Fetched and merged `origin/main` at
`28014164c6979995708e758c2090e53455101134` first, in merge commit
`edd5d68fbd`. Both journal histories and both client-guide changes were kept.
No push or publication. The merge parent is authoritative: the shared remote-tracking
ref later advanced to `42ba3ffb90`; that later commit is not part of this merge.

Read the round 0 prompt/report and both complete reviews:
`~/sb4-intent/reviews/qs-r0.astra.md` and `qs-r0.grok.md`.
All five requested corrections are implemented.

## Context and boundaries

Used `llp-orient`. Scope: one-shot settlement, local evaluation metadata,
app delivery fences, mock queries, and their published guidance.
LLP 3000 is the Snapback 4 root; LLP 3000.023 §11 governs bounded settlement
and terminal precedence; LLP 3000.031 §1.1 governs the unchanged existence
classifier and pending predicate. All three are linked in `llp/current/`.
LLP 3000.016 §2.2 governs the shared evaluator and publication fences.
Read the fenced command sheet, NOT-DOING, journal, adopted rules, relevant
design brief, and current guide before editing.

Active constraints: one total four-round/30-second invocation budget
(LLP 3000.023 §11); unchanged observation/retention policy (§10); one
classifier and pending predicate (LLP 3000.031 §1.1). No new gate, registry,
core/wasm change, budget increase, or public type was needed. Hand-off: none.
The contract correction is recorded in LLP 3000.023 §11 in this commit.

## Corrections

1. **Terminal state reaches the outer decision.** The local query callback
   now includes `partitionDenied` and `changesStopped`. The existing internal
   function-identity map also exposes each raw client's terminal callback to
   its facade. This matters when the facade deadline rejects before the raw
   attempt's catch resumes, including while facade authority itself is held.
   Scope invalidation retains precedence. Tests delay actual wasm/process
   query replies, deliver a same-store regression through `/sync`, prove the
   persisted `E_STORE_RESTORE`, then fire the production deadline callback.
   The outstanding call must equal a fresh refused call. Other cases cover
   partition and change-stream refusals on all four local/facade tiers.

   The terminal audit also covers online restore/replacement during blocked
   transport and facade authority, close/sign-out on all six tiers, and real
   app logout/viewer replacement during blocked authority. Local store/schema
   resets retain their existing adoption/reread behavior; the existing reset
   suites pass. A reset that recovers is not reclassified as a terminal halt.

2. **Search and loading prose.** Stale one-shot continuations now document
   `E_QUERY_RETRY` and explicitly instruct a fresh first page. Searched every
   guide source and README under `snapback4/`; clarified reads/bounds/feeds
   statements as observation/internal unavailability and corrected the native
   smoke wording. Existing observed-loading examples and historical experiment
   reports remain valid records. `loading-audit.log` and
   `readme-loading-audit.log` preserve the scans. The tested moved-fact fixture
   follows the corrected prose; no budget or assertion was relaxed.

3. **Impossible held reads are terminal.** An acquired held loading candidate
   that actually read unsynced data, or needs ephemeral server data, with no
   pending prediction gets non-retryable `E_QUERY_HELD` in its first publication
   round. The message says to use the online path and remove `held`, or sync
   the required data. The decision uses the existing engine's actual read
   tables and shared pending state. Observations still publish loading.
   Offline unavailability remains `E_OFFLINE`; acquisition, pending writes,
   discarded publications and other genuine exhaustion retain the bounded
   retry path. The four local/facade cases assert **one** evaluation and **zero**
   held server requests, observation loading, and a successful ordinary count.
   Concurrent-write cases invalidate a candidate and successfully reread its
   now-answerable branch. Both online tiers retain their server held refusal.

4. **Decorations guidance restored.** “Keep server-needing decorations
   separate” is on the offline-interactions card. The client card retains
   main's per-milestone native smoke instructions; its device-tier/timing/sync
   links moved to offline-interactions. Client card: 1,200 words, 113 lines,
   inside both the general and native-smoke-specific limits.

5. **Mock settlement shared.** `createMockClient().query` uses `settledQuery`
   around its existing evaluator and a version publication fence. Retired
   results reread; exhaustion uses `E_QUERY_RETRY`; close/auth and thrown
   handler errors use the common refusal rules. `E_OFFLINE` applies only to
   unavailable offline reads. Its reference contract explicitly says handlers
   return values/pages, not `Read` envelopes, and the mock has no Quarry
   acquisition/server fallback. In this source, pending empty predictions are
   partial ready values rather than loading; the reference documents that
   distinction instead of treating it as evidence of an offline link.

## Regression evidence

Before product edits, built and preserved the merged SDK in
`/tmp/qs-r1-baseline-dist`. There is **no source difference** between round 0
and that merge under `packages/snapback4/src/`. The existing baseline loader
replays those bytes without replacing the active build.

`baseline-regressions-corrected.log`: all 18 initial assertions fail on round 0,
including both published-text checks. `round0-expanded-regressions.log`:
40 checks, 16 pass and **24 fail** with round 0 runtime code. The failures are
12 local terminal cases, four impossible-held cases, four outer-facade
restore/reset deadline cases, and four mock cases. Both documentation
regressions were already established before their text was edited.

The deadline fixture captures the real configured 30,000 ms callback and fires
it after the terminal fact is recorded; an independent two-second watchdog
detects non-settlement. It neither replaces settlement logic nor resolves the
query itself. Device and server evaluations are real. New test source is
`packages/snapback4/test/one-shot-review.test.mjs`.

## Validation

- Affected tests: **452/452** (`affected-final.log`), plus the four subsequently
  added terminal change-stream cases **4/4** (`changes-terminal.log`). This
  includes the one-shot causal/bound/model/type suites, existence integration,
  observations/React, mock ephemeral behavior, and store reset/ordering suites.
- New review matrix: **36/36**, then the four change-stream additions **4/4**.
- Whole guide: **106/106** (`guide-pass.log`).
- Reference check: 525 LLP documents, 9,999 references, zero errors/unchecked
  (`ref-check.log`).

Ran `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash scripts/test.sh`
**exactly once**, exit 1. Exact summary:

```text
== 1 failure(s) in 1290 s
   client tests
```

All other 12 stages passed, including the complete Rust inventory/doctests,
package builds/typechecks, fixture wrappers, and serial client models
**79/79** (both session tiers retain 5,000 sequences). The client pool reported
**5,469 tests: 5,457 passed, two failed, ten existing skips, zero cancellations**.
Both 300-seed search hosts and both 300-history mixed-evidence hosts passed
with zero failed seeds and unchanged coverage (`full-count-models.json`).

Every full-run failure (**ours: 2; baseline: 0; environmental: 0**):

| Failed case | Full-run finding | Final disposition |
| --- | --- | --- |
| bounded Following wasm: untaken online-only card branches remain answerable when held | Executed online-only branch expected `E_QUERY_RETRY`, received the new `E_QUERY_HELD` | Corrected assertion; passes |
| bounded Following native: untaken online-only card branches remain answerable when held | Same outdated executed-branch expectation | Corrected assertion; passes |

After the complete run finished, migrated those two host cases to require
`E_QUERY_HELD` **and `retryable: false` online**, and `E_OFFLINE` with
`retryable: true` offline. Untaken branches still require exact null/false
complete answers; executed branches still make zero server requests.
`following-final.log`: **2/2 pass**. This is a failed full run with passing
final affected checks, not a green full-suite qualification. No full rerun.
The inherited nominal 60-second suite budget remains exceeded.

Restored the concise “Clear on submit” and “while runnable” phrases afterward
within the client card's unchanged budget; final whole guide **106/106** in
`guide-final-pass.log`.

`suite-source-sha256.json` and `suite-start.diff` record the start inputs.
During the initial wasm build, one new return expression in `local.ts` was
folded onto one line to retain the 1,500-line cap. This is whitespace only,
before the suite's TypeScript build; the exact hash is recorded in
`formatting-during-wasm-build.txt`. No other product/test edit occurred during
the full run. Afterward only the two test expectations and those guide phrases
changed; product implementation stayed fixed. `final-source-sha256.json` binds
the final source. Preparatory failures and their dispositions are in `FAILURES.md`.

## Build and size

Linux, Node 24.13.1, Bun 1.3.14, 96 available CPUs. Frozen dependency install;
Cargo test artifacts warmed with `--no-run` before the full suite.
Wasm: **1,978,828 B raw / 593,225 B gzip**. Unchanged ratchet: **593,719 B**;
headroom: **494 B**. No wasm or budget change. See `wasm-build.log` and the
full-suite build measurement.

Local commit uses `Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.
Nothing pushed or published.
