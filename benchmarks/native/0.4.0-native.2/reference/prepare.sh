#!/bin/bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 DURABLE_WORK_ROOT WARM_NODE_MODULES" >&2
  exit 2
fi
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
export PATH="$HOME/.volta/bin:/opt/homebrew/bin:$PATH"
SOURCE_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
WORK_ROOT="$1"
WARM_MODULES="$2"
case "$WORK_ROOT" in /*) ;; *) echo 'DURABLE_WORK_ROOT must be absolute' >&2; exit 2;; esac
case "$WORK_ROOT" in /tmp/*|/private/tmp/*|/var/tmp/*|/private/var/tmp/*)
  echo 'reference root must be durable, outside temporary storage' >&2; exit 2;; esac
if [[ ! -d "$WARM_MODULES" ]]; then echo "warm node_modules missing: $WARM_MODULES" >&2; exit 2; fi
if [[ -e "$WORK_ROOT/app" || -e "$WORK_ROOT/DerivedData" ]]; then
  echo 'reference app and DerivedData must start absent' >&2; exit 2
fi

mkdir -p "$WORK_ROOT/logs" "$WORK_ROOT/app/modules"
cp -cR "$WARM_MODULES" "$WORK_ROOT/app/node_modules"
cp "$SOURCE_ROOT/reference/App.tsx" "$WORK_ROOT/app/App.tsx"
cp "$SOURCE_ROOT/runtime-baseline/scene-plugin.cjs" "$WORK_ROOT/app/scene-plugin.cjs"
cp -R "$SOURCE_ROOT/ui" "$WORK_ROOT/app/ui"
cp -R "$SOURCE_ROOT/helper" "$WORK_ROOT/app/modules/clique-native-observer"
ln -s ../modules/clique-native-observer "$WORK_ROOT/app/node_modules/clique-native-observer"
cat > "$WORK_ROOT/app/package.json" <<'JSON'
{"name":"ni-reference","version":"0.4.0-native.2","private":true,"main":"index.js","dependencies":{"expo":"57.0.22","expo-sqlite":"57.0.3","react":"19.2.3","react-native":"0.86.3","clique-native-observer":"file:modules/clique-native-observer"}}
JSON
cat > "$WORK_ROOT/app/app.json" <<'JSON'
{"expo":{"name":"NIReference","slug":"ni-reference","version":"0.4.0-native.2","newArchEnabled":true,"ios":{"bundleIdentifier":"dev.clique.ni.reference","infoPlist":{"NSAppTransportSecurity":{"NSAllowsArbitraryLoads":true}}},"plugins":["expo-sqlite","./scene-plugin.cjs"]}}
JSON
cat > "$WORK_ROOT/app/index.js" <<'JS'
import { registerRootComponent } from 'expo';
import App from './App';
registerRootComponent(App);
JS
(
  cd "$WORK_ROOT/app"
  npm exec -- expo prebuild --platform ios --no-install > "$WORK_ROOT/logs/prebuild.log" 2>&1
  cd ios
  pod install > "$WORK_ROOT/logs/pods.log" 2>&1
)
GEM_HOME=/opt/homebrew/Cellar/cocoapods/1.17.0/libexec ruby \
  "$SOURCE_ROOT/driver/add-driver.rb" "$WORK_ROOT/app/ios/NIReference.xcodeproj" "$SOURCE_ROOT/driver/NativeDriver.swift"
xcodebuild build-for-testing \
  -workspace "$WORK_ROOT/app/ios/NIReference.xcworkspace" \
  -scheme CliqueDriver -configuration Release \
  -destination 'platform=iOS Simulator,id=3D325BD4-FD16-4A94-AA74-9F5CF1F8E48B' \
  -derivedDataPath "$WORK_ROOT/DerivedData" -parallel-testing-enabled NO -jobs 6 \
  CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- ONLY_ACTIVE_ARCH=YES \
  > "$WORK_ROOT/logs/build.log" 2>&1
xcrun swiftc "$SOURCE_ROOT/driver/video.swift" -o "$WORK_ROOT/video-check"
python3 -m venv "$WORK_ROOT/venv"
"$WORK_ROOT/venv/bin/pip" install pillow==11.3.0 jsonschema==4.25.1 opencv-python-headless==4.12.0.88 \
  > "$WORK_ROOT/logs/python-deps.log" 2>&1
echo "reference prepared at $WORK_ROOT"
