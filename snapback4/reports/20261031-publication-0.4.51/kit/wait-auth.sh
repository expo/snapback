#!/bin/bash
# Coordinator ruling 2026-10-30T17:10Z: run only after successful qualification and staged direct smokes, immediately before finish.
# Require npm identity success; retain stage and stop if unavailable for 12 hours. Never display credentials.
set -u
umask 077
K=$HOME/sb4-pub-0451
export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:/opt/homebrew/bin:/usr/bin:/bin
mkdir -p "$K/auth-checks"
[ ! -e "$K/auth-ready.exit" ] || { echo 'auth-ready.exit already exists'; exit 1; }
start=$(date +%s); deadline=$((start+43200)); n=0
while :; do
 n=$((n+1)); now=$(date +%s)
 echo "$(date -u +%FT%TZ) identity check $n" >> "$K/auth-wait.log"
 npm whoami > "$K/auth-checks/check-$n.log" 2>&1
 rc=$?
 if [ "$rc" = 0 ]; then
  echo "$(date -u +%FT%TZ) npm identity succeeded; qualification stage unchanged; ready for finish" >> "$K/auth-wait.log"
  echo done > "$K/auth-ready.exit"
  exit 0
 fi
 echo "$(date -u +%FT%TZ) npm identity rc=$rc; deferred; next check in 15 minutes (12-hour limit)" >> "$K/auth-wait.log"
 if [ "$(date +%s)" -ge "$deadline" ]; then
  echo "$(date -u +%FT%TZ) STOPPED: npm authentication unavailable for 12 hours; qualified stage retained; no upload" >> "$K/auth-wait.log"
  echo stopped > "$K/auth-ready.exit"
  exit 1
 fi
 remaining=$((deadline-$(date +%s)))
 [ "$remaining" -le 900 ] || remaining=900
 [ "$remaining" -le 0 ] || sleep "$remaining"
done
