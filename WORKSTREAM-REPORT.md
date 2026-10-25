# FIX41 — 0.4.41 publication repairs

Worktree: `/home/ccheever/projects/snapback-sb4loop`; branch `sb4-loop`.
Starting revision: `5c4716af14`. Version remains **0.4.41**.
**Complete: pushed main `ba886e7be07e522df2b0fdd35a341e57ea7229dc`**.
Remote `refs/heads/main` independently verified at that exact SHA.
Non-forced push; no npm publication performed.
Publisher evidence was read only; no `sb4-pub-*` worktree or kit was changed.
Replay used copies and verified all 300 original files were unchanged.

Used `llp-orient` and `llp-ship`, following the Snapback 4 fence, LLP 3000,
retained-storage §21 and starters §10. User branch/merge instructions took
precedence over generic skill branch rules. No RFC status was accepted for
its author. Four rounds of actual independent Muse/fresh Codex reviews,
including their findings and fixes, are preserved under `llp/reviews/`.
Both final semantic reviews returned READY at `c8ef2ccafc`.

## 1. Workspace feature unification

Commits: `6c79375cbb`, fixture-boundary cleanup `97e59e6d2f`.
Core's debug test-support constant reports the actual compiled evaluation
feature. The test refuses an exact evaluation tracker in package-only mode,
admits it when core is workspace-unified with evaluation support, and always
refuses a maliciously changed body. Package target: 1/1 passed. Workspace
main test binary: 612 passed, 57 ignored. Publisher-style runner completed
459 binaries / 1,177 executions; its two initial development-fixture failures
were corrected and retested. No further workspace/package feature blind spot
was found. The initial runner is not claimed as entirely green.

## 2. Nested identity binding

Commit: `0be6995c45`. Stable-point facts are checked before speculative key
selection, and the field AST is borrowed. DX9 semantics remain covered.
Original eight-level case: 721.5 ms before, 6.3–6.7 ms after. New twelve-level
case: 76.7 ms, below the retained 1 s guard, with 12 runtime reads.
Positional keys: 11/11; DX9 ergonomics: 3/3. Plain 2k differential campaign:
120,026 executions, zero disagreements. Lean 2k reports only the 18 existing
classified C2/W4 signatures, tracked by the existing Quarry tickets and
`lean/OPEN.md`; no new signature was introduced. A separate standalone
full-language run hit its 1,200 s guard after 1,857 passes and no failures;
the later full affected language step passed.

## 3. Original rollback shape and receipt ownership

Commits: `39cdc9cea7`, `caefb60f5c`, `c8ef2ccafc`; final replay record
`4685131d7f`. Prefer a fitting original extraction shape under current
static/visibility checks and private activation. Normalize only generated
reference labels under the declared rename. Capture receipt ownership before
reverse adoption can mint receipts, preserving independent native children.
The regression reads the exact publication media schema and checks `scan`.
Eligibility target: 1/1; receipt snapshot transaction test: 1/1;
`roll_views`: 29/29. Actual installed `proveMigrations` and
`proveRollInstalled` passed, including reference rename, private file
extraction, current guards, worker cases and two rollback cycles.

The first complete packed attempt found the reference mismatch and was not
counted as success. The final fresh packed consumer qualification passed.

| Replay metric | Before | Final |
|---|---:|---:|
| Stores / moves | 100 / 500 | 100 / 500 |
| Successful moves | 482 | 482 |
| Expected true refusals | 18 | 18 |
| False refusals | 0 | 0 |
| Correct live result lines | 482 | 482 |
| Ordinary source forwards | 194 | 194 |
| Hidden v1 rows | 0 | 0 |
| Original files unchanged | 300 | 300 |

Checked-in digest-only records:
`snapback4/reports/20261025-fix41/replay-{before,after}.json`.
Final replay binary SHA256:
`adef6f93afc7fc35e45190a018652dca68ab925bdaf35af1d4231be6812ee82c`.

## 4. Unremediable advisory policy

Commits: `2a9b9871dc`, `97e59e6d2f`, `3595b5f091`.
The checked-in allowlist records advisory, package, dependency path, reason,
affected starters and **2026-11-08** recheck date. Unknown or fixable advisories,
concrete remediation candidates, new reviewed-package versions and expired
reviews fail. Allowed unfixable advisories print and retain warnings in every
starter result, including template and Docker/proot paths.

