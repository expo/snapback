# LLP 0258 Phase 2 iOS dual review — grok

- **Family:** grok
- **Provider/runtime:** grok-4.6 (this session, read-only adversarial review)
- **Date:** 2026-08-16
- **Redacted:** no
- **Method:** scoped dual review of `04f9af7d2` (share-extension probe + iOS PASS bundle) and `7942b3b43` (HEAD iOS admission flip). Not an LLP 0005 document loop; not the authoring session for either commit.
- **Commits:**
  - `04f9af7d2` `feat(demos,evidence): iOS share-extension refusal probe — full iOS PASS bundle`
  - `7942b3b43` `feat(expo,guide): admit iOS native custody on its completed evidence — Phase 2 closes`

## Summary

The extension arm really does call the production single-runtime gate: `SnapbackExpoCustodyExtensionProbe.read` is in the same Core compilation unit as `SnapbackExpoCustodyCore.read`, the Expo module calls that same singleton, and the share target links only `SnapbackExpoCustody/Core`. The committed receipt `20260817T005627Z-7a5041db-phase2-ios` is an unqualified 43-probe PASS whose P4 row records exact `SNAPBACK_AUTH_CUSTODY_SINGLE_RUNTIME_REFUSED`, `ioOccurred: false`, `com.apple.share-services`, bundle `dev.snapback.custodyprobes.share`, PIDs 17667 ≠ 17638, XCUITest exit 0 / not timed out, and a post-drive authenticated relaunch. The HEAD resolver change is the Android tuple generalized (`os === host && host ∈ qualified && grade === single-runtime`), with the same sentinel, typed unavailability, and override precedence, and the provider tests now pin both OS matrices.

The flip’s claim surface is incomplete. Capability rows, closed tickets, and the new LLP 0258 iOS-flip record are honest and unpublished, but the intent-indexed journey pages those rows route to — and the generated flat HEAD itself commits — still say iOS is refused.

## Check results

1. **Production gate, not a reimplementation; report not forgeable via the production path.** Holds. `ShareViewController` calls `SnapbackExpoCustodyExtensionProbe.read` → `snapbackExpoCustodyCore.read` → `singleRuntimeRefusal` before any `CustodyIOTracker` / `SecItemCopyMatching`. The Expo module is a thin wrapper over the same singleton. The share/NSE targets depend on the Core subspec only. `native-custody.test.mjs` pins that source sharing. The extension reads `NSExtensionPointIdentifier` from its own `Bundle.main` Info.plist. The main app plist has no `NSExtension`, so the production probe cannot emit `com.apple.share-services` or an app-extension refusal from the main process; a same-PID report would fail the concurrent main-PID sample.
2. **Harness P4 cannot false-PASS on the committed path.** Holds for the live arm, with defense-in-depth gaps noted below. `/extension-result` accepts only the closed eight-field schema (extra keys such as `bearer` → 400). The step requires exact code, `ioOccurred: false`, share-services, `.share` bundle id, distinct PIDs, `mechanism === 'XCUITest-driven share sheet'`, `testTarget === 'NativeCustodyProbesUITests'`, `exitStatus === 0`, and `timedOut === false`. Wait/XCUITest timeouts fail. The committed XCUITest log ends `TEST SUCCEEDED`.
3. **Flip mirrors the reviewed Android admission.** Holds in the resolver and tests. Android’s `os === 'android' && grade === 'single-runtime'` becomes `os === operatingSystem && QUALIFIED.includes(os) && grade === 'single-runtime'`. Absent/unlinked/invalid still throw `SNAPBACK_AUTH_CUSTODY_DURABLE_UNAVAILABLE` with the cause code. Unknown hosts still return the identical sentinel without loading the module. The override seam still wins before OS/module resolution. Tests now loop both OSes for admit, non-qualifying grade, cross-OS report, unknown host, and typed refusals.
4. **Rows/tickets/LLP vs receipts.** Capability rows, both closed Phase 2 tickets, and the dated LLP 0258 iOS-flip paragraph match the receipt (source-current `single-runtime`, UNPUBLISHED, share-sheet-kind-only, NSE not invokable via `simctl push`, (D)/backup/fencing nonclaims). The journey pages and generated auth flat still contradict that. See finding 1.
5. **No bearer/secret in the extension report or committed evidence.** Holds. The report is a closed field set. Director rejects supernumerary keys. Witness events use a different schema. P6 recorded a clean leakage scan (11 secret literals, 0 findings). `director.log` has no bearer/password/recovery literals. The device log is an honest sha256 stub of a host-retained, already-scanned capture.
6. **Tests pin the admitted/refused matrix for both OSes.** Holds. `provider-native-custody.test.mjs` admits `android|ios` + `single-runtime`, returns the byte-identical sentinel for durable/volatile/cross-OS/unknown-report cells, returns the sentinel without loading custody for `web|unknown`, and refuses typed before client construction for malformed/unlinked/absent on both OSes. The iOS-only end-to-end refusal test is correctly removed.

