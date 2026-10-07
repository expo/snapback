# Builder-to-operator handoff

Write `native-operator.json` at the lane root. Commands are argv arrays, not shell
strings. They run in an isolated custody work copy. `@APP@`, `@DERIVED@`, `@STORE@`,
`@ORIGIN@`, `@WEB_ORIGIN@`, `@UDID@`, `@BUNDLE_ID@`, `@SEGMENT@` are substituted.
`@PYTHON@` and `@CONVEX_OWNER@` resolve to the operator interpreter and
fixed foreground Convex launcher; `@BACKEND_EVIDENCE@` is operator evidence.
Every supplied path must be relative to the work copy or use these tokens.

Required fields:

```json
{
  "prepareArgv": ["bash", "scripts/native-prepare.sh"],
  "buildArgv": ["xcodebuild", "-workspace", "ios/Clique.xcworkspace", "-scheme", "Clique", "-configuration", "Release", "-destination", "platform=iOS Simulator,id=@UDID@", "-derivedDataPath", "@DERIVED@", "CODE_SIGNING_ALLOWED=YES", "CODE_SIGN_IDENTITY=-", "build"],
  "app": "@DERIVED@/Build/Products/Release-iphonesimulator/Clique.app",
  "bundleId": "dev.clique.pilot.BACKEND",
  "backendArgv": ["bash", "scripts/native-backend.sh", "@STORE@", "@ORIGIN@"],
  "webArgv": ["node", "scripts/serve-web.mjs", "@WEB_ORIGIN@"],
  "seedArgv": ["node", "scripts/native-seed.mjs"],
  "oracleArgv": ["node", "scripts/native-oracle.mjs"],
  "ordinaryImage": "native-fixtures/ordinary.png",
  "viewOnceImage": "native-fixtures/once.png"
}
```

Replace BACKEND with snapback4 or convex. Use exactly one bundle identifier per
backend. The harness starts each segment from a fresh install/store; no reset or
reinstall occurs between that segment's prime and measurement. The app uses
@ORIGIN@ at build time and Bob uses @WEB_ORIGIN@. Both segments share fixed ports
within the lane range. Build scripts read CLIQUE_NATIVE_ORIGIN,
CLIQUE_NATIVE_WEB_ORIGIN and CLIQUE_NATIVE_BUNDLE_ID from the environment.

prepareArgv prepares dependencies, an iOS project and a static web export; it
must not start servers or install/launch an app. buildArgv builds the Release app
only, without XCTest. Keep deployment/schema installation in seedArgv where the
owned backend is already running. Never daemonize or launch another backend in
seed/oracle. backendArgv must `exec` a foreground process, keep all database/file
storage inside @STORE@, and reuse the same store when restarted. Any credentials
needed by a local backend wrapper belong to private local environment/state and
must not be printed. The oracle uses a fresh ordinary Bob session and documented
network API, never an admin read, local SQLite read, Alice cache, or verdict.

The driver sends one JSON object on stdin to seed/oracle and expects exactly one
JSON object on stdout, following native/CONTRACT.md and native/schemas. Diagnostics
go to stderr without credentials. Seed must be safe against a new empty store and
create the required fixture including real ordinary/view-once bytes. The operator
uses the same image files for independent pixel validation. Builder native audit
must identify passive hooks, nested/recycled accessibility and the oracle mapping.

Native operator work is separate from authoring. Do not provide or run a simulator
driver. Missing support remains unmeasured; a product failure is retained as false.

For Convex, use exactly:

```json
"backendArgv": ["@PYTHON@", "@CONVEX_OWNER@", "@STORE@", "@ORIGIN@", "@BACKEND_EVIDENCE@"]
```

The operator launcher uses the sealed preflight binary, loopback ports 49560/49561,
and `@STORE@/data.sqlite3` plus `@STORE@/files`. It records the live process image
on both starts. It creates private `@STORE@/instance.json` with `name` and `secret`
for your seed command's local deployment (pass `@STORE@` to seedArgv); retain
that instance on restart. Never print the secret. This supplies process ownership,
not an app/backend/schema/seed/oracle implementation. Every native/web/seed/oracle
client must connect to the assigned origin, never a hosted deployment.

Setup reruns retain these exact builder commands and sources. The repair record
may contain only `reason` and `scope: "operator-setup-only"`; fix operator
environment/tool availability externally. It cannot replace native-operator.json
or any preparation, build, seed, oracle, backend or web command.

The app must use the supplied backend-neutral UIScene recipe (or an equivalent
existing application-owned UIScene lifecycle) for Expo 57 / SDK 27. Its Release
simulator product must be signed with application-identifier and keychain-access-
groups entitlements that support ordinary `expo-secure-store`; never disable
code signing. During `prepareArgv`, copy the disclosed entitlements into the app
target and run `runtime-baseline/configure-signing.rb PROJECT ENTITLEMENTS` after
Expo prebuild. Never pass `CODE_SIGN_ENTITLEMENTS` globally on xcodebuild: that
propagates the app path into Pods resource targets. Packet preparation has
already run the shared runtime baseline.

Seed must build the descriptor with `clique-native-observer/fixture`'s
`createFixtureDescriptor`. The operator starts a disposable owned backend after
preparation, executes the actual seed, and runs the shared semantic validator
against a fresh operator UUID before compilation or device work. Any other run
ID or queued bodies other than exact ordered `<runId>:first` and
`<runId>:second` refuse the handoff.
