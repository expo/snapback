# Phase A charter — `assetCollection` (LLP 0239 D2, rollout R3)

You are the implementation engineer for Phase A of ticket
`issues/20260815-finish-media-happy-path.md` (Scope A only). You are working in
a dedicated git worktree on branch `media-happy-path`. An orchestrator reviews
your work, runs the landing gates, and commits — **you do not run `git commit`
or `git push`** (commits fail in linked worktrees anyway).

## Read first, in this order

1. `issues/20260815-finish-media-happy-path.md` — Scope A, required evidence, non-goals.
2. `llp/0239-asset-collections-and-media-field.rfc.md` — D2 (the contract you are
   implementing, including the frozen item-identity rules), D4 (sharing ceiling),
   D6 (diagnostics), Acceptance.
3. `llp/0244-media-ref-projection.spec.md` — every collection item inherits this
   finalized-only MediaRef projection and exact settlement behavior.
4. `SUBSTRATE-MAP.md` (worktree root) — file/symbol pointers into the shipped
   substrate. Line numbers are anchors, not gospel; re-verify.
5. `llp/0110-bounded-children-and-activity-patterns.spec.md` §1 and §1002 — the
   read machinery collections compile onto.

## Non-negotiable constraints

- Implement **exactly** LLP 0239 D2. If you believe collection identity, bounds,
  ordering, duplicate handling, commit ownership, retry identity, or grant
  authority needs to deviate from the RFC, **STOP work on that aspect** and
  append the question to `PHASE-A-BLOCKERS.md` in the worktree root instead of
  inventing semantics in code. Keep working on unaffected parts.
- Asset references stay addressable system-checked facts: framework-owned child
  records with parent id, asset id, stable item id, ordinal, kind, policy
  generation. Never inside opaque JSON.
- Item identity (0239 D2): ids are opaque, scoped to the collection generation,
  never reused after removal. `append` allocates one id per new asset from the
  mutation-attempt identity + item ordinal; `reorder` preserves every id;
  `remove` retires it; `replace` matches retained items by asset id, preserves
  their ids, retires removed ids, deterministically allocates ids for new assets
  from the replacement attempt. Retry with the same mutation attempt produces
  the same plan and ids. Content equality can never revive a retired id.
- Collections cannot be written by raw table insert/patch — enforce a
  storage/manifest-level refusal, not just a codegen omission.
- Every collection item must reference one **finalized** asset admitted under the
  declared intent (reuse the finalized-only branch semantics of
  `enforce_asset_reference_changes`); duplicate asset ids refuse by default.
- Generated ops enforce the count bound, finalized intent/kind compatibility,
  duplicate refusal, parent authority, attachment lifecycle, and the selected
  sharing plan **atomically** in the ordinary mutation host commit.
- Sharing: the collection descriptor owns the maximum admitted sharing classes
  and default (D4). Ops select one exact plan within the ceiling; no ambient
  last-writer default. Authority-profile-derived sharing (LLP 0240 composition)
  remains generation-refused (non-goal, R5).
- Reads return exact ordered `MediaRef` items plus stable item/ordering metadata
  with LLP 0110 bounded paging where required. Reuse `media_result_contract()` /
  the `mediaRef.v1` value shape — do not mint a second media value shape.
  Widening `boundedProjectionValidator` to admit the mediaRef.v1 item node is
  the one expected deliberate contract widening.
- Include generated collection records in: authorization invalidation
  (`src/storage/auth_invalidation.rs` stream), reference GC
  (`insert_reference_edge` so `gc_reclaimable_reference_assets` sees them),
  quota accounting, migration/version identity (schema identity — the
  `snapback migrate media-collection` preview CLI is OUT of scope), and
  consistent-cut export/import (`src/assets_cut.rs`).
- Capability id `assets.media-collection.v1` must exist as **experimental** in
  every registry that mirrors the closed set: codegen `index.mjs` capability
  tables, `src/manifest.rs TargetCapabilityId`, `schemas/capability.manifest.schema.json`,
  `schemas/inspect*.schema.json`, `tests/acceptance/capability-registry.ids.json`,
  `tests/acceptance/capability-maturity.experimental.json`. Do NOT flip the
  guide capability row — the guide is Phase C.
- Diagnostics follow D6: every refusal is source-attributed
  (`<binding>.<property>` path) with a stable `SNAPBACK_*` code and remediation
  text. New codes must be added to `guide/reference/diagnostics-registry.json`
  conventions later — list every new code you introduce in your report; the
  orchestrator regenerates the registry.
