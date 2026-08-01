# A3 sweep: any attached live subscriber wedges the watch-reload evolution in SNAPBACK_AUTH_MODE_PENDING

**Opened:** 2026-08-01
**Systems:** Runtime, Auth, Live queries, CLI
**Related:** LLP 0137 (A3 arm), demos/improvement-sweep/arms/a3-snapback-web/findings/0137-a3-f5-live-subscriber-wedges-watch-reload.json, issues/20260801-0137-a3-restart-evolution-refusal-misattributed-diagnostic.md

The only working schema-evolution path (the dev supervisor's live watch
reload) deadlocks the moment any live stream subscription is attached.
Repro matrix (evidence/app/repro-evolution3.mjs):

- zero clients / sessions-only clients / handles disposed BEFORE the swap:
  reload lands `generated-and-loaded` in under a second, data flows;
- one attached live handle: reload reports `generated-but-not-loaded`
  carrying `SNAPBACK_AUTH_MODE_PENDING` ("app-data admission is closed for
  an auth-mode transition"), every app-data request refuses with the same
  code, and admission never reopens — not even after the subscriber
  disposes (probed 20s+).

No recovery: restart refuses on the evolved artifacts (the startup-pin
finding), so the operator must restore the OLD sources to boot. The
standard template (vite dev + a browser tab on the React app) hits this on
any schema edit — connected live clients are the steady state of every
collaborative app.

Fix shape: the reload's auth-mode transition should drain live
subscriptions through the existing invalidation protocol (clients already
resubscribe), complete, and reopen admission; if it cannot complete, roll
back to the previous loaded catalog instead of leaving admission closed.
Witness: with an attached live handle, a source edit reloads green and the
handle resubscribes under the evolved catalog.
