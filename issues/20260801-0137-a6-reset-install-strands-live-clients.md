# A6 sweep: reset-install strands connected clients with no documented recovery surface

**Opened:** 2026-08-01
**Systems:** Client, Auth, Versioned seeds, Guide
**Related:** LLP 0137 (A6 arm),
demos/improvement-sweep/arms/a6-snapback-web/findings/0137-a6-f3-reset-install-strands-live-clients.json

A receipted versioned reset-install retires the entire pre-reset world.
Observed on 0.1.7 (A6 arm, three failing suite iterations to discover):

1. Clients holding live-query handles get `SNAPBACK_AUTH_STREAM_RESET`
   raised as a TERMINAL error into whatever op is awaited next
   (`#closeForAuthError` — the client stays broken; retry does not
   reconnect).
2. Pre-reset session tokens invalidate globally (later mutations from
   other clients fail `SNAPBACK_AUTH_REQUIRED`).
3. A fresh email-code sign-in for the same email mints a NEW principal,
   so seats must be re-entered through the restored invites.

The authority posture is right — reset never resurrects authority
(consistent with the A5 arm) — and must not regress. What is missing:

- the blast radius written down on the versioned-seeds guide page;
- an explicit terminal-auth surface on SnapbackClient (closed /
  authTerminated state or callback) so rigs and admin tools learn "this
  client is permanently done, rebuild the session" at the reset, not
  from an incidental thrown code out of an unrelated await.

Evidence: A6-09 `restoreReceipt.streamResetBehavior` +
`authorityAfterReset` and A6-10 `postCleanupNegative.leaveOutcomes` in
`demos/improvement-sweep/arms/a6-snapback-web/evidence/scenario-evidence.json`.
