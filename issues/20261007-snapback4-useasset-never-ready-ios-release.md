# Snapback 4: useAsset never became ready for an ordinary image in an iOS Release app

**Opened:** 2026-10-07, from the native Phase-2 rerun (LLP 0201.000, native.2)
**Status:** Open; cause not established
**Area:** `snapback4-expo` / `snapback4` asset hooks (`useAsset`) on iOS Release builds
**Related:** LLP 0201.000; the pilot packet on the Apartment mini, `~/clique-native-pilot2-20261006-round2`, which holds `results/snapback4/attempt-02/m6` and `attempt-03/m8`, plus `preparation/revision10/DIAGNOSIS.md`

## What happened

An independently built Snapback 4 0.4.13 Expo app passed both source audits and the semantic handoff. Its Release build installed and launched on the dedicated iOS 27 simulator, signed in, and rendered the direct conversation with its history. The ordinary-media message rendered its text, but **never its image**. The app declares `sm-convo-media` only when `useAsset` returns a ready handle, so the driver's M6 and M8 primes ended unmeasured with `selector-not-hittable`.

The evidence (P3 round-1 diagnosis):
- both fixture images match the descriptor SHA-256 and have the correct metadata (640×480);
- the message and asset references reached the native device store (read-only SQLite inspection);
- the observer recorded 120 screen events and 4 ready events, but **no media load or error events**;
- **the backend logs show no asset request,** and the app log shows no asset or download error.

So the hook apparently never issued a fetch, and never surfaced a refusal either. It could be:
- a Snapback 4 client bug on the native or Release path (scheduling, acquisition, the native asset URI or headers);
- an unmet precondition the hook waits on silently;
- the builder's wiring.

A silent wait with no request and no refusal looks like a product problem whichever of these it is. The hook should either fetch or say why it isn't.

## Next steps

1. Reproduce with a minimal Expo Release app on the simulator: a seeded ordinary image, rendered through `useAsset`.
2. Instrument the hook's state transitions.
3. Fix it, or add a diagnostic that names the blocking precondition.
