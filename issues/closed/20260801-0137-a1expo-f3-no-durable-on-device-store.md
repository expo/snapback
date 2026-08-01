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

---

## RESOLVED (2026-08-01, B1 lane — the witness this ticket held is now green on-device)

The adapter ticket (issues/closed/20260725-rqs-native-ondevice-adapter.md)
delivered the RN store arm: expo-file-system files adapter + default-ladder
React Native rung behind a one-line app-root registration
(`registerExpoFileSystemRqsFiles(FileSystem)`), same persisted-entry
contract and DK-9 reporting as the web/node arms, full Channel B resume
suite green on the new arm.

This ticket's own witness sentence ran verbatim on the iOS simulator
(release Hermes build, real expo-file-system, published 0.1.8 closure +
the branch client delta): the retainable public query cold-boots offline
with `freshness: retained` / `connection: stale`, and the store blob holds
the retainable rows while the protected sentinel is NOT at rest
(demos/rn-durable-store-witness/evidence/b1-witness.json, shots 0-1).
Unregistered RN now resolves memory with the actionable reason
`no-native-files-registered` instead of the generic no-durable-backend.
guide/clients/react-expo.md documents mobile retention, the flush wiring,
and the one-client-per-app sharp edge
(issues/20260801-rqs-default-store-lifecycle-sequential-clients.md).
The LLP 0129 default-persistence promise now reaches the Expo carrier
through the documented explicit registration (0129 dated note, 2026-08-01).
