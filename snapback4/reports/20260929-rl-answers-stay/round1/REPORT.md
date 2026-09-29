# Lane RL, round 1 — answers stay on screen

Base: round 0, `9e8b8090a`; branch `sb4-intent/rl-answers-stay`.
Local commit only, with the requested GPT-6 Astra co-author trailer. No push or publication.

## Result and review disposition

Plain same-key revalidation retains without a time limit. All change evidence
keeps the existing non-renewable one-second episode: local `apply`, `admit`,
`settle`, acknowledged online mutation receipts, durable and ephemeral
`/changes`, and `/sync` publications. A failed replacement or elapsed bound
withdraws. Successful immediate replica replacements still produce no loading
render. Periodic sampling remains plain.

Read Astra's complete round 0 review and Grok's completed round 0 review.
Grok was still writing at the initial check; its final verdict is NOT READY.
Both reviews' findings are addressed. Grok's completed file was checked again
before committing; it contains no additional findings. The author's corrected bound takes
precedence over Grok's suggested separate fail-closed latch. No new evidence
ordering algorithm, public field, or contract type was introduced.

| Finding | Change | Falsifying coverage |
| --- | --- | --- |
| Astra 1 / Grok commit and receipt High: visibility after membership removal during failed local replacement | Local commits call `reload(true)` | Each of `apply`, `admit`, `settle`, default/true, held/thrown; real process/wasm membership removal with held/thrown replica read |
| Astra 2 / Grok receipt High | `sent` receipts refresh with the bound | Actual online mutation receipt followed by held/offline query, default/true; change feed parked |
| Astra 3: ephemeral-only notifications | Invalidation callback carries `changed` separately from reset and sampling | Online/process/wasm same durable sequence, changed ephemeral epoch, held replacement; independent sampling callback check |
| Astra 4 / Grok honesty | Offline metadata is copied immediately and independently of answer selection; facade A uses A's confirmation time while B waits | Process/wasm failed recovery; held approved A/source B checks identity, original `since`, actual A expiry while B has a later deadline |
| Astra 5: ordinary search | Preserve the transport classification through search and final fallback selection | Process/wasm plain search failure never publishes loading; explicit loading and denial still replace |
| Astra 6 / Grok model | Authority derives from injected fixture commits, failure times and sign-out | Every notification checked, including held/failed replacements during removal, public sign-out during a held replica read, and `fresh`/`since` |
| Astra 7, pre-existing: remembered answer returns after failed sync | Forget affected memory with its existing ticket barrier when change evidence arrives | Process/wasm membership change notification, failed query/sync, no remembered answer reappears |
| Grok pending-evidence Medium | Reuse the observation version fence to reject a local read begun before change evidence | Process/wasm held pre-change completion, failed replacement; removing this fence fails both tests |

The new review regression file passes **37/37** (`review-qualified.log`).
Against the saved round 0 dist, the original 35 cases give **31 failures and
4 passes** (`review-tests-round0.log`): all fixes are falsified; the four
explicit search loading/denial cases pin existing behavior. The two additional
Grok cases both fail with only the new observation fence removed
(`mutant-change-fence.log`). Snapshots use real process and wasm devices;
network and device completion times are controlled by the tests.

The plain search test reacquires the same local handle to run its existing
start callback without injecting an `apply` commit. A `sync()` trigger would
exercise bounded change evidence under the corrected rule.

## Model evidence

The reference no longer learns membership removal from an emitted null and
never disables checking during a transition. A committed injected fixture
frame determines membership before the SDK can notify. Each seed schedules
both a held and a failed replacement across two membership removals, varying
the order of an older evaluation and sync. It checks the allowed one-second
window before and at its deadline. Twelve mixed server/local completion pairs
and current local clock denials still run per seed. Public `signOut()` crosses
a held real replica re-read with a randomized late success/failure.

Offline failure uses the mounted observation's fetch boundary, with a fixture
clock that independently fixes its last confirmation time. The oracle checks
both `fresh: false` and exact `since`, on every subsequent notification.

