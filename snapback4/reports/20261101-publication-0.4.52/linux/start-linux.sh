#!/bin/bash
# usage: start-linux.sh <attempt> <expected full sha>: launch linux.sh + disklog + on-linux-pass as systemd user units (OOMPolicy=continue).
A=${1:?}; C=${2:?}; R=~/sb4-pub-0452-records; W=~/sb4-pub-0441
[ "$(git -C $W rev-parse HEAD)" = "$C" ] || { echo "HEAD mismatch: $(git -C $W rev-parse HEAD)"; exit 1; }
[ -z "$(git -C $W status --porcelain)" ] || { echo "dirty: $(git -C $W status --porcelain | head -3)"; exit 1; }
[ -s $W/snapback4/target/publication/client-0.4.52/snapback4-0.4.52.tgz ] || { echo "no prepared client"; exit 1; }
[ -e $R/linux-$A.exit ] && { echo "linux-$A.exit exists"; exit 1; }
echo "free $(df -BG --output=avail ~ | tail -1 | tr -d ' ') load $(cut -d' ' -f1-3 /proc/loadavg)"
~/sb4-loop/unit.sh pub52-linux-$A 80G ~/sb4-pub-0452-kit "ATTEMPT=$A bash ./linux.sh > linux-$A.out 2>&1"
~/sb4-loop/unit.sh pub52-disklog-$A 256M ~/sb4-pub-0452-kit "bash ./disklog.sh $A"
~/sb4-loop/unit.sh pub52-onpass-$A 1G ~/sb4-pub-0452-kit "./on-linux-pass.sh $A > on-linux-pass-$A.out 2>&1"
sleep 2; systemctl --user list-units "sb4-pub52-*" --no-pager | grep sb4-
