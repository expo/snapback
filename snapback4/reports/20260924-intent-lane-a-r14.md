# Lane A, round 14 — replayable setup before job sweeps

2026-09-24. Branch `sb4-intent/a-planner`; starting commit `29694a3aa`.

## Behavior

A bounded loop that neither writes nor emits may run as setup before a recorded
sweep. The guard checks its body and domain expressions recursively; inlined
blocks cannot hide writes or effects. Every top-level loop is validated before
any chunk commits. Work loops over unsupported domains still park with
`E_JOB_SWEEP`, even alongside valid sweeps. A pure trailing loop with no following
sweep also parks, because no chunk would execute it.

This existing form now compiles and runs again:

```quarry
effect notify
table t:
  scope: int
  immutable scope
  n: int
  by byScope: scope, id
  public 't'
  update <- allow
  sync public
job computedPrefix():
  total = 0
  for n in range(0, 2):
    total = total + n
  for row in t[sum([{ n: 1 }], .n)] by byScope:
    for n in range(0, 2):
      emit notify { n }
    update t[row.id] { n: 9 + total }
```

The compiler-generated list-sum setup executes under each chunk's existing
meter. The regression updates 65 matching rows over at least two chunks,
produces 130 inner-loop effects, and leaves a row in the other scope unchanged.
Authored preludes, inner loops, frozen sweep prefixes, chunk admission and
meter ceilings keep their existing behavior.

## File-by-file changes

| File | Change |
|---|---|
| [core/engine/job.rs](../crates/snapback4-core/src/engine/job.rs) | Allows pure bounded setup only before a following sweep; keeps whole-job validation before any chunk. |
| [core/engine/read_only.rs](../crates/snapback4-core/src/engine/read_only.rs) | Extracts the existing recursive effect analysis, parameterized for admission that permits emits and setup that forbids them; checks nested expressions and loop domains. |
| [core/engine/admission.rs](../crates/snapback4-core/src/engine/admission.rs) | Uses the shared analysis with emissions allowed, preserving existing population admission. |
| [core/engine/mod.rs](../crates/snapback4-core/src/engine/mod.rs) | Registers the shared module with admission's existing host configuration. |
| [lang/tests/intent_variants_review.rs](../crates/snapback4-lang/tests/intent_variants_review.rs) | Adds the compiled multi-chunk prefix regression and pure trailing-loop refusal; expands mixed-job tests across domain and effect forms. |
| [guide/jobs.rs](../crates/snapback4-lang/src/guide/jobs.rs) | Explains bounded write-free, emit-free prefix setup and per-chunk replay. |
| [guide/codes.rs](../crates/snapback4-lang/src/guide/codes.rs) | Updates the existing E_JOB_SWEEP explanation; no new code. |
| [LLP 3000.013](../../llp/3000.013-quarry-states-intent.rfc.md) | Records the effect-based setup distinction and rejection of unexecuted trailing loops. |
| [JOURNAL.md](../JOURNAL.md) | Appends the round's measurements and exclusions. |
| [This report](20260924-intent-lane-a-r14.md) | Records behavior, tests, decisions and failure accounting. |

## Regression evidence

- `compiled_sweep_prefix_setup_runs_before_each_chunk`: asserts that the compiled
  prefix contains a bounded DerivedArray sum loop before the Page sweep; checks
  65 matching updates across chunks, 130 effects, authored prelude bindings and
  an untouched row in a different scope.
- `engine_parks_an_unrecorded_conditional_sweep_instead_of_skipping_it`: covers
  conditional-array, literal-list, literal-range, expression-range and
  argument-list domains with either writes or emits. Additional cases hide
  work inside domain expressions and inlined body expressions. Each runs
  alone, before, between and after valid sweeps: 64 cases, all parked with
  zero chunks, writes and effects. Its existing compiled prelude/inner-loop
  positive fixture remains.
- `pure_setup_requires_a_following_sweep`: a pure standalone loop and a pure
  trailing loop both park before any chunk, write or effect.
- Temporarily restoring the old blanket non-Page rejection makes the compiled
  prefix regression fail with E_JOB_SWEEP. Temporarily narrowing the check to
  DerivedArray makes the mixed-job regression fail on a LiteralRange emit loop
  that incorrectly reaches Done after two chunks. Both mutations were restored.

## Decisions and scope

No deviation from round 14. All existing LoopDomain forms have finite ranges,
list/depth bounds or metered scans; purity is determined recursively rather
than by whitelisting a particular domain. Pure setup must precede a recorded
sweep so the normal setup runner actually evaluates it. The shared effect
check preserves population admission's prior emit allowance. No new sweep or
Quarry syntax, no IR-format change, no authorization/disclosure relaxation,
no meter or byte-budget increase, no publication, push or version bump.

## Validation and failure accounting

Final complete run: **`== 0 failure(s) in 753 s`**, exit 0. Command from snapback4/:

```sh
taskset -c 32-47 env SNAPBACK4_RUST_TEST_PROCESSES=8 SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1 scripts/test.sh
```

Every suite group ran and passed. Rust passed in 291 seconds. Clients passed
in 712 seconds: 1,088 passed, 0 failed, 10 inventory skips. Full log:
`/tmp/lane-a-r14-test.log`. No baseline or environmental failure appeared in
this completed full run.

Device artifact: **1,751,333 B raw / 487,832 B gzip**, identical to round 13
and below the unchanged 488,000-byte budget.

Affected checks: 9 review regressions, 57 guide tests, 15 page-admission tests
and 12 work-intent tests: 93 passed, zero failures. Frozen Bun install and
`git diff --check` passed. No modified source exceeds 1,500 lines.

The two deliberate mutation runs each failed one regression as expected.
During test construction, one incorrect fixture spelling (`scope: int
immutable`) failed parsing; it was corrected to the existing `immutable scope`
table line. One accidental Cargo invocation from the repository root failed
on that separate workspace's absent ibex dependency; the command was rerun
from snapback4/. These were local invocation/fixture mistakes, not remaining
product failures.

The baseline log was checked. Separate inherited audit issue:
`./ref-check --verbose` reports the same broken reference at
`crates/snapback4-core/src/store.rs:809` to the nonexistent
`LLP 3000.013#5.3-effects-keyed-once` anchor; the document's anchor is `#5.3`.
Reproduction: run `./ref-check --verbose` from the repository root. It reports
504 LLP documents / 9,240 references, 1 error, 0 unchecked. No new reference
error. No known remaining round-14 functional problem.
