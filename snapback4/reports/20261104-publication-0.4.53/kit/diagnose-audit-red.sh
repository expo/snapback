#!/bin/bash
# Read-only release diagnosis: reconstruct the stock packed Expo starter and retain npm audit evidence. Never publish.
set -eu
export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:/opt/homebrew/bin:/usr/bin:/bin
K=$HOME/sb4-pub-0453; D=$K/isolated/audit-red
S=$HOME/sb4-pub-0453-wt/snapback4/target/publication/snapback4-darwin-arm64-0.4.53
[ ! -e "$D" ] || exit 2
mkdir -p "$D/consumer" "$D/npm-cache"
export NPM_CONFIG_CACHE=$D/npm-cache npm_config_cache=$D/npm-cache CI=1 EXPO_NO_TELEMETRY=1 EXPO_OFFLINE=1
unset SNAPBACK4_BIN
cd "$D/consumer"
echo '{"private":true}' > package.json
npm install --no-save --ignore-scripts --no-audit --no-fund "$S/snapback4-0.4.53.tgz" "$S/snapback4-darwin-arm64-0.4.53.tgz" > "$D/cli-install.log" 2>&1
node_modules/.bin/snapback4 init --no-install --expo > "$D/init.log" 2>&1
STAGE=$S node --input-type=module - <<'JS'
import {readFileSync,writeFileSync} from 'node:fs';
const pkg=JSON.parse(readFileSync('package.json'));
pkg.dependencies.snapback4=`file:${process.env.STAGE}/snapback4-0.4.53.tgz`;
pkg.optionalDependencies={'snapback4-darwin-arm64':`file:${process.env.STAGE}/snapback4-darwin-arm64-0.4.53.tgz`};
pkg.dependencies['snapback4-expo']=`file:${process.env.STAGE}/snapback4-expo-0.4.53.tgz`;
writeFileSync('package.json',JSON.stringify(pkg,null,2));
JS
node scripts/install.mjs --prefer-offline --no-audit --no-fund > "$D/frontend-install.log" 2>&1
cp package.json "$D/starter-package.json"
cp package-lock.json "$D/starter-package-lock.json"
set +e
npm audit --json --audit-level=low > "$D/npm-audit.json" 2> "$D/npm-audit.err"
echo $? > "$D/npm-audit.exit"
npm ls @expo/cli expo --json > "$D/npm-ls.json" 2> "$D/npm-ls.err"
echo $? > "$D/npm-ls.exit"
set -e
node --input-type=module - <<'JS' > "$D/summary.json"
import {readFileSync} from 'node:fs';
const r=JSON.parse(readFileSync('../npm-audit.json'));
console.log(JSON.stringify({metadata:r.metadata,vulnerabilities:r.vulnerabilities},null,2));
JS
rm -rf "$D/consumer" "$D/npm-cache"
echo "$(date -u +%FT%TZ) audit diagnosis complete; no upload"
echo done > "$K/audit-diagnosis.exit"
