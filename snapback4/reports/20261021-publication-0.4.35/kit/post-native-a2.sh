#!/bin/bash
set -e
K=$HOME/sb4-pub-0435; W=$HOME/projects/snapback-pub-0428/snapback4
cd $W
git diff metrics/witness.jsonl > $K/witness.jsonl.native-0435.diff
git checkout -- metrics/witness.jsonl
git status --porcelain
grep '^+{' $K/witness.jsonl.native-0435.diff | cut -c1-160
expo=$(node -p "require('./apps/chat-expo/node_modules/expo/package.json').version" 2>/dev/null || node -p "require('./node_modules/expo/package.json').version")
emc=$(node -p "require('./node_modules/expo-modules-core/package.json').version" 2>/dev/null || echo "?")
rn=$(node -p "require('./node_modules/react-native/package.json').version" 2>/dev/null || echo "?")
xv=$(DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -version | tr '\n' ' ' | sed 's/ *$//')
grep -m1 -E "DEVELOPER_DIR|Xcode" apps/chat-expo/.expo/xcodebuild.log | cut -c1-200 || true
python3 - "$expo" "$emc" "$rn" "$xv" <<'PY'
import json,sys,datetime,pathlib
expo,emc,rn,xv=sys.argv[1:]
p=pathlib.Path('reports/20261021-expo-0.4.35/qualified.json'); q=json.loads(p.read_text())
assert q['source'].startswith('2e10681b32'), q['source']
assert 'toolchainProvenance' not in q
q['toolchainProvenance']={'xcframework':f"built by {xv} (/Applications/Xcode.app) in native attempt 2 at 2e10681b32",
 'witnessApp':f"Release chat-expo (Expo {expo}, expo-modules-core {emc}, RN {rn}) built by {xv} (/Applications/Xcode.app) in native attempt 2 at 2e10681b32; ~/Applications/Xcode-27.0.app retained but not used",
 'recordedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
p.write_text(json.dumps(q,indent=2)+'\n')
print(json.dumps(q['toolchainProvenance'],indent=1)); print(json.dumps(q['toolchain'],indent=1)); print(json.dumps(q['witnesses'],indent=1))
PY
