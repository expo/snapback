#!/bin/bash
set -eu
K=$HOME/sb4-pub-0451; cd "$K"
# Refuse this idle-only rearm once native has started or AC has returned.
[ ! -e native-a1.log ]
pmset -g batt | head -1 | grep -q 'Battery Power'
bash ./kill-dryrun.sh > idle-wait-rearm-cleanup.log 2>&1
nohup caffeinate -ims bash ./chain-gate-a1.sh > chain-gate-a1-rearmed.out 2>&1 < /dev/null &
echo "native resource gate pid=$!"
nohup caffeinate -ims bash ./audit-after-prepare.sh > audit-after-prepare-rearmed.out 2>&1 < /dev/null &
echo "audit waiter pid=$!"
