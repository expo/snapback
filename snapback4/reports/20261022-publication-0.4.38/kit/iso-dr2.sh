#!/bin/bash
# Isolate the Mac dry-run-2 red at 951ecdd4df: snapback4 security_wave19 check_refutes_excluded_contact_roles_before_any_full_test, 5x alone, default TMPDIR.
export PATH=/Users/ccheever/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
ulimit -n 65536
K=$HOME/sb4-pub-0438; O=$K/isolated/dr2; mkdir -p $O; W=$HOME/projects/snapback-pub-0428/snapback4
exe=$(awk '$1=="security_wave19" && $3 ~ /crates\/snapback4\/Cargo.toml/ {print $2}' $K/isolated/dr1/bins.txt)
for i in 1 2 3 4 5; do s=$(date +%s); (cd $W/crates/snapback4 && $exe check_refutes_excluded_contact_roles_before_any_full_test --exact > $O/run-$i.log 2>&1); echo "run $i rc=$? $(( $(date +%s)-s )) s load=$(sysctl -n vm.loadavg) $(grep -E '^test result' $O/run-$i.log)"; done
git -C $W status --porcelain | head -3; echo iso-done
