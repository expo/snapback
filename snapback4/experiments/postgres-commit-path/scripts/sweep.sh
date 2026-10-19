#!/usr/bin/env bash
# Run one block of cells and append one JSON line per cell invocation to a NEW
# file in the results directory (an existing file is never overwritten).
#   scripts/sweep.sh <results-dir> <block>
# Blocks: ping engine calibration-w1 model-R model-0 model-0-coalesced model-A model-A-implicit
#         raw sqlite sqlite-old
# Requires the env file from scripts/cluster.sh start to be sourced (Postgres
# blocks), and SQLITE_DIR for the sqlite blocks. Before each invocation it
# waits (up to LOAD_WAIT_S, default 900 s) for the 1-minute load average to
# fall below LOAD_MAX (default 4); every invocation records the load it ran at
# and the block records vmstat 1 5 before and after. A cell that fails is
# recorded (its JSON line is kept) and the block continues.
set -uo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
out_dir="$1"; block="$2"
bin="$here/target/release/snapback4-postgres-commit-path"
mkdir -p "$out_dir"
out="$out_dir/$block.jsonl"
if [[ -e "$out" ]]; then echo "refusing to overwrite $out" >&2; exit 2; fi
: > "$out"
LOAD_MAX="${LOAD_MAX:-4}"; LOAD_WAIT_S="${LOAD_WAIT_S:-900}"
NETS="${NETS:-unix rtt0 rtt200 rtt500 rtt1000}"
BATCHES="${BATCHES:-1 2 4 8 16 32 64}"

gate() {
  local waited=0
  while awk -v max="$LOAD_MAX" '{exit !($1 >= max)}' /proc/loadavg && (( waited < LOAD_WAIT_S )); do
    sleep 10; waited=$((waited + 10))
  done
  echo "$waited"
}

run() {
  local waited; waited="$(gate)"
  local line
  line="$("$bin" "$@" 2>"$out_dir/.stderr")"; local status=$?
  if [[ -z "$line" ]]; then
    line="$(python3 -c 'import json,sys; print(json.dumps({"cell": "crashed", "argv": sys.argv[2:], "exit": int(sys.argv[1]), "stderr": open(sys.argv[-1]).read()[-4000:]}))' "$status" "$@" "$out_dir/.stderr")"
  fi
  python3 -c 'import json,sys; d=json.loads(sys.argv[1]); d["load_gate_waited_s"]=int(sys.argv[2]); d["exit_status"]=int(sys.argv[3]); print(json.dumps(d))' "$line" "$waited" "$status" >> "$out"
  echo "[$(date -u +%H:%M:%S)] $block $* -> exit $status (gate waited ${waited}s, load $(cut -d' ' -f1 /proc/loadavg))" >&2
}

{ echo "== $block before $(date -u +%FT%TZ)"; uptime; vmstat 1 5; } >> "$out_dir/vmstat.log"
case "$block" in
  ping)
    for net in unix tcp $NETS; do run ping --net "$net" --n 5000; done ;;
  engine)
    for net in $NETS; do for c in disjoint same; do run engine --net "$net" --counters "$c" --writers 4; done; done ;;
  calibration-w1)
    # One writer, no lock contention: the engine's serial time minus the
    # model's is the engine's client work the model omits.
    for net in ${CAL_NETS:-unix rtt0}; do
      run engine --net "$net" --counters disjoint --writers 1
      run model --protocol R --net "$net" --counters disjoint --writers 1
    done ;;
  model-R)
    for net in $NETS; do for c in disjoint same; do run model --protocol R --net "$net" --counters "$c" --writers 4; done; done ;;
  model-0)
    for net in $NETS; do for n in $BATCHES; do for c in disjoint same; do run model --protocol 0 --batch "$n" --net "$net" --counters "$c"; done; done; done ;;
  model-0-coalesced)
    for net in ${COALESCED_NETS:-rtt500}; do for n in $BATCHES; do for c in disjoint same; do run model --protocol 0 --tail coalesced --batch "$n" --net "$net" --counters "$c"; done; done; done ;;
  model-A)
    for net in $NETS; do for n in $BATCHES; do run model --protocol A --batch "$n" --net "$net" --counters disjoint; done; done ;;
  model-A-implicit)
    for net in ${IMPLICIT_NETS:-rtt500}; do for n in $BATCHES; do run model --protocol A --txn implicit --batch "$n" --net "$net" --counters disjoint; done; done ;;
  raw)
    for net in $NETS; do for w in 4 16 64; do for c in disjoint same; do run raw --net "$net" --writers "$w" --counters "$c"; done; done; done ;;
  sqlite)
    for w in 4 16 64; do for c in disjoint same; do run sqlite-serve --writers "$w" --counters "$c" --dir "$SQLITE_DIR"; done; done
    for c in disjoint same; do run sqlite-four-connections --counters "$c" --dir "$SQLITE_DIR"; done
    run sqlite-exec-flush --dir "$SQLITE_DIR" ;;
  sqlite-old)
    # The old concurrent_sqlite cell verbatim (count-based, 100 per writer).
    for c in same disjoint; do run sqlite-old-cell --counters "$c" --per-writer 100 --dir "$SQLITE_DIR"; done ;;
  *) echo "unknown block $block" >&2; exit 2 ;;
esac
{ echo "== $block after $(date -u +%FT%TZ)"; uptime; vmstat 1 5; } >> "$out_dir/vmstat.log"
rm -f "$out_dir/.stderr"
