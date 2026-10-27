#!/bin/bash
# Isolate the Mac dry-run-1 red at f032742ac8 (RUSTPROCS=3): snapback4 security_wave19 check_refutes_excluded_contact_roles_before_any_full_test
# (check 1,706.5 ms vs the 1,500 ms budget; "0 refuted, 2 unproved"): the test alone 5x, and the whole snapback4 security_wave19 target 3x; built binaries, default TMPDIR.
export PATH=/Users/ccheever/sb4-03-lanes/codesign-relay:/Users/ccheever/.elan/bin:/Users/ccheever/.volta/tools/image/node/24.18.0/bin:/Users/ccheever/.bun/bin:/Users/ccheever/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer CARGO_INCREMENTAL=0 LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT
unset SNAPBACK4_BIN
ulimit -n 65536
K=$HOME/sb4-pub-0443; O=$K/isolated/dr1; mkdir -p $O; W=$HOME/projects/snapback-pub-0428/snapback4; cd $W
cargo test --workspace --no-run --message-format=json 2>/dev/null | python3 -c '
import json,sys
for l in sys.stdin:
  try: m=json.loads(l)
  except: continue
  if m.get("reason")=="compiler-artifact" and m.get("executable") and m["target"]["name"]=="security_wave19" and m["target"]["kind"]==["test"] and m["manifest_path"].endswith("crates/snapback4/Cargo.toml"):
    print(m["target"]["name"], m["executable"], m["manifest_path"])' > $O/bins.txt
cat $O/bins.txt
exe=$(awk '{print $2}' $O/bins.txt | head -1); dir=$W/crates/snapback4
for i in 1 2 3 4 5; do s=$(date +%s); (cd $dir && $exe check_refutes_excluded_contact_roles_before_any_full_test --exact > $O/test-$i.log 2>&1); echo "test run $i rc=$? $(( $(date +%s)-s )) s load=$(sysctl -n vm.loadavg) $(grep -E '^test result' $O/test-$i.log)"; done
for i in 1 2 3; do s=$(date +%s); (cd $dir && $exe > $O/target-$i.log 2>&1); echo "target run $i rc=$? $(( $(date +%s)-s )) s load=$(sysctl -n vm.loadavg) $(grep -E '^test result' $O/target-$i.log)"; done
git -C $W status --porcelain | head -3; echo iso-done
