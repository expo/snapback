READY

# Independent source review — candidate `ff894d7cefbb2190c09e03ab6ed4f40414f4d034`

Nine-file landed DX (`1936eadd` → `0004ff7f`) plus four mechanical `0.0.15` version files on `22427817`. No desired verdict was supplied. This is source review of the assigned packet only, not production qualification, publisher execution, or performance evidence.

## Summary

The delta does what it claims on the source paths that implement it. React `init` prints a POSIX shell sequence that captures the owner's actual `SNAPBACK_URL=` line (start or attach, free port) and feeds it to Vite as `VITE_SNAPBACK_URL`; the generic React starter renders `useConnection()` instead of asserting connectedness. `test --journey` is exact-name selection across duplicate registrations, records `scope.journey` on success and failure receipts, rejects empty/`--derived-only`/`--blocked` combinations at usage exit 2, and leaves plain `test` as the full suite. Expo/headless `next` stays owner-only (`npx snapback2 dev`) with quoted `cd`. Workspace/package/lock/optional-dep pins are a coherent `0.0.15` bump; `publish.mjs` still reads those files and does not change publisher semantics.

No proved source counterexample of introduced incorrect behavior, authority, custody, selection, or compatibility was found. Residual notes below are not blocking findings.

## Material findings

None.

## Assessment by required surface

### React init: real owner URL and truthful connection state

**Source.** `snapback2/crates/snapback2/src/init.rs:15,76-87` builds `next` as `cd '<quoted-root>' && npm install && snapback_url=$(npx snapback2 dev) && VITE_SNAPBACK_URL="${snapback_url#SNAPBACK_URL=}" npm run dev` for `Client::React` only. `owner.rs:638-647` prints exactly one non-JSON line `SNAPBACK_URL={url}`. Detach (`owner.rs:272-365`) sends the child to `.snapback/log.jsonl` and prints that line from the parent after `OwnerProbe::Active`; attach (`owner.rs:91-94`) prints the same line and exits 0. Default port is 0 (`verbs.rs:150`). Failures use `print_refusal` to stderr when not `--json` (`owner.rs:662-677`), so `&&` skips Vite.

**Trigger / before-after.** After `snapback2 init … --client react`, copying `next:` (or `guide init`) used to be `cd <unquoted> && snapback2 dev` plus a template that said "The owner URL is connected." Now the printed sequence starts or attaches, strips the `SNAPBACK_URL=` prefix, and starts Vite with that URL. Generic `templates/react/src/App.tsx:1-6` renders `Backend connection: {connection}.` via `useConnection()` (`react-core.tsx:146-148`), which reads `snapshot.connection`. Initial client state is `"reconnecting"` unless forced offline (`client.ts:187`). Chat's own `App.tsx` already displayed connection and is unchanged. `main.tsx:6` still falls back to `http://127.0.0.1:3210` if the env is unset; help tells agents not to assume 3210 (`verbs.rs:46-48`).

This is a source-level contract match to LLP 1002 §10 (`llp/1002-dev-loop.spec.md:951-955`). It is not a live Vite/owner execution proof.

### Shell/path quoting and existing headless/Expo behavior

**Quoting.** `init.rs:76` uses POSIX `'\''` quoting of `canonicalize()`d `root`. `REACT_START` quotes the parameter expansion. Published optional binaries are `darwin-arm64` and `linux-x64` only.

**Expo / none.** `init.rs:77-81`: non-React `start` is `npx snapback2 dev` (no `VITE_*`, no Expo bundler). Expo still reads `EXPO_PUBLIC_SNAPBACK_URL ?? "http://127.0.0.1:3210"` (`templates/chat/expo/App.tsx:8`). That 3210 default vs ephemeral owner port is **pre-existing**, not introduced. `next` now also runs `npm install` for every client and quotes `cd`; Expo/headless still do not start Metro/Vite. `NOT-DOING.md` forbids a supervised bundler; this delta prints a client-side shell sequence rather than spawning Vite from the owner.

**JSON `next`.** Baseline JSON was `"snapback2 dev"` (`baseline/.../init.rs:74-77`). Candidate JSON is the same shell string as human `next`. LLP 1002 §10 requires an executable shell sequence. No in-packet consumer executes JSON `next` as argv (`consumer-smoke.mjs` runs `dev` itself).

