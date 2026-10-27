#!/bin/bash
export PATH=$HOME/.elan/bin:$HOME/.local/bin:$HOME/.cargo/bin:/usr/local/bin:/usr/bin:/bin; ulimit -n 65536
K=$HOME/sb4-pub-0443-kit; C=$HOME/sb4-pub-0441/snapback4/target/publication/client-0.4.43; cd $HOME/sb4-pub-0441/snapback4
for i in 1 2; do O=$HOME/sb4-pub-0443-records/iso-sec-$i
  env -u SNAPBACK4_BIN -u NPM_TOKEN -u NODE_AUTH_TOKEN SNAPBACK4_SECURITY_PROGRESS=1 NPM_CONFIG_CACHE=$HOME/sb4-pub-0443-records/npm-cache-iso timeout 2400 node $K/iso-rest/sec.mjs $C/snapback4-0.4.43.tgz $K/iso-rest/pkg/snapback4-linux-x64-0.4.43.tgz $O > $K/isolated/sec-$i.log 2>&1
  echo "run $i rc=$? load=$(cut -d' ' -f1 /proc/loadavg) $(grep ^ISO-SEC $K/isolated/sec-$i.log | cut -c1-300)"; rm -rf $O
done; git status --porcelain; echo iso-done
