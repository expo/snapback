# QX round 1 — changed constraint populations need coverage

Date: 2026-09-30. Branch: `sb4-intent/qx-first-instinct-forms`.
Round 0: `975361c102`. Merged `origin/main` `42ba3ffb904f` first, in
`503f24696c`, retaining both sides of the journal conflict. No other conflicts.
Local implementation only; nothing pushed or published.

## Review dispositions

**Astra P1 / Grok High fixed.** The shared interpreter now requires complete,
readable population coverage before a held update enters a different non-null
unique key or cap group. It uses the same proof as upsert inserts, before the
local collision lookup or cap count, through the existing separate device
allowance. Missing coverage queues without a predicted row. This applies to
ordinary updates and the held arm of upserts on either store/device host.

Unchanged unique keys and cap groups need no new proof. Null unique keys remain
non-colliding. Cap moves on expiring tables retain their server physical-occupancy
refusal, even when live rows are covered. Leaving the old population cannot add
a collision or consume a cap slot; the destination population needs proof.
Server rules and constraints are unchanged. The natural immutable
`(parent, principal)` key with `cap 50 by parent` still predicts its first write
with acquired coverage and its later emoji replacements.

**Diagnostic note fixed.** The round-0 report and guide now distinguish
`E_READ_THROUGH` for invalid paths/rules from `E_SYNC` for mismatched audiences.
The latter now offers the same schema-specific `read through .parent` / `sync`
repair for both a mismatched public audience and a target with no recipient
principal. It preserves the original authored horizon, rather than a planner
index containing generated captures. Four refusal/repair cases compile their
repaired declarations (two audiences × with/without a horizon).

**Grok labels fixed.** `check` says `predicts: conditional updates` when the
insert proof is blocked. Each upsert's residency explanation names every unique
key and cap, whether this patch can change it, and whether a change needs complete
held/readable coverage or queues because of its shape, horizon or expiring cap.
Two exact `check --residency` snapshots cover the natural private reaction shape
and the same shape with `unique principal, emoji`. The language, sync, prediction
and refusal cards and LLPs 3000.007/3000.014 carry the corrected rule. Existing
frozen schema tests normalize only the new appended explanatory prose; these CLI
snapshots bind that prose separately.

## Regression evidence

`upsert_constraints.rs` generates **120 cases**, 60 on memory and 60 on SQLite:
10 shapes × insert/changed-update/unchanged-update × whole/horizon child sync.
Shapes: natural; single-column, multi-column and parent-covered unique keys;
single-column, multi-column and parent-covered caps; uncovered/covered expiring
caps; and a covered unique combined with an uncovered cap. A second group holds
`emoji: 'taken'` without membership for this viewer. Each case checks predicted
identity/custody, the visible image on queueing, the authority's result, and
settlement restoring the confirmed image.

With round-0 `engine/write.rs` restored, **24 changed-update cases** wrongly
predict and change the held row (12 per store). The other 96 cases, including
all insert controls, unchanged keys and expiring-cap controls, already pass.
The fixed implementation passes all 120. `control-source.json` confirms that
round 0 and the first merged tree have identical relevant engine files. The
negative runtime control uses the final test/compiler with that exact round-0
engine file; it is not a claim that all merged source is round 0.

Four actual-device regressions independently reproduce the review on the saved
round-0 native binary and pre-build wasm: unique/cap × wasm/process. Both devices
show pending `taken`; the authority refuses with `E_RULE` / `E_CONSTRAINT`.
The fixed devices leave the confirmed `old` image untouched, queue with no
predicted row, and retain it on settlement. The original six first-write,
horizon and unfinished-rejoin controls remain green. Final tier result: **10/10**.
The saved native hash matches round 0's committed artifact record exactly.

