#!/bin/bash
# Isolate the Mac dry-run-1 red at f032742ac8: snapback4-lang column_reads generated_native_rows_decode_audience_omissions
# (rustc: can't find crate for snapback4_native). The test passes the FIRST libsnapback4_native-*.rlib in read_dir order;
# the reused publish target holds 12 from earlier builds. Phase A: as-is x3. Phase B: stale native rlibs (older than this
# dry run's start) moved to an archive outside deps, then x3. Built binaries; default TMPDIR.
export PATH=/Users/ccheever/sb4-03-lanes/codesign-relay:/Users/ccheever/.elan/bin:/Users/ccheever/.volta/tools/image/node/24.18.0/bin:/Users/ccheever/.bun/bin:/Users/ccheever/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
K=$HOME/sb4-pub-0443; O=$K/isolated/dr1b; mkdir -p $O; W=$HOME/projects/snapback-pub-0428/snapback4; D=$W/target/debug/deps
for f in $(ls -t $D/column_reads-* | grep -v '\.d$'); do $f --list 2>/dev/null | grep -q '^generated_native_rows_decode_audience_omissions: test' && { exe=$f; break; }; done
[ -e $K/stale-native-rlibs ] && { mv $K/stale-native-rlibs/* $D/ && rmdir $K/stale-native-rlibs; echo restored; }; echo "exe $exe $(stat -f '%Sm' $exe)"
echo "first rlib in read_dir order: $(ls -f $D | grep '^libsnapback4_native-.*rlib$' | head -1)"
for i in 1 2 3; do (cd $W/crates/snapback4-lang && $exe generated_native_rows_decode_audience_omissions --exact > $O/colr-a$i.log 2>&1); echo "A run $i rc=$? $(grep -E '^test result|E0463' $O/colr-a$i.log | head -2 | tr '\n' ' ')"; done
S=$K/stale-native-rlibs; mkdir -p $S
find $D -maxdepth 1 -name 'libsnapback4_native-*' ! -newer $K/dry-run-1.pid -exec mv {} $S/ \;
echo "kept: $(ls $D | grep '^libsnapback4_native-' | tr '\n' ' ')"; echo "moved: $(ls $S | wc -l)"
for i in 1 2 3; do (cd $W/crates/snapback4-lang && $exe generated_native_rows_decode_audience_omissions --exact > $O/colr-b$i.log 2>&1); echo "B run $i rc=$? $(grep -E '^test result|E0463' $O/colr-b$i.log | head -2 | tr '\n' ' ')"; done
(cd $W/crates/snapback4-lang && $exe > $O/colr-target.log 2>&1); echo "B whole target rc=$? $(grep -E '^test result' $O/colr-target.log)"
git -C $W status --porcelain | head -3; echo iso-done
