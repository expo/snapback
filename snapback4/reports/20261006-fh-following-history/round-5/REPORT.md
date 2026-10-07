# FH round 5: refresh envelopes and live rejection

This round fixes both supplied round-4 reviews and merges `origin/main` at
`b14888f7632bf5fe60b61a640dd23e732797974e` into lane head `33321fe568`.
It is a merge, not a rebase. All requested FH/OA/read-only checks pass. The full
suite records **one export-maintenance failure on unchanged code**; both the
exact case and the whole-file rerun pass, and a separate issue retains the
failure. Nothing was pushed. Work and measurements stayed
on eb1000, in this worktree, with CPU affinity and one Cargo target.

## Review dispositions

- Astra's P2 is fixed by splitting authorization witnesses against the **entire
  UTF-8 JSON request**, including query arguments, opening and mounted wrappers,
  as well as the 128-field bound. A singleton is checked too. The real HTTP
  regression covers a 65,536-byte unsplit refresh, a 65,537-byte unsplit refresh,
  and Astra's 64,400-character projected argument, with escaping/multibyte text.
  All cards remain visible; every dispatched refresh fits 64 KiB. An indivisible
  oversized witness refuses `E_INPUT` locally.
- Grok's denied-id resurrection is fixed: a mounted rejection also excludes
  that cycle's preview append. The fragment mock now returns the denied id in
  its live reply, so the previous implementation fails the regression.
- The last preview slice is truncated to the remaining allowance: **at most
  100 new preview ids per cycle**, even if the window changes between slices.
  A public `seen` list that cannot fit beside large arguments ends the optional
  preview cycle early, without hiding authorized history. A second regression
  verifies that no oversized `seen` request is sent.
- The guide and LLP plainly describe client retention: **no fixed memory cap**;
  one copy per displayed live id since mount/reset, rechecked each poll, plus
  loaded history and transient witnesses. Withdrawal, reset/restart and unmount
  release rows. The server quota and per-cycle preview bound do not cap these
  client arrays. Post-B events missed by previews still belong to the next
  frozen history session.

