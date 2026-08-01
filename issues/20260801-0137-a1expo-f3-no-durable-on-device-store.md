# A1 Expo sweep: no durable on-device rqs store arm — the LLP 0129 default-persistence promise does not extend to the Expo carrier

**Opened:** 2026-08-01
**Systems:** Offline sync, Client integration, React/Expo
**Related:** LLP 0137 (Track B A1 Expo iOS arm), LLP 0129, LLP 0090, demos/improvement-sweep/arms/a1-snapback-expo-ios/findings/0137-a1expo-f3-no-durable-on-device-rqs-store-arm.json

The default persistence ladder (rqs-store-default.mjs) has no React Native
arm: explicit option → env off → browser IndexedDB → node filesystem →
in-memory. On Expo every client silently resolves the memory store
(`{implementation:'memory', durable:false}`), so there is no cold-boot
retained render and (even after the f2 fix) no restart-durable queue on
mobile — the platform whose users are most often offline. The arm's
cold-restart leg shows the honest but empty outcome: relaunch offline renders
nothing.

Fix shape: an RN store arm implementing the persisted-entry contract that
rqs-store-file.mjs already defines (expo-file-system or SQLite backing),
selected by the ladder with the same DK-9 capability reporting; document
mobile retention on the react-expo page. Preserve refuse-with-clarity: no
protected bytes at rest outside lease custody.

Witness: retainable public query cold-boots offline on the simulator with
freshness `retained` / connection `stale`; sentinel grep shows no protected
bytes at rest.

## Cross-reference (2026-08-01, between-arms fix lane)

DESIGN item — deliberately not implemented in this lane. The build-out is
owned by the pre-existing ticket
issues/20260725-rqs-native-ondevice-adapter.md (LLP 0129's on-device
adapter: expo-file-system/SQLite files adapter for the nine-method seam in
rqs-store-file.mjs + device-harness proof + lifecycle flush wiring); a dated
sweep-evidence section pointing back at this arm's findings was added there.
Related lane changes that reshape this ticket's context: a1expo-f2's
connectivity-classification fix means the queue now ENGAGES on Expo (the
remaining gap is restart durability only), and the rewritten
guide/clients/react-expo.md documents the memory-store consequence honestly
(no cold-boot retention claim, `client.rqsStoreInfo` as the renderable
fact). This ticket stays open as the sweep-side witness holder until the
adapter ticket closes.

---

**Triage correction (2026-08-01, fix-wave Lane β2):** the fix-now ranking
was wrong — this is a DESIGN item explicitly owned by
`issues/20260725-rqs-native-ondevice-adapter.md` (the LLP 0129 on-device
adapter), as the cross-reference above already records. No implementation
here; the ticket stays open as the sweep-side witness holder per its own
routing. Removed from the fix-wave's executable set.
