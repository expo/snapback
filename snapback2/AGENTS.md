# Snapback 2 — agent command sheet

Read this, then `rules/RULES.md` and `rules/NOT-DOING.md` at the repo root, then
`llp/1000-snapback2.explainer.md`; the specs are LLP 1001 (engine), 1002 (loop), 1003 (effects), 1012 (local-first v1; Review, binds after the loop bar).

```
cargo build                          # data plane + binary; no JS engine, no bootstrap
NEXTEST_TEST_THREADS=8 cargo nextest run \
  --config-file ../.config/nextest.toml --profile local-proof \
  --workspace --no-fail-fast          # Rust executable tests (~27 s warm)
cargo test --workspace --doc --no-fail-fast  # workspace doctests omitted by nextest
scripts/test.sh                      # everything blocking: Rust + doctests + evaluator + compiler (~35 s warm)
node scripts/measure.mjs --check     # loop numbers → metrics/loop.jsonl; fails on regression
node scripts/publish.mjs --dry-run   # production build WITH the engine + npm pack; drop --dry-run to ship
scripts/hermes test -p snapback2-effects   # the engine proof (Ibex 2 + vanilla Hermes); never blocking
(cd packages/snapback2 && node build.mjs)  # bundle the compiler worker, client, react, test runner
./target/debug/snapback2 doctor      # boot-to-ready proof: certifies programs, finds the compiler worker
```

Using the product from a project (the shim sets `SNAPBACK2_COMPILER`):
`snapback2 init [dir] [--template todos|chat] [--client react|none] [--json]` (Quarry `snapback/*.q`),
`snapback2 dev` (prints `SNAPBACK_URL=…`, detaches, attaches if running, `--stop`/`--status`),
`snapback2 check`, `run <op> [args] --as alice`, `test`, `why`, `trace latest`, `data`, `logs`,
`persona`, `fork`/`reset`, `guide`.

Gotchas you cannot derive from the code:
- Own Cargo and Bun workspaces; the repo root excludes them. Run cargo/bun from `snapback2/`.
- LLPs for Snapback 2 are numbered **1000+** in the shared `llp/`; `llp-create` must be told.
- No file over 1,500 lines — `caps` (root `node scripts/caps.mjs`) refuses it. Split on the way in.
- The corpus under `corpus/` is shared by the Rust engine, the TS evaluator, and the TS compiler;
  regenerate with `cargo run -p snapback2-core --bin export_corpus`.
- `effects` is off by default; `hermes` needs `IBEX2_VANILLA_HERMES_DIR` + `IBEX2_HERMESC` (see
  `scripts/hermes`). The blocking checks never depend on it; the published binary carries it.
- Backends use `snapback/schema.q`; TypeScript under `snapback/` is reserved for effects, seeds, and journeys.
- The binary needs the bundled compiler worker (`packages/snapback2/dist/compiler.mjs`) for any verb
  that compiles; run `node build.mjs` in `packages/snapback2` after touching the compiler.
- `metrics/loop.jsonl` is append-only and conflicts on every merge; resolve by union.
- Reuse a named lane worktree; never `git stash`; push after `scripts/test.sh` is green.
