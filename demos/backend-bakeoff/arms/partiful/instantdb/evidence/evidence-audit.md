# Partiful / InstantDB evidence audit

The final protocol run is complete: 9 PASS, 6 explicit GAP, 0 final FAIL,
and 0 Stop-class defects across all 15 frozen scenarios. The current capsule
verifier passes.

## Direct evidence

- `acceptance-results.json` retains the final scenario facts, actor hashes,
  authority negatives, contention settlement, native SSE attribution, native
  actor-scoped Storage checks, and all explicit nonclaims.
- `performance.json` retains two warmups and seven successful recorded samples
  for final-seat contention, the 20-post burst, the 262,144-byte asset path,
  realtime delivery, and `instant-cli push all`. It reports raw values, median,
  and nearest-rank p95. All 45 samples succeeded.
- `screenshots/login.png` is a controlled Chrome capture of the loopback Vite
  app. `receipts/ui-smoke.json` binds its hash, ports, and HTTP result.
- `receipts/target-provision-*.json`, `pre-cleanup-export-attempt*.json`,
  `cleanup-plan.json`, and `cleanup-final.json` bind and close all three fresh
  temporary targets without retaining credentials.

## Retained failures and adjudication

No failed attempt was rewritten. The `acceptance-failure-*.json` receipts retain
the typed `$files` omission, linked-rule SSE invalidation failure, two capacity
model failures, reverse-link permission failure, several Storage settlement
mistakes, and the first webhook receiver validation failure.

The material finding is `receipts/guest-list-revocation-diagnostic.json`.
With `guestListVisible=false`, an independent host read returned false and a
fresh Bob query returned zero invitations, but Bob's existing SSE subscription
emitted neither a replacement result nor an error for 12 seconds. The
coordinator adjudicated this as stream-only invalidation rather than a
Stop-class disclosure: the old rows were authorized when delivered and no new
protected payload arrived. The final model denormalizes the policy bit onto
invitation rows and atomically updates the event and all invitation rows; that
causes the subscribed namespace to invalidate.

## Explicit GAPs

- PARTY-08: upload, authorized delivery, outsider denial, and metadata deletion
  passed, but issued signed URLs/fresh signed delivery remained usable after
  deletion during the observation window.
- PARTY-09: the pinned SDK/CLI and official documentation exposed no
  first-party scheduled-job authoring surface.
- PARTY-10 and PARTY-11: native webhooks exposed delivery history and stable
  idempotency keys, but the arm did not have a provider-hosted receiver ledger
  proving known-success dedupe or a conclusive 15-second ambiguous timeout.
- PARTY-12: without a fully proven effect receiver, complete protected
  revocation delivery was not claimed.
- PARTY-13: schema/permissions, target identity, and webhook history were
  inspectable, but no provider-hosted function-secret boundary existed for the
  requested notification code.

## Authority and Stop audit

- Anonymous public queries omitted `privateHostNote` and filtered the private
  event.
- Bob's guest host-control write and Mallory's private read/write failed.
- Mallory's native Storage client could not obtain Alice's protected file URL.
- Fresh false-state guest-list reads returned zero.
- No secret-shaped value appears in retained artifacts.
- No target exceeded capacity, no unrelated cleanup ran, no late effect was
  observed, and no false hosted capability is claimed.

## Cleanup audit

All entity, `$files`, `$users`, and webhook counts are zero on all three target
identities. Every actor token failed verification. The ignored credential,
XDG, browser-profile, and Vite environment state was removed. Ports 4337 and
9337 were stopped. Only empty provider-owned temporary app shells plus their
schema/permission configuration remain until Instant's documented automatic
expiry after more than 24 hours.

## Primary documentation used

- <https://www.instantdb.com/docs/cli>
- <https://www.instantdb.com/docs/permissions>
- <https://www.instantdb.com/docs/backend>
- <https://www.instantdb.com/docs/auth>
- <https://www.instantdb.com/docs/storage>
- <https://www.instantdb.com/docs/instaml>
- <https://www.instantdb.com/docs/webhooks>
