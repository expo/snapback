# A1 Expo sweep: RN carrier connection cycles live→stale (~2s reconnect loop) and the retainable public query blanks permanently after the first cycle

**Opened:** 2026-08-01
**Status:** Resolved (2026-08-04 — both halves closed; see the closure
section at the end)
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

---

**2026-08-01 (A4 Expo arm narrowing):** the indefinite ~2s cycling did NOT
reproduce on the A4 arm, whose on-device surface is three protected live
queries and NO retainable public query: one spontaneous live→stale→live
cycle (~3-7s) appeared shortly after subscribe, then the connection held
`live` for a 16s idle stretch until the deliberate rotation leg, with rows
intact throughout. Consistent with the suspicion that the retainable-query
re-prime path over the memory store is implicated in the A1 cycling, not
the socket/heartbeat as such. Evidence:
demos/improvement-sweep/arms/a4-snapback-expo-ios/evidence/witness-events.json (connection transitions).

---

**2026-08-01 (fix-wave Lane β2) — partial: the carrier-agnostic halves
landed; the loop's owner identification remains simulator-gated.**

Landed in this milestone:
1. **The loss-detail instrumentation this ticket's fix-lane analysis
   recommended** — the stream manager's `lost` state detail now carries
   `closeCode`, `closeReason`, `errorPreceded`, and `sinceOpenMs`
   (additive; `#loseSocket` threads them from the close/error listeners).
   The next A1-Expo arm rerun can split an RN-stack `error`-only death
   from a server close from an upgrade refusal directly from the witness
   timeline.
2. **The permanent-blanking self-heal** — the analysis's prime suspect
   mechanism is now closed carrier-agnostically: on socket loss while a
   token-seeded resume is still unconfirmed (`pendingResumeConfirmation`),
   the client drops the unconfirmed token and demotes freshness
   `current → retained`, so the next subscribe requests a full snapshot
   and re-primes rows within one cycle instead of re-presenting a
   poisoned blank hold forever. Evidence: full client suite green over
   the change (the socket-loss leg has no isolated fake-WS test — the
   scripted-wire harness covers the poll lane; the stream-lane witness is
   the arm rerun this instrumentation exists for).

Still open (unchanged): identifying the ~2s cycle's owner needs the
simulator rerun with the new loss detail; the 60s-idle-hold Expo receipt
gate waits on that identification, per the fix-lane recommendation. The
A4-arm narrowing (retainable re-prime implicated, not the socket) is
consistent with the self-heal above materially improving the A1 symptom
even before the loop's owner is found.

---

**2026-08-03 — the simulator rerun ran (fleet MacBook Air, fresh iPhone 17
Pro / iOS 26.3 / Hermes / Release): the loop does NOT reproduce on the
0.1.8-era closure. Zero socket losses in a 120s idle hold, so there is no
close code to report — the evidence instead bounds the loop to the 0.1.7
client era and rules out both suspected owners.**

Evidence: `demos/improvement-sweep/arms/a1-snapback-expo-ios/evidence/f7-rerun-20260803/`
(runs, harness, screenshots; README has the full provenance).

**Setup.** The A1 idle shape rebuilt faithfully (provider +
`useSnapbackQuery(listSites)` public retainable + `useSnapbackQuery(listRecords)`
protected, sessions-mode on-device auth, memory rqs store, native Release
build of the frozen neutral-expo shell), plus a witness tap that forwards
every live-stream manager state transition WITH its detail payload — so the
landed `closeCode`/`closeReason`/`errorPreceded`/`sinceOpenMs` forensics
(`ed8ee8764`) land on the witness timeline the moment any loss occurs.

**Result (era-faithful arm: published 0.1.8 closure + only the `ed8ee8764`
instrumentation hunks applied verbatim, published 0.1.8 CLI/runtime dev
server, a1 backend verbatim):** one socket, `connecting → open` once, then
**zero `lost` transitions across a 120-second idle hold** — connection
`live` the whole time, sites ready (3) and records ready (3) intact at hold
end (screenshot). `totalLost: 0`, so the loss-signature histogram is empty.

**What this supports:**

1. **The server idle policy is exonerated** for this loop: the 0.1.8 server
   held a fully idle socket for 120s without closing it (the loop period was
   ~2s). A server-side idle-policy fix has nothing to fix.
2. **The RN WebSocket stack as such is exonerated**: the same simulator
   class, RN 0.86.2/Hermes, and carrier held `live` for the full hold. The
   loop was not an inherent RN-stack behavior.
3. **The loop is bounded to the 0.1.7 client closure** the original arm ran
   (the only era it was ever observed in). The between-arms fix wave that
   shipped in 0.1.8 (rotation settle/park, provenance classification, RN
   error-event/lifecycle handling — `e1f9ac493` and siblings) most plausibly
   removed the trigger. With `attempts`-reset cycling no longer observable,
   the fix-lane's suspect list cannot be narrowed further by measurement.
