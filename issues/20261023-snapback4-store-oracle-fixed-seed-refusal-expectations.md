# Store-oracle fixed seeds disagree with their refusal expectation list

Status: Open
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
- `generate(10)` and `generate(25)` also supply values outside their compiled
  argument interval; the diagnostic test prints the remaining seeds.

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
