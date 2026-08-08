#!/bin/zsh
# Runs the remaining OQ4 arms sequentially; burst-on already ran.
set -uo pipefail
cd ${0:A:h:h}
typeset -a arms
arms=(
  "burst-off off fixed 6 mixed"
  "settle-on on settle-gated 6 mixed"
  "settle-off off settle-gated 6 mixed"
  "sustained-on on sustained 6 mixed"
  "sustained-off off sustained 6 mixed"
  "burst-on-obs0 on fixed 0 mixed"
  "burst-off-obs0 off fixed 0 mixed"
  "burst-on-obs1 on fixed 1 mixed"
  "burst-off-obs1 off fixed 1 mixed"
  "burst-on-same6 on fixed 6 same"
  "burst-off-same6 off fixed 6 same"
)
for arm in $arms; do
  parts=(${(z)arm})
  print "OQ4_ARM_START ${parts[1]} $(date +%H:%M:%S)"
  if zsh scripts/run-oq4-arm.sh ${parts[@]} >/tmp/oq4-arm-${parts[1]}.log 2>&1; then
    print "OQ4_ARM_DONE ${parts[1]} status=0 $(date +%H:%M:%S)"
  else
    print "OQ4_ARM_DONE ${parts[1]} status=$? $(date +%H:%M:%S) (log: /tmp/oq4-arm-${parts[1]}.log)"
  fi
done
print "OQ4_MATRIX_COMPLETE $(date +%H:%M:%S)"
