# LLP 0241: Semantic artifact generations

**Type:** RFC
**Status:** Accepted
**Systems:** Code generation, Artifacts, Packaging, Runtime, Server lifecycle,
Client integration, Auth, Developer experience, Diagnostics, Guide, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-08-12
**Revised:** 2026-08-12 (post-acceptance implementation clarification: the
Expo/Metro custodian must exclude mutable `.snapback/` runtime state from its
watch graph while retaining semantic inputs; adds a rebuild-storm acceptance
case without changing generation identity). 2026-08-12 (entered Review for the author-directed single-family
`llp-super-refine` loop: Codex GPT-5.6-sol xhigh only; Claude intentionally
skipped). 2026-08-12 (mechanically renumbered from LLP 0239 to LLP 0241 after
origin assigned LLPs 0234–0235). 2026-08-12 (author-directed acceptance after
Round-3 same-revision Codex GPT-5.6-sol xhigh convergence). 2026-08-12 (round-1 revision: added unique generation addresses,
aligned module-edge identity with LLP 0237, made per-consumer dispositions
authoritative with a fixed reduction, and bounded predecessor retirement).
2026-08-12 (round-2 revision: selected a pre-pointer candidate/readiness
protocol with bounded abort, crash recovery, and post-commit stale deadlines).
2026-08-12 (initial Draft synthesized from LLP 0236 P9, P11, P12, P13, and P14)
**Related:** LLP 0010, LLP 0024, LLP 0030, LLP 0037, LLP 0041, LLP 0061,
LLP 0062, LLP 0081, LLP 0108, LLP 0122, LLP 0123, LLP 0146, LLP 0189,
LLP 0193, LLP 0203, LLP 0223, LLP 0224, LLP 0232, LLP 0233, LLP 0236,
LLP 0237, LLP 0238, LLP 0239, LLP 0240, LLP 0242, LLP 0243,
Diary 0039, Diary 0059, Diary 0074

## Summary

Snapback should preserve fail-closed artifact identity while changing the unit
authors and long-running clients experience from “a pile of hashes changed” to
“a semantic application generation changed, and every custodian crossed the
same safe boundary.”

This RFC introduces:

- separate semantic, executable, evidence, and bundle identities;
- a content-addressed `ApplicationGenerationV1` envelope with a machine-readable
  semantic change classification;
- an atomic current-generation pointer managed by the dev supervisor/server;
- safe-boundary reload for generated modules, gateways, relays, and first-party
  clients;
- one `snapback doctor`/dev/start recovery model over readiness and generation
  facts; and
- a first-summary-line outcome grammar separating application failure,
  platform failure, stale generation, missing evidence, and instrument
  incompleteness.

Documentation, comments, source locations, and `@ref` changes remain bound as
review evidence but no longer rotate executable identity by themselves. A
behavioral, contract, authority, capability, or migration-relevant change still
rotates the appropriate semantic identity and fails closed across incompatible
custodians.

## Motivation

LLP 0236 says artifact identity is both one of Snapback’s strongest protections
and a noticeable lifecycle tax. Builders praise
`SNAPBACK_ARTIFACT_IDENTITY_MISMATCH`, but long-running gateways, relays, client
imports, readiness receipts, and binaries often retain different artifact cuts.
Recovery becomes restarting several processes in the right order. A
documentation-only `@ref` edit can rotate function identity even though no
executable behavior changed.

The same systems also expose multiple green/non-green concepts: host ready,
application ready, verification profile registered, product acceptance passed,
D1-complete proof absent, or harness incomplete. Each distinction is honest,
but the first screen often does not state which layer failed and who owns the
next move.

The desired improvement is not softer identity. It is semantic identity plus
generation custody: incompatible changes must still fail; compatible reloads
should be automatic at explicit boundaries; evidence-only changes should update
review provenance without forcing state rollover; and all tools should report
one closed classification.

## Constraints

- Rust-owned artifact schemas and generated consumers remain under LLP 0037’s
  single-source-of-truth discipline.
- A generated ref never silently retargets an in-flight query, live resume,
  queued mutation, task, auth exchange, or settlement to new semantics
  (LLP 0108; LLP 0043).
