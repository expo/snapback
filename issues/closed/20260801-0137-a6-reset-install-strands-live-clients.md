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

---

**Status:** Resolved (2026-08-01, 0137 between-arms fix lane)

**Resolution.** Both missing pieces exist now; the authority posture is
untouched (reset still never resurrects authority — observation only).

1. *Client terminal-state surface* (the bounded shape this ticket asked
   for, patterned on the c40dbd1a outbox projection seam):
   `SnapbackClient.authTerminalStatus()` returns the frozen fact
   `{ terminated, code, authorityDisposition, atMs }`, and
   `subscribeAuthTerminal(listener)` fires at the terminal cut, on a
   carrier→durableDelete escalation, and when an explicit custody
   replacement clears the fact. Recording happens at the existing single
   choke point (`handleTerminalAuthLoss`, plus the auth-counter terminal
   cut); clearing happens only at the explicit custody-replacement
   barriers (`replaceBearerToken`, `replaceAgentCredential`, coordinator
   resume, agent resume). Pure projection — no new claims, no behavior
   change on the cut itself; a throwing listener cannot perturb it.
   Declarations added to index.d.mts (`AuthTerminalStatus`);
   `bun run check:export-types` green. Regression in
   `packages/snapback-client/lifecycle-disposal.test.mjs` proven to fail
   pre-fix (the surface did not exist): drives the same
   SNAPBACK_AUTH_STREAM_RESET-shaped terminal loss the A6 arm observed,
   asserts the fact + single notification + frozen projection +
   dedup of repeat losses + clear-on-custody-replacement.

2. *Blast radius written down*: `guide/backend/versioned-seeds.md` gains
   "Expect the reset blast radius on connected clients" — terminal
   `SNAPBACK_AUTH_STREAM_RESET` on live holders (retry does not
   reconnect), global `SNAPBACK_AUTH_REQUIRED` for pre-reset tokens,
   fresh sign-in minting a NEW principal with seats re-entered through
   the restored seed, and the new client surface as the way rigs learn it
   at the reset instead of from an incidental thrown code.

Possible follow-on (not owed by this ticket): a React-arm projection of
`authTerminalStatus`/`subscribeAuthTerminal` mirroring
`useSnapbackOutbox`.
