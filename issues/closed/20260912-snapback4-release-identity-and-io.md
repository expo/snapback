# Snapback 4: Keep release identities immutable and propagate activation I/O failures

Status: Closed
Resolved: 2026-09-13
Priority: P1
Observed: 2026-09-12
Review finding: R04
Evidence: Release reuse and stale source reproduced; ignored I/O code traced
Baseline: `d6c803878a5432cce5f045777786a049972d3d70` / Snapback 4 0.0.16
Related: [LLP 3000.000](../../llp/3000.000-atomic-schema-and-release-activation.research.md), [comprehensive review](../../llp/reviews/3000-architecture-code-review-20260912.md)

## Problem and reproduction

`deploy` chooses `current + 1`; `rollback` decreases current. The next deploy
therefore reuses an existing release directory and writes only source files
present in the new project, leaving removed modules behind. It also reuses the
release number as a replica generation. Source writes, generation writes,
current-pointer writes and ledger appends frequently discard their errors.

Reproduction in an empty temporary deployment: deploy 1; deploy 2 with an
`extra.q` module; rollback to 1; remove `extra.q` and deploy new source.
The command announces release 2 again, and `releases/2/snapback/extra.q` still
exists. Serving that directory can load an operation absent from the source
that was just deployed.

Allocate release identities independently of the rollback target, never reuse
or partially overwrite a published source directory, and separate source
identity from monotone activation generation. Stage a complete source tree and
check every required write before reporting success. Cover a failed source
write, an unwritable current pointer, rollback followed by deploy, and removal
of a module. Coordinate database activation with LLP 3000.000; atomic rename
of the pointer alone does not establish a consistent running engine.

## Implementation locations

- [crates/snapback4/src/verbs.rs](../../snapback4/crates/snapback4/src/verbs.rs)

## Resolution — 2026-09-13

Releases reserve immutable directories above every prior number, check preparation I/O, compare the predecessor under activation, and use the SQLite release pointer as authority. Post-activation convenience-file failures report the committed activation honestly.

Verification and independent review are recorded in the [correction qualification](../../llp/reviews/3000-review-corrections-20260913.md). Relevant regression or artifact locations:

- [packages/snapback4/test/release-activation.test.mjs](../../snapback4/packages/snapback4/test/release-activation.test.mjs)
