# LLP 0087: Riding Facets — staged adoption of dynamic per-app code on the hosted target

**Type:** Plan
**Status:** Draft
**Systems:** Deployment, Runtime, Storage, Security, Developer experience
**Author:** Charlie Cheever / Claude
**Date:** 2026-07-23
**Revised:** 2026-08-03 (parked pending EAS Phase 0 results; author decision sitting #2, `issues/20260803-author-decision-sitting-2.md` — see §Status); 2026-07-25 (Phase 0 progress reconciled to the signed v2 probe list without advancing Gate 0); 2026-07-23 (round-1 multi-family review: Gate 0 restated as a checklist; Miniflare sequencing pinned; LLP 0014 storage invariant pinned across topologies; authority boundaries corrected; Gate 2 split into entry/exit; artifact-security workstream added; concurrent spike progress note integrated. Round-2: trusted-code posture pinned; Gate 0 receipt named and adversarial two-app leg added; Gate 1 remote runners corrected; Phase 1 fixture-only artifact store; Phase 2 prerequisites extended to LLP 0060/0019 and fallback repointed off the handler op table; Gate 2 entry made conjunctive)
**Related:** LLP 0007, LLP 0009, LLP 0010, LLP 0011, LLP 0014, LLP 0018, LLP 0019, LLP 0024, LLP 0033, LLP 0040, LLP 0047, LLP 0048, LLP 0049, LLP 0060, LLP 0070, LLP 0083, LLP 0086, ENG-25387, https://developers.cloudflare.com/dynamic-workers/usage/durable-object-facets/

## Summary

This plan's end state is **full adoption of Cloudflare's Worker Loader +
Durable Object Facets as the hosted per-app substrate**: one deployed
Snapback platform, app code stored as data and loaded at runtime into a
per-app facet with its own isolated SQLite database, so that creating or
updating an app on Cloudflare becomes the same kind of operation it is on
the local target — a data operation, not a wrangler deploy cycle.

The end state is a target, not a commitment. Facets shipped as a beta
primitive ([LLP 0083](./0083-cloudflare-do-d1-prior-art.research.md)
§Dynamic Workers; the Phase 0 progress note below reports current docs now
carry no beta caveats — GA status is to be confirmed, and the plan's
caution stands until it is), and the load-bearing questions about it —
isolation adequacy, per-facet storage semantics, economics, lifecycle
behavior, and local-dev parity — were all unmeasured when this plan was
written; the Phase 0 spike has begun answering them locally. The plan
moves in phases, each behind an explicit gate, and **every gate is allowed
to kill or reshape the plan** — the staged structure is how Snapback rides
the wave without wiping out on a beta. This elaborates work item CC-2 of
[LLP 0086](./0086-prior-art-course-corrections.plan.md); CC-2's spike is
Phase 0 here.

Ratification posture, stated precisely because this plan touches ratified
one-way doors ([LLP 0014](./0014-cloudflare-strategy.rfc.md) §One-way
doors):

- **Door 1 — rows live with the version authority — is not touched.** All
  topology candidates in this plan keep app rows, the version counter, the
  change journal, outbox and cron state, and subscription state in the
  coordinator DO's SQLite, committed in one `transactionSync`. Facet-local
  SQLite is scratch and role-local state only, and facets reach app data
  exclusively through the existing async host-operation seam (door 3).
  Moving app-data ownership into a facet is **not a candidate here**; it
  would be a separate re-ratification of LLP 0014 with its own
  atomic-commit evidence, which this plan does not propose.
- **Door 2 — bundle loading is deploy-time, never runtime `eval` — is the
  door this plan exists to re-examine.** LLP 0014's premise-change
  annotation (2026-07-23) records that the door was pinned when the
  platform offered no runtime code loading; Worker Loader and facets
  change the premise, not the decision, which stands until this plan's
  Gate 0 evidence supports re-ratifying or reaffirming it. Adoption
  (Phase 1 entry and beyond) requires that re-ratification in LLP 0014,
  not just a gate pass here.
- LLP 0014's everything-on-Durable-Objects resolution is unchanged —
  facets *are* DOs. What changes, if the gates pass, is how per-app code
  reaches them.
- **Facet-hosted code remains trusted code under LLP 0014's current
  posture.** This plan changes how operator-supplied app code is
  delivered, not who is trusted to supply it. Hosted *untrusted*
  multi-tenant code remains gated by LLP 0009/0047's `Enforced`-limits
  requirements and LLP 0014's Phase 3 (Workers for Platforms) assignment,
  and is not claimed here; if Gate 0 evidence suggests facets could
  replace WfP for untrusted tenants, that is a separate LLP 0014 decision,
  not an output of this plan.

## Motivation

Today's hosted model ([LLP 0040](./0040-cloudflare-narrow-proof.rfc.md);
`targets/cloudflare/`) compiles each app's bundle into its deployed Workers at
build time (the `snapback-app` esbuild alias) across two or three per-app
services — gateway and handler isolate for the notes proof; All Aboard
adds the third, a separate action handler
(`wrangler.all-aboard.action-handler.jsonc`), so that a slow action fetch
never queues transactional invocations. Consequences:

