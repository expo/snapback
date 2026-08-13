#!/bin/zsh
cd /Users/ccheever/projects/snapback/.claude/worktrees/aw-integ
for i in 1 2 3 4 5 6; do
  echo "=== attempt $i $(date +%H:%M:%S) ===" >> codex-fixround2.log
  codex exec -m gpt-5.6-sol -c model_reasoning_effort=xhigh --ignore-user-config -s workspace-write -c sandbox_workspace_write.network_access=true "Read FIXROUND2-CHARTER.md in the current directory and execute it exactly. (Prior attempts died on Codex-backend network failures before making changes; if partial work now exists, reconcile it first via git status/diff.)" </dev/null >> codex-fixround2.log 2>&1
  [ -f REPORT-fixround2.md ] && { echo "SUCCESS attempt $i" >> retry-status.log; exit 0; }
  echo "attempt $i ended without report" >> retry-status.log
  sleep 300
done
echo "EXHAUSTED" >> retry-status.log