## Verdicts

| Commit | Verdict |
|---|---|
| `04f9af7d2` (extension probe + PASS bundle) | **READY** |
| `7942b3b43` (HEAD iOS admission flip) | **NOT READY** |

---

## Findings

### 1. MATERIAL, IN-DELTA (`7942b3b43`) — journey pages still refuse iOS after the flip

- **Where:** `guide/auth/passwords.md:283-284`, `guide/auth/passwords.md:499-500`, `guide/clients/react-expo.md:52-53`, and the same sentences HEAD committed in `guide/guide-flat.generated.md:2998-2999` and `guide/guide-flat.generated.md:3215`.
- **What’s wrong:** The flip commit updates the capability rows and LLP 0258 to “source-current iOS and Android … UNPUBLISHED”, then routes `auth.application-bootstrap-native-custody` at `auth/passwords.md`. That page — and `clients/react-expo.md` — still say iOS “stays on the evidence sentinel” / “remains evidence-gated and refused” pending `issues/20260816-ios-extension-refusal-probe.md` (now closed). Android admission `7f3607781` updated these exact paragraphs. This flip did not. `guide-flat.auth.generated.md` was not regenerated. An agent following the ordinary password/Expo journey is told the opposite of the resolver.
- **Fix:** Rewrite those paragraphs to match the capability rows (both OS arms source-current at `single-runtime`, unpublished behind `issues/20260816-custody-first-publish-gate.md`, share-sheet-kind-only, NSE/`simctl push` nonclaim). Regenerate the auth/clients flats. Refresh the pages’ `reviewed-authorities-digest` (both list `provider.mjs` and LLP 0258).

### 2. MINOR, IN-DELTA (`7942b3b43`) — cited first-publish ticket still says iOS is refused

- **Where:** `issues/20260816-custody-first-publish-gate.md:44-45`.
- **What’s wrong:** The ceremony addendum, written after the Android flip, still says “iOS remains refused per issues/20260816-ios-extension-refusal-probe.md”. The flip cites this ticket as the publication gate. A ceremony runner who follows it will publish an Android-only README grade row against a source tree that now admits iOS.
- **Fix:** Add a dated iOS-flip addendum: both OS arms are source-current and unpublished; the README grade table at first publish must name both.

### 3. MINOR, IN-DELTA (`7942b3b43`) — Phase 3 closure paragraph still lists Phase 2 as remaining

- **Where:** `llp/0258-first-party-application-auth-bootstrap.rfc.md:1062-1064`.
- **What’s wrong:** The new remaining-closure bullet correctly drops Phase 2, but the earlier Phase 3 closure sentence still says “remaining closure is the Phase 2 and Phase 4 tickets”.
- **Fix:** Strike Phase 2 from that sentence.

### 4. MINOR, IN-DELTA (`04f9af7d2`) — P4 wait accepts any in-memory event with the extension schema

- **Where:** `demos/native-custody-probes/harness/lib/runner.mjs:830-832`, `demos/native-custody-probes/harness/lib/director.mjs:130-134` vs `146-156`.
- **What’s wrong:** `/extension-result` validates the closed schema. `/event` publishes any JSON. `waitEvent` only matches `schemaVersion === 'snapback.native-custody-extension.v1'`. The shipped witness posts `snapback.native-custody-event.v1`, so the live app cannot accidentally satisfy P4. A main-app `/event` post with a made-up PID and the eight required fields would.
- **Fix:** Publish extension results on a dedicated list (or tag `source: 'extension-result'`) and wait on that. Do not let `/event` satisfy P4.

### 5. MINOR, IN-DELTA (`04f9af7d2`) — iOS P4 is weaker than Android’s host-side process witness

