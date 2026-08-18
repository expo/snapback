# Auth-churn backend stall: repeated headless sign-in churn leaves a correct auth request stalled until an exact-PID backend restart

**Filed:** 2026-08-15 · **Source:** Clique 0.1.21 exploratory sweep, three
independent lanes · **Systems:** Server auth dispatcher / sessions surface

**Related:** `issues/20260809-password-credential-auth.md` (provider
program, OPEN), LLP 0227 (password credential auth RFC), LLP 0059 (session
projection and client barrier), diary `0076-password-auth-acceptance`,
`issues/20260815-agent-lifecycle-auth-seams.md` (client-side sibling)

## Problem

Repeated headless password-auth churn — many short-lived authenticated
clients signing in and out in quick succession — can leave a subsequent
**correct** auth request stalled indefinitely. The only recovery observed
in the field is restarting the exact backend child process; nothing
short of that (retry, new client, waiting) clears it.

Three sweep lanes hit this independently, none sharing code:

- Diary `0079-clique-0121-snapback-familiar` (M3): "Repeated headless
  authentication churn also stalled a few acceptance/choreography
  retries, requiring exact-PID backend restarts." Earlier in the same
  lane (M2): "repeated short-lived authenticated clients could stall the
  fixture runner until replay was grouped by persona and process phase."
- Diary `0081-clique-0121-snapback-simplified` (M1): "repeated
  duplicate/sign-in probes could leave a correct auth request stalled
  until the exact backend child was restarted."
- Diary `0083-clique-0121-snapback-explicit` (M2): one silent run
  stalled; a bounded rerun exposed a transient auth timeout before
  subsequent runs stabilized.

## Why this is P1-shaped rather than a papercut

Built-in password auth was the sweep's single biggest DX win over
Convex/InstantDB. Its primary users are agents doing exactly this kind
of repeated headless auth — acceptance suites installing eight personas,
choreography replays, per-phase sign-in/sign-out cycles. A stall that
requires identifying and killing the right backend PID undercuts the
flagship feature precisely on its flagship workload.

## Observed shape / leads

- The stalled request is *correct* — same request succeeds after
  restart, so this is server state wedging, not client error.
- Trigger correlates with **duplicate/sign-in probes** and **rapid
  churn**, which suggests the lockout/rate posture, a single-flight or
  dedup guard on the credential path, or a mint/exchange coordinator
  holding something across a failed/duplicate attempt and never
  releasing it. The auth dispatcher's mint/exchange coordinators live in
  `crates/snapback/src/server.rs` (see `ab825e299` for landmarks; that commit is a
  test-stack fix, not this bug).
- Grouping replay by persona and process phase avoided it (0079), which
  points at per-principal or per-connection serialized state rather
  than a global wedge.
- Process-wide restart is the only cure → the wedged state lives in the
  backend process (in-memory coordinator/lock), not in storage.

## Definition of done

1. A reproducing harness: N sign-in/sign-out/duplicate-probe cycles
   across multiple personas from one headless process, tight loop, no
   grouping workaround. It should wedge on the current build.
2. Root cause identified and written down here.
3. Fix landed with a regression test derived from the harness; the
   harness runs clean with no backend restart.
4. If the root cause reveals underspecified auth/session lifecycle
   semantics (what the server owes an in-flight auth request across
   credential churn), amend the governing LLP (0227/0059 territory)
   in the same landing rather than filing a new document.

## Investigation 2026-08-15/16 — mechanism map, field-log correlation, four harnesses

Session ran four escalating repro harnesses against a current debug build
(272bea745-dirty), traced the full server sign-in path, and pulled the
actual failing lanes' transcripts from Durand
(`~/clique-0121-20260814/logs/sol-snapback-*.log`). The permanent wedge
did **not** reproduce at HEAD in bounded runs; the transient window did,
twice, and the wedge classes that can make it permanent are identified
with code references. Harnesses (`auth-churn-repro{,-v2,-v3,-v4}.mjs` +
spawnable subscriber `churn-child.mjs`) live in the investigating
session's scratchpad and should become a committed acceptance surface
with the fix.

### What the field logs actually show

The `sol-snapback-simplified` transcript captures the stall exactly: the
M3 seed's sequential per-persona signins print `seed:m2:alice:auth` …
`seed:m2:erin:auth` and then **stop** — a silent hang, not a typed
refusal — on a disk-backed `snapback dev`-supervised backend, right
after a codegen/regeneration cycle and a killed (exit 130) prior run.
The agent killed the exact child (39551) and polled the supervisor
(38712) for the respawned successor; its own narration: "The attempted
seed then entered the already-observed password-provider stall."
`SNAPBACK_ARTIFACT_IDENTITY_MISMATCH` appears in the same window, so a
watch-reload generation swap was in flight around the stall. No
`panicked at` lines in the transcripts, but the child's stderr is not
reliably captured there.

### Reproduced at HEAD (transient, seconds)

