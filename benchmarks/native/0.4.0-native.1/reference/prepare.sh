#!/bin/bash
set -euo pipefail
# Run only in a NEW /tmp scratch directory on the Apartment mini.
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
export PATH=$HOME/.volta/bin:/opt/homebrew/bin:$PATH
cd "$(dirname "$0")/.."
case "$PWD" in /tmp/ni-*|/private/tmp/ni-*) ;; *) echo 'new /tmp/ni-* scratch required' >&2; exit 2;; esac
mkdir app
cp -cR "$HOME/clique-sb4-20261003-grok-cal30/attempts/builder-completed/node_modules" app/node_modules
cp reference/App.tsx app/App.tsx
cp reference/scene-plugin.cjs app/scene-plugin.cjs
cp -R ui app/ui
mkdir -p app/modules
cp -R helper app/modules/clique-native-observer
ln -s ../modules/clique-native-observer app/node_modules/clique-native-observer
cat > app/package.json <<'JSON'
{"name":"ni-reference","version":"1.0.0","private":true,"main":"index.js","dependencies":{"expo":"57.0.22","expo-sqlite":"57.0.3","react":"19.2.3","react-native":"0.86.3","clique-native-observer":"file:modules/clique-native-observer"}}
JSON
cat > app/app.json <<'JSON'
{"expo":{"name":"NIReference","slug":"ni-reference","version":"1.0.0","newArchEnabled":true,"ios":{"bundleIdentifier":"dev.clique.ni.reference","infoPlist":{"NSAppTransportSecurity":{"NSAllowsArbitraryLoads":true}}},"plugins":["expo-sqlite","./scene-plugin.cjs"]}}
JSON
cat > app/index.js <<'JS'
import { registerRootComponent } from 'expo';
import App from './App';
registerRootComponent(App);
JS
cd app
npm exec -- expo prebuild --platform ios --no-install > ../prebuild.log 2>&1
cd ios
pod install > ../../pods.log 2>&1
cd ../..
GEM_HOME=/opt/homebrew/Cellar/cocoapods/1.17.0/libexec ruby driver/add-driver.rb app/ios/NIReference.xcodeproj driver/NativeDriver.swift
xcodebuild build-for-testing -workspace app/ios/NIReference.xcworkspace -scheme CliqueDriver -configuration Release -destination 'platform=iOS Simulator,id=3D325BD4-FD16-4A94-AA74-9F5CF1F8E48B' -derivedDataPath DerivedData -parallel-testing-enabled NO -jobs 6 CODE_SIGNING_ALLOWED=NO ONLY_ACTIVE_ARCH=YES > build.log 2>&1
xcrun swiftc driver/video.swift -o video-check
python3 -m venv venv
venv/bin/pip install pillow==11.3.0 jsonschema==4.25.1 opencv-python-headless==4.12.0.88 > python-deps.log 2>&1
