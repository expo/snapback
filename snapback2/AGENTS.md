# Snapback 2 — agent command sheet

Read this, then `rules/RULES.md` and `rules/NOT-DOING.md` at the repo root, then
`llp/1000-snapback2.explainer.md`. Nothing else is required before working.

```
cargo build                      # data plane + binary; no JS engine, no bootstrap
cargo test --workspace           # 7 engine tests + effects seam (~15 s warm)
scripts/test.sh                  # everything that blocks: cargo + evaluator + compiler
node scripts/measure.mjs --check # loop numbers → metrics/loop.jsonl; fails on regression
node scripts/publish.mjs --dry-run   # production build + npm pack; drop --dry-run to ship
scripts/hermes build             # only for effects: links Ibex 2 + vanilla Hermes
scripts/hermes test -p snapback2-effects # effects engine proof; never blocking
./target/debug/snapback2 doctor  # boot-to-ready proof; `check <program.json>` certifies
```

Gotchas you cannot derive from the code:
- This is its own Cargo workspace and Bun workspace; the repo root excludes it. Run
  cargo/bun from `snapback2/`, never from the root.
- LLPs for Snapback 2 are numbered **1000+** in the shared `llp/`; `llp-create` picks
  the next low number unless told.
- No file over 1,500 lines — `caps` (root `node scripts/caps.mjs`) refuses it. Split
  on the way in when stealing from `crates/` or `packages/` in Snapback 1.
- The corpus under `corpus/` is shared by the Rust engine, the TS evaluator, and the
  TS compiler; regenerate with `cargo run -p snapback2-core --bin export_corpus`.
- `effects` is off by default; `hermes` needs `IBEX2_VANILLA_HERMES_DIR` (see
  `scripts/hermes`). Never make the default build depend on it.
- Reuse a named lane worktree; never `git stash`; push after `scripts/test.sh` is green.
