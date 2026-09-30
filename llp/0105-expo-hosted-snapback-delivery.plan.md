# LLP 0105: Expo-hosted Snapback delivery

**Type:** Plan
**Status:** Accepted
**Systems:** Product, Deployment, Runtime, Storage, Auth, Security, Billing, Observability, Developer experience, Operations
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-28
**Revised:** 2026-08-18 (hosted authorization posture is now an explicit
admission, activation-record, and canary-notification requirement: production
does not inherit local compatibility warnings; findings are path-specific and
intentional public surfaces are not vulnerabilities by declaration alone; the
operational notification design is tracked separately)
**Revised:** 2026-08-04 (P0.1 hardened run passed 23/23: a binding-free control
proved native WfP CPU/subrequest enforcement, handler/action dispatch bindings
were split so handler CPU remains native while action egress uses an explicit
invocation-scoped `ctx.fetch` guard; a trusted main module freezes ambient fetch
before dynamically evaluating separate app code, and bounded-retry Workers.dev
plus consecutive all-script readiness barriers converged;
Gate 0 remains open on the other Phase-0 obligations and the outbound action
kill-domain follow-up). 2026-08-03 (WfP access enabled; initial P0.1 real
namespace run retained 21/23 checks with exact HOST-only binding read-back and
complete cleanup, but documented per-dispatch CPU/subrequest limits appeared
unenforced and rapid Workers.dev activation instability was recorded for P0.2).
2026-08-01 (Phase 0 authorized by Charlie and execution
begun: WfP access-gap receipt + enablement ticket, dated pricing facts
— rows-written pricing confirms write amplification as the decisive
margin input — and the locally-decisive P0.4 spikes; see §Status
ledger). 2026-07-28 (initial cross-repository plan); 2026-07-28 (/llp-super-refine round 1 revision: write-amplification/margin, logical-storage, and account-budget-protocol proofs made blocking Phase-0 outputs feeding 0104's price decisions; P0.3 proves the release-pinning fence's repair invariant rather than re-opening it; minimum private-beta config/secrets and maintenance-job slices pulled into Phase 1 with Gate 1 assertions, distinct from Phase 4 ergonomics; owner-independent durable identity and narrowed LLP 0089 scope reconciled in Work ownership and the cross-repository ledger); 2026-07-28 (/llp-super-refine round 2 revision: P0.3 injects admission-to-execution delay, non-responsive WebSockets, and proves the admission compatibility check; P0.4/Gate 0 produce scale-ceiling numbers from formulas and reconcile logical storage to the namespace-level provider bill; P0.4/Gate 1 add the account-budget transfer-fence case; Work ownership and cross-repository ledger corrected to retain LLP 0089 as contract authority with Universe as hosted implementation authority, rollback included); 2026-07-28 (/llp-super-refine round 3 revision: P0.3 wording tightened so drain-and-revoke never permits post-migration old-epoch execution and the admission check is machine-checkable/sufficient-by-construction with replay only supplemental; P0.4/Gate 1 transfer-fence made an atomic coordinator boundary with admission-bound attribution carried through commit; hosted operations given distinct stable ids (`environment.create`/`environment.inspect`); logical-storage pragmas named exactly plus a Gate-0 reconciliation-record clause; Gate 0 forces the action-isolation mechanism selection); 2026-07-28 (/llp-super-refine round 4 revision: P0.3 compatibility window enumerated to strictly-additive backward-safe changes only, all other change classes forcing hard drain-and-revoke; P0.4/Gate 0 add the missing-sample estimator experiment (fault-inject growth+shrinkage, prove worst-case error bound, verify customer-favorable credit) and PRAGMA-availability Gate-0 verification; P0.4/Gate 1 add the app-wide multi-coordinator two-phase transfer proof with atomic publication and abort-on-unavailable); 2026-07-28 (/llp-super-refine round 5 revision: P0.4/Gate 1 transfer proof made a durable prepare/commit/abort state machine (prepare freezes leases, commit revokes/epochs, abort restores) with a snapshotted/serialized participant set, publication re-validation, and a mid-transfer environment create/delete/restore injection; "no partial transfer" narrowed to ownership attribution; P0.4 removes index/system-table overhead from the headroom list (measured in-band); missing PRAGMA support made a Gate-0 failure blocking the billing basis, `databaseSize` cross-check only; P0.4 Gate-0 estimator receipt records inputs/max-gap/error-bound-units/credit rule); 2026-07-28 (/llp-super-refine post-convergence touch-up: r6 detail items folded in); 2026-07-28 (Accepted by author Charlie Cheever after /llp-super-refine dual-READY convergence on r6; r6 detail items folded in)
**Related:** LLP 0009, LLP 0010, LLP 0014, LLP 0018, LLP 0043, LLP 0044, LLP 0045, LLP 0047, LLP 0057, LLP 0060, LLP 0070, LLP 0071, LLP 0087, LLP 0089, LLP 0103, LLP 0104, LLP 0173, LLP 0234, LLP 0264, LLP 0274

