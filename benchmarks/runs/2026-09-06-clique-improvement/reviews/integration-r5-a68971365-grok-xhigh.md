I'll start by reading the review skill and assembling the committed source, LLP contracts, and scoped delta for this independent review.The review skill is for a different workflow; I'll follow the user's source-review brief and start from the committed archive, patch, and LLP contracts.The archive isn't a git repo at the workspace root. I'll verify the committed SHA inside `snapback2` and start reading the patch and LLP contracts.I'll skip the live r4 artifacts and keep reading the rest of `revision.patch` plus the committed source files.The patch is 11 files. Next I’ll read `json`/`refuseJson` callers, overlay-retirement interaction, and the LLP 1002/1012 contracts.READY a68971365091c4760512eeb5e887d45f13373898

Source review of that exact archive, scoped to the typed-terminal JSON correction since 220186033 and its interaction with overlay retirement. Read `revision.patch`, `json`/`refuseJson` callers, drain/resume/upload/channel paths, the new auth-restoration cases, overlay commit/reset/retained-page code, and LLP 1002 §9 / LLP 1012 §7. No other-family or live review was read. No tests were run; supplied execution records are not independent proof.

The JSON boundary is consistent with the stated contract. Internal replay, log-tail, and resume expire captured custody and stop before ordinary settlement or admission. Direct mutation and channel keep typed HTTP 200 terminals. Overlay retirement still drops complete predictions only from current-generation/current-epoch held coverage; a session terminal does not take the rejected-settlement path that would retire overlay and dequeue the envelope.

## Policy modes

`JsonRequestOptions.terminalSession` has four values. `json()` defaults to `"expire"`. HTTP 4xx and typed HTTP 200 `rejected`/`refused` `E_AUTH_SESSION` (family `auth`, not `reason: "conflict"`) share `refuseJson`.

| Mode | Callers | HTTP 4xx `E_AUTH_SESSION` | Typed HTTP 200 session terminal while current | Typed terminal while captured authority is not current |
|---|---|---|---|---|
| `expire` (default) | query, drain replay/tail, resume, manifest, program, list/discard uploads | expire, record, throw | expire, record, throw **before** `wireReplayResponse` / `wireQuery` / resume decode | expire if token still matches, then `E_AUTH_SUPERSEDED` |
| `after-cleanup` | `submitMutation` plain/`onSend` path only | do not expire at `json()`; throw so upload cleanup can use the bearer; `mutation()` then `terminalRefusal({ preserveOutcome: true })` | return the envelope; cleanup; then `terminalRefusal`; **typed result, not thrown** | `refuseJson` → superseded |
| `typed-result` | channel publish | expire and **throw** (4xx is not a typed receipt) | return to `wireChannelPublish`; channel then expires and **returns** `{ state: "refused", ... }` | `refuseJson` → superseded |
| `keep` | login/logout | never expire at this layer | not classified (`terminalSessionEnvelope` skipped) | n/a |

`expire` inside `refuseJson` is true for both `"expire"` and `"typed-result"` when the envelope is a session terminal. That is required: after `expireSession`, `ensureAuthority` would see a cleared token and replace `E_AUTH_SESSION` with `E_AUTH_SUPERSEDED`. `"after-cleanup"` leaves `ensureAuthority` in place because that path does not expire while current.

`authRestoration` (`me()`) still skips the first `throwIfAborted` so a late `me()` body can expire; the post-expiry `throwIfAborted` is unchanged from the previous HTTP-4xx helper.

## Replay, tail, resume, FIFO

Drain/resume `json()` uses default `"expire"` (`client.ts` `drainNow` / `resumeOffline`). Ordering for a current captured token:

1. Response body is in hand.
2. `throwIfAborted` on the origin signal (not aborted).
3. `expireSession({ signal: origin })` → `abortSync` cancels **other** drain/resume controllers, seals, clears the token.
4. `recordRefusal` then `throw` the original `SnapbackRefusal`.