- **Where:** `demos/native-custody-probes/harness/lib/runner.mjs:859-869` vs `761-768`; `demos/native-custody-probes/harness/lib/ios-device.mjs:254-263`.
- **What’s wrong:** Android independently observes both PIDs and asserts `reason === 'secondary-process'`. iOS samples only the main PID during the drive and trusts the extension report’s `pid`, `reason`, and `extensionPointIdentifier`. The production path still cannot mint those fields from the main app (no `NSExtension` in the app plist; hardcoded storage key is the real `authAppIdHash("native-custody-probes")`). The host does not prove 17667 was `NativeCustodyProbesShare`.
- **Fix:** Assert `reason === 'app-extension'`. Optionally require a `launchctl` row for `${bundleId}.share` whose PID equals the report.

### 6. MINOR, IN-DELTA (`04f9af7d2`) — share extension completes before the report POST finishes

- **Where:** `demos/native-custody-probes/app/ios/NativeCustodyProbesShare/ShareViewController.swift:40-49`.
- **What’s wrong:** NSE waits for the director POST. The share controller `resume()`s a `URLSession.shared` task and immediately `completeRequest`s. Extension teardown can cancel the task. That is a flake/FAIL risk, not a false-PASS; this receipt’s POST did land (`atMs` 1786928250704, `receivedAtMs` 1786928250731).
- **Fix:** Mirror the NSE: keep the request alive until the data task finishes or `viewDidDisappear`, then complete.

### 7. MINOR, IN-DELTA (`04f9af7d2`) — receipt binds an `ios-device.mjs` digest that is not the committed file

- **Where:** `demos/native-custody-probes/evidence/20260817T005627Z-7a5041db-phase2-ios/20260817T005627Z-7a5041db-phase2-ios.md:8-9` (`ios-device.mjs` `sha256:0782d829…`) vs committed `7466a9d879…`. `director.mjs` and `runner.mjs` digests match. Worktree recorded `a1219bc8c` `dirty:true`. Build mode is `verified-reuse` of uncommitted `20260817T003732Z-60215135`.
- **What’s wrong:** The P4 trigger argv in the receipt matches committed `iosShareProbeTestArguments`, so this is provenance, not a demonstrated false-PASS. The qualifying binary is not source-bound to `04f9af7d2`.
- **Fix:** Re-run without `--skip-build` on the committed tree, or record the exact dirty `ios-device.mjs` bytes. Do not claim the receipt digest-binds the landed harness file.

### 8. NIT, IN-DELTA (`04f9af7d2`) — XCUITest dead helper and first-label heuristic

- **Where:** `demos/native-custody-probes/app/ios/NativeCustodyProbesUITests/NativeCustodyProbesUITests.swift:21-26, 31-50`.
- **What’s wrong:** `waitForActivitySheet` is unused. The first exact label is `"Native Custody Probes"` (app display name), then `"Custody Probe"` (extension `CFBundleDisplayName`). A chrome hit on the app name would still exit 0; P4 would then time out. The receipt’s extension identity shows this run hit the real appex.
- **Fix:** Delete the dead helper. Prefer the extension display name, or assert the extension process after tap.

### 9. NIT, IN-DELTA (`7942b3b43`) — older Revised line still says iOS is refused

- **Where:** `llp/0258-first-party-application-auth-bootstrap.rfc.md:13-14`.
- **What’s wrong:** Historical and dated, but it now sits directly under the new “admits iOS” Revised line.
- **Fix:** Leave as ledger, or add “(superseded by the iOS-flip Revised line above)”.

## Clean on the asked checks

- Shared Core gate, I/O tracker after the refusal, exact code, share-services from the extension plist, distinct sampled main PID.
- Closed extension-result schema; extra `bearer` rejected; XCUITest exit 0 and `timedOut === false` required.
- Tuple gate, typed unavailability, byte-identical sentinel, override precedence; both-OS matrix tests.
- Capability rows, closed Phase 2 tickets, and the LLP iOS-flip paragraph do not imply publication and preserve the NSE / share-sheet-kind / (D) / backup / fencing nonclaims.
- No secret field on the extension report; P6 leakage scan clean; device-log stub is labeled as a host-retained scanned capture.
- Hardcoded extension storage key equals `authAppIdHash("native-custody-probes")`.
