# JS arm: no integrated authenticated browser-restart witness (exit criterion 1/2 conjunction)

**Status:** Open
**Impact:** 4
**Urgency:** 3
**Ease:** 2
**Confidence:** 5
**Systems:** JS client, React, IndexedDB, Auth, Acceptance testing
**Date:** 2026-08-01
**Governing:** LLP 0043, LLP 0053, LLP 0114, LLP 0129

## Problem

LLP 0129 exit criterion 1 requires that, after a full process/browser restart
with the backend unreachable, the scored arm render **an authenticated
application shell and retained authorized rows**. Criterion 2 requires the
JS-arm claim rows to reach the Contract arm's proof set. Rounds 4–6 of the
LLP 0129 super-refine established that **no existing or planned witness proves
that conjunction in one run**:

- `issues/20260801-guide-gap-js-arm-browser-indexeddb-proof.md` proves a
  **public** authority-independent query with React/IndexedDB restart plus a
  protected *refusal* — not lease-valid authorized rows in an authenticated
  shell.
- `issues/20260731-js-arm-lease-custody-and-sessions-outbox.md` covers M1 lease
  custody but explicitly permits a **headless** witness.
- The retained Phase 0 acceptance
  (`demos/public-dashboard/tests/acceptance/offline-local-first.mjs`) is
  same-process, file-store, public-query, no React.

So both existing tickets can close while criterion 1 remains unproved. The
criterion says the conjunction "needs its own named owning ticket or artifact";
this is that ticket.

## Resolution witness

One run that covers all of:

- the LLP 0114 React surface in a standards-real browser with IndexedDB;
- an **authenticated** session with **authorized** (lease-bound) retained rows,
  not only authority-independent public queries;
- **full browser-process termination** and offline restart against the same
  browser profile;
- retained/current freshness labeling, full-resync-before-replay, ordered
  exactly-once settlement, and independent-observer convergence on reconnect;
- lease behavior across the restart (valid, and expiry fail-closed to delete);
- retained target, browser, profile/store, source, and artifact identities plus
  scoped cleanup.

## Open decision this depends on

LLP 0129 §Open questions 7 asks whether Phase 0's gate splits (landed
Node/file/public half + open browser/React/authorized half) or is held whole.
That answer determines whether this witness is a conjunct of the **SD-5 Phase 0
gate**, of the **Phase 0 exit criteria**, or both. Until it is answered, a
public-browser-only witness must not be treated as advancing the phase.
