# RN device: a retainable timeline reports NOT_RQS_ELIGIBLE while stuck retained

**Status:** Open — root cause confirmed; implementation and regressions pending
**Impact:** 4
**Urgency:** 3
**Ease:** 2
**Confidence:** 5
**Systems:** React Native/Expo carrier, JS client, Offline retention
**Date:** 2026-08-04
**Governing:** LLP 0090, LLP 0091, LLP 0064, LLP 0114
**Related:** `issues/closed/20260801-0137-a1expo-f7-rn-connection-cycles.md`
(closed; "permanent public-query blanking" half looks like this symptom),
`issues/closed/20260801-0137-a1-pending-outbox-blanks-retained-render.md`,
`diaries/0056-warble-local-first-microblog.diary.md`

## UPDATE 6 — ROOT CAUSE: rowless RQS completion races the subscribe acknowledgement

The phone does not drop the resume token. The wire capture proves that it sends
the previously issued token back as `resumeFromToken` on the next subscribe.
The failure is two coupled bugs in the headless JS client.

### 1. A durable completion can overtake the HTTP subscribe response

For a valid rung-1/RQS resume, the server intentionally returns a rowless HTTP
subscribe acknowledgement and sends the authoritative `current_as_of` envelope
on the durable stream. The phone capture records this ordering:

1. RN posts `/live/timeline/subscribe` with `resumeFromToken` and `supersedes`.
2. The WebSocket tee observes `current_as_of` for the new subscription ID.
3. The HTTP subscribe response carrying that new subscription ID completes.

This ordering is legal. LLP 0091 makes `current_as_of` the authoritative
rowless completion, and the server enqueues it before returning the HTTP
output.

The client does not tolerate that ordering. `applyDurable` immediately rejects
an envelope whose `subscription_id` is not the handle's current ID
(`packages/snapback-client/index.mjs:9536`), but the new ID is installed only
after the awaited HTTP response returns (`index.mjs:9812`). The early
`current_as_of` is therefore discarded. Retained rows remain
`freshness=retained`, `status=refreshing` even though the connection is live.

### 2. A valid rowless response is classified as ineligible

After the HTTP response arrives, the classification at
`packages/snapback-client/index.mjs:9848-9890` looks only for `sub.resume`.
A valid rung-1/rung-2 rowless acknowledgement intentionally has no `resume`
field; the fresh token is carried by the durable completion. The client falls
through to `SNAPBACK_RETENTION_NOT_RQS_ELIGIBLE` despite still holding the
token used for the request.

If `current_as_of` arrives late enough to be accepted, it advances freshness,
version, and `handle.rqsResume`, but does not repair `handle.retention`. This
produces the other observed state: `freshness=current`, `status=ready`, and a
stale `NOT_RQS_ELIGIBLE` refusal.

This is not intrinsically an Expo file-store or Hermes bug. A memory-carrier
reproduction with a valid token-seeded rowless response reports:

```text
after HTTP:        freshness=retained, retainable=false, resumeHeld=true
after current_as_of: freshness=current, retainable=false, resumeHeld=true
```

iOS/RN exposes the defect reliably because reconnects exercise the resume path
and CFNetwork/WebSocket timing allows the durable frame to overtake the HTTP
response.

### Required fix

- Buffer bounded durable envelopes for a subscribe attempt until its HTTP
  response installs the new subscription ID, then replay matching envelopes in
  order. Overflow must fail closed and force a safe resubscribe.
- When a rowless response follows a request with a held resume token, preserve
  eligibility as pending rather than reporting `NOT_RQS_ELIGIBLE`.
- When `current_as_of`, `live_delta`, or `live_replace` carries a valid fresh
  resume token, repair the handle's retention fact as well as `rqsResume`.

### Acceptance criteria

- A stream `current_as_of` arriving before the HTTP subscribe response is not
  lost and the handle settles from retained/refreshing to current/ready.
- A valid rung-1 or rung-2 rowless resume remains `retainable: true` before and
  after its durable completion.
- The regression coverage uses stream ordering; the current poll-style fake,
  which drains only after handle installation, is insufficient by itself.
- Existing memory and Expo RQS resume suites continue to pass.
- The Warble RN fact line no longer reports `NOT_RQS_ELIGIBLE` for the
  retainable public timeline after reload or reconnect.

UPDATE 5's conclusion that "the RN client drops it" is superseded by this
update. UPDATE 5 captured the initial token-bearing subscribe response, while
the later resume exchange in the same wire log proves that the client retained
and reused the token.

## UPDATE 5 — WIRE CAPTURE: the server mints the token. The RN client drops it.

This is the answer to the question every earlier update was circling.

A transparent TCP tee (`demos/warble/scripts/wire-tee.mjs`) was placed in front
of the dev server and both carriers were pointed at it, so their
`/live/timeline/subscribe` exchanges could be compared byte for byte.

