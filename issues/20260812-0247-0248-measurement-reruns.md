# LLP 0247 rollout 6 + LLP 0248 rollout 6: Clique-shaped measurement reruns

**Opened:** 2026-08-12 (ordinary-TS authoring wave, run llp0245-0249-ordinary-ts-20260812)

Both RFCs close with fresh-app measurement reruns that need a reproducible
control:

- LLP 0247 rollout 6: rerun the Clique messaging/auth choreography from a
  fresh npm app over the landed normalization/recovery surface.
- LLP 0248 rollout 6: rerun the feed-hydration control against batch reads
  and publish round-trip/read-amplification numbers (host-call and latency
  reduction, no declarative-eligibility claims).

The out-of-repo Clique P2 artifacts are not reproducible from a checkout
(`/Users/ccheever/clique-runs/p2-pilot/`, flagged contaminated in the P2
record); `demos/messaging-snapback` is the closest in-repo surrogate. Either
run the LLP 0201 benchmark rig fresh, or build the control on
`demos/messaging-snapback` and label it a surrogate. Numbers land as
calibration evidence per LLP 0189 unless bound to a scoped qualification
digest. Also owed from LLP 0248: rollout 5's N+1 dev diagnostic (flag
repeated same-table get/unique loops; never rewrite), and the Cloudflare DO
host-op twin stays a declared capability gap until it composes LLP 0231
visibility.
