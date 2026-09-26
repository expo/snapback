#!/bin/bash
# usage: ATTEMPT=<n> ROOT=<snapback4 dir> REP=<report dir> pubstep.sh <name> <cwd-relative-to-snapback4> <command...>
# Records attempt-<n>-<name>.{log,json} under REP; refuses to overwrite a record.
export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$HOME/.bun/bin:$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
attempt=${ATTEMPT:-1}
name=$1; rel=$2; shift 2
mkdir -p $REP
rec=$REP/attempt-$attempt-$name
[ -e $rec.json ] && { echo "record exists: $rec.json"; exit 98; }
cd "$ROOT/$rel" || exit 97
start=$(python3 -c 'import time;print(time.time())')
"$@" > $rec.log 2>&1
rc=$?
end=$(python3 -c 'import time;print(time.time())')
python3 - "$name" "$(pwd)" "$start" "$end" "$rc" "$@" > $rec.json <<'PY'
import json, sys
name, cwd, start, end, rc = sys.argv[1:6]
print(json.dumps({"step": name, "command": sys.argv[6:], "cwd": cwd, "start": float(start), "end": float(end), "seconds": round(float(end)-float(start), 3), "exit": int(rc)}, indent=2))
PY
echo "$name exit=$rc seconds=$(python3 -c "print(round($end-$start,1))")"
exit $rc
