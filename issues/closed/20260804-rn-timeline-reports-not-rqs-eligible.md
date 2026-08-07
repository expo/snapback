# RN device: rowless RQS completion races subscribe acknowledgement

**Date:** 2026-08-04
**Status:** Resolved
**Impact:** 4
**Urgency:** 3
**Ease:** 2
**Confidence:** 5
**Systems:** React Native/Expo carrier, JS client, Offline retention
**Governing:** LLP 0090, LLP 0091, LLP 0064, LLP 0114
**Related:** `diaries/0056-warble-local-first-microblog.diary.md`,
`issues/closed/20260801-0137-a1expo-f7-rn-connection-cycles.md`

## Symptom

Warble's retainable public timeline produced either of these facts on iOS/RN:

```text
freshness=retained  status=refreshing  connection=live
retention=SNAPBACK_RETENTION_NOT_RQS_ELIGIBLE
```

or:

```text
freshness=current  status=ready  connection=live
retention=SNAPBACK_RETENTION_NOT_RQS_ELIGIBLE
```

Web did not reproduce the stuck retained state.

## Root cause

The phone did retain the server-minted resume token. The wire capture showed
it sending that token back as `resumeFromToken` on the next subscribe. Two
coupled client defects then mishandled the valid rowless resume protocol:

1. The server can emit the authoritative `current_as_of`/replay envelope on
   the durable WebSocket before the HTTP subscribe acknowledgement returns.
   The client registered its durable consumer before the request, but rejected
   the early frame because the HTTP response had not yet installed the new
   subscription ID. This stranded verified rows as retained/refreshing.
2. A rung-1/rung-2 HTTP acknowledgement intentionally has no `snapshot` or
   fresh `resume`; the fresh token rides the durable completion. The client
   interpreted the absent response token as non-eligibility even though the
   verified server-minted token used by the accepted request still proved RQS
   eligibility. Later durable frames updated `rqsResume` without repairing the
   stale retention fact.

iOS/RN exposed the first defect reliably because reconnect timing allowed the
WebSocket completion to overtake the HTTP response. The retention
misclassification reproduced on the memory carrier too and was not a Hermes
JSON, Expo file-store, or server-minting defect.

## Resolution

- Added a bounded, per-subscribe-attempt buffer for `current_as_of`,
  `live_delta`, and `live_replace` frames that arrive before the response's
  subscription ID is installed. Only frames matching the installed ID replay,
  in arrival order.
- Buffer overflow now discards the unproved prefix, clears the held token, and
  performs one serialized tokenless resubscribe for a fresh snapshot; it never
  transiently publishes the buffered prefix as current.
- A valid rowless response seeded by a held resume token preserves RQS
  retainability while completion is pending.
- A fresh resume token on `current_as_of`, `live_delta`, or `live_replace`
  repairs the Channel B retention fact alongside `rqsResume`.

## Verification

The shared memory and Expo file-carrier suite now covers:

- retainability before and after rowless rung-1 and rung-2 completion;
- `current_as_of` delivered before the subscribe HTTP response; and
- bounded-buffer overflow falling back to one fresh snapshot without a false
  current publication.

The exact candidate is additionally gated by the full `snapback-client` test
suite, package-test inventory, `./ref-check --verbose`, a clean-checkout
verification pass, and a fresh same-family review before delivery.

## 2026-08-07 — duplicate open copy removed; acceptance re-audit at HEAD

The fix commit (41c2db880, 2026-08-04, "fix(client): preserve rowless RQS
resume completion") added this resolved summary but left the original ticket in
place at `issues/20260804-rn-timeline-reports-not-rqs-eligible.md` with
"Status: Open — implementation and regressions pending", so the bug kept
presenting as unfixed. That stale duplicate is removed in this commit. The full
investigation narrative (UPDATEs 2–6: device captures, wire-tee comparison,
disproof table) remains in git history of the removed file (created at
c0089e7cd).

Re-audit of the open copy's acceptance criteria against current `main`:

- Pre-HTTP `current_as_of` not lost; handle settles retained/refreshing →
  current/ready — covered by the suite's "stream CurrentAsOf may overtake the
  rowless subscribe acknowledgement" test, which injects the durable envelope
  into the registered consumers **before** resolving the pending HTTP subscribe
  promise (true stream ordering, not the poll-drain fake the ticket called
  insufficient).
- Valid rowless rung-1/rung-2 resume stays `retainable: true` before and after
  durable completion — asserted in both the rung-1 CurrentAsOf and rung-2
  replay-delta tests.
- Overflow bound: `RQS_PRE_SUBSCRIBE_DURABLE_BUFFER_CAP = 1024` envelopes per
  subscribe attempt; overflow drops the unproved prefix, clears the token, and
  forces one serialized tokenless resubscribe (`pre_subscribe_durable_overflow`)
  with no transient current publication — covered by the overflow test.
- Existing memory and Expo RQS resume suites pass — full `snapback-client`
  suite re-run green at HEAD on 2026-08-07; the stream-ordered overtake and
  overflow tests execute on all four carrier arms (web/indexeddb, native/file,
  memory, native/expo-file-system). Neither 5fb86ebd7 (arg-filtered retention
  routing) nor 25e9674b0 (outbox-less mutation dispatch) is the fix for this
  defect; 41c2db880 carries all three mechanisms.
- `scratchpad/rn-carrier-probe.mjs` no longer exists; promotion into
  `packages/snapback-client/` is moot — the stream-ordered suite tests cover
  the concern it probed.

Honest caveat: the final criterion — the Warble RN fact line no longer showing
`NOT_RQS_ELIGIBLE` on a physical device after reload/reconnect — has not been
re-verified on a real device. The landed evidence is the stream-ordered
regression suite across the memory/native/Expo carriers. If a device session
reproduces the symptom at or after 41c2db880, file a fresh ticket rather than
reopening this one.