- Readiness is layered. Host ready and application ready remain distinct, and
  an application receipt binds the exact activation target (LLP 0224).
- Reviews and claims bind semantic content, not ambient HEAD; normal `main`
  motion does not force re-review or complete-proof-at-commit loops
  (LLP 0189#d-5-reviews-bind-content-not-head).
- Generated facts are produced once or parity-gated; the envelope cannot become
  another hand-maintained inventory (LLP 0203#p1-generated-or-gated-never-transcribed).
- Old incompatible artifacts remain fail-closed. Automatic reload is never
  permission to discard identity from requests or retained records.

## Decision

### D1. Split identity by what changed

Every generated application cut carries four domain-separated content
identities plus one unique cut identity:

1. **`semanticId`** — public contracts and behavior-relevant declarations:
   schema logical contracts, operation kind/args/result, executable canonical
   AST/IR, authority, reads/writes/effects/capabilities, routes, asset/membership
   policy, migration/retention semantics, and target profile.
2. **`executableId`** — exact runtime bytes and toolchain/admission/runtime
   profile versions. It can differ across targets while mapping to one semantic
   identity only when the conformance contract says their behavior is
   equivalent.
3. **`evidenceId`** — source custody and review provenance: original file bytes,
   source maps/spans, comments, documentation/JSDoc, `@ref` annotations, guide
   links, and generation logs.
4. **`bundleId`** — the complete installable/publication closure: semantic and
   executable artifacts, evidence/index artifacts, schemas, generated clients,
   package versions, and integrity manifests.
5. **`generationId`** — a domain-separated Merkle root over `semanticId`, the
   target-keyed executable-id set, `evidenceId`, `bundleId`, app/data/target
   identity, and generation-schema version. It uniquely addresses one immutable
   cut; `semanticId` is a comparison/index field and never a directory key by
   itself.

The canonicalization rules are explicit and golden-tested. In particular,
comments, formatting, absolute checkout paths, diagnostic spans, source maps,
and `@ref` prose do not enter `semanticId` or `executableId`; they do enter
`evidenceId`, `bundleId`, and therefore `generationId`. In contrast, every
normalized root-relative executable module target and graph edge is a semantic
and executable input under LLP 0237. Moving a helper rotates those identities
whenever the canonical graph record changes. A relocation is evidence-only only
when both the canonical executable graph and final executable bytes remain
byte-identical; v1 performs no broader “same body” equivalence inference.

Runtime bytes physically exclude source maps and local source URLs. Those live
only in evidence members, so an evidence-only cut cannot accidentally change
`executableId` through embedded development paths.

Generated operation refs continue to carry stable operation id plus the
contract/semantic identity required by their compatibility policy. Exact replay
and live resume retain exact execution/generation fences. This split does not
weaken stale-ref protection; it stops review-only bytes from masquerading as
behavior changes.

### D2. One application generation envelope

Codegen atomically emits a content-addressed `ApplicationGenerationV1`:

```text
.snapback/generations/<generationId>/
  generation.json
  semantic-diff.json
  schema/
  functions/
  clients/
  guide-index/
  evidence/
  integrity.json
```

The envelope lists:

- all five identities and predecessor generation id;
- app/data/target identity;
- artifact members and hashes;
- supported compatibility ranges;
- required migrations and activation obligations;
- authority/capability changes;
- generated-client impact;
- retention/outbox/live-resume dispositions;
- reload class; and
- exact next operations.

Generation writes into a new directory, verifies the complete graph, and only
then makes it eligible. A failed candidate never mutates the previous envelope
or current pointer.

`semanticId` is an application-wide Merkle root over independently identified
schema, operation, policy, query-plan, retention, and client subgraphs.
Activation remains atomic at the complete `generationId` cut; sub-identities
improve diffing and receipts but are not independently current.

### D3. Semantic diff assigns a closed reload class

The generator extends LLP 0146’s semantic change-impact work and LLP 0081’s
migration derivation. The authoritative result is a closed disposition for
every affected consumer plus the complete prerequisite set. Each disposition
uses this ordered vocabulary:

1. **`evidence-only`** — semantic and executable ids unchanged; evidence/bundle
   changed. Runtime, clients, state, and live subscriptions need no rollover.
2. **`client-reload-compatible`** — generated client bytes changed while every
   v1 public contract hash remains exact. Idle consumers reload; current server
   generation may remain. Contract widening is not automatically compatible in
   v1; it is `incompatible-manual` until old/new decoder vectors earn a later
   versioned rule.
3. **`server-reload-compatible`** — semantic identity changes without data
   migration or authority/retention invalidation; server can atomically install
   successor while new invocations bind to it.
4. **`reauthorize-resnapshot`** — authority, visibility, retention, or result
   membership semantics changed; affected clients must cross a fresh authority
   and snapshot barrier before successor values release.
5. **`migration-required`** — LLP 0081 plan/activation must settle before the
   generation is current.
6. **`restart-required`** — runtime capability, native executable, target
   profile, or non-hot-reloadable route/lifecycle change requires a prepared
   restart and fresh readiness receipt.
7. **`incompatible-manual`** — semantics cannot be safely derived; generation is
   built for inspection but cannot activate until a named operator decision.

The per-consumer map is authoritative. A schema addition may be
`server-reload-compatible` for the server and `client-reload-compatible` for a
generated module; an authority change is `reauthorize-resnapshot` for affected
scopes only when completeness is proved, otherwise conservatively all.

For one first-line summary, tools reduce with the fixed total order shown above
(`evidence-only` least restrictive through `incompatible-manual` most
restrictive) and report the maximum. That label is display-only: activation is
the conjunction of every consumer disposition and every `next[]` prerequisite,
so a maximum cannot hide an incomparable migration, restart, reload, or
reauthorization obligation. Unknown combinations reduce to
`incompatible-manual`.

The result is generated from authoritative schemas/manifests and checked
against runtime admission. It is not a prose changelog.

### D4. One atomic current-generation pointer

The application owner maintains:

```text
.snapback/current-generation.json
```

It is an atomically replaced, owner-only pointer/receipt containing the active
generation, semantic, executable-set, evidence, and bundle ids, startup nonce,
server generation nonce, data identity, target profile, application-readiness
receipt digest, and activation time. The server’s authenticated inspection is
the authority; the file is its local projection, following LLP 0224’s receipt
discipline.

Activation uses a pre-pointer candidate/readiness protocol:

1. the watcher builds and verifies an immutable candidate envelope;
2. server preview validates it and returns the authoritative per-consumer
   dispositions; migrations and manual decisions settle first. The server then
   issues `ActivationCandidateV1`, naming candidate and expected predecessor
   generation ids, activation nonce, a non-extendable deadline exactly 60
   seconds after issuance, and a fixed required-custodian roster;
3. each required custodian stages the exact candidate without exposing it,
   pauses predecessor admissions, drains its predecessor owners, and issues a
   leased readiness acknowledgement bound to candidate, predecessor, nonce,
   process instance, staged hash, and zero remaining owners;
4. the server activation transaction refuses unless the complete exact roster
   has live, unexpired positive acknowledgements, then atomically makes the
   complete generation current and issues its exact readiness receipt. That
   commit is the global activation linearization point; and
5. the application owner compare-and-swaps the pointer from the expected
   predecessor using that authenticated positive fact. Prepared custodians
   expose and admit the successor only after observing the same fact.

There is never a time when the pointer names a half-installed schema/functions/
client graph. Evidence-only regeneration may update the bundle/evidence pointer
and `generationId` without changing the server’s semantic generation nonce or
readiness nonce. Its candidate has an empty runtime roster but still requires
server validation before the pointer update. The application owner is the only
file writer; a watcher never writes the projection independently.

### D5. Custodians reload only at safe boundaries

First-party long-running consumers use a shared `GenerationWatcher`:

- generated module loader;
- dev gateway and browser relay;
- Metro/supervisor carrier;
- headless client and React/Expo provider;
- app CLI/MCP control process; and
- acceptance harness.

The watcher receives the server-issued candidate fact, then the authenticated
served-generation fact. It stages during preparation and swaps only after
commit at a safe boundary:

- between HTTP requests or host operations;
- between client dispatches/subscription constructions;
- after in-flight invocation/task ownership is generation-fenced;
- after authority/resnapshot disposition when required; and
- never by mutating an imported namespace object in place.

The required roster is the server runtime plus every registered, live,
first-party custodian affected by the candidate's per-consumer map. An inactive
process is not silently counted ready: before later admission it must load the
then-current generation. Registrations arriving after roster freeze remain
admissionless until the candidate commits or aborts.

Automatic reload has one bounded v1 prepare/retirement contract per custodian:

- at most two executable object graphs are resident (`current` plus one staged
  successor), with at most 64 MiB total; a target may narrow these limits but
  cannot advertise automatic reload without room for both;
- every request/invocation owner is counted by generation. Preparation pauses
  new predecessor admissions and permits at most 60 seconds to reach zero
  owners; a custodian remains quiesced after acknowledging until commit/abort;
- no third graph is loaded and a newer candidate waits on disk until this one
  commits or aborts;
- a byte-limit refusal, crash/expired acknowledgement, or nonzero owner at the
  deadline is a negative `restart-required` response with exact blocking facts.
  The coordinator aborts automatic activation, invalidates all acknowledgements,
  leaves server and pointer on the predecessor, and only then lets custodians
  discard the staged graph and resume predecessor admissions. A controlled
  restart may instead become ready under the same candidate before its deadline;
  there is no retargeting or silent cancellation; and
- LLP 0180/0239 client command tasks do not pin server executable memory between
  their independently settled upload and mutation invocations. Any process-local
  operation that truly retains executable code is an owner subject to the same
  lease.

Queued mutation, settlement, live resume, and task records keep their original
exact generation ids; the watcher cannot rewrite them. Durable identity does
not imply indefinite resident code. After retirement, replay/reconciliation
uses an explicitly installed compatible artifact or returns the existing typed
stale-generation/manual disposition; it never resurrects or retargets code
implicitly.

Before the server commit, a coordinator crash leaves the predecessor current;
recovery may resume only the same nonce before its deadline after revalidating
every live acknowledgement, otherwise it aborts as above. A custodian crash
invalidates its process-bound acknowledgement. After the server commit, the
successor is authoritative even if the application owner crashes before the
file CAS: recovery repairs the stale pointer from authenticated inspection. A
restarting custodian must load the successor or refuse new work with
`SNAPBACK_GENERATION_RELOAD_REQUIRED`; it never resumes predecessor admissions.

Third-party consumers can subscribe to the same generation event or poll a
documented endpoint/file; they are not readiness acknowledgers. Every
non-evidence generation carries `staleAfterMs` (default 60 seconds, five-minute
hard maximum; zero for security-critical changes) and its refusal as a surfaced
compatibility fact. This deadline starts only at the server activation commit,
never at candidate publication. Before its absolute expiry an old-generation
admission is permitted only by its generated compatibility disposition; at and
after expiry both server and consumer refuse new predecessor work. Zero means
immediate post-commit refusal, while required first-party custodians—including
every reachable owned custodian for a security-critical cut—must already be
quiesced and ready before that commit. In-flight work remains generation-fenced
and follows its existing outcome contract; it is not silently cancelled.

### D6. Development commands share one recovery model

`snapback dev`, `snapback start --release`, `snapback doctor`,
`snapback wait`, generated app CLI, and MCP expose the same structured
`generationStatus`:

```text
current | building | activating | waiting-migration |
waiting-reauthorization | restart-required | stale-consumer |
application-failed | platform-failed | evidence-incomplete |
instrument-incomplete
```

Each status carries owner, current/candidate identities, affected consumers,
blocking facts, and a bounded ordered `next[]`. The commands are projections
over server/generator facts, not separate diagnoses.

`snapback dev` makes the common path boring:

- starts the backend and declared client carriers;
- waits for application readiness, not merely host bind;
- watches source and produces complete generations;
- activates compatible cuts;
- reloads first-party custodians;
- prints one settled summary; and
- tears down all owned processes/receipts deterministically.

For Expo/Metro, the scaffold or supervisor-owned Metro composition excludes
mutable `.snapback/` state (SQLite database, WAL/SHM, telemetry, readiness,
leases, and transient receipts) from the application source watch graph. It
continues to watch authored Snapback sources and generated client modules whose
semantic cut can affect the bundle. A target where Metro cannot express that
partition relocates mutable runtime state outside the watched project root.
Runtime-state churn is never treated as an authored generation input.

Detached/physical-device development continues to use supervisor rendezvous and
binding receipts from LLP 0223; this RFC adds generation identity/reload to the
same carrier rather than writing ambient `.env` state.

### D7. First summary line states the failure domain

Every dev/doctor/wait/verify result begins with one closed outcome class:

- **`APP_FAILED`** — the application or its declared acceptance failed;
- **`PLATFORM_FAILED`** — Snapback runtime/transport/tooling failed;
- **`STALE_GENERATION`** — independently valid custodians disagree on the
  required generation;
- **`MISSING_EVIDENCE`** — the requested claim lacks a registered/runnable
  evidence profile;
- **`INSTRUMENT_INCOMPLETE`** — the harness cannot produce the requested
  verdict; or
- **`PASSED` / `PASSED_WITHOUT_ACCEPTANCE`** — per existing honesty rules.

Subresults retain detailed codes. The first class answers “who must act?” before
an author reads logs. An application test that passes while D1-complete evidence
is unregistered is `PASSED_WITHOUT_ACCEPTANCE`, not APP_FAILED. A structurally
unreachable choreography is INSTRUMENT_INCOMPLETE, not application failure.

### D8. Verification binds the semantic inputs it claims

Application verification receipts bind semantic generation, executable target,
unique `generationId`, data/authority/seed identity, test bytes, and relevant
evidence-profile bytes.
Evidence-only source/guide edits do not invalidate a runtime behavior receipt,
but they do rotate documentation/review evidence and may require their own guide
checks. LLP 0189 claim scopes and drift gates continue to decide which inputs a
published claim must requalify.

The generation envelope exposes a claim-relevant closure so verification does
not guess from file categories. This RFC does not reintroduce complete proof at
exact HEAD; affected verification lands promptly, and the scheduled battery
owns corpus completeness.

## Compatibility and migration

Current monolithic hashes remain accepted as `legacy-exact` identities. During
the transition, codegen emits both legacy and all five split identities and
proves:

- any semantic/executable change rotates the legacy hash and the appropriate
  new hash;
- evidence-only changes rotate legacy/evidence/bundle but not semantic or
  executable; and
- no current request/settlement/live-resume safety check becomes weaker under
  the new carrier.

Servers and clients negotiate the split-identity capability. A new client never
drops identity when speaking to an old server; it uses legacy exact policy. An
old client talking to a new server continues on the legacy lane until its normal
stale-ref boundary.

Generated modules that cannot be safely hot-reloaded remain restart-required.
The rollout earns automatic reload consumer by consumer; no global flag claims
more custody than has been proved.

## Alternatives considered

### Keep exact byte identity and restart everything automatically

Declined. It preserves safety but makes comments/docs ordinary runtime events,
forces unnecessary state rollover, and still leaves multiple processes with no
shared safe boundary.

### Ignore identity mismatches in dev

Declined. Dev is where agents build their mental model and acceptance evidence.
Permissive drift would recreate mysterious partial behavior and make day-two
evolution less trustworthy.

### Use filesystem mtimes/watch events as generation identity

Declined. They are hints, not semantic or integrity facts, and fail across
copying, packaging, processes, and clocks.

### Put every source/evidence byte into semantic identity

Declined. That is effectively today’s lifecycle tax and confuses review
provenance with behavior compatibility. Evidence remains content-addressed and
bound in the bundle.

### Hot-reload every change in place

Declined. Migrations, authority, retained data, native runtime, and in-flight
work need explicit barriers or restart. The closed reload classes preserve those
boundaries.

## Rollout

1. **Identity audit and dual emission.** Define canonical inputs/golden vectors;
   emit split ids and uniquely addressed immutable envelopes beside legacy exact
   ids, using the stable identities that already exist; no automatic activation.
2. **Generation envelope and semantic diff.** Make codegen output immutable
   envelopes and closed reload classifications; keep activation manual.
3. **Server authority and pointer.** Add preview/activate/readiness facts and the
   atomic local pointer projection.
4. **Subsystem identity enrollment.** As LLP 0237/0240/0242/0243 artifacts
   land, add their versioned identities to the Merkle cut without making their
   safety depend on a watcher.
5. **Custodian watcher.** Use the generated-module loader as the reference;
   prove retirement accounting, then integrate gateway/relay, app CLI, and
   acceptance harness, and only then client/provider.
6. **Unified status/recovery.** Rebase dev/doctor/wait/verify summaries on the
   generation fact and outcome grammar.
7. **Evidence-only activation.** Enable no-runtime-rollover behavior only after
   a corpus proves comment/format/`@ref` edits cannot alter executable semantics
   across every handler form and target.
8. **Published npm rerun.** Exercise a schema addition, helper behavior change,
   authority change, comment-only edit, runtime-package change, and stale relay
   from a fresh external app.

## Acceptance

- A comment, formatting, guide link, `@ref`, absolute checkout path, or source
  span edit changes evidence/bundle/generation identity but not semantic or
  executable identity, runtime generation nonce, data, live subscription, or
  queued mutation custody. A helper move that changes a normalized graph edge
  rotates semantic/executable identity.
- A handler/helper semantic change rotates operation/application semantic and
  executable identity and reloads between invocations without retargeting
  in-flight work.
- An authority change cannot release successor values until reauthorization and
  fresh snapshot; protected retained views follow their purge disposition.
- A migration-required or native-runtime change never hot-activates; the
  generated next command settles the prerequisite and produces a fresh
  application-readiness receipt.
- Killing a gateway/relay during staging and restarting it converges to either
  the complete predecessor or successor, never a mixed graph.
- Evidence-only cuts receive distinct `generationId` directories and can roll
  back independently without overwriting a prior evidence cut.
- A stuck current owner cannot create a third resident generation: after
  the drain lease the candidate becomes restart-required with no retargeting or
  unreported cancellation.
- An intentionally stale third-party consumer receives a typed refusal with
  current/candidate ids and recovery, not partial success.
- Dev, doctor, wait, app CLI, MCP, and verify agree on current generation and
  first-line outcome class in a parity fixture.
- `PASSED_WITHOUT_ACCEPTANCE`, app failure, platform failure, stale generation,
  and instrument incompleteness are independently reproducible and never
  collapse into one green/red state.
- Legacy client/server skew retains exact safety through the negotiation period.
- With a running local database producing WAL/readiness/telemetry churn, an
  otherwise idle Expo app performs zero Metro rebuilds in ten minutes; one
  authored client or generated-module change still causes exactly the expected
  rebuild and converges to the current generation.

## Risks

- Incorrect semantic canonicalization can create a false compatible reload.
  Dual emission, exact executable-byte binding, target conformance, and a long
  shadow period are mandatory before evidence-only activation.
- Keeping predecessor objects alive can leak resources. The fixed v1
  generation/byte/time limits trade automatic activation for a typed restart
  whenever draining cannot satisfy them.
- A single dev command can hide architecture needed for diagnosis. The full
  generation/status facts remain inspectable; the golden path reduces startup
  lore, not observability.
- Per-consumer dispositions can become complex. The reload-class vocabulary is
  closed and generated; unknown combinations fall to incompatible-manual.
- Bundle identity still rotates for docs/evidence, which can affect publication
  closures. LLP 0189 scope rules decide whether that is claim-relevant rather
  than semantic runtime identity pretending to decide it.

## Open questions

1. Should the current-generation pointer be local-file-only plus authenticated
   inspect, or also have a connection-pushed event for remote/hosted consumers?

## Status

Accepted. This RFC requests author decisions on split identity, reload classes,
and generation custody. It chooses a unique `generationId`, conservative graph
identity, exact-contract-only v1 reload compatibility, and bounded retirement;
legacy exact identity remains until a shadow corpus proves the split cannot
admit incompatible behavior.
