#!/usr/bin/env bash
# Private, durable PostgreSQL 16 cluster for the commit-path cells.
#   cluster.sh start <data-parent-dir> <tcp-port>   -> prints an env file path
#   cluster.sh stop  <env-file>
# The Unix socket lives in a short mktemp dir (socket paths are length-limited).
# TCP listens on 127.0.0.1 only, for the delay proxy. Durability: fsync,
# synchronous_commit and full_page_writes on (the defaults, set explicitly).
# It never discovers or stops a cluster it did not start.
set -euo pipefail
PGBIN="${PGBIN:-$HOME/tools/pg16/usr/lib/postgresql/16/bin}"
export LD_LIBRARY_PATH="${PGLIB:-$HOME/tools/pg16/usr/lib/x86_64-linux-gnu}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
case "${1:-}" in
start)
  parent="$2"; port="$3"
  mkdir -p "$parent"
  data="$(mktemp -d "$parent/pgdata.XXXXXX")"
  sock="$(mktemp -d /tmp/sbpgXXXX)"
  "$PGBIN/initdb" -D "$data/data" -U sb4_eval --auth-local=trust --auth-host=reject --encoding=UTF8 --no-locale >/dev/null
  # Only 127.0.0.1 may connect over TCP, as the same trusted evaluation role.
  # pg_hba is first-match, so this goes above initdb's host reject lines.
  sed -i '1i host all sb4_eval 127.0.0.1/32 trust' "$data/data/pg_hba.conf"
  cat >> "$data/data/postgresql.conf" <<EOF
listen_addresses = '127.0.0.1'
port = $port
unix_socket_directories = '$sock'
fsync = on
synchronous_commit = on
full_page_writes = on
max_connections = 200
shared_preload_libraries = 'pg_stat_statements'
pg_stat_statements.track = all
track_wal_io_timing = on
track_io_timing = on
EOF
  "$PGBIN/pg_ctl" -D "$data/data" -l "$data/server.log" -w start >/dev/null
  env="$data/env.sh"
  cat > "$env" <<EOF
export PGDATA_DIR='$data/data'
export PGSOCK_DIR='$sock'
export PGPORT_TCP='$port'
export PG_UNIX_URL='host=$sock port=$port user=sb4_eval dbname=postgres'
export PG_TCP_HOSTPORT='127.0.0.1:$port'
EOF
  "$PGBIN/psql" -h "$sock" -p "$port" -U sb4_eval -d postgres -qc "CREATE EXTENSION IF NOT EXISTS pg_stat_statements" >/dev/null
  echo "$env"
  ;;
stop)
  # shellcheck disable=SC1090
  source "$2"
  "$PGBIN/pg_ctl" -D "$PGDATA_DIR" -m fast -w stop >/dev/null
  rm -rf "$PGSOCK_DIR"
  echo "stopped $PGDATA_DIR; removed $PGSOCK_DIR" >&2
  ;;
*) echo "usage: cluster.sh start <parent> <port> | stop <env-file>" >&2; exit 2 ;;
esac