- Where code implements a non-obvious 0239 decision, add
  `// @ref LLP 0239#<section> — short gloss` annotations (sparingly, per repo
  convention in CLAUDE.md).
- Do NOT touch `guide/` pages, `guide/capabilities.md`, generated guide
  artifacts, or publication carriers. Do NOT run
  `scripts/check-generated-artifacts` or carrier refresh scripts. The
  orchestrator owns the landing gate cascade.

## Deliverables (work in this order, keep each stage compiling/green)

**Stage 1 — codegen authoring surface.**
`assetCollection({ ownerTable, intent, maxItems, order, kinds, grants })`
exported from `packages/snapback-codegen/define.mjs` (+ `define.d.ts` types),
validated and lowered by `packages/snapback-codegen/index.mjs`:
- `maxItems` required, integer 1–32; `order` `manual`|`created`; `kinds` subset
  of image/video/audio/file; named upload intent must exist and be compatible;
  `grants` within the table's declared sharing ceiling.
- Lower to the framework-owned child table (system table, not app-authored),
  its `relationIncarnationOf` pairing, the bounded-children read plan, and the
  four generated ops (`append`, `replace`, `remove`, `reorder`) as generated
  mutations in the manifest (model: `standard-patterns.mjs` lowering).
- Digest-bound portable descriptors; all invalid declarations refuse with
  source-attributed diagnostics (bounds, unknown intent, bad kinds, duplicate
  policy, bad ordering, sharing outside ceiling, collection on ineligible
  table, raw-write collision).
- Authoring tests: `packages/snapback-codegen/media-collection-authoring.test.mjs`
  modeled on `media-field-authoring.test.mjs`, wired into the package `test`
  script chain. Include acceptance-fixture updates if needed (a sibling of
  `tests/acceptance/fixtures/media-profile` is fine).

**Stage 2 — Rust manifest + storage lowering.**
Manifest types for the collection descriptor and generated ops
(`src/manifest.rs`, `src/contract_types.rs`), validation parity with codegen,
child-record storage shape, and the raw-write refusal.

**Stage 3 — runtime op semantics.**
Atomic append/replace/remove/reorder in the mutation host
(`src/storage/mutation_writes.rs` / `src/storage.rs` commit path): bound,
finalized-only + kind admission, duplicate refusal, parent authority,
attachment edges, sharing plan reauthorization at commit, item-identity
allocation exactly per D2, OCC/retry determinism.

**Stage 4 — lifecycle integration.**
Auth invalidation, GC edges, quota, consistent-cut export/import
(`capture_cut`/`apply_cut`), backup/restore identity.

**Stage 5 — reads.**
Ordered exact `MediaRef` + item metadata projection with bounded paging;
LiveQuery/retained classification consistent with LLP 0110 and 0244.

**Stage 6 — tests (required evidence, Scope A slice).**
Storage/runtime tests covering: append/replace/remove/reorder happy paths;
stable non-reused ids incl. content-equivalent replace; retry same-attempt
identical plan; OCC conflicts; authorization replacement; revocation; GC of
detached items; quota; backup/restore round-trip; raw-write refusal; every
refusal code. Put them beside the patterns listed in SUBSTRATE-MAP.md §9.

## Environment notes

- `cargo test` WITHOUT `DYLD_FRAMEWORK_PATH` set.
- Node tooling: `volta run --node 24.18.0 node ...` when a script compares
  pinned outputs; plain `node` is fine for unit tests.
- Demo codegen caches for todo/rbac/competitive-checkpoint are already primed.
- Your sandbox may make loopback-binding suites (server/stream, auth::backup)
  fail spuriously — note such failures in the report as "sandbox-suspect"
  rather than chasing them; the orchestrator re-verifies outside the sandbox.
- Known pre-existing red set is being captured by the orchestrator; if a test
  you did not touch fails, say so with the exact test name — do not "fix" tests
  unrelated to this charter.

## Report

Maintain `PHASE-A-REPORT.md` in the worktree root as you go (not only at the
end): stages completed, files touched, every new SNAPBACK_* code, every new
capability-registry touchpoint, verbatim test commands + result lines, every
deviation or judgment call, sandbox-suspect failures, and anything left for
the orchestrator. Finish the report with a `## DONE` or `## STOPPED (why)`
section as the last thing you write.
