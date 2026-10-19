#!/bin/bash
# Start the 0.4.31 dry run only on AC power with the lid open (a 2.5 h run cannot finish on battery or in clamshell sleep). Checks every 2 min for up to 24 h.
K=~/sb4-pub-0431; ATT=${ATT:?}
for i in $(seq 1 720); do
  ac=$(pmset -g batt | head -1 | grep -c "AC Power"); lid=$(ioreg -r -k AppleClamshellState | grep -c "\"AppleClamshellState\" = No")
  echo "$(date -u +%FT%TZ) ac=$ac lid_open=$lid $(pmset -g batt | sed -n 2p | awk "{print \$3}")" >> $K/gate-$ATT.log
  if [ "$ac" = 1 ] && [ "$lid" = 1 ]; then
    cd ~/projects/snapback-pub-0428/snapback4 && find . -maxdepth 4 -name ".rg-matrix-*" -not -path "*/node_modules/*" -exec rm -rf {} + 2>/dev/null
    echo "$(date -u +%FT%TZ) starting dry run attempt $ATT" >> $K/gate-$ATT.log
    cd $K && rm -f dry-run-$ATT.exit && ATTEMPT=$ATT caffeinate -ims bash ./publish.sh dry-run > dryrun-a$ATT.log 2>&1
    exit 0
  fi
  sleep 120
done
