You are lane RY of Snapback 4, round 5, in `~/sb4-intent/lane-ry` (branch `sb4-intent/ry-receipts-allocation`). Rounds 0–4 are your own work: read their prompts and reports, whose rules still bind you.

**Reviews of round 4.** Astra: NOT READY (`~/sb4-intent/reviews/ry-r4.astra.md`). Grok: READY (`~/sb4-intent/reviews/ry-r4.grok.md`). Read both in full. Astra confirmed:
- every failure shape from rounds 1–3, including Grok's five `bySender` cases and the maintained-column follow-up;
- that ordinary flows still predict;
- all 704 generated scenarios;
- the suite and wasm.

One escape remains (reproductions at `/tmp/ry-r4-astra-jfjonyny/snapback4/crates/snapback4-lang/tests/declarative_receipts/review_extra.rs`):

1. **(Astra P1) Builtins that consume compound values bypass receipt observation.** `share(1, [m], {…})` (`engine/runner.rs:1099`) compares whole records without recording their receipt dependencies. The device's inserted record has `recipients: 0` and the server's has `recipients: 1`, which produces both a terminal device refusal (outbox empty) and a false local success, on both stores, with and without a horizon. Composite `min`/`max` and record-valued `group` keys also lack observation.

**Close it at the value level this time: taint, not reader lists.** Every value produced by reading clause-owned state carries a taint mark: a field, a whole record or row containing a clause-owned field, or an aggregate of one. Any operation propagates the mark to its result: arithmetic, comparison, record and list construction, builtins, keys, `min`/`max`, `group`, `share`, string formatting, and so on. When a tainted value reaches a decision (a branch, `require`, a rule, a write key or target, a builtin's outcome, a maintained contribution), or is written to a non-clause field, the mutation is touched, and therefore unpredictable under round 4's rule.
- The allocator's own values are exempt only where the allocator itself uses them.
- A record the mutation inserted is tainted only in its clause-owned fields, so `m.id` and `m.text` stay clean and ordinary sends still predict.
- Remove the per-construct observation code that this subsumes.
- Add a generated test that passes clause-owned fields and whole records through every builtin and operator, into every decision kind.
`main` has moved: merge `origin/main` first, keeping both sides (wasm budget = the measured merged size, with reasons). Run your affected tests, the whole guide, and `scripts/test.sh` once. Report its exact summary line and every failure, marking each as yours, baseline or environmental. Report the wasm size. Write the report under `round5/`, update LLP 3000.022 §14, append one journal entry, and commit with the co-author trailer. Push and publish nothing.
