#!/bin/bash
set -u
R=$HOME/sb4-pub-0451-records
phase=${1:-sb4-pub51-opening-broad}
output=${2:-$R/opening-broad-disk.log}
while systemctl --user is-active --quiet "$phase"; do
 free=$(df -BG --output=avail "$HOME" | tail -1 | tr -dc '0-9')
 printf '%s free=%sGiB load=%s\n' "$(date -u +%FT%TZ)" "$free" "$(cut -d' ' -f1-3 /proc/loadavg)" >> "$output"
 if [ "$free" -lt 40 ] && [ -d "$HOME/sb4-pub-0441/target/debug" ]; then
  python3 "$HOME/sb4-pub-0451-kit/log-status.py" "Disk threshold: ${free}GiB free; removing only ~/sb4-pub-0441/target/debug as explicitly authorized. Snapback4 active target is separate."
  rm -rf "$HOME/sb4-pub-0441/target/debug"
 fi
 if [ "$free" -lt 80 ]; then sleep 10; else sleep 60; fi
done
