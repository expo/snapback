# RX round 1 — receipt retirement, convergence and named families

Date: 2026-09-30. Branch: `sb4-intent/rx-declarative-receipts`.
Round zero: `81ae19f398dcbe695c516117c3b0fad728deeae2`.
Merged `origin/main` at `f1b1f0077eee40b6eeedac224ebd078c04cea173` first,
without conflicts, preserving both sides in merge
`6de6fb8f46eefbc1db3110bab03d9fe0a3188a60`.
Nothing pushed or published.

Read the original prompt and report and both complete reviews. All five requested
areas are implemented. Automatic ordinal allocation, send-time recipient counts
and join-floor capture remain for the next round, as requested.

## Changes and causal evidence

1. **Authorized removal owns retirement.** The shared interpreter reads the
   exact family/member run prefix through its metered storage adapter after the
   membership deletion has been authorized. It does not require runs audience
   membership or broaden the viewer. Metered deletes stay in that transaction;
   device prediction requires complete run coverage. A service removes Bob's 64
   runs, preserves Alice's run, and Bob can rejoin and report a disjoint interval.
   A ten-row write ceiling rolls back both membership and partially deleted runs.
2. **Bounded compaction before the run cap.** Generated delivery folds recorded
   intervals and absent positions into the prefix, retires all covered runs, then
   enforces 64. There are at most 1,024 unique message probes per invocation,
   shared across all gaps. The 1–131 / 64 even singletons / deleted odd positions
   reproduction now reaches prefix 131 with zero runs. The smaller stranded-run
   case also retires the lower run. A 9,000-row unswept expired hole records the
   entire input without `E_BOUND` and makes bounded progress on subsequent chunks.
3. **Progress survives saturation.** A separate generated compaction operation
   commits safe partial prefix progress even when an attempted 65th interval
   must refuse. The SDK calls it after an accepted, headed `RUNS_FULL`; a committed
   advance retries the report with a new id. No progress or uncertain maintenance
   keeps ordinary parked retries. Maintenance success never acknowledges delivery.
   The saturated long-expiry witness converges without a false successful report.
   A real HTTP/online-SDK test carries the optional compact name from schema to
   query manifest to transport, checks its fingerprint at the server, frees slots
   across a long deleted hole and records the whole owed interval.
4. **Complete audience admission.** Membership must be group-readable and synced
   in full to the exact group, without a horizon. The `.principal = viewer`
   layout with an independently correct recipient count refuses
   `E_RECEIPTS_CLAUSE`. Messages must also be group-readable so denied rows cannot
   be mistaken for absent positions by gap probes.
5. **Names, fields, operations and versioning are settled in LLP 3000.022 §14.**
   `receipts chat ...:` has explicit counter/floor/count mappings, optional member
   identity and watermark mappings, a named runs table and six mapped public
   operations. Defaults use the family prefix. Multiple distinct families work;
   there is no global `runs` or operation name. Tests exercise renamed accounting
   fields/operations and two families with distinct membership/message scope names
   and a renamed principal. The interpreter reads descriptor fields, not fixed
   accounting names. `declarative-receipts-v2` fences old engines/devices. A
   semantic digest includes the template, descriptor and mappings; it changes the
   delivery fingerprint and binds maintenance to the same family. No-clause
   schemas and manual fingerprints retain their old serialization/meaning.

The block reserves a place for future allocation modes while already naming the
counter, message position, floor and count those modes will own. Joins will
observe the message counter without consuming message ordinals. Arbitrary raw-IR
program/descriptor admission and historical data conversion remain unimplemented;
the compiler is still the trusted constructor.

## What the differential tests establish

- Six new seeded schedules (three on each device host) have **336 comparison
  checkpoints each: 2,016 total**. Each allocates 260 messages, fills all 64 runs
  with shuffled **two-position intervals**, refuses a 65th, bridges intervals in
  nonsequential order, advances the prefix, reports seen, removes through a
  service while runs remain, rejoins and reports again. They compare delivered
  and seen watermarks, join floors, canonical run intervals and receipt projections
  on servers and both devices. Arbitrary run row ids are excluded only from the
  cross-implementation comparison; each device's own server state is preserved.
