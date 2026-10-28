# Snapback 4: clean package build requires an uncreated guide-api output directory

Status: Open
Observed baseline: 1c4c51b551

Building the client in an isolated git archive after producing wasm fails in
packages/snapback4/scripts/guide-api.mjs: digest writes dist/guide-api/app-full.md
before dist/guide-api exists. A reused worktree hides this precondition.
Creating that ignored directory allowed the exact baseline build/pack to finish.

Make the generator create its output directory before the first full-card write,
then verify a clean archive's documented package build. This is outside VER1's
starter-script/idle/installer ownership; no generator change was made there.

Evidence: VER1's retained baseline-build.log and baseline-pack.log under its
private local evidence directory; [measurement method](../snapback4/reports/20261028-ver1/METHOD.md).