- **App creation and code update are deploy-tooling operations.** An agent
  or platform API cannot create a hosted app without a wrangler cycle;
  the local target's apps-are-data model has no hosted counterpart. This
  blocks the full value of the agent provisioning surface (LLP 0086 CC-1).
- **The control plane scales linearly in deployed services** — two or
  three Worker services and as many configs per app.
- **The platform is commoditizing the alternative.** Facets productize
  exactly the "tenant code next to its own isolated SQLite" pattern
  Snapback hand-builds; Dynamic Workflows extends it to durable execution.
  Anyone can now build per-tenant backend hosting on these primitives —
  Snapback's differentiation must live in semantics (schema'd live
  queries, permission-checked server-authoritative sync, the acceptance
  surface), and its mechanism should ride the commodity rather than
  compete with it. [LLP 0083 §Synthesis 2]

## Target architecture (end state, shape to be chosen at Gate 0)

One deployed Snapback platform: the gateway Worker plus per-app coordinator
DOs as today, with per-app handler code loaded at runtime. Three candidate
topologies, deliberately not chosen before the spike. All three obey the
storage invariant above (app data stays in the coordinator; facet SQLite is
role-local only):

- **A. Facet family:** the coordinator DO hosts child facets for the
  handler and action-handler roles; each facet gets its own SQLite for
  role-local state; the coordinator remains the version authority and
  journal owner.
- **B. Loader-only:** the handler and action-handler remain separately
  deployed Worker services (preserving today's deliberate isolation split
  — a slow action fetch must never block the coordinator), but their app
  bundle is loaded at runtime via Worker Loader instead of compiled in at
  deploy time. Note: for the end state to deliver the one-platform control
  plane, these become *shared platform* services loading per-app code, not
  per-app deployments; if they must stay per-app, topology B fails the
  plan's motivation and only removes the build step. Conversely, if
  shared services cannot provide per-app termination and queue isolation,
  topology B is not a legitimate end state either — Gate 0's adversarial
  leg tests exactly this.
- **C. Hybrid:** handler as a coordinator facet (hot path, colocated),
  action handler as a loader-fed shared service (egress-gated, blockable
  without harm).

App code becomes a stored, versioned artifact (content-hash identity,
extending the existing `deployment-identity` machinery), registered in the
platform registry DO that [LLP 0014](./0014-cloudflare-strategy.rfc.md)
§Resolution already ratifies as the control plane. App create/update
becomes a control-plane API call — see Phase 2 for whose contract that is
(it is not LLP 0024's today; 0024 explicitly does not own hosted project
lifecycle).

## Phases and gates

Authorization note: under LLP 0086 CC-2's decision gate ("no hosted
rearchitecture starts while facets are beta — the spike buys information,
not commitment"), only Phase 0 is authorized today. Phase 1 entry requires
(a) LLP 0014 re-ratifying one-way door 2 per its premise-change
annotation, and (b) amending LLP 0086 CC-2 to authorize a non-production
dual-track profile (or, if GA is confirmed, recording that the beta
prohibition no longer binds). Both are recorded decisions by their owning
documents, not gate passes here.

