# Round-7 reproduction

Run from `snapback4/` with the environment in `environment.json`. These are
affected checks, not `scripts/test.sh`. The wasm build completes its artifact
and then exits 1 at the unchanged size cap; that failure is recorded explicitly.
All logs below are stored with `.gz` appended to the original log name.

```sh
cargo build -p snapback4
bash scripts/build-wasm.sh
bun run --cwd packages/snapback4 build
bun run --cwd packages/snapback4 typecheck
cargo test -p snapback4-sim --test ordinary_search --test membership_search --test search_merge
cargo test -p snapback4-device --test device search_merge
cargo test -p snapback4-device --lib search::tests
cargo test -p snapback4-device --lib publication_round6
cargo test -p snapback4-core --lib meter::tests
cargo test -p snapback4 query
cargo test -p snapback4-lang --test guide
node scripts/attribute-wasm.mjs --families --check-families --check-absent
node --test packages/snapback4/test/wasm-codec-census.test.mjs packages/snapback4/test/wasm-families.test.mjs packages/snapback4/test/wasm-absent.test.mjs
```

The combined `js-acceptance.log` run used these affected files. Its 160 passing
cases precede the additional authentication boundary regression; the final
`auth-boundary-final.log` reruns that file with all five cases passing, making
161 distinct affected cases. `ledger-pages-final.log` separately verifies the
final coordinator accounting and source-identity accumulation.

```sh
node --test --test-concurrency=1 \
  packages/snapback4/test/astra-arguments.test.mjs \
  packages/snapback4/test/astra-invalid-input.test.mjs \
  packages/snapback4/test/astra-projection.test.mjs \
  packages/snapback4/test/astra-rebirth.test.mjs \
  packages/snapback4/test/cross-scope-review.test.mjs \
  packages/snapback4/test/identity-review.test.mjs \
  packages/snapback4/test/ordinary-search-ledger.test.mjs \
  packages/snapback4/test/ordinary-search.test.mjs \
  packages/snapback4/test/react.test.mjs \
  packages/snapback4/test/retention-pages.test.mjs \
  packages/snapback4/test/review-probes.test.mjs
node --test packages/snapback4/test/ordinary-search-oracle.test.mjs
```

The default oracle runs 300 seeds per host plus the 22 current-only differential
schedules per host. For targeted controls, prefix its command with
`SB4_SEARCH_SEEDS=1,2,3,4` (new categories), `SB4_SEARCH_SEEDS=225,240,300`
(cut-model controls), or `SB4_SEARCH_SEEDS=3` (argument mutation).

`mutation-arguments.log` comes from an isolated package copy under ignored
`target/os-r7-argument-mutant`, with only the generated JavaScript cursor binding
changed from `[name, args, env.principal` to `[name, env.principal`. Its two named
needle-change tests and two generated-host checks all fail. Product sources and
normal build artifacts were not changed by that negative control.

From the repository root, `./ref-check --verbose` and `git diff --check` pass.
`failure-index.json` indexes every failing test/build log; the report classifies
each failure. Review snapshots are the full final Astra/Grok texts, with Grok
checked again before the round's final commit.
