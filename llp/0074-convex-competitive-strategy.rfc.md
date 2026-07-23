# LLP 0074: Convex-competitive strategy

**Revised (Priority 1 lifecycle checkpoint):** 2026-07-22 (exact target/plan fencing, idempotent lifecycle orchestration, verified backups, interruption resume, and rollback now pass a non-remote harness; provider drills and npm remain open.)

**Revised (checkpoint author adjudication):** 2026-07-22 (Charlie Cheever
accepted LLP 0075 v0 and adjudicated the current checkpoint `reprioritize`.
The next tranche implements LLP 0072's complete trusted single-tenant profile
on `single-instance-container-vm.v1`; public npm publication is a parallel
gate. Cloudflare remains a narrow proof. Stage 4 stays closed until the
prospective rerun reaches `Continue`.)

**Revised (Priority 1 target-neutral checkpoint):** 2026-07-22 (the packaged
CLI now builds and re-verifies LLP 0072's immutable release closure with source,
toolchain, compatibility, target capability, component-digest, scan, and
explicit GAP facts. It remains activation-ineligible: no hosted adapter,
public-origin drill, or public npm publication is claimed, so gate 1 stays
open.)

**Revised (Priority 2/3 implementation checkpoint):** 2026-07-22 (the frozen
owner-private fixture now passes six local semantic checks; the bounded reader
runs through both Ibex and Workerd with exact size/cancellation evidence; one
generated-reference React component typechecks and exports for web and iOS.
This does not close a gate: LLP 0076 and the prerequisite authorities remain
Draft, public npm publication lacks registry authority, and the proposed
Cloudflare adapter does not satisfy the complete frozen hosted profile. The
implementation-status artifact recommended `reprioritize`; the author has
since ratified that outcome.)

**Revised (Priority 6 implementation checkpoint):** 2026-07-22 (`snapback
doctor` now executes the required disposable VM/bundle/query/mutation/live/
shutdown slice with stable per-boundary diagnostics; the first run exposed and
fixed macOS canonical-path target fencing. This is implementation progress,
not gate 1 closure: public packages and the hosted profile remain open.)

**Type:** RFC
**Status:** Draft
**Systems:** Product strategy, Developer experience, Runtime, Actions, Codegen, Client integration, React/Expo, Contract/Exact, Deployment, Control plane, Packaging, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-22
**Revised:** 2026-07-23 (LLP 0086 CC-6: dated positioning-batch section added —
competitive triangle, fragile-suppliers durability argument, boundary markers
promoted from LLP 0001, benchmark-as-content — every claim evidence-class
labeled; external publication gated per LLP 0086 governing constraint 2).
2026-07-22 (LLP 0075 freezes the delegated v0 checkpoint fixture,
named AI-chat profile, symmetric margins, Cloudflare adapter hypothesis, and
continue/stop/reprioritize outcomes before metric-affecting implementation).
2026-07-22 (round-2 dual-model review revision: evidence-authority
delegation via LLP 0063 amendment, gate-to-authority mapping, comparator
inventory extended to migrations/Agent Mode/Components/native clients,
observation/conclusion split in the findings, symmetric preregistration
pinning)
**Related:** LLP 0000, LLP 0001, LLP 0004, LLP 0007, LLP 0012, LLP 0014, LLP 0033, LLP 0035, LLP 0036, LLP 0041, LLP 0051, LLP 0063, LLP 0064, LLP 0065, LLP 0068, LLP 0069, LLP 0070, LLP 0071, LLP 0072, LLP 0073, LLP 0075, LLP 0076, LLP 0077, LLP 0082, LLP 0084, LLP 0086, Diary 0016, Diary 0017

**Priority 1 maintenance checkpoint (2026-07-22):** Explicit code-only
rollback, isolated destructive restore with paused verification and separate
activation, bounded redacted logs, and authenticated inspection now pass the
non-remote adapter harness. Production remains closed on hosted auth, concrete
provider attestations, and public npm.

**Priority 1 backup/audit checkpoint (2026-07-22):** Standalone backup
plan/apply now binds fresh generations and retention policy, requires lease and
component read-back, and retains a maintenance receipt without changing the
active release. A Rust-owned, owner-only hash chain now fails privileged
control actions closed when mandatory audit intake is unavailable and covers
all implemented mutation applies plus bounded privileged reads. This remains
local deterministic evidence; remote backup storage, an independent audit
sink, provider qualification, and public npm remain open.

**Priority 1 hosted-auth evidence checkpoint (2026-07-22):** Adapter
qualification can no longer satisfy `hostedAuth` with a generic remote
attestation. It now requires a Rust-owned executed drill receipt binding the
browser artifact, exact positive static support, short-lived admission,
operator/direct-bearer gates, handler compatibility, and live
limiter/invalidation/serialized-authority health. The deterministic positive
fixture exercises verifier shape only; no sender-constrained browser,
authenticated producer, or remote drill exists yet.

**Priority 1 sender-proof checkpoint (2026-07-22):** Draft LLP 0077 now owns
the required sender-constrained v2 wire/storage contract. An unexported
WebCrypto primitive and Rust verifier pass a live cross-language ES256 proof;
the single-process SQLite authority binds new v2 families and atomically
rejects replay/capacity/unavailable states. It also owns bounded
admission/family nonce generations and atomically couples proof consumption,
nonce retirement, replay retention, and successor nonce publication. A
redacted pre-body admission core now composes session-family lookup, challenge,
verification, and that atomic cut without resolving app authority. Registered
HTTP middleware now calls it before any body poll and derives the target only
from an authenticated hosted origin plus routed path; challenge/successor
nonces survive later middleware exits through one no-store response cell. The
hosted serving constructor remains unreachable from a production adapter.
`AuthCustodyV3` now makes key, bearer, and nonce one
coordinator-owned IndexedDB row and proves interrupted-transition recovery,
structured-clone persistence, private/public-key match, dual-fenced rotation,
v1 no-upgrade, and logout deletion. Browser issuance/refresh transport,
successful resource calls, one-challenge recovery, and atomic refresh now run
through a hosted-only entrypoint that exports no generic direct-bearer client.
Connection-open binds the verified family thumbprint and admission epoch into
the grant; WebSocket upgrade carries and consumes a second proof over that
grant in a dedicated browser subprotocol. A real bound-server test passes the
complete exchange → session → refresh → connection-open → WebSocket train.
The closed codec/binding matrix, a real two-connection replay race, and
forbidden-carrier/reflected-error sentinels also pass; that work found and
closed missing fine-grained client redaction for reflected nonce/JWK/proof
segments. A served replay-authority outage now refuses before body ingestion,
consumes neither proof nor nonce, and retries successfully only after repair.
The reset/restore composition now terminates old grants and restored token
resolution, while the client preserves sender custody across carrier expiry
and deletes it only after a changed-stream handshake or an exact empty-204
logout whose nonce rotation completes under the captured generation. A typed
live invalidation now performs the same exact-predecessor durable deletion and
anonymous transport resume. Adapter admission production, the remaining
served lifecycle and pressure matrix, independent review, and remote
acceptance remain open, so hosted capability stays false.

