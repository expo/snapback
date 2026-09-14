# Clique: expiry choreography passed while its unexpired probe row remained stored

Status: Open
Priority: P2
Date: 2026-09-14
Systems: social-messenger benchmark, choreography, expiry evidence
Instrument: frozen `social-messenger@0.3.8-m8`, commit `409954115f151a72dd95e897c5f00f36877f11e0`
Evidence status: original passing receipt independently contradicted by its exact stored probe row; precise client timing cause not independently traced

## Observation

The 0.2.10 Clique Muse builder's final sweep marks the implemented
`disappearing-message-expiry-and-purge` check passed at
2026-09-14 22:07:45.701 UTC. Its single attempt lasted 46,459 ms.
At 22:33:43 UTC, after the builder ended and before grading, an independent
read-only SQLite inspection found that exact probe message still stored:

| Field | Value |
| --- | --- |
| Run ID | `0f68c0c1-9c7c-4b9f-9d15-031d60725caf` |
| Row ID | `01M2GZB3V00T8RFJVF7NSQ892F` |
| Body | `choreo-0f68c0c1-9c7c-4b9f-9d15-031d60725caf-m5-expiring` |
| Created, epoch ms | `1789423620003` |
| Expires, epoch ms | `1789510020003` |
| Actual TTL | 86,400 seconds (24 hours) |
| Lane adapter wait | 45,000 ms |

The stored application config also held `ttlA=86400`, `ttlB=604800`.
The message was correctly unexpired. This is a false-positive benchmark
expiry receipt, not evidence that Snapback's engine failed to expire a row.
The [retained observation](../benchmarks/runs/2026-09-14-snapback4-clique-0.2.10/muse/qualifications/m5-expiry-observation.json)
contains the original assertion, exact source receipt hash, selected stored
fields, adapter values and inspection method. No auth tables, credentials,
database contents or raw model transcripts are copied.

## Why the receipt is insufficient

The frozen choreography's M5 implementation
(`instrument/choreography/choreography.mjs:2290–2341` in the packet) selects
disappearing mode, sends a message, observes it on Bob, closes both pages,
waits the adapter duration, reopens the pages and checks that no matching
bubble is visible. After reopening it has no positive check that the
conversation's data has finished loading before treating absence as purge.
An empty view can satisfy that final observation. The builder itself
diagnosed a post-relaunch snapshot race; the read-only inspection establishes
the false positive but does not independently trace that exact timing cause.

The builder also attributed the timing mismatch to an immutable production
config. That diagnosis is incomplete: the frozen brief's time-window section
and `instrument/fixtures/README.md` explicitly supply and require
`windows.shortened.json` for grading. It retains the `24h` option identity
with a 180-second TTL. A 45-second adapter wait is too short for that profile
as well. The lane copied the production profile and restored production TTLs
after a diagnostic live-store override. Preserve those choices as received;
they do not demonstrate an absent product capability.

The check is optional to implement, but this lane implemented it. Its failed
attempts and original final pass remain in the record. The green segment
must not be represented as proof of expiry/purge, and repeated attempts must
not silently select a lucky empty snapshot as stronger evidence.

## Prospective repair and verification

In a new instrument revision, reject a wait/profile mismatch with a named
setup result. Establish positive readiness after relaunch before accepting
absence, and connect the purge observation to the configured server expiry
window. A non-expiring row with delayed hydration must not pass. A correctly
expiring row under the shortened profile must pass after expiry, with both
clients closed during the wait. Keep settlement evidence and the original
failed attempts.

Do not modify this cell's frozen instrument or rewrite its receipt. Its
independent grade remains a separate result. This issue arose while recording
[LLP 3000.007 §10.3](../llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md#10.3).
