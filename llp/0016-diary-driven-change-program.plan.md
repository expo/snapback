# LLP 0016: Diary-driven change program

**Type:** Plan
**Status:** Draft
**Systems:** Developer experience, Client integration, API, Runtime, Sync, Realtime, Security, Auth, Contract/Exact, Testing, Demo apps
**Author:** Charlie Cheever / Codex
**Date:** 2026-06-26
**Revised:** 2026-07-14 (corpus reconciliation: schema-source and Exact manifest ownership are decided, WebSocket push and the local authorized-sync/items-6/8 proof are implemented, and the remaining artifact-mapping and demo-product breadth are separated from obsolete blockers). 2026-07-14 (ENG-24606 reconciliation: the card-game rung now proves real session-isolated finite and live hidden-hand delivery, logout blanking, and cold-process retained display only through an unexpired signed authorization lease; full permission-changing ACL/protected-room and game-product breadth remain outside this demo). 2026-07-13 (ENG-24605 adds `demos/card-game` as a finite authenticated-query and authority-store proof only; the full authorization-aware partial-sync rung remains gated on items 6/8 and is not claimed). 2026-07-03 (demo ladder: collaborative graffiti/whiteboard rung added between kanban and card game with its capability-mapping row — shipped as `demos/graffiti/` (ENG-22219, Diary 0006); reconciled with LLP 0010/0015 per R6. Earlier: 2026-07-01 (LLP 0032 R3/R6: demo-ladder drift note reconciled, diary-erratum policy and reconcile cadence adopted); 2026-06-27: Change Program slimmed to an index over LLP 0020/0021 after the 0020 review flagged duplicate phase trackers; Phase 4 status updated after the LLP 0020 WebSocket push slice; see `llp/reviews/0020-core-authoring-surface.claude.md`)
**Related:** LLP 0000, LLP 0003, LLP 0004, LLP 0005, LLP 0006, LLP 0008, LLP 0009, LLP 0010, LLP 0011, LLP 0012, LLP 0013, LLP 0015, LLP 0020, LLP 0021, LLP 0024, LLP 0053, LLP 0059, Diary 0001, Diary 0006, Diary 0013, Exact 0263, Exact 0265

## Summary

The first Snapback todo diary proves that the product direction is working in
the places that matter most for agent-authored apps: structured diagnostics,
honest capability reports, deterministic reset/seed, generated artifacts, a
current-value-plus-subscription seam, and cross-surface validation. It also
originally showed that the paved road was mostly scaffolding: real JavaScript
`ctx.db` handlers, typed artifacts, a Contract/Exact adapter, and push realtime
were missing. Those gaps now have implementation footholds recorded in the
phase table. Full artifact mapping, resource-limit hardening, broader matcher
shapes, React/Expo adoption, and Exact-side Contract ergonomics remain program
work rather than reasons to repeat the diary's point-in-time diagnosis.

This Plan turns the diary into a change program. It does not replace the
subsystem LLPs. Instead, it records the order of work implied by the diary,
which pieces belong in Snapback core versus adapters versus Exact/Contract, and
what the next demos should be allowed to claim.

The headline change is simple:

> Preserve the agent-first facts that already worked, then productize the
> authoring and adapter surfaces before broadening the demo suite.

## Scope

This Plan owns:

- the priorities implied by `diaries/0001-todo-demo.diary.md`;
- the split between Snapback core, Snapback adapters, and Exact/Contract work;
- the acceptance gates before later demos claim success;
- the difference between v0 scaffolding that is acceptable temporarily and
  product surfaces that should become stable;
- the sequencing of the work above, including its cross-cutting security and
  authorization dependencies.

It does not own:

- the detailed application API semantics from LLP 0004;
- the detailed local-first sync and realtime semantics from LLP 0008;
- the handler execution security envelope from LLP 0009;
- the authorization and permission model from LLP 0011;
- the headless artifact schema from LLP 0012;
- the demo corpus structure and ordering from LLP 0015;
- the Contract language, compiler, runtime, or Design Mode semantics owned by
  the Exact repository.

When this Plan conflicts with a subsystem spec, the subsystem spec owns the
mechanics. This Plan owns the sequencing and product interpretation of diary
evidence.

## Sequencing and dependencies

