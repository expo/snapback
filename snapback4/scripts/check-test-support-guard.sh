#!/usr/bin/env bash
# The host must refuse explicit raw-fixture feature activation in release builds.
# Match the guard diagnostic so dependency/toolchain failures cannot pass this check.
set -u
cd "$(dirname "$0")/.."
out=$(cargo check -j "${CARGO_BUILD_JOBS:-4}" --release -p snapback4 --features snapback4-core/test-support --quiet 2>&1)
status=$?
if [ "$status" = 0 ]; then
  echo "test-support guard: release build accepted raw fixture access"
  exit 1
fi
if ! printf '%s\n' "$out" | grep -q 'test-support is only for debug test fixtures'; then
  printf '%s\n' "$out"
  echo "test-support guard: build failed for another reason (exit $status); refusal was not observed"
  exit 1
fi
echo "test-support guard: ok (release host refuses raw fixture access)"
