# Snapback 4: the client test "README TypeScript examples compile and call every public function" is red on main — `worker.runGeneratedEffects` has no README example

Status: Closed 2026-09-18 — a README `ts` block in `packages/snapback4/CLIENT-AND-OPERATIONS.md` ("Workers and services") shows the declaration-bound arm `runGeneratedEffects` with a registration built from the generated manifest's contract; `readme-examples.test.mjs` passes
Priority: P3 (a blocking-suite red on main with no product defect behind it; every landing since sees it)
Date: 2026-09-17
Systems: `snapback4/packages/snapback4/README.md`; `packages/snapback4/test/readme-examples.test.mjs`; the worker surface (`packages/snapback4/src/worker.ts`)
Observed version: main at `b532afdcff` and `dfafb665f7` (found by the wave-13 lead while landing W13g; not W13g's — its README edits are the retention paragraphs)
Evidence status: reproduced alone from the repository root (`node --test --test-name-pattern='^README TypeScript examples compile' packages/snapback4/test/readme-examples.test.mjs`)

## Problem

```text
AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
+ actual - expected
+   'worker.runGeneratedEffects needs a call in a README ts/tsx block'
```

`98e124c058 feat(snapback4): add generated effect context` added `runGeneratedEffects` to the worker's public
surface; the README test requires every public function to be called in a README `ts`/`tsx` block, and the README
has no block calling it. The test is red on main since that landing. Until it is fixed every landing's client
suite reports one failure that is nobody's, which hides real reds (LLP 0232: a pre-existing main red is
fix-forward work, not a landing veto — but it must be filed, not carried).

## Fix

The program that added `runGeneratedEffects` adds the README block that shows its use (the worker card's form),
or removes it from the public surface if it was not meant to be public. Owner: the generated-effect-context
program (`98e124c058`); not claimed by wave 13.

## Resolution (2026-09-18)

Fixed forward on main so the publish gate for 0.2.29 can run: `CLIENT-AND-OPERATIONS.md` gains a
paragraph and a `ts` block beside the `runWorker` example, stating that `startServer` runs
`runGeneratedEffects` — one fenced claim loop per declared effect, each claim bound to the
declaration's contract digest, stopping with `E_EFFECT_GENERATION` on a changed declaration —
and showing the arm with `manifest.effects.notify!.contract`, typed through `GeneratedEffectOutcome`.
The block is compiled and its call is counted by the README examples test. Whether the arm should
remain on the public `snapback4/worker` surface at all (only `src/server.ts` calls it; its
registration type is `@internal`) is left to the program that added it.
