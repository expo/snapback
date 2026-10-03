# Round 1 commands and custody

All commands ran on eb1000 in this lane. Before builds/tests:

```sh
export PATH=$HOME/.local/bin:$HOME/.cargo/bin:$HOME/.bun/bin:$PATH CARGO_TARGET_DIR=~/sb5-lanes/target CARGO_INCREMENTAL=0
export RUSTFLAGS='--cfg lane_on_once_r1'
export SNAPBACK4_BIN=$HOME/sb5-lanes/on-artifacts/round1/snapback4
```

From `snapback4/`:

```sh
cargo test -p snapback4-core
cargo test -p snapback4-device
cargo test -p snapback4-lang --test guide
cargo test -p snapback4-lang --test revocation_soundness
cargo test -p snapback4 --bin snapback4 asset_list_tests
# Each of these three commands repeated five times:
cargo test -p snapback4-core --lib once_pipeline_tests
cargo test -p snapback4 --bin snapback4 once_commit_before_serialization
node --test --test-concurrency=4 packages/snapback4/test/once-*.test.mjs
bun run --cwd packages/snapback4 typecheck
node scripts/docs-budget.mjs
node --test packages/snapback4/test/wasm-budget.test.mjs
node scripts/wasm-budget.mjs metrics/wasm-budget.json 619300
```

The affected sweep selects `asset-*`, `answers-stay-*`, `answer-*`,
`approval-*`, `keep-*`, `page-*`, `read-existence*`, `read-nullable-array`,
`raw-read-deadlines`, `revocation-retention`, `store-reset*`, `retention-pages`,
`live-margin-settlement`, `online-read-order`, `delivery-fault-matrix`, and
`wasm-budget` test files with `--test-concurrency=4`.

Base and round 0 use frozen CLI, dist and wasm snapshots. `once-rejected`
compiles a real native guest against the unchanged native SDK; it does not
substitute a mocked read. `round0-test-overlay.patch.gz` adds only tests and the
post-evaluation scheduling hook to revision 1433c7de32. Positive cases pass;
its serialization and pre-used-meter regressions fail. The exact-home mutant
removes `&& c == column` in an isolated copy of current source; all three SDK
hosts then fail. The list mutant changes the recursive `all` to `any`; the
Rust mixed viewed/live nested-cell assertion then fails. The lane source and
its pinned final CLI/wasm are never mutated.

The canonical wasm pipeline is cargo's size-first `wasm` profile, wasm-bindgen
web target, locked Binaryen `-Os` and code folding (choose by gzip size), with
an explicit external-target input. The build script is unchanged. Artifact
SHA-256 records include both source and distribution wasm. The raw/gzip
measurement is 2,053,953 / 619,300 bytes; the gzip measurement uses the final
shipped basename, exactly like `build-wasm.sh`.

Each `.log.gz` is a lossless copy of the named local `.log` in
`~/sb5-lanes/on-evidence/round1/`. The report distinguishes exploratory failures
from final qualification. No push or publication was performed.
