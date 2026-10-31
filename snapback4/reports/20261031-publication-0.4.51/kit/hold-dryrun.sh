#!/bin/bash
# usage: hold-dryrun.sh stop|cont|status <pid>  -- SIGSTOP/SIGCONT only the dry run's `node scripts/publish.mjs --dry-run` process
# (refuses any other pid). While stopped, its spawnSync'd scripts/test.sh suite keeps running; when the suite ends, publish.mjs
# stays paused before it reads --linux-receipt (publish.mjs:72-79) until SIGCONT after the qualified receipt is in target/incoming.
P=${2:?pid}; W=/Users/ccheever/sb4-pub-0444-wt/snapback4
cmd=$(ps -o command= -p $P); c=$(lsof -a -d cwd -p $P -Fn 2>/dev/null | sed -n 's/^n//p')
case "$cmd" in "node scripts/publish.mjs --dry-run "*) ;; *) echo "refusing: $cmd"; exit 1;; esac
[ "$c" = "$W" ] || { echo "refusing cwd $c"; exit 1; }
case $1 in stop) kill -STOP $P;; cont) kill -CONT $P;; status) ;; esac
echo "$(date -u +%FT%TZ) $1 $P stat=$(ps -o stat= -p $P)" | tee -a $HOME/sb4-pub-0451/hold-dryrun.log
