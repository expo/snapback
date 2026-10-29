#!/bin/bash
# Kill the 0.4.49 Mac dry run + gate, and nothing else.
# 0.4.49 fix: the 0.4.38 version matched `scripts/run-client-tests[.]mjs` on any command line, which also
# matched other sessions' client pools (Integration 24 in ~/projects/snapback-integ24). Now the targets are
# (a) the gate scripts whose cwd is this kit, plus all their descendants, and (b) any process whose cwd is
# inside the publish worktree (orphans). Patterns use [.] so they never match this script's own command line.
K=/Users/ccheever/sb4-pub-0449; W=/Users/ccheever/sb4-pub-0444-wt
descendants() { local c; for c in $(pgrep -P "$1"); do descendants "$c"; echo "$c"; done; }
cwdof() { lsof -a -d cwd -p "$1" -Fn 2>/dev/null | sed -n 's/^n//p'; }
targets() {
  local p r
  for r in $(pgrep -f 'gate-(dryrun|lowpar|evidence|tolerant)[.]sh'); do [ "$(cwdof $r)" = "$K" ] && { descendants $r; echo $r; }; done
  lsof -d cwd -Fpn 2>/dev/null | awk -v w="$W" '/^p/{p=substr($0,2)} /^n/{n=substr($0,2); if (n==w || index(n, w"/")==1) print p}'
}
pids=$(targets | sort -u | grep -v "^$$\$")
echo "killing: $(echo $pids | wc -w) pids"; for p in $pids; do ps -o pid=,command= -p $p | cut -c1-110; done
[ -n "$pids" ] && kill $pids 2>/dev/null; sleep 5
left=$(targets | sort -u | grep -v "^$$\$")
[ -n "$left" ] && kill -9 $left 2>/dev/null; sleep 2
echo "remaining:"; targets | sort -u | grep -v "^$$\$"
cd $W/snapback4 && find . -maxdepth 4 -name ".rg-matrix-*" -not -path "*/node_modules/*" -print -exec rm -rf {} +
echo "status:"; git status --porcelain; git rev-parse HEAD