## Summary

Snapback should close Convex's practical lead in the first hour of application
development without becoming an open-source imitation of Convex. It should
match the parts users feel immediately: a boring deploy, streaming actions,
short common-case authoring, a complete hosted application profile, and a
polished React/Expo path. It should preserve and compound the properties that
make Snapback a different and potentially stronger system: local execution,
local-first and retained operation, generated cross-surface contracts,
capability honesty, explicit authority and settlement facts, target
portability, application ownership, and MIT licensing of the whole runtime and
control plane. (Convex's backend is itself source-available and self-hostable
under FSL, so the openness differentiator is the license terms and the
completeness of what is open, not self-hosting versus none — see the Convex
surface inventory.)

The proposed competitive promise is:

> Snapback should be almost as fast as Convex to start, while being more
> self-contained, locally executable, portable, and materially easier to
> inspect and trust.

The first half of that promise (almost as fast to start) is a target the
preregistered comparison must measure. The second half (easier to inspect and
trust) is a hypothesis, not an established result: the recorded matrices praise
Convex's deploy diagnostics and unattended loop while criticizing a Snapback
runtime diagnostic (`SNAPBACK_HANDLER_HOST_CALL_INVALID`, the incident
Priority 3's diagnostics requirement is derived from), and only the
comparison's correctness/evidence-confidence outcome can confirm the clause.

This RFC owns the competitive posture — the Match/Differentiate/Refuse
classification and the evidence standard for competitive claims. It ranks
product investments by competitive leverage, but it does not displace
LLP 0063's ownership of program sequencing and evidence: see the authority
crosswalk in "Status and authority." It also does not replace the detailed
implementation authorities: LLP 0063 remains the platform roadmap; LLP 0041
covers the packaged loop; LLP 0065 the soundness floor for generated data
patterns; LLP 0064 native client profiles; LLP 0070 durable work; and LLP 0072
the first complete hosted control-plane profile. Every one of the documents
just listed is itself a Draft proposal (of the authorities this RFC relies on,
only LLP 0036, secrets and configuration, is Accepted); see "Draft
authorities" below.

## Status and authority

This is a proposal, not a ratified product decision. Its comparisons are based
on the Partitime and chat matrices recorded on 2026-07-19 and 2026-07-20. Those
experiments are unusually broad but do not constitute a universal backend
benchmark: they cover two application shapes, omit production identity from
the comparative cells, and give Snapback a repository-local familiarity
advantage. Diary 0017 labels its comparative rankings as subjective judgments
after one build day, and setup tax was observed rather than timed.

Every competitive claim in this document carries one of three evidence bases,
and readers should not promote one basis into another:

- **matrix-observed** — recorded in Diary 0016, Diary 0017, or the
  `demos/chat-matrix/` artifacts;
- **doc-confirmed** — checked against official comparator documentation on a
  stated date (see "Convex surface inventory");
- **hypothesis** — a strategic judgment this RFC proposes and the
  preregistered comparison must confirm or refute.

Where this RFC conflicts with an accepted subsystem contract, the subsystem
contract governs. Where it proposes a new runtime capability, such as streamed
response consumption, acceptance of this RFC establishes priority and product
requirements but does not substitute for a dedicated semantic amendment.

### Authority crosswalk with LLP 0063

LLP 0063 states that it owns priorities, cross-stack acceptance gates,
pressure-test order, the definition of "clearly better," and "sequencing and
evidence" for the platform program. This RFC does not supersede that
ownership. The division is:

- **LLP 0063 controls delivery sequencing and capability evidence.** Its
  workstreams, Step 0 obligations, and cumulative gates remain the execution
  plan of record.
- **LLP 0074 controls the competitive classification** (Match / Differentiate
  / Refuse) and the comparator inventory.
- **The Convex-specific comparison protocol is a delegation, not a takeover.**
  LLP 0063 already defines preregistration machinery — a preregistered
  protocol with baseline and threshold versioning, holdout amendments, rerun
  rules, and the idiomatic-Convex follow-up instrument required before final
  comparative ranking. This RFC's acceptance standard therefore takes effect
  only through a coordinated LLP 0063 amendment that explicitly delegates the
  Convex-specific protocol and defines artifact/version precedence, workload
  and baseline rollover, and the treatment of metric-affecting work that has
  already landed under LLP 0063's authority.
- The same rule covers ordering: where this RFC's priority ranking or stage
  list would reorder LLP 0063's workstreams, the reordering takes effect only
  through that amendment, landed with (or after) this RFC's acceptance — not
  through this document alone. The stages below are proposed sequencing until
  then.

### Draft authorities

Except for LLP 0036 (Accepted), every subsystem authority this RFC delegates
to — LLP 0041, 0051, 0064, 0065, 0069, 0070, 0071, 0072, 0073, and the open
gaps of LLP 0004/0007 (both Draft) — is a Draft proposal, as is LLP 0063
itself. (LLP 0068 is related context, LLP 0063's document pressure test; this
RFC delegates nothing to it.) LLP 0063's admission rule applies: their
existence confers no capability claim until they are accepted and carry
executable witnesses, and accepting this RFC ratifies neither their semantics
nor any capability evidence.

The rule propagates to **every** gate, not just the late ones. Each gate below
closes only when its governing authorities are accepted with executable
witnesses:

| Gate | Governing authorities that must be accepted first |
| --- | --- |
| 1 Deploy | LLP 0041 (packaged loop) and LLP 0072 (hosted profile — 0072 itself states the profile is unsupported while Draft) |
| 2 Stream | LLP 0076 (bounded streamed actions; acceptance of 0074 does not substitute for it) |
| 3 Shorten | LLP 0065 (soundness floor), LLP 0051 (data tier), and whichever LLP 0064 profile the checkpoint surface relies on |
| 4 Complete | LLP 0069, 0070, 0071, 0072 |
| 5 Evolve | LLP 0073 plus the future query/projection/migration authorities filling the LLP 0004/0007 gaps |

Until a gate's authorities are accepted, work toward it may proceed but its
competitive claim may only be stated as "evidence satisfies the proposed
criteria," never as a closed capability.

## Evidence behind the strategy

The matrices produced five findings that matter to product strategy. Each
finding pairs a matrix-observed core with a strategic conclusion; the
conclusion clauses are this RFC's judgments (hypotheses or proposal
decisions), not observations, and are marked as such.