### Phase 0 — truth and spike (now)

> **Progress note (2026-07-23, same day):** step 1 is done — the ENG-25387
> LLP 0014 refresh landed. The spike has its first results
> (`targets/cloudflare/spike-facets/`): Worker Loader and facets **work under the
> pinned Miniflare/workerd** (lockfile-resolved miniflare 4.20260706.0 /
> workerd 1.20260707.1 on Node 24.18.0 — recorded as resolved versions,
> not `package.json` specifiers, so the claim stays evaluable if the
> resolution moves), with per-facet
> SQLite isolation, documented abort/delete lifecycle behavior, and
> deny-by-default egress via `globalOutbound: null` all verified locally.
> Two research updates: Dynamic Workers now has **published pricing with
> billing since 2026-05-26** ($0.002/dynamic-worker/day beyond 1,000/month,
> standard request/CPU rates, paid plans only), and the current docs carry
> **no beta caveats** — GA status should be confirmed, which would soften
> Gate 2. Still open for Gate 0: the LLP 0009 isolation review, real-platform
> measurements (cold start, hibernation, alarms/PITR per facet, metered
> billing), and facet class migration semantics.
>
> **Progress note (2026-07-23, later same day; reconciled 2026-07-25):**
> the Phase 0 reconnaissance instruments now exist:
> `targets/cloudflare/spike-facets/harness.mjs` exercises partial, explicitly
> non-gating shapes of P1/P2/P3/P4/P5/P7/P8 across A/B/C and the compiled-in
> baseline, while `targets/cloudflare/spike-facets/gate0-probe-list.md` v2 defines
> the full P1–P13 suite-level and on-platform criteria. Local reconnaissance
> observed green partial shapes for P1/P2/P3/P5/P8 in all three candidates
> (including roughly 4–7 ms query p95 during a 1.5 s slow action), but those
> results validate the instrument only and discharge no Gate 0 probe. P4
> contention is not locally answerable: app 2 starved during app 1's CPU spin
> in every topology, including the compiled-in control, so the authoritative
> contention leg remains on-platform.
>
> The LLP 0009 pre-leg review is now complete: the recorded round-2 review
> approved the v2 probe list with no required or advisory changes, so the
> suite-level isolation leg may run. Gate 0 remains open pending that leg,
> the on-platform measurements, the post-leg results review, and the other
> lifecycle/economics findings enumerated below. No topology is selected and
> no Phase 1 authorization follows from this progress.

1. Land the ENG-25387 [LLP 0014](./0014-cloudflare-strategy.rfc.md)
   platform-fact refresh (dynamic code loading exists; storage billing
   live; write/read price asymmetry into the cost model). **Done** per the
   progress note.
   1b. **Pending follow-up:** fold the progress note's 2026-05-26 Dynamic
   Workers pricing and the GA-status finding into LLP 0014's platform
   facts with dated provenance — LLP 0014 still describes Loader/Facets
   as beta. No external platform-status claim (GA in particular) affects
   a gate until it is recorded there. Complete when LLP 0014's Dynamic
   Workers facts carry the pricing table and a dated GA determination.
