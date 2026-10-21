#!/usr/bin/env bash
# Run ONLY on expo-build-450a. Owns ~/sb4scale/pg17; no other cluster.
set -euo pipefail
umask 077
scale_root="$HOME/sb4scale"
pgbin="$HOME/tools/pg17/usr/lib/postgresql/17/bin"
pgshare="$HOME/tools/pg17/usr/share/postgresql/17"
export LD_LIBRARY_PATH="$HOME/tools/pg16/usr/lib/x86_64-linux-gnu"
case "${1:-}" in
init)
  test ! -e "$scale_root/pg17/PG_VERSION"
  mkdir -p "$scale_root"
  if test ! -f "$scale_root/pw"; then
    python3 -c 'import secrets,sys; open(sys.argv[1],"x").write(secrets.token_hex(32)+"\n")' "$scale_root/pw"
  fi
  chmod 600 "$scale_root/pw"
  "$pgbin/initdb" -D "$scale_root/pg17" -L "$pgshare" -U sb4scale --pwfile="$scale_root/pw" --auth-local=scram-sha-256 --auth-host=scram-sha-256 --encoding=UTF8 --no-locale >/dev/null
  cat "$(dirname "$0")/../postgresql.conf.delta" >> "$scale_root/pg17/postgresql.conf"
  cp "$(dirname "$0")/cluster.sh" "$scale_root/cluster.sh"
  ;;
start)
  test "$(cat "$scale_root/pg17/PG_VERSION")" = 17
  "$pgbin/pg_ctl" -D "$scale_root/pg17" -l "$scale_root/postgres.log" -w start
  head -1 "$scale_root/pg17/postmaster.pid" > "$scale_root/postmaster.pid.recorded"
  ;;
stop)
  test "$(head -1 "$scale_root/pg17/postmaster.pid")" = "$(cat "$scale_root/postmaster.pid.recorded")"
  "$pgbin/pg_ctl" -D "$scale_root/pg17" -m fast -w stop
  ;;
status)
  "$pgbin/pg_ctl" -D "$scale_root/pg17" status
  ;;
*) echo 'usage: cluster.sh init|start|stop|status' >&2; exit 2 ;;
esac