4. The ticket's acceptance witness — idle provider with one public + one
   protected query holds `live` for 60s with rows intact, matching node —
   **passed** (at 120s) on the 0.1.8-era packages.

**Caveat — origin/main could not be observed:** at HEAD (`a4b3a3f4d`) the
RN carrier is bricked before any socket exists — `Array.prototype.toSorted`
(ES2023, absent from Hermes) in `registration-ledger.mjs` fails every
subscribe, and the provider retries without backoff. That NEW regression is
filed as
`issues/20260803-rn-carrier-bricked-tosorted-registration-ledger.md` and
gates any HEAD-sha confirmation rerun. The loss-detail instrumentation
itself is verified live on-device (the tap saw `connecting`/`open` with the
detail field threaded).

**The author question, reframed by this evidence.** The pending decision
was "RN-stack workaround vs server-side idle-policy fix" — the rerun
supports *neither*: nothing currently reproduces to work around. The
decision now is disposition:

- (a) treat the ~2s loop as fixed by the 0.1.7→0.1.8 between-arms wave,
  close the loop half of this ticket on the run-4 witness, and land the
  60s-idle-hold Expo receipt gate as a *regression* gate once the toSorted
  ticket unbricks the HEAD carrier (a HEAD-sha rerun of this same harness
  is the natural gate seed); or
- (b) keep the loop half open until that HEAD-sha rerun confirms the hold
  on current packages.

Either way the permanent-blanking half stays closed by the carrier-agnostic
self-heal above, and the instrumentation stays in place to name any
recurrence's close code directly. Ticket stays OPEN for the disposition
call.

---

## 2026-08-04 — closure: HEAD-sha confirmation ran clean; loop-half closed per author decision sitting #3, ticket resolved

The disposition call landed at author decision sitting #3
(`issues/closed/20260804-author-decision-sitting-3.md`, ruling 1): confirm
once at HEAD, then close the loop-half with the idle-hold receipt as a
standing regression gate. The confirmation ran the same day.

**The run:** same harness, same fleet MacBook Air, fresh dedicated
iPhone 17 Pro / iOS 26.3.1 simulator (created for the run, deleted after) —
but this time the entire stack bound to **origin/main
`5fbea8e4d0348e7e22d0d0e90e9a7125c53eda7b`**: repo dev server (runtime
binary stamped at the sha), repo `@expo/snapback-client`/`-react`/
`-contract` overlaid on the 0.1.8 closure, HEAD-regenerated bindings,
native Release/Hermes build. That tip carries both fixes for what blocked
the 2026-08-03 HEAD legs: the Hermes `toSorted` carrier brick
(`6c650e7ad`) and the provider subscribe retry storm (`5fbea8e4d`), both
closed in `issues/closed/20260803-rn-carrier-bricked-tosorted-registration-ledger.md`.

**Result: zero `lost` transitions — in fact zero stream-state transitions
of any kind — across a 120-second idle hold**, connection `live` end to
end, sites ready (3) and records ready (3) intact at hold start and hold
end (screenshots), no query errors. The ticket's acceptance witness (idle
provider with one public + one protected query holds `live` for 60s with
rows intact, matching node) passed at 2× duration on current HEAD, the
second consecutive clean hold after the 0.1.8-era run.

**Both halves are now closed:**

- **~2s reconnect loop:** never reproduced on any post-0.1.7 closure;
  confirmed gone at HEAD `5fbea8e4d`. Closed on the sitting #3 ruling with
  the receipt as the gate (below).
- **Permanent public-query blanking:** closed 2026-08-01 by the
  carrier-agnostic `pendingResumeConfirmation` self-heal (fix-wave Lane
  β2, above), reconfirmed incidentally by both clean holds (retainable
  rows intact throughout).

**Standing regression gate:** the gate artifact is
`demos/improvement-sweep/arms/a1-snapback-expo-ios/evidence/f7-rerun-20260804-head-confirm/`
(`f7-evidence.json` receipt + hold screenshots + witness timeline; its
README records the full binding and the rerun recipe). A future rerun
executes the archived harness
(`demos/improvement-sweep/arms/a1-snapback-expo-ios/evidence/f7-rerun-20260803/harness/f7-run-ios.mjs`)
and compares against that receipt: the gate holds while
`hold.lostDuringHold.totalLost` is 0 over a ≥120s idle hold with both
queries' rows intact at hold end. Any recurrence self-identifies — the
`ed8ee8764` loss detail (closeCode/closeReason/errorPreceded/sinceOpenMs)
rides every `lost` transition.

RESOLVED and closed.