1. **Convex produced the two best-recorded hosted verdicts.** Matrix-observed:
   Diary 0016's "best unattended hosted function deploy" verdict and the chat
   matrix's fastest end-to-end AI chat cell (the latter an explicitly
   subjective ranking after one build day). The attribution of those verdicts
   to Convex's feature bundle — deployment-scoped credentials, whole-codebase
   deploy, environment configuration, native subscriptions, scheduled work,
   hosted actions — is inference, and "shortest credible hosted path" as a
   general claim is a hypothesis pending a timed scaffold-to-hosted-URL
   measurement. (The original Partitime cells deliberately used polling; the
   native-subscription evidence comes from the chat matrix and the Diary 0016
   follow-up client, not the polling-era cells.)
2. **Snapback had the broader coherent contract.** One authored schema and
   function set generated the function manifests, schemas, capability facts,
   Contract bindings, and client artifacts, with authority-sensitive
   live-query identity, mutation settlement, and the only local-first
   graduation path in the comparison.
3. **Snapback's setup and declaration tax was visible before its advantages
   were.** Native runtime preparation, unpublished packages, generated
   artifact coordination, and explicit declarations increased first-hour cost
   even where they reduce later ambiguity. This was observed qualitatively,
   not timed; the preregistered comparison must measure it.
4. **AI chat exposed the missing stream; making streaming a product
   requirement is this RFC's decision.** Matrix-observed: Snapback could keep
   the model call and secret inside the authored backend, but the Ibex action
   runtime exposed no response-body stream, so the answer arrived in one
   commit, while Convex streamed token patches through its ordinary action
   path (its runtime documents Web Streams support, so this is an Ibex gap,
   not a JavaScript-runtime universal). The Convex multi-patch behavior is
   diary-observed and source-corroborated
   (`demos/chat-matrix/convex/convex/chat.ts` reads `response.body` into
   throttled patches); the retained acceptance receipt checks only terminal
   completion, so no receipt yet proves multiple intermediate authoritative
   commits — the streaming witness below closes exactly that gap.