### `test --journey` selection, invalid combinations, unknown names

**Exact name / duplicates.** `test.rs:799-803` skips unless `selected == name` (byte equality, not prefix). Same loop runs every matching index, including duplicates in one file or across files, via original `--list` indices (`test.rs:799-809`; runner `packages/snapback2/src/test.ts:106-118`). Tests: `test_verb.rs:1250-1319` (`focused` in two files → two pass checks; `focus` is unknown; `focused extra` is distinct).

**Invalid combinations.** Empty/whitespace-only names and `--journey` with `--derived-only` or `--blocked` return usage exit 2 (`test.rs:70-74,1330-1334`). `--journey` without a value is rejected by `parse_options` (`verbs.rs:381-387`). `--json` remains allowed. `--journey` + `--journeys-only` is **not** rejected; `--journey` already implies `journeys_only` (`test.rs:84`). Spec/guide forbid only `--derived-only` and `--blocked`. Tests: `test_verb.rs:1322-1338`.

**Unknown names.** After listing, unmatched selection pushes `journey selection` fail with `requested`, `available`, and a full-suite rewrite (`test.rs:846-856`). Loading/list failures still `continue` as journey fails (`test.rs:751-796`). Compile failures still record `certify` fail **and** `scope.journey` (`test.rs:115-134,1344-1348`).

