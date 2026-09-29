# LV round 10 — device denials and SDK validation origins

Branch `sb4-intent/lv-hook-retention`, base
`5395f049bb3e2315676a9d434b4dd41405d52a60`. Read rounds 0–9's prompts,
reports and lane journal entries, LLP 3000.029, and the full Astra round-9
review. Applied `llp-orient`: LLP 3000 §4 supplies the fence; LLP 3000.029
§§8–11 govern dependency evidence, ordering and refusal origin. The client/reads
guide remains consistent with these corrections. LLP 3000.029 is Implemented
and archived; its Revised line and §11 now describe both corrected paths.
No new LLP or skill hand-off.

Fetched origin; main advanced to `fbe996a1f381ff16b4b58d302d3d5d2d06c5fc06`.
`git merge-tree --write-tree HEAD origin/main` found no conflicts, so no merge
was performed. **No `scripts/test.sh`, push or publication.** The supervisor
owns the existing landing qualification.

## Targeted corrections

An accepted, evaluated local denial now enters the existing remembered-answer
ordering and marks replacement evidence. Final publication reconciles matching
observations before the direct query returns. It retains the preflight,
speculative/unavailable, deadline, credential and dependency-fence checks.
No HTTP fallback is needed to deliver device authority.

Mixed-search overlap validation now creates its diagnostic through the same
private Symbol helper as the decoder. An otherwise valid HTTP 200 missing
`searchCurrent` therefore leaves retained rows and their original device/server
deadlines intact. Its direct and opted-out callers still receive E_INPUT with
the original message. No new code-string exception or wire/public type is added.

The requested single sweep found five further unevaluated construction sites:
missing device-ledger metadata, both cursor rejection branches, SDK coordinator
allowance exhaustion, and online request serialization. All now mark their
decoder or admission origin through the internally exported `sdkRefusal` helper.
Actual device/server denials with the same codes remain evaluated evidence.
Every outside-helper construction and its origin is listed in
[REFUSAL-SWEEP.md](./REFUSAL-SWEEP.md), with exact sources in
[refusal-constructors.json](./refusal-constructors.json). Lifecycle boundaries
still withdraw independently; other write/action/effect/auth diagnostics never
enter raw query reconciliation. The sweep stops there.

The production delta is limited to four TypeScript files. No production await
was added or moved, and the delivery classifications remain unchanged. No Rust,
authorization rule, meter charge/limit, retry allowance, dependency or wasm
budget changed. Generated declarations were rebuilt and remain ignored.

## Regression evidence

Before rebuilding the client, all **five requested regressions fail** on round-9
artifacts at the intended retention assertions: three device cases and two
malformed search envelopes. [Before log](./before.log.gz).

The native fixture really runs `ctx.now()` and reads the synced secret on
`processDevice`; its wrapper controls only the query's input clock. Advancing
that clock to the argument-supplied cutoff produces E_HTTP_RESPONSE,
E_STORE_BUSY or APP_DENIED from native Rust. Each case asserts a real device
denial, **zero HTTP queries throughout**, and replacement of default,
`keep:false` and `keep:true` mounted peers before return.

Process/wasm search regressions remove `searchCurrent` from real server replies,
then assert direct/opted-out diagnostics, unchanged retained IDs and both
original deadlines. Additional process/wasm cases cover missing device-ledger
metadata and SDK budget refusal; two seam tests cover both invalid cursor
branches and online JSON serialization. All **11/11** pass in the focused run
and the affected run. [Focused log](./regressions.log.gz).

## Verification and failures

| Check | Result |
| --- | --- |
| Affected client suite, code/tests frozen | **1,059/1,059**, zero failures/cancellations/skips, 112.1 s. Includes FU overload/transports, retention/fencing/footprint/ephemeral models, search, expiry, input/session publication, browsers and delivery matrix. [Command](./affected-command.json), [log](./affected.log.gz). |
| Delivery fault matrix, included above | **333/333**, all 166 existing classifications unchanged. |
| Browser witnesses, included above | **3/3**: both profile gates preserve route/draft with one mount and zero loading flashes; FU overload passes. |
| Whole guide | **98/98**, `cargo test -p snapback4-lang --test guide`. [Log](./guide.log.gz). |
| FU server overload | **3/3**, `cargo test -p snapback4 --bin snapback4 overload -- --test-threads=4`. [Log](./server-overload.log.gz). |
| Client build/declarations and typecheck | Pass. [Build](./build.log.gz), [typecheck](./typecheck.log.gz). |
| References and whitespace | `./ref-check --verbose` and `git diff --check` pass. [References](./ref-check.log.gz). |

The five intentional before-fix failures are **ours**, not baseline exemptions.
Orientation lookups of guessed filenames/globs also failed and are **ours**;
correct existing files were subsequently read. [FAILURES.md](./FAILURES.md)
records each failing test and setup error. No unexpected test failure, baseline
failure or environmental failure occurred this round. Counts overlap; do not
add them. No new full-suite or Expo UI qualification is claimed.

## Wasm and custody

Existing canonical wasm: **2,042,203 B raw / 593,641 B GNU file-input gzip-9**,
unchanged from round 9, **78 B under the unchanged 593,719 B cap**. SHA-256:
`d82c05104aaab6954278a37c1962ac6735b5e4cf91bdc7ddd7f75eafd4458466`.
No wasm rebuild is claimed; no runtime Rust changed.
[Measurement](./wasm-measurement.json), [inputs](./inputs.json),
[qualified sources](./qualified-sources.json).

No tools were installed. Native fixtures use this worktree's existing
`target/native-fixture`. One append-only journal entry accompanies the local
commit with `Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.
Nothing pushed or published.
