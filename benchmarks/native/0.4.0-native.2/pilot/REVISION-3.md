# P2A packet revision 3 — 2026-10-05

Round 2 corrects native toolchain access before the lead restarts the pilot.
No pilot builder, chain, backend or driver measurement is launched. Scratch
native builds, one-prompt model probes and headless browser probes are explicitly
authorized preparation costs, separate from both product lanes. Both lanes
remain cold; attempt 1 remains the retained harness-defect void with zero setup
reruns consumed. Only the Apartment mini and the existing Linux lane are used.

## Scope and constraints

LLP 0201 D7 governs the disclosed harness revision and unscored pilot; accepted
LLP 0201.000 §§3–7 governs identical passive aids, independent evidence and the
unchanged qualified instrument. LLP 0000 supplies project orientation. Neither
the reference, native driver, helper, UI kit, schemas nor qualified runner is
modified. No new product design decision or LLP status transition is needed.

## Native filesystem access

The same generated profile serves both builders and the scratch probe. It adds
read access to `~/.gitconfig`, `~/.config`, `~/Library/Preferences`, and
`~/Library/Developer`; write access is limited to the requested `.cocoapods`,
`.expo`, `.convex`, and `Library/Developer/Xcode/DerivedData` additions. Existing
tool/cache/lane allowances remain. Explicit later denies close pre-existing
DerivedData project trees (four named SDK/compiler cache directories excepted),
Xcode Archives, and simulator device data. The closed home/packet/scratch roots
continue to hide the other lane, trusted components, driver, reference, attempts,
operator logs, runner and other private runtimes, including symlink access.

The first actual build exposed another harness defect: ExpoModulesJSI invokes
xcodebuild on a Swift package, and SwiftPM's inner sandbox fails with
`sandbox-exec: sandbox_apply: Operation not permitted`. Two environment-variable
experiments did not solve it; a focused manifest probe did pass with Xcode's
`-IDEPackageSupportDisableManifestSandbox=YES` preference argument. Two full
reruns showed Xcode bypassing a private PATH shim in build phases, even with
PATH supplied as a build setting. Those attempts and their cleanup are retained.

The final harness sets only the boolean preference
`com.apple.dt.Xcode:IDEPackageSupportDisableManifestSandbox` for the serial
authoring window. It records the prior boolean or absence before mutation,
verifies enablement, and restores and verifies that exact prior state after
owned-child cleanup. A focused sandboxed SwiftPM probe verified this mechanism.
This reaches absolute-path invocations and Expo's environment-cleared child.
The outer sandbox is inherited unchanged; no unsandboxed build service or app
source workaround is introduced. Both authoring views disclose the temporary
preference. A crash leaves the recorded reservation for operator recovery;
another builder cannot start while it exists.

## DerivedData custody

While holding the existing serial authoring/operator lease, the supervisor
records each top-level entry's name, type, device and inode before the builder
starts. After confirmed owned-process cleanup, it checks baseline identity and
atomically moves every newly created directory to that builder's private
`derived-data/`. Before/after listings, each move and the completion receipt are
retained in builder logs. Replacements, new symlinks, cross-volume moves and
incomplete cleanup fail closed. A reservation survives a crash and blocks the
next builder. Shared pre-existing compiler caches stay in place. The next
profile cannot read the previous private products. Operator custody requires
both process and DerivedData cleanup; its readiness check follows the wait.

## Proof and retained history

`scripts/toolchain_probe.py` creates only a UUID-named scratch lane. Its app pins
Expo 57.0.22, React Native 0.86.3 and React 19.2.3, installs the unchanged supplied
helper, and imports its committed-screen hook. Every app command uses the exact
profile from `isolation.prepare()` and environment from `isolation.environment()`:
npm install, git init/add/commit, Expo prebuild, explicit pod install, a generic
iOS Simulator Release xcodebuild, real Codex exec and headless Playwright
with default DerivedData and no simulator boot/install command. The full build
logs, argv/exit/wall receipts, binary/lock/helper hashes, raw model rollout and
checksum-validating token-adapter output stay under `preparation/round2/`.

Chromium is exercised both with default launch options and the recorded
executable override used by web choreography. Denial probes cover trusted
reference/driver, both real lanes, attempts, scripts, runner and a symlink;
after relocation another generated Convex profile tries to read the moved
product. Before/after simulator state and explicit scratch/DerivedData deletion
receipts are retained. Initial failed probes remain, including an early copy
race and read-only helper-copy cleanup error; the latter cleanup was recovered
and the deletion helper now adjusts only disposable directory permissions.
An absent-preference diagnostic spelling mismatch was also fixed before the
successful build. The four DerivedData trees created by focused SwiftPM `-list`
experiments were separately inventoried, relocated and deleted; the final
shared directory listing matches the complete Round 2 starting listing.

The successful probe is `native-probe-d7d2e7456a`: Release build exit 0 in
48.118 seconds, executable SHA-256
`aa1fe368303ea094313fb7b25af85b729d043c196d08f88b377b305ca504a6f5`.
Its model call returned `SANDBOX_MODEL_OK`: 14,242 non-cached input + 9 output
tokens, no cache reads/writes or reasoning tokens. Including the two earlier
successful model probes in failed build attempts, preparation used 35,555
non-cached input + 27 output tokens and 7,168 uncapped cache-read tokens.
Both Chromium launch forms passed at 151.0.7922.34. The moved Release product
was unreadable under the subsequent Convex profile. All scratch lanes,
DerivedData products and copied credentials were deleted, the original absent
Xcode preference restored, and simulator boot state unchanged. Thirty safety
tests pass on the mini; Linux passes its 27 applicable tests and skips three
macOS probes. Repository inventory output remains identical to Round 1's
inherited failures; the reference audit passes.

`metadata/revision-3.json` binds the final proof receipts, source binding and
`metadata/harness-v2-v3.diff`. The original seal remains `PACKET.v1.sha256`;
Round 1's exact seal is retained as `PACKET.v2.sha256`. Their immutable source
records and the void custody are not rewritten. `PACKET.sha256` is revision 3.
Cold readiness, safety self-tests and read-only restart admission must pass
after resealing. The exact restart command remains the README command; only
the lead runs it. These preparation probes do not establish product behavior,
a completed pilot, scored admission, or a new review approval.