The phases below are ordered by product risk, not by implementation
exclusivity. They are not a strict chain; several can advance in parallel when
the owners are different. The sequencing claim is about evidence: later demos
should not be used as proof of Snapback's broader ergonomics until the earlier
gaps they depend on are closed or honestly reported.

The real dependencies are:

- **Phase 1 (typed artifacts) remains the long pole for broader adoption, but
  its former decision blockers are closed.** LLP 0037 ratifies Rust serde types
  plus generated committed JSON Schemas as the source of truth for
  Snapback-owned artifacts. Exact 0263 §4.2 defines and owns
  `ContractDataManifest`; LLP 0021 owns Snapback's validated projection onto
  that shape. The remaining work is to freeze/extend the mapping and consumer
  evidence, not to choose either schema authority.
- **Phase 2 (`ctx.db` handlers) is independent of Phase 1** and gated instead by
  LLP 0009's execution envelope. Phases 1 and 2 together unblock Todo v1.
- **Phase 4 (realtime) is independent of Phases 1–3** but gates the kanban and
  messaging slices, and its dependency matcher must be authorization-aware from
  the start (see Cross-cutting constraints).
- **Authorized sync is a composed cross-cutting workstream.** LLP 0053 and auth
  landing items 5–8 now implement the local target's protected-query,
  invalidation, two-axis store, and signed-lease path. The card-game rung
  consumes that path; broader permission-language and game-product scope remain
  separate work.

Phase numbers below are program-local; the **Authoritative detail** column names
the Plan that owns each phase's required changes and acceptance gates (the
numbers there do not match these). When this index and a detail Plan disagree,
the detail Plan governs.

| Phase | Depends on | Primary owner | Authoritative detail | Status |
| --- | --- | --- | --- | --- |
| 0 — Freeze v0 contracts | — | Snapback core | LLP 0020 Phase 0 | Behaviors exist in the v0 server; not yet frozen as contracts |
| 1 — Typed generated artifacts | LLP 0037 Rust-first decision; Exact 0263 shape; LLP 0021 projection | Snapback core | LLP 0020 Phase 1 (Snapback artifacts) + LLP 0021 Phase 1 (`ContractDataManifest`) | Foothold: todo demos emit typed Snapback artifacts plus a validated generated Contract projection; full mapping remains open |
| 2 — `ctx.db` handlers | LLP 0009 envelope | Snapback core | LLP 0020 Phase 2 | Foothold: todo handlers run through embedded Ibex `ctx.db`; resource-limit hardening remains |
| 2′ — Read-set capture | Phase 2 | Snapback core | LLP 0020 Phase 3 | Foothold: handler-captured reads validate stale mutations; read-your-writes overlay remains |
| 3 — Contract adapter | Phase 1 | Snapback adapters | LLP 0021 Phases 0, 2, 3, 4 | Foothold: todo demos import `packages/snapback-contract/`; todo/admin surfaces consume generated Contract bindings; admin consumes shared system-surface bridge machinery; Exact conformance and admin client/view-model consolidation remain |
| 4 — App-grade realtime | Auth-aware matcher (LLP 0011/0053); LLP 0008 | Snapback core | LLP 0020 Phase 4 | Foothold: equality matcher plus WebSocket `live_replace`; protected local auth invalidation ships, while range/non-equality matcher breadth remains |
| 5 — Contract data ergonomics | Phase 1 | Exact/Contract | LLP 0021 Phase 5 | Not started |
| 6 — React/Expo pressure test | Phase 1 | Snapback adapters | This Plan (Change Program; no detail Plan yet) | Not started |
| X — Authorized sync | LLP 0011 model; LLP 0053 protocol; auth items 5–8 | Snapback core + auth program | LLP 0011 + LLP 0053 + LLP 0059 | Implemented for the local card-game proof: principal-isolated finite/live reads, logout barrier, invalidation, two-axis storage, and signed-lease retained display |

## Evidence

The todo diary is a point-in-time build record, not a production benchmark. It
is strong evidence for developer experience, integration shape, and v0
correctness because it records a concrete app built against the actual local
server and a real Contract surface.

The positive findings:

- Snapback diagnostics were stable enough for tests to assert codes instead of
  prose.
- `/inspect` advertised capability gaps directly, including missing Ibex
  `ctx.db` host calls and non-v0 targets.
