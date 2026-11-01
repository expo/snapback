#!/bin/bash
# Kill the leftover 0.4.52 Linux qualify attempt N (root: linux.sh pid $1) and every descendant / session member.
ROOT=${1:?}
desc() { local c; for c in $(pgrep -P "$1"); do desc "$c"; echo "$c"; done; }
sid=$(ps -o sid= -p $ROOT | tr -d ' ')
pids="$(desc $ROOT) $ROOT $( [ -n "$sid" ] && pgrep -s $sid )"
pids=$(echo $pids | tr ' ' '\n' | grep -v "^$$\$" | sort -u)
echo "killing $(echo $pids | wc -w) pids (sid=$sid)"
kill $pids 2>/dev/null; sleep 5
left=$(for p in $pids; do kill -0 $p 2>/dev/null && echo $p; done)
[ -n "$left" ] && kill -9 $left 2>/dev/null; sleep 2
echo "remaining in session: $( [ -n "$sid" ] && pgrep -s $sid | wc -l )"
pgrep -af 'sb4-pub-0441/snapback4' | grep -v kill-linux | cut -c1-150 | head
