#!/usr/bin/env bash
# Private PostgreSQL cluster for the fencing witnesses.
#
#   scripts/cluster.sh up      initdb (first time) + start; prints the env file path
#   scripts/cluster.sh down    stop the cluster this script started; remove its socket dir
#   scripts/cluster.sh env     print the env file path (cluster must be up)
#   scripts/cluster.sh destroy down + remove the data directory
#
# PG_BIN      PostgreSQL 16 bin dir   (default ~/tools/pg16/usr/lib/postgresql/16/bin)
# PG_LIB      LD_LIBRARY_PATH for it  (default ~/tools/pg16/usr/lib/x86_64-linux-gnu)
# PGFENCE_DIR state + data directory  (default ${TMPDIR:-/tmp}/pgfence-$USER)
# PGFENCE_PORT TCP port on 127.0.0.1  (default: first free port from 55432)
#
# The socket lives in a short mktemp dir (/tmp/sbpgXXXX) because Unix socket
# paths are limited to ~107 bytes. Authentication is `trust` on the socket and
# on 127.0.0.1 only: this is a throwaway local cluster.
set -euo pipefail

PG_BIN=${PG_BIN:-$HOME/tools/pg16/usr/lib/postgresql/16/bin}
PG_LIB=${PG_LIB:-$HOME/tools/pg16/usr/lib/x86_64-linux-gnu}
PGFENCE_DIR=${PGFENCE_DIR:-${TMPDIR:-/tmp}/pgfence-$USER}
DATA=$PGFENCE_DIR/data
ENVFILE=$PGFENCE_DIR/env
export LD_LIBRARY_PATH=$PG_LIB${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}

running() { [ -f "$ENVFILE" ] && . "$ENVFILE" && "$PG_BIN/pg_ctl" -D "$DATA" status >/dev/null 2>&1; }

free_port() {
  local p=${PGFENCE_PORT:-55432}
  while ss -ltn 2>/dev/null | awk '{print $4}' | grep -q "[:.]$p\$"; do p=$((p + 1)); done
  echo "$p"
}

up() {
  if running; then echo "$ENVFILE"; return; fi
  mkdir -p "$PGFENCE_DIR"
  if [ ! -f "$DATA/PG_VERSION" ]; then
    "$PG_BIN/initdb" -D "$DATA" -U sb_super -A trust -E UTF8 --no-locale >"$PGFENCE_DIR/initdb.log"
    cat >>"$DATA/postgresql.conf" <<'CONF'
# --- pgfence ---
track_commit_timestamp = on     # lets witnesses order old-owner commits against the takeover commit
log_line_prefix = '%m [%p] %u %a '
log_connections = off
log_lock_waits = on
deadlock_timeout = 1s
max_connections = 200
CONF
  fi
  local sock port
  sock=$(mktemp -d /tmp/sbpgXXXX)
  port=$(free_port)
  "$PG_BIN/pg_ctl" -D "$DATA" -l "$PGFENCE_DIR/server.log" -w start \
    -o "-k $sock -p $port -c listen_addresses=127.0.0.1" >/dev/null
  cat >"$ENVFILE" <<ENV
export PGFENCE_HOST=$sock
export PGFENCE_PORT=$port
export PGFENCE_DB=fence
export PG_BIN=$PG_BIN
export LD_LIBRARY_PATH=$LD_LIBRARY_PATH
ENV
  # Roles and database are idempotent so `up` after `down` reuses the data dir.
  "$PG_BIN/psql" -q -h "$sock" -p "$port" -U sb_super -d postgres -v ON_ERROR_STOP=1 <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'sb_ddl') THEN
    CREATE ROLE sb_ddl NOLOGIN;                 -- table owner (the RFC's "owner" role: DDL)
    CREATE ROLE sb_core LOGIN;                  -- every serving process (owner and standby)
    CREATE ROLE sb_other LOGIN;                 -- an unrelated application role
    CREATE ROLE sb_inspect LOGIN;               -- SELECT only (the RFC's "inspect" role)
    CREATE ROLE sb_signal LOGIN;                -- member of pg_signal_backend, for comparison
    GRANT pg_signal_backend TO sb_signal;
    CREATE ROLE sb_core_member LOGIN IN ROLE sb_core;  -- a role that is a member of sb_core
  END IF;
END $$;
SELECT 'CREATE DATABASE fence OWNER sb_ddl' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'fence')\gexec
SQL
  "$PG_BIN/psql" -q -h "$sock" -p "$port" -U sb_super -d fence -v ON_ERROR_STOP=1 <<'SQL'
CREATE SCHEMA IF NOT EXISTS fence AUTHORIZATION sb_ddl;
GRANT USAGE ON SCHEMA fence TO sb_core, sb_other, sb_inspect, sb_signal;
ALTER DATABASE fence SET search_path = fence;
SQL
  echo "$ENVFILE"
}

down() {
  if [ ! -f "$ENVFILE" ]; then echo "no env file; nothing started by this script" >&2; return; fi
  . "$ENVFILE"
  "$PG_BIN/pg_ctl" -D "$DATA" -m fast -w stop >/dev/null 2>&1 || true
  case "$PGFENCE_HOST" in /tmp/sbpg*) rm -rf "$PGFENCE_HOST" ;; esac
  rm -f "$ENVFILE"
  echo "stopped"
}

case "${1:-}" in
  up) up ;;
  down) down ;;
  env) running && echo "$ENVFILE" || { echo "cluster not up" >&2; exit 1; } ;;
  destroy) down; rm -rf "$PGFENCE_DIR" ;;
  *) echo "usage: $0 up|down|env|destroy" >&2; exit 2 ;;
esac