Retained **execution** (not this reviewer's run): `evidence/focused-measure.json` "focused 1/2" pass one named chat journey with `scope.journey` set; an absent-name run fails with `available` listing authored names. Binary version in that log is `0.0.14` because the measure packed the pre-bump DX.

### Receipt scope and default full-suite preservation

`ScopeReceipt.journey` is `skip_serializing_if = None` (`receipt.rs:67-73`). `finish_selected` sets it whenever `--journey` was parsed (`test.rs:76-78,207`). Plain `test` leaves it unset. `test_verb.rs:1306-1311` asserts full suite still fails `focused extra`, still has `certify` pass, and has no `scope.journey`. `--journey` skips derived **checks** on success (same as `--journeys-only`) but still compiles first; certification failure remains a `certify` fail. That matches LLP 1002 §7 (`572-579`) and `guide/testing.md:41-48`. Zero-check pass is unchanged: unmatched `--journey` adds a fail check; empty files without `--journey` still return no journey checks.

### Owner lifecycle / error paths / documented manual coverage

`--journey` still starts `IsolatedOwner` (`test.rs:146-166,191-207`) because the runner requires `--url`/`--secret` even for `--list` (`test.ts:89-98`). Compile failure returns **before** owner start. Owner start failure records an `owner` check and still stamps `scope.journey`. `isolated.stop()` runs after journeys. `--help`/`-h` is intercepted in `main.rs:51-59` before `test::run`. Manual coverage: `guide init` + `test --help` (`guide.rs:48-67`); `testing.md` paragraph; two `test_verb` tests covering exact/all-duplicate/unknown/invalid/compile-fail/full-suite. `init` stdout `next:` itself is not asserted in `tests/init.rs` (coverage gap, not a source counterexample of wrong `next`).

### Version pins and publisher semantics

Packet source: `Cargo.toml` workspace `0.0.15`; all four crates `version.workspace = true`; `CARGO_PKG_VERSION` in `main.rs:42`; `packages/snapback2/package.json` `0.0.15` and optional `snapback2-darwin-arm64` / `snapback2-linux-x64` `0.0.15`; `bun.lock` workspace + optional deps `0.0.15`; `Cargo.lock` the four crate versions `0.0.15`. Compiler/evaluator packages remain private/unversioned. `publish.mjs:116-124` still requires Cargo workspace version == shim `package.json` version and does not rewrite publisher behavior. `version.patch` is only those four files. `version-receipt.json` records commit `ff894d7ce` as that bump. No remaining `0.0.14` under packet `snapback2/`.

## Residual notes (not blocking)

1. **`npx` stdout is not uniquely specified.** Product `dev` prints one `SNAPBACK_URL=` line; if some `npx` wrote extra **stdout** before that line, `${snapback_url#SNAPBACK_URL=}` would not strip and Vite would get a garbage URL. Failures go to stderr. This is a residual wrapper risk, not a proved product-source counterexample. `consumer-smoke.mjs:75` uses a regex against direct-binary stdout, not this `next` string.

2. **LLP 1002 §6 verb table** (`llp/1002-dev-loop.spec.md:558`) still lists `test [--blocked reason] [--journeys-only] [--derived-only]` without `--journey`. §7, `verbs.rs` help, and `testing.md` carry the new flag. Same abbreviated-table pattern already omitted `--json`/`--project`.

3. **Usage `|` vs `--journeys-only`.** `test.rs:1332` presents `--journeys-only|--derived-only|--journey` as alternatives; combining `--journey` with `--journeys-only` is accepted and redundant.

4. **Managed `AGENTS.md` React line** (`init.rs:25`) is written for every client, including Expo/none. It is qualified "For React startup". Expo still should not set `VITE_SNAPBACK_URL`.

## Checks actually performed

Read-only: `source-facts.json`, `context-pack.md`, `product.patch`, `version.patch`, `launch.json`, `prompt.md`, `source-manifest.json`; `AGENTS.md`, `snapback2/AGENTS.md`, `rules/RULES.md`, `rules/NOT-DOING.md`, LLP 1000 and LLP 1002 §5–§7, §10; candidate `init.rs`, `owner.rs` (start/attach/detach/`print_url`), `verbs.rs` (`parse_options`, `command_help`), `test.rs` (options, IsolatedOwner, `run_journeys`, usage), `receipt.rs`, `main.rs` help intercept, `guide.rs` + `guide/testing.md`, `templates/react/{App,main}.tsx`, `react-core.tsx` `useConnection`, `client.ts` initial connection, `packages/snapback2/src/test.ts` list/index runner, chat React/Expo URL usage, `publish.mjs` `packageVersion`, `package.json` / `Cargo.toml` / crate manifests / `bun.lock` version fields, `bin/snapback2.mjs`, `consumer-smoke.mjs` URL parse, `tests/guide.rs`, `tests/test_verb.rs` new tests, `tests/init.rs` (no `next:` assertion), baseline `init.rs`/`App.tsx`/`verbs.rs`/`test.rs` for before/after.

Tiny local comparison only: patch hunks vs surrounding files; version strings `0.0.14`→`0.0.15` in the four version files; affected-test counts 13+15+24=52.

**Not performed:** cargo/build/test/publisher/benchmark, network, clones, other reviewer directories, author review, active worktree, product rerun.

## Retained-evidence limits (do not promote)

| Artifact | What it is | What it is not |
|---|---|---|
| `affected-fresh-mtime.log` | 13 guide + 15 init + 24 `test_verb` = 52 passed, including both new named-journey tests | Whole-product green |
| `affected-tests.log` / `affected-integrated.log` | Earlier affected reds (guide `test` page; `E_ASSET_NOT_READY`; offline guide) | Invalidation of the later 52-pass log |
| `full-tests.log` | **Retained red:** `test.sh` failed (assets unwrap ENOENT; offline guide; jobs_queue idle timing; compiler ENOENT on LLP paths) | A demand to rerun; not introduced by this nine-file DX |
| `measure-check.log` | **Retained budget reds:** "Test what you just changed" 32.97s > 30s; `snapback2 check` 1.26s > 1s. `consumer_smoke_s` 32.97s is fewer-test/full-template smoke, not equal-work speedup | Fresh qualification |
| `focused-measure.json` | Named `--journey` ~2.3s vs full chat `test` ~15.7s; fewer checks, not equal work. Pack/install at **0.0.14** (pre-bump DX) | Proof of 0.0.15 tarballs or production |
| `source-check-final.json` | Source freeze of landed DX `0004ff7f`, 935 paths, 0 mismatches | Hash of `ff894d7` version files |
| `version-receipt.json` | Mechanical 0.0.15 bump on `ff894d7` | Publisher run |

Do not infer whole-product correctness, Apartment/standard015 qualification, or Muse/third-review outcomes from affected passes. Native/compiler/offline unlanded programs are out of scope.
