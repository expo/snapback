# Workroom fixture pack v1

Backend-neutral local fixtures for the [Draft brief](../../briefs/team-workspace.md).
Read [CONTRACT.md](./CONTRACT.md) before implementing an adapter. Nothing here
freezes a ceiling, executes a control, or qualifies a backend.

Run from the repository root with Node 24 or newer. Tools use Node built-ins;
the optional UI consumes the React instance already installed by the app.

```sh
node --test benchmarks/tools/team-workspace/*.test.mjs
node benchmarks/tools/team-workspace/generate.mjs generate starter /tmp/workroom-starter
node benchmarks/tools/team-workspace/generate.mjs generate conformance /tmp/workroom-conformance
node benchmarks/tools/team-workspace/generate.mjs generate tiny /tmp/workroom-tiny
node benchmarks/tools/team-workspace/generate.mjs verify /tmp/workroom-tiny
```

Each output directory must be new. Generated outputs are `actions.ndjson.gz`,
`manifest.json`, and, for scale profiles, `expected-report.json` containing
every member's report row. The starter has W1–W8 milestone tags and exercises
every adapter verb, including negative outcomes. `conformance` is the minimum
all-verb journey profile, with a two-event backlog instead of the starter's
200-event burst; it is not a substitute for that scale probe. W3 and W5 are the explicit
`invitations` and `billing` journeys in `starter.mjs`. To stop at a milestone,
the adapter/harness halts after its last action; retain the **whole original
log** and receipt journal to resume. W8 requires a fresh builder session.
Scale order is dependency order (billing precedes adding 2,000 members), so
milestone tags on scale records are classifications, not execution phases.

Full generation is a scheduled scale task on an idle machine, not a unit test:

```sh
node benchmarks/tools/team-workspace/generate.mjs generate full /tmp/workroom-full-a
node benchmarks/tools/team-workspace/generate.mjs generate full /tmp/workroom-full-b
node benchmarks/tools/team-workspace/generate.mjs verify /tmp/workroom-full-a
node benchmarks/tools/team-workspace/generate.mjs verify /tmp/workroom-full-b
cmp /tmp/workroom-full-a/manifest.json /tmp/workroom-full-b/manifest.json
```

The generator streams gzip without writing a large uncompressed log. The
manifest binds the uncompressed NDJSON byte count and SHA-256, compressed
artifact bytes and hash, media hashes, action/milestone counts, report hash and
known totals. Uncompressed bytes are the portable contract; compressed bytes
are deterministic on the same Node/zlib toolchain and may differ across zlib
versions. The verifier reads the emitted log, independently reduces it,
recounts milestone/operation totals, and compares every media ID/hash/byte
count with the committed, byte-validated media fixtures. It also compares
every observed action to the versioned canonical profile sequence: changing
the log, namespace and hashes together cannot turn a scale pack into a
journey pack and skip the scale report. This verifier is for these deterministic
packs, not arbitrary application replay journals.
Keep generated logs and receipt journals outside the repository.

The checked-in [known-hash receipt](./known-full.v1.json) retains the complete
full-profile manifest and evidence digests from the lead's two independent
generation/verification runs on idle `450b`, source `de3917f929`, Node 24.13.1
and zlib 1.3.1-e00f703 (2026-09-16). Both corrected-media manifests matched
byte-for-byte. It binds 598,224 actions, 167,743,936 uncompressed bytes and
9,647,458 gzip bytes, plus the report and media identities. Temporary evidence
paths are provenance pointers, not a published artifact location. This is
fixture verification only: application replay, the pilot, controls, budgets,
ceilings and artifact publication remain outstanding.

| Count | Large organization | Whole fixture |
| --- | ---: | ---: |
| Organizations | 1 | 51 |
| Members | 2,000 | 2,100 |
| Projects | 120 | 220 |
| Tasks (including archived) | 100,000 | 100,200 |
| Comments | 300,000 | 300,200 |
| Attachments | 5,000 | 5,050 |
| Audit entries | 50,000 | 50,100 |
| Archived tasks | 1,000 | 1,000 |
| Open tasks | 59,000 | 59,150 |
| Overdue tasks | 29,000 | 29,100 |
| Attachment bytes | 1,672,500 | 1,702,550 |

Task due dates are 30 days either side of the server anchor, safely away from
the measured report time. Complete the run within seven days of that anchor;
a later run needs fresh server state and receipt directory. The independent
reducer catches illegal transition sequences, duplicate membership, seat-limit
violations and no-op role changes; its report is an oracle, not backend proof.

## Start the fixture services

Create a local config **outside the repository** with this shape; replace
all three example tokens with distinct local fixture-only values:

```json
{
  "directory": "/tmp/workroom-provider",
  "adminToken": "local-fixture-admin-change-me",
  "serviceToken": "local-fixture-worker-change-me",
  "signingSecret": "local-fixture-signing-change-me",
  "webhookUrl": "http://127.0.0.1:4400/billing/webhook",
  "port": 0,
  "autoRetry": true,
  "retryMs": 100,
  "timeoutMs": 2000
}
```

```sh
node benchmarks/tools/team-workspace/services.mjs /tmp/workroom-services-config.json
```

The first stdout line reports the actual loopback URL. Give the application
server only the service token, signing secret and that URL; admin controls
belong to the fixture driver. A queue remains pending across receiver downtime
and provider restart. Restart with the same directory and tokens. Only one
service process may own a directory. SIGINT/SIGTERM flush and close normally;
a torn final unacknowledged journal line after a crash is safely discarded.
Do not erase journals to recover a test; use a fresh run directory for reset.

API endpoints, fault controls, exact-body signing, replay rules, invitation
token inspection and server-time windows are specified in [CONTRACT.md](./CONTRACT.md).
The socket tests use a tiny signed durable receiver to verify provider behavior;
that receiver is a test double, never a Convex/Supabase/Snapback control cell.

## Replay against an application

```sh
node benchmarks/tools/team-workspace/replay.mjs /tmp/workroom-tiny/actions.ndjson.gz /absolute/path/to/adapter.mjs /tmp/workroom-receipts.ndjson
```

The adapter is the lane's backend-shaped work. Its `payment.deliver` enqueue
uses the action key as `Idempotency-Key`, preserving the provider's batch and
delivery IDs after a lost response. W5 records a billing/audit snapshot and
checks each wrong/unsigned attempt before sending the valid same event.
First run the starter/all-verb
conformance profile, restart replay after an accepted request with a dropped
response, then replay the same completed profile twice. Compare actual
membership, audit, email, extraction and report state: do not infer success
from a local receipt file alone. Full scale uses the identical adapter path.
All registered accounts and data come from the pack; no invented extra users,
manual import, direct audit writes or fixture bypass routes are permitted.

## Presentational UI

```js
import React from 'react';
import { createWorkroomUI } from './fixtures/team-workspace/ui/kit.mjs';
import './fixtures/team-workspace/ui/workroom.css';
const { Shell, Tasks, TaskDetail, Members, Report } = createWorkroomUI(React);
```

The kit includes account, organization, membership/invitation, project/task,
attachment, billing, audit, report and search screens. Props are ordinary
values and callbacks; `data-testid` names are stable. The app passes already
filtered, sorted and paginated rows and performs every read/write/export in
callbacks. The kit never fetches, stores state, handles a credential/session,
filters records, sorts, generates content, or enforces authorization. Disabled
controls display the app's decisions; API enforcement remains the app's.
