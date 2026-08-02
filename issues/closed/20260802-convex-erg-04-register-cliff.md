# G-04: The register cliff — one ordinary query must not degrade a whole register group

**Status:** Resolved — path (b) landed; implementation is gated on an
accepted mixed-route successor profile
**Program:** 20260802-convex-erg-00-program.md
**Systems:** Live queries, Client integration, Codegen
**Related:** LLP 0127 (reactivity-fee finding), LLP 0090 (resumable query
snapshots — register/rung-2 tails recorded open at its execution close),
LLP 0114 (client seam), LLP 0155 Move 1/2 (the strategic successor surface)

## Task

The parity research records a reactivity cliff: mixing one ordinary
(non-analyzable / opaque) query into a register group degrades the whole
group's delivery class, so authors pay a classification fee Convex never
charges. The 2026-08-02 synthesis lists it as an un-programmed gap.

**Verify first:** reproduce the cliff on current main (the delta-lane
conservatism just changed in eda8f231 — behavior may have moved). Record: what
exactly degrades (delivery lane? retainability? the whole group vs the one
query?), which doc owns the current behavior, and whether LLP 0090's open
register/rung-2 tail tickets cover it.

**Then either:** (a) implement per-query classification so an opaque query
degrades only itself, under the existing capability-classification vocabulary
— if the fix is within decided design; or (b) if it needs new design, write
the finding into the owning LLP (0090 or the 0155 Move-1 Spec) as a dated
amendment proposal and re-scope this ticket to that path. Do not silently
widen delivery guarantees for opaque queries; the fix is isolation of the
degradation, never upgrade of the unanalyzable.

## Exit

- The dated reproduction/ownership note.
- Path (a): a test proving one opaque query in a group leaves sibling
  analyzable queries' delivery class untouched, plus the inspector/diagnostic
  naming the per-query class. Path (b): the amendment proposal landed and
  this ticket re-scoped or closed onto the successor.

## Running log

- **2026-08-02 — current-main reproduction and ownership delta.** Reproduced
  against `1a056305a63fc49755e2cf845c58fdbce7ae81b2`. Codegen admits
  `[LiveQuery, LiveQuery]` as one generated query group, keeps
  `[LiveQuery, Query]` as a valid read-bundle route but emits neither
  `registerGroupEligible:true` nor a generated group, and admits
  `[LiveQuery, defineJsLiveQuery]` as a generated group. Therefore the cliff
  is not opaque-plan analysis, per-query `live_delta`, or the live matcher:
  it is the route-level all-`LiveQuery` gate in
  `generatedQueryGroupRoutes` and the generated format-1 projection. LLP
  0112 owns that current behavior; LLP 0090 D1.2 owns the whole-request
  read/register protocol that makes a codegen-only relaxation dishonest.
  The existing `authoring-validation.test.mjs` mixed-route fixture passed and
  pins the current outcome; the nine-test `live_delta_v0` suite remains green,
  so no global delta degradation was found.
- **2026-08-02 — path (b), amendment proposal.** A dated, explicitly
  non-normative proposal now sits in LLP 0090's revision history. It asks a
  successor version to preserve one pinned snapshot while classifying each
  child as registered-live or read-only, project per-child provenance and a
  weakest group state, and close failure/authority/idempotency/cleanup/bounds
  before implementation. LLP 0112 format 1 remains unchanged. LLP 0157 is a
  live, separately owned authoring lane; this ticket neither edits it nor
  treats composition-plan identity as a liveness decision. The implementation
  half is re-scoped to a successor profile and is blocked until that
  author-level contract is accepted.
- **2026-08-02 — current/pre-change verification and closure.** Re-verified
  the path-(b) landing on current `origin/main`
  (`046e7b9ee2ef00be0dec50e43697377b6b689f35`) and on the parent of the
  delta-egress change (`eda8f231^` =
  `87b4e9f9caf19ea2c9fd36814c10a072f46b034e`). On both revisions,
  `npx --yes node@24.18.0 packages/snapback-codegen/authoring-validation.test.mjs`
  passed and pinned
  the same outcome: mixed and ordinary-query routes remain read-bundle-valid,
  but only all-`LiveQuery` routes receive generated format-1 groups. After
  `scripts/bootstrap-ibex-runtime`, the pre-change
  `DYLD_FRAMEWORK_PATH=$PWD/vendor/ibex/ios/Frameworks cargo test --locked --test live_delta_v0`
  suite passed 7/7; current main passed 9/9, including
  the two post-`eda8f231` narrowed-contract validated-replacement cases. The
  behavior change therefore did not create or move the route cliff and did
  not degrade sibling live delivery. `./ref-check --verbose` passed with 158
  LLP documents, 2,730 references, and zero errors.
- **2026-08-02 — inherited clean-worktree proof prerequisites.** The complete
  codegen package suite passed through `remote-service-publication.test.mjs`
  before its inherited missing ignored
  `demos/all-aboard/snapback/generated/functions.manifest.json` stopped
  `data-tier-corpus.test.mjs`. Full `cargo test --locked --lib` likewise
  stopped before tests because current main lacks the ignored generated
  Todo/RBAC manifests included by `src/embed.rs`, `src/seed_identity.rs`, and
  `src/storage.rs`. `node scripts/check-guide.mjs` retained the already
  recorded missing competitive-checkpoint and todo-v2 generated snippet
  sources plus the resulting stale guide manifest. This docs-only closure
  changes none of those generators, demos, guide pages, or runtime sources;
  the focused codegen and native comparisons above are green.

## Resolution

Commit `ceb205a6` landed the dated reproduction, the Program G ownership note,
and LLP 0090's explicitly non-normative mixed-route register-gradient
amendment proposal. That satisfies exit path (b): the implementation is
re-scoped to a new versioned profile and cannot proceed until its author-level
contract is accepted. This closure makes no code, capability, delivery,
carrier, or LLP 0157 claim and does not reinterpret LLP 0112 format 1.
