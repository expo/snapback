# LV round 7 — decoder failures carry no authority

Branch `sb4-intent/lv-hook-retention`, base `f689b2570fe98253feee829f067fceebed9dd78e`.
Read rounds 0–6's prompts, reports and journal entries, LLP 3000.029, the Snapback 4
fence and client/reads guide, FU's overload record, and Astra's full round-6 review.
Applied `llp-orient`. Fetch left `origin/main` at `dc21eb085`; no merge was needed.
**No `scripts/test.sh`, push or publication.** The supervisor owns the landing suite.

## Correction and audit

Online decoding and local publication now share a small refusal classifier and
reuse the existing admission-refusal treatment. `E_HTTP_RESPONSE` cannot replace
a retained answer, delete remembered data, change request ordering, install a
durable fence or advance an ephemeral floor. Direct callers retain the diagnostic;
initial and opted-out observations expose it. Retained observations preserve their
original deadlines and presence interval. FU's link-state, retry/backoff, transport
causes and once-view behavior are unchanged.

The audit also found the composed-search route bypassed the earlier classification.
Local classification now happens before cache mutation for all candidate origins.
Non-authoritative codes are `E_OFFLINE`, `E_HTTP_RESPONSE`, `E_RATE_LIMIT`,
`E_STORE_BUSY`, and retryable `E_STORE`/`E_AUTH`: the latter three report that
store/auth evaluation could not proceed. Terminal scope denials, evaluated query
denials, real null/subset replacements and ordered `E_ASSET_UNKNOWN` keep their
withdrawal behavior. LLP 3000.029 §11 records the complete source/code classification,
including unavailable preflights, terminal poll refusals, core runtime codes and
the open set of authored/native denial codes. No contract, Rust, budget, dependency,
retry policy or authoring option changed. Only three production TypeScript files
change; no awaits were added or moved. No new LLP or skill hand-off was needed.

## Regressions

- **18 real HTTP cases** across online/process/wasm: malformed 200 and 404 plus
  explicit offline, store, store-busy and retryable-auth replies. They check direct
  diagnostics, link state, retained matching owners, opted-out peers, mounted
  background refresh and unchanged original deadlines. Local cases additionally
  check remembered recovery and a new alias answered by the unfenced replica.
- **12 composed-search cases** on process/wasm cover all six classifier codes,
  preserving the retained page while direct and opted-out callers see diagnostics.
- The original six malformed-response regressions fail on round 6 at the retained
  data assertion and pass after the fix. A later isolated round-6 SDK control runs
  all 30 final cases: **28 fail / 2 pass**. Two failures are refresh-wait timeouts;
  the other 26 are retention assertions. The two composed `E_OFFLINE` controls
  already pass. The live SDK was never replaced by the control. All 30 pass now.

## Qualification and failures

| Check | Result |
| --- | --- |
| Final affected client run, with product/test sources frozen | **1,017/1,017**, zero failures/cancellations/skips, 115 s; [command](./final-command.json), [log](./final.log.gz). Includes FU overload, the 30 new cases, retention/fencing/footprint/ephemeral/property/cost/deadline/search/transport suites. |
| Delivery fault matrix, included above | **333/333**; all 166 existing sites and classifications remain unchanged (49 required, 117 optional), preserving transient/persistent injections and FIFO/exactly-once assertions. |
| Browser witnesses, included above | **3/3**: both profile gates report one mount and zero loading flashes; FU's cross-origin overload witness passes. |
| Whole guide | **98/98**, `cargo test -p snapback4-lang --test guide`; [log](./guide.log.gz). |
| Server overload | **3/3**, `cargo test -p snapback4 --bin snapback4 overload`; [log](./server-overload.log.gz). |
| Client build/declarations and typecheck | Pass; [build](./build-final.log.gz), [typecheck](./typecheck.log.gz). |
| Reference and whitespace audits | **523 LLPs, 9,887 refs, zero errors/unchecked**; [log](./ref-check.log.gz). `git diff --check` passes. |
| React authority file rerun with frozen sources | **2/2**, no product/test correction; [log](./authority-react-rerun.log.gz). |

The broader run started before the audit refinement and returned **1,529 pass /
1 fail**, 424 s ([command](./affected-command.json), [log](./affected.log.gz)). Its
`keep=true` React authority browser case read `window.latest.query.data` during
a Vite reload. The Vite error and our final source edit both occurred at 01:42:15
+0200; source-edit interference is the likely cause. This is **ours**, with no
baseline/environmental exemption. The complete two-case file passes with frozen
sources, and the separate final affected run passes. The broad run remains red
and is not presented as final-tree qualification.

An earlier six-case search run failed because our fixture incorrectly expected
empty sync to revalidate that page. Waiting for a second opted-out observation's
diagnostic exercises the intended path; corrected and expanded cases pass.
The isolated control initially used a nonexistent per-package TypeScript path;
resolving the already-installed workspace package fixed that operational error.
These are also **ours**. Every failing name and expected negative is recorded in
[FAILURES.md](./FAILURES.md) and [failures.json](./failures.json). No unresolved
affected-test failure or new native Expo qualification is claimed. Counts of
overlapping runs must not be added. No complete-suite success is claimed.

## Wasm and custody

Existing canonical wasm: **2,042,203 B raw / 593,641 B GNU file-input gzip-9**,
unchanged from round 6, **78 B below the unchanged 593,719 B cap**. SHA-256:
`d82c05104aaab6954278a37c1962ac6735b5e4cf91bdc7ddd7f75eafd4458466`.
No new wasm build is claimed; no runtime Rust changed. See
[measurement](./wasm-measurement.json), [inputs](./inputs.json) and
[qualified sources](./qualified-sources.json).

No tools were installed. Generated outputs and the isolated control remain ignored.
One append-only journal entry accompanies this local commit with
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>`. Push and publication remain unperformed.
