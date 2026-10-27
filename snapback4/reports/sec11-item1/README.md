# SEC11 item 1 evidence

This records the bounded item 1 delivery, not completion of SEC11 items 2–9.
The product code is `267c579701`; `d9734feab5` merges origin/main experiment
records without changing executable inputs. The production binary SHA-256 is
`9d432a5fed665c418cbed5aa26995811411ee46c10f09f9e5181139ce7924a95`.
A subsequent test-only correction removes an unsupported index declaration;
it changes no production behavior. No version bump or push occurred.

- `survey-all800.json.gz`: final actual schema-copy results, default output,
  fresh production deploy, `test`, and post-test production deploy. Authored
  JSONL fixtures only; no original stores, generated evidence or credentials
  copied. Binary snapshot and source hashes are retained.
- `coverage.json`: exact 41 calibrated M findings, before/after classifications.
  No unrelated question in the same lane counts. Text/list questions must name
  the exact column; two inherited type preventions are reported separately.
- `precision.json`: each gate/FIX matched to SEC10/Integration27 source-reviewed
  results. Unmatched results require manual classification, never assumed safe.
- `wave30-gate-assessments.json`: hand assessment of every wave30 gate.
- `cold-timing.json` and compressed rows: one worker, independent fresh copies
  for `check --review` and production deploy, after the full survey. Host load
  is recorded. Concurrent-survey timing is not isolated qualification.
- Scoped affected original/scoped plans and receipt: explicit exclusions. This
  does not claim the canonical six-crate/439-client pool completed. CLI targets
  are security unit modules plus dx11, dx11_refusals, dx13, security_reviews and
  security_wave19; the changed language crate runs its full target. Six relevant
  client files and Snapback4 docs/reference checks are included. The original
  receipt retains three stale assertion failures and inapplicable root legacy
  checks; the targeted assertion retry and explicit qualification composition
  record their resolution without inventing a full-pool PASS.
- `differential-summary.json`: 2k run has zero disagreements; 2k run-lean retains
  Integration27's 18 signature-matched disagreements. No clean Lean claim.
- Fix-forward lane033 patch and summary: final production binary clears the
  gate and the unchanged app acceptance script passes. Its raw log stays
  private outside the repository. Other hole-lane fix-forward work is deferred.

The original 800-schema baseline and original survey tooling live in
`../integration27/`. SEC10's post-test baseline is retained externally under
`~/sb4-loop/sec10-shipping-final-evidence/`. Raw SEC11 logs are under
`~/sb4-loop/reports/sec11/`; superseded/interrupted runs are not final evidence.

Reproduction from repository root (build from `snapback4/`):

```sh
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 cargo build -p snapback4 --profile production
python3 snapback4/reports/sec11-item1/tools/survey.py --binary /absolute/immutable/snapback4 --out /absolute/survey --waves 30,26,28,15,16,18,19,20,21,22,23,24,25,27,29 --default-output --workers 48 --check-timeout 180
python3 snapback4/reports/sec11-item1/tools/coverage.py --survey /absolute/survey/results.json --out /absolute/coverage.json
python3 snapback4/reports/sec11-item1/tools/precision.py --survey /absolute/survey/results.json --out /absolute/precision.json
python3 snapback4/reports/sec11-item1/tools/timing.py --binary /absolute/immutable/snapback4 --out /absolute/timing
node snapback4/reports/sec11-item1/tools/affected-scoped.mjs /absolute/affected-receipt-prefix
```

The schema survey expects the commissioned `~/sb4-loop/wave*/apps` evidence.
A clean tree is required for the scoped runner; add `--worktree` for local
edits and keep its inputs frozen during verification. All Cargo subprocesses
receive incremental/debug-off environment values through the selector.

The final cold p90s are **25.14 s review / 32.83 s deploy**, missing both targets.
All 800 fresh/post-test verdicts match the retained baselines; zero assessed
false gates or production refusals. Default output medians are 3/5 lines.
Exact wave30 visibility is 4/14 (one gate, three questions), up from 1/14.
The remaining work is explicit in the root WORKSTREAM-REPORT.md.

`run-history-retry.py` / `.mjs` retain the exact snapshot retry at
`0dd5622566` against prior `58f30f47f0`; they deliberately assert that only the
history test changed. Use those frozen refs for that historical reproduction.
The current general scoped runner excludes the root Snapback1 generated,
guide and inventory checks under the Snapback4 fence. Product guides are
covered by language tests, two client guide files and packaged-doc lint.