## Summary

Deliver Expo-hosted Snapback through gated slices across Snapback,
`eas-hosting`, Universe, EAS CLI/Workflows, documentation, billing, and
operations. The first milestone is not a public free tier. It is a measured
end-to-end canary proving stable identity, isolated code, durable data,
deployment repair, hosted auth, and exact usage attribution.

The shortest credible route:

1. prove the WfP handler/host-bridge topology and costs;
2. build the control/data-plane skeleton for one internal app;
3. earn the untrusted private-beta security and lifecycle contract;
4. add billing, budgets, product UX, and free tier;
5. close or explicitly stage remaining capabilities before GA.

No phase may call the current `cloudflare-do-sqlite-v8` proof a managed
product. Its capability manifest remains the honesty boundary until the new
profile earns its own.

## Work ownership

### Snapback

- define the `eas-cloudflare-wfp-v1` capability profile;
- package content-addressed schema, permissions, query/mutation, and action
  artifacts;
- implement handler harness and invocation-bound host protocol;
- finish hosted auth and an external provider path;
- adapt coordinator/live semantics to the owner-independent durable environment
  identity `(expoAppId, snapbackEnvironmentId)` (LLP 0103), so transfer never
  rekeys the coordinator;
- implement export/restore and hosted acceptance;
- close required offline, asset, notification, job, egress, and ephemeral
  gaps according to launch scope;
- maintain LLPs, guide, capability rows, and demo diaries.

### `eas-hosting`

- extend deployment manifests/tokens for stable ids and Snapback artifacts;
- provision gateway/coordinator services and a dedicated handler namespace;
- attach only generated service bindings, outbound policy, tags, and limits;
- reserve and route Snapback HTTP/WebSocket paths;
- make multi-component deploy, cleanup, rollback, and repair idempotent;
- emit stable-id usage events and provider shadow meters;
- add backup/export paths, queues, and operational alarms;
- preserve ordinary Hosting behavior for non-Snapback projects.

### Universe

- add service, environment, release, provenance, operation, entitlement,
  budget, backup, and deletion entities;
- authorize with Expo project roles and scoped service principals;
- issue signed claims and consume component-level webhooks;
- coordinate alias, transfer, disable, plan, suspension, and deletion;
- be the **hosted implementation authority** (authorization with Expo project
  roles plus the durable record) for the operations **LLP 0089 owns as contract
  authority** — `app.create` (creating an **app**), `code.push`/`schema.push`/
  `permissions.push`, and `code.activate` including **promote and rollback** under
  the anti-rollback policy — without narrowing 0089's scope;
