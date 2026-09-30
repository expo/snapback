# Reproduction commands

Run from `snapback4/`, with existing workspace dependencies and real device/server
builds. All paths are repository-relative. These describe the retained runs;
`full-suite.log` is the only full-suite invocation in round 5.

```sh
bun run --cwd packages/snapback4 build
node --test packages/snapback4/test/subscription-pressure*.test.mjs packages/snapback4/test/per-row-retention.test.mjs packages/snapback4/test/one-shot*.test.mjs packages/snapback4/test/ordinary-history.test.mjs packages/snapback4/test/unread-range.test.mjs
node --test packages/snapback4/test/delivery-fault-matrix.test.mjs
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT cargo test -p snapback4-lang --test guide
```

Historical detecting control (expected failing exit):

```sh
node reports/20260930-pr-subscription-pressure/round5/control-sdk.mjs b131c89893 pr-round4
RL_TEST_SDK=target/pr-round4/dist node --test packages/snapback4/test/subscription-pressure-authority.test.mjs packages/snapback4/test/subscription-pressure-refusal-candidate.test.mjs packages/snapback4/test/subscription-pressure-sync-memory.test.mjs
```

Current-main original-six control (expected failing exit):

```sh
node reports/20260930-pr-subscription-pressure/round5/control-sdk.mjs 267788df36 pr-main
RL_TEST_SDK=target/pr-main/dist node --test --test-name-pattern='first answer at|retired by publication$' packages/snapback4/test/subscription-pressure-refusal-candidate.test.mjs packages/snapback4/test/subscription-pressure-sync-memory.test.mjs
```

Social schema read-path comparison:

```sh
RL_TEST_SDK=target/pr-round4/dist PR_SOCIAL_OUT=/tmp/social-round4.json node --test reports/20260930-pr-subscription-pressure/round5/social-fallback.mjs
PR_SOCIAL_OUT=/tmp/social-round5.json node --test reports/20260930-pr-subscription-pressure/round5/social-fallback.mjs
```

Pressure traces use `PR_EVIDENCE=<output-directory> PR_LABEL=final`, with
`PR_HOLD_MS=1100 PR_LABEL=active` for the forced expiry run, on the unchanged
`packages/snapback4/test/subscription-pressure-e2e.test.mjs`.

LL uses the existing instrument-server.py build procedure under
`reports/20260929-ll-live-latency/tools/`, restoring the instrumented source before
ordinary qualification. Build the baseline SDK with `control-sdk.mjs 56571c0274
pr-round5-base`. For each `{base,fixed} × {wasm,process} × {0,3}` cell use
`PR_LL_SDK=target/pr-round5-base/dist` or `packages/snapback4/dist`,
`LL_TIER=<tier> LL_LOAD=<workers> LL_RUNS=20 LL_KEEP=viewed LL_OUT=<file.json>`
and `taskset -c 0-3 node reports/20260930-pr-subscription-pressure/round5/ll-measure.mjs`.
The original summarizer accepts the retained compressed raw inputs:

```sh
node reports/20260929-ll-live-latency/tools/summarize.mjs reports/20260930-pr-subscription-pressure/round5/ll-*.json.gz
```

Full-suite command, run once:

```sh
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash scripts/test.sh
```

Ref-check is run from the repository root with `./ref-check --verbose`.
