# A1 Expo sweep: RN carrier connection cycles live→stale (~2s reconnect loop) and the retainable public query blanks permanently after the first cycle

**Opened:** 2026-08-01
**Systems:** Realtime, Client integration, React/Expo
**Related:** LLP 0137 (Track B A1 Expo iOS arm), LLP 0034 (freshness policy), demos/improvement-sweep/arms/a1-snapback-expo-ios/findings/0137-a1expo-f7-rn-connection-cycles-and-public-query-blanks.json

On the Expo simulator the provider connection reaches `live` and drops to
`stale` within ~200ms, then reconnects on a ~2s loop indefinitely, even while
idle (witness timeline in the arm evidence). Across cycles the retainable
public query (`listSites`) blanks permanently (ready/0 on-device; the same
query holds 3 rows stably on the node control against the same server), and
protected rows blank-then-refill on every cycle. Deliveries still land in
33–42ms, so the socket works at delivery time — but the UI reads `stale` with
an empty public list. Suspects: app-level heartbeat/pong activity accounting
on RN WebSocket, and the retainable resume/re-prime path over the memory
store after forced reconnects.

Fix shape: RN-carrier conformance for the heartbeat/freshness accounting and
the retainable resubscribe path; an Expo receipt gate asserting a 60s idle
hold stays `live` with public rows intact.

Witness: idle provider with one public + one protected query holds `live` for
60s on the simulator with rows intact, matching node.

## Between-arms fix-lane analysis (2026-08-01) — deep; author-gated

This lane audited the carrier-agnostic halves and the manager code; it has no
iOS simulator, so no bounded on-device diagnosis was possible. Findings from
the code audit (packages/snapback-client/index.mjs, LiveStreamManager):

**The cycle shape convicts an open-socket death, not the freshness budget.**
`attempts` resets to 0 on every successful `open`, so a stable ~2s loop with
`live` reached each cycle means the socket OPENS every time (backoff stays at
the 250ms base; loop period ≈ auth/session + grant + upgrade + ~200ms alive +
250ms backoff). The heartbeat's first tick is at +5s and the budget check
needs 15s of silence — neither can fire at ~200ms. So the killer is one of
the `#loseSocket` paths that strike an OPEN socket:

1. a real `close` event from the RN stack or the server (code/reason not
   currently witnessed);
2. a real `error` event — RN fires `error` without the browser's follow-up
   `close`, and the manager's error listener (deliberately not `once`)
   treats every error event as loss;
3. `#receiveFrame`'s authority-commit refusal — ruled out for the
   external-bearer carrier (no authorityFence, commit cannot refuse);
4. heartbeat send throw — ruled out (first tick at +5s);
5. ingress-limit 1009 close — would need an oversized frame (~64MB cap);
   implausible for the idle workload.

**Missing evidence, and the cheap instrumentation to get it:** the manager's
`'lost'` state detail carries `wasOpen` but not the close `code`/`reason`,
whether an `error` event preceded, or `sinceOpenMs`. Adding those three
fields to the loss detail (additive, carrier-agnostic) and re-running the
arm would immediately split 1/2 from everything else and likely name the RN
stack facility (e.g. a refused ping frame, an idle-timeout proxy in the
simulator bridge, or an RN WebSocket error-event quirk).

**Server half to rule out:** the one-socket-per-connection rule
(src/server.rs live_stream): confirm the server does not close a wire
connection's socket when unrelated sockets (the arm's queue client and
headless probes used distinct connectionIds/clientStoreIds) authenticate
concurrently under the same bearer.

**The permanent public-query blanking is a distinct deep mechanism.**
Nothing on the loss path blanks rows ('stale' keeps last-known rows), so the
ready/0 presentation implies an empty answer was published as authoritative
— the prime suspect is the RQS resume path: a fresh subscribe seeded with a
resume token can be answered WITHOUT a snapshot (rung 1/2 "answer pending",
`pendingResumeConfirmation`); if the socket dies before the confirming
current_as_of/live_delta lands, whatever the handle held (blank, after any
earlier blanking event) stays presented. A node-side conformance test that
forces socket loss between a token-seeded resubscribe and its confirmation
could reproduce this carrier-agnostically if the mechanism is right.

**Interplay with this lane's landed fixes:** the a1expo-f4 fix (parked
handles + denial facts) removes the rotation-path wedge and the f1 fix
removes the boot blocker, but NEITHER touches this reconnect loop; the
rewritten guide/clients/react-expo.md now discloses this issue as a known
limitation with a pointer here.

Recommended next step (author decision): land the loss-detail
instrumentation (small, additive), rerun the A1-Expo arm to capture close
code/reason + sinceOpenMs, then decide between the RN-stack workaround and
a server-side idle policy fix. The 60s-idle-hold Expo receipt gate from the
fix shape should be added only once the loop's owner is identified.