- The original twelve 100-step expiry/deletion schedules remain. They now inspect
  watermark/run coverage on every live position, enforce absence of stranded
  covered runs, and compare replicated member/run images to the corresponding
  server after publication. Their original projection comparisons remain.
- Both stores exercise partial acquisition, queued seen, predicted seen with
  full acquisition, a pending handwritten delivery across schema adoption,
  restoration/replay under the generated server-only operation, reopen, duplicate
  server write ids and final progress/projection equality.

**Exact stored-state equivalence is scoped to live contiguous allocation.** The
manual recipe lacks gap compaction and allows delivery prediction; those are
intentional differences. Expiry/deletion comparisons assert equal coverage on
live messages, not identical physical prefix/run encodings. Device equality is
asserted after authoritative replay, not between differing provisional programs.
A successful bounded report may still use a run while further prefix compaction
is possible; success is full interval coverage, not full normalization in one call.
The real SDK witness checks this distinction and finishes normalization with an
explicit bounded maintenance call. No background history acquisition is added.

The manual service control explicitly grants its handwritten cleanup read/delete
access to runs. The declarative service fixture has no such run read grant.

## Round-zero controls

Applied the final regression harness to an isolated checkout of round zero;
product files there were unchanged. [round0-regressions-final.log](./round0-regressions-final.log)
records **11 passed / 9 failed**. The failures are the two stranded/saturated
hole cases, service cleanup, self-only admission, renamed mappings, long expiry,
saturated long expiry, and both full-state generated schedules. The long expiry
case reaches the old 8,192-examined `E_BOUND`; the service schedule leaves runs;
the self-only layout has no diagnostic. The separate two-family test was added
after this control and is not counted as a round-zero failure.

[round0-sdk-regressions-final.log](./round0-sdk-regressions-final.log) runs the
round-zero queue/state source against the extended SDK harness: **60 passed /
6 failed**, all six new maintenance dispatch/convergence/fault witnesses.
These are intentional control failures, not unresolved final failures.

## Verification

- [affected-final.log](./affected-final.log): receipts **21/21**, binding **5/5**,
  whole guide **105/105**. Existing receipt behavior assertions remain unchanged.
- [device-final.log](./device-final.log): device delivery **30/30**, readauth
  **81/81**. The reviewed census change is one added server-only operation:
  `card/receipts/1:compactReceipts | never`.
- [sdk-delivery-final.log](./sdk-delivery-final.log): queue tests **66/66**.
- [integrated-final.log](./integrated-final.log): real-client delivery **4/4**,
  including the new fingerprint-bound maintenance path.
- [await-classification.log](./await-classification.log): classification of the
  new maintenance await; its fault cases are in the queue/integrated tests.
  The outbox matrix scope and required/optional cases are unchanged.
- CLI and SDK builds, guide facts/budgets, `git diff --check`, and ref-check pass.
  [ref-check.log](./ref-check.log): 525 LLP docs, 9,975 refs, zero errors/unchecked.

The complete `scripts/test.sh` run is in [suite.log](./suite.log), executed once. Logs omit trailing whitespace and terminal blank lines only.
Product source was final before it started. Only the new-await classification
pin/comment was finalized during its Rust phase, before client tests began.

It exited **0** and ended with this exact summary line:

```text
== 0 failure(s) in 1344 s
```

Failing checks/tests: **none**. Ours: **0**; baseline: **0**; environmental:
**0**. The complete run recorded **4,383 Rust passes / 0 failures / 33 existing
ignores**, **5,315 client passes / 0 failures / 10 existing skips**, **79/79
serial models**, and **9/9 fixture tests**. Their full 5,000-sequence walks ran.
Build, wasm, release guard, documentation budget, package and app typechecks
also passed. Expected fault-injection refusals are not failing tests.

No counts, timeouts or runtime ceilings were reduced. The inherited nominal
60-second suite bar remains a separate limitation; this report records actual
time rather than making a 60-second claim.

## Wasm and source size

