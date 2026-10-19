# Final Integration 17 Exact, survey and upgrade bindings

All closeout consumers passed against source `fc7a63ea0fbbb23005df12f83ae4c4b25955ca02`, debug CLI SHA256 `73e0a3f56daed048998beefd4299c2e8efb0c8ce255060097df224a8f73caa7b`, client pack SHA256 `fef9ff1ce28975a3c85873ebc881d08e68795a0db130c21df3c7edb773a82683`. The driver waited for the third full Rust run to finish compilation before invoking the final CLI. No root source, dist, binary, original app schemas or original upgrade store were modified by this lane.

## Survey

`timeout 600s python3 /tmp/integ17/integ17-survey-closeout.py`; raw per-schema results, original hashes, binding and code counts are in `survey-closeout/`. All100 wave15 and50 wave16 schemas pass. Notes are488 and147, versus458 and131 on Integration16; the only ordinary-note changes are30 and16 new `N_SWEEP_DEADLINE` occurrences. Security notes are968 and582, with exactly one `N_SECURITY_INTENT` per existing app and no declared invariants. Security codes appear separately from ordinary notes. Final summary equals the previous deduplicated d9 survey exactly; every original module was hashed before and after. The baseline is Integration16's merged survey, which already reconciles LANG4, RULES5 and LIVE.

## Exact

`timeout 4800s node /tmp/integ17/exact-closeout-rerun.mjs` invokes the following commands, each independently under `timeout 2400s`:

- `npm install --ignore-scripts --omit=optional --no-audit --no-fund /tmp/integ17/prepared-qualified/snapback4-0.4.33.tgz` in each existing fresh synced/online project under `~/sb4-loop/prewave17/`.
- `bun exact.mjs snapback --rebuild --port 46709` (synced), `bun exact.mjs snapback --rebuild --port 44223` (online).
- Final merged binary `dev --port <same> --no-watch` on each project, followed by `bun exact.mjs test web --backend http://127.0.0.1:<same>` from each app directory. Each browser suite passes2/2.

The exact command argv/cwd, each command's complete output and temporary backend logs are in `exact-closeout-*`. Exact2 source is origin/main `b28c0c1a64226420e43f0786f072e1a852287a3b` (contains EX10 migration); its only scratch edits remain Cargo.toml/Cargo.lock path overrides to the merged Snapback engine. The synced rebuilt device bytes stayed unchanged. All304 installed dist files in both projects match the immutable prepared client pack byte for byte; see `closeout-exact-pack-equivalence.json`. Initial creation and `contract migrate` evidence remains in the already committed Exact evidence; this is its final-source replay.

## Upgrade

Created another private SQLite backup using `sqlite3.connect(file:.../store.sqlite?mode=ro).backup(...)`, copied source modules verbatim, installed the prepared-qualified client with `timeout 300s npm install --ignore-scripts --omit=optional --no-audit --no-fund /tmp/integ17/prepared-qualified/snapback4-0.4.33.tgz`, then ran `timeout 600s /home/ccheever/.bun-1.4.2/bin/bun /tmp/integ17/upgrade-closeout-smoke.mjs`. The original 0.4.32 store source and store/WAL hashes were checked unchanged.

The final CLI preserves the old row and unchanged source, emits exactly one aggregate missing-intent note, closes password-only dev doors by default, refuses a forged persona, supports real password signup plus authenticated mutation/query with the final packed client, and restores the old persona workflow with explicit `--unsafe-dev-doors`. This minimal final-runtime replay supplements the committed actual0.4.32 package installation and full0.4.33 upgrade of the store and Expo app, including Expo adaptation, typecheck and web export. It does not claim a second full package upgrade was performed here.

All evidence remains under `/tmp/integ17/` until the root's qualification source freeze ends. Command scripts and logs are verbatim; no publication was performed.
