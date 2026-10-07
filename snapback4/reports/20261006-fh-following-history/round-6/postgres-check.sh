#!/usr/bin/env bash
set -euo pipefail
pgroot="$PWD/target/fh-round6-postgres"
export PATH="$pgroot/root/usr/lib/postgresql/16/bin:$PATH"
export LD_LIBRARY_PATH="$pgroot/root/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
mkdir -p "$pgroot/socket"
initdb -D "$pgroot/data" -U sb4_eval --auth-local=trust --auth-host=reject --encoding=UTF8 --no-locale > "$pgroot/initdb.log"
trap 'pg_ctl -D "$pgroot/data" -m fast -w stop' EXIT
pg_ctl -D "$pgroot/data" -l "$pgroot/server.log" -o "-k $pgroot/socket -c listen_addresses= -p 55439" -w start
export SNAPBACK4_EVAL_POSTGRES="host=$pgroot/socket port=55439 user=sb4_eval dbname=postgres"
cargo test --locked -p snapback4-core --features postgres --lib engine::postgres::tests::refusals -- --include-ignored --nocapture
