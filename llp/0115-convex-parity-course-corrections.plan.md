# LLP 0115: Convex-parity course corrections

**Type:** Plan
**Status:** Draft
**Systems:** Competitive evaluation, Developer experience, Authoring, Application data API, Code generation, Runtime, Bootstrap, Packaging, Search, Relational queries, Scheduled work, Client integration, Documentation, Testing
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-07-30
**Revised:** 2026-07-30 (v0.3, Codex pre-implementation review corrections —
verbatim review in `reviews/0115-convex-parity-course-corrections.codex.md`,
13 findings, all verified claims spot-checked: CV-1's evidence corrected
(seven Snapback arms, not fourteen; the admin client is Dispatch-specific,
not every-arm — the same correction applies to the LLP 0041 amendment);
CV-5 re-scoped from one-emitter wiring to schema-export-plus-carrier
alignment (`defineSearchQuery` authors `query: v.json()`, the client
hand-authors the AST interfaces, and no Rust search schema is exported);
the earlier v0.2 publication-state correction is versioned here. The
review's structural findings — LLP 0063 delegation authority, falsifiable
exits and a post-D rerun, the second exact closure before any
published-channel rerun, the receipt-authority definition, ingress
validation as a trust-boundary prerequisite, CV-7's accepted-but-unclosed
findings, the CV-8 five-way split, the CV-9 capability cutline, and the
CV-10 tamper-safe recheck shape — are recorded in the artifact and await
author adjudication before the tranches start.) 2026-07-30 (v0.2, delegated-owner coverage audit: every work item
was checked against what its owning documents and the current code actually
contain. Major corrections — CV-1 gains LLP 0041 as lead owner plus two named
unpublished-artifact gaps and the 0111-vs-0074 npm-gating conflict; CV-3's
"different evidence" claim corrected (the three tools already share one probe
module, one code registry, and one recovery record — the gap is a persisted
receipt and rung coverage); CV-4 split into an arguments-first slice and a
larger stored-fields design, with the overbroad `v.json()` claim narrowed;
CV-6 reframed (the repair-explaining diagnostic already ships at
`severity: 'info'`); CV-7 redirected to revive LLP 0108's superseded
Bounded-static-bundling design rather than start fresh; CV-8 corrected — the
LLP 0113 path terminates at experimental maturity by design, and the aggregate
shapes are Non-goals of both 0110 and 0080, so the third-profile decision is
the load-bearing half; CV-9 reassigned from LLP 0028 to LLP 0070, whose Draft
already specifies transactional one-off enqueue; CV-10 reclassified from spec
amendment to code fix — the content digests actually agree and a
representation-sensitive struct equality is what fails; CV-12 split into
range-filter design vs. already-roadmapped target execution. Open questions 1
and 2 recorded as answered; a new npm-channel-gating question added; the rerun
checkpoint gains a React-surface measurement requirement.)
**Related:** LLP 0004, LLP 0010, LLP 0028, LLP 0030, LLP 0031, LLP 0041, LLP 0046, LLP 0061, LLP 0062, LLP 0070, LLP 0073, LLP 0074, LLP 0076, LLP 0079, LLP 0080, LLP 0086, LLP 0101, LLP 0102, LLP 0108, LLP 0110, LLP 0111, LLP 0112, LLP 0113, LLP 0114, Diary 0032–0039

## Summary

The 2026-07-30 current-main rerun of the seven-app Snapback × Convex matrix
(Diary 0039, evidence commit `45d2455d` over Snapback revision `01e94173`)
scored roughly **55/45 in Convex's favor** — four slight Convex wins, one large
Snapback win (ephemeral presence), and two near ties. That is a major
improvement over the first bakeoff, because current main already shipped the
gaps that dominated the earlier result: indexed full-text search, colocated
inline handlers, exact recursive result contracts, indexed
range/order/take pagination, table-scoped relation IDs, and manifest-only
generated custody.

This Plan sequences the work that closes the remaining gap. The diary's own
recommended order is adopted as the tranche structure:

**external install/runtime qualification → structured inputs and helper
composition → aggregate/children/scheduling primitives → live and broader
portable search → guide/review polish.**

The target is not to clone Convex. Per LLP 0074, the target is to make the
parts users feel immediately — a boring first hour, natural input typing,
reactive defaults, composable scheduling — competitive, while preserving the
properties the rerun confirmed as real differentiators: first-class ephemeral
state, fail-closed evidence boundaries, deterministic acceptance, and explicit
authority/capability contracts. Every work item below carries the constraint
that closing a DX gap must not silently discard the corresponding evidence.

