#!/bin/bash
# usage: run-model.sh <codex|grok|haiku> [parallel]
# Runs every prompt in packet/prompts/ through one model, one fresh
# invocation per prompt, cwd = an empty sandbox so authors cannot read the
# repo (references live there). Skips outputs that already exist; re-run to
# retry failures.
set -u
MODEL=$1
PAR=${2:-5}
BASE="$(cd "$(dirname "$0")" && pwd)"
PROMPTS="$BASE/packet/prompts"
RUNS="$BASE/runs/$MODEL"
SANDBOX="${TMPDIR:-/tmp}/quarry-authoring-sandbox-$MODEL"
mkdir -p "$RUNS" "$SANDBOX"
cd "$SANDBOX"

run_one() {
  local p="$1" name out err rc
  name=$(basename "$p" .md)
  out="$RUNS/$name.md"
  err="$RUNS/$name.err"
  [ -s "$out" ] && return 0
  case "$MODEL" in
    codex)
      timeout 900 codex exec --skip-git-repo-check -m gpt-5.6-sol \
        -c model_reasoning_effort=xhigh -s read-only \
        "$(cat "$p")" </dev/null >"$out.tmp" 2>"$err"
      ;;
    grok)
      timeout 900 grok -p "$(cat "$p")" -m grok-4.6 --reasoning-effort xhigh \
        --output-format plain --disable-web-search --permission-mode auto \
        --max-turns 200 </dev/null >"$out.tmp" 2>"$err"
      ;;
    haiku)
      timeout 420 claude --model haiku -p "$(cat "$p")" --disallowedTools "*" \
        </dev/null >"$out.tmp" 2>"$err"
      ;;
    *) echo "unknown model $MODEL" >&2; exit 2 ;;
  esac
  rc=$?
  if [ $rc -eq 0 ] && [ -s "$out.tmp" ]; then
    mv "$out.tmp" "$out"
  else
    mv "$out.tmp" "$out.failed.$rc" 2>/dev/null
    echo "FAIL $name rc=$rc"
  fi
}

i=0
for p in "$PROMPTS"/*.md; do
  run_one "$p" &
  i=$((i + 1))
  if [ $((i % PAR)) -eq 0 ]; then wait; fi
done
wait
echo "DONE $MODEL: $(ls "$RUNS" | /usr/bin/grep -c '\.md$') outputs"
