#!/bin/bash
# usage: ATTEMPT=<n> pubstep.sh <name> <cwd-relative-to-snapback4> <command...>
# Records attempt-<n>-<name>.{log,json} under the 0.4.2 publication report
# directory, and refuses to overwrite a record that already exists.
export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$HOME/.bun/bin:$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
attempt=${ATTEMPT:-2}
name=$1; rel=$2; shift 2
root=$HOME/projects/snapback-pub-042/snapback4
rep=$root/reports/20260925-publication-0.4.2
mkdir -p $rep
rec=$rep/attempt-$attempt-$name
[ -e $rec.json ] && { echo "record exists: $rec.json"; exit 98; }
cd "$root/$rel" || exit 97
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