- **Watch reload closes auth admission.** A comment-only `schema.mjs`
  touch mid-churn produced two full churn cycles of
  `SNAPBACK_AUTH_TRANSITION_FAILED` (client coordinator barrier over
  the server refusal) then raw HTTP 503 `SNAPBACK_AUTH_MODE_PENDING`
  on correct signins ("app-data admission is closed for an auth-mode
  transition"). In other runs the same touch settled invisibly between
  cycles — the window is timing-dependent.
- **Dev reports ready before sessions activation settles.** A fresh
  `snapback dev` boot accepted its first signups only after a ~3.3 s
  `AUTH_MODE_PENDING` window. A headless installer starting at
  ready-file time eats `SNAPBACK_AUTH_TRANSITION_FAILED` on its first
  wave.
- **Lockout is invisible and matches the workaround signature.** After
  12 wrong-password attempts, a CORRECT-password signin returns the
  uniform 401 `SNAPBACK_AUTH_CREDENTIAL_INVALID` (deliberate
  anti-oracle). The counter resets on owner sign-in success — which is
  exactly what diary 0079's "group replay by persona and process
  phase" workaround accomplishes. 15-minute lock, persisted in
  `_auth_password_attempts`.

### Not the cause (disproved at HEAD)

- Session-cap eviction drain (`AUTH_SESSION_LIVE_LIMIT = 20`,
  provider.rs:4056): 26 no-logout signins for one persona each holding
  a live stream, then 8 subscriber processes SIGKILLed mid-stream and
  14 more evicting signins — flat ~1.3 s each, no drain wait observed.
- KDF permits (provider.rs:1377/1404): `try_acquire_owned` → typed
  `SNAPBACK_AUTH_THROTTLED`; the permit rides the `spawn_blocking`
  closure; cancellation-safe.
- Capture-mailbox occupancy and GCRA budgets: dev/test budget terms are
  effectively unlimited (throttle.rs:1030-1032); mailbox reservations
  self-prune on TTL.
- Address stripes (256, provider.rs:2535): held across the whole KDF +
  1,250 ms uniform floor per address — measured 6-way same-persona
  signins serialize at ~7.9 s total. A latency/convoy amplifier under
  retry storms, not a wedge; guards release on drop and cancellation.

### Wedge classes that can make the window permanent (code-confirmed, not yet field-pinned)

1. **After-local effect panic permanently closes the writer handoff.**
   `run_after_local_batch` (exec_guard.rs:224-242) runs deferred
   effects/finalizers with no unwind guard; the write-turn choreography
   (server.rs:345-379, server/writer_gate.rs) closes
   `ManagedLocalHandoff`, runs the batch, then reopens — a panicking
   effect skips `reopen()` forever (deliberate fail-closed,
   exec_guard.rs:247). Every later `with_snapback` then parks forever
   on a Notify that cannot fire; the periodic auth GC
   (auth/runtime.rs:512) parks holding a queued **write** on the
   maintenance RwLock, and tokio's write preference blocks every new
   `provider.admit()` — every auth route hangs with no status, no log,
   no timeout. Restart-only and silent: the field symptom. ~30 effect
   producers exist (local.rs, ephemeral.rs, service_fence.rs, server.rs
   live-wire finalizers, oauth.rs); the thread-local asserts in
   service_fence.rs:988-1001 are the leading reachable-panic suspects
   under overlapping same-principal terminal fanout. The same panic
   path deliberately leaks admission-lease owners
   (exec_guard.rs:231-233), leaving admission-epoch `in_flight` stuck
   nonzero — which turns every later watch-reload transition into
   `AUTH_MODE_PENDING`. One panic yields both the hang shape and the
   refusal shape.
2. **`premark_issuance`/`premark_revocation` drain waits have no
   timeout** (auth/coordinator.rs:684/567). Healthy writers drain in
   milliseconds (verified), but any stuck authority-work permit (its
   finalize task queued behind a wedged writer) converts a session-cap
   signin or a logout into an indefinite hang. Inherits class 1;
   deserves a bounded wait + typed refusal regardless.
3. **Auth-mode transition endpoints are durable refusal states.**
   `AuthModeStatus::PendingRestart`/`Quarantined` (auth/mode.rs:241-283,
   local.rs:5490-5510) refuse with `AUTH_MODE_PENDING` until re-staging
   or a process restart — matching the field remedy verbatim if a
   reload-staged transition under churn can land there. Not reproduced
   at HEAD; it WAS the mechanism of the closed 0.1.13-era wedge
   `issues/closed/20260801-0137-a3-live-subscriber-wedges-watch-reload.md`.
   The sweep ran 0.1.21 — audit that tag's transition/quiescence code
   before assuming HEAD behavior.

### Recommended fixes (in order)

1. **Make the handoff wedge loud and finite:** `catch_unwind` around
   each after-local effect/finalizer; keep fail-closed semantics by
   poisoning the handoff with a stable diagnostic instead of silently
   never reopening, and make `lock_managed_snapback`
   (server/writer_gate.rs:40) surface a typed
   `SNAPBACK_LOCAL_PROJECTION_POISONED`-class refusal rather than
   waiting forever. Log the panic with the effect's origin. LLP
   0032/0059 design amendment; land doc + code together.
2. **Bound the premark drain waits** with a generous timeout and a
   typed retryable refusal naming the blocking session.
3. **Emit `Retry-After` on `AUTH_MODE_PENDING`** and don't report the
   dev ready-file until the first sessions activation settles, so
   headless installers stop eating the boot window.
4. Adapt the v4 harness (dev supervisor + watch swap + kill waves +
   churn) into a committed acceptance surface so the transient window
   is measured, not anecdotal.

Client-side siblings from this session (client clears custody on
`AUTH_MODE_PENDING`; MODE_PENDING is live-stream-terminal; post-signin
`SNAPBACK_EPHEMERAL_AUTHORITY_PENDING` races) are recorded in
`issues/20260815-agent-lifecycle-auth-seams.md`. A separate finding —
the stale-password fence race from
`issues/closed/20260812-password-auth-acceptance-blockers.md` blocker
#2 reappearing flakily (1 failure in 6 runs) on an unpinned binary — is
being verified against a pinned origin/main build and will be filed
separately if confirmed.