`drainQueued` then hits `family !== "offline"` and `!retryable`, so it **throws** rather than `settle(..., "rejected")`. The durable envelope stays `queued`, including after an owner commit whose tail refused (`logTail` throws before `runtime.accept` / `commitMany`). Recovery is same-principal login plus resume/drain; the ledger still sees the identical replay bytes.

FIFO admission: `submitMutation` rethrows a session terminal from `drain()` **before** `enqueue()` when older intents already exist. A new call never becomes custody.

Origin-signal exclusion is the `abortSync(except)` argument. Origin keeps `E_AUTH_SESSION`; siblings see `AbortError`. A late body on an aborted sibling still hits `throwIfAborted` / `withAbort` before decode, so it cannot settle, admit, or patch snapshot. `isTerminalSession` still requires `family === "auth"`, so an `E_AUTH_SESSION` impostor with another family does not expire.

## Direct mutation, channel, uploads

No-store `client.mutation` still uses `"after-cleanup"`. Assets tests that expect `deepEqual(await mutation(...), { state: "rejected", code: "E_AUTH_SESSION", ... })` and discard-with-bearer-then-expiry still match this path. HTTP 401 on that path still throws after cleanup (`owner-shaped mutation HTTP 401`).

Channel publish is explicitly `"typed-result"`: HTTP 200 session terminals remain typed receipts; HTTP 4xx still expire and throw. If a transition has already bumped the fence, both mutation and channel still go through `refuseJson` and throw `E_AUTH_SUPERSEDED` rather than leaking a typed receipt into a successor generation (existing `auth-ownership` contract).

Upload `checkedAssetResponse({ afterCleanup: true })` is unchanged: sibling cleanup before `terminalRefusal`. Automatic mutation cleanup still runs on typed `rejected` before `mutation()` expires.

## Overlay retirement interaction

Inspected only as it meets rejection settlement and queued intent custody.

- Ordinary program `rejected`/`expired` still drops overlay in the same `applySwap` as the outbox put (`range-store.ts` rejected/expired branch). Session terminals no longer reach that branch.
- `commitMany` still withholds outbox settlement when the tail is another generation (`sawSupersession`); the intent stays queued. A typed session tail never gets that far: `json()` throws first.
- `resetCoverage` clears `overlayNegatives` and overlay watermarks/misses, not overlay rows or outbox. A delayed negative from a former generation cannot retire a later terminal. Fresh same-seq evidence in the new coverage still can.
- Page-arrival retirement requires `!answer.retained` and current held complete/capped pages. `until-revoked` still physically evicts; `delivered-history` denial still retains prior complete data as access-only history and cannot prove arrival or a next-link.
- Other-generation envelopes are not installed (`offline.ts` `continue` + superseded marker). Other-epoch envelopes under the same program are `E_OFFLINE_AUTHORITY` and keep coverage. Overlay retirement therefore only sees current-generation/current-epoch authoritative answers.

Canonical unification (`types.ts` `stableSerialize` → `store/canonical.js`) and the real-owner cursor/projection tests are overlay follow-up, not the JSON-boundary delta.

## Nonblocking

- `refuseJson`’s `expire` flag treats `"typed-result"` like `"expire"` for HTTP 4xx only. The HTTP 200 gate is separate (`terminalSession === "expire"` vs return-to-caller). The `JsonRequestOptions` comment matches; a later reader who looks only at the flag can misread it.
- Public `query()` now throws `E_AUTH_SESSION` on a well-formed HTTP 200 session terminal instead of failing `wireQuery` as `E_WIRE_SHAPE`. That matches the LLP 1002 JSON-boundary sentence; it is not the supported typed-result contract, which remains mutation (no store) and channel.
- `client.ts` sits on the 1496-line cap. This change does not add a sixth check; further edits there will need a split.

Byte12c, prior auth/assets/cursor, named-shape, and reconnect code were not in this delta and were not re-opened. The HTTP 200 terminal contract for direct mutation and channel is intact.
