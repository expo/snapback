#!/bin/bash
set -eu
cd /home/ccheever/sb4-intent/lane-ct/snapback4
r=reports/20261001-ct-contended-reads/round2/qualification
ulimit -n 4096
export LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT
set +e
cargo test -p snapback4 --bin snapback4 > "$r/affected.log" 2>&1
status=$?
printf '%s\n' "$status" > "$r/affected.exit"
set -e
[ "$status" = 0 ]
cargo build --profile production > "$r/production.log" 2>&1
cp target/production/snapback4 /tmp/ct-r2-restored
cp crates/snapback4/src/thread_priority.rs /tmp/ct-r2-priority-restored.rs
trap 'cp /tmp/ct-r2-priority-restored.rs crates/snapback4/src/thread_priority.rs' EXIT
python3 - <<'PY'
p='crates/snapback4/src/thread_priority.rs';s=open(p).read();a=s.index('pub(crate) fn maintenance()');b=s.index('pub(crate) fn background()',a);s=s[:a]+'pub(crate) fn maintenance() { background(); }\n'+s[b:];open(p,'w').write(s)
PY
git diff -- crates/snapback4/src/thread_priority.rs > "$r/demoted-build-source.diff"
cargo build --profile production > "$r/demoted-build.log" 2>&1
cp target/production/snapback4 /tmp/ct-r2-demoted
