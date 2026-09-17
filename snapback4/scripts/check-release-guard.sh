#!/usr/bin/env bash
# `web-device-check` gives debug test witnesses the web device's policy on a
# native build. The published artifacts build under `production` and `wasm`,
# which leave debug assertions off, and the core crate refuses the feature
# there. This builds the web artifact's exact configuration with the feature
# added and requires that refusal, so deleting the guard turns the suite red.
# A hand-made profile that turns debug assertions on is outside this promise.
set -u
cd "$(dirname "$0")/.."
out=$(cargo check -p snapback4-device --no-default-features --features web,web-device-check --profile wasm --target wasm32-unknown-unknown --quiet 2>&1)
status=$?
if [ "$status" = 0 ]; then
  echo "release guard: web-device-check compiled under the wasm profile; the refusal in snapback4-core/src/lib.rs is gone"
  exit 1
fi
if ! printf '%s\n' "$out" | grep -q 'web-device-check is only for debug test witnesses'; then
  printf '%s\n' "$out"
  echo "release guard: the build failed for another reason (exit $status), so the refusal was not observed"
  exit 1
fi
echo "release guard: ok (web-device-check refuses the wasm profile)"
