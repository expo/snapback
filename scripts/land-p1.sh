#!/bin/zsh
# LLP 0200 Phase-1 landing loop: self-healing merge+regen+push cycles.
# Aborts only on src conflicts (need human judgment) or after max rounds.
set -u
cd ${0:A:h:h}
for i in {1..10}; do
  git fetch origin -q
  if ! git merge origin/main --no-edit > /tmp/land-m$i.log 2>&1; then
    conflicts=$(git diff --name-only --diff-filter=U)
    if print -r -- "$conflicts" | grep -qv -E "^(guide/|demos/.*generated|tests/fixtures/client-bundle-metrology/)"; then
      print "SRC_CONFLICT round $i:"; print -r -- "$conflicts" | head -8
      exit 2
    fi
    print -r -- "$conflicts" | xargs git checkout --theirs 2>/dev/null
    git add -A && git commit -q --no-edit
  fi
  volta run --node 24.18.0 node scripts/generate-guide-manifest.mjs > /tmp/land-g$i.log 2>&1 || { print "GUIDE_REGEN_FAILED round $i"; tail -3 /tmp/land-g$i.log; exit 3; }
  if ! git diff --quiet || ! git diff --cached --quiet; then
    git add -A && git commit -q -m "spike(0200-p1): landing-cycle guide regen (round $i)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  fi
  if git push origin HEAD:main > /tmp/land-p$i.log 2>&1; then
    print "PUSHED round $i"
    tail -2 /tmp/land-p$i.log
    exit 0
  fi
  print "push $i: $(grep -m1 -E 'REFUSED|non-fast-forward' /tmp/land-p$i.log | head -c 110)"
done
print "MAX_ROUNDS"
exit 1
