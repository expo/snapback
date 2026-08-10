# Offline-proof choreography: undocumented retention flush latency; release export silently prunes baked supervisor origin

**Filed:** 2026-08-08 (run-6 N≥3 series residue, round 4; diary 0072; record 2026-08-08-messaging-0115-n3.md)

Two coupled discoveries that made honest offline proofs trial-and-error in three lanes: (1) retained-query rows flush to IndexedDB/disk on a debounce (~seconds) — a client killed too soon after a write loses rows, and no doc states the flush window or a flush-now affordance beyond flush-on-background; (2) a production `expo export --platform web` prunes the supervised binding lane (NODE_ENV guard), so `EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN` baked into a release export silently disappears — and a `--dev` static export can enter an HMR reload loop (A-skill lane).

**Ask:** document the flush window + the NODE_ENV prune on the offline page; consider a `flush()` affordance and a non-HMR dev-export lane for static offline proofs.

## Resolution — 2026-08-10

Verified both traps are documented on the offline page (the trailing
1-second persist debounce with 10-second max delay and no public flush-now
call, hide/pagehide forced flush, the Node wait workaround; and
`NODE_ENV === 'production'` pruning the supervised Expo origin lane with the
resulting `SNAPBACK_APP_BINDING_UNAVAILABLE` plus the development-condition /
explicit-binding alternatives) — claims checked against
`packages/snapback-client/index.mjs` and
`packages/snapback-expo/supervised-environment.mjs`. A public `flush()`
affordance and a non-HMR static dev-export lane remain unclaimed product
options; re-file on demand.