The full-suite build measures **1,988,204 B raw / 596,444 B gzip** using the
build script's `gzip -9 -c`, with Rust
1.97.0, wasm-bindgen 0.2.127 and locked Binaryen 132. The unchanged ratchet is
**597,247 B**, leaving **803 B**. No budget increase. Compared with round zero's
recorded artifact, gzip is +197 B and raw is −32 B; the base wasm artifact was
not rebuilt for per-component attribution. The initial derived receipt decoder
measured 597,488 B gzip, 241 B over the cap. Reusing the streaming String decoder
removed that excess before qualification. Runtime ceilings are unchanged.
Changed-source and built-wasm digests are recorded in
[source-artifact-sha256.json](./source-artifact-sha256.json).

Starter schema: **294 original → 225 round zero → 231 round one** physical lines,
still 63 fewer than the handwritten recipe (21.4%). The extra six lines expose
stable names/mappings rather than freezing prototype globals. Primary receipts
guide: **321 lines**, below the existing 350-line cap. The manual card remains.

## Earlier failures and corrections

All development failures below are ours (implementation or harness), except the
intentional round-zero controls described above. None is an unresolved baseline
failure. Logs retain failed attempts as well as the final passes.

- Harness/build mistakes: `python` instead of installed `python3`, two temporary
  helper scripts invoked from the wrong working directory, nonexistent meter
  field `writes` (correct: `rows_written`), nonexistent `Value::Object`, and the
  attempted `Meter::examine` helper (correct: ordinary `charge`). Fixed before
  meaningful verification.
- The first self-only regression still had the handwritten send scan and thus
  also hit its existing fanout diagnostic. The final control independently fixes
  the recipient count; round zero admits it with no diagnostic.
- The first generated service fixture accidentally broadened an unrelated
  own-keys table's delete rule and correctly refused `E_SYNC`. Restricted the
  fixture extension to memberships and manual run cleanup.
- Long-hole assertions initially read `.runs` from a composite progress query
  that can be capped by its `ahead` scan. Final storage assertions inspect raw
  runs and point-read the member prefix, while the actual reporting mutations
  retain default meters. The fixture uses one deterministic future clock.
- Device harness expectations were corrected: incomplete acquisition may return
  `E_PREDICT`, an initially unpredicted entry stays queued, and schema adoption
  requests a publication before predictions replay under the new program.
  The completed test asserts these actual boundaries and persisted final values.
- Guide definition/recovery pins and the authoring census needed the new names,
  multiple-family rule and compact operation. Changed only the affected facts;
  whole guide and all readauth tests pass afterward.
- Sharing a Cargo target between the round-zero control checkout and this lane
  reused a stale compiler artifact. [control-cache-contamination.log](./control-cache-contamination.log)
  records the resulting parser failures. Invalidated the three local crate
  roots and rebuilt before final affected/full verification. This was a control
  harness mistake, not a product regression.
- Direct Node strip-only execution of the round-zero TypeScript rejected its
  constructor parameter property. The final SDK control uses Node's type
  transform mode and reaches the intended six assertions.
- The first real SDK test demanded full normalization after a bounded successful
  report. It correctly had full input coverage in a run; the final witness checks
  coverage first, then explicit compaction. No product change was needed.
- The initial staged transcript check flagged trailing whitespace in saved test
  output. Removed trailing whitespace only; the final diff check passes.
- The first wasm attempt exceeded the ratchet. The final streaming decoder fits;
  the budget file was not edited.

## Governing context and handoff

The scoped `llp-orient` pass used the installed skill at
`/home/ccheever/lanes/q03r4/vendor/llp/skills/llp-orient/SKILL.md` because this
worktree's symlink is uninitialized. Governing constraints: LLP 3000's Snapback 4
fence and one Rust interpreter; LLP 3000.022 §§2–6 (coverage, provenance,
fingerprints and replay); LLP 3000.015 §2 (authority/meter bounds); LLP 3000.025
(expiring reads); and current receipts/sequences guide forms. §14 was updated
in place. Remaining implementation: automatic counter/count/floor custody,
raw-IR admission and arbitrary-layout migrations, detailed expression source
mapping, and scale latency measurements. Handoff: next RX round.