- `subscribe_live` returned the authoritative initial result with the
  subscription id, avoiding the manual-prime race documented in Valet.
- `/admin/seed` bypassed handlers and made reset/seed/assert deterministic.
- One source-authored backend generated both Snapback server manifests and a
  Contract data manifest with a shared `inputsHash`.
- Contract could compile, mount headlessly, and expose a structured host tree
  that tests could inspect without a browser.
- Contract's `query` / `mutation` bindings, `async` slots, and `mutates`
  declarations enforced useful invariants.
- A Contract action mutated the same live Snapback server that the headless
  client queried.

The negative findings:

- The documented JavaScript `ctx.db` handler path is not wired. The demo used
  declarative `HostPlan`s instead.
- The manifest wire shape is too hard to author safely without generated
  TypeScript types.
- Live query updates are correct but coarse: every mutation reruns every
  subscription.
- Realtime delivery is deterministic but not app-grade: clients drain an
  outbox by polling.
- Read-set conflict checking depends on the caller supplying a read set rather
  than the runtime capturing handler reads.
- The Contract bridge lives in `demos/_kit/` because no
  `@expo/snapback/contract`-style adapter exists.
- The Contract surface works under `bun` because it imports Exact TypeScript
  source through a local checkout; this is a toolchain capability, not a clean
  package boundary.
- Headless Contract mounting emits native-host log noise that pollutes agent
  logs.

The matching Exact-side record in Exact 0263 and Exact 0265 says the same thing
from the Contract side: the source model, verification blocks, and async data
shape are promising, but typed rows, component-local queries, provider
diagnostics, query transforms, mutation-action ergonomics, and packaging are
still too implicit.

## Pain-to-change Map

The diary findings should become product work in the following concrete places:

| Pain observed | Change required | Primary owner | Proof |
| --- | --- | --- | --- |
| Manifest shapes were derived from Rust source by hand. | Generate typed, versioned artifact packages from one schema source of truth. | Snapback core | A consuming app passes `tsc` without source aliases and a drift test fails when Rust/TS artifact schemas diverge. |
| Public docs describe `ctx.db`, but the demo used `HostPlan`. | Wire Ibex host calls and handler-time read capture. | Snapback core | Todo CRUD handlers use JavaScript `ctx.db`; stale reads are rejected without caller-supplied read sets. |
| Contract bridge code lived in `demos/_kit/`. | Ship a first-class Contract adapter. | Snapback adapter layer | Phase 2/4 foothold: both todo Contract surfaces import `packages/snapback-contract/`, todo/admin no longer carry per-binding hand-written sidecars, and admin boundary/link lifecycle lives in the package; finish requires Exact provider conformance and a product decision for the remaining admin client/view-model layer. |
| Contract surface depended on local Exact source and `bun`. | Make Exact resolution capability-based and package-backed where possible. | Shared Snapback/Exact boundary | Missing or stale Exact capability reports a structured diagnostic; ordinary Snapback core tests do not require Exact. |
| Live updates reran every subscription and drained by polling. | Add dependency matching plus a push transport while preserving deterministic test drains. | Snapback core | Kanban or messaging runs two clients without product-code polling, and unrelated mutations do not refresh provably disjoint subscriptions. |
| Contract row data remained too implicit. | Make generated row shapes visible to Contract analysis and diagnostics. | Exact/Contract | A wrong generated row field fails in Contract diagnostics before browser smoke tests. |

This map is intentionally redundant with the phase list. The phase list says
what to do next; this table says what specific diary pain should disappear when
the work is complete. The diary did not exercise multi-user authorization or
real handler execution (it built single-user todo on declarative `HostPlan`s),
so two load-bearing dependencies are absent from this table and captured under
Cross-cutting constraints instead.

## Cross-cutting constraints

Two constraints and one missing spec cut across the phases below. They are not
separate phases; they bound how several phases must be built.

### Handler execution lives inside the LLP 0009 envelope