2. Time-boxed spike: run one existing proof app under each viable
   topology candidate, behind the existing acceptance suites. The notes
   app covers the base legs (isolation, storage, economics, lifecycle);
   the coordinator/action-separation leg runs on the All Aboard profile —
   or on notes with an action-handler config added for the spike — because
   notes as deployed has no action handler to preserve (only All Aboard
   carries the separate action-handler service). Measure:
   - **Isolation** ([LLP 0009](./0009-code-execution-security.rfc.md)
     review): what a facet isolates; whether the binding envelope can be
     restricted to exactly the one `HOST` service binding the compiled-in
     handler receives today, and nothing else; whether a facet is a
     per-invocation kill domain or a long-lived isolate whose global state
     persists across invocations; whether ambient-denial and egress gates
     ([LLP 0047](./0047-hosted-execution-limits.rfc.md)-adjacent probes in
     the current suite) hold inside a facet; whether the
     coordinator/action separation survives topology A; CPU/memory
     attribution between supervisor and facet (the spike README's own
     open item); and a **two-app adversarial leg** — two apps loaded
     simultaneously under the candidate topology, probing global-state
     separation, loader-name collisions, artifact/cache confusion,
     cross-app binding attempts, and noisy-neighbor resource contention
     — the contention probe's pass rule (a threshold, or a judgment
     delegated to the LLP 0009 reviewer's pre-signed probe list) is fixed
     before the leg runs and recorded in the comparison artifact.
     (LLP 0018's matrix proves correctness against bugs and accidents,
     not adversarial isolation; the adversarial claim is LLP 0009's and
     must be tested at topology-selection time, not deferred to Phase 2.
     This leg is defense-in-depth for shared *trusted* operator code; it
     does not graduate hosted untrusted code — see Ratification posture.)
   - **Storage semantics per facet:** SQLite limits, PITR/bookmarks,
     alarms, and hibernation for the facet's *role-local* state (app data
     stays in the coordinator per the invariant above); confirm the
     coordinator's own contract primitives — the one-`transactionSync`
     version+rows+journal commit, the single-alarm dispatcher, PITR
     bookmarks — are unaffected by hosting facets.
   - **Economics:** cold-start delta from runtime loading; how facet
     duration and storage are actually billed (measure against the
     published 2026-05-26 pricing; do not assume); maximum loadable
     bundle size via Worker Loader.
   - **Lifecycle:** facet class versioning against the `exports`
     migration model and its no-gradual-deploy constraint; code-update
     skew between gateway, coordinator, and facet, including old and new
     app-artifact versions coexisting with the coordinator's schema and
     host-op protocol versions during rollback; the DO class/state
     transfer path for later consolidating today's per-app Workers into
     one platform script (the end state moves each app's coordinator DO
     namespace out of its per-app gateway Worker — name the mechanism,
     script-transfer migration vs. export/import through the journal,
     because Phase 2's rollback rehearsal must cover it).
   - **Local-dev parity:** whether Miniflare/`workerd` support Worker
     Loader and facets. The entire local proof
     (`targets/cloudflare/test/local-suite.mjs`, 21 manifest checks: 20 gate
     suites plus the compatibility check, per
     `targets/cloudflare/test/local-suite-manifest.mjs`) runs on Miniflare —
     **no Miniflare support, no adoption.** (The progress note reports
     this answered locally: works under the pinned Miniflare/workerd.
     Gate 0 still requires it demonstrated on the suite harness itself,
     not only in the spike sandbox.)

**Gate 0 (go/reshape/kill)** — a checklist, evaluated per topology, its
findings recorded as a machine-readable comparison artifact —
`targets/cloudflare/generated/gate0-facets-comparison.json`, one row per topology
(A, B, C), each row carrying: repo SHA, toolchain identity
(lockfile-resolved Node/Miniflare/workerd versions, compatibility date,
recorded automatically rather than transcribed), the commands run,
per-probe results, latency and cost numbers against the budgets below,
lifecycle findings, and an enumerated outcome `pass | reshape | kill |
not-viable` (with `selectedTopology: null` permitted when the overall
result is kill) — plus prose findings in LLP 0014:

1. *Isolation:* the ambient-denial and slow-action-non-blocking probes
   (the `acceptance.egress.mjs` behaviors: no ambient fetch from app code;
   a deliberately slow action fetch blocks no concurrent query, mutation,
   or live push) pass with app code running under the candidate topology,
   plus the two-app adversarial leg above; the binding envelope is
   restricted to the single `HOST` binding; the LLP 0009 reviewer signs
   off on this probe list *before* the spike's isolation leg runs and on
   the results after. The micro-spike already run
   (`targets/cloudflare/spike-facets/`) is pre-leg reconnaissance: its probes
   inform the probe list but do not discharge (or contaminate) this
   criterion — the reviewer-signed list still precedes the suite-level
   isolation leg on the candidate topologies.
2. *Storage:* the coordinator-contract primitives enumerated above are
   confirmed intact by the existing acceptance suites (the local-suite
   manifest checks plus `acceptance.egress.mjs`) passing with the
   candidate topology hosting the app code — not by inspection alone.
   For facet-local storage the observable is concrete: today the handler
   roles keep no durable role-local state, so the criterion is that
   nothing app-data-shaped appears in facet SQLite, checked by
   inspecting the facet database after a full suite run; if a topology
   introduces genuine role-local state, the receipt names it.
3. *Economics (budgets frozen before measurement; changing them after
   observing results requires a pre-measurement amendment recorded in
   LLP 0014, not a gate-time re-pin):* cold start defined as
   first-request latency after eviction of the loaded runtime — the
   eviction method must demonstrably discard the facet/loaded worker,
   not just coordinator in-memory state (the coordinator's `/evict` is a
   surrogate to be validated, not assumed) — p95 over ≥ 30 samples per
   topology, measured from the same location in the same session as the
   compiled-in baseline; budget: candidate p95 ≤ 2× baseline p95 and
   absolute delta ≤ 250 ms. Cost measured over one calendar UTC billing
   day per profile with a defined activity shape — acceptance-suite runs
   at a fixed cadence plus measured idle, reusing the existing
   billing-window methodology (`targets/cloudflare/test/billing-windows.mjs`,
   `validate-idle-measurement.mjs`) — with the counted meters enumerated
   in the receipt; budget: ≤ 1.5× the deploy-time profile's cost on the
   same workload shape and window.
4. *Local-dev parity:* Miniflare support works under the local suite
   harness, **or** a committed path exists in the form of a citable
   Cloudflare statement (changelog, docs, or direct confirmation with a
   named contact), with an owner and a check-back date recorded. A
   committed path passes Gate 0 only; **Phase 1 cannot start, and Gate 1
   cannot pass, without working Miniflare support**, since Gate 1 is
   defined over the Miniflare-based local suite. This is the precise form
   of "no Miniflare support, no adoption."

Output: topology chosen; findings and the door-2 re-ratification (or
reaffirmation) recorded in LLP 0014. Failure modes: isolation inadequate →
topology B or kill; Miniflare gap → hold at Phase 0 and watch; economics
outside budget → kill with findings recorded; lifecycle/class-migration
semantics unworkable (no rollback-compatible transfer path) → reshape
(topology B/C) or kill.

### Phase 1 — dual-track profile

Entry requires the two authorization decisions named above (LLP 0014
door-2 re-ratification; LLP 0086 CC-2 amendment or beta-prohibition
discharge) plus working Miniflare support. Build a new **non-production**
target profile (working name `cloudflare-do-sqlite-facets-v1`) running the
chosen topology end to end for one demo app, **alongside** the existing
deploy-time profile:

- app bundle as stored artifact with content-hash identity, held in a
  **deliberately temporary fixture-only store** for this phase: no remote
  publish path exists, content-addressed immutability is proven — the
  proof is the `SNAPBACK_CF_APP_ARTIFACT_HASH_MISMATCH` load-path gate
  exercised against a deliberately corrupted fixture, an enumerated Gate
  1 deliverable — and only the deploy
  credentials that already gate `deploy.sh` may mutate the fixture. The
  durable byte-placement decision (open question 3) is a Phase 2 entry
  decision, not a Phase 1 blocker;
- the runtime load path itself; harness and compatibility-config identity
  stays single-sourced per
  [LLP 0048](./0048-v8-conformance-twin.rfc.md) (0048 owns harness/compat
  single-sourcing, not artifact versioning; the artifact registry owns
  app-code versions). Note the identity-model inversion:
  `deployment-identity` today hashes the bytes compiled into the Worker;
  under this profile it splits into harness identity (the platform
  Workers) plus per-app artifact hashes, and the
  `test/deployment-identity.mjs` drift gate splits accordingly;
- full acceptance parity: every check in
  `targets/cloudflare/test/local-suite-manifest.mjs` *at gate time* (21 as of
  this revision; the manifest is the moving authority, and Phase 1's own
  load-path gates add to it) passes on the facets profile (the twin app,
  `targets/cloudflare/app/twin.app.js`, included), and the remote runners —
  `acceptance.remote.mjs` and `acceptance.remote.all-aboard.mjs`, with
  their required deployment credentials — pass against a deployed
  instance of the profile. No remote egress runner exists today
  (`acceptance.egress.mjs` is a local Miniflare suite), so Phase 1 adds
  one: a remote suite proving ambient denial and slow-action
  non-blocking on the deployed facets profile is itself a Gate 1
  deliverable. Plus new gates for load-path failure modes — missing
  artifact, hash mismatch, loader errors, and provider-side artifact
  deletion/corruption — each with a stable `SNAPBACK_*` code under LLP
  0010's diagnostic-code convention (proposed:
  `SNAPBACK_CF_APP_ARTIFACT_MISSING`,
  `SNAPBACK_CF_APP_ARTIFACT_HASH_MISMATCH`,
  `SNAPBACK_CF_APP_LOADER_FAILED`);
