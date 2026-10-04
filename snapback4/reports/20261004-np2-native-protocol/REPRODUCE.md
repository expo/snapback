# Reproduce the NP2 feasibility probe

This is a limited source/Release-launch probe, not the proposed complete
instrument. It contains no passing native receipt emitter. The retained run
stopped after the app crashed during priming. `test02Cold` compiled but was
**not executed**, because it requires a successful prime. No reconnect/Bob/M8
UI driver was implemented in this feasibility timebox.

Only use the Apartment mini over SSH and simulator
`3D325BD4-FD16-4A94-AA74-9F5CF1F8E48B`. Never run these commands in custody.
The paths below are intentionally fixed to make process and cleanup scope
reviewable. Confirm the named scratch directory is absent first; refuse reuse
of a live/unknown run. Read `host.py` before use. It records its own process
birth time and refuses mismatched custody instead of killing by name.

## Preparation

From eb1000, read-only source audit:

```sh
python3 audit-source.py /path/to/copied/cal30/app > source-audit.json
```

On the mini, through SSH:

```sh
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
export PATH=$HOME/.volta/bin:/opt/homebrew/bin:$PATH
test ! -e /tmp/np2-native-protocol-20261004
mkdir -p /tmp/np2-native-protocol-20261004/app
cd ~/clique-sb4-20261003-grok-cal30/attempts/builder-completed
tar cf - app src ui snapback scripts fixtures config package.json \
  package-lock.json app.json babel.config.js metro.config.js \
  metro-wasm-transformer.cjs tsconfig.json |
  tar xf - -C /tmp/np2-native-protocol-20261004/app
cp -cR node_modules /tmp/np2-native-protocol-20261004/app/node_modules
cd /tmp/np2-native-protocol-20261004/app
npm exec -- expo prebuild --platform ios --no-install
cd ios
pod install
```

Copy `NativeProbe.swift`, `add-driver.rb`, `seed-probe.mjs` and `host.py`
from this report directory into the scratch root, then:

```sh
cd /tmp/np2-native-protocol-20261004
GEM_HOME=/opt/homebrew/Cellar/cocoapods/1.17.0/libexec ruby add-driver.rb
cp seed-probe.mjs app/scripts/np2-seed.mjs
cd app
EXPO_PUBLIC_SNAPBACK_URL=http://127.0.0.1:49481 xcodebuild build-for-testing \
  -workspace ios/Clique.xcworkspace -scheme NP2Driver -configuration Release \
  -destination 'platform=iOS Simulator,id=3D325BD4-FD16-4A94-AA74-9F5CF1F8E48B' \
  -derivedDataPath ../DerivedData -parallel-testing-enabled NO -jobs 6 \
  CODE_SIGNING_ALLOWED=NO ONLY_ACTIVE_ARCH=YES
cd ..
python3 host.py start
cd app
node scripts/np2-seed.mjs
cd ..
xcodebuild test-without-building \
  -workspace app/ios/Clique.xcworkspace -scheme NP2Driver -configuration Release \
  -destination 'platform=iOS Simulator,id=3D325BD4-FD16-4A94-AA74-9F5CF1F8E48B' \
  -derivedDataPath DerivedData -parallel-testing-enabled NO \
  -maximum-concurrent-test-simulator-destinations 1 \
  -only-testing:NP2Driver/NativeProbe/test01Prime -resultBundlePath prime.xcresult
```

Commands must be checked for success individually. The historical first build
had no `PRODUCT_NAME` in the test target and failed; the retained Ruby file
contains the correction. The first seed supplied empty profile URLs and failed;
the retained helper has valid public fixture URLs. After that first seed
failure, the owned server was stopped, its scratch data moved aside and a fresh
scratch store seeded. Neither failure is an application result.

## Failure capture actually performed

After the XCTest failure, a direct online launch reproduced the same exception.
Then `host.py stop`, `host.py record`, and `host.py offline` established and
recorded the backend-offline cold-launch mechanics. The launch was:

```sh
xcrun simctl launch 3D325BD4-FD16-4A94-AA74-9F5CF1F8E48B dev.snapback.np2.cal30
xcrun simctl spawn 3D325BD4-FD16-4A94-AA74-9F5CF1F8E48B log show \
  --last 30s --style compact \
  --predicate 'process == "Clique" AND (eventMessage CONTAINS "topContentSizeChange" OR eventMessage CONTAINS "RCTFatalException")'
python3 host.py offline
python3 host.py stop-record
```

The retained recording includes eight seconds after launch. The second offline
check also found the app process absent after its exception. These commands
do not fake the missing online prime. The fixture was seeded, but Alice never
successfully signed in or viewed it.

## Teardown

Stop any still-recorded owned backend/video through `host.py`; refuse ambiguous
process identity. Export and hash the evidence before deletion. Uninstall only
`dev.snapback.np2.cal30` and `dev.snapback.np2.driver.xctrunner` from the specified
simulator. Do not shut down, erase or delete the simulator. Verify the scratch
port is closed and the unique probe apps are absent. Delete only the named
scratch root after evidence verification. The performed cleanup is recorded in
`evidence/cleanup.json`.

## Boundaries of the prototype

- Tab labels are a Grok-specific navigation adapter; the RFC proposes new
  native navigation IDs rather than freezing these English labels.
- Snapshots are XCTest-native evidence, not the proposed app observation hook.
- `test02Cold` records exploratory UI states; it neither implements all eight
  assertions nor validates media pixels, server exactly-once behavior or read.
- The fresh fixture uses a disclosed test-only password, never user credentials.
- `host.py` owns direct foreground commands and verifies their exit; it is a
  scratch helper, not a general replacement for LLP 3000.030's process supervisor.
