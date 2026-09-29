# Lane RL, round 0 — answers stay on screen

Base: `ac5c4e21c` (`main`), branch `sb4-intent/rl-answers-stay`.
No push or publication. Local commit carries the requested GPT-6 Astra trailer.

## Result

Mounted same-key observations keep their answer, marked `revalidating`, through
plain refetch, reconnect, slow reads, transport failure and retry exhaustion.
Default and `keep: true` share this policy; only `true` adds the existing 30 s
linger. Online `/changes` evidence alone starts the existing non-renewable 1 s
bound, for both policies. Failure or timeout then withdraws; a late valid answer
can replace loading. Commits retain and re-read from the replica as before.

No new public flag: transport loss uses `fresh: false`, retaining `since` or the
last confirmation time. Explicit loading results, `keep: false`, key changes,
expiry and resets still replace. Denials and empty answers replace directly.
No admission, cut, ticket, cache-order or commit/reset fence was replaced.
`contract.ts` changes documentation only.

Production changes: `ReadObservation.reload(bounded)` and its separate failure
path; failure classification at existing local/online boundaries; online change
routing passes the bound; facade holds inherit the earliest applicable episode.
Valid remembered-answer recovery remains governed by the original admission and
expiry procedure. A failed request does not prevent already-valid newer memory
from replacing an expired display. Row expiry timers remain armed while holding.

Docs: LLP 3000.023 §10 is the current model, with a pointer from LLP 3000.019;
the client card, both READMEs and operations manual describe it. Removed the
profile identity/route-hoisting workaround for ordinary revalidation. The
one-view handle owner remains above recycled rows for its separate lifetime.

## Before/after evidence

The before SDK was rebuilt from `ac5c4e21c` under ignored `target/rl-baseline`,
using the same Rust binary and wasm as the after run. The seed harness accepts
`RL_ORACLE_SDK`; render tests accept `RL_TEST_SDK`, both pointing to that dist.
The tests themselves are identical between the recorded before/after runs.

Every table cell below is exercised on process, wasm and online, with default
keep and `keep: true` (54 leaf scenarios plus their 12 host/policy groups).

| React scenario | Default on main | keep:true on main | Final |
| --- | --- | --- | --- |
| Profile gate, actual 3 s held refetch | Fails, all hosts | Pins current behavior | Pass |
| Profile gate, offline transport failure | Fails, all hosts | Fails, all hosts | Pass |
| Profile gate, retry exhaustion | Fails, all hosts | Fails, all hosts | Pass |
| Profile gate, disconnect/reconnect | Fails, all hosts | Fails, all hosts | Pass |
| History, peer message by sync | Pins current behavior | Pins current behavior | Pass |
| History, own send then settlement | Pins current behavior | Pins current behavior | Pass |
| History, edit | Pins current behavior | Pins current behavior | Pass |
| History, delete | Pins current behavior | Pins current behavior | Pass |
| Membership removal directly yields empty history | Pins current behavior | Pins current behavior | Pass |

`before-react.log`: 39 pass / 27 fail (21 failing leaf scenarios plus six parent
groups). Final React traces have zero loading renders after data and exactly one
route-slot mount, no unmount. Each actual host observation callback is captured
and replayed through real React `useQuery`/`usePage` in Chromium with a separate
`flushSync`; even notifications a normal render could batch away are tested.
The route slot has state and mount/unmount counters. This is not an Expo Router
installation or native simulator claim. There is no public SDK refetch verb;
the controlled refetch/retry cases use the mounted observation's existing fetch
entry point, with actual client queries for the slow transport read.

`answers-stay-bound` also covers actual `/changes` success/failure/timeout,
plain-to-bounded escalation and late completion. `retention-episode` adds the
held-A/source-B case through later source replacements. Explicit false, deadlines,
credentials, store/schema, sign-out and authority ordering remain exercised by
the existing affected suites.

## Seeded ordering regression

Port source: `sb4-intent/lv-hook-retention`, `11af2c7d5`, the two requested model
files. LV-only `reconcileLocalRead`, evidence minima and local evidence serials
do not exist on this main. The port uses public local clients and real process
and wasm evaluations instead of reconstructing that removed publication layer.
It retains LV's deterministic PRNG, independently gated completions and real
captured sync/HTTP envelopes. Each seed varies old-evaluation completion before
or after membership sync and mixed server/local completion order. The reference
is the fixture's alternating membership history and numbered row images; it
contains no SDK admission algorithm. It checks every notification for image
regression and visibility after removal, checks post-sync direct answers, and
exercises current local clock denials and failed plain re-reads.