- own authorization and the durable record for the hosted **tenant/billing
  lifecycle** operations LLP 0089 does not define, each with its own stable id
  owned by LLP 0103: **`environment.create`** (creating an additional
  environment, DISTINCT from 0089's `app.create`), **`environment.inspect`**
  (DISTINCT from `app.inspect`, which LLP 0089 reserves to LLP 0024), export,
  restore, transfer, suspend, two-stage delete, and preview-TTL governance (LLP
  0103 §Paved path); and project **LLP 0089 for its operations plus that
  hosted-lifecycle contract** through GraphQL/HTTP/MCP; if the product needs 0089's
  surface to grow (e.g. `app.delete`/lifecycle-v1, or ratifying `environment.create`
  into 0089), that is a required LLP 0089 amendment, tracked as a follow-up, not a
  silent override;
- ingest, reconcile, price, invoice, and display usage;
- build Backend/Snapback and billing UX;
- add privacy-bounded support/audit/incident tools.

### CLI, Workflows, docs, support

Required even if housed elsewhere:

- EAS/Snapback CLI and structured noninteractive output;
- Workflows deploy/promote/rollback with protections;
- local emulator and hosted preflight;
- setup, auth, migration, pricing, limits, backup/export, incident, and
  deletion docs;
- status page, on-call runbooks, support receipts, and launch terms.

## Phase 0 — decisive spikes and contracts

Use disposable staging resources. Outputs are committed receipts.

### P0.1 WfP handler and host bridge

Build a minimal generated Worker in a dedicated dispatch namespace:

- only a `HOST` service binding;
- ambient network denied for query/mutation;
- app/object ids absent from user-controlled arguments;
- capability bound to environment, release, operation, request id, deadline;
- one query and mutation calling host operations;
- separate action role performing one allowlisted fetch;
- CPU, subrequest, response, concurrency, and queue limits;
- termination, retry, stale-capability, and cross-app attacks.

Run LLP 0009/0047 adversarial suites with two apps and two releases. Record the
exact multipart binding metadata returned after upload.

### P0.2 Ingress and WebSocket routing

Extend a staging route with stable ids and route a reserved path:

- Expo subdomain, preview URL, production alias, and custom domain;
- HTTP, WebSocket upgrade, hibernation, reconnect, and suspension;
- no collision with Expo Router/static assets;
- no user header can forge internal identity;
- no incorrect authenticated response caching.

### P0.3 Environment and release semantics

Prototype production, development, and explicit preview:

- immutable release upload and promotion without data replacement;
- named preview TTL;
- code rollback over retained data;
- incompatible schema refusal;
- transfer/domain rename without durable-id change;
- release pinning at the coordinator-issued epoch across production alias,
  preview URL, custom domain, and already-open WebSocket subscriptions, per LLP
  0103 §Release pinning and cutover fence.

LLP 0103 Decision 5 already requires one fenced operation; this spike does not
re-open whether a fence is needed but proves the fence's repair invariant
converges under injected failure and that no route shape observes a different
active release than the fence selected. It specifically injects the
**admission-to-execution race**: a request admitted before the fence but delayed
until after migration/activation must execute under the correct epoch. Under hard
drain-and-revoke (the default) such a pre-fence request must complete before
migration or be terminated at the drain deadline — it never executes the old
handler against post-migration schema. Only the proven compatibility-window path
(bounded by the enforced maximum socket lifetime / re-pin deadline) permits an
old-epoch request to execute after migration, and only for shapes the machine-
checkable rule admits. It also injects **non-responsive WebSockets** (sockets
that neither reconnect nor re-subscribe) and proves they are closed at the re-pin
deadline, not merely routing failures. It proves the **admission compatibility
check** itself — the declared forward-compatibility contract plus schema-superset
check that is sufficient by construction. The contract admits the window **only for
strictly additive, backward-safe schema changes** (added nullable/defaulted
columns, added tables, added indexes) that provably leave every old-epoch read and
write valid; **any change to constraints, permissions, triggers, existing column
defaults, data invariants, or any semantic/data migration is NOT window-admissible
and forces hard drain-and-revoke**. Representative replay is **supplemental
evidence only** and never authorizes the window; a window is never granted on
replay alone, and a release the rule does not admit falls back to hard
drain-and-revoke — so the fence cannot silently degrade, not only the
repair-invariant convergence.

### P0.4 Meter and margin proof

Emit all LLP 0104 customer/shadow meters for the five-app corpus and
read-heavy live, write-heavy collaboration, bursty action/job, idle, and
connected-hibernating shapes.

Prove attribution through alias/domain changes and transfer. Calculate free
maximum cost and paid p50/p95 margins. Record any incomplete provider meter.

These outputs are **blocking**, and 0104's price decisions are outputs of them,
not inputs:

- **Write-amplification / margin measurement.** Measure per-mutation row-write
  amplification (application rows plus version/journal/subscription/outbox) after
  batching, and compute provider cost at p50/p95 and an adversarial-but-admitted
  shape. This measurement decides whether reused request/CPU prices cover
  write-heavy shapes (0104 ratification #1) and produces the proven or widened
  database-storage number (0104 §Summary, §Margin gate). If request/CPU cannot
  cover write-heavy costs, the logical database-write-unit meter is specified
  here, not deferred.
- **Scale-envelope ceilings.** Produce the two dated numeric ceilings 0103
  §Interim per-environment scale envelope and 0104 §Service limit specify by
  formula: the **storage ceiling** (`10 GB − reserved headroom`, where index/system-table
  pages are measured **in-band as part of allocated non-freelist bytes** — not as
  headroom — and reserved headroom is only PITR depth, compaction/allocation slack,
  and safety margin, measured against the corpus) and the **write-rate
  ceiling** (the sustained single-`transactionSync` mutation rate under the
  measured write amplification). These numbers are Gate-0 outputs; 0103 and 0104
  ratification must pin the identical dated values before Phase 2 beta.
- **Logical-storage measurement.** Implement and reconcile 0104's logical-SQLite-
  bytes measurement using the first-party SQLite pragmas that yield the formula
  exactly — `PRAGMA page_count`, `PRAGMA freelist_count`, `PRAGMA page_size`
  (`databaseSize` is a **cross-check only, never the billing source** —
  it yields `page_count × page_size` but not `freelist_count`, so it cannot compute
  the billed quantity and would over-count freelist space against the customer).
  **Verify PRAGMA availability (`page_count`/`freelist_count`/`page_size`) on
  Cloudflare DO-SQLite as an explicit Gate-0 item** — it is assumed, not backed by
  LLP 0014 platform facts; **missing PRAGMA support is a Gate-0 failure that blocks
  the DO-SQLite billing basis until resolved**, not a silent `databaseSize`
  fallback (any fallback billing path must be explicitly customer-favorable, never
  billing above true non-freelist bytes). Because provider stored-byte analytics are
  **namespace-level**, not a per-stable-id physical charge, reconcile per-object
  first-party samples **in aggregate** to the namespace/provider bill with an
  explicit allocation rule and error bound (0104 §Defining billable "logical
  SQLite bytes"), rather than assuming a per-stable-id provider feed. Gate 0 must
  **record** the reconciliation contract: the aggregation window, the treatment of
  non-Snapback namespace resources, the tolerance / error bound, and the
  escalation behavior when the ratio persistently widens.
- **Missing-sample estimator proof.** Implement the reproducible missing-sample
  estimator (0104 §Defining billable "logical SQLite bytes") and **fault-inject
  missing samples under both storage growth AND shrinkage**. Derive and **prove the
  worst-case customer-billing error bound** the estimator holds (the bound is this
  experiment's Gate-0 output). Verify the **customer-favorable settlement**: an
  unresolved gap is never billed above the last confirmed sample plus the bounded
  estimate, an irrecoverable gap resolves in the customer's favor, and when a later
  true sample shows an overcharge the difference is corrected and **credited**
  append-only. The Gate-0 receipt records the estimator inputs, the maximum gap
  duration covered, the error-bound units, and the append-only credit rule for
  converting a later true sample into a correction. It states **exactly what
  evidence establishes an overcharge** — a later true sample below the
  carried-forward estimate for the interval (endpoint samples cannot reconstruct
  the time-weighted path through a gap, so an overcharge is established only when
  such an observed true sample bounds the interval below the billed estimate) —
  and that **intervals whose true time-weighted path is unknowable are settled
  conservatively in the customer's favor** (0104 §Defining billable "logical
  SQLite bytes").
- **Account-budget-protocol proof.** Exercise the authoritative account-budget /
  lease protocol (0104 §Authoritative account-budget protocol) under concurrent
  multi-environment spend, partition, and delayed-meter conditions, and show
  account overshoot is bounded by outstanding leases — not merely that costs were
  calculated. Include the **transfer-fence case** as an atomic coordinator
  boundary driven by a durable prepare / commit / abort state machine: on transfer,
  prove admission stops, admission-bound in-flight work finishes (or is terminated)
  under its bound attribution, prepare **freezes** old-owner leases without
  destroying them, commit revokes/epochs them, abort restores/re-issues them, and no
  newly-admitted work runs before a new-owner lease is granted. Prove attribution and budget reservation are **bound at admission and
  carried through commit** — an operation admitted under the old owner settles to
  the old owner even when it commits after cutover (`occurredAt` is the
  admission-bound attribution timestamp) — so neither account's hard limit is
  bypassed and neither account's remaining-budget state is corrupted. Also exercise
  the **app-wide multi-coordinator transfer** (LLP 0103 §App-wide multi-coordinator
  transfer protocol / 0104 §Authoritative account-budget protocol) across an app
  with multiple environment coordinators, driven by a durable per-coordinator
  prepare / commit / abort state machine: prove the two-phase protocol — global
  transfer epoch with a **durably snapshotted participant set** and
  **environment-lifecycle mutations (create/delete/restore) serialized against the
  epoch by the control-plane owner-of-record (Universe)** — the authority that
  gates `environment.create`/`delete`/`restore` against the app's active transfer
  epoch (an `environment.create` already admitted at Universe but whose coordinator
  does not yet exist at snapshot time is caught by publication-time re-validation
  and aborts the transfer) — per-coordinator prepare/fence that **freezes**
  old-owner leases without
  destroying them and acknowledges, ownership publication only after **all**
  snapshot coordinators ack **and the live participant set re-validates equal to the
  snapshot** (commit then revokes/epochs the frozen leases), and
  abort-with-retained-old-ownership (restore/re-issue frozen leases, abort
  acknowledgements before admission resumes) when any coordinator is unavailable or
  the set changed. Inject an **environment created/deleted/restored mid-transfer**
  and prove it is blocked/queued or aborts the transfer, never escaping the fence.
  Also inject a **coordinator that acknowledges `PREPARED` then becomes unavailable
  after ownership publication but before processing `commit`**, and prove it
  **durably redelivers/reconciles the commit** while remaining **fail-closed
  (admission paused)** until it records the committed epoch and obtains a new-owner
  lease — it resumes charging under neither account until both hold. **No partial
  ownership attribution is observable** (partial prepare-time admission
  pause is expected), and new-owner spend begins on each environment only after the
  app-wide publication point and that environment's new-owner lease.

### P0.5 Hosted auth and product security

Run one external identity provider through LLP 0057/0060:

- browser/native session entry;
- effective source/TLS and auth throttling;
- session/permission invalidation;
- sender/custody posture;
- cross-app, transfer, suspension, and stale release.

Expo account auth covers only the control plane; prove the app plane separately.

Hosted authorization posture is part of admission, not a post-deploy scanner
that excuses unsafe activation. Before any production-profile release serves,
admission consumes the exact `generated/authorization-review.json` bound to the
candidate artifact graph and refuses:

- a sessions function whose authorization requirement has `legacy-default`
  provenance;
- a table whose visibility has the implicit legacy `public-read` provenance;
- an uncomposed table-policy surface; and
- a generic write whose installed disposition is `migration-pending` or whose
  write-policy check is otherwise incomplete.

The hosted target does not inherit the local compatibility warn-and-continue
posture for these facts. A refusal names the exact operation/table/policy fact
and remediation, but never row values, credentials, or protected arguments.

Every admitted activation durably records the review artifact's exact
`inputsHash`, its derived authorization-posture digest, and the predecessor →
successor posture comparison beside the release. Existing policy-transition
governance remains the authority for whether a broadening may activate; this
record neither approves a broadening nor creates another waiver path.

Notification is a backstop for a high-confidence exposure discovered after
activation, not permission to admit one. A confirmed finding must trace a
concrete externally reachable path through invocation authority, operation,
data surface, table policy/write posture, and exposed read or write effect.
Explicit `public`/`optional-user`, `public-read`, or `open-write` declarations
are not findings by themselves. An opaque handler or residual field boundary
that prevents a complete proof is labeled `review-required`, never
`confirmed-exposure` or `compromised`. The hosted control plane surfaces the
finding in the project dashboard and delivers it through the product-security
notification seam; recipient resolution, retry/deduplication, lifecycle,
suppression, and escalation are deferred to the
[hosted authorization-posture notification ticket](../issues/20260818-hosted-authorization-posture-notification.md)
and must close before private beta.

### Gate 0

Proceed only if:

- LLP 0009 review accepts WfP as the untrusted boundary;
- the host bridge has a minimal receipt-checked binding envelope;
- slow actions cannot block transactional work (isolation *property*);
- the action-isolation **mechanism is selected** at the gate — separate action
  role vs. proven equivalent kill domain (Open decision 3; 0103 Decision 4 scopes
  property vs. mechanism) — not left open past Gate 0;
- stable identity works across every EAS route shape;
- deployment/activation repair converges after injected failure;
- billable/shadow meters support the margin gate;
- write-amplification and logical-storage measurements have run and produced the
  proven-or-widened database-storage number and the request/CPU-vs-write-unit
  decision (0104's price decisions are outputs of this gate);
- the per-environment **storage and write-rate ceilings** are produced by their
  formulas as dated numeric values ready for 0103/0104 to pin before beta;
- the logical-storage measurement reconciles per-object first-party samples in
  aggregate to the namespace-level provider bill within a stated error bound (no
  per-stable-id provider physical charge is assumed);
- all three SQLite PRAGMAs (`page_count`/`freelist_count`/`page_size`) verified
  available on DO-SQLite, or the DO-SQLite billing basis fails the gate;
- the missing-sample estimator is implemented and its worst-case customer-billing
  error bound is proven under fault-injected missing samples during storage growth
  and shrinkage, with the customer-favorable settlement and credit behavior
  verified;
- paid prices are not structurally loss-making;
- the authoritative account-budget/lease protocol bounds account overshoot under
  concurrency, partition, and delayed meters;
- free maximum cost is enforceably bounded;
- hosted auth passes its target contract;
- the hosted authorization-posture admission classifier consumes the exact LLP
  0173 review artifact, refuses every P0.5 implicit/uncomposed/migration-pending
  negative fixture before serving, records the accepted posture digest, and
  leaves an intentional explicit-public control admissible without classifying
  declaration alone as a vulnerability;
- no Cloudflare beta primitive is a launch dependency.

Failure reshapes or kills the topology, not the public claim.

## Phase 1 — internal canary

Build for an Expo-owned application:

- Universe state machine and entities;
- signed stable-id authorization and component receipts;
- dispatcher/gateway/coordinator/handler path;
- production/development environments;
- deploy, promote, rollback, suspend, export, restore, and two-stage delete;
- **minimum private-beta config/secrets slice** (see P0.1's binding envelope):
  secret storage, binding into handler/action Workers, redaction everywhere
  values could surface, rotation/revocation, control-plane audit, and action-only
  exposure so query/mutation Workers never receive ambient secrets. This is the
  security-correctness minimum, separated from Phase 4's ergonomic config work;
- **minimum durable maintenance-job subset** Phase 2 needs: deletion, export,
  quota-notice, backup, and integrity jobs with retry and inspection, distinct
  from Phase 4's calendar cron and complete job surface;
- end-to-end logs/crashes/requests;
- shadow usage/cost dashboard;
- authorization-posture findings in the dashboard plus the product-security
  notification seam, exercised with injected confirmed and review-required
  findings;
- external app-user auth;
- daily acceptance and fault injection.

Use real transfer and plan-change staging fixtures. Run 14 days with daily
activity and deliberate provider/API failures.

### Gate 1

- no cross-app/environment access;
- operations are idempotent and repairable;
- restore and logical export independently verify;
- the minimum config/secrets slice verifies: secrets bind only to permitted
  Workers, never surface in logs/inspection, rotate and revoke, and are audited;
  query/mutation Workers receive no ambient secret;
- the minimum maintenance-job subset (deletion, export, quota-notice, backup,
  integrity) runs durably with retry and inspection;
- transfer, suspend, spend-stop, and delete converge with receipts; transfer
  fires the **budget transfer fence** as an atomic coordinator boundary —
  admission stops, admission-bound in-flight work settles under its bound
  attribution (an operation admitted under the old owner charges the old owner
  even when it commits after cutover), prepare freezes old-owner leases and commit
  revokes/epochs them, new-owner lease required before newly-admitted work — so
  neither account's hard limit is bypassed (0104 §Authoritative account-budget
  protocol); an **app-wide transfer across multiple environment coordinators**
  snapshots the participant set and serializes environment-lifecycle mutations
  against the transfer epoch, publishes ownership atomically only after every
  snapshot coordinator acknowledges the two-phase protocol and the set re-validates,
  aborts with retained old ownership (frozen leases restored) when any coordinator
  is unavailable or the set changed, and exposes **no partial ownership
  attribution**; a coordinator that goes unavailable **after publication but
  before `commit`** durably redelivers/reconciles the commit and **converges**
  while remaining fail-closed until it records the committed epoch and obtains a
  new-owner lease (LLP 0103 §App-wide multi-coordinator transfer protocol);
- one request correlates through every component;
- every served canary release has an exact authorization-review input hash and
  posture digest; an injected high-confidence reachable exposure produces one
  redacted, path-specific dashboard finding and notification, retry remains
  durable and deduplicated, an opaque-handler control stays review-required,
  and an intentional explicit-public control produces no vulnerability finding;
- provider invoice and shadow ledger reconcile;
- ordinary EAS Hosting does not regress;
- canary SLO/cost budgets hold for 14 days.

## Phase 2 — private paid beta

Invite a small set of Starter-or-higher projects:

- expose CLI/Workflows and dashboard;
- shadow-invoice before real metering;
- acknowledge beta capability gaps;
- publish limits, export, restore, deletion, incident, and pricing docs;
- provide escalation and per-project kill/suspend;
- run at least one native and one Expo web/API app;
- diary setup, auth, deploy, rollback, debugging, billing, and recovery.

Issue credits instead of charging uncertain corrections. Enable charges only
after two complete billing periods reconcile.

Private beta requires production auth, untrusted isolation/limits, online
query/mutation/action/live, provisioning/rollback, backup/restore/export/delete,
audit, stable usage/budgets, safe config/secrets, and durable maintenance jobs.

Offline replay, retained resume, ephemeral rooms, user assets, notifications,
calendar cron, generalized egress, rich queries, and Postgres may remain
explicit beta gaps if invited apps do not require them.

### Gate 2

- two billing periods reconcile;
- ten projects deploy/promote/rollback without operator repair;
- no unresolved isolation/data-loss incident;
- restore drills succeed for three projects;
- support diagnoses every injected failure from safe receipts;
- latency/error/live/cost budgets hold;
- diaries reveal no setup blocker the guide should have prevented.

## Phase 3 — public free and paid beta

Enable self-service:

- ratified LLP 0104 free tier;
- hard free caps, warnings, budget UX, abuse admission;
- Starter usage billing;
- aggregate three-project entitlement;
- visible preview TTL/cleanup;
- one-command enable/deploy;
- onboarding template and agent/MCP provisioning;
- public status and incident communications.

### Gate 3

- free maximum-cost and abuse models hold;
- no free user can receive an invoice;
- quota stop preserves reads/export and committed data;
- median fresh-app setup is under five minutes with no Cloudflare knowledge;
- pricing, docs, CLI, dashboard, and invoice agree;
- paid economics pass the margin gate;
- public security/privacy review approves the service inventory.

## Phase 4 — complete product and GA

Close launch-app requirements:

1. offline retention and queued replay;
2. retained-version resume;
3. ephemeral realtime;
4. assets and processing;
5. notifications;
6. calendar cron and complete jobs (beyond the Phase 1 maintenance subset);
7. generalized declared egress;
8. richer relational/search queries;
9. config acquisition and ergonomic rotation (the developer-facing enhancements
   beyond the Phase 1 private-beta config/secrets security minimum);
10. Postgres graduation or a supported migration.

GA also requires published SLO/Enterprise posture, residency/compliance,
noisy-neighbor evidence, disaster recovery drills, provider outage and
credential rotation rehearsals, support ownership, and a large-app answer
before claiming unlimited popular-app scale.

## Cross-repository ledger

| Slice | Snapback | `eas-hosting` | Universe |
| --- | --- | --- | --- |
| Identity | Owner-independent `(expoAppId, snapbackEnvironmentId)` artifacts | Carry signed durable ids; account is time-versioned attribution | Entities, roles, transfers as ownership intervals |
| Deploy | Build/admission bundles + LLP 0089 operations (`app.create`, `code.push`/`schema.push`/`permissions.push`, `code.activate` promote/**rollback**) | Upload components/receipts | Hosted implementation of LLP 0089 operations; **plus** authorization/state for tenant/billing lifecycle beyond 0089, each with its own LLP 0103 stable id (`environment.create` ≠ 0089 `app.create`; `environment.inspect` ≠ LLP 0024 `app.inspect`; export/restore/transfer/suspend/delete/preview-TTL) |
| Runtime | Coordinator, harness, host ops | Gateway, namespaces/bindings | Entitlements/suspension |
| Auth | App-user sessions | Effective-source routing | Roles/service principals |
| Billing | Logical meters/limits | Provider event emission | Ledger, pricing, Stripe, UI |
| Observe | Function/job facts | Tail/request correlation | Dashboard/support queries |
| Lifecycle | Export/import contracts | Cleanup/backup/restore | Transfer/delete/retention |
| DX | CLI/MCP semantics | Deployment API | Dashboard/Workflows/docs |

## Evidence matrix

Every phase maintains local conformance, staging remote acceptance, two-app
adversarial isolation, two-release skew/rollback, transfer/plan fixtures,
state-edge fault injection, billing duplicate/late/missing/correction cases,
backup/export/restore/delete receipts, ordinary Hosting regression, five-app
cost runs, and browser/native/agent provisioning.

Receipts carry participating repo SHAs, Cloudflare runtime/compatibility date,
pricing version, commands, timestamps, safe test ids, and diagnostics. No gate
passes by prose assertion alone.

## Sequencing constraints

- No public untrusted traffic before LLP 0009/0047 review.
- No production app-user traffic before LLP 0060 acceptance on this target.
- No charges before stable-id reconciliation and two shadow periods.
- No free-tier marketing before hard-stop/data safety proof.
- No Facets launch dependency; evaluate under LLP 0087.
- No database per immutable preview deployment.
- No raw Cloudflare credential/object-id exposure.
- No capability claim merely because an EAS/Cloudflare primitive exists.

## Open decisions

1. Which CLI command owns enablement and atomic artifact coordination.
2. Preview naming, TTL, and production-data isolation.
3. Two handler/action scripts versus a proven independent kill domain.
4. First external app-user auth provider.
5. Final prices/quotas after margin proof.
6. Acceptable gaps for first invited apps.
7. On-call ownership across Expo Hosting and Snapback.

## Status

Accepted (see Revised header); the section text below predated
acceptance and is superseded by the dated notes that follow.

**Phase 0 AUTHORIZED — 2026-08-01.** Charlie Cheever, verbatim: "let's
… spend more time on hosting, especially hosting on EAS." Phase 0
execution began the same day. Per this section's own rule, each gate
revision below carries machine-readable receipts and dated
platform/pricing facts.

**Phase-0 execution ledger (2026-08-01 first pass; updated 2026-08-04):**

- **Access reality — RESOLVED 2026-08-03** (receipts
  `demos/eas-phase0/receipts/p0-access-wfp.json` and
  `demos/eas-phase0/receipts/p0-access-wfp-enabled.json`): the initial account
  probe returned purchase gate 10121; after Charlie enabled Workers for
  Platforms, the read-only namespace endpoint succeeded. The access recipe is
  closed at `issues/closed/20260801-eas-phase0-wfp-enablement.md`. This proves
  the proof account's entitlement, not production Expo-org credential custody.
- **P0.1 real namespace — PASS, 23/23 checks, 2026-08-04** `[observed]`
  (location: `demos/eas-phase0/receipts/p0.1-wfp-dispatch-namespace.json`): the
  disposable `eas-p0-spike-20260803` run uploaded two apps × two releases ×
  handler/action, read back the exact single `HOST` service binding on all eight
  user Workers, and passed untrusted-runtime, query/mutation host bridge,
  app/release isolation, idempotent retry, forbidden scope arguments,
  stale/tampered capability, handler egress denial, governed action allowlist
  with lexical/global/module-captured ambient-fetch denial, independent
  handler/action progress, bounded queue/concurrency, response-size limits, a
  generated action subrequest ceiling with post-settlement fetch revocation,
  trusted-entry re-entry denial, and native handler CPU termination. The
  binding-free control receipt
  (`demos/eas-phase0/receipts/p0.1-wfp-minimal-control.json`) proved the account's
  native custom limits independently: three subrequest bombs failed at five and
  a calibrated CPU burn terminated after the runtime's documented flexibility.
  The corrected topology uses a no-outbound handler dispatch binding for native
  CPU enforcement and an outbound action binding with a fail-closed generated
  subrequest guard; the narrower composition question remains in
  `issues/shelved/20260804-eas-phase0-wfp-outbound-custom-limit-interaction.md`. A
  Workers.dev barrier now requires three body-verified rounds with eight
  independently bounded retry lanes, followed by three consecutive clean rounds
  across all eight namespaced scripts. The final run absorbed 22 transient
  Workers.dev 404s and one 500 (slowest lane: four attempts). The namespace
  barrier then observed 136 transient public-route 404s before reaching three
  clean rounds at round 70, retaining DNS, Ray-ID, and cache
  evidence. The namespace and all three ordinary
  Workers were deleted, then four independent exact lookups returned HTTP 404.
  The two original findings are closed under `issues/closed/`; this P0.1 pass does
  not qualify P0.2's Expo ingress shapes or complete the other Gate-0 obligations.
- **Dated platform/pricing facts
  (`demos/eas-phase0/receipts/p0-platform-pricing-facts.md`):** WfP
  $25/mo, 20M req + 60M CPU-ms + 1,000 scripts included; DO-SQLite rows
  written **$1.00/M past 50M/mo** — ~6,700× the request coefficient,
  confirming P0.4's write-amplification measurement as the decisive
  margin input; stored data $0.20/GB-month; DO requests $0.15/M.
- **P0.4 locally-decisive spikes, RUN 2026-08-01** (receipts under
  `demos/eas-phase0/receipts/`): **write amplification** — measured on
  the real local engine (todo backend, 200 mutations/shape): 8 provider
  rows-written per insert mutation, 4 per update (journal coalescing
  observed at 2:1 on updates); at the dated prices, insert-heavy write
  cost is **~53× the request coefficient** ($8.00/M mutations vs
  $0.15/M requests), answering Gate 0's directional question —
  request/CPU pricing alone cannot cover write-heavy shapes, so the
  logical database-write-unit meter (or write-cost-in-margin with this
  amplification basis) is required for 0104 ratification #1; the
  adversarial shape and five-app corpus rerun on the real DO target
  with empirical index-write accounting. **Logical-storage formula** —
  the three PRAGMAs answered on the local engine; billed non-freelist
  bytes proven strictly below `databaseSize` after deletions (13
  freelist pages excluded, customer-favorable); the reconciliation
  contract (window, non-Snapback exclusion, allocation rule, 5%/two-
  window escalation) recorded; DO-SQLite PRAGMA availability remains
  the explicit OPEN Gate-0 item. **Missing-sample estimator** —
  implemented with carry-forward + append-only credits; worst-case
  pre-credit bound proven as gap × max(0, lastConfirmed −
  min-true-in-gap) (operational form R × gap² under a declared max
  shrink rate, enforceable via metered deletions) across 16 committed
  scenarios + 500 fuzz runs, growth gaps under-billing
  (customer-favorable) throughout. **Not yet run** from P0.4: the
  account-budget/lease protocol proof and the transfer-fence state
  machine — protocol-logic spikes sized for their own session.
- **P0.5 dependency named:** hosted sessions (the 0137-a1expo-f5 gap's
  fix shape — hosted sessions routes + production challenge delivery)
  gates P0.5's app-plane auth proof; the spike cannot run before that
  substrate exists on a hosted target.
- **P0.3** requires the eas-hosting staging substrate plus WfP; deferred
  with P0.2 behind the enablement ticket.
