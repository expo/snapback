# RQS Channel B native store: on-device adapter + device-harness proof

**Status:** Open
**Impact:** 4
**Urgency:** 3
**Ease:** 2
**Confidence:** 4
**Score reviewed:** 2026-07-26
**Score rationale:** The ticket evidence for “RQS Channel B native store: on-device adapter + device-harness proof” shows the issue materially affects a supported product or engineering path; it belongs in the current program but is not an immediate blocker, while the repair crosses several runtime, host, protocol, or policy seams, with specific cited code, progress, or acceptance criteria.

**Opened:** 2026-07-25
**Systems:** Client integration, Sync
**Related:** LLP 0090 (D3, rollout step 5), LLP 0091 (step-5 native
persistence-knobs amendment), LLP 0008 (DK-9), ENG-25446/ENG-25456

## What landed (step 5, native half)

`packages/snapback-client/rqs-store-file.mjs` — the DK-9 file-backed
persisted RQS resume store: same entry contract as the web/IndexedDB arm,
atomic temp-write+rename commits, on-disk single-writer lock with
liveness-based staleness, shared budget/eviction bookkeeping, per-identity
blob keying with the LLP 0053 user-switch wipe, and the DK-9 corrupt-bytes
posture. The full step-5 acceptance list runs against it on the Node harness
(`rqs-resume-native.test.mjs`, via the store-parameterized
`rqs-resume-suite.mjs`) plus 11 store-unit obligations
(`rqs-store-file.test.mjs`). The client wiring in `index.mjs` was already
store-agnostic; no client changes were needed beyond comments.

## What remains (this ticket)

The store is *designed* for the native side of the Hermes/Ibex boundary
(the `files` adapter is injected; `node:fs` is only the default, loaded
lazily so bundling for Hermes never resolves the builtin), but nothing yet
*executes* it on-device:

1. **A platform files adapter.** An `expo-file-system` (or SQLite, per
   DK-9's reference-implementation preference) adapter for React
   Native/Hermes hosts, implementing the nine adapter methods
   (`mkdir`/`readFile`/`writeFile`/`writeFileExclusive`/`rename`/`unlink`/
   `readdir`/`processId`/`processAlive`). Single-app-process platforms can
   stub `processAlive` (the same-process registry already carries the
   in-process case); `writeFileExclusive` needs a real exclusive-create.
2. **A device/Hermes harness proof.** Run the relaunch-renders-persisted /
   refreshed-token / corrupt-fail-closed slice of the acceptance list under
   an actual Hermes runtime (the chat-matrix expo demo is the natural host:
   it already runs `@snapback/client` on RN Hermes and would demo instant
   relaunch paint).
3. **Host lifecycle flush wiring.** Per the LLP 0091 step-5 native
   amendment, the embedding shell should call `handle.flushResumeState()`
   on app-background/scene-inactive. The expo demo adoption in (2) is the
   reference wiring; a guide snippet belongs with it (guide-gap: the guide's
   client-arms pages do not yet mention Channel B persistence at all —
   absorb the whole step-5 surface, web + native, into a guide page or
   capability-index row when it graduates from beta).

## Notes

- Do not build a parallel persistence stack for (1); the adapter seam in
  `rqs-store-file.mjs` is the extension point.
- At-rest posture is OS-level protection (LLP 0090 Q4 open); an encrypting
  adapter is Q4's call, not this ticket's.

## Status note (2026-07-30 triage)

Verified still fully open and agent-executable (no LLP gate, no author
decision): no RN/Hermes files adapter exists (the nine-method adapter
surface appears only in packages/snapback-client/rqs-store-file.mjs and its
tests), and no flushResumeState lifecycle wiring exists in any demo source.
Large — adapter + device-harness proof + chat-matrix adoption + guide
absorption. This is a natural next large executable now that the 0093
medium tranche has landed.

## Sweep evidence (2026-08-01, LLP 0137 A1-Expo arm — a1expo-f3)

The Track B A1 field-notebook arm on the Expo iOS simulator produced direct
product evidence for this ticket
(issues/20260801-0137-a1expo-f3-no-durable-on-device-store.md, arm finding
demos/improvement-sweep/arms/a1-snapback-expo-ios/findings/0137-a1expo-f3-no-durable-on-device-rqs-store-arm.json):
the default ladder (rqs-store-default.mjs) has no RN arm, every Expo client
silently resolves `{implementation:'memory', durable:false}`, the cold-restart
leg renders nothing offline (shot-06 in the arm evidence), and — after the
a1expo-f2 classification fix — the M2 queue engages on the carrier but is
not restart-durable, on exactly the platform whose users are most often
offline. The arm's acceptance witness for this ticket: a retainable public
query cold-boots offline on the simulator with freshness `retained` /
connection `stale`, and a sentinel grep shows no protected bytes at rest.
The rewritten guide/clients/react-expo.md now documents the memory-store
consequence with a pointer here; keep that page in the update set when the
adapter lands.

## Triage freshness note (2026-08-01 sweep)

Still valid and now item 3 of the prioritized 0.1.8+ improvement
program (demos/improvement-sweep/reports/sweep-report.md §4 — 'the
single change that makes Track B's A1 contract meetable').
issues/20260801-0137-a1expo-f3-no-durable-on-device-store.md is the
sweep-side witness holder for the SAME item — split ownership, not a
competing design. The a1expo-f2 fix (e1f9ac49) narrowed the residual:
the M2 queue now engages on Expo, so what remains is the durable store
arm (restart durability + cold-boot retained render). The store ladder
still excludes RN (packages/snapback-client/rqs-store-default.mjs:83).