5. **React/Expo was the fastest adoption surface.** Matrix-observed:
   Snapback's generated client, live queries, optimistic settlement,
   authority rotation, and reconnect behavior produced passing Online-class
   evidence across web, iOS, and Android (per LLP 0063's closure notes;
   LLP 0012's older native-status text predates them). Because the governing
   capability profile (LLP 0064) is Draft, this is evidence satisfying the
   proposed Online criteria, not a closed capability claim. That Contract's
   remaining interaction and carrier costs should not gate React/Expo
   adoption is a strategic conclusion of this RFC, not an observation.

The evidence also warns against optimizing for a green-looking matrix rather
than a better system. Prerequisite skips, seeded-state oracles, polling
fallback, credential probes, and host instrumentation all produced plausible
but misleading results until the comparison gained actor-specific transitions,
transport attribution, immutable receipts, and fail-closed cleanup. Every
competitive claim under this RFC inherits that evidence discipline.

## Convex surface inventory (doc-confirmed 2026-07-22)

The matrices are point observations of one Convex configuration. Checked
against official Convex documentation on 2026-07-22 (entries marked ◇ were
confirmed against the named page; entries marked ◈ rest on adjacent official
pages or reviewer prior knowledge and must be page-verified at the protocol
refresh), the current comparator surface also includes, beyond what the
matrices exercised:

- ◇ **account-free local deployments** (`docs.convex.dev/cli/local-deployments`)
  and ◇ **production self-hosting** of the open-sourced backend under FSL
  (converting to Apache 2.0 over time; `docs.convex.dev/self-hosting`);
- ◇ **separate development, preview, and production deployments** per project
  (`docs.convex.dev/production/multiple-deployments`; staging is a documented
  use case built from an additional deployment or project, not a fourth
  deployment type);
- ◈ **Agent Mode**: anonymous local backends, per-agent deployments, scoped
  keys with expiration, and worktree setup recipes
  (`docs.convex.dev/cli/agent-mode`) — directly relevant to first-hour,
  setup, and isolation baselines;
- ◇ **backup and restore** (`docs.convex.dev/database/backup-restore`);
- ◈ **online, resumable migrations with dry runs, schema compatibility
  enforcement, and staged index backfills** (production/database docs) —
  directly relevant to Priority 5's proposed data-evolution advantage;
- ◈ **an authentication offering** (Convex Auth and integrations);
- ◇ **full-text search** (`docs.convex.dev/search/text-search`) and
  ◈ **vector search** (documented separately);
- ◈ **file storage, cron/scheduled functions, and a components ecosystem**
  (`docs.convex.dev/components`) whose components carry **isolated functions,
  schemas, and data with multiple instances inside one deployment**, and
  include durable workflows — with varying core-versus-component maturity;
- ◈ **React Native, Swift, and Kotlin realtime clients** — relevant to
  Priority 7's adoption-surface comparison.

Consequences this RFC accepts: local development without a hosted account is
**not** by itself a Snapback differentiator; several Priority 4 services have
shipped Convex counterparts; Convex has a documented data-evolution story
Priority 5 must be measured against rather than assumed past; and the
components model bounds how far the Priority 5 coupling incident generalizes.
The differentiator section below is classified against this inventory, not
against the matrices alone. This inventory must be refreshed — with a source
page, verification date, delivery class (core, component, or hosted-only),
and maturity per entry — when the preregistration protocol is written;
maintaining it belongs to whoever owns the competitive program (an open
author decision — see "Ownership and non-goals"). Interim default until an
owner exists: whoever cites the inventory in a new document re-verifies and
re-dates the entries they rely on.

## Competitive decision

Snapback should divide the Convex comparison into three classes.

### Match

Match means meeting the market table stakes that Convex's documented surface
exemplifies — not exact behavioral parity with Convex, and not necessarily the
same mechanism. These are capabilities whose absence makes Snapback harder to
choose even when its architecture is stronger:

- one-command preview and production deployment;
- hosted logs, inspection, rollback, backup, and restore;
- response-body streaming for actions;
- concise schema, query, mutation, and trusted-default authoring;
- durable jobs, scheduling, webhook handling, and provider delivery;
- production identity and ordinary application services;
- native React subscriptions and mutation-state projections;
- public, versioned packages and a clean install;
- actionable diagnostics and repairable environment checks.

### Differentiate

These properties justify choosing Snapback rather than merely tolerating it.
(Local development without a hosted account is deliberately absent: Convex's
local deployments provide it too, so it is table stakes, not a differentiator.
What survives the inventory is the conjunction below — MIT licensing rather
than FSL, identical local and hosted semantics on one portable runtime, and
retained local-first execution — not any single clause.)

- the local target is the same governed execution profile as the hosted one,
  not a development emulator: identical semantics, capability facts, and
  acceptance evidence, MIT-licensed end to end;
- Online and Parity capability classes are explicit and executable;
- local-first reads, durable queued mutations, replay, rebase, and authority
  transition behavior remain first-class on the surfaces that claim Parity
  class (matrix-observed for the Contract/local path; the React/Expo
  local-first story is not yet built and is claimed only as a graduation
  path);
- generated artifacts close the backend, React, Contract, native, CLI, and
  agent type/capability loop;
- authorization, invalidation, receipts, ambiguity, and settlement are named
  facts rather than client conventions;
- targets and deployments have explicit identity and compatibility fencing;
- the runtime and control plane remain portable and truly open;
- tests attribute transport, authority, cleanup, and target profile instead of
  inferring capabilities from a rendered update.

### Refuse

Snapback must not gain apparent ease by discarding its governing properties:

- hosted service must not become mandatory for local development;
- stringly function names must not replace generated references;
- runtime-observed reads and writes must not widen a declared authority
  ceiling;
- authorization or row visibility must not be inferred from storage access;
- polling fallback must not be reported as proven push;
- ambiguous settlement must not collapse into generic success or failure;
- offline behavior must not become app-authored cache optimism;
- generated conveniences must not silently map an unsupported provider shape;
- portability must not mean only that a future rewrite is imaginable.

## Priority 1: a boring deploy

The largest competitive gap is not query syntax. It is the transition from a
working local application to a reachable, inspectable hosted application.

The paved loop should be:

```text
snapback new
snapback dev
snapback deploy
```

Ordinary authors should not need to know that Cargo, Ibex, Hermes, sibling
checkouts, runtime packages, ready files, or internal artifact aliases exist.
The first hosted target should be the deliberately narrow
`trusted-single-tenant-app-complete.v1` profile from LLP 0063 and LLP 0072,
not an early claim of untrusted multi-tenancy or horizontal scale.

The deploy experience must include:

- automatic isolated preview environments;
- application secrets and configuration through LLP 0036;
- an immutable release artifact and exact target identity;
- schema and client compatibility preflight;
- a generated public origin and client configuration;
- structured build and runtime logs;
- authenticated inspection;
- controlled activation and rollback;
- backup plus an executed restore drill; and
- stable diagnostics for every refused or failed transition.

Preview convenience does not weaken production fencing. A production deploy
must resolve and display exact target, environment, deployment, database, and
release identities before mutation. A preview may accept a dirty source tree
only when its manifest and UI say so.

## Priority 2: streamed actions

Snapback should add bounded response-body streaming to the action runtime and a
paved pattern for turning a stream into durable application progress. Raw
stream exposure alone is insufficient.

The capability must define:

- the runtime stream/async-iteration surface;
- cancellation when the caller, job, or deployment stops;
- backpressure and bounded buffering;
- byte, duration, idle, and patch-rate limits;
- watchdog behavior while a continuation awaits input;
- secret-safe diagnostics;
- batching or throttling of progress mutations;
- retry and idempotency behavior;
- settlement when the upstream effect completes, fails, or becomes ambiguous;
  and
- the relationship between request-bound streaming and LLP 0070 durable work.

The first product pattern should be an AI reply that consumes an upstream
response incrementally and applies idempotent, throttled patches to one
assistant message. It must have an executable witness that observes multiple
intermediate authoritative commits before terminal completion. A UI animation
or client-side token reveal is not a streaming-backend witness.

## Priority 3: concise authoring without lost facts

Snapback should make common facts cheaper to write while preserving explicit
security and capability boundaries. LLP 0065's fact classes govern the split:
schema-derived facts may be generated, security declarations remain explicit,
and runtime observations prove conformance but never create authority.
Authority over the patterns themselves is divided: LLP 0065 supplies the
soundness floor and its narrow v1 owner-visibility profile, LLP 0051 the
language-neutral data tier they generate against, and patterns touching
queries, joins, or migrations wait on their own future authorities — this
list is a product wishlist, not a claim that one document authorizes it all.

The competitive common path should derive or generate, where sound:

- validators and TypeScript types from one installed schema;
- generated query and mutation references;
- standard owned CRUD;
- unique lookup;
- ordered pagination;
- trusted timestamps and identifiers;
- multi-row creation with bound generated identifiers;
- explicit conflict behavior;
- conservative read/write ceilings for closed declarative plans;
- Contract and agent metadata; and
- migration and compatibility previews.

The first-hour path also depends on diagnostics. A stable error code that only
says a host call is invalid is not enough when the compiler knows the source
location, operation, received arguments, and expected shape. Every authoring
refusal should say what was rejected, where, why, and which documented pattern
applies, while retaining a structured machine-readable form.

Generated brevity must pass authorization and visibility negative tests.
Read/write ceilings constrain effects; they do not prove who may see a row.

## Priority 4: a complete ordinary application platform

Once deploy and streaming no longer dominate the comparison, the remaining
gap is platform completeness. Snapback should assemble its existing and
proposed subsystems into one coherent application path:

1. production sessions, provider delivery, social login, and recovery
   (building on the existing local auth protocol under LLP 0057–0060; social
   login and recovery are new semantics needing their own authority);
2. durable background jobs with retries and idempotency under LLP 0070;
3. scheduled notifications, email, SMS, and push;
4. idempotent webhook ingress and reconciliation;
5. asset upload, transformation, metadata, and delivery;
6. portable search under LLP 0073 (assembled here, delivered in stage 5 —
   search's stage assignment is stage 5, Evolve);
7. rate limiting, abuse controls, moderation, and audit under LLP 0071;
8. payment-provider integration under LLP 0069; and
9. deploy, deployment-migration orchestration, backup, restore, logs, and
   inspection under LLP 0072 (the general migration semantics LLP 0004 and
   LLP 0007 leave open are not claimed here).

These are not nine unrelated plugin systems. They should share generated
references, authority, secret handles, target profiles, receipts, idempotency,
structured diagnostics, admin inspection, and executable local substitutes.
A local stub never satisfies a hosted delivery claim.

## Priority 5: deployment and data evolution as advantages

The matrices recorded one real coupling incident: deploying one demo's older
schema briefly removed another demo's indexes. The competitive inference must
stay narrow. The two demos deliberately shared a single deployment, current
Convex supports separate development, preview, and production deployments per
project, and Convex components carry isolated functions, schemas, and data
inside one deployment — so the incident proves deployment-global replacement
scope for the root applications actually deployed, plus weak fixture
isolation under that (self-inflicted) topology. It does not prove deploy
atomicity, and it does not prove that Convex cannot isolate applications.
Diary 0016's own follow-up recommendation (per-demo deployment identity or a
pre-deploy schema-union check) is what this priority productizes. Before this
coupling claim appears in any competitive material, the comparison must be
rerun or reanalyzed with separate Convex project/preview identities —
deciding explicitly whether Convex Components are an admissible isolation
strategy or excluded, and why — comparing target selection, fencing, preview
creation, and destructive-deploy failure modes directly.

Snapback should still turn its explicit application and target identities into
a product advantage:

Every environment should have a stable project, target, deployment, database,
stream-incarnation, and release identity. Deploy must refuse an incompatible or
unexpected target. Schema evolution should produce a reviewed plan with
deterministic compatibility evidence. Acceptance runs and preview deployments
must use isolated identities rather than mutate shared fixtures.

Joins, maintained projections, and migration semantics require their own
accepted authorities before codegen claims them. This RFC prioritizes the
experience but does not authorize inference across the gaps LLP 0004 and
LLP 0007 leave open.

## Priority 6: setup that fails rarely and diagnostically

Because Snapback carries a local native runtime, it cannot eliminate all local
environment state. It must make that state observable and repairable.

`snapback doctor` should execute a disposable vertical slice rather than only
check file presence:

1. create the runtime VM;
2. load a generated bundle;
3. invoke a query;
4. commit a mutation against an isolated temporary database;
5. open and close a live subscription; and
6. shut down without a stale descriptor or child process.

The developer loop should use verified ready descriptors rather than guessed
ports, refuse a descriptor belonging to another checkout or database, avoid
interactive prompts under automation, and provide one documented repair path
for every stable setup code. Unsupported hosts remain explicit capability
facts, not accidental source builds.

## Priority 7: React/Expo adoption and Contract depth

React/Expo is the fastest route to competitive product polish. Snapback should
continue treating it as an endorsed projection rather than a control used to
favor Contract. The surface should expose:

- generated query and mutation hooks;
- pending, confirmed, rejected, retryable, and ambiguous settlement;
- optimistic reconciliation;
- connection, stale-data, and capability state;
- authority rotation and permission-loss behavior;
- background, foreground, reconnect, and offline transitions; and
- first-class Metro and hosted-endpoint configuration.

Online-class success must not imply Parity. Exact Native and Contract remain
the strongest expression of Snapback's semantic and local-first potential, and
LLP 0064 continues to govern their per-platform evidence. Contract work should
proceed in parallel on interaction completeness, accessibility, keyboard and
focus behavior, packaging, and carrier cost. React/Expo wins adoption;
Contract demonstrates the maximum semantic payoff; both consume the same
generated application contract.

## Sequence and gates

The numbered priorities above rank competitive leverage — how much each gap
distorts user choice. The stages below are delivery order. They are related
but not identical, and the mapping is explicit:

- Priorities 1–3 are stages 1–3 directly.
- Priority 4 is stage 4; Priority 5 is stage 5.
- Priority 6 (setup and doctor) and the public-package requirement are
  **cross-cutting prerequisites of stage 1**, not late-stage work: a deploy
  path whose local half fails undiagnostically, or that installs only from a
  tarball, does not close gate 1. "Public packages" means published to the
  public npm registry, not a tarball or repository-local link.
- Priority 7 (React/Expo) is not a stage: it is the **checkpoint surface**.
  The first-checkpoint application is built on React/Expo, so gates 1–3 are
  exercised through the fastest adoption surface. Contract depth proceeds in
  parallel under LLP 0064's evidence rules.
- Stage 6 (Optimize) corresponds to no numbered priority: it is derived from
  the competitive-acceptance performance dimensions (cold/warm latency,
  bundle size, memory, idle network/CPU, build time) and exists so those
  measurements have a home in the delivery order.

1. **Deploy:** public packages plus one trusted hosted preview/deploy path.
2. **Stream:** bounded streamed actions plus the AI token-patch witness.
3. **Shorten:** generated common patterns and actionable diagnostics.
4. **Complete:** durable work and the ordinary hosted application services.
5. **Evolve:** migration, compatibility, search, joins, and projections under
   accepted semantics.
6. **Optimize:** cold start, bundle size, fan-out, memory, and build latency —
   measured under LLP 0035's measurement contract, noting that the
   pre-correction fan-out figures are invalidated fixture results awaiting a
   corrected rerun.

Every gate carries the authority-acceptance prerequisites in the "Draft
authorities" table — including gates 1–3, whose authorities (LLP 0041, 0072,
the streaming amendment, LLP 0051/0065/0064) are also still Draft.
Work may proceed in parallel where subsystem prerequisites permit, but a later
capability must not promote an earlier competitive claim. For example, a
streaming demo does not close the hosted-deploy gap, and a tarball-only package
does not close public installation.

