#!/bin/bash
set -eu
K=$HOME/sb4-pub-0451; W=$HOME/sb4-pub-0444-wt/snapback4
export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$HOME/.bun/bin:$HOME/.cargo/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin
cd "$K"
until [ -e prepare-2.exit ]; do
 if [ -e native-2.exit ] && [ "$(cat native-2.exit)" != done ]; then exit 1; fi
 sleep 15
done
[ "$(cat prepare-2.exit)" = done ]
set +e
node ./audit-fast.mjs "$W" "$W/target/publication/client-0.4.51" "$K/isolated/audit-mac-early" > audit-mac-early.log 2>&1
rc=$?
echo "$rc" > audit-mac-early.exit
exit "$rc"
