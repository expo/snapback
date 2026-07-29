# Coordinator diary draft — Partiful / Appwrite deep arm

Date: 2026-07-28–29
Frozen Snapback identity: `5f31cb6174daaefa04a1e05242acbbc22c725040`
Arm base: `1fc440a545b6e3975a1cf96884e6da7df0692080`

## What I built

The frozen Partiful-shaped application uses Appwrite 1.9.6 Auth users and a
Team role, TablesDB tables with row security, native transactions for the
49/50 final-seat race, Realtime WebSockets for guest-list and wall delivery,
Storage for the exact 262144-byte event-art lifecycle, and a deployed Node 22
Function for scheduled reminders and retry/ambiguity ledgers. Private event
fields live in a separate permissioned table instead of relying on a client
projection.

Local acceptance ended with 13 passes, one honest hosted-credential GAP, and
the final cleanup pass. No Stop-class defect occurred. The two-actor final-seat
race repeatedly produced one commit and one typed 409 conflict, with authority
remaining at 50/50. An already-connected Bob client received no guest payload
after guest-list authority was removed and no post-revocation wall payload.

## What felt good

- `createTable` accepting columns and indexes inline made the native schema
  compact and reproducible. The resulting index and permission metadata was
  easy to inspect.
- TablesDB transactions behaved exactly as hoped for the capacity invariant:
  stage rows independently, race commits, and get a clear
  `transaction_conflict`/409 for the loser. This was the strongest Appwrite
  result in this workload.
- Native Auth sessions plus row permissions made positive and negative actor
  checks concrete. Splitting public and private event data into separate tables
  made anonymous disclosure failures difficult to create accidentally.
- Storage had a clean object lifecycle: authenticated upload, per-file
  permissions, byte-for-byte download, and immediate delete proof.
- Function variables support a genuinely redacted secret boundary, and
  execution logs plus attempt/delivery tables made effects inspectable.
- The self-hosted product exposes enough admin APIs to produce strong target,
  schema, function, execution, and cleanup evidence without scraping a UI.

## What felt bad or frustrating

- Self-hosting is operationally heavy for an application backend comparison:
  the official install created roughly thirty containers, a dozen volumes, and
  multiple networks. Appwrite's documented minimum (2 CPU/4 GiB) was met, but
  the arm used a 4 CPU/8 GiB Colima VM. This is far from a lightweight local
  developer loop.
- The official installer stream terminated after the stack was healthy, and
  Colima did not mirror generated files from a `/private/tmp` bind back to the
  macOS host. The harness had to health-check and copy the exact generated
  Compose files out of the installer container.
- The generated self-host configuration exposed only the legacy Node 16
  runtime even though Node 22 was cached. Enabling Node 22 required changing
  `_APP_FUNCTIONS_RUNTIMES` and recreating the relevant exact-stack services.
- Realtime was the largest authoring papercut. Three natural concurrent
  `subscribe()` calls silently activated only the first observed channel; an
  array subscription also did not behave as expected in this setup. Awaiting
  subscriptions sequentially worked. Collection creation delivery also became
  reliable only when Bob had table-level read permission, so visibility and
  revocation had to transition table authority explicitly. This is powerful,
  but the interaction between table permission, row permission, channel shape,
  Auth restoration, and subscription registration is too easy to get subtly
  wrong.
- A signed-in Alice client could not grant Bob read permission while uploading
  a file; a server-authorized follow-up permission update was required. The
  refusal is safe, but it makes common host-invites-guest workflows less direct.
- Repeating the frozen 20-row client burst hit endpoint rate limiting. The
  native server `createRows` batch avoided this and was the right implementation,
  but the initial failure was not easy to distinguish from workload trouble.
- Cron scheduling loaded and enqueued the function but did not produce an
  inspectable execution inside the first bounded wait. The future
  `scheduledAt` execution API worked, but requires minute precision and a
  minimum one-minute lead time.
- The auto-generated Function execution key did not authorize TablesDB writes
  through the control-plane external endpoint in this topology, so the arm used
  its app-scoped key as a secret Function variable. That is reproducible but
  broader and less elegant than the intended dynamic-key path.
- The Node/Web/CLI dependency tree retained 16 audit findings (0 critical,
  7 high), mostly attributable to the development CLI's transitive tree.

## Environment-only friction, not product blame

The assigned Hetzner worker had excellent CPU/RAM/disk capacity but no Docker,
Podman, usable rootless namespace, or passwordless sudo, so no Appwrite target
could be provisioned there. The coordinator moved the arm to the isolated
control-plane worktree. Colima could reach host-published Appwrite ports from
runtime containers but not the macOS-hosted effect process, so the deterministic
sink moved into the exact arm runtime network.

No arm-scoped Appwrite Cloud credentials or target were available. Local
Function deployment, variables, logs, and effects are proven; hosted evidence
is deliberately a GAP and is not product blame.

## Comparisons and Snapback implications

Appwrite is much broader than Snapback today: Auth, transactional data,
Realtime, Storage, Functions, variables, and scheduling all exist behind one
administrative model. Snapback should match that end result over time,
especially first-party asset storage, scheduled work, secret configuration,
and inspectable effect attempts.

The parts worth matching most directly are the typed native transaction
conflict, the ability to inspect every target object through APIs, and
structural permission boundaries. Snapback can plausibly beat Appwrite on local
startup, deployment footprint, function/runtime coherence, and the clarity of
live-query authorization. Appwrite's Realtime subscription/permission
interaction is precisely the kind of subtle user-visible state machine
Snapback should make harder to express incorrectly.

For the final ranking, I would treat Appwrite as strong on breadth,
transactions, authorization evidence, and self-host ownership; middling on
day-to-day ergonomics; and weak on local operational weight and Realtime
predictability. The hosted GAP prevents claims about production deploy
experience, latency, or cost.

## Evidence pointers for serialized integration

- `receipts/acceptance-results.v1.json`
- `receipts/performance.v1.json`
- `receipts/authoritative-summary.v1.json`
- `receipts/failed-attempts.v1.json`
- `receipts/cleanup.v1.json`
- `run-capsule.v1.json`
