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