- capability manifest emitted for the new profile; egress and admin
  surfaces verified;
- a **beta-risk register** created as a named section of this LLP at
  Phase 1 start, recording every facets/loader behavior change, outage,
  or API revision encountered, so Gate 1 reviews a document that exists.

**Gate 1:** full suite parity on the facets profile for the demo app (all
manifest checks at gate time; both remote runners green; the new remote
egress suite green); no regression on the existing profile; beta-risk
register reviewed (what broke during Phase 1, how often the primitive
changed under us).

### Phase 2 — apps as data

Prerequisite: the hosted control-plane contract. LLP 0024 explicitly does
not own hosted control planes, tenants, or project lifecycle, so the
create/push-code/roll-back operations need a contract home before they are
exposed: LLP 0086 CC-1's provisioning surface, which requires the LLP
0010/0024 revisions CC-1 already gates on — and those revisions are not
the whole prerequisite set. LLP 0024 itself refuses hosted use pending
LLP 0060's hosted-auth deployment contract and LLP 0019 F8's durable
audit log, and the applicable LLP 0011 service-principal work rides with
them; all of these are Phase 2 entry conditions. If CC-1 stalls in
review, the fallback is a minimal op set on the coordinator's existing
admin-token-gated surface (the `SNAPBACK_ADMIN_TOKEN`-checked
`adminGated`/`adminReadGated` endpoints in `targets/cloudflare/src/coordinator.js`,
forwarded by the gateway) — **never** on the handler↔host op table
(`targets/cloudflare/src/host-ops.js`), which is the door-3 seam app code calls;
control-plane verbs must not ride the seam the loaded code can reach.
The fallback is explicitly marked pre-contract and non-public — meaning,
mechanically: reachable only with the admin token, enabled only on the
non-production facets profile, and absent from the emitted capability
manifest — and still lands behind the full prerequisite set above before
any external exposure.

