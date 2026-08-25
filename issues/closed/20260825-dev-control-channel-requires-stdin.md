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
`.snapback/dev-control.sock` descriptor, admits only `reload-metro` and
`stop-children`, emits request-id-correlated acknowledgement and settled-result
records, enforces owner UID/incarnation/lifecycle-receipt checks, creates the
endpoint mode `0600`, registers its exact inode with the instance cleanup
lease, and removes it on shutdown or owner death. A same-UID dead leftover is
reclaimed only after `ECONNREFUSED` plus an exact persisted inode/incarnation
match; live and other-UID endpoints refuse. No FIFO or client `recook` verb was
added. The Guide classifies the socket as transient instance-local state,
distinguishes owner recovery from client hijack, and documents that mode
`0600` is the kernel gate while the command's JSON UID is advisory.

The focused `expo-dev-loop.test.mjs --control-socket-only` regression launches
the CLI with stdin ignored, overlaps acknowledged `reload-metro` with
`stop-children`, asserts both settled results, both Metro PIDs gone, and the
planned port free. It also proves stale/foreign/other-UID requests return one
result and no acknowledgement; injects replacement-Metro launch failure and
asserts critical owner exit; and launches once with a pipe to prove
`snapback.dev-command.v1` `reload` still succeeds on stdin. Before the first
implementation it failed with `actual undefined`, expected
`snapback.dev-control.v1`; before the review fixes the overlap returned only
the reload acknowledgement and no settled result.

`expo-dev-control.test.mjs` binds a socket in a child, kills the holder with
`SIGKILL`, and proves a relaunch reclaims the exact stale endpoint. It separately
proves live-owner and simulated other-UID refusal, EOF and idle-deadline cleanup,
and cleanup-lease reaping after owner death. The native-backed focused suite
and this JS-only unit suite both passed in the review-fix lane.