| Host | Final seeds | Failed seeds |
| --- | ---: | ---: |
| process | 300 | 0 |
| wasm | 300 | 0 |

`oracle-qualified.log` and `oracle-qualified-{process,wasm}.json` are the final
records. Removing only the offline freshness assignment in
`ReadObservation.failed()` fails **3/3 seeds on each host** with
`offline answer still fresh` (`mutant-offline.log` and its JSON records).
The oracle does not import admission/episode logic or use emitted answers to
set authority; the direct current-answer assertions use fixture image numbers.

## Verification

- Review regressions: **37/37**.
- Expanded affected run: **1,091/1,108**, with 17 obsolete assertions corrected;
  all three affected files then pass **96/96**. Every failure and correction is
  listed in [FAILURES.md](FAILURES.md).
- Existing React gate/history tests on process, wasm and online are included in
  that affected run and pass. Three-second refetch, plain offline failure,
  retry exhaustion and reconnect keep the route mounted; immediate successful
  peer sync/send/settlement/edit/delete and membership replacement have no
  loading render. Default and `keep: true` both run.
- Whole guide: **98 passed, 0 failed** (`guide.log`).
- Package build/typecheck pass. `ref-check --verbose`: **523 LLP docs, 9,856 refs,
  28,875 files, 0 errors, 0 unchecked**. `git diff --check` passes.
- Full script, exactly once: **`== 1 failure(s) in 1231 s`** (exit 1).
  The failed stage is `client tests`: **4,644 tests, 4,625 pass, 9 fail,
  10 skipped** (the separate wrapper shards also pass). All nine failures are
  **ours**, with **0 baseline** and **0 environmental** failures. The separate
  full-script model stage passes **79/79**. Every other script stage passes.
  All nine titles, causes and scoped corrections are in [FAILURES.md](FAILURES.md).
- Full-run follow-up: the corrected expiry and remount-property files pass
  **32/32** (`full-assertion-fixes.log`); surviving README examples pass **6/6**
  (`readme-final.log`). All nine full-run failures are fixed.

The full run intentionally remains recorded as red. It saw the obsolete expiry
request-count assumptions, the remount model's discarded deadline, and the test
of the route workaround removed in round 0. No production change was needed
for those failures. The full script was not rerun, so this is not a claim that
all tests passed together on the final commit.

The first affected run's ordering assertions treated any `fresh: false` copy
as a completed recovery. Those tests now distinguish the unchanged displayed
identity from a replacement and explicitly await recovery. Their ordering
expectations are preserved: newer memory wins; a later refusal leaves no
remembered answer. Commit/expiry assertions now require the corrected bound.

## Wasm

Canonical full-suite build: **2,040,529 B raw; 592,975 B gzip**.
Cap: **593,719 B gzip**, leaving **744 B**. No Rust or budget changes.
SHA-256: `3fb9d26ca58097b01fb3fcfdf6f0c02b0416d1969565bd84e7d463b7fa98998b`.

## Governing context and scope

Used `llp-orient`. The governing context is LLP 3000 §4 (the Snapback 4 fence),
LLP 2000.000 §7.2 (replica authority), LLP 3000.016 §2.2 (read routing),
LLP 3000.018 §3.2 (ordered memory), LLP 3000.019 §3.3 (watch lifetime), and
LLP 3000.023 §§3.4, 3.6 and 10 (boundaries, facade deadlines and retention).
LLP 3000, 3000.019 and 3000.023 are in `current/`; LLP 3000.029 §0 is Shelved.
The client guide card supplies the current authoring form. The report, LLP
3000.023 §10, the 3000.018 memory rule and 3000.019 pointer, client card,
READMEs and operations manual
now agree. No hand-off is needed.

Reproduce from `snapback4/`:

```sh
bun run --cwd packages/snapback4 build
node --test packages/snapback4/test/answers-stay-review.test.mjs
RL_ORACLE_OUT=reports/20260929-rl-answers-stay/round1/oracle-qualified node --test packages/snapback4/test/mixed-evidence-oracle.test.mjs
cargo test -p snapback4-lang --test guide
bash scripts/test.sh
```
