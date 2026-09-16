# Workroom fixture contract v1

This is the backend-neutral fixture pack for the **Draft** Workroom brief,
commissioned by LLP 3000.009 §10.1. It is not an application, a control cell,
a pilot, or evidence for a backend claim. Budgets and ceilings remain unset.

## Action log and adapter

Each UTF-8 NDJSON line is one action: `version: 1`, consecutive `seq` starting
at 1, immutable `key`, `milestone`, `actor` persona alias, `op`, nullable new
`entity` alias, `input`, and `expect`. `{ "ref": "alias" }` denotes a prior
entity. Strings are values, never implicit references. Input ordering and LF
line endings are part of the byte hash. See `tools/team-workspace/actions.mjs`
for the operation vocabulary and `starter.mjs` for the W3/W5 journeys.

The application supplies `createAdapter()` returning
`execute(action, { input, actorId, aliases })`. `input` contains resolved IDs.
The adapter registers real accounts with the platform's ordinary auth, signs
in as the named actor, and calls the application's ordinary authorized writes.
It must not import rows, invent sessions, bypass access rules, insert audit
rows, or expose a fixture-only administrative application route. Fixture
provider admin operations control only the provider. A platform's own normal
write-id/reconciliation support or an application idempotency table may bind
the action key to the argument digest and its durable result.

Return `{ status: "applied", receipt: { id, authoritative: true }, bindings }`.
`bindings` has exactly the newly created `entity` alias mapped to its actual
application/provider ID (or is empty for an action without an entity).
An explicitly expected rejection returns `status: "rejected"`, the brief's
normalized `reason`, and its authoritative refusal receipt. A receipt must
name actual observed durable state or a completed read/probe; setting the
boolean without collecting the result is not conformance. Background
checkpoints poll the real sink, extraction state, billing state, or scheduler
until the named condition is durably observed. They never just sleep and pass.
Assertions execute the named acceptance probe through normal read/write APIs.
`harness.control` runs the driver's process lifecycle or response-fault hook,
never an application data bypass. Receiver `commit-then-drop-once` lets one
normal request finish its durable commit and loses only the HTTP response;
`503-once` refuses before dispatch. A restart preserves real application data
or provider journal. These hooks can use a local proxy and process supervisor;
they must not forge a successful receipt or mutate rows. The W5 log supplies
all 200 immutable backlog event inputs; the adapter invents no test content.

`replay.mjs` durably appends the action digest, actual ID bindings and receipt
together, fsyncs before advancing, and reconstructs aliases on restart.
If the transport outcome is unknown, throw `code: "TRANSPORT_UNKNOWN"`; replay
retries the **same key and inputs** up to its configured bounded count. Every
other unexpected terminal result stops the stream before dependent work.
Restart with the same complete log and receipt journal, never an edited suffix.
The adapter must recover a committed but unacknowledged result under that key.
Repeated replay cannot create additional members, comments, effects or audit
entries. Receipt journals contain local account identifiers and must stay out
of source control. One process exclusively owns each journal directory.

`task.set`, `project.set`, `membership.set-role`, and `task.transition` name the
desired state; none is a toggle. Transition actions still enforce the allowed
edge. IDs are bindings, not supplied primary keys. `dueOffsetMs` is relative
to a single anchor recorded by the **application server** when creating the
organization; the adapter obtains its authoritative receipt. It is ordinary
task due-date content, never a supplied current time for security checks.

## Provider wire

All services bind `127.0.0.1` only. Supply distinct local admin, service and
signing tokens (at least 16 characters each). No real provider or credentials
are used. The service token authorizes `POST /email` and `POST /extract`;
the admin token authorizes inspection, payment controls and fault injection.
Every request uses `Authorization: Bearer <token>`. Every accepting POST to
email/extraction/event creation also uses `Idempotency-Key`.

