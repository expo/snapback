# Offline-proof choreography: undocumented retention flush latency; release export silently prunes baked supervisor origin

**Filed:** 2026-08-08 (run-6 N≥3 series residue, round 4; diary 0072; record 2026-08-08-messaging-0115-n3.md)

Two coupled discoveries that made honest offline proofs trial-and-error in three lanes: (1) retained-query rows flush to IndexedDB/disk on a debounce (~seconds) — a client killed too soon after a write loses rows, and no doc states the flush window or a flush-now affordance beyond flush-on-background; (2) a production `expo export --platform web` prunes the supervised binding lane (NODE_ENV guard), so `EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN` baked into a release export silently disappears — and a `--dev` static export can enter an HMR reload loop (A-skill lane).

**Ask:** document the flush window + the NODE_ENV prune on the offline page; consider a `flush()` affordance and a non-HMR dev-export lane for static offline proofs.
