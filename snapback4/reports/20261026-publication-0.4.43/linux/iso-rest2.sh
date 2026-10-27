#!/bin/bash
# Diagnostic harness after linux-1's DX7 upgrade proof threw: see iso-rest/run2.mjs. Private npm cache, default TMPDIR.
export PATH=$HOME/.elan/bin:$HOME/.local/bin:$HOME/.cargo/bin:/usr/local/bin:/usr/bin:/bin; ulimit -n 65536
D=$HOME/sb4-pub-0443-kit/iso-rest; C=$HOME/sb4-pub-0441/snapback4/target/publication/client-0.4.43
O=$HOME/sb4-pub-0443-records/iso-rest-out-2; mkdir -p $O; cd $HOME/sb4-pub-0441/snapback4
env -u SNAPBACK4_BIN -u NPM_TOKEN -u NODE_AUTH_TOKEN NPM_CONFIG_CACHE=$HOME/sb4-pub-0443-records/npm-cache-rest SNAPBACK4_REQUIRE_LEAN=1 timeout 9000 node $D/run2.mjs $C/snapback4-0.4.43.tgz $D/pkg/snapback4-linux-x64-0.4.43.tgz $C/snapback4-expo-0.4.43.tgz $O $HOME/sb4-pub-0443-records/linux-qualification-0.4.43/day2-compatibility > $D/rest2.log 2>&1
echo "rc=$?"; grep ^ISO-REST $D/rest2.log | cut -c1-600; git status --porcelain; echo rest-done
