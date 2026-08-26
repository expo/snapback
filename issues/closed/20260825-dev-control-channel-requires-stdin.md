# `snapback dev --json` control verbs are undeliverable when stdin is `/dev/null`

**Filed:** 2026-08-25
**Source:** Clique grok-4.6 xhigh published 0.1.27, lane `grok-clique-explicit`
**Systems:** CLI, Local server lifecycle, Agent experience
**Owner:** LLP 0310.000 Track E — straightforward

## Problem

The explicit lane launched `snapback dev` via setsid with stdin `/dev/null`
(`/proc/<pid>/fd/0`). After the M2 successor, reload/restart could not be
sent on the JSON control channel. The Clique prompt forbids `pkill`. The
supervisor claims to own Metro but cannot be told to recook it from an
agent launch.

## Evidence

- `benchmarks/runs/2026-08-25-clique-grok-0127/cells/grok-clique-explicit/run-log.md`
  (1787659000)
- LLP 0310 F7 / P2

## Direction

Accept control verbs from a unix socket or a well-known fifo next to the
ready file, in addition to stdin. `/dev/null` stdin is a legal agent
launch. Keep stdin for interactive humans.

## Resolution (2026-08-25)

Implemented LLP 0310.000 Track E (in review) for packaged supervised Expo
development. `snapback dev --expo --json` now publishes an owner-bound
`.snapback/.dc-sock` descriptor, admits only `reload-metro` and
`stop-children`, emits request-id-correlated acknowledgement and settled-result
records, enforces owner UID/incarnation/lifecycle-receipt checks, creates the
endpoint mode `0600`, registers its exact inode with the instance cleanup
lease, and removes it on shutdown or owner death. A same-UID dead leftover is
reclaimed under the directory lock only after a bounded `connect()` returns
`ECONNREFUSED`, the inode remains unchanged, and a present valid owner record
matches its inode/incarnation. The bound record is published before the
well-known endpoint, so an absent or unreadable/corrupt record and a present
valid mismatch all refuse with `SNAPBACK_DEV_CONTROL_FOREIGN_OWNER`; recovery
requires the operator to inspect and explicitly remove both artifacts or choose
a different owner-only `--ready-file` directory. Probe timeout, a live listener,
and an other-UID endpoint also refuse. The reaper's deletion rule remains the
separate stricter exact cleanup-lease inode/incarnation match. No FIFO or client
`recook` verb was added. The Guide classifies the artifacts as transient
instance-local state and names the owner-only state directory plus descriptor
as the cross-UID gate; AF_UNIX inode mode is not trusted on Darwin and the
command's JSON UID remains advisory. A non-owner-only or symlinked state
directory now emits `SNAPBACK_DEV_CONTROL_SOCKET_UNAVAILABLE` and keeps the
packaged supervisor alive with stdin-only control. Bind failures and a failed
prepublication `connect()` of the advertised path use that same fallback, so a
state directory beyond the platform's Unix-socket path budget cannot abort the
interactive supervisor or publish an unreachable descriptor. The short
`.dc-sock` well-known basename stays within the `.dc-*` coordination budget;
live or occupied endpoints remain fail-closed refusals.

The focused `expo-dev-loop.test.mjs --control-socket-only` regression includes
a default-options launch with stdin ignored that acknowledges and settles
`reload-metro`. It overlaps acknowledged `reload-metro` with `stop-children`,
asserts both settled results, all Metro PIDs gone, and the planned port free.
It also proves stale/foreign/other-UID requests return one result and no
acknowledgement; queues `stop-children` behind an injected replacement-Metro
launch failure and requires the stop result before critical owner exit; and
submits stdin `restart` after the stop acknowledgement to prove the shared
stopping latch refuses it without spawning a backend. A pipe-backed launch
also proves `snapback.dev-command.v1` `reload` remains available. Before the
first implementation the suite failed with `actual undefined`, expected
`snapback.dev-control.v1`; before the review fixes the successful overlap
returned only the reload acknowledgement and no settled result; before the
round-4 fix the failed-reload overlap timed out waiting for
`stop-after-failed-reload`.

`expo-dev-control.test.mjs` binds a socket in a child, kills the holder with
`SIGKILL`, and proves a relaunch reclaims the exact stale endpoint only when its
bound owner marker matches. It separately proves missing/corrupt/mismatched
owner-state refusal with operator-explicit recovery, live-owner and simulated
other-UID refusal, owner-directory stdin-only degradation, EOF and idle-deadline
cleanup, and cleanup-lease reaping after owner death. The crash before
`expo-supervisor.json` publication reclaims through the already-published bound
marker. Further coverage includes a bounded-probe timeout, death while replacing
stale `.dc-lock` through `.dc-reclaim`, death after the stale-generation claim
but before `.dc-reclaim` replacement, and death after direct well-known bind
and exact-inode lease activation. Generation claims record PID/start-time owner identity; a
dead claimant is recoverable through a next-generation atomic-link election,
two racing successors still admit exactly one winner, and the winner removes
the claim chain once its live `.dc-lock` is published. The live suite
concurrently submits stdin and socket
`reload-metro`, while the failed-reload case submits stdin `restart` after the
stop acknowledgement, witnessing that verb on the shared stopping latch. The
implementation routes all four lifecycle-mutating stdin verbs through the same
serialized queue.