The first competitive checkpoint is intentionally only three deliverables:

- a fresh external application reaches a hosted URL through one deploy command
  and retains logs, inspection, rollback, backup-plus-executed-restore, and
  target identity evidence;
- one action produces multiple bounded authoritative stream-progress commits;
  and
- the same application uses generated common patterns with no handwritten
  validators, client types, or ordinary CRUD while retaining explicit
  visibility and negative authorization tests, within LLP 0065's v1
  owner-visibility profile so the deliverable cannot be satisfied by a
  generator that violates the soundness floor.

These deliverable statements are intent, not yet a protocol. Before
implementation of any deliverable starts, a preregistration fixture must be
frozen that defines: the application (schema, query and CRUD patterns, and
frontend — React/Expo per the mapping above), the package source and initial
machine/checkout state that make "fresh external" checkable, the hosted-profile
subset claimed, the minimum number of intermediate authoritative commits and
the byte/duration/patch-rate bounds that make "multiple bounded" checkable,
the cancellation and retry/ambiguity cases the streaming witness must include,
and the continue / stop / reprioritize outcomes of the rerun. Freezing the
fixture before implementation is what keeps the rerun from being shaped by
knowledge of the implementation — the same discipline the matrices converged
on.

The relationship between the two preregistration artifacts is: the checkpoint
fixture is the first versioned slice (v0) of the acceptance protocol, sharing
its adjudication; the fixture's continue/stop/reprioritize outcomes govern the
checkpoint rerun, while the full protocol governs the eventual acceptance
comparison. "Metric-affecting work" means work on the fixture application and
the surfaces its measurements touch — it does not retroactively freeze work
LLP 0063 has already authorized; the prospective baseline cutoff (which
already-landed work counts as pre-baseline) is set by the LLP 0063 amendment
described in the authority crosswalk, which is also how both freezes bind.
LLP 0075 and its machine-readable `protocol.v0.json` are that frozen v0 slice:
they name the exact AI-chat fixture/customer scope, choose the Cloudflare
adapter as a hypothesis subject to honest reprioritization, pin symmetric
first-hour margins, and deliberately limit the first claim to the exact frozen
fixture.

