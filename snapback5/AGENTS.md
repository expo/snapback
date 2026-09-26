# Snapback 5 — agent command sheet

Read [LLP 4001](../llp/4001-snapback5-sql-front-end.rfc.md) (the second bet,
**Shelved** after pre-test 1 on 2026-09-25), then
[LLP 4000](../llp/4000-snapback5.rfc.md) (the first bet, **Shelved**), then
[LLP 3000.015](../llp/3000.015-shared-baseline-for-snapback5.spec.md), then
this directory's [JOURNAL.md](./JOURNAL.md) and [NOT-DOING.md](./NOT-DOING.md).
**There is no live Snapback 5 bet.** This fence remains for the stubs, reports
and tools. The [pre-test 1 record](./reports/20260925-pretest1/README.md)
applies the registered stop at LLP 4001 §9 step 4; pre-test 2 and compiler
work do not proceed. LLP 3000.015's additions live in Snapback 4.
The README opening and the earlier NOT-DOING residency bans describe LLP
4000's historical treatment; LLP 4001 used the unchanged Snapback 4 runtime.
Neither shelved proposal authorizes implementation. LLPs for Snapback 5
are numbered **4000 and up**; a new bet needs an explicit decision.

This is a fenced sibling of Snapback 4. The repository-root Snapback 1–3
gates, inventories, bootstraps and proofs do not apply here. None of
Snapback 4's gates applies inside this fence except its inherited
[wasm budget](../snapback4/metrics/wasm-budget.json). Work that changes the
shared `snapback4-*` crates follows that directory's own instructions and
checks. A lane's explicit verification brief still applies to that lane.

- Keep the engine shared. Shared authoring additions live in Snapback 4.
  LLP 4001 proposed a separate SQL front end; its historical control is the
  unchanged Snapback 4 binary. Do not silently change the control's feature set,
  client contract or predictor.
- The shelved SQL design lowers to Quarry; it has no implemented transpiler.
  The recorded design uses one unchanged interpreter and partition stream. No
  Snapback 1–3 runtime dependency. Copy source only deliberately, identify
  its origin in the journal and keep source files below 1,500 lines.
- The journal is append-only and dated. Update governing LLPs with code
  when a settled decision changes. Add useful `@ref` annotations for
  non-obvious design choices; validate them with root `./ref-check --verbose`.
- Generated artifacts are built, never committed. The concept counter's
  scratch fixture, generated API and build logs belong in ignored `.work/`.
  Run it from any directory with Node 24; [the tool guide](./tools/README.md)
  gives prerequisites and the frozen counting rule. Counts are reported,
  not ratcheted, until the first calibration.
- A proposal is not an implemented capability. Do not claim differential
  page invariants, control equivalence or comparison scores without the
  scoped evidence LLP 4001 §8 requires. Nothing in this scaffold implements
  the SQL front end or authorizes a publication or deployment.
- Work in the assigned worktree and branch. Never `git stash`; commit
  checkpoints. Record server PIDs at launch and stop only those PIDs,
  never a process name or pattern. Respect concurrent lanes' ownership.

```sh
node snapback5/tools/concept-count.mjs --arm snapback4
node snapback5/tools/concept-count.mjs --arm snapback5
```
