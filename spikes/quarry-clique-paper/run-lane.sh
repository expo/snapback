#!/bin/bash
# usage: run-lane.sh <codex|grok>
# Runs one cold lane through M1 -> M2 -> M3 sequentially, feeding each
# milestone the lane's own prior answers. cwd = empty sandbox (no repo
# access). Skips milestones whose output already exists; re-run to retry.
set -u
MODEL=$1
BASE="$(cd "$(dirname "$0")" && pwd)"
P="$BASE/packet"
OUT="$BASE/lanes/$MODEL"
SANDBOX="${TMPDIR:-/tmp}/quarry-clique-sandbox-$MODEL"
mkdir -p "$OUT" "$SANDBOX"
cd "$SANDBOX"

invoke() { # invoke <promptfile> <outfile>
  case "$MODEL" in
    codex)
      timeout 1800 codex exec --skip-git-repo-check -m gpt-5.6-sol \
        -c model_reasoning_effort=xhigh -s read-only \
        "$(cat "$1")" </dev/null >"$2.tmp" 2>"$2.err"
      ;;
    grok)
      timeout 1800 grok -p "$(cat "$1")" -m grok-4.6 --reasoning-effort xhigh \
        --output-format plain --disable-web-search --permission-mode auto \
        --max-turns 200 </dev/null >"$2.tmp" 2>"$2.err"
      ;;
    *) echo "unknown model $MODEL" >&2; exit 2 ;;
  esac
  rc=$?
  if [ $rc -eq 0 ] && [ -s "$2.tmp" ]; then mv "$2.tmp" "$2"; return 0; fi
  mv "$2.tmp" "$2.failed.$rc" 2>/dev/null
  echo "FAIL $MODEL $(basename "$2") rc=$rc"
  return 1
}

build_prompt() { # build_prompt <milestone> -> stdout
  local m=$1
  cat "$BASE/spec/quarry-spec-v0.2.md"
  echo; echo "---"; echo
  cat "$P/preamble.md"
  echo; echo "# The app"; echo
  cat "$P/app-context.md"
  if [ "$m" != "M1" ]; then
    echo; echo "# Your design so far (yours, carried forward — evolve it, do not restart)"
    echo; echo "## Your M1 output"; echo
    cat "$OUT/M1.md"
    if [ "$m" = "M3" ]; then
      echo; echo "## Your M2 output"; echo
      cat "$OUT/M2.md"
    fi
  fi
  echo; echo "# This milestone"; echo
  cat "$P/$m.md"
}

for m in M1 M2 M3; do
  if [ -s "$OUT/$m.md" ]; then echo "skip $MODEL $m (exists)"; continue; fi
  build_prompt "$m" > "$OUT/$m.prompt.md"
  echo "run $MODEL $m ($(wc -c < "$OUT/$m.prompt.md") bytes)"
  invoke "$OUT/$m.prompt.md" "$OUT/$m.md" || exit 1
done
echo "DONE lane $MODEL"
