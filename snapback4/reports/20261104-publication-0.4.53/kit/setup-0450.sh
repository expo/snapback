#!/bin/bash
set -e
C=${1:?source}; WT=$HOME/sb4-pub-0453-wt; W=$WT/snapback4; K=$HOME/sb4-pub-0453
export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
while [ -d "$W/target/debug" ]; do echo 'waiting for own target/debug cleanup'; sleep 15; done
free=$(df -g "$HOME" | tail -1 | awk '{print $4}')
[ "$free" -ge 45 ] || { echo "DISK WAIT: ${free}GiB free"; exit 75; }
mkdir -p "$K/published-reports-0449"
for d in "$W"/reports/*0.4.49*; do [ ! -e "$d" ] || mv "$d" "$K/published-reports-0449/"; done
cd "$WT"
[ -z "$(git status --porcelain)" ]
git checkout --detach "$C"
[ "$(git rev-parse HEAD)" = "$C" ]
[ -z "$(git status --porcelain)" ]
X=$(git rev-parse --git-common-dir)/info/exclude
printf 'snapback4/reports/20261104-publication-0.4.53/\nsnapback4/reports/20261104-expo-0.4.53/\n' >> "$X"
mkdir -p "$W/target/incoming/linux-0.4.53" "$K/isolated"
for d in "$W" "$WT" "$HOME" /Users /; do
 [ ! -d "$d/snapback" ] || { echo "snapback ancestor: $d"; exit 1; }
done
node - "$W" <<'JS'
const fs=require('fs'),p=process.argv[2];for(const n of ['snapback4','snapback4-darwin-arm64','snapback4-linux-x64','snapback4-expo']){const q=JSON.parse(fs.readFileSync(`${p}/packages/${n}/package.json`));if(q.version!=='0.4.53')throw Error(`${n} ${q.version}`);console.log(n,q.version)}
JS
echo "HEAD=$(git rev-parse HEAD)"
df -h "$HOME"
cd "$K"
nohup caffeinate -ims bash ./chain-gate-a1.sh > chain-gate-a1.out 2>&1 < /dev/null &
echo "chain-gate pid=$!"
nohup caffeinate -ims bash ./chain-pre-a1.sh > chain-pre-a1.out 2>&1 < /dev/null &
echo "chain-pre pid=$!"
