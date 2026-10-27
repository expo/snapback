#!/bin/bash
# Flake rule step 1 on Linux: linux-2 red snapback4::snapback4 serve::tests::latency_tests::headers::maintenance_writer_admission_under_a_request_sample_is_wait
# ("acquisition escaped wait": wait 148.398 ms < 150 ms OPEN_DELAY; Linux load ~100). Suite-built test binary, exact test, x6, then x3 of the headers module.
O=$HOME/sb4-pub-0443-kit/isolated/l2; mkdir -p $O; B=$HOME/sb4-pub-0441/snapback4/target/debug/deps/snapback4-2cc9bf68642d8056
cd $HOME/sb4-pub-0441/snapback4/crates/snapback4
for i in 1 2 3 4 5 6; do $B serve::tests::latency_tests::headers::maintenance_writer_admission_under_a_request_sample_is_wait --exact > $O/lat-$i.log 2>&1; echo "exact run $i rc=$? load=$(cut -d' ' -f1 /proc/loadavg) $(grep -E '^test result' $O/lat-$i.log)"; done
for i in 1 2 3; do $B serve::tests::latency_tests::headers > $O/hdr-$i.log 2>&1; echo "module run $i rc=$? load=$(cut -d' ' -f1 /proc/loadavg) $(grep -E '^test result' $O/hdr-$i.log)"; done
echo iso-done