The specific npm meta-advisory anomaly is recorded separately: all versions
are affected, `fixAvailable:true` supplies no concrete candidate, and the exact
unfixable node-forge chain remains after upgrading the wrapper to its latest
0.0.7. Audit dry-run offers no remediation. This exception cannot hide a
concrete candidate, changed chain, new reviewed version or expired review.
No ineffective pin or forced downgrade was introduced.

node-forge reaches Expo development/code-signing tooling, not the generated
app runtime. The ticket records this inspection and the coordinator ruling.
Qualifier regressions: 63 passed; day-5 proofs: 5 passed; Expo README regression
passed. All six real packed diagnostic starters passed; all three Expo results
retained their advisory warnings. The final clean-distribution qualification
also passed.

## 5. Browser admission under load

Commit: `438e676638`. The fixture uses a bounded replenishing socket bank and
requires an actual received raw 503 plus the host diagnostic. It no longer
treats kernel connection completion as admitted ownership. The bank replaces
refused and expired leases; product capacity, five-second deadlines, browser
CORS/Retry-After and four-attempt assertions remain unchanged.
Deterministic warm/refused/expired lease regression passed.
20/20 alone (2.999–3.217 s); 20/20 beside an eight-file heavy client pool
(3.019–3.131 s). Pool: 8/8 files, 187/187 tests. Related tests: 114/114.

The broad run found another copy of the defective saturation fixture in
`upload-retry.test.mjs`. Its test-only follow-up preserves all real upload
assertions, waits for authenticated recovery, and has independent fresh Codex
READY review. Entire file: 36/36; 20/20 alone and 20/20 under the same heavy
pool, which stayed active throughout and passed 187/187.

## Integration follow-ups and verification

The newly merged G7.2 local neutral adapter types exposed a static census
false positive. The narrow test-only repair preserves the zero production
allowance and conservative driver alias handling, with negative controls.
Fresh full and guard-delta Codex reviews returned READY. Candidate: 9/9 tests;
production 0 sites, existing test census unchanged at 116 sites / 16 files.

The same broad run exposed a separate store-reset fixture race: an error
reply with no generation satisfied `generation !== oldGeneration`. Two
consecutive HTTP 503 / retryable generation-family `E_GENERATION` replies
reproduced it (original 19/20 passed). The test-only correction waits only
through that declared transient, validates a successful sync reply and retains
it, while malformed metadata and other refusals assert immediately. The
head/store/client-health assertions are unchanged. Deterministic consecutive-
refusal regression and full file: 13/13; 20 selected repeats: 80/80; fresh
Codex high review READY. No extra heavy pool overlapped isolated timer proofs.

Full requested selection (`--base 5c4716af14 --run`) completed against unchanged
`b168eb27352a8ed0ebdc398b48a85390999d0a42`. Receipt:
`target/affected/b168eb27352a-1792949143432.json` (`complete:true`,
`unchanged:true`, `ok:false`). Raw nonzero steps are snapback4's inherited
census classification, the store-reset fixture, and the existing Lean findings.
The first two are corrected in the test-only follow-ups; their final in-tree
checks are recorded below. The original upload fixture happened to pass this
run but failed the earlier broad run, hence its independently verified repair.

All other Rust packages, fixture tests, models, chat/Expo typechecks, diagnostics,
generated artifacts, guide (22/22), inventory, packaged docs, ref-check,
release guard, selector tests and WebAssembly measurement passed. The broad
client pool ran 438 files / 8,001 tests: 7,944 passed, 56 skipped and the single
store-reset failure described above. Browser overload passed in 2.990 s.
Plain differential campaign: 2,000 cases, zero disagreements and zero
unexpected runtime refusals. Lean: 1,658 passed, 324 unsupported, 18 existing
classified disagreements (5 continuation-next, 8 next, 5 prelude-code).

Fetched and cleanly merged main through `b2959e2455` as `d536592e23`. No
semantic conflict resolution was needed. Final corrections: `8c6a5ac256`
(census; closes the inherited G7.2 ticket), `89b1133db0` (upload lease fixture),
`f3930086b6` (successful adoption barrier). Their actual fresh reviews and
patch/review hashes are retained under `llp/reviews/`. Merged-tree standalone
census: 9/9, zero production sites and unchanged test allowance.

