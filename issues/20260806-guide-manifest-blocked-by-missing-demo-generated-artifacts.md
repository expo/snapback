# Guide manifest regeneration blocked by missing demo-generated artifacts

Status: open

`node scripts/generate-guide-manifest.mjs` (and therefore `node
scripts/check-guide.mjs`'s full pass) refuses to write over a failing
corpus. In a fresh worktree at `86b86117f` (LLP 0184 Phase 2 P1 tip), it
fails with two errors unrelated to any in-flight LLP 0184 §B work:

```
[guide-manifest] error: guide/backend/trusted-runtime-values.md: examples path does not exist: demos/competitive-checkpoint/snapback/generated/operations/startReply.args.schema.json
[guide-manifest] error: guide/backend/trusted-runtime-values.md:55: snippet source does not exist: demos/competitive-checkpoint/snapback/generated/operations/startReply.args.schema.json
[guide-manifest] error: guide/clients/contract-adapter.md:46: snippet source does not exist: demos/todo-v2/snapback/generated/contract/setCompleted.mutation.ts
[guide-manifest] error: guide/clients/contract-adapter.md:55: snippet source does not exist: demos/todo-v2/snapback/generated/contract/runtime-links.ts
```

Confirmed pre-existing (reproduces identically with `git stash` back to
plain `86b86117f`, before any of this session's changes). Neither
`demos/competitive-checkpoint/snapback/generated/operations/` nor
`demos/todo-v2/snapback/generated/contract/` exist in this worktree —
these are generated demo artifacts (not checked into git) that some prior
build step must have produced and referenced from the guide, but a fresh
worktree/clone has no path that regenerates them before the guide check
runs.

Effect: `guide/guide-manifest.generated.json` and
`guide/guide-flat.generated.md` cannot currently be regenerated from a
clean worktree at all (`generate-guide-manifest.mjs` refuses to write on
any corpus error, including these two pre-existing, unrelated ones) — both
files were already showing as locally modified/stale at the start of this
session, which is consistent with a previous session hitting the same
wall.

Fix options: (a) document/script the demo-build step these two guide
snippets depend on, so a fresh worktree can regenerate them before guide
checks run, or (b) point `trusted-runtime-values.md` / `contract-adapter.md`
at committed fixtures instead of live demo-generated output, or (c) add
these two demos to whatever bootstrap step readies the guide corpus.

Same missing artifacts also fail a Rust test independent of the guide
corpus: `cargo test --lib` (`local::tests::
generated_demo_manifests_pass_the_effect_ceiling_subset_check`) reads
`demos/competitive-checkpoint/snapback/generated/schema.manifest.json`
directly and panics identically on a fresh worktree:

```
thread 'local::tests::generated_demo_manifests_pass_the_effect_ceiling_subset_check' panicked at src/local.rs:43326:45:
read demos/competitive-checkpoint/snapback/generated/schema.manifest.json: No such file or directory (os error 2)
```

So this is not purely a guide-check concern — `cargo test --lib` cannot go
fully green on a fresh worktree/clone either, until this is fixed. `demos/
todo/snapback/generated` and `demos/rbac/snapback/generated` have the same
"empty until generated" shape but ARE reachable via `node demos/_kit/
codegen.mjs demos/<name>/snapback` (verified working during the LLP 0184
§B session); `competitive-checkpoint` and `todo-v2` were not attempted —
unclear whether the same codegen invocation suffices for them or whether
something else (a different generator, missing dependency, or genuinely
absent source) is blocking them specifically.

Not touched by this ticket's filer — out of scope for the LLP 0184 §B
(`debug.live.forceResync`) work that surfaced it; filed so it isn't
silently rediscovered by the next session that needs a clean
`check-guide.mjs` or `cargo test --lib` pass.
