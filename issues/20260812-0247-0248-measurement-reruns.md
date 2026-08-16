# LLP 0247 rollout 6 + LLP 0248 rollout 6: Clique-shaped measurement reruns

**Opened:** 2026-08-12 (ordinary-TS authoring wave, run llp0245-0249-ordinary-ts-20260812)

Both RFCs close with fresh-app measurement reruns that need a reproducible
control:

- LLP 0240 / LLP 0236 open question 9: rerun both Clique authoring profiles
  from the published package, require the declared authority-profile path for
  member/admin handlers, and report whether any duplicated imperative
  membership guard remains. This rerun is the evidence gate for competitive
  effect; the repository implementation alone makes no such claim.
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
digest.

- [x] LLP 0248 rollout 5's N+1 dev diagnostic: implemented 2026-08-15 as the
  flag-only codegen advisory `SNAPBACK_AUTHORING_N_PLUS_ONE_BATCH_READ`
  (proven-executions rule: unconditional same-table get/complete-unique call
  sites only); it never rewrites handler source.
- [ ] The Cloudflare DO host-op twin stays a declared capability gap until it
  composes LLP 0231 visibility.

## Update (2026-08-15)

Author ruling (Charlie, 2026-08-15, recorded by orchestrating agent session):
the messaging choreography rerun uses a **FRESH LLP 0201 rig run against the
published 0.1.22 packages** (not the `demos/messaging-snapback` surrogate).
Numbers land as LLP 0189 calibration evidence unless bound to a scoped
qualification digest.