Post-merge product targets all passed at `f3930086b6`:

- Feature-sensitive tracker: 1/1 in a workspace library/bin test build and
  1/1 in package-only binary mode.
- Receipt before-image transaction unit: 1/1.
- Rollback views: 29/29 (143.83 s).
- Positional keys: 11/11 (0.08 s total), including the original 1 s budget and
  the deeper unstable-key regression; DX9 ergonomics: 3/3.

Final affected selection for the three test-only corrections:
`node snapback4/scripts/affected.mjs --base d536592e23 --run` at `f3930086b6`
**PASS**, with `complete:true`, `unchanged:true`, `ok:true`:
`target/affected/f3930086b671-1792960235015.json`.
All seven commands passed: CLI/WASM/client builds, in-tree census 9/9,
in-tree client files 49/49 (upload 36, store-reset 13), and ref-check.
The production census remains zero; test allowance remains 116 sites / 16 files.

The execution closeout was committed as `58b7b5e802`. A final affected run
for that documentation-only delta (`--base f3930086b6 --run`) also passed:
`target/affected/58b7b5e8026e-1792960522491.json`. Ref-check: 569 LLPs,
12,642 refs, zero errors/unchecked. Full-branch whitespace inspection only
flags intentional Markdown hard breaks in the verbatim original review output;
changed code passes whitespace validation. Reviews were preserved verbatim.

The final fetch brought only `7e88aa041d` benchmark-result files. Clean merge
`ba886e7be0` introduced no product source or configuration changes. The tested
semantic delta and review content survived unchanged; expensive tests were
not repeated for benchmark records (LLP 0189 / LLP 0232). Landing ref-check
passed again. Push `git push origin sb4-loop:main` succeeded; remote main was
verified at `ba886e7be07e522df2b0fdd35a341e57ea7229dc`. The pre-push hook
allowed the update with the normal scheduled frozen-record gate deferral.

Fresh prepared client/Expo packs at source
`b168eb27352a8ed0ebdc398b48a85390999d0a42`, version **0.4.41**:
`snapback4/target/publication/fix41-final2-client-0.4.41/`.
`qualify-linux.mjs --consumer-only` completed **exit 0** via proot. Every
required host, Ubuntu 24.04 and Alpine consumer proof passed, including
migrations/rollback and all starters. Receipt:
`snapback4/target/fix41-consumer-final2/consumer.json`.
Its unchanged SHA256 is
`6fe1c818ba47d8c9d07a4e9fd6141b19dc2f02842d29316db3d11f0b64818409`.
Expo results pass with the checked-in advisory warnings. Consumer-only mode
correctly records `publicationQualified:false`.

Owned FIX41 work has no remaining implementation or verification deferral.
The 18 inherited Lean findings remain their existing tracked follow-ups; the
unfixable Expo advisory remains explicitly reviewed until 2026-11-08. The
publisher owns the full publication retry and npm publication from pushed main.
No version bump was made.

The consumer receipt is **consumer-only**, not a full publication receipt;
full publication qualification and npm publication belong to the publisher.
All commands had timeouts. Required nonincremental/debug-zero Cargo flags
were supplied on subsequent checks; two early standalone inventory/budget
preflights inherited default Cargo settings through child processes, which
was corrected. Their 3.4 GB incremental scratch was removed. Missing root
workspace dependencies were installed and hoisted with repository scripts;
generated artifacts and inventories then passed without source/lock changes.
Owned completed consumer projects and large scratch were removed; compact
receipts, packs, replay digests and logs were retained. No credentials were
read into repository artifacts.

Cleanup: completed consumer projects were removed. After all checks and the
verified push, removed local `snapback4/target/debug/{deps,build,.fingerprint}`
and the private `/tmp/fix41-npm-cache` (about 40 GiB combined), retaining the
normal CLI, production/musl binaries, packed tarballs, JSON receipts, replay
digests and small logs. Shared free disk increased from 44 GiB to 85 GiB.
Retained CLI still prints `snapback4 0.4.41`. No other worktree/cache was touched.
The final report is intentionally left uncommitted as permitted by the brief.
