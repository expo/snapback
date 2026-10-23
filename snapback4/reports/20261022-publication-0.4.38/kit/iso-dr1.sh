#!/bin/bash
# Isolate the two Mac dry-run-1 reds at 951ecdd4df: security_wave19 (whole target) and run_admission (the failing test), 3x each, default TMPDIR.
export PATH=/Users/ccheever/sb4-03-lanes/codesign-relay:/Users/ccheever/.elan/bin:/Users/ccheever/.volta/tools/image/node/24.18.0/bin:/Users/ccheever/.bun/bin:/Users/ccheever/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer CARGO_INCREMENTAL=0 LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT
unset SNAPBACK4_BIN
ulimit -n 65536
K=$HOME/sb4-pub-0438; O=$K/isolated/dr1; mkdir -p $O; W=$HOME/projects/snapback-pub-0428/snapback4; cd $W
cargo test --workspace --no-run --message-format=json 2>/dev/null | python3 -c '
import json,sys
for l in sys.stdin:
  try: m=json.loads(l)
  except: continue
  if m.get("reason")=="compiler-artifact" and m.get("executable") and m["target"]["name"] in ("security_wave19","run_admission") and m["target"]["kind"]==["test"]:
    print(m["target"]["name"], m["executable"], m["manifest_path"])' > $O/bins.txt
cat $O/bins.txt
while read name exe manifest; do
  dir=$(dirname $manifest)
  for i in 1 2 3; do
    s=$(date +%s)
    if [ $name = run_admission ]; then (cd $dir && $exe live_dev_forwards_run_refuses_other_offline_writers_with_its_address_and_releases_on_exit --exact > $O/$name-$i.log 2>&1); else (cd $dir && $exe > $O/$name-$i.log 2>&1); fi
    echo "$name run $i rc=$? $(( $(date +%s)-s )) s load=$(sysctl -n vm.loadavg) $(grep -E '^test result' $O/$name-$i.log)"
  done
done < $O/bins.txt
git -C $W status --porcelain | head -3; echo iso-done
