# Guide gap: JS-arm browser/IndexedDB claims exceed retained proof

**Status:** Open
**Impact:** 4
**Urgency:** 3
**Ease:** 3
**Confidence:** 5
**Systems:** Guide, JS client, React, IndexedDB, Acceptance testing
**Date:** 2026-08-01
**Governing:** LLP 0043, LLP 0090, LLP 0129

## Problem

The JS arm implements an IndexedDB default store in browser environments, but
its retained Phase 0 acceptance
`demos/public-dashboard/tests/acceptance/offline-local-first.mjs` is a headless
Node test that forces the durable file carrier. It does not exercise the React
surface, a standards-real IndexedDB implementation, full browser-process
termination, or offline restart against the same browser profile.

The guide and LLP 0129 previously described the browser facts as if that Node
receipt proved them. The 2026-08-01 correction narrows those claims and marks
the browser carrier as an evidence GAP; the implementation itself is not being
declared absent.

**Third half, added by the LLP 0129 super-refine round-1 verification
(2026-08-01):** the protected/auth-scoped refusal is untested on *any* carrier,
not merely unproven in the browser. The retained suite's single refusal check
asserts `SNAPBACK_RETENTION_NOT_RQS_ELIGIBLE` — a non-eligible *public* query.
`SNAPBACK_RETENTION_NOT_RETAINABLE`, the auth-scoped/opaque refusal LLP 0053's
retainability invariant actually governs, is produced in
`packages/snapback-client/index.mjs` and asserted by no test in the repository.
So the browser witness below cannot "avoid borrowing the Node result" for that
fact — there is no Node result to borrow. Either add a Node-carrier assertion
for the auth-scoped refusal as an interim receipt, or treat the browser witness
as that fact's first proof.

## Resolution witness

- run the public React surface in a standards-real browser with IndexedDB;
- retain an authority-independent query and queued mutations;
- terminate the entire browser process, keep authority unreachable, and
  restart against the same browser profile;
- prove retained/current labeling, full-resync-before-replay, ordered
  exactly-once settlement, and independent-observer convergence;
- prove protected/opaque retention refusal in the browser carrier without
  borrowing the Node result; and
- retain target, browser, profile/store, source, and artifact identities plus
  scoped cleanup.

When that witness passes, update the capability row and guide prose in the same
landing change and close this ticket.

## Running log

- **2026-08-02 — prerequisite harness landed, resolution witness remains
  open.** LLP 0155 Stage 0 added
  `demos/zero-bakeoff/stage0/browser/run.mjs`, a locally reproducible system-
  Chrome/Chromium lane over the shipped RQS store. Its nine-check receipt
  proves a real IndexedDB commit survives whole-process `SIGKILL` and relaunch
  over the same profile, then proves two tabs enforce Web Locks single-writer,
  reader adoption/refusal, and takeover after writer-tab death. The receipt
  retains browser executable/version/digest, profile/store, source, storage,
  and scoped cleanup identities. This closes the automation prerequisite, not
  this ticket: the harness deliberately runs no public React surface or
  Snapback server, so retained/current labeling, full-resync-before-replay,
  ordered settlement, observer convergence, and protected/opaque refusal
  remain for the resolution witness above. The capability row and guide prose
  now make this narrower evidence split explicit.
- **2026-08-07 — third-half interim receipt confirmed; guide corrected to
  match; resolution witness still open.** The "third half" already has the
  interim Node-carrier receipt this ticket asked for: commit `a5d609e32`
  (2026-08-01, Backlog Lane C) added
  `packages/snapback-client/rqs-resume.test.mjs` — "an auth-scoped
  subscription refuses retention with SNAPBACK_RETENTION_NOT_RETAINABLE and
  persists nothing" — which drives the real client over a scripted wire and
  asserts the refusal code, a lease-naming reason, and zero persisted store
  entries. It runs in the `snapback-client` package test script (CI). The
  guide's offline page (`guide/sync/offline-and-retention.md`) still said the
  refusal was "asserted by no test on any carrier"; corrected today
  (base `f4d4d8c18`) to name the receipt, transclude its assertions, and
  narrow the remaining refusal GAP to the browser carrier. The
  `sync.offline-js-arm` capability row's witness column now names the
  receipt too. Everything else in the resolution witness — browser
  React/server end-to-end retained/current labeling, full-resync-before-
  replay, ordered settlement, observer convergence, and the browser-carrier
  refusal proof — remains engineering work, so this ticket stays open.
