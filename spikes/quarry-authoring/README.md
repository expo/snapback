# Quarry authoring test

Does a from-scratch notation (Quarry, a paper design — see LLP 0329.014.004
and LLP 0329.014.009) change how models fail when authoring bounded data
programs, compared with the current TypeScript-subset spelling? The
hypothesis under test: TS's **false affordances** (constructs the prior
suggests but the checker refuses — `while`, ambient time, unbounded scans,
page reductions as totals) cause first-attempt defects that an unfamiliar,
smaller notation avoids; the counter-hypothesis is that unfamiliarity just
trades them for hallucinated syntax.

## Design

- **Arms:** A = TS with API reference only (no policy — the "agent assumes it
  can" condition); B = TS with API reference + the checker's policy rules;
  C = Quarry with its complete one-page spec. B and C are length-matched
  (~8 KB); A is B minus policy. Worked examples are the same two programs
  (thread, send) in each notation.
- **Tasks:** 10 (`packet/tasks.md`), each seeding one trap from the
  first-attempt taxonomy (`snapback2/packages/compiler/fixtures/first-attempts/`)
  or serving as a control: T01 control join, T02 unbounded scan,
  T03 structural count, T04 structural rank, T05 intent clock,
  T06 unbounded recursion, T07 fanout, T08 missing guard, T09 capped display
  count, T10 capacity race (**admissible-but-wrong**: the page-count capacity
  check certifies but overbooks — verified against the real checker).
- **Authors:** codex `gpt-5.6-sol` (xhigh), `grok-4.6` (xhigh), Claude Haiku
  4.5 — three model families; the small model is the most prior-dependent
  instrument. One fresh invocation per (model × arm × task), cwd = an empty
  sandbox (no repo access; the references live in this tree). 90 generations.
- **One-shot:** no compiler, no repair round. First attempt graded as written.

## Grading

- `grade.mjs` extracts each submission's code block; TS arms run through the
  real pipeline (`bun src/cli.ts <module> --synthetic-schema` in
  `snapback2/packages/compiler`) for a machine verdict.
- Rubric (`packet/references/rubric-and-references.md`): per-task items in
  four buckets — **PRIOR** (prior-collision defect), **SEM**
  (admissible-but-wrong), **SYN** (syntax/API fumble, noise bucket), **INC**
  (incompleteness) — each avoided / committed / not-attempted. Reference
  solutions in both notations; the TS references pass the checker.
- Quarry has no machine checker; C is rubric-graded only, with syntax fumbles
  scored separately from semantic defects. A sample is independently
  cross-graded for agreement.

## Running

```
node packet/assemble.mjs        # tasks.md + briefs -> packet/prompts/{A,B,C}-T##.md
./run-model.sh codex 5          # one model, 5-way parallel; re-run to retry failures
./run-model.sh grok 5
./run-model.sh haiku 6
node grade.mjs                  # -> grading/modules/, grading/machine-results.json
```

Results and analysis: LLP 0329.014.009.
