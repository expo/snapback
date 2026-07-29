## 2026-07-29 — Research Room × InstantDB deep arm

Result: 11 PASS, 4 explicit GAP, 0 FAIL, 0 Stop.

What felt good:

- A temporary hosted app came up from one official CLI command, with no shared
  account state required.
- Typed schema, unique/indexed keys, atomic linked writes, and the admin SDK's
  `asUser` made it practical to run the entire adversarial harness against real
  principals.
- Linked permission traversal is expressive. The strongest moment in this arm
  was cancellation: after the question became `cancelled`, the provider itself
  rejected an injected late progress transaction because the create rule read
  the linked question status.
- Native live queries were compact and reliable. Bob's second scoped client
  observed all four durable progress rows and completion through the
  EventSource-backed subscription without an extra realtime service.
- Indexed `$ilike`, Storage, and stable-id upserts covered the ordinary product
  paths with little infrastructure.

What felt bad or surprising:

- A non-interactive schema push can exit successfully while still sitting at
  the confirmation UI unless global `--yes` is supplied. That was confusing
  and easy to misread as deployment success.
- Permission semantics have sharp edges: `data.ref` always yields a list,
  `newData.ref` does not exist, and file linking creates a view-permission
  bootstrap problem before the reverse link exists. The official “common
  mistakes” page was unusually useful, but these failures still consumed
  several iterations.
- Storage upload returns `{data: {id}}`, which was easy to misread.
- There was no ordinary native vector query, scheduler/cron, or hosted function
  plus secrets surface for this workload. That makes InstantDB excellent for
  the collaborative data plane but incomplete for the AI/automation plane.
- The anonymous temp app could be created with an admin token but could not be
  immediately listed/deleted through the same CLI identity. All data, files,
  users, and tokens were retired, but the empty shell must await auto-expiry.
- The installed dependency tree was about 163 MB and npm reported one high and
  one low advisory.

Comparison and Snapback lessons:

- InstantDB's linked-data permissions and `asUser` backend testing are a very
  good end-state target for Snapback: authorization rules should compose across
  relationships, and tests should switch identities without bespoke harness
  plumbing.
- Live query ergonomics are a benchmark. The subscription expressed desired
  state, delivered an initial snapshot, then tracked authoritative transitions.
- Snapback can differentiate by making durable workflow progress, cancellation
  settlement, scheduling, server-side secrets, and semantic retrieval one
  coherent native path. InstantDB required the application to model the
  workflow state machine and simply had no native answer for three AI/automation
  capabilities.
- Snapback should make non-interactive deploy behavior unambiguous and expose
  exact target deletion from the same credential that creates an ephemeral
  target.

Assistance disclosure: this worker had earlier provider-level experience from a
different InstantDB arm, so the run capsule records a cross-arm provider
knowledge event. This implementation was derived independently from official
InstantDB documentation; no code was copied from the other arm.
