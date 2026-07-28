# LLP 0101 — Five-app Snapback workout report

**Type:** Research
**Status:** Active
**Systems:** Demo applications, Code generation, Headless client, Relational queries, Cron, Snapshot bundles, Membership, Guide, Acceptance
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-27
**Revised:** 2026-07-27 (five app kernels, remediation, and verification assembled)
**Related:** LLP 0010, LLP 0012, LLP 0015, LLP 0028, LLP 0056, LLP 0061, LLP 0065, LLP 0080, LLP 0090, LLP 0092

## Question

What happens when five small applications deliberately exercise unrelated
Snapback boundaries, and which encountered costs belong in the platform rather
than in each app?

## Workout corpus

| App | Pressure | Acceptance result |
| --- | --- | --- |
| Catalog Lens | owner-visible left join, bounded pages, opaque cursor integrity | 5/5 |
| Dispatch Board | JS handler, atomic multi-table write, trusted time/IDs, authenticated live query | 5/5 |
| Pulse Monitor | demand-gated cron, action-to-mutation effect, live delivery, admin run ledger | 5/5 |
| Public Dashboard | route manifest, anonymous one-commit bundle, resume token, route refusal | 5/5 |
| Access Desk | membership bootstrap, another-principal admission, read gating, permission-checked write | 5/5 |

The maintained aggregate is `node scripts/run-workout-apps.mjs`. Each child
suite retains its own expected-check count, cleanup evidence, and
`acceptance-report.json`; the aggregate fails if any child exits nonzero.

## Experience

The strongest part of Snapback was that hard correctness properties were
already platform-shaped. Relational cursors were opaque and authority-bound;
runtime values were deterministic; cron durable effects crossed an ordinary
mutation; bundles admitted only declared routes; membership creation and use
had explicit effect-site gates. The applications remained small because none
implemented those mechanisms locally.

The cost was discoverability and repeated ceremony. A fresh source checkout
could reach codegen before installing workspace dependencies and receive a raw
Node module error. New headless kernels repeated lifecycle/provisioning code.
Snapshot bundles existed without a guide page. Cron documentation described
admin-only details as public inspection. Plain JavaScript callers could put a
forbidden trusted property onto a generated reference and learn only after the
network round trip.

Two apparent platform failures were acceptance mistakes. Membership-filtered
queries intentionally return empty rather than throw, and authenticated live
unsubscribe requires the owning identity. Keeping these in the diaries matters:
they are semantic learning costs, but changing the runtime would have weakened
the intended contracts.

## Remediation

| Pain point | Change | Witness |
| --- | --- | --- |
| Repeated headless boot/provision/cleanup | Added `demos/_kit/headless-app.mjs` with fresh app/admin clients | all five suites |
| No maintained cross-app pressure command | Added `scripts/run-workout-apps.mjs`, root `workout`, and local-proof integration | aggregate report, five 5/5 reports |
| Generated JS refs allowed invalid arguments to reach transport | Embed exact `argumentSchema`; validate generated query/mutation/action/live/lease calls before I/O | `argument-validation.test.mjs`, Dispatch Board injection negative |
| Snapshot-bundle guide GAP | Added intent-oriented guide page and capability/index links | `scripts/check-guide.mjs`, Public Dashboard |
| Cron inspection guide used the wrong projection | Documented public aggregate versus admin detail; fixture exposes `AdminClient` | Pulse Monitor |
| Source checkout dependency prerequisite was implicit | Added the pinned install step and classified raw missing-module failures in the authoring loop | guide check |

## Assessment

Snapback is notably strong when an app stays inside a declared capability:
authority, transactional effects, cursor custody, and live invalidation are
more explicit than common React plus Convex/Supabase application conventions.
The primary weakness observed here was not missing core behavior but the
distance between shipped behavior and the shortest discoverable author path.

The fixes reduce that distance without widening authority or hiding important
inputs. Generated-reference validation is defense in depth; the server remains
authoritative. The headless fixture centralizes mechanical lifecycle only;
each app still declares its own schema, functions, handlers, routes, seed, and
behavioral checks.

## Residual limits

These are local headless kernels, not five production products. They do not
claim UI quality, hosted parity, migrations, operational drills, or load
capacity. Public Dashboard witnesses local read mode, not Cloudflare register
mode. Pulse Monitor uses a deterministic local probe, not external monitoring.
Access Desk does not add host removal. Catalog Lens does not claim relational
offline execution. Dispatch Board is not a general audit subsystem.
