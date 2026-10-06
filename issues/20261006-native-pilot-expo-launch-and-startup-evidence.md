# Native pilot: qualify the Expo launch path and retain startup evidence

**Opened:** 2026-10-06, P2A Round 7
**Status:** Open; native.2 runtime repair qualified, independent Phase-2 rerun pending
**Area:** shared pilot preparation, generic native driver's startup diagnostics
**Related:** LLP 0201.000 §7, LLP 3000.030 §13;
[Phase-2 results](../snapback4/reports/20261005-ni-native-protocol/PHASE-2-RESULTS.md)

The seed-format-only Convex diagnostic builds Release successfully, installs
with matching native/Hermes identities, then exits before the sign-in UI in both
M6 and M8. The dedicated iOS 27 simulator logs explicitly report that this SDK
requires the UIScene lifecycle. Crash PIDs 4220 and 5294 terminate with SIGTRAP;
their triggered threads begin at
`___UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption_block_invoke`.
The built Info.plist uses SDK 27.0 and has no scene manifest. Every frame of both
retained XCTest launch videos shows home → black launch surface → home.

The qualified NI reference preparation explicitly supplies
`reference/scene-plugin.cjs`, while the independent Convex builder view excludes
reference source. Snapback's public Expo package documents its own plugin and
the SB4 builder includes it. Do not infer a cross-backend product comparison
from this platform-scaffolding difference. Supply a disclosed backend-neutral
scene-lifecycle recipe/aid symmetrically, or qualify another compatible shared
Expo/toolchain baseline. Run an actual minimal Release launch during packet
preparation; compilation alone did not detect this issue. No such repair belongs
in the retained Round-7 app.

The generic driver reports `selector-not-hittable`, `outcomeClass: setup`, empty
`launches`, incomplete prime, zero measured steps and null assertions. That
withholds unsupported credit correctly, but the launch array records helper
nonces rather than attempted OS launches. It cannot distinguish these actual
startup crashes from the earlier never-launched seed failure. Independent
validation then rejects both at `schema-invalid:run:launches` (the existing
[launch-schema ticket](./20261006-native-pilot-unmeasured-launch-schema-and-failure-snapshot.md)).

SB4 includes the published scene plugin and launches, but both M6/M8 stay on
sign-in with a visible SecureStore `getValueWithKeyAsync` error: a required
entitlement is absent. Both complete 87-node native trees and screenshots agree.
Read-only signature inspection shows a linker ad-hoc signature with no
entitlements. Its unchanged builder wrapper uses `CODE_SIGNING_ALLOWED=NO`,
also the shared handoff example's setting. Qualify and document a Release
signing/entitlement path that supports the app's normal auth storage. Do not
replace SecureStore or sign these retained products as a diagnostic repair.

SB4's command-loop XCTest succeeds despite the outer driver's null result, so
XCTest retains no video attachments. The protocol recorder begins only after
prime. Both full attachment exports are empty: continuous startup video is
therefore unavailable even though useful failure frames/trees exist. Retain
video from launch through priming failure in the next candidate, independently
of XCTest's banner. No user-visible state in the present artifacts supports
granting any of the nine functional assertions.

Qualify state-aware startup diagnostics: record attempted launches independently
of helper observations, retain the original error, inspect actual app state
before requesting a screenshot, and capture filtered crash evidence by bundle,
PID, simulator and launch time. Keep priming observations and any available
XCTest video/tree attachments when no measured-phase video can exist. Distinguish
an absent selector in a live app from an app that exited. Never invent a launch
nonce or relax prerequisites for a measured pass.

Record the diagnostic subprocess environment so XCTest can find `simctl` even
when the machine default developer directory is CommandLineTools. Requalify the
affected driver/schema cases and fresh independent pilot milestones after the
candidate changes; these retained null outcomes remain diagnostic only.

## NI2 repair status — 2026-10-06

The native.2 candidate ships the scene-lifecycle and app-target
simulator-signing recipes to both builders, removes the global
`CODE_SIGN_ENTITLEMENTS` example, retains startup video independently of
measured video, records OS launch attempts separately from helper nonces, checks
app state before failure capture, and pins the Apple tool environment for XCTest
diagnostics.

The packet prerequisite was exercised as a Release Expo 57.0.22 / RN 0.86.3 /
iOS SDK 27 app through the generic launch path. Its eight checks covered a real
SecureStore write/read, first-process termination and restoration in a second
process. The final retained video decodes to 840 frames over 45.62 seconds. The
[NI2 qualification report](../snapback4/reports/20261006-ni2-native-instrument/README.md)
is the authority for the final source identity, qualification anchor and
evidence.

This qualifies the shared runtime baseline, not either retained builder app.
Both retained Convex runs reproduced the expected UIScene setup-null outcome;
both retained Snapback 4 runs reproduced the expected foreground SecureStore
entitlement setup-null outcome. The fresh packet is sealed and dry-run ready; the
Phase-2 rerun remains pending. `scoredUse` remains false, and no pilot was
launched as part of NI2 qualification.