| Host | Seeds before | Before failures | Seeds after | After failures |
| --- | ---: | --- | ---: | --- |
| process | 300 | 300: loading after data without remote evidence only | 300 | 0 |
| wasm | 300 | 300: loading after data without remote evidence only | 300 | 0 |

No older-answer or membership-visibility failure occurred before or after.
See `before-oracle.log`, `after-oracle.log` and per-host JSON records. Full traces
are retained for the first two failing seeds; all 600 outcomes are recorded.
The port does not reproduce LV's native-plugin and cutless-envelope variants;
the existing SDK ordering suites remain in the affected and full runs.

## Verification

- New React/bound and independent approval run: 503/503 (`after-new-final.log`).
- Facade episode and approval model run: 496/496 (`facade-bound-after.log`).
- Clock/expiry/authority React: 71/71 (`expiry-final.log`).
- Retention policies/pages/lifecycle/online boundaries and typing: 259/259
  (`retention-after.log`).
- Expanded affected run: 908/912; four obsolete plain-timeout expectations in
  the closed-facade tests corrected; their whole file then passes 51/51
  (`approval-lifecycle-final.log`). These four were corrected before the full
  run's client stage.
- Whole guide: **98 passed, 0 failed** (`guide-final.log`).
- Package build/typecheck and `ref-check --verbose` pass; `git diff --check` passes.
- Final full-run fixes: **85/85** expiry/withdrawal/delivery-approval,
  **3/3** explicit-withdrawal seams, **1/1** await-boundary classification
  (`full-fixes.log`, `seams-final.log`, `delivery-boundary-final.log`).
- Final ordering/reset/observation rerun: **64/64** (`ordering-fixes.log`),
  with all original presence-ordering assertions unchanged.
- Final React/bound/expiry/withdrawal rerun: **134/134** (`final-policy.log`).
- Full suite, exactly once: **`== 2 failure(s) in 1459 s`** (exit 1).
  Failed stages: `cargo test`, `client tests`. Cargo has one failed guide case:
  `every_card_introduces_the_feature_before_examples_and_reference_details`.
  Client stage: 4,601 tests, 4,548 pass, 43 fail, 10 skipped (plus the passing
  wrapper subprocesses). Full client models: **79/79**. Every individual failure
  is **ours**, subsequently fixed in scoped reruns; **0 baseline**,
  **0 environmental**. Exact 43 client titles and corrections are in
  [FAILURES.md](FAILURES.md). All other full-script stages passed.

The full run was started during the final test/doc corrections. It compiled the
three-sentence guide introduction before the correction and therefore records
that known failure. This is ours, fixed; the separately rerun whole guide is green.
The full client stage captured the SDK before the final no-data wakeup fix,
and older test expectations for local-commit episodes. It also exposed an
offline recovery classification regression, now fixed: existing ordered memory
selection still replaces with newer data or explicit absence, including denial. Those failures are fixed
and checked in scoped reruns; this is not a claim of a green full-suite run on
the final commit. The full script is run exactly once as requested.
All intermediate failures, including setup mistakes and the corrected recovery
regression, are itemized in [FAILURES.md](FAILURES.md); none is silently relabeled
as environmental or baseline.

## Wasm

Fresh canonical build (also rebuilt by the full suite): **2,040,529 B raw;
592,975 B gzip**, cap **593,719 B**, **744 B below**. No Rust/runtime source or
budget changed. SHA-256:
`3fb9d26ca58097b01fb3fcfdf6f0c02b0416d1969565bd84e7d463b7fa98998b`.

Reproduce from `snapback4/`:

```sh
bun run --cwd packages/snapback4 build
node --test packages/snapback4/test/answers-stay-{react,bound}.test.mjs
RL_ORACLE_OUT=reports/20260929-rl-answers-stay/after-oracle node --test packages/snapback4/test/mixed-evidence-oracle.test.mjs
cargo test -p snapback4-lang --test guide
bash scripts/test.sh
```
