#!/bin/bash
# Pre-publication clean install from the exact qualified bytes; no registry publication.
set -euo pipefail
export PATH=$HOME/.bun-1.4.2/bin:$HOME/.local/bin:$HOME/.cargo/bin:/usr/local/bin:/usr/bin:/bin
unset SNAPBACK4_BIN NPM_TOKEN NODE_AUTH_TOKEN
B=$HOME/sb4-intent/0453
D=$B/records/clean-install-linux
Q=$B/linux-qualification-0.4.53
C=$B/source/snapback4/target/publication/client-0.4.53/snapback4-0.4.53.tgz
T=$Q/snapback4-linux-x64-0.4.53.tgz
[ ! -e "$D" ] || { echo "clean-install evidence already exists: $D"; exit 98; }
[ -s "$Q/receipt.json" ] && [ -s "$C" ] && [ -s "$T" ]
mkdir -p "$D"
cd "$D"
export NPM_CONFIG_CACHE=$B/records/npm-cache-clean-install-1
npm init -y > init-package.log 2>&1
npm install "$C" "$T" --prefer-online --no-audit --no-fund > install.log 2>&1
tail -2 install.log
version=$(npx --no-install snapback4 --version)
echo "$version"
[ "$version" = "snapback4 0.4.53" ]
npx --no-install snapback4 init > init.log 2>&1
irc=$?; tail -2 init.log; echo "init rc=$irc"
npx --no-install snapback4 check > check.log 2>&1
rc=$?; tail -2 check.log; echo "check rc=$rc"
python3 - "$Q/receipt.json" <<'CHECK'
from pathlib import Path
import hashlib,json,sys
r=json.loads(Path(sys.argv[1]).read_text())
p=Path('node_modules/snapback4-linux-x64/snapback4')
h=hashlib.sha256(p.read_bytes()).hexdigest()
assert h==r['binarySha256'],(h,r['binarySha256'])
print('installed binary SHA256 matches Linux receipt:',h,'bytes',p.stat().st_size)
CHECK
echo 'STAGED CLEAN INSTALL PASS (registry install remains post-publication)'