**Both carriers receive a resume token:**

```
WEB   (HeadlessChrome)   timeline resume_present=True
                         profiles resume_present=True
                         myLikes  resume_present=True

PHONE (Expo Go / Darwin) timeline resume_present=True
                         profiles resume_present=True
                         myLikes  resume_present=True
```

**And the requests are substantively identical** — same 389-byte JSON body
(`connection_id` / `input` / `expectedGeneration`), same
`x-snapback-connection-token` header, differing only in `User-Agent` and the
browser-only `Origin`/`Referer`:

```json
{"connection_id":"conn_…","input":{"args":{},"auth":{"principal":null,
 "session_id":null,"user_id":null,"permissions":[]},"read_set":[]},
 "expectedGeneration":{"schemaVersion":"snapback.v0","appId":"warble",
 "schemaHash":"sha256:ea503a6b3dc8a97f",…}}
```

### What this establishes

- **The server is not declining to mint.** Every "why won't the server mint for
  RN" theory in the updates below is moot.
- **The RN client receives a resume token and does not keep it.** By the time
  retention is classified, `sub.resume` is falsy — the classification's final
  `else` branch is the only path to `NOT_RQS_ELIGIBLE`
  (`packages/snapback-client/index.mjs:~9884`).
- The query shape is exonerated: `timeline` is the only ordered query
  (`seq1` rather than `mset1` digest kind) and it is minted a token on both
  carriers.

### Confirmed in the same session as the capture

The device, reloaded through the tee, still reported:

```
SNAPBACK_RETENTION_NOT_RQS_ELIGIBLE
freshness=current  connection=live  status=ready  outbox=0/0  store=file
```

while that session's wire shows the server returning a resume token for
`timeline`. So this is not a stale-state artifact: **in one session, the token
was delivered and the classification still refused.**

The socket carries only `ping`/`pong` for the session's lifetime — there is no
later WebSocket re-subscribe whose (token-less) response could be re-classified.
The captured HTTP subscribe is the only one, and it carried the token.

### Ruled out on the provider path

- `react-binding.mjs:1382-1428` validates `resume` (including
  `response.resume.meta.argsHash !== argsHash(response.args)`) — but that is the
  **register-mode query-group bundle** path, which this app does not use, and it
  *throws* `SNAPBACK_REACT_GROUP_BUNDLE_INVALID` rather than silently dropping.
- No WebSocket-delivered replace/subscribe exists to overwrite the good
  classification.

### Where to look

`packages/snapback-client/index.mjs:9842`:

```js
if (sub.resume && !legacySingleTableAdoption) handle.rqsResume = sub.resume;
```

and the classification chain immediately below it, whose `NOT_RQS_ELIGIBLE`
branch requires `sub.resume` to be falsy. Something between the HTTP response
and that chain is losing the field on the Hermes/RN carrier. Candidates worth
checking in order: whether `sub` at classification time is the HTTP response or
a stream-delivered substitute; `legacySingleTableAdoption`; and any
response-parsing path that differs under Hermes.

### Reproduction

```sh
node demos/warble/scripts/wire-tee.mjs --listen 4430 --target 4420 --label cmp
# point the app at http://<lan-ip>:4430, reload, then read
# demos/warble/.dev/wire-cmp.log
```

The tee decodes masked client→server WebSocket frames, so it captures both
the HTTP subscribe and subsequent socket traffic.

## UPDATE 4 — three hypotheses tested and disproved; the search is now narrow

### Device: background/foreground is NOT the trigger

Two captures taken across an explicit background → foreground cycle both came
back healthy:

```
freshness=current  connection=live  status=ready  outbox=0/0  store=file
```

So the app-lifecycle theory from UPDATE 3 is **disproved**. The capture-3
`retained`/`refreshing` state was transient and self-healing; it is not the
defect. `NOT_RQS_ELIGIBLE`, by contrast, is present in **all four** device
captures regardless of freshness/status.

### Local: a `durable: false` RN file store still gets a resume token

The RN ladder branch keys on `navigator.product === 'ReactNative'`, and the
client package ships `fake-expo-file-system.mjs` for exactly this. Driving the
real ladder down its RN branch in Node reproduces the device's store precisely:

```
storeInfo  {"source":"default","implementation":"file","durable":false,
            "reason":"native-files-no-power-loss-cut"}
retention  {"freshness":"current","connection":"live","retainable":true,
            "code":null,"resume":"token"}
```

Same store facts as the device (`store=file`), opposite retention result. So
**store durability is disproved** as the cause — the honest `durable: false`
power-loss caveat does not gate resume minting.

Probe retained at
`scratchpad/rn-carrier-probe.mjs` (paths in the diary); it is worth promoting
into `packages/snapback-client/` as a regression test once the cause is known.

