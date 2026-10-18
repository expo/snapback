# Integration 17 upgrade validation

PASS: actual local-registry 0.4.32 store and Expo starter upgraded to merged 0.4.33. No product changes were needed. Scratch: `/tmp/integ17-upgrade`; the Exact lane uses separate paths.

## Old control

Created old-tools/package.json, then ran `timeout 300s npm install --save-exact snapback4@0.4.32 snapback4-expo@0.4.32 --registry http://127.0.0.1:4873/ --no-audit --no-fund --prefix /tmp/integ17-upgrade/old-tools`. Used its real platform binary to emit an Expo app, installed both exact packages again in that app through the same registry, and passed old `check` and `npm run typecheck`. The emitted app contained the old recipe copies.

A separate password-only store was authored under 0.4.32 with `use personas alice, bob`, no invariants, an owner-read/write notes table and add/one operations. Its old dev host admitted the persona door, wrote an actual dev:alice row, read it as alice and hid it from bob. The old source and data snapshot are hashed in old-ready.json.

## Merged behavior

The merged 0.4.33 `check --json` succeeds on the unchanged old source, emits exactly one N_SECURITY_INTENT aggregate advice note, and preserves the stored row exactly. The new ordinary dev host advertises devDoors=false; /dev/status, /seed, /dev/reset and /dev/clock/advance refuse; a forged alice persona query returns401. Real password signup, authenticated add and one query succeed. Reopening with explicit --unsafe-dev-doors restores /dev/status and the original alice persona read of the preserved 0.4.32 row.

## Actual package upgrade

Built a temporary Linux package from the merged binary, used the provided provisional prepared client tarball and packed the local Expo adapter with `timeout 120s npm pack --ignore-scripts --pack-destination /tmp/integ17-upgrade --json`. An ephemeral registry overlay serves these three 0.4.33 packages and proxies other requests to127.0.0.1:4873, matching Integration16 methodology. This does not publish anything.

For both store and Expo app ran the merged binary `upgrade --to 0.4.33` with `npm_config_registry=<ephemeral overlay URL>` and `SNAPBACK4_UPGRADE_HELPER=/home/ccheever/projects/snapback-sb4loop/snapback4/packages/snapback4/bin/upgrade.js`. Both succeed; core and Expo adapter are pinned exactly0.4.33. Then Expo `init --adapt`, `check`, `npm run typecheck` and `expo export -p web --max-workers 2` all pass. Final store source hash remains byte-identical to0.4.32; the old row is still present after package upgrade.

Every child command runs under GNU timeout, with driver deadlines as a second bound. Credential values never enter logs. All recorded command logs and host logs are in this directory; commands.json records argv/cwd. `upgrade.mjs` contains all HTTP assertions and exact execution logic; it is the adapted Integration16 driver. The final packed qualification lane owns the fresh final publication-preparation pack; this validation records the tested provisional package integrity values explicitly in result.json.