Phase 2 wires real JavaScript handler execution through Ibex. That path is
governed by LLP 0009, not only by LLP 0003's buffered-write boundary: an
implementation that runs handlers without 0009's controls — a fresh-or-reset
context per invocation, `ctx.db` as the only storage path with no ambient
SQLite/filesystem/network/environment/secret access, no storage lock held across
async work or microtask drains, and resource limits enforced or honestly
reported as unenforced — ships unvetted code execution. These are non-negotiable;
the detailed requirements and gates live in LLP 0020 Phase 2, and this umbrella
only flags them as a constraint that bounds the phase.

### Live-query matching must be authorization-aware

LLP 0008's dependency summary already includes "auth predicates that affected
visibility," and LLP 0011 requires that rows not visible to a client must not
enter the initial snapshot, realtime delta, or retained local store. So the
Phase 4 matcher cannot be designed as a pure data-dependency matcher with auth
bolted on afterward: a matcher that re-notifies on a row a subscriber cannot
see leaks the row's existence. Phase 4 must compose dependency matching with
per-subscriber auth filtering and LLP 0053's exact witnessed obligations,
dispositions, quarantine/delete fences, authenticated ACK, and fresh-snapshot
release. A generic `resync_required` or coarse epoch is not proof of delivery
and cannot release protected bytes. Ephemeral presence/cursor/typing state is not durable
live-query realtime; it is owned by LLP 0013 and must not be absorbed into the
Phase 4 durable path.

### Authorized sync and the card-game proof boundary

The card-game slice depends on authorized partial sync — different authorized
views of one underlying state. LLP 0011 owns the product model and LLP 0053 owns
the invalidation and offline-authorization fences. The original ENG-24605
foothold proved only one finite authenticated `myHand` query plus the two-axis
store. ENG-24606 now advances that same demo through a real sessions deployment:
two principals receive disjoint finite and live hands, a mutation reaches only
the owning live boundary, logout blanks the retiring authority before return,
and a new cold process renders retained rows only before the exact signed-lease
deadline.

That is a concrete local-target authorized-sync proof, not a complete game or a
universal permission language. The card-game rung is no longer blocked on auth
items 6/8. Permission-changing ACL fan-out and protected-room acceptance remain
separately owned protocol evidence rather than claims of this demo; custom-key
room authorization, a browser UI, and hosted auth remain outside the rung.

### `ContractDataManifest` ownership and projection are settled

Exact 0263 §4.2 defines and owns the Contract-facing shape and its
`manifestVersion`. LLP 0037 governs only Snapback-owned artifacts and chooses
Rust serde types plus generated committed schemas for them. LLP 0021 owns the
validated mapping from those native manifests onto Exact's shape. Snapback's
native `artifactKind`/`schemaVersion` discipline is not imposed on the
Exact-owned manifest. Freezing the complete mapping and extending consumer
coverage remain implementation work, not an unresolved schema-ownership
decision.

## Principles

### Keep the agent-first wins

The diary's strongest result is not that todo works. It is that an agent can
test Snapback by reading structured facts: diagnostic codes, capability gaps,
schema/function manifests, runtime state, deterministic seed state, and
host-tree output. These are product surfaces. Do not trade them away for short
term demo smoothness.

### Packaging is product

If a demo imports source files by absolute path, maintains Vite aliases by hand,
derives Rust JSON shapes in JavaScript, or copies a bridge into each app, the
platform has not shipped the integration. Those files may be acceptable as
prototypes, but the work is not done until the behavior exists in typed,
versioned packages with honest typecheck.

### The authoring path must match the docs

`HostPlan` is a useful v0 escape hatch and a good deterministic test fixture.
It should not become the public mental model by accident. The public Snapback
authoring model is JavaScript functions using `ctx.db` plus generated client
bindings. The next implementation slice should close that gap before adding
more app shapes.

### Missing capabilities are allowed; hidden fallbacks are not

The first todo demo can be online-only, non-Postgres, non-Cloudflare, and
coarse-realtime as long as it reports those facts. A demo must not call itself
local-first parity if handlers do not run locally, must not call itself
fine-grained realtime if it reruns all subscriptions, and must not present a
Contract surface as complete if it depends on demo-local bridge code.

### Demos should exercise product code

The demo suite is valuable only if each demo reduces the amount of copied glue.
Every time a second demo needs the same bridge, resolver, descriptor, seed,
outbox, Vite alias, or provider code, that code should move toward an adapter
or package.

### Security and authorization are capability honesty, not later phases

