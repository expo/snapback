# Qualified Expo runtime baseline

This backend-neutral kit is a required packet-preparation input for
`0.4.0-native.2`. It covers the shared platform layer that failed before either
Phase-2 application reached an online prime: Expo 57.0.22, React Native 0.86.3,
the iOS 27 SDK, UIScene adoption, Release simulator signing, SecureStore and the
passive observer helper.

`scene-plugin.cjs` is the disclosed UIScene recipe. It only accepts Expo 57's
unmodified Swift starter lifecycle and refuses an existing scene manifest so an
application with a custom lifecycle must keep its own recipe. The Release path
uses Xcode simulator signing with `CODE_SIGNING_ALLOWED=YES`, an app-target-only
entitlements file and ad-hoc identity `-`. Xcode places effective simulator
application and keychain groups in the Mach-O `__entitlements` section; a
post-build re-sign is forbidden because it can invalidate that simulator
carrier. Setting `CODE_SIGNING_ALLOWED=NO` does not satisfy this baseline.

## Builder integration

The symmetric authoring aid contains this README, `scene-plugin.cjs`,
`simulator.entitlements` and `configure-signing.rb`. Add the scene plugin to the
Expo config. After Expo prebuild, copy the entitlements to the application
target and run:

```sh
GEM_HOME=/opt/homebrew/Cellar/cocoapods/1.17.0/libexec ruby \
  instrument/native/runtime-baseline/configure-signing.rb \
  ios/Clique.xcodeproj Clique/Clique.entitlements
```

Use the actual project and entitlement paths. The script edits only the
application target. Do not pass `CODE_SIGN_ENTITLEMENTS` to xcodebuild because
that global override also reaches Pods resource targets. The remaining commands
below are operator proof instructions; builders do not run them.

## Operator qualification proof

Build in a new durable directory on the Apartment mini:

```sh
source ~/.snapback-env.sh
bash runtime-baseline/prepare.sh \
  /Users/ccheever/ni2-runtime-20261006 \
  /Users/ccheever/clique-sb4-20261003-grok-cal30/attempts/builder-completed/node_modules
```

Then use the newly rebuilt and qualified native.2 runner. A runner receipt has
absolute `binary` and `xctestrun` paths:

```sh
python3 runtime-baseline/prove.py \
  --work /Users/ccheever/ni2-runtime-20261006 \
  --runner /Users/ccheever/native-runner-0.4.0-native.2/runner.json \
  --out /Users/ccheever/ni2-runtime-20261006/proof
```

The proof starts at the generic XCTest driver's `attach`/`launch` interface,
performs a sign-in-like SecureStore write plus immediate read, terminates the
actual process, relaunches the same installation with the same protocol run ID,
and requires a restored value plus helper `ready` events from two process
nonces. It retains native trees, screenshots, a launch-through-restore video,
the Xcode signature and effective simulator entitlements, XCTest log and
`runtime-proof.json`. Packet readiness
must verify `pass: true`, identities and artifact hashes before a builder starts.