- App registry: per-app artifact hashes and versions in the platform
  registry DO that LLP 0014 ratifies (this plan does not reopen the
  registry-location decision); artifact *bytes* in the registry DO's
  SQLite only if they fit its caps (2 MB per row/BLOB, 100 KB per
  statement — current app bundles top out around 44 KB
  (`all-aboard.app.js`), but the platform cannot assume that), otherwise
  R2 with the hash as the join key — open question 3, decided at Phase 2
  entry;
- **artifact admission and provenance:** who may publish or roll back an
  app artifact (which principal, authenticated how), immutable provenance
  for each artifact, anti-rollback policy (no silent downgrade to a
  known-vulnerable artifact), and schema/code compatibility checks at
  admission time;
- **multi-app isolation:** the
  [LLP 0018](./0018-app-instance-boundaries.rfc.md) two-app validation
  matrix runs on the facets profile — code/schema isolation, version
  streams, auth, secrets, subscriptions, diagnostics, admin operations,
  reset/seed/import/export, and per-app resource accounting — plus
  per-app concurrency/queue ceilings for shared-platform blast radius
  (the aggregate-fairness gap LLP 0047 names);
- migrate the live deployments (notes proof, All Aboard — coordinate per
  the shared-deployment conventions; All Aboard is a live
  [LLP 0049](./0049-all-aboard-cloudflare-live.plan.md) system), including
  the per-app-Worker → platform-script DO state transfer named in Phase
  0's lifecycle findings;
