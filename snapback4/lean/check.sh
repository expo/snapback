#!/usr/bin/env bash
# Builds the Lean model, refuses any sorry/admit/native_decide or added axiom,
# audits the headline theorems' axioms, and runs the hand-written examples.
# @ref LLP 3000.035#52-stage-2-a-small-lean-core — the Stage 2 model this checks; written from the cards, not the interpreter
set -euo pipefail
cd "$(dirname "$0")"
if /usr/bin/grep -rnE '\bsorry\b|\badmit\b|native_decide|^\s*axiom\b' --include='*.lean' Quarry Main.lean Quarry.lean; then
  echo "check.sh: the model must contain no sorry, admit, native_decide or axiom" >&2
  exit 1
fi
lake build
audit=$(lake env lean Audit.lean 2>&1)
if printf '%s\n' "$audit" | /usr/bin/grep -q 'sorryAx'; then
  printf '%s\n' "$audit" >&2
  echo "check.sh: a theorem depends on sorryAx" >&2
  exit 1
fi
if printf '%s\n' "$audit" | /usr/bin/grep -vE "^'[^']+' (depends on axioms: \[(propext|Classical.choice|Quot.sound)(, (propext|Classical.choice|Quot.sound))*\]|does not depend on any axioms)$" | /usr/bin/grep -q .; then
  printf '%s\n' "$audit" >&2
  echo "check.sh: unexpected axiom or audit output" >&2
  exit 1
fi
echo "axioms: $(printf '%s\n' "$audit" | wc -l | tr -d ' ') theorems audited, standard axioms only"
lake exe quarry-model
