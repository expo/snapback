# Astra max pre-audit: cal17 completed builder and scorer record

Status: **PRE-AUDIT COMPLETE — no unresolved material discrepancy or clarity correction in the completed evidence reviewed.** This is not a whole-record READY verdict. The independent functional grade, final assertion coverage, post-grade custody comparison, sampler completion and aggregator receipts remain pending and outside this audit.

Reviewer: `gpt-6-astra`, reasoning effort **max**. Date: 2026-09-23 UTC. I performed local, read-only inspection of the selected repository record, supplied pre-grade manifest, builder narratives/receipts and filtered actual scorer calls. I ran no benchmark, build, test, service, remote command or M5 mutation, and read no active grading output or other reviewer's findings.

The reviewed working record is `benchmarks/runs/2026-09-22-snapback4-clique-astra-0.2.33/` in `/Users/ccheever/projects/snapback-worktrees/sb4-3011-integration-20260922`. The final README bytes reviewed have SHA-256 **`c267cafd62a201e8695f3a113b241615e5d3e5386610670692f8f54b4461b333`**.

One limited clarity issue was corrected during the audit. The initial README, SHA-256 `8e0492cff8821424cae89567aeddca8112c729efa1c524611b28ff4fb9eb111d`, stated that the first persistent attempt failed at action 24,863. The supplied retained clock proves its failure and timing but contains no action count; the delivered narratives do not supply that count either. The operator confirmed it came from a contemporaneous observation whose result was later overwritten. The revised README at line 56 removes only that exact action count and retains the supported failure and attribution. I inspected the correction. No reconstructed receipt was added.

The 31 selected builder evidence files and five delivered narratives match the full pre-grade snapshot manifest by exact byte length and SHA-256, and match their repository copies. The transport archive's 31 non-AppleDouble files match as well. The 17 other copied launch/lifecycle/scorer receipts match their supplied local sources; the remaining selected file is the separately recorded passive host-contention observation. All 54 selected receipt bytes are bound below. The 239-entry authored-source manifest is an exact subset of the full manifest.

Recalculation of the full manifest yields 44,236 entries, 38,038 regular files and 3,488,349,291 logical file bytes, including the 700,481,536-byte stopped scale database. These match the custody receipt and README. The source-before/source-after/snapshot equality is the operator's recorded custody verification; this audit does not independently rehash the external full application archive. The README correctly distinguishes that external complete snapshot from the selected repository files. Its operator-authored links resolve; verbatim builder narrative links intentionally refer to the full packet.

The recovered `scale-resume1-clock.json` is present in the full snapshot and the selected copies with matching bytes. It preserves the failed 1790134391–1790134518 segment and 13,119 excluded probe milliseconds. The immediate `E_OFFLINE` retry and later successful resumed clock remain distinct. The final clock arithmetic reproduces 610 raw seconds, 70.046 excluded seconds, 539.954 replay seconds and an 893-second complete persistent span. The performance failure remains explicit: recomputing nearest-rank p95 from the actual 20-sample arrays yields search 3.524791 / 3.470875 / 2.609416 ms; the 50% interpolation threshold is 3.117958 ms and the midpoint fails. No host-contention cause, platform-defect cause or complete performance pass is inferred.

The filtered scorer call records contain 12 actual calls: three registry lookups and nine Node REPL calls using read-only file access or already-read strings. The root audit preserves those raw fields. Paths are the frozen brief, four permitted narratives, the attempted missing `run-record.json`, and four permitted application source files; the latter and their parent directories have regular-file/directory entries in the pre-grade manifest. The records show no grade, previous score, other lane or Snapback repository read, mutation, runtime test or network operation. The copied final score is 92 and its 13 numeric category/overall entries match the README and comparison receipt. Builder/scorer lifecycle and usage counters agree with their receipts, with internal builder timing kept separate from external wall time.

The missing `run-record.json` is correctly disclosed. The original M2 first-green suite entry is explicitly unrecovered; the other eight archive entries' hashes match the full manifest. The README attributes final M2 verification to the builder rather than replacing the missing historical artifact or anticipating the independent grade. All seven listed Hermes export identities match the full manifest, but these are export artifacts, not actual native execution evidence.

The three separately qualified native scenarios remain the cal16 extension. They do not fill cal17's native coverage or change either score. The corrective-release purpose, published-source boundary, unrun M7/other builder lanes, Node version correction, failed attempts and performance rule, provider/platform limits, and grade-pending status are preserved.

## Receipt bindings

The 54 selected repository files, excluding README.md, have aggregate SHA-256 **`96e3e5cea2b0467a90c5a141c8a06ff1571842898e7ecd7ac8b75139b6b33b64`**. The hashed UTF-8 input is one line per relative path in sorted path order: `path<TAB>decimal byte length<TAB>lowercase SHA-256<LF>`. No full external archive is included in that aggregate.

Key local input SHA-256 identities:

| Input under `/tmp/sb4-3011-20260922/cal17-record-inputs/` | SHA-256 |
| --- | --- |
| `lifecycle/builder-completed.snapshot.json` | `16f67bf0a8fcc6ec3805fa97a7b0231282affb34254223840664078b6d9730b3` |
| `lifecycle/builder-completed.custody.json` | `5eb37dde8c025df9790e233668b1d8aa31176e58db20b30fb5a2713fe3053d2e` |
| `lifecycle/builder-completed.authored-source.json` | `ed092966bbb5d4c7dc8b89e9027500fd19627c45c5a7e0f8c067faedddd682d1` |
| `lifecycle/builder-completed.narratives.json` | `161477e32b84275aeaabe4fd804e5bcc92fe7c9dc80cbcebab30876199e58141` |
| `builder-selected-verification.json` | `1d0c7872f60918623a9016fb55fb1829c512fa20d95f4200c864cc467379de1f` |
| `score/score-tool-audit.raw.json` | `e4b7ecfe37fc40129d203af6cb64aceb8597933a1b42570f915413f94997d3c7` |
| `score/score-tool-audit.json` | `7fa3c2b094433e4bfb93ccef8221ec1416e7e97ff2a9a4dee4fdcf68dce9a5aa` |
| `score/FINAL.md` | `6f3a4fdbffddd75bf8e0b481354ad306d47816ab1844fe70a6ee52c5dd363851` |
| `lifecycle/cal17-builder-usage.json` | `a745da5bdc1a422799775cc4d3c62633b80fc0f2a0ebcfd3b126b8287e44e872` |
| `builder/evidence/scale-resume1-clock.json` | `2caa31016e88c708add9880708b212f4aeea181e0e94b9e5aab6f538eb6febc2` |
| `builder/evidence/scale-performance-summary.json` | `a9d6ced0a942e593e1e43aab3b83dcfc91d6923e24253ec3cdbb0e55b8cabaaa` |
| `builder/evidence/suite-archive/index.json` | `3167c5945e95401da882d86312a20558869a00b7584bd7bed4004e5617ce9f18` |

Operator disposition: the review above is retained verbatim (received SHA-256 `0afefd91b8aaebcf1269c6b1a5f61a7ec93ef385536d632e8757bcab39eb6ecb`). The exact action-count clarification is incorporated. Final functional-grade and custody audit remain pending.
