# Store-oracle fixed seeds disagree with their refusal expectation list

Status: Closed
Date: 2026-10-23
Related: LLP 3000.035 §5.1; LLP 3000.009.001.000 §3.4

The S10e-1 common-engine run executes all fixed store probes without a store
signature, but `both_stores_all_public_boundaries_and_write_observations` fails
its unchanged `runtime_refused_unexpected.is_empty()` assertion. The generated
SQLite baseline itself returns six E_INPUT refusals and one E_DIV_ZERO for
seeds 0–31. PostgreSQL agrees; this is not a SQLite/Postgres disagreement.

Minimal deterministic inputs:

- `generate(4)`: argument `a` is -9007199254740990, while its compiled type is
  `int 1..1`; the baseline returns E_INPUT before evaluation.
- `generate(15)`: the generated expression divides by zero, returning E_DIV_ZERO.
- `generate(10)`, `generate(25)`, `generate(27)`, `generate(28)`,
  `generate(29)` and `generate(31)` also supply values outside their compiled
  argument interval. Diagnostics include SQLite baselines for cases the
  Postgres profile excludes; the supported store report counts six E_INPUTs.

Run the `stores` integration target with a private Postgres cluster and
`--nocapture`; its fixed-seed diagnostics expose each refusal before the guard.
The 32-case campaign has zero generator/setup errors and zero store signatures;
the 33-case integration run also exercises an extra insertion.

Keep the guard red until the generator's intended invalid inputs and the
expected-refusal accounting have a precise common contract. Do not globally
allow every E_INPUT: that would conceal unexpected input regressions. Existing
stored/shrunk fixtures and the exact per-outcome comparison remain unchanged.
The two common-profile time-publication exclusions are independently named
E_STORE_UNSUPPORTED outcomes outside `passed`, and are not this guard failure.


## Resolution — 2026-10-23, S10e-1 fix round 1

A real cold probe of `addf5750eb` in a detached worktree and separate target
could not run this guard: `store_database.rs:267` and `:270` fail E0308 because
the old snapshot API expects `&Store`, while `Engine::store()` returns
`&AnyStore`. This is not runtime evidence that the guard was red at base.
Migration's snapshot adaptation makes it reachable, so the fix round takes
responsibility for the now-enabled expectation failure.

The store campaign now recognizes only the generated invalid-input shapes:

- `a` is an integer outside its declared `arg_bound`, and E_INPUT has the
  exact matching interval/value diagnostic;
- a scalar rounded division has a literal/supplied integer divisor equal to
  zero, and E_DIV_ZERO has the division-by-zero diagnostic.

Unrelated E_INPUT errors, an in-range value, an unbounded argument and a
nonzero divisor remain unexpected in the regression controls. No generic
E_INPUT allowance, generator change, budget expansion, outcome normalization
or unsupported exclusion was introduced. Runtime refusal counters still
record every such outcome; all per-store comparisons remain exact.

Evidence: the focused classifier regression passes; the full private runner's
six Postgres difftest library tests and all three store integration tests pass,
including the unchanged `runtime_refused_unexpected.is_empty()` guard over
33 compiled cases, zero signatures, and the two named time-publication
exclusions outside `passed` on each Postgres arm. Logs are
`snapback4/target/s10e1-fix1/{base-guard,refusal-classifier,postgres-all}.log`.
The base probe's cluster, worktree and target were stopped/removed immediately.
