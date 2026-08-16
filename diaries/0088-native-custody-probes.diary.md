# Diary 0088: Native custody probes

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

## Evidence-integrity entry — 2026-08-16

The second review round exposed a useful distinction between automating a
native journey and proving it. The original interruption loop acknowledged a
completed write and slept before killing, so its old-or-new result was not
bound to the write the host intended to interrupt. The revised witness emits
sequenced entry/completion pulses around the native replace, and each receipt
binds the restored full custody/principal tuple to the predecessor or successor
of the last entered sequence. A missing pulse or loop failure is now terminal.

Evidence handling required more infrastructure than the application flow.
Each execution now owns an exclusive timestamp/run-id directory; package,
binary, runtime-readiness, harness, and worktree identities are resolved rather
than inferred from manifest ranges. A one-shot director endpoint retains
bearer and recovery-code literals only in memory so backend, Metro, director,
device-log, JSONL, Markdown, and raw screenshot bytes can all be scanned before
the final verdict is written. This is significantly more ceremony than a
typical React plus Supabase or Convex auth test, but it closes the gap between
"the app relaunched" and evidence that can support a custody capability claim.

Android process evidence also became deliberately redundant: the service
reports its own PID and process name, while the host independently observes
the main and `:probe` PIDs with `adb shell ps` and accepts only the package's
exact single-runtime refusal. Android mid-write evidence is narrowed to a
verified `kill -9`; force-stop-mid-write and `bmgr` backup/restore remain named
nonclaims. iOS extension refusal is similarly `INCOMPLETE` unless a supervisor
supplies separately produced native evidence whose bytes are copied and
digest-bound into the run.

No Guide gap ticket was filed. These are proof-host integrity rules for the
LLP 0258/0263 qualification apparatus, not missing guidance for an ordinary
supported app-authoring journey.

## Delta-review hardening entry — 2026-08-16

The third review round tightened several places where a locally plausible
result was still weaker than the claimed native property. Injected native
custody now has to report its own grade and mechanism before transport I/O;
the client no longer upgrades an arbitrary adapter to durable by construction.
That made the advanced platform seam a little more explicit, but it preserved
the useful separation between admission facts and the carrier implementation.

The native probes also moved closer to the mechanisms they name. Android
ciphertext corruption now flips persisted AES-GCM payload bytes and reopens the
DataStore, so the subsequent read reaches authenticated decryption instead of
returning a cached synthetic state. Alias retirement is generation-guarded,
and unresolved Android process identity refuses before storage access. These
changes added lifecycle and concurrency bookkeeping that ordinary React plus
Convex or Supabase auth tests would not need, but they are exactly the extra
work required to turn platform assumptions into custody evidence.

On the host side, iOS artifact identity is now the digest of a canonical full
`.app` inventory and its bundle ID comes from the built Info.plist. The P2 loop
skips already-completed write pulses, classifies every restored state as either
interrupted-before-commit or committed-before-restore, and withholds a family
PASS until both timing classes have been observed. This is deliberately more
conservative than treating either old-or-new result as sufficient on its own.

No Guide gap ticket was filed. The work is review-driven qualification
hardening for LLP 0258 Phase 2, not missing author guidance for a supported
Snapback application surface.

## 2026-08-16 — the evidence campaign on a headless probe host

Running these probes for real on a headless-booted Mac-mini simulator took
twenty-five iOS runs, and nearly every failure taught something a laptop-with-
Simulator.app workflow would have hidden. The environment chain alone:
simulator runtimes ship no shell (`simctl spawn <udid> sh` cannot exist);
`simctl openurl` silently refuses to cold-start an app on a headless boot, so
the launch had to become a plain `simctl launch` with the witness falling back
to its fixed default director origin; a fully unsigned build
(`CODE_SIGNING_ALLOWED=NO`) gets Keychain `-34018 errSecMissingEntitlement`,
so simulator ad-hoc signing is load-bearing for custody, not cosmetic; and RN
`AppState` reports `inactive` forever on a headless boot, which the provider
correctly treats as "pause live streams" — the probe app now pins an
always-active app-state source and the receipt says so.

The deepest find was a product defect stack, not an environment one: a
protected live query under the ordinary first-party bootstrap stayed pending
forever with zero WebSocket attempts. Three causes layered: the React
registry re-entered during the coordinator's deliberately closed publication
window and never got a second edge (fixed by staging re-entry through the
coordinator's own stagePublication seam), a narrower race where a store
registering between staged flush and exposure dropped the exact capture, and
the application client omitting `authInvalidationProtocol: 1`, which the real
sessions server answers with a protected-subscription refusal. The browser
Phase 1 work never saw any of this because nothing on that path had composed
the real provider, the real coordinator, and a real server around an
authenticated live query. The kill/relaunch probes forced that composition on
the first day they ran. This is the strongest argument the diary can make for
LLP 0258's insistence on device evidence: the capability gap was not in the
Keychain or the Keystore — the native CAS passed its first real exercise —
it was in wiring nobody had been able to execute end to end before.

Metrology honesty also had to be fought for. A fire-and-forget write pulse
let the loop race forty-four writes past the armed kill target, so the pulses
became lockstep; the PID lookup cost half a second, so processes are located
before arming; the immediate kill then landed before commit fifteen times in
a row on Android, so the kill got its LLP 0263 random offset back. The
harness's own leakage scanner twice flagged the harness itself (a count field
named `password`, a URL-credentials field) — embarrassing and exactly what
the scanner is for.

Final state: Android holds an unqualified PASS bundle. iOS holds
PASS with its extension-refusal arm explicitly INCOMPLETE — the committed v1
app has no extension target, and the harness refuses to launder native-unit
evidence into an on-device claim. Compared to a Convex or Supabase app, none
of this work would exist — but none of the claims would exist either.
