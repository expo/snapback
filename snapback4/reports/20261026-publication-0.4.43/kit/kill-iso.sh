#!/bin/bash
# Kill one of my isolation scripts (root pid $1) and its descendants, only if its cwd is my kit or the publish worktree.
R=${1:?}; c=$(lsof -a -d cwd -p $R -Fn 2>/dev/null | sed -n 's/^n//p')
case "$c" in $HOME/sb4-pub-0443*|$HOME/projects/snapback-pub-0428*) ;; *) echo "refusing: cwd $c"; exit 1;; esac
desc() { local x; for x in $(pgrep -P "$1"); do desc "$x"; echo "$x"; done; }
p="$(desc $R) $R"; echo "killing: $(echo $p | wc -w)"; kill $p 2>/dev/null; sleep 3; kill -9 $p 2>/dev/null
ps -axo pid,command | grep -E "proof.test.mjs|hold\.mjs" | grep -v grep | cut -c1-140
cd $HOME/projects/snapback-pub-0428 && git status --porcelain | head -3
