# Diary 0087: Native custody probes

**Date:** 2026-08-16

**Run:** LLP 0258 Phase 2 simulator/emulator probe app and host harness

**Client:** Expo 57 / React Native 0.86

**Provider:** SnapbackExpoProvider with the native custody platform seam

## Build entry

This entry builds the evidence apparatus, not the native custody carrier. The
Snapback backend was pleasantly small: a password auth program, sessions mode,
durable-required custody, one seeded table, and one authenticated live query
were enough to exercise anonymous bootstrap, password entry, restored
authority, and a protected read. Codegen produced the non-secret application
bootstrap policy without warnings once table visibility was made explicit.

The provider/client boundary was also useful. The existing
`environment.resolveAppClientPlatform` seam gives the probe one narrow place to
inject the future native adapter, while the default provider path remains a
typed refusal. That makes the capability-boundary probe real instead of a
harness simulation. This codegen revision cannot declare
`auth.application-bootstrap.v1` in source, so the probe adds the requirement to
an identity-preserving descriptor projection at the provider layer and offers
it in the host binding. It is explicit, but less ergonomic than declaring the
capability beside `defineAuth`.

The director/witness pattern scaled well from the durable-store witness. A
single long-poll channel let the host place SIGKILL/force-stop exactly between
acknowledged native writes without embedding test order in the app. Keeping
public projection inside the app was important: the host never sees a bearer,
signup returns only a recovery-code count, and evidence records custody
identity through a SHA-256 digest. The pure Node protocol and receipt pieces
were easy to test without a device.

The difficult part is honestly bridging lane ownership. The Lane A package was
not present, and the current app-client normalization admits only browser,
Expo-web, and explicitly volatile memory. Rather than use SecureStore or a raw
file and accidentally claim the wrong primitive, this demo carries a typed
unavailable shim plus one import-indirection file. Native mode therefore
cannot pass until Lane A and app-client's admitted native platform shape land.
The Android AEAD and secondary-process probes likewise name debug-only module
hooks; absence is a loud typed result. This is more integration ceremony than
React plus Convex or Supabase would usually require for ordinary auth, but
those comparisons do not normally prove compare-and-swap fencing,
kill-mid-write recovery, backup exclusion, or extension/secondary-process
refusal as release evidence.

Android's committed secondary-process service felt like the right proof
boundary. The `:probe` process must call the module and obtain its typed
single-runtime refusal; checking a process name in JavaScript would have been
much easier and much weaker. Ciphertext corruption follows the same rule: only
a custody-package debug hook is accepted, never a parallel raw-file handle.

iOS extension build engineering was intentionally bounded. The v1 prebuild
does not add a share/action extension target; the app records the exact native-
unit fallback diagnostic so the supervisor can pair it with Lane A's unit
evidence. The simulator journey, interruption, CAS, ordinary refusal, and
keychain uninstall/reinstall paths remain host-drivable.

Compared with a typical React Native backend harness, the slow part will be
the repeated cold native relaunches rather than server setup. `--skip-build`
preserves useful iteration speed, and device identifiers, artifact paths,
ports, AVD names, and runtime binaries are all discoverable or parameterized.
Bun needed a hoisted linker because the file-based Expo/React packages retain
workspace dependencies in their manifests; with that local setting a clean
`bun install` resolves.

No Guide gap ticket was filed. The unavailable native carrier and capability
gate are the explicit subject of LLP 0258 Phase 2 and its research checklist,
not missing guidance for a supported app-authoring surface. The remote native
runs and Lane A integration remain the evidence-producing next step.

## Integration entry — 2026-08-16

The native carrier is now installed directly and the earlier unavailable shim
has collapsed to a one-line package re-export. The advanced
`environment.resolveAppClientPlatform` injection remained a clean boundary:
the app client admits `expo-native` only with the full owner-key capability,
while the ordinary provider resolver still refuses native admission. The
existing director binding and the probe's explicit application-bootstrap
requirement already matched that shape, so integration did not need another
capability workaround.

The most surprising friction was iOS autolinking with Bun `file:` packages.
Bun represents the installed package files as symlinks, while Expo's fallback
podspec discovery ignores symlink directory entries. Declaring the custody
podspec path in `expo-module.config.json` made the link deterministic; a clean
pod install then included `SnapbackExpoCustody`. Android autolinking did not
have the same issue and a real Gradle debug compile included the custody
module.

The carrier's debug hooks now keep destructive probing inside the native
boundary: Android can corrupt its own authenticated ciphertext, and the
secondary-process service reaches the same pre-I/O single-runtime gate used by
ordinary custody calls. This was more setup than a typical React Native auth
smoke test, but it preserves the evidence quality LLP 0258 requires instead of
substituting a JavaScript mock for OS behavior.

No Guide gap ticket was filed for this entry. The explicit injection and probe
hooks remain Phase 2 evidence-only surfaces, and the Bun autolinking issue is
handled in the package manifest rather than by app-author guidance.