The diary's spine is that Snapback tells the truth about what it can do. That
truth includes its security and authorization envelope. A handler path is not
done if it executes code outside LLP 0009's isolation and resource limits, and
a sync path is not done if it can leak rows across LLP 0011's authorization
boundary. These are not Phase-N+1 concerns to bolt on after the ergonomics
land; they are part of the same capability-honesty claim, and the acceptance
gates below treat them as such.

## Change Program

The required changes and acceptance gates for each phase are owned by the detail
Plans named in the *Authoritative detail* column of the table above; this
umbrella no longer restates them, so the two cannot drift. **Phase numbers are
program-local and do not match the detail Plans'.** This program's Phase 3
(Contract adapter) maps to LLP 0021 Phases 0/2/3/4, and the read-set capture this
program folds into Phase 2 is LLP 0020's own Phase 3 — so use the mapping column,
not the number, to find a phase's contract. When a detail Plan and this index
disagree, the detail Plan governs.

The one phase with no detail Plan yet is React/Expo; its contract stays here
until it is split into its own Plan.

### Phase 6: React/Expo as a pressure test, not a fork

*Depends on: Phase 1 (the same generated artifacts Contract consumes). No detail
Plan yet — split one out when this phase starts.*

React/Expo should consume the same generated artifacts as Contract/Exact. It
should not become a private backend path.

Required changes:

- expose idiomatic React hooks over generated function references and runtime
  state;
- share the same typed manifests, capability reports, diagnostics, and version
  handshake;
- keep direct client table writes out of the default React API;
- report Online versus Parity capability honestly.

Acceptance gate:

- one generated todo backend is consumed by Contract/Exact and React or
  headless surfaces without hidden backend semantics;
- a mutation from one surface updates a live query in another;
- both surfaces expose the same capability gap or diagnostic for at least one
  deliberate failure.

## Ownership

### Snapback core owns

- schema and function manifest semantics;
- generated function references and typed artifact schemas;
- server-side schema/function loading and diagnostics;
- `ctx.db` handler execution through Ibex, inside the LLP 0009 envelope;
- read-set capture and mutation isolation;
- live-query dependency matching;
- enforcement of LLP 0011 data-visibility rules in queries and subscriptions
  (the rule language and mechanics are owned by LLP 0011);
- realtime transport contracts;
- reset, seed, inspect, and runtime state;
- capability truthfulness.

### Snapback adapters own

- the Contract/Exact adapter package;
- the React/Expo adapter package;
- browser/native/local-server entry points;
- adapter-level pending mutation state and optimistic online behavior;
- target-specific packaging recipes;
- surfacing Snapback diagnostics in framework-native shapes.

### Exact/Contract owns

- Contract syntax, IR, compiler, and runtime semantics;
- async slot semantics and coordinated reveal behavior;
- generated-row typing inside Contract analysis;
- component-local query scopes and query-cell props;
- pure helper metadata and data selector ergonomics;
- mutation-action grammar;
- structured host-tree and Agent API verification;
- quiet headless/native-host behavior in Contract mounting.

### Shared boundary owns

- the validated mapping and version handshake between Snapback's LLP 0012/0037
  artifacts and Exact's Exact-0263-owned `ContractDataManifest`; Exact owns the
  shape and `manifestVersion`, while Snapback owns its projection;
- provider diagnostic handoff;
- the application of LLP 0012's Online vs Parity capability classes to Contract
  data binding, and the version handshake between them;
- Exact resolver capability probing;
- cross-surface acceptance fixtures;
- package/version handshakes between generated Snapback artifacts and
  Exact/Contract data-binding capabilities.

## Demo Implications

The next demo should not simply add another app. It should retire a piece of
demo-local glue or prove one harder runtime capability.

The demo corpus and its order are owned by LLP 0015, with LLP 0010 as the
acceptance-ladder authority. LLP 0010's ladder is todo → messaging → kanban →
collaborative graffiti/whiteboard (shipped 2026-07-03 as `demos/graffiti/`,
ENG-22219) → card game → task tracker → party → asset slice. LLP 0015 briefly
omitted task tracker from its early demo ladder; reconciled in LLP 0015 on
2026-07-01 (LLP 0032 R3); the graffiti rung was reconciled across all three
documents on 2026-07-03. This Plan does not reorder that ladder. An earlier
draft of this section implied kanban before messaging and dropped the asset
slice; that conflicted with LLP 0015 and is corrected here. What this Plan adds
is the admission rule and the mapping from each demo to the capability that must
exist before it can claim success:

