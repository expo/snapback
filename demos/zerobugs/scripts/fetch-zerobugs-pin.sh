#!/usr/bin/env bash

set -euo pipefail

readonly PIN="25c2c7308d3eb674d2d895022c9da11ef0c742fb"
readonly REMOTE="https://github.com/rocicorp/mono.git"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly SCRIPT_DIR

if (( $# > 1 )); then
  echo "usage: $0 [target-directory]" >&2
  exit 64
fi

target_dir="${1:-${SCRIPT_DIR}/../.pin}"

if [[ -e "$target_dir" ]]; then
  echo "error: target already exists: $target_dir" >&2
  exit 1
fi

source_repo="$REMOTE"

if [[ -n "${ZBUGS_PIN_SOURCE:-}" ]]; then
  if [[ ! -d "$ZBUGS_PIN_SOURCE/.git" ]]; then
    echo "error: ZBUGS_PIN_SOURCE is not a standalone Git checkout: $ZBUGS_PIN_SOURCE" >&2
    exit 1
  fi
  source_repo="$(cd -- "$ZBUGS_PIN_SOURCE" && pwd -P)"

  source_head="$(git -C "$source_repo" rev-parse HEAD 2>/dev/null || true)"
  if [[ "$source_head" != "$PIN" ]]; then
    echo "error: ZBUGS_PIN_SOURCE HEAD is $source_head; expected $PIN" >&2
    exit 1
  fi

  if ! git -C "$source_repo" diff --quiet ||
    ! git -C "$source_repo" diff --cached --quiet; then
    echo "error: ZBUGS_PIN_SOURCE has tracked changes; expected a clean pin" >&2
    exit 1
  fi

  mkdir -p "$(dirname -- "$target_dir")"
  cp -R "$source_repo" "$target_dir"
  git -C "$target_dir" sparse-checkout set apps/zbugs packages/zero
else
  git init --quiet "$target_dir"
  git -C "$target_dir" remote add origin "$source_repo"
  git -C "$target_dir" sparse-checkout init --cone
  git -C "$target_dir" sparse-checkout set apps/zbugs packages/zero
  git -C "$target_dir" fetch --quiet --depth=1 --filter=blob:none origin "$PIN"
  git -C "$target_dir" checkout --quiet --detach FETCH_HEAD
fi

actual_pin="$(git -C "$target_dir" rev-parse HEAD)"
if [[ "$actual_pin" != "$PIN" ]]; then
  echo "error: fetched HEAD is $actual_pin; expected $PIN" >&2
  exit 1
fi

contract_files=(
  shared/schema.ts
  shared/queries.ts
  shared/mutators.ts
  server/server-mutators.ts
  api/index.ts
  server/machine-routes.ts
  src/server/upload.ts
  SYNTHETIC_DATA.md
  package.json
  ../../packages/zero/package.json
)

for file in "${contract_files[@]}"; do
  if [[ ! -f "$target_dir/apps/zbugs/$file" ]]; then
    echo "error: pinned contract file is missing: apps/zbugs/$file" >&2
    exit 1
  fi
done

echo "verified rocicorp/mono at $actual_pin"
(
  cd "$target_dir/apps/zbugs"
  shasum -a 256 "${contract_files[@]}"
)
