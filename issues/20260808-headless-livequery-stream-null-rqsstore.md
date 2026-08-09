# Headless liveQuery stream transport with rqsStore:null refuses OFFLINE_UNAVAILABLE against a live server

**Filed:** 2026-08-08 (run-6 N≥3 series residue, round 4; diary 0072; record 2026-08-08-messaging-0115-n3.md)

`liveQuery({transport:'stream'})` on a headless client constructed with `rqsStore: null` refuses `SNAPBACK_QUERY_OFFLINE_UNAVAILABLE` even though the server is reachable (B-native lane; switched to polling `client.query` as workaround).

**Ask:** either support the stream transport without a resume store, or refuse with a code that names the actual constraint (resume store required for stream transport), not an offline claim.
