# Snapback 4: the README coverage test is red on main — `worker.runGeneratedEffects` has no example

Status: Open
Priority: P3 (the blocking suite is red on `main`; no product behaviour is wrong)
Date: 2026-09-17
Systems: `packages/snapback4/README.md`, `packages/snapback4/test/readme-examples.test.mjs`
Evidence status: reproduced by execution on two independent worktrees at `27a8a4d66`, and `git show origin/main:snapback4/packages/snapback4/README.md | grep -c runGeneratedEffects` is 0

## Problem

`readme-examples.test.mjs` asserts that every public function is called from a
`ts`/`tsx` block in the package README. The generated-effects work added
`worker.runGeneratedEffects` without an example, so the test fails:

```
README TypeScript examples compile and call every public function
  actual: [ 'worker.runGeneratedEffects needs a call in a README ts/tsx block' ]
  expected: []
```

`bash scripts/test.sh` therefore reports `1 failure(s)` — `client tests` — on an
otherwise untouched tree.

## Why it matters

It is the only failure in the blocking suite, so it masks nothing today, but it
makes every lane's suite run red and trains readers to ignore that line. It was
found while running the suite for an unrelated repair and initially looked like
that repair's fault.

## Direction

Add a README `ts` block that calls `worker.runGeneratedEffects` in the shape an
app would, next to the existing worker examples. The test compiles the block, so
the example has to typecheck, which is the point of the check.

## Related

- The generated-effect substrate landed in `98e124c05` / `375c1c86c` / `d886c6b3a`
