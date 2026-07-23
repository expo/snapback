# LLP 0086 CC-3.3 — InstantDB revocation-eviction probe: results

Executed 2026-07-23 per the preregistration in
`issues/20260723-0086-cc3-3-instantdb-probe.md` (observable and T = 120 s
unchanged). Receipts: `receipts-r2.json`, `receipts-r2-secondary.json`,
`receipts-r1.json`, `receipts-r1-secondary.json` in this directory.

## Credential deviation (flagged, not a protocol change)

The human-provisioned pair did not work: app `11d1017c-eed1-4910-b7c4-7ba45fd205fa`
exists and is anonymously reachable (allow-all confirmed via anonymous
`subscribeQuery` returning `{"probe_items":[]}`), but the provided admin token
does not belong to it. `POST /admin/query` -> 400 `record-not-found:
app-admin-token`; the dash surface -> 400 `admin-token-mismatch` ("This admin
token does not belong to app 11d1017c-... Admin tokens are bound to a single
app."), implying the token is a valid admin token for some *other* app.
Swapped-fields hypothesis tested and rejected.

Resolution: self-provisioned an ephemeral app via the unauthenticated
`POST https://api.instantdb.com/dash/apps/ephemeral` (the `instant-cli
init-without-files --temp` path) and ran the identical preregistered protocol
against it. Probe app: `31c150a5-256c-478b-a481-afb9942c14b1`
("llp-0086-cc3-3-probe", expires ~2026-08-06). All protocol substance
(namespace `probe_items`, rules, observable, checkpoints, T) unchanged.

## Perms-push path (programmatic, admin-token-authed)

`POST https://api.instantdb.com/superadmin/apps/{app_id}/perms` with
`Authorization: Bearer <app admin token>` and body `{"code": <perms JSON>}` ->
200, verified by re-pull (`GET /dash/apps/{app_id}/perms/pull`, also
admin-token-authed). No interactive auth needed. Caveat: verified on an
ephemeral (unclaimed) app; not separately verified on a claimed app.

## R2 — authorization-data revocation (rule `data.visibleTo == auth.email`, admin updates `visibleTo` away from the user)

**Verdict: EVICTED (live).**
- Row delivered to live signed-in client at 11:21:54.784Z.
- Admin update acked (tx-id 2544140845) at 11:21:56.993Z.
- Eviction callback (`probe_items: []`) at 11:21:57.025Z — **32 ms** after
  ack, no reconnect, no error frame.
- All checkpoints 5/15/30/60/120 s: row absent; exactly 1 post-ack callback.
- Secondary: fresh client (new process, same user, fresh minted token) is not
  served the row (`[]` on first callback).

## R1 — rule revocation (view `auth.id != null` -> `false` via perms push, client stays connected)

**Verdict: NOT EVICTED (live).**
- Row delivered at 11:24:28.938Z; perms push to `view: "false"` acked
  (rules version 3) at 11:24:31.080Z.
- **Zero** subscription callbacks in the entire 120 s window; row still
  present in client state at T; connection stayed `authenticated` throughout
  (no reconnect, no error frames).
- Secondary: fresh client (new process, same user) is **not** served the row
  (`[]`) — the new rule is enforced on re-query, so R1 is
  "filtered on re-query but never evicted live."

## Reading for CC-3.4 (preregistered decision rule)

R2 evicts live -> the LLP 0074 differentiator claim does **not** unblock as
stated. Per the decision rule it must be narrowed to exactly the non-evicting
shape — rule/permission *definition* changes do not propagate to
already-connected clients' synced rows (until reconnect/re-query) — or
withdrawn. Data-dependent revocation (changing the attribute a rule keys on)
propagates to live clients in ~tens of milliseconds.

## Environment notes

- `@instantdb/core` in Node v25.9 works with: `globalThis.window = globalThis`,
  an in-memory `localStorage` shim, an in-memory `StoreInterface`
  (getItem/removeItem/multiSet/getAllKeys), and an always-online
  NetworkListener. Reactor gates all init on `typeof window !== 'undefined'`.
- No refresh-token invalidation side effects observed: the same user's tokens
  kept working across both shapes; `createToken` for an existing email
  succeeded repeatedly.
