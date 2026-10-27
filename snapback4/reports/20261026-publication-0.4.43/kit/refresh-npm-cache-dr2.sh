#!/bin/bash
# 0.4.43 DRY-RUN-2 environment repair: node-forge 1.4.1 (published 2026-10-27 04:44Z) postdates the setup refresh; the stale shared
# ~/.npm packument made the Darwin starters proof install node-forge 1.4.0 (--prefer-offline), and npm audit then reported
# "node-forge: a fix is available". Same procedure as the 0.4.41 dry-run-3 vite repair below, with the dry-run-2 stage bytes;
# also prints the node-forge version each offline resolution picks.
# 0.4.43 dry-run-3 environment repair (0.4.30 lesson): the shared Mac ~/.npm cache had a stale vite packument (<= 8.3.0), so the
# Darwin starter proof's `npm install --prefer-offline` could not see the pinned vite 8.3.5 (ERESOLVE "Found: vite@undefined").
# For each starter case of publication-starters.mjs: install the staged client + Darwin platform, `init` with the same flags,
# then resolve its dependency tree ONLINE (--package-lock-only, metadata only) to refresh every packument, then confirm the
# proof's own --prefer-offline resolution succeeds (package.json rewritten to the staged file: artifacts exactly as the proof does). Scratch dirs are removed. No source or publish state is touched.
export PATH=/Users/ccheever/.volta/tools/image/node/24.18.0/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
S=$HOME/projects/snapback-pub-0428/snapback4/target/publication/snapback4-darwin-arm64-0.4.43-dr2-6f3ef3b0d0
R=$HOME/sb4-pub-0443/npm-refresh; rm -rf $R; mkdir -p $R; O=$HOME/sb4-pub-0443/isolated/npm-refresh-dr2; mkdir -p $O
for c in "web|--web" "web-online|--web --online" "expo|--expo" "web-chat|--web --template chat" "expo-chat|--expo --template chat" "expo-social|--template social"; do
  id=${c%%|*}; flags=${c#*|}; d=$R/$id; mkdir -p $d; cd $d; echo '{"private":true}' > package.json
  npm install --no-save --ignore-scripts --no-audit --no-fund $S/snapback4-0.4.43.tgz $S/snapback4-darwin-arm64-0.4.43.tgz > $O/$id-cli.log 2>&1 || { echo "$id cli install FAILED"; continue; }
  ./node_modules/.bin/snapback4 init $flags > $O/$id-init.log 2>&1 || { echo "$id init FAILED"; continue; }
  node -e 'const fs=require("fs"),[,c,pl,e,kind]=process.argv;const p=JSON.parse(fs.readFileSync("package.json"));p.dependencies.snapback4="file:"+c;p.optionalDependencies={["snapback4-darwin-arm64"]:"file:"+pl};if(kind==="expo")p.dependencies["snapback4-expo"]="file:"+e;fs.writeFileSync("package.json",JSON.stringify(p,null,2))' $S/snapback4-0.4.43.tgz $S/snapback4-darwin-arm64-0.4.43.tgz $S/snapback4-expo-0.4.43.tgz ${id%%-*}
  npm install --package-lock-only --prefer-online --ignore-scripts --no-audit --no-fund > $O/$id-online.log 2>&1; on=$?
  rm -f package-lock.json
  npm install --package-lock-only --prefer-offline --ignore-scripts --no-audit --no-fund > $O/$id-offline.log 2>&1; off=$?
  forge=$(node -e 'try{const l=require("./package-lock.json");console.log(l.packages["node_modules/node-forge"]?.version??"none")}catch{console.log("?")}')
  echo "$id online-resolve rc=$on prefer-offline-resolve rc=$off vite=$(grep -o '"vite": "[^"]*"' package.json | head -1) node-forge=$forge"
done
cd $HOME; rm -rf $R; npm view vite@8.3.5 version --offline 2>&1 | tail -1; npm view node-forge version --offline 2>&1 | tail -1; echo refresh-done
