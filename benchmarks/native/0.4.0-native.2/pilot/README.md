# Unscored native.2 Phase-2 rerun packet

This is the fresh, dry-run-only successor to the retained native.1 Phase-2
packet. It prepares two independent `gpt-6-astra`, medium builder lanes in the
fixed order Snapback 4 then Convex, with the same four-hour / two-million
non-cached-token milestone ceilings and one cumulative four-hour replay ceiling.
Pins remain Snapback 4 / Expo 0.4.13, Convex 1.45.0, Expo 57.0.22, React Native
0.86.3, Xcode 27.0 (27A266a), Node 24.18.0 and Playwright 1.62.1. M7 remains
excluded. Scored use, O4 and overall scores remain disabled.

Do not launch either builder from packet preparation. Charlie will authorize the
fresh Phase-2 rerun after review. Dry-run readiness ends after
`python3 scripts/verify.py --cold --ready` succeeds with both lanes containing
only their symmetric `instrument` link.

## Fresh packet preparation

Create `~/clique-native-pilot2-20261006/` on the Apartment mini only. Never use
the black M5 or office M1. Materialize the frozen native.2 and inherited web
components, copy this `pilot/` directory to the packet root, retain the sealed
Convex binary, create the pinned Python/Playwright runtime, and then run:

```sh
source ~/.snapback-env.sh
cd ~/clique-native-pilot2-20261006
python3 scripts/assemble.py
bash scripts/prepare-runtime.sh
python3 scripts/toolchain.py
python3 scripts/runtime_proof.py --proof /Users/ccheever/ni2-runtime-20261006-r4/proof
python3 scripts/record-convex-preflight.py
python3 scripts/preflight.py
runtime/venv/bin/python scripts/selftest.py
python3 scripts/seal.py
python3 scripts/verify.py --cold --ready
```

`prepare-runtime.sh` installs the retained exact Python dependencies and the
Convex 1.45.0 / ws 8.18.3 / Playwright 1.62.1 operator runtime from committed
locks. `record-convex-preflight.py` owns the exact retained Convex proof command
and writes its hash-bound readiness metadata. `runtime_proof.py` copies and binds
the executed Release runtime proof into `preparation/runtime-baseline/`; a
compile receipt is insufficient. Readiness rehashes the runtime/helper/UI
inputs, signed entitlements, app native/Hermes identities, native.2 runner,
launch-through-restore video and every retained proof artifact.

`launch-builder.sh`, `after-builder.sh`, and `pilot-chain.sh` are executable
only after the dry-run review. Do not invoke them while preparing this packet.
When authorized, the ordinary chain is still Snapback 4 builder → custody/audit/
measurement → Convex builder → custody/audit/measurement. No historical
continuation or retained native.1 app is admissible in this fresh packet.

## Native.2 admission changes

The actual seed runs once against a disposable operator-owned backend after
preparation and both source audits, before Release compilation or device work.
The harness validates its descriptor with the shared helper against a fresh
operator UUID. Exact ordered bodies are `<runId>:first` and `<runId>:second`;
foreign run IDs and both retained Round-7 formats refuse the handoff.

The auditor requires observer calls to be nonthrowing and fire-and-forget,
current-data/viewability reconciliation through the committed-list adapter,
empty-search agreement, and sticky journal failure/overflow visible to the
driver without changing product behavior. It rejects any Bob oracle transport
with a delivery/mutation write path. It also checks the disclosed UIScene
lifecycle and Release SecureStore entitlements; unsigned Release products are
inadmissible.

Packet readiness requires the backend-neutral runtime proof before builder
authoring. The proof launches through the generic XCTest driver, resets storage
through ordinary UI, performs a SecureStore write/read, terminates, relaunches
the same installation, restores the exact fresh principal, observes two helper
process nonces and validates the complete video.

## Retained harness fixes

Native.2 starts from revision 7 and keeps every disclosed repair:

- normalized non-cached input plus output token accounting, without double
  counting reasoning or capping cache traffic;
- PID/start/ownership child tracking and verified TERM/KILL cleanup;
- narrow native tool/cache access, scoped SwiftPM manifest-sandbox preference,
  restored preferences and quarantined new default DerivedData;
- any number of nonoverlapping M6/M8 replay intervals sharing one cumulative
  14,400-second ceiling;
- APFS work-copy relocation of lane-internal absolute links with external link
  refusal;
- both one-argument generic-simulator and two-argument dedicated-UDID Release
  wrappers, followed by independent arm64 IOSSIMULATOR product checks;
- sealed operator environment facts in both source audits;
- the normal operator build environment for diagnostic Expo Swift macro
  expansion; and
- cleanup comparisons over the same bundle/native/Hermes identity fields while
  platform metadata remains separately retained.

The revision 2–7 documents remain here as historical provenance for those
repairs. Their one-use continuation commands and native.1 reclassifications do
not apply to a fresh native.2 packet.

All attempts, source audits, preparation, exact descriptors, runner logs and
evidence remain durable. Evidence over 1 MB belongs in the eb1000 evidence
archive with a committed hash index, outside the repository. A setup rerun is
available only under the retained operator-only repair rule; product retries
remain zero. Full video/frame/tree/recycled-row/receipt review is mandatory
before any pilot or scored-admission conclusion.