The author adjudicated the v0 evidence `reprioritize` on 2026-07-22. The next
tranche stays in stage 1: complete the LLP 0072 hosted profile through the
selected `single-instance-container-vm.v1` adapter and publish the public npm
package closure in parallel. Cloudflare remains a narrow proof until it can
satisfy the identical profile without semantic substitutions. The adapter
replacement is pinned prospectively before rerun under LLP 0063/0075; it does
not rewrite v0 evidence. Stages 4–6 do not broaden until a valid rerun reaches
`Continue`.

If those three pass, the comparison should be rerun before broadening the
program. They are the smallest set likely to change the first-hour verdict.

## Competitive acceptance

Snapback may claim that it has closed the practical gap to Convex for a named
application profile only when a preregistered comparison proves all of the
following on fresh external checkouts:

- time and commands from scaffold to first local live row;
- time and commands from scaffold to hosted live URL;
- package and runtime installation without repository topology knowledge;
- streaming progress when the workload requires it;
- native push with fallback disabled and transport attributed;
- production identity and authorization appropriate to the profile;
- deploy, rollback, logs, inspection, backup, and restore;
- schema-change compatibility and target isolation;
- source volume and generated volume attributed separately;
- cold and warm latency, bundle size, memory, idle network/CPU, and build time;
- deterministic cleanup and explicit required versus remote-dependency skips;
  and
- an honest list of capabilities each target does not claim.

The comparison should report at least three outcomes rather than one composite
score: product completeness, first-hour authoring/deployment cost, and
correctness/evidence confidence — reporting confidence intervals and the raw
command/time/failure data beside each narrative verdict. Snapback does not
need to win every isolated metric. It succeeds when its start/deploy
experience is close enough that its ownership, local-first, portability, and
correctness advantages determine the choice.

The dimensions above are requirements on a protocol, not the protocol itself.
This RFC deliberately does not fix the tolerances: "almost as fast" and "close
enough" are defined by a separate, versioned **preregistration protocol** that
must be written and frozen before any metric-affecting work starts, and the
comparison cannot run until it exists. That protocol must pin **both arms
symmetrically**: for Convex, the version, plan/tier, and (if self-hosted)
backend revision; for Snapback, the runtime revision, published package
versions, hosted adapter, and target profile; and for the comparison itself,
the application-fixture digest, credentials and preconditions, the protocol
implementation, the named application profile and target customer, the
refreshed comparator inventory, hardware and network environment, the allowed
human/agent assistance policy, repetition counts and statistics (Diary 0016's
warmups, alternating samples, and median/p95 reporting are the floor, not the
ceiling), the treatment of skips, per-criterion non-inferiority margins, which
criteria are mandatory, the conjunctive pass rule, and who adjudicates. It
must also state whether the claim covers only the exact frozen fixture or a
broader customer profile — and if the latter, which holdout fixtures make the
generalization honest. Whether tolerance is measured in elapsed time, agent
tokens, commands, failures, or a conjunction across them is an input to that
protocol (open question 4).

## Ownership and non-goals

This RFC currently has no named program owner. Who owns the competitive
program, authors the preregistration protocol, maintains the comparator
inventory, and operates any hosted offering — and what staffing, horizon, and
displaced work the program assumes — are open author decisions that must be
resolved before this RFC can move past Review to Accepted. Recording them here
as open is deliberate: inventing owners in a proposal would be the same false
precision the evidence discipline forbids.

Explicit non-goals, regardless of how the open decisions land:

- API or wire compatibility with Convex;
- matching Convex's managed-service scope, enterprise/SLA commitments, or
  pricing;
- regulated-workload compliance claims;
- untrusted multi-tenancy, autoscaling, and horizontal realtime (separately
  gated, per the scope-explosion risk);
- winning on unit economics, operational labor, reliability/SLA, or ecosystem
  maturity in the first comparison — these are real competitive axes and are
  explicitly deferred, not denied.

## Risks

### Scope explosion