A v0.2 coverage audit checked each work item against its owning documents and
the current code. Its headline: the diary's pains fall into three buckets —
(1) already designed or even shipped, needing execution, wiring, or a severity
decision (most of CV-5/6/7, CV-9's semantics via LLP 0070, CV-12's targets);
(2) genuine design holes no current document covers (stored structured fields,
an aggregate profile, live search, range filters, admin-client/test-helper
publication, VM-qualification receipts); and (3) contradictions between
owners that need an author decision before execution (the 0111-vs-0074 npm
default-channel gate; LLP 0113's inability to mint stable maturity).

## Governing constraints

1. **No evidence regression.** The rerun's Snapback wins — Cursor Garden's
   zero-durable-amplification presence, commit-version proofs, capability
   nonclaims, named fail-closed diagnostics — are load-bearing. A work item
   that improves ergonomics by weakening an evidence boundary is out of scope.
2. **Honest capability claims only.** Search stays declared non-live until a
   real reactive implementation exists (CV-11); hosted/offline/native-FTS
   targets stay nonclaims until they have their own evidence (CV-12). This is
   LLP 0073's existing posture and it held up well in the rerun.
3. **Owning documents stay owners.** This Plan does not respecify inline
   handlers (LLP 0108), relational profiles (LLP 0080/0110), search
   (LLP 0073), scheduling (LLP 0028/0070), or packaging/publication
   (LLP 0041/0062/0111/0113). Each work item names its owner; substantive
   design lands there (or in a new owned Spec), not here.
4. **The evidence graph is not the problem.** The rerun measured Snapback's
   full generated graph at ~7× Convex's lines, but authored size is tied and
   committed custody is now *smaller* than Convex's committed generated tree.
   The goal is fast generation, good semantic diffs, and consumers never
   needing to read internal projections — not shrinking the graph.

## Retired gaps — do not re-litigate

The first bakeoff's highest-profile complaints are fixed on current main and
must not be carried into new backlogs (Diary 0039 §What current main fixed):

- full-text search (shipped, used by the Pantry arm: schema-level index,
  `defineSearchQuery`, portable AST, rank/highlights/cursors);
- declaration/handler duplication (inline form shipped, used by five arms);
- unknown computed outputs (exact recursive result contracts shipped);
- committed generated-tree explosion (manifest-only custody shipped);
- shared pagination (indexed range/order/take path, used by Campfire);
- cron inspection ambiguity (authenticated admin inspection matches guide);
- binary/checkout identity mismatch (both identify the same commit).

Relational composition is *partly* improved — branded IDs and a narrow stable
relational query exist — and the remainder is CV-8, not a rediscovery.

## Status board

| Item | Title | Tranche | Owning doc(s) | Size | State |
| --- | --- | --- | --- | --- | --- |
| CV-1 | Public package/starter loop proven from a clean repo | A (P0) | 0041 (lead), 0111, 0114; 0074 gate | L | Open; blocked in part on the npm-gating decision (OQ5) |
| CV-2 | Bootstrap qualifies the real handler VM | A (P0) | 0010 | M | Open (issue filed 2026-07-30) |
| CV-3 | Persisted runtime readiness receipt across doctor/bootstrap/harness | A (P0) | 0010, 0030, 0031 | M | Open |
| CV-4a | Structured collection validators for arguments | B (P1) | new Spec + 0004 alignment | M | Open |
| CV-4b | Structured collection stored fields | B (P1) | new Spec + 0004/0007/0081 | L | Open |
| CV-5 | Typed search AST: schema export + carrier alignment | B (P1) | 0073, 0037 | M | Open (re-scoped v0.3) |
| CV-6 | Precise mutation results as the paved default | B (P1) | 0108 amendment, guide | S | Open (severity/strictness decision, OQ3) |
| CV-7 | Helper reuse via revived bounded static bundling | C (P1) | 0108 follow-on | L | Open (design exists in 0108's superseded sections) |
| CV-8 | Relational shapes: promote what exists, decide aggregates | C (P1) | 0110, 0080, 0113 | L | In flight (0110 in Review; stable-promotion design does not exist yet) |
| CV-9 | Transactional one-off scheduling (`runAfter`-class) | C (P1) | 0070 (primary) + 0028 test-seam amendment | M | Open (0070 is Draft; first implementation slice) |
| CV-10 | Numeric normalization at the search source/recheck boundary | D (P1) | code fix (`src/search/sqlite.rs`, `src/storage.rs`) + one-line 0073 pin | S | Open (issue filed 2026-07-30; reclassified) |
| CV-11 | Live/re-executing search story | D (P1) | 0073 + 0112/0114 | L | Open (genuine design hole) |
| CV-12a | Portable range filters | D (P1) | 0073 (new design) | M | Open |
| CV-12b | Search target expansion | D (P2) | 0073 §adapter sequence; PG blocked on LLP 0046 | M | Open (roadmap exists; execution only) |
| CV-13 | Inline handlers primary in "Your first backend" | E (P2) | guide (0061) | S | Open (guide-gap issue filed 2026-07-30) |
| CV-14 | Semantic review summary for dense manifests | E (P2) | custody owner (confirm at start; 0062 family) | M | Open |
| CV-15 | Resolve `unpinned` harness wording for exact binaries | E (P2) | 0010 harness | S | Open |

## Work items

### Tranche A — P0: make external adoption and runtime readiness boring

The rerun's largest first-hour confidence cost was not authoring — it was the
framework/runtime edge: a native-artifact incident where link and server
launch both passed while `ex_hermes_create_no_eval()` refused the first
application function, plus checkout-relative imports into the Snapback source
tree. Convex's biggest structural advantage ("installed, coherent product
loop") lives here, and no authoring improvement matters if the first hour is
untrustworthy.

#### CV-1. Prove the public external package/starter loop

**Evidence.** All seven Snapback rerun arms import codegen, clients, and the
acceptance test helpers through paths into a sibling Snapback checkout and
invoke its binary directly, and Dispatch's acceptance additionally imports
the admin client (Diary 0039 P0-1; Diary 0038 §External consumption).
Convex's arms install from the public ecosystem.

**What the owners already cover.** The load-bearing owner is **LLP 0041**
(packaged dev loop): it enumerates the nine-package public closure
(runtime binaries, CLI, codegen, client, and friends under the
`@ccheever/snapback-*` aliases — `@snapback/*` is squatted on the public
registry), the publication state machine and lease authority, repository-free
tarball cold installs, fresh-machine registry installs, and a comparator
receipt that runs a real product fixture with semantic checks. LLP 0111
incorporates that closure by reference and adds the packaged-CLI product
journey from a clean temporary project; LLP 0114 adds the React starter with a
packed cold-install gate. Publication state (corrected 2026-07-30 against
0041's own headers — the v0.2 audit's "never fired" claim was wrong): the
eight-package `0.1.0` closure has been public under `latest` since 2026-07-26
with a ledger-bound publication receipt, and the nine-package `0.1.1`
candidate promotion is in active flight as of 2026-07-29 (propagation-barrier
epochs; no completed promotion claimed). The rerun arms nevertheless consumed
none of it — the matrix ran on sibling-checkout imports three days after the
closure went public, which sharpens P0-1 from "publish" to "make the
published closure actually usable and used."

**Named gaps the owners do not cover.** (1) The **admin client**
(`packages/snapback-admin-client`) is inventoried by 0041 but excluded from
the nine-package closure; Dispatch's acceptance imports it for authenticated
cron inspection, so any arm proving the admin surface externally needs a
decision: add it to the closure, fold it into the client/CLI, or endorse the
served `/_snapback/admin/client.mjs` path. (2) The **acceptance test
helpers**
(`demos/_kit/server-process.mjs`, `demos/_kit/harness.mjs` — server lifecycle
and vacuous-pass-guarded checks) are published by no document; decide publish
vs. fold vs. endorse-vendoring. Without both decisions this item's exit is
unsatisfiable. (3) A **sequencing conflict**: LLP 0111 serializes
default-channel (`latest`) promotion behind the full hosted Fly qualification
journey, while LLP 0074 makes npm publication a parallel gate independent of
hosted milestones. Exact-version candidate-tag installs are available
pre-hosted under 0111 steps 1–2, but a pinned candidate tag is not the boring
default install P0-1 describes. This is open question 5, and it is an author
decision, not a work item.

**Work.** Complete the in-flight nine-package promotion under 0041's own
gates; close the two artifact gaps; then rebuild at least one full workout
arm in a clean external repository from published artifacts only, and give the
matrix harness an install-from-published-channel mode so future runs exercise
the public path.

**Exit.** (1) At least one full workout arm (Campfire or Streak Lab) rebuilt
in a clean external repository using only published artifacts — including its
acceptance's test-helper needs; the admin-client proof rides Dispatch or a
separate fixture — acceptance green. (2) The
matrix harness gains a published-channel mode. (3) No checkout-relative
import remains in that arm's authored code. The genuinely new content here is
the workout-arm-level external rebuild and the harness mode; the fixture- and
starter-level clean-install proofs already exist in 0041/0111/0114 and are
credited, not duplicated.

#### CV-2. Qualify the real handler VM during bootstrap

**Evidence.** Bootstrap's smoke builds the binary, launches it with `DYLD_*`
scrubbed, and dyld-loads `hermesvm.framework` — but never executes JavaScript
or creates a VM; the handler VM is created only at first invocation
(`RuntimeGuard::create` → `ex_hermes_create_no_eval()`), which is where the
rerun's incident surfaced
(`issues/20260730-bootstrap-smoke-does-not-create-armed-handler-vm.md`).
VM creation is a behavioral/ABI coherence contract between the statically
compiled glue and the dynamically loaded framework that symbol resolution
does not test. A plausible root cause for the stale state — to be confirmed
during this item — is that bootstrap's `rsync -a` artifact copy preserves
source mtimes, defeating cargo's mtime-based `rerun-if-changed` so the stale
binary never relinks.

**Work.** Extend the LLP 0010 bootstrap contract: after the final framework
selection, bootstrap must create and destroy the same VM
`RuntimeGuard::create` uses (`ex_hermes_create_no_eval` — the restricted
no-eval constructor, which is the precise name for what the issue calls the
"armed" VM) and execute at least one trivial function through it, then bind
binary and framework digests into a single readiness receipt. The item also
owns the invalidation half the ticket lists: a framework refresh must
invalidate or relink the final binary before qualification runs, or the
qualification is theater. Failure gets a stable `SNAPBACK_*` diagnostic in
LLP 0010's registry. Prior art to reuse rather than reinvent: the link smoke
already sha256s the framework binary, headers, and cargo inputs into every
recovery record (captured, never compared), and
`packages/snapback-runtime-linux-x64/artifact-attestation.mjs` is a complete
binary+Hermes digest attestation with validate-against-actual-files checking;
`bench_runtime_create_us` already creates and destroys these VMs in-process.

**Exit.** A regression fixture that reproduces the rerun's
mismatched-framework state fails bootstrap with the new named code instead of
passing; the readiness receipt binds both digests; a post-receipt framework
swap is detected (by relink or by receipt invalidation) rather than served.

#### CV-3. A persisted readiness receipt across doctor, bootstrap, and harness

**Evidence, corrected from v0.1.** The three tools already share more than
the diary implied: one probe module (`scripts/runtime-link-smoke.mjs`), one
diagnostic registry (LLP 0010's `SNAPBACK_*` codes), and one
`snapback.runtime-recovery.v1` record. What differs is evidence *strategy*,
and what is missing is *persistence*: doctor builds a fresh disposable target
(proving the checkout can produce a good binary — structurally blind to a
stale served binary, and documented in LLP 0010 as deliberate); bootstrap
builds the kept target (proving the served binary only if cargo actually
relinks); the harness runs the probe only on its `cargo` rung — the
`prebuilt`, `configured`, and reused-server rungs are presence-check and
`/health`-identity only, and `scripts/verify-local-proof` disables the smoke
by default (`SNAPBACK_BOOTSTRAP_CHECK=0`). Nothing persists a receipt, and
nothing compares the digests that are already being captured.

**Work.** Build CV-2's receipt into the shared artifact all three tools trust
and re-verify: defined location and custody, digest-coherence comparison, and
— the hard part — invalidation semantics when the framework changes after
issuance. Extend coverage to the harness's `prebuilt`/`configured`/reused
rungs and to `verify-local-proof`'s default path. Extend the existing shared
vocabulary with the CV-2 codes rather than inventing a parallel one. Owners:
LLP 0010, plus LLP 0030 (server-process ownership) and LLP 0031 (server
binary identity on `/health`) for the harness surfaces.

**Exit.** Doctor detects the CV-2 fixture's incoherence read-only against the
*served* binary and names the recovery; every harness rung and
`verify-local-proof` refuse to run acceptance against a runtime whose receipt
is absent, stale, or incoherent, with the same code.

### Tranche B — P1: finish input and search type fidelity

#### CV-4. Structured collection validators (split: arguments, then storage)

**Evidence, narrowed from v0.1.** Convex's `v.array(v.object(...))` validates
and types Split Ledger's split vector at the mutation boundary. On current
main, `v.array` and `v.union` are constructed result-only and the schema
compiler's closed primitive map rejects them fail-closed at argument and
stored-field boundaries (`FUNCTION_INVALID_VALIDATOR` /
`SCHEMA_INVALID_VALIDATOR`), while the `v.json()` escape hatch is already
loud (`PROVIDER_INTROSPECTION_RESULT_TYPE_DEGRADED`). Notably, nested
`v.object` **arguments already work end-to-end** — typed descriptors and a
closed JSON Schema with `additionalProperties: false` — so the input gap is
specifically arrays and unions, not structured inputs generally. Neither
LLP 0004 (which constrains the vocabulary but designs only the scalar slice)
nor LLP 0108 (result-side only) specifies the extension: this is a genuine
spec hole needing a new owned Spec, with a dated-alignment amendment to
LLP 0004 — the same pattern 0108/0080/0081 used (this answers open
question 1).

**CV-4a — arguments (ship first).** Most plumbing exists on the result side
(vocabulary spellings, recursive Rust validation in `result_contract.rs`,
type/schema projection, JCS hashing, bounds). The genuinely new piece is a
runtime **ingress** validation seam: today args are typed by codegen and
plan-time expression typing, but no server-side per-invocation args-shape
validation exists even for scalars, and CV-4a's fail-closed exit requires
one. Exit: Split Ledger's split vector expressed as
`v.array(v.object(...))` without `v.json()`; generated client types match;
invalid nested payloads refuse server-side with a precise path-carrying
diagnostic.

**CV-4b — stored fields (separate, larger).** Storing arrays needs a
`FieldType` extension, a SQLite/Postgres representation decision under
LLP 0004's portability rules and LLP 0007, index/`arrayContains`/live-matcher
semantics, and LLP 0081 migration interaction. None of this is de-risked by
0108. Exit: Pantry's structured stored fields expressed natively with defined
index and sync behavior.

#### CV-5. Type the portable search query AST (schema export + carrier alignment)

**Evidence, corrected in v0.3 (Codex review finding 6, code-verified).** The
v0.2 "one-emitter wiring" framing was wrong. The `unknown` is honest
projection, not an emitter fallback: `defineSearchQuery` itself authors
`query: v.json()`, and the contract projection faithfully emits what was
declared. The Rust types derive `JsonSchema`, but `src/schema_export.rs`
exports no search schema, and the generated client's `SearchQueryAstV1`/
`SearchRequestV1` interfaces are hand-authored special cases rather than
derived from a shared artifact. So the exported, drift-gated schema CV-5
needs does not exist yet.

**Work.** Export one Rust-owned search request schema through the existing
schema-export lane; carry a schema reference or closed descriptor through the
operation contract and provider projection (replacing the authored
`v.json()`); align the hand-authored client declarations with the exported
artifact; and resolve LLP 0073 open question 12 (is the provider projection
a byte-for-byte carrier or a Contract-owned surface). Prove accepted and
rejected AST fixtures agree across Rust deserialization, the exported
schema, introspection, and generated client types. This should be sequenced
as the first conformance fixture for CV-4a's argument-contract carrier — or
explicitly justify a separate path.

**Exit.** One exported, drift-gated search request schema; introspection,
operation contract, and generated client types all derive from or verify
against it; accepted/rejected AST fixtures agree across all carriers; no
`unknown` remains at the search argument boundary.

#### CV-6. Make precise mutation results the paved default

**Evidence, corrected from v0.1.** The repair-explaining diagnostic is not
future work — it ships today: codegen emits
`SNAPBACK_HANDLER_RESULT_CONTRACT_DEGRADED` with a remediation that
interpolates the actual table name. It ships at `severity: 'info'`, which is
exactly why two real apps (Cursor's `updateNote`, Pantry's `addRecipe`)
shipped degraded contracts anyway. LLP 0108 specifies the degraded-unknown
contract and the diagnostic but no strictness mechanism.

**Work.** This is a severity/policy item, not a mechanism item: raise the
diagnostic's visibility, resolve open question 3 (loud degradation vs.
refusal behind a per-app strictness toggle — an LLP 0108 amendment either
way), put the exact form first in the guide, and fix the two offenders. One
boundary to respect: a *fully* field-level paste-ready suggested contract
would require inspecting handler behavior, which 0108's
no-inference-from-source invariants forbid — the suggestion stays at the
template level already shipped, and that is enough.

**Exit.** A newly authored mutation without a result contract produces a
diagnostic that is hard to ignore (severity per OQ3's resolution); the two
known offenders carry exact contracts in the next rerun.

### Tranche C — P1: generalize composition without losing evidence

#### CV-7. Helper reuse: revive 0108's bounded static bundling

**Evidence.** LLP 0108 v1 deliberately narrowed inline handlers to statically
self-contained expressions ("no imported or sibling helper … no transitive
source graph"), which reproduces the diary's duplication (Streak Lab's
calendar helper, Campfire's indexed-read helpers) by design. But the design
for the fix already exists *inside 0108*: the superseded "Bounded static
bundling" section specifies literal-relative-ESM-only resolution from the
canonical app root, bounds (64 files / depth 16 / 512 KiB source / 256 KiB
bundle), per-edge byte digests, a closed pure-initializer grammar, capability
rescan of final bundled bytes, and a warm-pool benchmark gate. It was demoted
to research because the review loop timed out at NOT READY, not because the
design was rejected.

**Work.** Revive and close those sections as the 0108 follow-on rather than
designing from scratch. Two consequences the follow-on must own explicitly:
the v1 content hash carries no dependency graph, so helper imports force a
v2 hash format; and shared helpers effectively require the group-bundle model
(one bundle per original static graph), which reopens the warm-pool-key
question and the DK-4 benchmark gate. The 2026-07-28 adversarial-closure
rules (alias/destructuring/computed-access refusals) must be re-proved across
module boundaries. The non-negotiable invariants are unchanged: closed
content-addressed graph, no `Function.prototype.toString()` capture, no
runtime inference, no ambient checkout access.

**Exit.** Streak Lab's calendar helper written once and used by both its
query and mutation, with the module graph still closed and content-addressed,
and the 0108 refusal properties preserved under its adversarial fixtures
extended to cross-module cases.

#### CV-8. Relational shapes: promote what exists, decide aggregates

**Evidence, corrected from v0.1.** Two findings change this item. First, the
LLP 0113 qualification/publication path **terminates at experimental
maturity by design**: maturity is a static code-owned constant, publication
CAS never touches it, and 0113 states "promotion to stable requires a later
ratified design and evidence." v0.1's "drive through 0113 to stable" named
machinery that does not exist. Second, the aggregate shapes that dominate
both cited apps are **Non-goals of both relational documents**:
`bounded-children.v1` admits exactly one parent table and one bounded child
page per invocation (no second child collection, no aggregates, no grouping),
and LLP 0080's callable plans are two-source unique-join only with
aggregation excluded. Relay's `boardView` (one parent + three child
fan-outs + in-handler assembly) and `boardSummary` (per-column counts), and
Split's four-table ledger derivation, remain imperative even after full
promotion. `write-with-activity.v1` does fit Relay's card-patch+audit shape —
but Relay's `moveCard` computes its sequence counter via a range collect the
point-operation-only plan refuses (a live instance of 0110's own open
question 4), the first publication admits `existing-owner.v1` authority only
(anonymous arms refuse with `SNAPBACK_ACTIVITY_AUTHORITY_UNPROVENANCED`), and
adoption requires owner fields, scope-incarnation stamps with reviewed
backfill, and the ten provenance fields.

**Work.** Three separable pieces. (1) Finish what exists: complete LLP 0110's
review to Accepted with its same-landing amendments, close its publication
gates, and execute the 0113 path — yielding honest *experimental* maturity
with acknowledgment-gated runtime support. (2) Author the stable-promotion
design 0113 requires (a ratified code-and-document maturity change with its
own evidence bar) — this document does not exist and must be written before
"stable" can be claimed by anything. (3) The load-bearing half: decide the
aggregate question in LLP 0080's frame — specify a third bounded aggregate
profile covering the Relay/Split shapes (multi-child fan-out with
snapshot-consistent assembly, bounded grouped counts, bounded multi-table
derivation), or endorse the imperative handler pattern as the paved answer
with its evidence story. Do not widen the stable surface by inference.

**Exit.** Relay Board and Split Ledger rebuilt on promoted profiles where the
profiles fit (with the auth/provenance adoption cost stated, or the arms
given real owner scope), on the third profile or the endorsed imperative
pattern where they do not; no experimental capability claimed; the
sequence-counter and aggregate limitations either lifted by design or
documented as refusals.

#### CV-9. Transactional one-off scheduling

**Evidence, corrected from v0.1.** The design for this primitive is not
missing — it is **LLP 0070 (durable background work, Draft)**, which v0.1
and the diary both failed to cite. 0070 specifies `ctx.jobs.enqueue` with
"validation and insertion occur in the same database transaction as the
mutation's ordinary writes; if that transaction rolls back, no job exists" —
verbatim the rollback exit criterion — plus `availableAt` delays
(`runAfter`-equivalent), attempt policy, idempotency keys, and its own
receipt family (immutable job + append-only attempts). This answers open
question 2: one-off work gets 0070's receipt family, not the cron ledger,
whose identity model (`jobName`/nominal slot/schedule hash/definition
generation) structurally rejects runtime-created entries. 0028 and 0070
already cross-reference each other on exactly this boundary. 0070 is Draft
and unimplemented, and its claim boundary explicitly bars shipping this as a
cron sweep in the meantime.

**Work.** Implement the `runAfter` case as the first slice of LLP 0070's
`durable-work-single-process-sqlite-v1` profile (default queue,
`availableAt = now + delay`, transactional enqueue, host-plan action callee),
which simultaneously gives 0070 the executable evidence its Draft status
needs. Add the one thing 0070 lacks and 0028 has: a deterministic
forced-drive test seam — amend 0028's manual-tick/disable pattern into a
sibling injected-clock `jobs` drain so acceptance never sleeps. Name the
callee-class decision explicitly: whether Dispatch's one-off action→mutation
shape fits 0070 v1's generated-host-plan-action admission or needs the later
broader-action capability.

**Exit.** The Dispatch arm's one-off path uses the new primitive; a
rolled-back mutation provably schedules nothing (0070's own first acceptance
bullet); an injected-clock forced drain claims due one-off jobs with receipts
in the job/attempt ledger, giving one-off work a deterministic seam
equivalent to — not literally identical to — the cron run ledger's.

### Tranche D — P1: mature portable search

#### CV-10. Fix numeric normalization at the search source/recheck boundary

**Evidence, reclassified from v0.1.** The audit traced the mechanism, and it
is not a digest-canonicalization defect: both sides compute RFC 8785
canonical digests that **agree** (integral `5` and `5.0` both spell `"5"`).
What fails is a representation-sensitive full struct equality
(`source != authoritative`, `src/search/sqlite.rs:1731`) between the
in-memory insert-path document (which keeps serde_json integer `Number(5)`
because `normalize_json_value` validates without normalizing) and the
SQLite-reloaded authoritative row (`Number(5.0)`). The
`SNAPBACK_SEARCH_INDEX_CORRUPT` message — "failed its authoritative digest
recheck" — is wrong about its own trigger. The comparison is also an
implementation strengthening beyond 0073's specified version+partition+
predicate recheck. A nasty asymmetry: patch-maintained rows reload through
SQLite on both sides and pass, so a "corrupt" row silently heals on its first
patch — only insert/seed-maintained rows reproduce.

**Work.** A code fix, not a spec amendment: compare canonical bytes/digests
at the release recheck, and/or normalize integral Reals to their SQLite
round-trip form in `normalize_json_value` at write time (the latter also
fixes the latent storage-layer asymmetry for any other subsystem comparing
in-memory vs. reloaded documents). Correct the diagnostic message. Ride along
a one-sentence LLP 0073 pin ("stored/filter scalar bytes at the
source-content and recheck boundary use RFC 8785 number spelling") to close
the residual spec silence.

**Exit.** A regression fixture with Real-typed integral search fields on the
**insert/seed** path (the only reproducing path) passes; the Pantry arm's
original schema no longer produces corruption; no legitimate accepted value
is refused.

#### CV-11. A live/re-execution story for search

**Evidence.** LLP 0073 excludes live search four separate ways (the generated
function is `Query` not `LiveQuery`; subscriptions refuse with
`SNAPBACK_FUNCTION_NOT_LIVE`; Non-goals; implementation-state nonclaims) and
contains no reactive design — this is a genuine design hole, not deferred
implementation. 0073 does pin the gate: a live path must earn independent
capability ids or the exact v1 target corpus before advertisement, and the
`SNAPBACK_FUNCTION_NOT_LIVE` refusal is a pinned contract until then.

**Work.** Design reactive search in LLP 0073's frame, composing with the live
query and query-group surfaces (LLP 0112/0114) rather than inventing a
parallel channel. Until it ships, the non-live declaration stays exactly as
is — no simulated reactivity, no capability drift.

**Exit.** Either a shipped live-search path under its own capability id with
the same rank/highlight/cursor contract and an eviction/invalidation evidence
story, or a dated LLP 0073 decision recording why non-live remains the claim.

#### CV-12. Filters and targets (split: design vs. execution)

**CV-12a — range filters (new design).** 0073 excludes ranges with no gate
and no design; only null tests are queued. Adding them is real spec work
inside 0073's constraints: a new operator vocabulary means a new parser
profile and semantic index version (0073's version-binding rule), an
anchor/work-ceiling story (complement scans are deliberately inexpressible),
and cursor query-core hash changes. Exit: Pantry's numeric filter expressed
portably with the version-binding consequences handled.

**CV-12b — target expansion (execution of an existing roadmap).** 0073
already contains the staged adapter sequence: hosted SQLite may claim v1
after its own runtime/authorization evidence; PostgreSQL is an explicit GAP
until the store seam lands (**blocked on Draft LLP 0046** — a dependency
v0.1 failed to name); accelerators only as separate capabilities with
proved-superset translation; offline reserved. Exit: each new target lands
with its own acceptance evidence; claims continue to match exactly what
acceptance proves.

### Tranche E — P2: guide and review polish

#### CV-13. Make inline handlers primary in "Your first backend"

The intent-specific pages are current, but the getting-started page still
front-loads legacy `handlers.mjs`
(`issues/20260730-guide-gap-first-backend-front-loads-legacy-handlers.md`).
Rewrite the first-backend path around the inline form per LLP 0061's
conventions. **Exit:** guide checks green; the legacy form documented as the
compatibility lane it is.

#### CV-14. Semantic review of dense manifests

Manifest-only custody fixed source-control volume, but a reviewer facing an
85 KiB `artifacts.json` diff needs a concise semantic change summary
(operations added/removed, contracts changed, capabilities moved) over the raw
JSON (Diary 0039 P2-14). Confirm the custody owner (LLP 0062 family) when this
starts. **Exit:** a diff of the matrix's review manifests renders a summary a
reviewer can act on without reading raw JSON.

#### CV-15. Resolve `unpinned` harness wording

The harness labeled an explicitly configured exact binary `unpinned` even
though commit evidence was exact (Diary 0039 P2-15). Rename or split the label
so exact-but-explicitly-configured provenance is not misread as weak.
**Exit:** the label distinguishes the cases; harness docs updated.

## Sequencing

1. **Tranche A first, and alone.** External install and runtime readiness gate
   the credibility of everything else; the diary ranks them P0 and they are
   also prerequisites for running future matrix arms against published
   artifacts. CV-2 → CV-3 are ordered (the receipt exists before the tools
   converge on it), and CV-2 carries the invalidation half so that ordering is
   sound. CV-1's candidate-tag publication and artifact-gap decisions can
   proceed now; its default-channel exit waits on open question 5.
2. **Tranches B and C in parallel after A.** They touch different owners.
   CV-4a ships before CV-4b. Within C, CV-8's piece 1 continues immediately —
   LLP 0110 is already in Review — while piece 2 (the stable-promotion
   design) and piece 3 (the aggregate decision) are authorable now; CV-9
   rides LLP 0070's first implementation slice.
3. **Tranche D after CV-5.** CV-10 is a small code fix and may land any time;
   CV-11/CV-12a build on the typed AST; CV-12b executes 0073's roadmap as its
   gates (LLP 0046 for PostgreSQL) clear.
4. **Tranche E is continuous.** CV-13 and CV-15 are small and may land
   immediately; CV-14 rides the next custody change.
5. **Rerun checkpoint.** After Tranches A–C land, rerun the seven-app matrix
   by the Diary 0032–0039 method (same contracts, both backends, aggregate
   serial verification) and write the successor diary — with one measurement
   correction: the existing method drives the provider's headless client, so
   it cannot observe the LLP 0112/0114 React/query-group gains at all. At
   least one arm (Campfire is natural) must consume the 0114 React surface
   and a 0112 registered group, or the plan's watch trigger on the reactive
   boundary is unmeasurable. Tranche D/E completion is not gated on the
   rerun, but the rerun is the plan's measurement, not an optional extra.

## Exit criterion for the plan

The plan is done when a full matrix rerun shows:

- the four "slight Convex edge" arms (Streak Lab, Campfire, Split Ledger,
  Pantry Search) each become a near tie or a Snapback win on the diary's own
  scoring frame, with the specific mechanism named (CV-4/6/7 for authoring,
  CV-8 for aggregates, CV-9 for Dispatch's one-off path, CV-11/12 for search);
- Cursor Garden's decisive win and every evidence property in §Governing
  constraints are preserved;
- the rerun's Snapback arms build from the published channel (CV-1), and no
  first-hour runtime incident class from Diary 0039 recurs (CV-2/3); and
- the successor diary's recommendation paragraph no longer needs the clause
  "still exposes framework/runtime edges."

An honest 50/50 with intact differentiators satisfies this Plan; the
larger strategic frame (hosted profiles, commercial surface, Expo
distribution) remains LLP 0074's and is not re-scored here.

## Watch items (no action now)

- **Reactive-by-default queries.** Convex's deepest structural advantage is
  that ordinary queries are reactive without a separate live classification.
  Snapback's explicit live boundary is a deliberate evidence choice
  (LLP 0074), and the newest surfaces reinforce it (a route with one ordinary
  `Query` child loses register-group generation entirely, per LLP 0112).
  LLP 0112/0114 close the *subscription-glue and typed-consumption* half of
  the Campfire-style DX loss — and register-mode boot consistency is arguably
  better than Convex's default — but they deliberately leave the
  classification itself and server-side authoring explicitness untouched
  (those belong to CV-4/6/7 and CV-11). Revisit only if the rerun — measured
  through the React surface per §Sequencing item 5 — still scores the
  boundary itself as a loss after CV-11 and the query-group surface ship.
- **Graph generation speed and consumer-facing projections.** The 7× generated
  graph is fine while generation is fast and consumers never read internals;
  watch for either assumption failing.
- **Convex anonymous local mode maturing out of beta** — the port-coordination
  friction noted in the rerun is the one operational edge Convex still shows
  locally; if it disappears, Tranche A's bar rises.

## Open questions

1. **CV-4 spec placement — ANSWERED (v0.2).** New numbered Spec plus a
   dated-alignment amendment to LLP 0004, per the 0108/0080/0081 precedent
   and 0004's own split-into-Spec status note.
2. **CV-9 receipt semantics — ANSWERED (v0.2).** LLP 0070's receipt family
   (immutable job + append-only attempts), not the cron run ledger, whose
   identity model rejects runtime-created entries.
3. **CV-6 strictness.** Should omitted result contracts remain a degradation
   (raised from today's `severity: 'info'`), or become a refusal behind a
   per-app strictness toggle? Owner's call, landed as an LLP 0108 amendment.
4. **Rerun scope.** Should the post-A–C rerun reuse the seven contracts
   unchanged for comparability, or add an eighth contract targeting the new
   surfaces (structured inputs + one-off scheduling) at the cost of
   diary-to-diary comparability? (Either way, §Sequencing item 5's
   React-surface measurement requirement stands.)
5. **npm default-channel gating (new in v0.2).** LLP 0111 serializes `latest`
   promotion of the nine-package closure behind the full hosted Fly
   qualification journey; LLP 0074 makes npm publication a parallel gate.
   These cannot both govern CV-1. (The eight-package `0.1.0` closure reached
   `latest` on 2026-07-26, the day before 0111's gate was written, so the
   conflict is live for the nine-package promotion and every closure after
   it.) Decide: amend 0111 to decouple the local closure's default channel
   from hosted qualification, or scope CV-1's exit to exact-version
   candidate-tag installs until the hosted journey lands.