The new diagnostic test fails on round 0's generic `E_SYNC` repair. Both CLI
snapshots also differ on the saved round-0 binary: reverting only the new header
and appended update prose makes their entire outputs byte-for-byte equal.
`before-snapshots.log.gz`, `before-*.txt`, and `snapshots.py` retain that comparison.
The expected detecting failures remain in `before-constraints.log.gz`,
`before-device-tiers.log.gz`, and `before-diagnostic.log.gz`.

Final affected checks: device targets **97/97** (including 120 generated cases
inside two tests); ordinary upsert tests **31/31**; first-paste CLI **8/8**;
parser/path tests **4/4**; residency **41/41**; compatibility **1/1**; whole guide
**106/106**; actual devices **10/10**. Round-0 spelling/schedule differential
coverage remains among the four first-instinct tests.

## Fresh reaction latency

Same unchanged round-0 `tools/measure.mjs`, `page.jsx` and social-starter reaction
fixture. Twenty insert/replace/reset trials per tier, no exclusions or artificial
network delay. Writer invocation to matching Chromium React layout effect;
process includes the browser/Node bridge. Each final sample rendered pending
before mutation return: **80/80**. These are localhost writer measurements,
not remote-reader latency or a controlled attribution of differences between
rounds. The shared host, merged transport changes and run order differ.

| Tier / arm | Pre-QX p50 / p95 ms (retained) | Round 0 p50 / p95 ms (retained) | Round 1 p50 / p95 ms (fresh) |
|---|---:|---:|---:|
| Web insert | 29.65 / 33.80 | 3.60 / 5.10 | 3.95 / 5.80 |
| Web update | 28.80 / 31.70 | 3.40 / 4.30 | 3.30 / 4.80 |
| Process insert | 35.55 / 73.00 | 8.95 / 10.30 | 6.95 / 8.70 |
| Process update | 35.90 / 49.60 | 7.30 / 8.10 | 5.45 / 6.90 |

`final-{wasm,process}.json` keeps every event, sample and environment record;
`summarize.py` recomputes all columns (nearest-rank p95). The first measurement
attempt used an old SDK build and is retained as `pre-sdk-*`; it is excluded
from the result above. Before the qualified measurement, rebuilt the SDK and
verified source and packaged wasm hashes match. `artifact-hashes.json` identifies
the measured bytes. The full suite started after these measurements.

## Full suite and size

Ran `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash scripts/test.sh`
**exactly once**, exit **0**. Exact summary:

```text
== 0 failure(s) in 1312 s
```

All **13 stages** pass. Rust: **4,379 passed, 0 failed, 33 existing ignores**.
Client pool: **5,345 passed, 0 failed, 10 existing skips, 0 cancelled**.
Serial models: **79/79**, including both full 5,000-sequence session walks.
Fixture wrappers: **9/9**. Full-run failures: **ours 0, baseline 0,
environmental 0**. Expected injected E_AUTH messages in model logs are not
failed tests. No timeouts or test counts were relaxed. The inherited nominal
60-second suite budget remains exceeded.

`suite-source-before.json` and `suite-source-after.json` are equal: no modified
product source, tests or snapshots changed during the run. Documentation/report
completion does not change those inputs. The full run rebuilt wasm to the same
hash as the measured artifact. `suite-summary.json` retains all stage results.
Reference validation passes; `ref-check-final.log.gz` includes the final journal.

Wasm: **1,980,716 B raw / 593,539 B gzip** on pinned Rust 1.97.0,
wasm-bindgen 0.2.127 and Binaryen 132.0.0. Compared with the retained round-0
artifact, +1,283 raw / +15 gzip. This is a whole-artifact measurement, not
symbol attribution. The unchanged **593,719 B** cap leaves **180 B**. No budget
or runtime ceiling increased. The compiler diagnostics/labels are outside wasm.

`FAILURES.md` retains every detecting or corrected test/build/harness failure;
none is silently relabeled as a successful run. `suite-source-before.json`
binds the modified product/tests/fixtures used for the full run.

Raw console logs are retained losslessly as `.log.gz`; use `gzip -dc` to read
them. This preserves test-runner whitespace without source-diff warnings.