“Match Convex” can become an unbounded platform program. The trusted
single-tenant hosted profile and the three-deliverable first checkpoint keep
the next comparison finite. Untrusted multi-tenancy, autoscaling, and
horizontal realtime remain separately gated.

### Ease purchased by dishonesty

Inference, fallback, or generated helpers could shorten demos by erasing facts
Snapback currently exposes. The Match/Differentiate/Refuse split and
capability-attributed acceptance are the guardrail.

### Two primary frontends

React adoption and Contract depth can divide effort. They must share one
framework-neutral client lifecycle and generated contract. Framework-specific
product work may differ; provider semantics may not.

### Hosted work displacing local-first work

Closing the most visible Convex gap could turn the local target into a neglected
test double. Local execution and Parity evidence remain differentiators and
must run in the cumulative comparison.

### Native runtime weight

The packaged local runtime may remain materially heavier than a hosted client.
Snapback must measure and reduce that cost, not hide it inside installation.

## Open questions

1. Which adapter should implement the first
   `trusted-single-tenant-app-complete.v1` hosted target?
2. Is streamed response consumption best added to Ibex as a standard
   `ReadableStream`, a narrower async-byte iterator, or both?
3. Which three generated patterns save the most first-hour authoring while
   satisfying LLP 0065's security floor?
4. What tolerance defines “almost as fast as Convex to start” for the first
   preregistered comparison: elapsed time, agent tokens, commands, failures, or
   a conjunctive bound across them?
5. Which ordinary hosted services are required for the first competitive
   vertical beyond identity, durable work, and inspection?
6. Should the first hosted offering be a maintained reference deployment, a
   managed service, or both, and who owns its operations?
7. At what point should the comparison add cost per idle app and cost per
   active subscriber to the product decision?
8. Which named customer and application profile anchors the first competitive
   claim: solo developers, small teams, agent-authored applications, AI chat
   products, or general consumer applications? (This is the critical-path
   decision: it gates the preregistration protocol, which gates the
   comparison, which gates the competitive claim.)
9. Who owns the competitive program, the preregistration protocol, and the
   comparator inventory — and with what staffing, horizon, and displaced
   work? (See "Ownership and non-goals"; required before Accepted.)
10. Is the first competitive claim about the exact frozen fixture only, or a
    customer profile requiring one or more holdout fixtures?
11. In the Priority 5 rerun, are Convex Components an admissible isolation
    strategy, or is the comparison deliberately restricted to root
    applications?

## Positioning batch from the 2026-07 prior-art passes (LLP 0086 CC-6)

**Added 2026-07-23.** Drafted under
[LLP 0086](./0086-prior-art-course-corrections.plan.md) CC-6; external
publication of every claim in this section remains gated per LLP 0086
governing constraint 2 — the supporting evidence must pass review or the claim
must be re-established by fresh empirical verification, and the gate covers
LLP 0001-sourced and compound claims (a compound claim publishes only when
every factual component has cleared its gate).

Four positioning pieces, drawn from the 2026-07 prior-art passes
([LLP 0082](./0082-instantdb.research.md),
[LLP 0084](./0084-triplit-ditto.research.md), and the refreshed
[LLP 0001](./0001-prior-art.research.md) synthesis — all currently Draft).
Each factual claim carries this RFC's evidence-class label (matrix-observed /
doc-confirmed / hypothesis), and vendor facts carry a checked date. The source
research passes use their own `[confirmed]/[observed]/[inferred]` tags; the
mapping used here is: their primary-source-verified vendor facts appear as
**doc-confirmed** with the pass's fetch date, and their `[inferred]` analyses —
like this RFC's own proposal decisions — appear as **hypothesis**. Nothing in
this section alters the Match/Differentiate/Refuse classification, the
priorities, or the gates above.

### Piece 1: the competitive triangle

Proposed positioning line:

> Convex-grade functions, Instant-grade sync surface, physically isolated
> like neither — MIT end to end: fully open like Instant (Apache-2.0), more
> permissively and more completely open than Convex's FSL source-available
> backend.

The licensing wording is load-bearing and deliberately consistent with this
RFC's §Summary: Convex's backend is itself source-available and self-hostable
under FSL, so the differentiator is the license terms and the completeness of
what is open — never "open vs closed." Published variants of the line must
preserve that framing.

This is a compound claim. Component decomposition:

- **Instant has no server functions runtime** (founder-acknowledged, April
  2026): doc-confirmed, checked 2026-07-23 (LLP 0082 §gaps).
- **Instant is Apache-2.0, fully open** ("no private repos," no
  source-available restriction): doc-confirmed, checked 2026-07-23 (LLP 0082
  — repo LICENSE plus dated founder HN statements).
- **Convex's backend is source-available and self-hostable under FSL,
  converting to Apache 2.0 over time**: doc-confirmed, checked 2026-07-22
  (`docs.convex.dev/self-hosting`; this RFC's Convex surface inventory).
- **Snapback's runtime and control plane are MIT end to end**: internal fact
  ([LLP 0033](./0033-license-posture.decision.md)), not a competitor claim.
- **Instant's isolation is logical, not physical** — one shared Aurora
  Postgres with `app_id` scoping over an EAV triple store, with documented
  planner pathology at scale: doc-confirmed, checked 2026-07-23 (LLP 0082,
  Instant architecture essay).
- **Convex's hosted multi-tenant isolation model**: not verified in the
  corpus — the surface inventory covers self-hosting and deployments, not the
  hosted tenancy substrate. The "like neither" clause is therefore
  **hypothesis** on the Convex side until its isolation model is
  doc-confirmed; that verification is a publication prerequisite for the
  triangle.
- **Snapback's physical isolation** (relational-SQLite-per-app; DO-SQLite per
  app on the hosted direction): internal architecture fact (LLP 0000,
  LLP 0014).
- **"Convex-grade functions"** as a claim about Snapback: hypothesis — a
  target the preregistered comparison must confirm, per this RFC's own
  findings (Convex holds the two best-recorded hosted verdicts; streaming is
  a named gap behind gate 2).
- **"Instant-grade sync surface"** as a claim about Snapback: partly
  matrix-observed (the broader coherent contract and live-query/settlement
  findings above), partly hypothesis — surface-for-surface parity with
  Instant has never been measured.
- That the triangle **wins deliberations with real buyers**: hypothesis.

### Piece 2: fragile suppliers — institutional durability as a selection criterion

