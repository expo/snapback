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
endpoint mode `0600`, and removes it on shutdown. The existing stdin channel is
unchanged; no FIFO or client `recook` verb was added. The Guide classifies the
socket as transient instance-local state and documents the descriptor and
protocol.

The focused `expo-dev-loop.test.mjs --control-socket-only` regression launches
the CLI with stdin ignored and asserts Metro PID replacement plus reachability,
stale/foreign/other-UID refusals, the closed verb set, acknowledgement/result
ordering, `stop-children`, mode, and cleanup. Before implementation it failed
with `actual undefined`, `expected 'snapback.dev-control.v1'`. Direct post-fix
JS probes exercised socket mode, asynchronous acknowledgement/result ordering,
stale refusal, stop-result flushing, endpoint cleanup, and retained TTY stdin
keys. A final run of the native-backed focused regression and the existing dev
loop was not possible in this lane because the mandated
`target/debug/snapback` symlink became dangling; no Cargo fallback was run.