- operational story: per-facet PITR/bookmarks, observability, and the
  resource-limit and isolation posture per LLP 0018 (0018 has no abuse
  section today; if the abuse posture needs one, that is a flagged 0018
  gap, not silently assumed coverage).

**Gate 2 (entry — before any live migration), all conjunctive:** the
control-plane contract prerequisites above accepted — the CC-1 contract
itself, not the fallback: the fallback is non-production by definition
and cannot authorize live migration (it exists only so Phase 2
development is not blocked on CC-1's review); live migration requires
the accepted contract behind LLP 0010/0024/0060/0019 as stated; the
artifact
admission/provenance/anti-rollback tests passing; the LLP 0018 two-app
matrix receipt on the facets profile; per-app concurrency/queue ceilings
enforced and demonstrated; PITR/observability operational; migration
tooling for the DO state transfer built; **and** Facets GA (possibly
already true — confirm the progress note's no-beta-caveats finding via
step 1b) **or** an explicit, ratified risk acceptance for production use
of the beta by the plan's author (Charlie, matching LLP 0014's
ratification pattern); **and** rollback rehearsed on a non-live
instance, including the DO state-transfer path.

**Gate 2 (exit):** live apps migrated and stable through a defined soak —
14 days of All Aboard traffic with a minimum activity floor (daily
remote-runner executions against the live instance count as soak
traffic, so a quiet demo period cannot pass the soak vacuously) and no
facets-attributable
user-visible failure (attribution: the failure disappears on the
deploy-time profile or implicates the load path/facet runtime in its
diagnostics) and error rates within the pre-migration baseline, captured
as 14 days of All Aboard meters recorded in the Gate 0 comparison
artifact's format before migration — plus one deliberate, successful
rollback exercise on a live app; cost measured on real meters (All
Aboard's) within the Gate 0 budget.

### Phase 3 — full adoption and retirement

Retire the per-app wrangler configs and per-app deploy path; `deploy.sh`
becomes platform-only; LLP 0014 revised to record the new architecture and
this plan moves to Implemented. The old path remains recoverable (git
history plus the dual-track profile kept testable for one release cycle)
until the facets profile has survived a full demo-suite cycle and a
provider-change rehearsal — a documented drill upgrading across two pinned
compatibility dates / runtime versions — without regression. (An actual
platform-churn event satisfies the rehearsal if one occurs first; waiting
for one is not a plannable condition.)

## Risks and mitigations

- **Beta churn** — the primitive changes under us. Mitigation: dual-track
  through Phase 2; the Phase 1 beta-risk register makes the churn rate an
  observed fact; Gate 2 entry requires GA or explicit risk acceptance.
- **Deepened lock-in** — Worker Loader is proprietary; `workerd` parity
  was unknown at planning time ([LLP
  0083](./0083-cloudflare-do-d1-prior-art.research.md) §sharp edges; the
  spike has since verified local workerd support). Mitigation: the
  app-facing contract stays target-agnostic
  ([LLP 0007](./0007-storage-portability.spec.md) posture); the
  stored-artifact + runtime-load *interface* is Snapback's own, so a
  Rivet-shaped or self-hosted backend could implement it later. The
  substrate-lock-in tension is recorded here and in LLP 0014's platform
  facts; [LLP 0033](./0033-license-posture.decision.md) is
  cross-referenced for the openness narrative only (it owns the license
  posture, not substrate choices).
- **Isolation regression** — collapsing services into facets could lose
  the slow-action containment that the separate action handler provides.
  Mitigation: topology B/C exist precisely for this; the Gate 0 isolation
  checklist (slow-action-non-blocking probe, LLP 0009 sign-off) is a hard
  requirement.
- **Artifact-supply risk** — runtime-loaded code makes "who may publish
  code" a live attack surface that the deploy-time model delegated to
  wrangler credentials. Mitigation: the Phase 2
  admission/provenance/anti-rollback workstream is gating, not optional.
- **Migration risk to live systems** — All Aboard is live. Mitigation:
  Gate 2 entry requires rollback rehearsal (including DO state transfer)
  before, not after, migration.

## Non-goals

Dynamic Workflows adoption (assessed separately under
[LLP 0070](./0070-durable-background-work.rfc.md), per LLP 0086 CC-2);
Workers for Platforms; any change to app-facing APIs or authoring surface;
any change to the local target; moving app-data ownership out of the
coordinator DO (see Ratification posture — not a candidate).

## Open questions

1. Topology A, B, or C — Gate 0's evidence-driven output. The author's
   instinct toward C (hot path colocated, egress path separated) is
   recorded here as a pre-registered hypothesis, not a selection prior;
   the Gate 0 write-up in LLP 0014 should say what evidence confirmed or
   overturned it.
2. Is the progress note's local Miniflare/workerd finding confirmed on the
   actual suite harness, and does Cloudflare's no-beta-caveats docs state
   amount to GA? (Gate 0 criterion 4 and Gate 2 entry both turn on the
   answers.)
3. Where do stored-artifact *bytes* live — registry DO SQLite rows
   (bounded by the 2 MB row / 100 KB statement caps) or R2 with the hash
   in the registry? The registry-location decision itself is LLP 0014's
   and is not reopened here; this sub-question is only about the bytes,
   is decided at Phase 2 entry (Phase 1 uses the temporary fixture-only
   store), and its answer must keep the trust boundary
   ([LLP 0009](./0009-code-execution-security.rfc.md)) explicit either
   way.
4. Who owns the Phase 0 spike and what is its time box? (Shared with LLP
   0086 open question 2; needs LLP 0009 review capacity — Gate 0
   criterion 1 requires the reviewer before the spike's isolation leg
   runs. The spike is already underway per the progress note, so this is
   now partly a question of ratifying the de facto owner.)

## Status

Draft. Written 2026-07-23 at the author's direction to chart full adoption
of Facets as the hosted per-app substrate, structured so each phase gate
can reshape or kill the plan while the primitive is beta. Revised same day
through three rounds of multi-family review (see `llp/reviews/0087-*`:
round 1 both NOT READY; rounds 2–3 Fable READY / Codex NOT READY,
narrowing each round). The post-round-3 fixes above — the Gate 2
fallback-contradiction removal, frozen budgets, the billing-day activity
shape, the lockfile-resolved toolchain identity, the contention-rule
pre-registration, the immutability-proof naming, and the soak activity
floor — are applied **unreviewed**; a round 4 would start by checking
them against Codex's round-3 Majors 1–2 and 4. Known open author
decisions (Codex round-3 Major 3): the Phase 0 owner, the LLP 0009
reviewer designation, and the spike time box (open question 4) — Phase 0
can start without them, but Gate 0 cannot complete. The Phase 0 spike
started concurrently and its progress note is folded in above. Phase 0 is
authorized and in flight; Phases 1+ are authorization-gated as stated.
Revise at every gate.

**Parked, 2026-08-03 — author decision sitting #2
(`issues/20260803-author-decision-sitting-2.md`).** This Plan is parked
pending EAS Phase 0 results: Workers-for-Platforms dispatch namespaces
may supersede the DO-Facets primitive as the hosted per-app substrate,
so re-evaluate this Plan when EAS Phase 0 reports. The door-2
re-ratification explicitly waits with it. No owner, reviewer, or timebox
is named by the park; status stays Draft.