| LLP 0015 demo | Must retire / prove | Gating phase or capability |
| --- | --- | --- |
| todo (v1) | typed package; real `ctx.db` handlers; no demo-local wire shapes | Phases 1 + 2 |
| todo (Contract surface) | real Contract adapter; delete demo-local bridge | Phase 3 |
| messaging | push transport; reconnect; retained query state | Phase 4 |
| kanban | multi-row mutations; dependency-matched live queries; typed Contract rows | Phases 4 + 5 |
| collaborative graffiti/whiteboard (shipped — `demos/graffiti/`) | generated ephemeral API; client overlay; WebSocket publish path; fan-out and durable-lane separation measurement | LLP 0013 + LLP 0024 + Phase 4 |
| card game (local auth rung shipped; broader product slice gated) | real session-isolated finite/live hidden hands, logout blanking, and lease-bounded cold retention; ACL/protected-room breadth and UI remain | ENG-24605/ENG-24606 + auth items 5–8 for the shipped proof; LLP 0053 protected-room/ACL executable proof and product UI for the broader rung |
| task tracker | index-first query; cursor pagination over a larger local dataset | LLP 0007 query/index contract + a future pagination slice |
| party (Partiful-style) | multi-table Contract composition; component-local queries | Phase 5 |
| asset slice | upload metadata and processed-media state | assets capability — a current capability gap and a Non-Goal until a demo genuinely needs it |

The admission rule: a demo may claim success only when the capability in its
gating column actually exists, or when the demo honestly reports the gap (per
the capability-honesty principle). The card-game proof may claim only the
finite/live/lease behaviors its real-session acceptance runner executes; it may
not generalize those results to permission-changing ACLs, protected rooms,
hosted auth, or a complete game surface.

Each demo diary should record not only whether the app works, but a **glue
inventory**: the demo-local bridge, resolver, descriptor, seed, outbox,
Vite-alias, and provider files it still carries, with a count or line total.
The number should fall as phases land. If it rises, or a second demo re-copies
the same glue, that is evidence the relevant phase is not actually complete.

Two standing corpus rules (adopted 2026-07-01 via LLP 0032 R3/R6):

