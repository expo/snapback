# The supervised control route has no non-destructive verb, and is undocumented

**Filed:** 2026-08-25
**Revised:** 2026-08-26 (r3 source audit: retitled from "control verbs are
undeliverable when stdin is /dev/null"; a non-TTY control route already ships)
**Source:** Clique grok-4.6 xhigh published 0.1.27, lane `grok-clique-explicit`
**Systems:** CLI, Local server lifecycle, Agent experience, Guide
**Owner:** LLP 0310.000 Track E — straightforward

## Problem

The explicit lane launched `snapback dev` via setsid with stdin `/dev/null`
(`/proc/<pid>/fd/0`). After the M2 successor, reload/restart could not be sent
on the **stdin** JSON control channel. The Clique prompt forbids `pkill`.

The original filing concluded from this that an agent-launched owner cannot
talk to its supervisor. That is not true. The supervised bootstrap listener
already serves `POST /_snapback/expo/v1/control`
(`SUPERVISED_CONTROL_PATH` / `handleBootstrapControl`,
`packages/snapback-cli/expo-dev.mjs`), authenticated by constant-time
comparison against the managed admin token, advertised to the owner as
`controlPath` in the supervisor descriptor, and covered by
`packages/snapback-cli/reset-dev-fresh.test.mjs` including its unauthorized and
unknown-verb arms. It needs no TTY and no stdin.

Two things are actually wrong:

1. **The verb set is one entry.** Anything other than `dev-fresh` returns
   `SNAPBACK_EXPO_CONTROL_VERB_UNKNOWN` with `supported: ['dev-fresh']` — and
   `dev-fresh` is destructive, exactly what the Clique prompt forbids. A
   non-destructive `reload-metro` is the verb this lane needed.
2. **It is undocumented.** `controlPath` and `/_snapback/expo/v1/control` have
   zero occurrences under `guide/`. An agent cannot use a channel its own
   supervisor advertises but the guide never names.

## Evidence

- `benchmarks/runs/2026-08-25-clique-grok-0127/cells/grok-clique-explicit/run-log.md`
  (1787659000)
- LLP 0310 F7 / P2

## Direction

Add `reload-metro` and `stop-children` to the existing
`POST /_snapback/expo/v1/control` route, behind the same operator-token gate,
each returning an acknowledgement the caller can wait on. Keep stdin for
interactive humans. Document `controlPath`, its auth, and its verbs in the
guide.

Recook stays LLP 0310.000 Track A's automatic transition — do not add a verb
that lets a client patch identity by hand.

A second control plane (the previously proposed `0600` unix socket) is admitted
only with a named case the HTTP route cannot serve; if one lands it must bind
the owner's incarnation id, refuse foreign/stale/other-uid endpoints, and share
one verb implementation with the HTTP route (LLP 0310.000 OQ8). Fifo is a
non-goal.
