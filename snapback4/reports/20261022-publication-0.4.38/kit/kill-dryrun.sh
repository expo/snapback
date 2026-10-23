#!/bin/bash
# Kill the Mac dry run + gate. Patterns use [.] so they never match this script's own command line.
P='gate-(dryrun|lowpar|evidence)[.]sh|pubstep[.]sh publication-dry-run|publish[.]mjs --dry-run|snapback-pub-0428/snapback4/(scripts|target|packages/snapback4/test)/|scripts/run-client-tests[.]mjs'
pids=$(pgrep -f "$P" | grep -v "^$$\$")
[ -n "$pids" ] && kill $pids 2>/dev/null; sleep 5
pids=$(pgrep -f "$P" | grep -v "^$$\$")
[ -n "$pids" ] && kill -9 $pids 2>/dev/null; sleep 2
echo "remaining:"; pgrep -fl "$P" | cut -c1-120
W=/Users/ccheever/projects/snapback-pub-0428/snapback4
cd $W && find . -maxdepth 4 -name ".rg-matrix-*" -not -path "*/node_modules/*" -print -exec rm -rf {} +
echo "status:"; git status --porcelain; git rev-parse HEAD
