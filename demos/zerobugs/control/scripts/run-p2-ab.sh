#!/bin/zsh
# LLP 0200 Phase-2 A/B arms (H-3) against the OQ4 baseline clone.
# Data-only arms measure the zero-quarantine clause + convergence vs the
# serial-evaluation floor; the authority arm measures fence-applied p95 and
# the restoration latency distribution (§2.4).
set -uo pipefail
cd ${0:A:h:h}
run() {
  print "P2_ARM_START $1 $(date +%H:%M:%S)"
  if zsh scripts/run-oq4-arm.sh "$@" >/tmp/p2-arm-$1.log 2>&1; then
    print "P2_ARM_DONE $1 status=0 $(date +%H:%M:%S)"
  else
    print "P2_ARM_DONE $1 status=$? $(date +%H:%M:%S) (log: /tmp/p2-arm-$1.log)"
  fi
}
run p2-burst-on on fixed 6 mixed
run p2-burst-obs0 on fixed 0 mixed
run p2-sustained-on on sustained 6 mixed
OQ4_FIXTURE=authority OQ4_AUTHORITY_TRANSITIONS=4 run p2-authority-burst on fixed 6 mixed
print "P2_AB_COMPLETE $(date +%H:%M:%S)"
