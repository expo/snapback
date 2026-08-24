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

## Gate disposition — ruled

LLP 0129 §Open questions 7 was ruled on 2026-08-03 and extended on 2026-08-07:
the gate splits. The Node/file/public and browser/public halves are landed;
this browser/React/authenticated/authorized conjunction remains an explicit
open remainder gated on M1 lease custody. A public-browser-only witness does
not close this ticket.

## Backlog Lane C assessment (2026-08-01) — prerequisite-gated, no witness landable yet

Scoped for implementation in the clear-the-backlog Lane C pass and found
**triple-gated**; recording the dependency order so the next owner starts at
the front:

1. **No standards-real browser harness exists.** The sibling ticket
   (issues/20260801-guide-gap-js-arm-browser-indexeddb-proof.md) is still
   open; the only retained Phase 0 acceptance is same-process/Node/file. The
   browser-process-termination + same-profile-restart infrastructure this
   witness needs has no owner-built precedent in the repo — it must be built
   first (or jointly), and the public-query browser witness is the natural
   staging step before the authenticated one.
2. **Authorized retained rows do not exist on the JS arm.** The witness's
   center — lease-valid retained AUTHORIZED rows across restart — requires
   LLP 0043 M1 lease custody on the JS arm
   (issues/20260731-js-arm-lease-custody-and-sessions-outbox.md leg 1),
   which remains unimplemented; protected queries still refuse retention
   with SNAPBACK_RETENTION_NOT_RETAINABLE (now positively asserted by a
   Node-carrier receipt landed in this lane — the interim receipt the
   sibling ticket asked for). Until leg 1 lands there is nothing
   authorized to retain, so the conjunction cannot be witnessed.
3. **LLP 0129 §Open questions 7 is resolved:** the gate splits, and this
   authenticated/authorized conjunction remains the open half. The ruling no
   longer blocks implementation; M1 lease custody and the browser harness do.

One adjacent piece DID land in this lane: the cold-boot binding receipt
(issues/20260801-0137-reverify-react-cold-boot-binding-requires-server.md)
removed the prepare-time server round-trip, so the future witness's
"offline restart reaches a provider" leg is now real client behavior rather
than a fake-client shortcut.

Recommended order for the eventual owner: browser harness with the PUBLIC
query witness (closes the sibling ticket) → M1 lease custody (leg 1) →
extend the same harness run with the authenticated/authorized conjunction
and close this ticket. Not started here: implementing any of those halves
out of order would produce exactly the partial witnesses this ticket exists
to reject.

## Prerequisite update (2026-08-10)

The first two implementation prerequisites now have repository evidence. The
standards-real public browser witness landed under
`demos/browser-local-first/tests/acceptance/browser-public-witness.mjs`, and
the JS-arm M1 implementation leg now has an IndexedDB custody matrix plus a
fresh-client offline handoff in
`packages/snapback-client/rqs-resume.test.mjs`. Neither is the conjunction
this ticket requires: the latter deliberately uses fresh wrappers in one JS
process, and the former deliberately proves public rather than lease-bound
rows.

The remaining acceptance is therefore still exactly the Resolution witness
above: extend the standards-real browser harness to authenticate, acquire and
persist a server-issued lease for protected rows, terminate the whole browser
process, restart the same profile with the backend unreachable, prove
lease-valid retained render and equality/expiry deletion, then reconnect and
prove the same run's resync-before-replay, ordered exactly-once settlement,
independent-observer convergence, retained identities, and scoped cleanup.