- **Diaries are immutable point-in-time records.** Corrections append a dated
  erratum footnote; the original text is never rewritten. (First applied to
  Diary 0006's dangling "LLP 0024" whiteboard-plan citation.)
- **Reconcile cadence.** Run the `llp-maintain`-style corpus audit before each
  demo lands and after each LLP 0032 phase completes, so status and
  cross-reference drift is caught at the boundaries where it accumulates. The
  2026-07-14 auth-program audit and this reconciliation are the cadence pass for
  the ENG-24606 card-game extension recorded in Diary 0013.

## Non-Goals

- Do not build Postgres, Cloudflare, external auth, assets, notifications, or
  cron merely to make the next demo feel broader.
- Do not present `HostPlan` authoring as the long-term public API.
- Do not claim local-first parity until local handler execution, offline
  queueing, deterministic replay, and rebase-on-reconnect exist — these four
  conditions are LLP 0012's definition of the Parity class; until they hold, a
  surface is Online, not Parity.
- Do not let Contract/Exact needs create private Snapback backend semantics.
  Promote a need into core only when it protects a shared invariant or is also
  required by another adapter or agent tool.
- Do not require every Snapback developer to have Exact installed for core
  server work.
- Do not ship `ctx.db` handler execution outside the LLP 0009 envelope to reach
  an ergonomic milestone faster.

## Risks

- **R1 — Artifact projection can drift across ownership boundaries.** LLP 0037
  settles Snapback's Rust-first source and Exact 0263 settles the Contract-facing
  shape, but the projection can still lag either side. *Mitigation:* LLP 0021's
  generated-schema drift gate, Exact project checks, shared freshness hash, and
  structured mismatch diagnostics gate each mapping change.
- **R2 — Phase 3 depends on another repository.** The Contract adapter and
  Exact resolution depend on Exact-side work (Exact 0263 / 0265), so Snapback
  cannot fully close Phase 3 alone. *Mitigation:* keep Exact resolution
  capability-based so a missing or stale checkout is a structured diagnostic,
  and keep Snapback core tests free of any Exact dependency (already a
  Non-Goal).
- **R3 — A narrow authorized-sync proof can be mistaken for a general
  permission system.** The local card-game rung now exercises protected finite
  and live reads plus lease-bounded retention, but it does not supply arbitrary
  RLS syntax, every matcher shape, custom-key room authorization, or hosted
  deployment. *Mitigation:* keep row X's implemented predicate explicit and
  retain separate gates for each broader claim.
- **R4 — Handler execution could ship outside the LLP 0009 envelope.** Wiring
  `ctx.db` for ergonomics without isolation and resource limits would ship
  unvetted code execution. *Mitigation:* 0009's envelope is folded into LLP 0020
  Phase 2's required changes and acceptance gate.
- **R5 — Over-claiming the capability class.** "Online vs Parity" is easy to
  assert and hard to earn. *Mitigation:* the classes are defined in LLP 0012;
  acceptance gates assert the class (Phase 3 reports Online until the four
  Parity conditions exist).
- **R6 — Demo-ladder drift.** This Plan, LLP 0015, and LLP 0010 can diverge on
  demo order or contents (they already did twice; the LLP 0015 task-tracker
  omission was reconciled 2026-07-01). *Mitigation:*
  LLP 0015 owns the corpus, LLP 0010 owns the acceptance ladder, and this Plan
  only maps demos to gating capabilities; reconcile all three whenever any of
  them changes.

## Open Questions

The former schema-source, `ContractDataManifest` ownership, first push-carrier,
and local authorized-sync/card-game sequencing questions are resolved by LLP
0037, Exact 0263 + LLP 0021, the shipped WebSocket carrier, and LLP 0053/items
5–8 respectively. They are not current blockers.

- How much of the remaining Snapback-to-Exact manifest mapping must be frozen
  before Phase 1 moves beyond its current foothold?
- The Online vs Parity capability classes are already defined in LLP 0012, so
  the open part is narrower than this Plan first implied: only the
  **Contract-data-binding version handshake** built on top of those classes
  remains to be specified.
- Which pieces of quiet headless Contract execution belong in Exact runtime
  code versus the Snapback Contract adapter?
- Should the first React adapter target Expo/React Native, React web, or a
  framework-neutral external store consumed by both?

## Status

Draft. This Plan should be revised after the next demo diary. If a phase is
completed, link the implementation and acceptance evidence here; the phase
status table under *Sequencing and dependencies* is the at-a-glance tracker. If
a later demo needs to copy bridge or packaging code again, treat that as
evidence that the relevant phase is not actually complete.

This document was authored and self-revised by a Codex session on 2026-06-26.
On 2026-06-26 it received a cross-family review-and-revise pass from Claude
(Opus 4.8), recorded under
`llp/reviews/0016-diary-driven-change-program.claude.md`. That pass added the
security (LLP 0009) and authorization (LLP 0011) dependencies, reconciled the
demo ladder with LLP 0015, grounded the Online vs Parity vocabulary in LLP
0012, flagged the then-unspecified `ContractDataManifest`, and added the sequencing,
cross-cutting-constraint, and risk sections. Because that same pass also edited
the document, it is not an independent read of the revised text. A GPT-5
companion review and Charlie's read remain the honest completion of the loop.

The 2026-07-14 reconciliation records that the schema source, Exact manifest
ownership, WebSocket carrier, and local auth sequencing called out by that
historical review have since been decided or implemented. This Plan remains
Draft because mapping breadth, later adapters, and the review loop are not
thereby complete.

On 2026-06-27, after the LLP 0020 review flagged that this umbrella and LLP 0020
were tracking the same core phases in parallel (and diverging on numbering), the
Change Program was slimmed to an index: the per-phase required changes and
acceptance gates now live in LLP 0020 (core — program Phases 0/1/2/4) and LLP 0021
(adapter — program Phases 3/5), and this document keeps the sequencing table,
ownership split, cross-cutting constraints, demo-gating map, and the React/Expo
phase that no detail Plan owns yet. That slim is recorded in
`llp/reviews/0020-core-authoring-surface.claude.md`.