| Endpoint | Contract |
| --- | --- |
| `POST /email` | JSON `{to, subject, body}`; only `@workroom.test` recipients. Acceptance is fsynced before response. Same key + changed raw input returns 409. |
| `GET /admin/email?recipient=…` | Recorded recipient, subject, body, receipt ID and server time. Read invitation tokens from the actual email's accept link, never predict a token. |
| `POST /extract` | Raw bytes of one committed media fixture, up to 10 MiB. Returns pinned SHA-256, content type and text. Unknown bytes fail; this service never fetches a URL. |
| `POST /payment/events` | JSON `{organizationId, plan, seatLimit, renewalOffsetMs?}`. Creates an event; does not deliver it. Same key + changed normalized input returns 409. |
| `POST /payment/deliveries` | JSON `{eventIds: [...], signature?: "valid"|"wrong"|"unsigned", retry?: boolean}`. Queue in this exact order; repeated IDs deliberately duplicate. Default retry is true. |
| `POST /payment/tick` | Attempts every unfinished queued delivery once immediately. Useful with automatic retry disabled for deterministic fault choreography. |
| `GET /payment/status` | Immutable event bodies (base64), queue, delivery attempts, HTTP statuses, errors and durable acknowledgements. |
| `POST /admin/faults` | `{target: "email"|"extract"|"payment-events", kind: "503"|"drop"|"delay", count, delayMs?}`. 503 refuses before acceptance; drop/delay occur after fsync. These transient test controls are reset on provider restart. |

Payment JSON includes `version`, immutable `id`, `type: "plan.changed"`,
`organizationId`, monotone per-organization `revision`, `plan`, `seatLimit`,
and nullable provider-time `renewalAt`. The receiver verifies
`X-Workroom-Signature: v1=<lowercase HMAC-SHA256 hex>` over the **exact raw
request bytes** with the shared signing secret before consuming its event ID.
It applies each event ID once, changes plan only for a strictly newer revision,
and returns 2xx only after the application commit is durable. An invalid
signature cannot poison deduplication of the valid identical body. Old valid
events are acknowledged but do not revert the plan or emit a plan audit event.
Newer events whose values do not change the plan/seat/renewal still advance the
revision but do not emit a no-op plan audit event.

Provider events, queued deliveries and successful acknowledgements are
append-only fsynced records in `provider.ndjson`. Unacknowledged deliveries
retry after restart, including when the receiver committed but the response
was lost. The provider reports every attempt; it cannot prove a receiver's
durability by itself. The acceptance adapter restarts the receiver and checks
its durable state and audit before accepting that assertion. Receiver URLs are
literal loopback HTTP addresses; redirects are refused. Provider fault
controls never change application state directly.

## Time, reports and scale

`windows.json` is loaded by the application server, with production seven-day
invitation expiry and three-day reminder lead. Grading selects the shortened
two-minute invitation and three-minute lead. For reminder tests schedule the
near renewal four minutes out and the far one an hour out. The server checks
time on accept and on scheduling; caller timestamps never determine a window.
Cleanup is one day in production and two minutes in shortened tests.

All 300,000 comments, 5,000 attachments and 50,000 audit entries in the brief's
envelope belong to the **large organization**. Fifty small organizations add
their own records. All 2,000 large members are registered accounts, including
its creator/owner. Creating an organization contributes exactly one owner
membership audit entry. Each real add/remove/role/plan change and each archive
or hard deletion contributes exactly one audit entry; no-op/duplicate/rejected
requests do not. Task/comment creation and edits do not emit these audit events.

Report open means `open`, `in-progress` or `blocked`; excludes archived tasks.
Overdue is an open task with due date before server time. Every member appears,
even with zero counts. Attachment bytes are attributed to the task's assignee,
include attachments of archived tasks/projects, and exclude deleted attachments.
Archive changes visibility of default lists, not membership authorization:
authorized members can still download an archived task's attachments. Search
includes readable history; a deleted attachment's text is removed.

W1 owners/admins may add an already registered member through the ordinary
authorized membership action, so role/removal tests precede invitations.
The starter's repeated invitation for an existing member is harmless and
reserves no new seat. Pending invitations reserve one seat per distinct new
address; revoked/expired invitations release it, and acceptance atomically
rechecks current membership and the plan. Guest rights are project-scoped
reads; guests cannot write, invite, create/archive projects or manage
membership, billing or deletion.
