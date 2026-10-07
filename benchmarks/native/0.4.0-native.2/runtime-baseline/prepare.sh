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
case "$WORK_ROOT" in
  /*) ;;
  *) echo "DURABLE_WORK_ROOT must be absolute" >&2; exit 2 ;;
esac
case "$WORK_ROOT" in
  /tmp/*|/private/tmp/*|/var/tmp/*|/private/var/tmp/*)
    echo "runtime proof root must be durable, outside temporary storage" >&2
    exit 2
    ;;
esac
if [[ ! -d "$WARM_MODULES" ]]; then
  echo "warm node_modules missing: $WARM_MODULES" >&2
  exit 2
fi
if [[ -e "$WORK_ROOT/app" || -e "$WORK_ROOT/DerivedData" ]]; then
  echo "runtime proof app and DerivedData must start absent" >&2
  exit 2
fi

mkdir -p "$WORK_ROOT/logs" "$WORK_ROOT/app/modules"
cp -cR "$WARM_MODULES" "$WORK_ROOT/app/node_modules"
cp "$SOURCE_ROOT/runtime-baseline/App.tsx" "$WORK_ROOT/app/App.tsx"
cp "$SOURCE_ROOT/runtime-baseline/scene-plugin.cjs" "$WORK_ROOT/app/scene-plugin.cjs"
cp "$SOURCE_ROOT/runtime-baseline/simulator.entitlements" "$WORK_ROOT/app/simulator.entitlements"
cp -R "$SOURCE_ROOT/helper" "$WORK_ROOT/app/modules/clique-native-observer"
cp -R "$SOURCE_ROOT/ui" "$WORK_ROOT/app/ui"
ln -s ../modules/clique-native-observer "$WORK_ROOT/app/node_modules/clique-native-observer"

cat > "$WORK_ROOT/app/package.json" <<'JSON'
{"name":"clique-native-runtime-baseline","version":"0.4.0-native.2","private":true,"main":"index.js","dependencies":{"clique-native-observer":"file:modules/clique-native-observer","expo":"57.0.22","expo-secure-store":"57.0.4","react":"19.2.3","react-native":"0.86.3"}}
JSON
cat > "$WORK_ROOT/app/app.json" <<'JSON'
{"expo":{"name":"RuntimeBaseline","slug":"clique-native-runtime-baseline","version":"0.4.0-native.2","newArchEnabled":true,"ios":{"bundleIdentifier":"dev.clique.native.runtimebaseline"},"plugins":["expo-secure-store","./scene-plugin.cjs"]}}
JSON
cat > "$WORK_ROOT/app/index.js" <<'JS'
import { registerRootComponent } from 'expo';
import App from './App';
registerRootComponent(App);
JS

node -e 'const fs=require("fs"),p=process.argv[1];const wanted={expo:"57.0.22","react-native":"0.86.3","expo-secure-store":"57.0.4"};for(const [name,v] of Object.entries(wanted)){const got=JSON.parse(fs.readFileSync(`${p}/${name}/package.json`)).version;if(got!==v)throw Error(`${name}: expected ${v}, got ${got}`)}' "$WORK_ROOT/app/node_modules"

(
  cd "$WORK_ROOT/app"
  npm exec -- expo prebuild --platform ios --no-install > "$WORK_ROOT/logs/prebuild.log" 2>&1
  cp simulator.entitlements ios/RuntimeBaseline/RuntimeBaseline.entitlements
  cd ios
  pod install > "$WORK_ROOT/logs/pods.log" 2>&1
)

GEM_HOME=/opt/homebrew/Cellar/cocoapods/1.17.0/libexec ruby \
  "$SOURCE_ROOT/runtime-baseline/configure-signing.rb" \
  "$WORK_ROOT/app/ios/RuntimeBaseline.xcodeproj" \
  RuntimeBaseline/RuntimeBaseline.entitlements
python3 "$SOURCE_ROOT/runtime-baseline/bind-inputs.py" \
  --source "$SOURCE_ROOT" --app "$WORK_ROOT/app" --out "$WORK_ROOT/runtime-inputs.json" \
  > "$WORK_ROOT/logs/runtime-inputs.log" 2>&1

xcodebuild \
  -workspace "$WORK_ROOT/app/ios/RuntimeBaseline.xcworkspace" \
  -scheme RuntimeBaseline \
  -configuration Release \
  -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,id=3D325BD4-FD16-4A94-AA74-9F5CF1F8E48B' \
  -derivedDataPath "$WORK_ROOT/DerivedData" \
  -jobs 6 \
  ONLY_ACTIVE_ARCH=YES \
  build > "$WORK_ROOT/logs/build.log" 2>&1

APP_PATH="$WORK_ROOT/DerivedData/Build/Products/Release-iphonesimulator/RuntimeBaseline.app"
test -d "$APP_PATH"
/usr/bin/codesign -d --entitlements :- "$APP_PATH" > "$WORK_ROOT/logs/signed-entitlements.plist" 2> "$WORK_ROOT/logs/codesign.log"
/usr/bin/codesign --verify --deep --strict "$APP_PATH"
printf '%s\n' "$APP_PATH" > "$WORK_ROOT/runtime-app.path"
echo "runtime baseline Release app: $APP_PATH"
