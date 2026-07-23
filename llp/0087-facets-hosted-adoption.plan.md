# LLP 0087: Riding Facets — staged adoption of dynamic per-app code on the hosted target

**Type:** Plan
**Status:** Draft
**Systems:** Deployment, Runtime, Storage, Security, Developer experience
**Author:** Charlie Cheever / Claude
**Date:** 2026-07-23
**Related:** LLP 0009, LLP 0014, LLP 0018, LLP 0024, LLP 0033, LLP 0040, LLP 0047, LLP 0048, LLP 0070, LLP 0083, LLP 0086, ENG-25387, https://developers.cloudflare.com/dynamic-workers/usage/durable-object-facets/

## Summary

This plan's end state is **full adoption of Cloudflare's Worker Loader +
Durable Object Facets as the hosted per-app substrate**: one deployed
Snapback platform, app code stored as data and loaded at runtime into a
per-app facet with its own isolated SQLite database, so that creating or
updating an app on Cloudflare becomes the same kind of operation it is on
the local target — a data operation, not a wrangler deploy cycle.

The end state is a target, not a commitment. Facets is a beta primitive
([LLP 0083](./0083-cloudflare-do-d1-prior-art.research.md) §Dynamic
Workers), and three of the five load-bearing questions about it are
unmeasured. The plan therefore moves in phases, each behind an explicit
gate, and **every gate is allowed to kill or reshape the plan** — the
staged structure is how Snapback rides the wave without wiping out on a
beta. This elaborates work item CC-2 of
[LLP 0086](./0086-prior-art-course-corrections.plan.md); CC-2's spike is
Phase 0 here.

Ratification posture: [LLP 0014](./0014-cloudflare-strategy.rfc.md)'s
everything-on-Durable-Objects decision is unchanged — facets *are* DOs.
What changes, if the gates pass, is how per-app code reaches them.

## Motivation

Today's hosted model ([LLP 0040](./0040-cloudflare-narrow-proof.rfc.md);
`cloudflare/`) compiles each app's bundle into its deployed Workers at
build time (the `snapback-app` esbuild alias) across three per-app services
— gateway, handler isolate, action handler. Consequences:

- **App creation and code update are deploy-tooling operations.** An agent
  or platform API cannot create a hosted app without a wrangler cycle;
  the local target's apps-are-data model has no hosted counterpart. This
  blocks the full value of the agent provisioning surface (LLP 0086 CC-1).
- **The control plane scales linearly in deployed services** — three
  Worker services and three configs per app.
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
topologies, deliberately not chosen before the spike:

- **A. Facet family:** the coordinator DO hosts child facets for the
  handler and action-handler roles; each facet gets its own SQLite; the
  coordinator remains the version authority and journal owner.
- **B. Loader-only:** the handler and action-handler remain separate
  Worker services (preserving today's deliberate isolation split — a slow
  action fetch must never block the coordinator), but their app bundle is
  loaded at runtime via Worker Loader instead of compiled in at deploy
  time.
- **C. Hybrid:** handler as a coordinator facet (hot path, colocated),
  action handler as a loader-fed separate service (egress-gated, blockable
  without harm).

App code becomes a stored, versioned artifact (registry + content hash,
extending the existing `deployment-identity` machinery), and app
create/update becomes a control-plane API call
([LLP 0024](./0024-agent-operating-surface.spec.md) surface; LLP 0086
CC-1).

## Phases and gates

### Phase 0 — truth and spike (now)

1. Land the ENG-25387 [LLP 0014](./0014-cloudflare-strategy.rfc.md)
   platform-fact refresh (dynamic code loading exists; storage billing
   live; write/read price asymmetry into the cost model).
2. Time-boxed spike: run one existing proof app (notes) under each viable
   topology candidate, behind the existing acceptance suites, measuring:
   - **Isolation** ([LLP 0009](./0009-code-execution-security.rfc.md)
     review): what a facet isolates; binding-envelope control; whether
     ambient-denial and egress gates
     ([LLP 0047](./0047-hosted-execution-limits.rfc.md)-adjacent probes in
     the current suite) hold inside a facet; whether the
     coordinator/action separation survives topology A.
   - **Storage semantics per facet:** SQLite limits, PITR, alarms,
     hibernation, and journal behavior under the coordinator's commit
     pipeline.
   - **Economics:** cold-start delta from runtime loading; how facet
     duration and storage are actually billed (measure; do not assume).
   - **Lifecycle:** facet class versioning against the `exports`
     migration model and its no-gradual-deploy constraint; code-update
     skew between gateway, coordinator, and facet.
   - **Local-dev parity:** whether Miniflare/`workerd` support Worker
     Loader and facets. The entire local proof
     (`cloudflare/test/local-suite.mjs`, 20 gates) runs on Miniflare —
     **no Miniflare support, no adoption**, regardless of production
     behavior.

