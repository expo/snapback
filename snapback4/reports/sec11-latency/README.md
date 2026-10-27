# SEC11L — production security-loop latency

Both cold latency targets pass. **Strict full-payload byte identity is not
established:** one advisory rendering differs, including between two runs of the
unchanged baseline. This is retained as a failure, not normalized into a pass.

| Command | Before p50 / p90 / max (s) | After p50 / p90 / max (s) | Target |
| --- | --- | --- | --- |
| `check --review` | 13.629 / 25.144 / 52.852 | 5.189 / 8.332 / 11.606 | p90 <10: pass |
| production `deploy` | 18.266 / 32.834 / 70.485 | 5.294 / 7.528 / 12.945 | p90 <15: pass |

Before is the retained SEC11 cold production measurement. After is 50 wave30
schemas, one timing worker, independent fresh source/fixture copies per command,
no prior test or persistent advisory cache, no tracing, and no tool failures.
This is a shared-host snapshot, not a controlled throughput claim. Peak after
one-minute load/CPU was 0.866 on 96 available CPUs. The production binary hash,
publication SQLite flag, source boundary and exact build command are recorded in
`producer-provenance.json`. No version bump or publication is included.

The implementation batches independent candidate compilation with an exact
fallback, runs independent campaigns concurrently with their original budgets
and replay scopes, reuses the actual same-invocation production report, and
avoids initializing/discovering metadata immediately overwritten by a fixture
backup. Production report/question overlap is guarded by exact actual note-vector
equality and a full original-path fallback. Bounded immutable verified byte
snapshots remove repeated blob copies while preserving independent ledgers,
COW maps, real upload admission and private files materialized after authority
checks. Capacity/read failures retain ordinary copying. Ordinary stores keep
their existing asset representation.

The slowest20 wave30 schemas were selected from the prior cold review times.
Before/after each have 40 complete production command profiles. Two initial
baseline watchdog attempts remain in private evidence; longer-watchdog repeats
complete those profiles. Nested and overlapping spans must not be summed.
Release planning plus other work outside security has after p90 upper bound
0.502 s. On the diagnostic schema018, opens fall 207595→17218, unlinks
103763→7983 and copy_file_range calls 190772→0, with one exec in each run.
The profiles attribute cost; the separate cold50 qualifies latency.

All800 after schemas match source hashes. SEC11's classifier reports zero
unclassified results, zero assessed false gates/refusals, and the retained
19 fresh / 26 post-test refusals. All800 literal decision and product witness
identities match the retained survey. The secondary `--identities-only`
diagnostic intentionally does **not** prove payload equality; its negative
control demonstrates that a stale witness ID can hide a modified caller.
The default comparator continues to compare the complete payload literally.

That primary comparison fails on wave23 `008-snapback-arborist-removal-quotes`,
`N_ARGUMENT_GRANT`. Raw uploaded IDs copied into ordinary optional `id` columns
appear in expanded old/row/supportingRows/generatedIds/summary fields. Ordinary
ID fields are not normalized. Both decision and witness IDs remain unchanged.
The same nondeterminism occurs on the unchanged baseline. See
[the open follow-up](../../../issues/20261027-security-review-payload-upload-id-nondeterminism.md).
Do not describe this result as byte-identical full witness payloads.

Complete authored/derived/enforced counterexamples cover the union of all23
FIX-bearing schemas. They match under the separately reviewed compiler-typed
injective correspondence for uploaded asset IDs. Raw hashes and literal equality
remain recorded (2 raw-equal, 21 with upload-ID entropy). Ordinary IDs, opaque
values, authority facts, callers, arguments, rows and histories are preserved.
Raw counterexamples stay outside Git; comparison controls, union and hashes are
retained here. Fresh-before reruns and any HTTP-preparation retries are recorded
separately when complete; the original attempts remain preserved.

Source reviews from Muse and fresh Codex are retained under `llp/reviews/` for
LLP3000.036.004.000.000. A scoped affected runner preserves the canonical plan,
records explicit exclusions and sets `canonicalComplete:false`, following the
brief's prohibition on full Rust/client pools and the Snapback4 fence. The first
integrated run had unchanged inputs and passed every step except the inherited
neutral `prepare` lexical-ratchet collision, subsequently fixed by an internal
helper rename without changing the guard. Final delivery requires a final-commit
affected receipt, recorded in the worktree's `WORKSTREAM-REPORT.md`.

Short differential coverage: run2000 has zero disagreements; Lean2000 repeats
exactly the baseline's18 disagreements (5 continuation-next, 8 next, 5
E_RULE/NOT_FOUND prelude). No full suite, difftest20k/devices, publication
qualification or push is claimed.