The 2026-07 survey batch found validated demand served by fragile suppliers:
recurring perpetual pre-1.0 status or single-maintainer risk (PocketBase,
TanStack DB, Evolu, Colyseus) and thin capitalization for the size of the bet
(Encore, DBOS), while adoption signals stay strong. The per-system facts are
doc-confirmed, checked 2026-07-23 (LLP 0001, survey batch); the pattern
statement is hypothesis (LLP 0001 synthesis §8, tagged `[inferred]` there).

The terminal case is Triplit's silent death: last main-branch commit
2025-09-11, npm releases stopped 2025-07-31, last blog post 2025-06-06, YC
status Inactive, domain re-registered by a squatter 2026-05-11, AGPL-3.0 from
day one with no license switch, no funding beyond YC found, and no shutdown
post, handoff, or archive notice — doc-confirmed, checked 2026-07-23
(LLP 0084 — GitHub API, npm registry, RDAP, Wayback, ycombinator.com). A
three-person team carried a full-stack sync database plus cloud, and anyone
who bet an app on it found out from a domain parking page. That "open but
dead" is a distinct failure mode from "alive but FSL" — openness without a
steward is only a slightly better grave — is hypothesis (LLP 0084, bearing on
LLP 0033).

The positioning use this batch proposes (hypothesis — a proposal decision of
this RFC, per LLP 0084 §What to learn): state institutional durability —
funding, the agent fleet, the LLP corpus, and the acceptance suites — as an
explicit, rational selection criterion in this category, kept visible to
adopters rather than left implicit. Any published durability comparison
naming a specific competitor's staffing or funding is a vendor fact and needs
its own checked date at publication time.

### Piece 3: two boundary markers, promoted from LLP 0001

This is promotion into competitive material, not creation: every marker below
is already recorded in the research corpus. LLP 0001's synthesis (§7, the
non-goal line) carries the SpacetimeDB marker and names Nakama/Colyseus "a
second marker on the same line"; LLP 0084 records the mesh marker explicitly
alongside those two. This RFC now carries all three as competitive material.

- **Not a realtime-game database** (the existing marker): SpacetimeDB targets
  the MMO/realtime-game workload LLP 0000 declares a non-goal — observed in
  LLP 0001 (its SpacetimeDB pass predates the 2026-07-23 primary-source
  batch, so its vendor facts carry no fresh checked date and need one before
  publication).
- **Not a tick-rate game server**: Nakama (Apache-2.0, Go; authoritative
  fixed-tick match loops) and Colyseus (MIT, Node/TS; server-authoritative
  Rooms with binary delta sync) — mechanics and licensing doc-confirmed,
  checked 2026-07-23 (LLP 0001 §Nakama/Colyseus). Tick-rate authoritative
  simulation loops are a workload Snapback's event-driven ephemeral API does
  not cover.
- **Not a mesh database**: Ditto owns the serverless-mesh segment —
  offline-critical physical operations (aviation, QSR, defense), P2P
  Bluetooth/Wi-Fi/LAN mesh with an optional Big Peer, $82M Series B at $462M
  post-money (2025-03-12), and offline P2P authorization structurally reduced
  to certificate-carried predicates on immutable `_id` — doc-confirmed,
  checked 2026-07-23 (LLP 0084). "Works with no server, ever" is a real,
  paying segment Snapback deliberately does not serve.

The markers themselves are scope decisions (LLP 0000 owns the boundary), not
empirical claims; the vendor facts above are what publication gates. The
rationale for stating them publicly — honest boundaries beat blurred
"local-first" marketing, and a named marker keeps the Ditto-shaped segment
from becoming a support burden — is hypothesis (LLP 0084 open question).

### Piece 4: benchmark-as-content

Instant runs a recurring "Counter-Strike benchmark" essay series pitting
frontier models against each other building the same multiplayer game on
Instant — doc-confirmed, checked 2026-07-23 (LLP 0082, essay index). The
format is self-refreshing: each frontier-model release renews the content for
the cost of a rerun.

Proposal (hypothesis — a proposal decision of this RFC): publish the Snapback
analogue as a series — agents building the same app on Snapback across
models. That this plays to the acceptance-suite strength — each run gets an
executable pass/fail floor and capability-attributed evidence rather than
screenshot judgment — is likewise hypothesis until a published run
demonstrates it. Two guards carry over from this RFC's evidence discipline:
series artifacts inherit the same anti-green-matrix rules as the matrices
(actor-specific transitions, transport attribution, immutable receipts,
fail-closed cleanup), and any cross-vendor comparative claim a series post
makes is competitive material under this section's publication gate, not
exempt from it as "content."

### Revocation-eviction claim (LLP 0086 CC-3.4, narrowed 2026-07-23)

The claim originally anticipated by LLP 0086 CC-3 — Snapback has a ratified
revocation-eviction contract where InstantDB is silent — was **narrowed** by
the preregistered probe (probe-observed 2026-07-23; receipts and runnable
protocol in `tests/probes/instant-eviction-20260723/`; provenance caveat:
run on a self-provisioned ephemeral app after a credential mismatch,
platform behavior assumed app-independent). The publishable claim is:

> Snapback's authorization-invalidation path is a ratified, specified
> contract — server-retained ACK-backed delivery obligations,
> retain/quarantine/delete semantics, lease-bounded offline clients, and
> invalidation on permission-rule activation — acceptance-tested on the
> local target (internal fact: LLP 0053 + its 2026-07-23 coverage note;
> local target only). InstantDB's implementation was probe-observed to
> evict already-synced rows live (~32 ms) when a *data-dependent*
> permission input changes, but observed **not** to re-evaluate live
> subscriptions when the permission *rules themselves* change — rule
> revocation reaches a connected client only on reconnect (probe-observed,
> 2026-07-23) — and none of this behavior is documented (doc-confirmed
> absence, checked 2026-07-23).

What may NOT be published: any claim that Instant "does not evict" (refuted
for the data-dependent shape), and any coverage implication beyond
Snapback's local target. Publication remains under this section's gate
(LLP 0086 governing constraint 2); the probe supplies the fresh empirical
verification leg for the Instant-side facts, so the remaining gate items
are the Snapback-side coverage statement (carried by LLP 0053's acceptance
evidence) and the LLP 0082 review or an independent audit of the probe
receipts.
