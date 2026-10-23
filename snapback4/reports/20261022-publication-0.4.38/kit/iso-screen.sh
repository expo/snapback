#!/bin/bash
# Flake rule step 1 on the Mac: screen-lifetimes-react.test.mjs alone, via the suite's runner, same tree the dry run built.
O=$HOME/sb4-pub-0438/isolated; mkdir -p $O
export PATH=/Users/ccheever/.volta/tools/image/node/24.18.0/bin:/Users/ccheever/.bun/bin:/Users/ccheever/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
ulimit -n 65536
cd $HOME/projects/snapback-pub-0428/snapback4
{ date -u; echo "listening TCP sockets: $(netstat -an -p tcp | grep -c LISTEN)"; echo "tcp6 LISTEN: $(netstat -an -p tcp | grep LISTEN | grep -c tcp6)"; echo "established+time_wait: $(netstat -an -p tcp | grep -cE 'ESTABLISHED|TIME_WAIT')"; sysctl net.inet.ip.portrange.first net.inet.ip.portrange.last; uptime; } > $O/ports-snapshot.txt
for i in 1 2 3 4 5 6; do
  env -u SNAPBACK4_BIN SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1 timeout 900 node scripts/run-client-tests.mjs 1 files packages/snapback4/test/screen-lifetimes-react.test.mjs > $O/screen-lifetimes-react-$i.log 2>&1
  echo "run $i rc=$? $(grep -E '^-- client files:' $O/screen-lifetimes-react-$i.log | cut -c1-160)"
done
git status --porcelain
