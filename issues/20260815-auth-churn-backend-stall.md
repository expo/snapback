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
  `src/server.rs` (see `ab825e299` for landmarks; that commit is a
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