**Gate 0 (go/reshape/kill):** LLP 0009 isolation review passes for at
least one topology; per-facet storage semantics confirmed sufficient for
the coordinator contract; cold start and billing within the LLP 0014 cost
model; Miniflare parity exists or has a credible committed path. Output:
topology chosen, findings recorded in LLP 0014. Failure modes: isolation
inadequate → topology B or kill; Miniflare gap → hold at Phase 0 and
watch; economics hostile → kill with findings recorded.

### Phase 1 — dual-track profile

Build a new target profile (working name
`cloudflare-do-sqlite-facets-v1`) running the chosen topology end to end
for one demo app, **alongside** the existing deploy-time profile:

- app bundle as stored artifact with content-hash identity; runtime load
  path; version pinning per [LLP 0048](./0048-v8-conformance-twin.rfc.md)'s
  harness single-sourcing;
- full acceptance parity: every gate in the local and remote suites passes
  on the facets profile, plus new gates for load-path failure modes
  (missing artifact, hash mismatch, loader errors — each with a stable
  `SNAPBACK_*` code);
- capability manifest emitted for the new profile; egress and admin
  surfaces verified.

**Gate 1:** full suite parity on the facets profile for the demo app;
no regression on the existing profile; beta-risk register reviewed (what
broke during Phase 1, how often the primitive changed under us).

### Phase 2 — apps as data

- App registry and control-plane operations (create, push code, roll
  back) exposed through the LLP 0024 surface — this is where LLP 0086
  CC-1's provisioning MCP/API becomes fully real on the hosted target;
- migrate the live deployments (notes proof, All Aboard — coordinate per
  the shared-deployment conventions; All Aboard is a live LLP 0049
  system) with rollback rehearsed;
- operational story: per-facet PITR/bookmarks, observability, quota and
  abuse posture per [LLP 0018](./0018-app-instance-boundaries.rfc.md).

**Gate 2:** Facets GA **or** an explicit, ratified risk acceptance for
production use of the beta; live apps migrated and stable through one
deliberate rollback exercise; cost measured on real meters (All Aboard's).

### Phase 3 — full adoption and retirement

Retire the per-app wrangler configs and per-app deploy path; `deploy.sh`
becomes platform-only; LLP 0014 revised to record the new architecture and
this plan moves to Implemented. The old path remains recoverable (git
history plus the dual-track profile kept testable for one release cycle)
until the facets profile has survived a full demo-suite cycle and one
platform-beta-churn event without regression.

## Risks and mitigations

- **Beta churn** — the primitive changes under us. Mitigation: dual-track
  through Phase 2; Gate 2 requires GA or explicit risk acceptance.
- **Deepened lock-in** — Worker Loader is proprietary; `workerd` parity
  unknown ([LLP 0083](./0083-cloudflare-do-d1-prior-art.research.md)
  §sharp edges). Mitigation: the app-facing contract stays
  target-agnostic ([LLP 0007](./0007-storage-portability.spec.md) posture);
  the stored-artifact + runtime-load *interface* is Snapback's own, so a
  Rivet-shaped or self-hosted backend could implement it later; record
  the tension in [LLP 0033](./0033-license-posture.decision.md)'s context
  rather than hiding it.
- **Isolation regression** — collapsing services into facets could lose
  the slow-action containment that the three-service split provides.
  Mitigation: topology B/C exist precisely for this; LLP 0009 review is a
  Gate 0 hard requirement.
- **Migration risk to live systems** — All Aboard is live. Mitigation:
  Phase 2 rollback rehearsal before, not after, migration.

## Non-goals

Dynamic Workflows adoption (assessed separately under
[LLP 0070](./0070-durable-background-work.rfc.md), per LLP 0086 CC-2);
Workers for Platforms; any change to app-facing APIs or authoring surface;
any change to the local target.

## Open questions

1. Topology A, B, or C — Gate 0's output, but is there a prior? (The
   author's instinct may reasonably be C: hot path colocated, egress path
   separated.)
2. Does Miniflare support Worker Loader/facets today, and if not, is there
   a Cloudflare commitment to add it? (Single biggest unknown outside
   isolation.)
3. Who owns the Phase 0 spike and what is its time box? (Shared with LLP
   0086 open question 2; needs LLP 0009 review capacity.)
4. Should the stored-artifact registry live in the coordinator DO, a
   platform DO, or R2 — and does the answer change the trust boundary
   ([LLP 0009](./0009-code-execution-security.rfc.md))?

## Status

Draft. Written 2026-07-23 at the author's direction to chart full adoption
of Facets as the hosted per-app substrate, structured so each phase gate
can reshape or kill the plan while the primitive is beta. Phase 0 can
start immediately (its first step, ENG-25387, is pure fact maintenance).
Revise at every gate.
