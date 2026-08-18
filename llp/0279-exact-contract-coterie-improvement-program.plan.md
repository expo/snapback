# LLP 0279: Exact/Contract improvement program from the Coterie benchmark

**Type:** Plan
**Status:** Draft
**Systems:** Exact/Contract integration, Competitive evaluation, Benchmarks,
Code generation, Diagnostics, Testing, Guide, Developer experience
**Author:** Claude (Fable 5) / Charlie Cheever
**Date:** 2026-08-17
**Revised:** 2026-08-17 (same-day graduation: the twelve new Exact-side
tickets were picked up by an sbs-orchestrate Exact-side batch and graduated
into the Exact repository under the same filenames; the Snapback-side copies
are closed pointers under `issues/closed/`, and live state is in the Exact
repo's tickets)
**Revised:** 2026-08-17 (initial Draft: aggregates the Exact/Contract-side
friction recorded across Diary 0086's M1–M3 entries into one prioritized
program with ticket pointers)
**Related:** LLP 0266, LLP 0277,
Diary 0086,
`issues/20260816-exact-declared-error-code-envelope.md`,
`issues/20260815-coterie-exact-native-controlled-input-clear.md`,
`issues/20260815-guide-gap-coterie-exact-prebuilt-macos-host.md`,
`issues/20260817-coterie-feed-pagination-third-page-stall.md`,
`issues/20260802-exact-production-runtime-breaks-contract-routes.md`

## Summary

The Coterie benchmark validated Exact/Contract's core promises — one
host-neutral component source, a generated provider seam that fails closed,
and a native Acto tree that catches real portability defects — while
accumulating a specific register of generator, envelope, mock-boundary, and
dev-loop gaps. Individually each cost minutes to hours of discovery;
together they were the largest discoverable-only tax in the program, and
several will be paid again by every future Contract app and every future
`ContractDataProvider` adapter.

This plan is the single prioritized worklist for that register. Delivery
happens in the Exact repository; this document owns sequencing, the
benchmark-derived acceptance evidence for each item, and the tickets. The
twelve tickets this program filed were graduated same-day into the Exact
repository (same filenames there); their Snapback-side copies are closed
pointers, so `issues/closed/` paths below are the local record, not a claim
the work is done. Items that grow human coordination move to Linear (Exact
project) per repo policy, recording the pointer here.

Evidence base: every item cites the Diary 0086 entry that observed it. All
are single-run observations from one intensive program; none has been
refuted, and the highest-priority items were hit repeatedly *within* the run.

## P0 — contract-carrying correctness

These change what the generated seam can honestly express; adapters and
tests are currently working around them with weaker vocabulary.

1. **Declared-error envelope carries typed `code`.** Exact generates
   declared-error `code` fields but the runtime serializer drops everything
   except name/message/stack, so Coterie tests and both providers branch on
   error *name* and Snapback's stable `SNAPBACK_*`/application codes are
   flattened at the boundary. Ticket:
   `issues/20260816-exact-declared-error-code-envelope.md`. Acceptance:
   Coterie's adapters return codes end to end and the name-branching in
   the acceptance runner is deleted.
2. **Mutation compatibility tokens get a core schema key.** Queries carry
   core `compatibilityToken` fields; mutations refuse the key, forcing the
   milestone-namespaced `coterie.m1CompatibilityTokens` extension that every
   adapter must know to read. Ticket:
   `issues/closed/20260817-exact-mutation-compatibility-token-schema.md`.
   Acceptance: the Coterie extension collapses into core fields with no
   declaration-digest ambiguity.
3. **Typed page envelope for provider list queries.** List results are bare
   row lists, so `listFeed` repeats one opaque `nextCursor` on every row of
   a non-terminal page. Ticket:
   `issues/closed/20260817-exact-provider-list-page-envelope.md`. This should be
   designed against Snapback's LLP 0278 D1 envelope so the two sides of a
   `ContractDataProvider` translate one page shape.
4. **Ephemeral operation descriptors in the provider-native generator.**
   The runtime manifest can represent ephemeral operations, but the closed
   declaration generator cannot emit them, so Coterie's typing surface lives
   in a documented bridge extension with a parallel durability vocabulary.
   Ticket: `issues/closed/20260817-exact-ephemeral-declaration-generation.md`.
   Acceptance: the v8 bridge extension is deleted and typing claims are
   first-class declaration facts.

## P1 — generator and compiler diagnostics

Silent-wrongness classes; each produced a subtle defect or manual repair.

5. **Diagnose result-name alias collisions.** A mutation `logout` with
   result shape `LogoutResult` generated `type LogoutResult = LogoutResult`;
   the same collision recurred at `createPost`/`CreatePostResult`. Renaming
   is a harmless workaround; the generator should refuse or auto-disambiguate
   with a diagnostic. Ticket:
   `issues/closed/20260817-exact-generated-alias-self-reference.md`.
6. **Diagnose action application in function-typed component props.**
   `press=likePost(post.id)` curries on an event attribute but evaluates
   eagerly as an ordinary prop — the first Coterie port toggled like state
   during render on every feed card. The composition guide documents the
   distinction; a compiler diagnostic for curried-action expressions flowing
   into function-typed props would prevent the whole class. Ticket:
   `issues/closed/20260817-exact-curried-action-prop-diagnostic.md`.
7. **Stop `contract-meta` widening nullable sidecar types.** Regeneration
   widened five `string | null` state fields to `string`; the checked-in
   sidecar needed hand correction after an otherwise successful run.
   Ticket: `issues/closed/20260817-exact-contract-meta-nullable-widening.md`.

## P2 — mock boundary and portable-input primitives

8. **Multi-table dependency-aware mock subscriptions.** The mock boundary
   anchors one live handle per query to one table, which first forced
   honest no-op invalidation writes and then a Coterie-local wrapper that
   subscribes derived queries to each declared table. Upstream the wrapper's
   semantics so declarations and mutation traces stay truthful by default.
   Ticket: `issues/closed/20260817-exact-mock-provider-multi-table-subscriptions.md`.
9. **File-input primitive.** Contract has no portable file input, so avatar
   and post-media selection are fixture-reference pickers and the Snapback
   adapter's real upload path cannot be exercised from a portable form. This
   is already in flight upstream (author-built); this program records the
   dependency: the Coterie "real file upload" slice is blocked on it, and it
   retires benchmark-specific picker vocabulary.
10. **Native controlled-input reset.** UIKit retains submitted glyphs after
    Contract state clears; Coterie double-buffers the composer's native
    input identity (seven extra nodes, inspector warnings). Ticket:
    `issues/20260815-coterie-exact-native-controlled-input-clear.md`.
    Acceptance: the double-buffer workaround is deleted.
11. **Mutation-observability annotation for intentional cross-route
    writes.** The checker's locality warnings are accurate but noisy for
    denormalized projection maintenance; an intentional-write annotation
    would keep the check sharp. Ticket:
    `issues/closed/20260817-exact-mutation-observability-annotation.md`.

## P3 — host and dev-loop

12. **App-environment projection for the native module pipeline.** Web
    provider selection was a small Vite `envPrefix` change; native has no
    documented app-environment projection, so the native entry hard-codes a
    build-time constant. Ticket:
    `issues/closed/20260817-exact-native-app-environment-projection.md`.
13. **In-process mount of a routed `.contract` graph.** No public API mounts
    the routed module graph into an Acto semantic tree without the Vite/host
    surface, capping headless acceptance at generated-binding evidence.
    Ticket: `issues/closed/20260817-exact-inprocess-acto-mount.md`. Acceptance: the
    Coterie runner gains mounted-tree steps without a browser.
14. **Prebuilt macOS host must load the requested URL.** `exact run macos
    --url ...` selected a verified host that displayed its embedded Caltrain
    bundle; the command made the artifact look usable. Ticket:
    `issues/20260815-guide-gap-coterie-exact-prebuilt-macos-host.md`.
15. **Dev-loop hygiene bundle.** Scoped typecheck so a dirty sibling Exact
    checkout cannot fail an app's `bun run typecheck` (nonlocal outcomes);
    recover from coalesced hot reloads rejecting `ViewNotFound` without a
    scoped simulator relaunch; fix the Image-alt warning false positive.
    Ticket: `issues/closed/20260817-exact-dev-loop-hygiene.md`.
16. **Paved layout/session composition example.** Every Coterie route
    repeats the same provider query and primary-navigation wiring; the diary
    names this the first paved-example gap as screen count grows. Ticket:
    `issues/closed/20260817-exact-contract-layout-recipe.md` (guide-shaped, Exact
    docs).
17. **List reach geometry.** Fixed `estimateSize` virtual rows overflowed
    variable-height feed cards (fixed by the documented non-virtual list),
    and the non-virtual list's reach geometry mixes item count with pixel
    offsets, leaving the end edge sticky at the third page. Ticket:
    `issues/20260817-coterie-feed-pagination-third-page-stall.md`.

## Sequencing and evidence discipline

Work P0 in order 1→4 (each unblocks honesty in the shared declaration), then
P1 as a batch (small, independent), then P2/P3 opportunistically. Every item's
acceptance is stated as *deleting a Coterie workaround or skip* — the
benchmark is the regression instrument, which is the cheapest way to keep
this program honest. When an item lands upstream, rerun the Coterie
acceptance and conformance suites, delete the workaround in the same change,
and close the ticket with the run pointer.

## Open questions

1. Which items does the Exact roadmap already cover natively? This program
   should adopt upstream sequencing where it exists rather than impose one.
2. Should item 3 wait for Snapback's LLP 0278 D1 shape to stabilize, or
   land first and constrain it? (Proposal: co-design; neither blocks.)
3. Does item 13 change LLP 0266 D10's evidence taxonomy (a mounted headless
   tier between generated-binding and browser-context proof)?
