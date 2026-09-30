# QS round 2 — terminal sources and permanent held misses

Date: 2026-09-30. Branch: `sb4-intent/qs-one-shot-settles`.
Round 1: `a8744099b53607fc4bd22071aa911ff8b2e1bf3e`.
Fetched and merged main `0dad042375057d2dad8c429424713986581432e7` first,
in `17ca8a380930f773efbe62637692212bcc608e04`. Both journal histories and
both delivery-await audit comments survive the two append-only conflicts.
`merge.json` records the actual parents; a subsequently moving remote-tracking
ref does not change them. Nothing pushed or published.

Read both prior prompts/reports and both complete round 1 reviews at
`~/sb4-intent/reviews/qs-r1.{astra,grok}.md`. All three corrections are implemented.

## Context and implementation

Used `llp-orient`, scoped to query settlement, local evaluation metadata and
published client guidance. Read the fenced command sheet, root LLP 3000,
NOT-DOING, adopted rules, design brief, journal, current client/search guide,
and governing LLPs. LLP 3000.023 §11 governs one total four-round/30-second
budget and terminal precedence; §10 preserves observation policy. LLP
3000.016 §2.2 owns the shared evaluator and publication fences. LLP 3000.031
§1.1 owns the unchanged existence classifier and pending predicate. Root,
3000.023 and 3000.031 are in current; none is in foundation. Hand-off: none.
The contract correction updates existing LLP 3000.023 §11. No new gate,
registry, public type, core/wasm change, or budget increase.

1. **One terminal-source selector.** `terminalQueryRefusal` names public scope,
   store, close, session, change stream, partition and inherited raw state.
   All fields are required, so each online/local/mock adapter and app facade
   must account for applicable and absent sources. Online settlement now
   supplies `changesRefusal`. Every decision in the shared settlement loop
   consults that callback, and facades inherit it synchronously even when
   their own deadline wins before the inner catch. Public scope still wins.
   Observations and mutation routing are untouched.

2. **Permanent means statically proven.** An actual unsynced-table read is
   insufficient: another time, argument, data/coverage or membership state
   can route the same program to a ready answer. The proof is deliberately
   narrow: the compiler's unconditional literal-key online-only count
   lowering, with no arguments, native body, inherited source, parent-key
   or own-key aggregate. That form reaches the Rust engine's unsynced-table
   unknown check before row authorization; changing membership does not make
   its count known. The compiler's exact lowering is checked structurally;
   unfamiliar shapes conservatively retry. This is not a second interpreter.
   The existing acquired/no-pending condition and final publication fences
   still apply. Ephemeral and all other unproven forms use bounded retries.
   The stable count still refuses non-retryable `E_QUERY_HELD` in one device
   evaluation and zero server requests. A held time branch now rereads after
   its real-clock cutoff and returns `7`, as does an identical fresh call.

3. **Client contract.** The contract paragraph names non-retryable
   `E_QUERY_HELD` beside `E_QUERY_RETRY`, restricted to proven permanent
   unavailability. Search and refusal guidance use the same narrower rule.
   Client card: 1,200 words / 113 lines; local.ts: 1,500 lines. Native smoke,
   clear-on-submit, runnable-host and offline-decoration guidance remain.

The two Following conditional tests now expect retryable `E_QUERY_RETRY`
for their executed online branch, since changing `want` makes the same
program answerable. Offline remains retryable `E_OFFLINE`. Exact complete
`false`/`null` for untaken branches and zero server dispatches are preserved.

Logs and the suite-start diff are gzip archives preserving their exact output
bytes, including diagnostic whitespace.

## Regression evidence

Before product edits, the merged round 1 SDK fails all **20/20** new checks
(`round1-regressions.log.gz`): three online change-stream deadline cases,
four real-clock held cases, twelve argument/data/membership held cases, and
one client-card check. They fail at the reviewed result, not setup.

For an exact source control, archived and rebuilt the SDK at `a8744099b5`
in `/tmp/qs-r2-round1-source`, then replayed through the existing baseline
loader. `exact-round1-regressions-complete.log.gz`: **19/19 runtime failures**.
The runtime control uses the current fixture server/device; these parts of
the evaluator were not changed by QS. The exact SDK input is the round 1
commit, not the moving merge. The guide's old-text failure was recorded
before any guide edits. This is intentional negative evidence.