### Disproof table

| hypothesis | verdict | evidence |
| --- | --- | --- |
| non-empty outbox withholds the token | disproved | device `outbox=0/0`; Node: withheld token still yields `retainable: true, code: null` |
| background/foreground breaks the subscription | disproved | two device captures across an explicit cycle, both `current`/`ready` |
| `durable: false` store gates resume | disproved | local RN-branch repro with the identical store facts gets a token |
| f7 blanking/cycling regression | not established | no cycling observed; capture 3 was transient and self-healed |
| provider doesn't request resume | disproved | `preparedPersistResume === true` (`snapback-react/index.mjs:285`) |

### What is left

The split is now tightly bounded: **web + React provider = retainable; RN +
React provider = not**, with the same server, query, declaration, store
implementation class, and `persistResume`. The remaining differences are the
RN runtime itself (Hermes: no WebCrypto, so binding digests take the pure-JS
SHA-256 fallback and process-local labels take the time+sequence fallback) and
whatever the provider's registry does around `startLiveQuery` that the headless
`liveQuery` path does not.

The decisive next experiment is to capture, on device, the actual subscribe
request/response for the timeline query and check whether the response carries
a resume token at all — i.e. whether the server declines to mint, or the client
declines to keep it. Everything above narrows the search; none of it
distinguishes those two.

## UPDATE 3 — a third capture shows the subscription failing to settle

Same session, minutes later:

```
SNAPBACK_RETENTION_NOT_RQS_ELIGIBLE
freshness=retained  connection=live  status=refreshing
outbox=0/0  store=file
```

So the device shows **two distinct states**, both carrying
`NOT_RQS_ELIGIBLE` with an empty outbox and a working file store:

| capture | freshness | status | connection |
| --- | --- | --- | --- |
| 2 | `current` | `ready` | `live` |
| 3 | `retained` | `refreshing` | `live` |

Capture 3 is a query that **never settles**: `retained` + `refreshing` on a
`live` connection means the authoritative answer is not landing. Per
`guide/clients/react.md` a retained frame legitimately holds `refreshing` until
the authoritative answer makes it `current` — but it is supposed to *arrive*.
This also fully explains the accompanying
`SNAPBACK_REACT_OPTIMISTIC_STORE_MISSING`: an optimistic layer requires a
current authoritative store, and this store never becomes current.

### The key deduction: eligibility is inconsistent over time, not statically false

Those retained rows could only exist if the client **previously held a
server-minted resume token**. The write-time gate
(`packages/snapback-client/index.mjs:~8230`) persists an entry only when
`handle.rqsResume` is held *and* `handle.freshness === 'current'`:

```js
// only a server-minted token proves rqsEligible
if (!held || authorizationFence || authorizationFaulted) return;
if (handle.freshness !== 'current') return;
```

So the phone did get a token, was current, and persisted. It now reports
`NOT_RQS_ELIGIBLE`. **The same query on the same carrier is sometimes minted a
token and sometimes not.** That reframes this from "RN is never eligible" to
"RN loses eligibility across subscribe attempts."

### Correction: the f7 family is NOT ruled out

UPDATE 2 (below) claimed the f7 blanking/cycling theory was ruled out because
capture 2 was healthy. That was too strong on one sample. Capture 3 —
a retainable public query that will not settle on a live connection — is
squarely in the f7 symptom family even without a visible ~2s cycle. Treat the
"ruled out" line below as withdrawn; running the archived f7 harness at HEAD is
back to being the first step.

### Suspected trigger worth testing

`guide/clients/react-expo.md` notes the React provider path "has no
app-lifecycle seam of its own — leave the provider attached and let the stream
manager's reconnect own recovery," and that RN WebSockets may emit `error`
without a follow-up `close`. A background/foreground cycle (which a manual
device session does constantly) that reconnects the socket to `live` but does
not re-establish the snapshot-with-subscribe would produce exactly capture 3.
Worth testing explicitly: foreground the app, background it, foreground it,
and sample the fact line at each step.

## UPDATE 2 — second device capture (partly superseded by UPDATE 3)

After adding a full fact line beside the refusal, the device reported:

```
SNAPBACK_RETENTION_NOT_RQS_ELIGIBLE
freshness=current  connection=live  status=ready
outbox=0/0  store=file
```

This is a **completely healthy client** that is nonetheless refused retention:

- `freshness=current` — not stuck retained; the earlier screenshot's retained
  frame was incidental, not the defect
- `connection=live`, `status=ready` — no connection cycling, no blanking
- `outbox=0/0` — the queue is empty, so token withholding does not apply
- `store=file` — the Expo file arm registered and resolved correctly

**~~The f7-regression hypothesis in the section below is therefore ruled
out.~~** — WITHDRAWN by UPDATE 3 above: this conclusion was drawn from a single
healthy sample, and the next capture showed a non-settling query. On *this*
sample there is no blanking and no cycle; that is all it establishes.

