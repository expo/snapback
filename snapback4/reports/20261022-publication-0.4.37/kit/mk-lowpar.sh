#!/bin/bash
# Build publish-lowpar.sh + gate-lowpar.sh: identical dry run, but SNAPBACK4_RUST_TEST_PROCESSES=$RUSTPROCS (default 6) instead of the unset default (18 on the M5).
set -e; K=$HOME/sb4-pub-0437
python3 - $K/publish.sh $K/publish-lowpar.sh <<'PY'
import sys
s=open(sys.argv[1]).read()
old='dry-run) step publication-dry-run . env -u SNAPBACK4_RUST_TEST_PROCESSES '
assert s.count(old)==1
s=s.replace(old,'dry-run) step publication-dry-run . env SNAPBACK4_RUST_TEST_PROCESSES=${RUSTPROCS:-6} ')
lines=s.split('\n'); lines.insert(2,'# LOW-PARALLELISM variant (coordinator, 0.4.37 attempt 7+): Rust test binaries limited by SNAPBACK4_RUST_TEST_PROCESSES; client files stay serial (SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1); nothing skipped; TMPDIR untouched.')
open(sys.argv[2],'w').write('\n'.join(lines))
PY
sed -e 's#bash \./publish\.sh dry-run #bash ./publish-lowpar.sh dry-run #' $K/gate-dryrun.sh > $K/gate-lowpar.sh
chmod +x $K/publish-lowpar.sh $K/gate-lowpar.sh
diff $K/publish.sh $K/publish-lowpar.sh | cut -c1-200; diff $K/gate-dryrun.sh $K/gate-lowpar.sh | cut -c1-160
