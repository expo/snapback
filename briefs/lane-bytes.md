# Lane E — one range store, a frozen ceiling

Worktree: `~/projects/snapback-s2y`, branch `s2/el-bytes`, base `3062777ab`.
Rulings: plan.md § E (E1–E3). LLP to revise: `llp/1012-local-first-v1.spec.md` (the allocation
section: one line saying the ceiling is frozen 2026-09-08). Also `rules/NOT-DOING.md` § Moves and
the WASM/twin bullet (E3).

You own `snapback2/packages/snapback2/build.mjs`, `snapback2/scripts/measure.mjs`,
`snapback2/metrics/twin.jsonl` (append only), the two rule/LLP paragraphs, and the template build
configs only as far as E1 needs them to keep building.

Order of work:

1. Measure the base: gzip -9 of every `dist/*.mjs` after `node build.mjs`; `node build.mjs
   --measure-twin` (the five-root complete-runtime number; expect 83,999). Record in the report.
2. E1 — make `react.mjs`, `expo.mjs`, `react-native.mjs`, `react-core.mjs`, `test.mjs` import
   `snapback2/client` (and any internal it reaches) as externals so `client.mjs` is the only copy
   of the range store, twin, and offline runtime. Confirm by grepping the built entries for
   `applySwap` / `PersistentRangeStore` / `Twin` symbols: present once, in `client.mjs`. Check the
   `exports` map in `package.json` still resolves every entry under `browser`, `react-native`, and
   `node` conditions; a consumer of `snapback2/react` must not get two client instances (module
   identity: one `snapback2/client` module graph). Rebuild the templates: `vite build` in a
   scaffolded React chat project, `tsc --noEmit` in a scaffolded Expo one; run the package tests
   and `scripts/witness-web.mjs` if test.sh runs it.
3. E2 — `measure.mjs` records `client_gzip_bytes`, `react_gzip_bytes`, `expo_gzip_bytes`,
   `runtime_gzip_bytes` in every loop record (gzip level 9, Node 24.18.0, esbuild as pinned);
   `--check` fails when any grows more than 1% over the last record that has the field (the
   pattern the file already uses for its other regressions); `--measure-twin` appends the runtime
   number to `metrics/twin.jsonl` with the sha and date.
4. E3 — rewrite the ceiling paragraphs in `rules/NOT-DOING.md` (the WASM bullet and the six dated
   ceiling moves) into one paragraph + one history line as the plan words it; add the freeze line to
   LLP 1012. Keep NOT-DOING's other content byte-for-byte. `node scripts/caps.mjs` at the repo root
   must stay green (RULES has a 700-word budget; NOT-DOING has none, but keep it shorter than before).
5. `scripts/test.sh` green; `node scripts/measure.mjs --check` green (append its record).
6. `REPORT-bytes.md`: the per-entry table before/after, the runtime number before/after, the
   exact externals list, and what `witness-web` and the template builds reported.

Out of scope: any client source change beyond `build.mjs`/exports (lane A1 owns `src/`); do not
try to shrink the runtime by editing modules.