The change-stream cases open a real observation, block query transport or
facade authority, deliver `/changes` terminal `E_SYNC`, and compare the
outstanding result with a fresh refused query before firing the captured
production 30,000 ms callback. A separate two-second watchdog catches hangs.
Time cases use the real clock; no result or predicate is fabricated.

Terminal coverage includes online restore/replacement at transport/authority;
local restore, partition and change stream on wasm/process and their facades;
close/sign-out on all six runtime tiers; app logout/viewer scope on all three
app tiers; and mock close/sign-out. The additional local facade matrix checks
all three local halt sources during both opening and final authority checks
on both device hosts. Online partition acquisition and mock store/change
streams do not exist; local resets recover through adoption and are covered
by the existing reset suite rather than invented terminal codes.

## Validation

- Review regressions: **60/60** (`review-regressions.log.gz`).
- Additional opening/final authority matrix: **12/12** (`authority-matrix.log.gz`).
- Broad affected run: **463/463** (`affected.log.gz`), including causal/bounds/
  models/types, Following, existence, observation retention, mocks and store
  reset suites. No cancelled or skipped tests.
- Whole guide: **106/106** (`guide-pass.log.gz`). Earlier word-budget failures
  remain recorded in the failure ledger.
- Typecheck/build, docs budget, reference validation and diff check pass.
  Ref-check: 525 LLPs, 10,005 references, zero errors/unchecked.

Ran `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash scripts/test.sh`
exactly once, exit 1. Exact summary:

```text
== 1 failure(s) in 1280 s
   client tests
```

All other 12 stages passed, including the complete Rust inventory/doctests
and serial client models **79/79**, with 5,000 session sequences on each
online/local tier. **Ours: 0; baseline: 8; environmental: 0** for failed
full-run tests. The inherited nominal 60-second budget remains exceeded.

The client pool reports **5,524 tests: 5,506 passed, 8 failed, 10 existing
skips, zero cancellations**. All 31 new runtime regression/authority cases
pass inside that run (the review file has 72 checks including controls).
Both 300-seed search hosts and both 300-history mixed-evidence hosts pass
with unchanged counts and coverage; see `full-count-models.json`.

Every client failure is **baseline** relative to the merged pre-fix SDK:

| Failed expired-server-reply case | Classification |
| --- | --- |
| recover, keep=false | baseline |
| recover, keep=true | baseline |
| close watch, keep=undefined | baseline |
| close watch, keep=false | baseline |
| close watch, keep=true | baseline |
| close client, keep=undefined | baseline |
| close client, keep=false | baseline |
| close client, keep=true | baseline |

Focused runs on both the candidate and the exact merge SDK report 6/12
failures. A second merge-SDK run printing timer creation stacks reports 8/12;
the union reproduces every full-run case. The fixture captures Undici socket
timers under its AsyncLocalStorage filter, producing `1000 !== 25` or two
timers instead of one. The trace changes neither timers nor callbacks;
`Parser.setTimeout` and `resumeH1` own the extra timers. This is a reproduced
fixture issue, not an assumed infrastructure excuse. It remains open in
`issues/20260930-snapback4-expired-watch-captures-transport-timers.md`.
Full per-case classification is in `full-suite-failures.json`; focused and
preparatory failures are in `FAILURES.md`. No unrelated fixture assertion
was weakened, and this failed run is not a green qualification.
`suite-source-sha256.json` and `suite-start.diff.gz` bind the full-run inputs.
All product, test, guide and LLP inputs stayed unchanged throughout the full
run and its baseline investigations; `final-source-sha256.json` matches.
Only reports and the baseline follow-up ticket were written while it ran.
No process intervention, reduced model count, full-suite rerun or publication.
The one journal entry was appended after the run completed.

## Size and environment

Linux, Node 24.13.1, Bun 1.3.14, 96 available CPUs. The fleet file was absent;
used this lane's available host. Warmed Cargo test artifacts with `--no-run`.
Wasm: **1,978,828 B raw / 593,225 B gzip**, **494 B** below the unchanged
**593,719 B** cap. The complete suite's wasm build records those exact bytes.

Local commit carries `Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.
