# Snapback 4: Resolve witness tools from the Snapback 4 workspace

Status: Open
Priority: P2
Observed: 2026-09-12
Review finding: R34
Evidence: Code traced and used during the headless review probe
Baseline: `d6c803878a5432cce5f045777786a049972d3d70` / Snapback 4 0.0.16
Related: [LLP 3000.003](../llp/3000.003-one-semantics-and-credible-verification.research.md), [comprehensive review](../llp/reviews/3000-architecture-code-review-20260912.md)

## Problem and reproduction

The Chromium witness resolves `playwright-core` from the hard-coded path
`~/projects/snapback/snapback2/packages/snapback2/package.json`. It therefore
depends on a separately installed sibling workspace and a particular checkout
location, despite Snapback 4 having its own dependency/bootstrap fence.
Installing Snapback 4's frozen lockfile alone does not establish that witness
precondition.

Declare and resolve the witness dependency within the owning workspace or an
explicit documented tool installation, using paths relative to this checkout.
Keep the browser executable override/discovery separate from package loading.
Verify the witness can start in a checkout at a different location with no
Snapback 2 node_modules and gives a clear missing-browser diagnostic when
necessary. Do not initialize or install an unrelated runtime to satisfy the
witness. This concerns the existing witness, not an additional test harness.

## Implementation locations

- [witness/lib.mjs](../snapback4/witness/lib.mjs)
- [package.json](../snapback4/package.json)
- [apps/chat/package.json](../snapback4/apps/chat/package.json)
