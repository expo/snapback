# Flake: security-hardening "obsolete socket never resumes receiving frames" races on this host

**Status:** Resolved (2026-07-24, same day)
**Date:** 2026-07-24
**Found during:** LLP 0090 rollout step 4 (ENG-25455), verifying the
Cloudflare local suite at base `ab191081`

`cloudflare/test/acceptance.security-hardening.mjs` (the
"Replacement-first closes current ownership" leg) intermittently failed at
the pristine base commit — no RQS changes applied — with the obsolete
replacement socket "receiving" one more `live_replace` after
`current.ws.close()` (base run A: exit 0; base run B: exit 1; failure rate
rose under full-suite load).

## Root cause

Instrumentation showed `/__test/connection-state` reporting **zero**
subscriptions and zero accepted sockets before the final mutation — the
server-side invariant held — yet the client still popped a `live_replace`
from its local queue inside the 250 ms observation window. The frame was
**pre-replacement traffic queued client-side**: subscribing arms the All
Aboard warm poll (`reconcileCronActivation`), and a cron-driven feed commit
can fan out an extra `live_replace` to the replacement socket at a
nondeterministic time before `current`'s open closes that socket
server-side. The test's fixed 50 ms sleep plus single-frame consumption left
that extra frame queued, and the final "no frames arrive" window then
observed stale, legitimate traffic — a test-timing artifact, not an
ownership-invariant break.

## Resolution

The test now drains every client-queued frame after `current` replaces and
closes (loop with a 200 ms quiet threshold), asserts the subscription
registry is empty via `/__test/connection-state`, and only then commits the
post-replacement mutation and asserts silence. New frames to the obsolete
socket are impossible at that point (socket closed server-side, registry
row deleted), so the assertion is now deterministic. Landed with the LLP
0090 step-4 change (ENG-25455).