### What is now confirmed

| carrier | provider | retention |
| --- | --- | --- |
| Node headless (4 scenarios) | n/a | `retainable: true` |
| Web / IndexedDB | React provider | `retainable: true` (verified with the diagnostic rendering whenever `retainable !== true` — the line is absent) |
| iOS / Expo Go / file store | React provider | **`retainable: false`, `NOT_RQS_ELIGIBLE`** |

Same server, same query declaration, same React provider, same
`persistResume`. `preparedPersistResume` resolves to `true` on both React
carriers (`snapback-react/index.mjs:285` — `preparedGroup?.reference?.persist
!== false` with no prepared group), so the provider does request resume on RN.

### Ruled out

- non-empty outbox withholding the token (`outbox=0/0`, and separately
  disproved on Node — a withheld token yields `retainable: true, code: null`)
- degraded/missing store (`store=file`)
- connection cycling / f7 blanking (`live` + `current` + `ready`)
- provider not requesting resume (`persistResume` is true on both carriers)

### Open question for whoever picks this up

What differs about an RN subscribe such that the server mints no resume token?
One untested asymmetry worth checking first: the Expo file store honestly
reports `durable: false` (`native-files-no-power-loss-cut`) where IndexedDB
reports `true`. If anything in the resume path gates on durability, that would
produce exactly this split — and would mean the carrier's honest power-loss
caveat silently disables retention wholesale, which contradicts
`guide/clients/react-expo.md`'s claim that the registered file arm enables
cold-boot retained render. I did not confirm such a gate exists; it is the next
thing I would instrument.

## Original observation (superseded by the update above)

`demos/warble` on a physical iOS device via Expo Go, against a LAN dev backend,
showed three facts simultaneously:

- header connection: **Live**
- feed banner: retained frame (app was rendering saved posts)
- `Retention: SNAPBACK_RETENTION_NOT_RQS_ELIGIBLE`
- like tap: `SNAPBACK_REACT_OPTIMISTIC_STORE_MISSING: optimistic projection
  requires a current authoritative query store` (a correct downstream
  consequence of the frame never becoming `current`)

The timeline query provably **is** eligible: `demos/warble/snapback/functions.mjs`
declares it `auth: 'public'` + `authorityIndependent: true` over a single-table
plan, and the acceptance suite observes `retainable: true` with a
server-minted resume token.

So the refusal code appears to be wrong on this carrier, and the frame appears
to be stuck at `retained` while the connection reports `live`.

## What I could NOT reproduce

On the Node/file carrier, every construction reports `retainable: true`:

| scenario | freshness | retainable | code | resume |
| --- | --- | --- | --- | --- |
| clean online subscribe | current | true | null | token |
| online, outbox non-empty | current | true | null | token |
| offline-seeded from persisted rows + 1 queued intent | retained | true | null | null |
| after reconnect (auto-drained) | current | true | null | token |

Note row 3: a withheld resume token does **not** by itself produce
`NOT_RQS_ELIGIBLE` — retention stays `true` with `code: null`. So the obvious
"non-empty outbox withholds the token" explanation is **disproved** as the
cause of the code.

The web/IndexedDB carrier also does not show it: the retention line only
renders when `retainable === false`, and it is absent on web.

That isolates the behavior to the RN carrier.

## Why the closed f7 ticket is the first place to look

`20260801-0137-a1expo-f7-rn-connection-cycles.md` closed two halves, one of
which was "**permanent public-query blanking** … with a retainable public query
blanking after the first cycle," fixed by the carrier-agnostic
`pendingResumeConfirmation` self-heal. The symptom here — a retainable public
query failing to settle on RN, with connection state churning — is close enough
that a regression should be ruled out before anything new is theorized.

That ticket left a standing regression gate:

```
demos/improvement-sweep/arms/a1-snapback-expo-ios/evidence/f7-rerun-20260804-head-confirm/
harness: .../f7-rerun-20260803/harness/f7-run-ios.mjs
gate: hold.lostDuringHold.totalLost == 0 over a >=120s idle hold
```

## Next step

Run the archived f7 harness at current HEAD and compare against the receipt. If
the gate still holds, this is a distinct defect and needs its own device capture
(`freshness`, `connection`, `retention.code`, `rqsResume`,
`pendingIntentsAtSeed`, `rqsStoreInfo` sampled over a 120s hold).

To make the next device report self-diagnosing, `demos/warble` now prints the
full fact set beside any retention refusal rather than the bare code
(`demos/warble/app/src/warble-screen.tsx`).

**Confidence is deliberately low (2):** this is a single screenshot from a
manual session, with no receipt and no reproduction. It is filed so the
observation is not lost, not as an established defect.