[LLP 3000.026 §9.13](../../../../llp/3000.026-following-over-a-populated-store.rfc.md#913-round-5-envelope-retention-and-online-arm-integration-2026-10-07)
records the full disposition. Neither the frozen-prefix contract nor ordinary
inbox queries/certificates change.

## Merge and integration

The shared POST conflict retains both OA's private `armRequest` fence and FH's
abort signal. Both document and journal additions survive, and the await
inventory is regenerated from the composed sources. `useFollowing` uses
`app.client`; `useOnline` selects the separate app-owned server arm. Read-only
Following remains `E_READ_ONLY`; ordinary inbox queries through `app.online`
remain allowed. No second read verifier or session owner is introduced.

New integration tests exposed and repaired two pre-existing app-facade gaps:
the online journal wrapper now forwards the private Following transport, and
app admission withdraws history before asynchronous authority/journal work.
The original mutation promise, including synchronous browser refusal fields,
is preserved. Pending journal entries and the underlying pending-write fence
remain ahead of server history. Online and wasm journeys cover arm rotation,
Following restart, synchronous own-post fencing and logout.

The new differential-test crate from main had a stale `@ref` anchor; this
round changes that comment to the stable `#5.1` section reference. No harness
semantics changed.

## Verification

Focused merged-tree checks:

| Check | Result |
|---|---|
| Core Following, including both enabled scale tests | 27 passed |
| Language history/shaping; independent research cases | 10 + 3 passed |
| Guide | 113 passed; client card remains 1,200 words |
| CLI `serve` filter (timeline, HTTP Following, read-only and matching witness controls) | 203 passed, 4 existing ignored |
| Following certificate | 3 passed |
| Both client Following files, final run | 22 passed, 1 manual HTTP measurement skipped |
| OA `app-online-arm.test.mjs` | 32 passed |
| Read-only client files | 118 passed, 1 configured published-engine skip |
| Final build/typecheck, await classification, README budget, LLP reference check | Passed |

The full merged-tree `bash scripts/test.sh` finished in **2,591 seconds**,
**exit 1**, with exactly **one failure**. All 1,026 native executions across
313 binaries passed; both serial model files passed all 79 tests. The client
pool completed 341 files: 340 passed, one failed, with 6,651 passing tests,
one failed test and 56 skips. The failed file was `export-background.test.mjs`, case “repeated raced retention-lock deferrals
stay pending and restore the bound after release”, at its 90-second maintenance
drain assertion (97.6 seconds including setup). No native `/proc` diagnostic or
process-group leak was reported. This is distinct from both the known native
`/proc` issue and the existing export SIGKILL custody timeout.

The exact case passes in 8.4 seconds on its first isolated rerun; the entire
export-background file also passes its canonical-runner rerun in 298.2 seconds,
including process-group cleanup (58 passed, 36 platform skips). The 27 export test/wrapper/shim/witness inputs checked match
merged main byte-for-byte. The original failure is retained and its cause remains
unclassified. See the [new issue](../../../../issues/20261007-snapback4-export-retention-lock-drain-timeout.md),
`export-failure.txt`, `export-source-control.json` and the rerun receipts. No
export implementation or ownership guard was weakened or changed.

Initial integration evidence is retained in `following-client-initial.log`:
20 passed, two new integration tests failed, one manual measurement skipped.
The failures were the missing online-wrapper transport (the initial assertion
waited until its guard) and the asynchronous app admission gap. Both now pass.
One intermediate TypeScript build needed explicit generic return types after
wrapping mutation admission; the final build/typecheck pass. The first standalone
README budget invocation was stopped while waiting for Cargo because it had
inherited a different build profile; the canonical-profile rerun and full suite
supply its qualification. No product assertion was weakened. The first combined guide run also exposed
its two-word merge overflow; two intermediate trims changed required phrases
(`Start here` and `every milestone`). Both phrases were restored and the final
113-test guide run passed without changing tests or budgets. The first serve
command named a nonexistent integration target and ran no tests; the corrected
CLI binary filter produced the 203-pass result above. These logs and notes retain the
attempted-check record.

## Compatibility and resources

The FH delta adds **no persisted bytes**: no schema, catalog, IR, engine table,
application row, stored query or ordinary inbox certificate changes. The newly
merged main delta after `2a5fc454aa` adds OA client custody and a test-only
Quarry differential crate; it adds no engine persistent format. No old-engine
refusal test is required for this delta. Darwin/published-engine checks are not
claimed; the author will run the Mac fence and wasm measurement.

The merged Linux wasm is **2,135,336 B raw / 645,307 B gzip**, byte-identical
to round 4 (SHA-256 `7cd5e44fae55810e523ae10ee19ee2f11f926466ea7eaaef26296d1d9fb51c9b`).
The unchanged **645,607 B** cap is exactly Linux plus the required **300 B**
macOS allowance. No cap or runtime ceiling increase is needed. See `wasm.json`.
The worktree occupies about **25 GiB**, below the 50 GB limit; one Cargo target
was reused. `affinity.json` records the measurement/test CPU sets and idle-CPU
sample. No other worktree or host was used.

`full-suite-source-sha256.json` captures the suite's inputs; `source-sha256.json`
is the final receipt. Their only difference is the LLP's Revised metadata entry
added during qualification. Runtime, test and guide inputs did not change during
the full run. The compressed full-suite log preserves the original output; its size/hash receipt
is in `full-suite-log.json`. Text logs only normalize trailing whitespace.

## Native scale measurements

Seven samples per corpus, pinned to CPUs 20,24,26,28,29,30,31,34; shared-host
debug builds, not isolated latency/SLO measurements. First-page latency includes
preparation; later latency is the median of each run's page median. Opening
registration is separately metered. Accounted custody is not process RSS.


| Reader / corpus | First page, ms | Later page, ms | Preparation | Peak custody, B |
|---|---:|---:|---:|---:|
| metadata / sparse-1100 | 0.995 | 0.978 | 0 | 97,924 |
| metadata / sparse-50000 | 1.064 | 1.046 | 0 | 97,924 |
| metadata / follows-8200 | 200.207 | 0.828 | 5 | 17,087,232 |
| shaped / sparse-1100 | 1.517 | 1.464 | 0 | 299,636 |
| shaped / sparse-50000 | 1.633 | 1.559 | 0 | 299,636 |
| shaped / follows-8200 | 201.302 | 1.336 | 5 | 17,288,752 |

Both sparse corpora exhaust 1,101 events with identical charged work and
custody; adding unrelated posts does not add candidate examinations. The
8,200-follow corpus exhausts 8,200 events with five preparation units. Every
request asserts all seven unchanged meter ceilings. `following-core.log`
contains the raw seven-sample records; `measurements-summary.json` retains
latency, total work and storage. The existing manual HTTP measurement is not
rerun or claimed this round.
