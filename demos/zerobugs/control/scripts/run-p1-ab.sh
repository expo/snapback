#!/bin/zsh
# LLP 0200 Phase-1 A/B arms (H-1/H-2) against the OQ4 baseline clone.
set -uo pipefail
cd ${0:A:h:h}
run() {
  print "P1_ARM_START $1 $(date +%H:%M:%S)"
  if zsh scripts/run-oq4-arm.sh "$@" >/tmp/p1-arm-$1.log 2>&1; then
    print "P1_ARM_DONE $1 status=0 $(date +%H:%M:%S)"
  else
    print "P1_ARM_DONE $1 status=$? $(date +%H:%M:%S) (log: /tmp/p1-arm-$1.log)"
  fi
}
run p1-burst-on on fixed 6 mixed
run p1-burst-off off fixed 6 mixed
run p1-burst-obs0 on fixed 0 mixed
run p1-sustained-on on sustained 6 mixed
run p1-sustained-obs0 on sustained 0 mixed
SNAPBACK_LIVE_SCHEDULER_DISABLED=1 run p1-burst-legacy on fixed 6 mixed
print "P1_AB_COMPLETE $(date +%H:%M:%S)"
