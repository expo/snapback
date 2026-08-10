#!/bin/bash
# Self-healing landing loop (field-manual pattern, cf. land-p1.sh lineage).
# Rounds: fetch -> rebase (theirs for generated-only conflicts) -> regen -> amend -> push.
set -u
cd "$(dirname "$0")"
NODE="volta run --node 24.18.0 node"
for round in 1 2 3 4 5 6 7 8 9 10; do
  echo "== ROUND $round =="
  NEED_REGEN=0
  git fetch origin main 2>&1 | tail -1
  if ! git rebase origin/main >/dev/null 2>&1; then
    CONF=$(git diff --name-only --diff-filter=U)
    # Only generated/carrier surfaces may be auto-resolved; src/*.rs (except
    # manifest.rs embedded records) must escalate.
    BAD=$(echo "$CONF" | /usr/bin/grep -v -e '^guide/' -e '^src/local-.*\.json$' -e '^src/manifest\.rs$' -e '^tests/conformance/' || true)
    if [ -n "$BAD" ]; then
      echo "ESCALATE: non-generated conflicts: $BAD"
      git rebase --abort
      exit 3
    fi
    echo "$CONF" | xargs git checkout --theirs -- || { git rebase --abort; exit 4; }
    echo "$CONF" | xargs git add --
    git add -u
    GIT_EDITOR=true git rebase --continue >/dev/null 2>&1 || { git rebase --abort; exit 5; }
    echo "resolved $(echo "$CONF" | wc -l | tr -d ' ') generated conflicts"
    NEED_REGEN=1
  fi
  if [ "$NEED_REGEN" = 1 ] || [ "$round" = 1 ]; then
    $NODE scripts/refresh-publication-carrier.mjs > /dev/null 2>&1
    $NODE tests/conformance/local-persistent-store-publication-v1.mjs > /dev/null 2>&1 || { echo "CONFORMANCE RED"; exit 6; }
    $NODE scripts/generate-diagnostics-registry.mjs > /dev/null 2>&1
    $NODE scripts/generate-guide-manifest.mjs > /dev/null 2>&1
    $NODE scripts/check-guide.mjs > /tmp/land-guide.out 2>&1 || { echo "GUIDE RED"; tail -3 /tmp/land-guide.out; exit 7; }
    git add -A ':!.codex*' ':!.agent-summary*' ':!land-asset.sh' ':!.verify*'
    git commit -q --amend --no-edit
  fi
  OUT=$(git push origin HEAD:main 2>&1 | tail -4)
  echo "$OUT"
  if echo "$OUT" | /usr/bin/grep -q "HEAD -> main" && ! echo "$OUT" | /usr/bin/grep -q "rejected"; then
    echo "PUSHED round $round"
    exit 0
  fi
done
echo "EXHAUSTED"
exit 9
