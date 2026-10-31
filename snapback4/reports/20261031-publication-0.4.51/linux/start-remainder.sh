#!/bin/bash
set -eu
R=$HOME/sb4-pub-0451-records; K=$HOME/sb4-pub-0451-kit
until [ -s "$R/fixture-push.exit" ]; do sleep 1; done
[ "$(cat "$R/fixture-push.exit")" = 0 ]
[ "$(git -C "$HOME/sb4-pub-0441" rev-parse HEAD)" = "$(cat "$K/fixture-main-pushed.sha")" ]
ulimit -n 65536
node "$K/client-remainder.mjs"
