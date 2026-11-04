#!/bin/bash
# usage: REP=<records dir> ROOT=<snapback4 dir> ATTEMPT=<n> step.sh <name> <cwd-relative-to-ROOT> <command...>
# Records attempt-<n>-<name>.{log,json}; refuses to overwrite a record.
export PATH=$HOME/.bun-1.4.2/bin:$HOME/.local/bin:$HOME/.cargo/bin:/usr/local/bin:/usr/bin:/bin
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
unset SNAPBACK4_BIN
attempt=${ATTEMPT:-1}; name=$1; rel=$2; shift 2
mkdir -p "$REP"; rec=$REP/attempt-$attempt-$name
[ -e $rec.json ] || [ -e $rec.log ] && { echo "record exists: $rec.json"; exit 98; }
cd "$ROOT/$rel" || exit 97
start=$(date +%s.%N)
"$@" > $rec.log 2>&1; rc=$?
end=$(date +%s.%N)
python3 - "$name" "$(pwd)" "$start" "$end" "$rc" "$@" > $rec.json <<'PY'
import json, sys
name, cwd, start, end, rc = sys.argv[1:6]
print(json.dumps({"step": name, "command": sys.argv[6:], "cwd": cwd, "start": float(start), "end": float(end), "seconds": round(float(end)-float(start), 3), "exit": int(rc)}, indent=2))
PY
echo "$name exit=$rc seconds=$(python3 -c "print(round($end-$start,1))")"
exit $rc
