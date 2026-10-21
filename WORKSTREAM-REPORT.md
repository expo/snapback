# SEC6 workstream report

Worktree `/home/ccheever/projects/sb4-b21-sec6`, branch `sb4-b21-sec6`.
Implemented and committed in small steps as Charlie Cheever. No push and no
version bump. User-visible guide changes target **0.4.37**. All requested SEC6 work is implemented and
qualified; compressed evidence and original attempts are retained below.

## Changes by item

1. **Write intent at insert.** Host-only opt-in fixture instrumentation judges
   every actually executed insert, update and delete in a committed authored
   mutation, including intermediate writes and both upsert arms. Independent
   column write intent applies to creation. Rollbacks, unchanged sibling fields,
   engine expiry and invented snapshot populations never become reachable
   refutations. N_INSERT_WRITE_INTENT reviews creation paths that lack an edit
   restriction; generated drafts ask the creation question. Permanent tests cover
   multi-write restoration, rollback, upsert/collision/delete identity, expiry
   coverage, and the real 048 non-null instructor goal insertion.
2. **Projection-only privacy.** N_COLUMN_RESULT_EXPOSURE traces protected or
   projection-omitted columns to other query returns, write results, explicit
   returns and authored refusals. Campaigns inspect compiler-typed committed
   mutation payloads, including nested rows, with row-policy image and external
   dependency stability checks. Saved pre-transition images remain uncovered
   rather than being falsely judged under later policy. The real 040 regression
   requires stored ticket-code disclosure after requestCar → takeRetrieval;
   insertion echoes alone do not satisfy that regression. Three existing
   query-coupling controls return `{id}` so their independent-world query purpose
   remains isolated; a separate regression explicitly checks the old full-row
   insertion echo as an observation. Both reviewers accepted this actual-output
   intent doctrine; no caller-echo exemption or weakened privacy claim is added.
3. **Rule-changing deploy review.** deploy and deploy --check prominently print
   FIX/REVIEW items, every advisory note, and the last test result/time/age with
   stale, missing and incomplete labels. --strict refuses reachable refuted
   intent before preview/activation; unproved, advisory and synthetic-only
   evidence stays nonfatal. Persisted evidence timestamps are outside its source
   fingerprint. Same selected-source fixture resolver is used for the report
   and narration. CLI tests exercise strict preview and activation, retained
   failures and dated/stale/incomplete records.
4. **Supplied client sessions.** Online/local constructors validate a complete
   supplied Session before transport/storage/device/timer effects and issue
   credential-free E_SESSION repair guidance. They freeze a private primitive
   copy, preserving legacy scope-less sessions and explicitly undefined optional
   properties. Expiration authority remains with the server. Packed SDK proof
   and Linux/Mac tests cover malformed values, zero effects and caller mutation.
5. **Measurement.** The table below comes from clean disposable copies containing
   only frozen Quarry sources. No prior test records, generated caches or stores
   are copied. Original wave apps remain read-only. Each primary experiment adds
   exactly one independent spec-worded invariant. All seven are flagged without
   invariants and caught by full `test --all` with that invariant. Counts are
   witnesses, not vulnerability counts.

| Wave-21 lane | Specific no-invariant review | Actual generated-fixture witness |
|---|---|---|
| 001 | N_ROLE_WIDE_READ, apprentice audience | 60 estimatesFor reads |
| 006 | N_SELF_CLAIMED_RELATIONSHIP, claimChild | 16 claimChild updates |
| 023 | N_ROLE_WIDE_READ, protected columns | 22 myApplications credit-report observations |
| 033 | N_ROLE_WIDE_READ, crew/lifecycle | 76 jobBoard reads |
| 036 | N_ROLE_WIDE_READ, sharpener/lifecycle | 2 incidentsFor reads after transitions |
| 040 | N_COLUMN_RESULT_EXPOSURE, ticketCode | 2 stored-code takeRetrieval results after requestCar; 21 insertion echoes retained separately |
| 048 | N_INSERT_WRITE_INTENT, addRider/riderGoals | 3 non-null instructor inserts; 1 null-supply witness retained separately |

These are the seven reported-high lanes. The bakeoff calibration is retained:
006 and the carried-over 048 roster finding are High; 001/033/036/040/048 F1 are
Medium; 023 is debatable. No severity promotion is inferred from a counterexample.

The earlier carried-over 048 roster finding is separately caught with one read
invariant: 63 riderDetail generated-fixture reads. This experiment is not folded
into the primary creation count. SEC5's relationship/lifecycle work is preserved
and its two newly exposed creation/result gaps are covered. Unsupported temporal
intent from SEC5 (025 monotonicity and 001 consent sequencing) is not relabeled
as proved or supported by this workstream.

**False-refusal census:** frozen 350 apps / 358 Quarry files from waves 15, 16, 18–21.
Published 0.4.35 baseline: 350/350 checks pass. Final candidate as written: 350/350;
final invariant-stripped candidate: 350/350. Zero new refusals. Source manifests,
binary digests, complete parsed note/verdict results and reproducible runners
are retained in `snapback4/reports/20261021-sec6/` after packaging. Finite tests
and notes do not certify all possible application behavior.

## Commits and design review

- a43315b1c9: supplied session validation/snapshot.
- 9f4ce8917a: executed-write instrumentation, typed result privacy and advice.
- 86b72e5e16: prominent deploy review and dated test evidence.
- 5ea9ae538c: synthetic populations cannot become reachable evidence.
- 3d3e81fc6c: alternate query/refusal projection review.
- 6c4b15b4f9,3d0be40a73: focused non-null write-argument challenges.
- a13f1480c9,8b69eddf4a: uncapped security actions in short check output.
- de09d5be0e: optional session property compatibility/await classification.
- 6e76412199,c561630193: dedicated executable diagnostic definitions and guide budget.
- 860dc75c35,4578e98bed: expiry coverage, original-first nullable population
  sampling, compact takeover regression and strict CLI deployment tests.

Semantic amendment: LLP 3000.036.004 §15. Muse contributor and fresh Codex
GPT-6.1 high-effort reviews used the user's exact commands. R1/R2 concerns led to
clock/image stability, selected fixture consistency, caller-output doctrine and
failure-origin fixes. R3 and R4 both READY. R5 Muse READY / Codex NOT READY found
focused alternatives displaced original null creation before population saturation.
4578e98bed corrects the order; R6 **both READY**. Verbatim compressed responses,
briefs, exact invocations and decompressed SHA256 values are under `llp/reviews/`
and indexed by `3000.036.004-sec6-review-record.md`. Reviews are static readiness,
not fabricated qualification receipts or author acceptance.

Dependency decision: origin/main had not integrated 0.4.36, so reviewed SEC5
f225b0bc69 was merged locally in 1c7cafda9c to complete combined coverage instead
of duplicating its changes. The final refresh (2026-10-21 11:42 UTC) points to 1c3e742784,
which still declares 0.4.35; 0.4.36 has not landed, so its conditional rebase is not
applicable yet. S8 owns the later raw-store facade integration. EVOL owns
adoption/migrations/rollback; its one-line guide-change pointer is retained.

## Verification

- Final SEC6 Linux: 12/12 pass; final CLI security: 11/11 pass, including strict
  preview/activation. Designated Mac Studio: 12/12 SEC6, 2/2 evidence-record and
  18/18 session tests pass. Only `~/sb4-ws-sec6` was used; publication Mac untouched.
- Full client pool: 423/423 files executed; original run 7,703 pass / 54 fail / 56 skip,
  five red files retained. Repairs/build-precondition reruns: 5 files, 590/590 pass.
  Background retention drain timeout passes unchanged in isolation. Both seeded
  client models: 81/81 pass. No original red is relabeled as a full green run.
- Full seven-crate Rust inventory covers the requested five crates: 441 binaries,
  1159 executions plus workspace doctests. Earlier overlapping build captured
  the pre-correction nullable regression; its corrected 12-case suite passes.
  The frozen complete run passes: 7,234 tests, zero failures, 47 ignored across
  1,159 executions plus successful workspace doctests.
- Difftest run: 20,000 cases, 1,222,111 executions, zero signatures. Devices seeds 0–999:
  1000 cases, 27,922 executions, zero signatures. Lean 20,000: 130 disagreements in
  exactly SEC5's four existing signatures (3/35/67/25), no new signatures; Lean build passes.
- Fresh client/expo tarballs prepared from 4578e98bed; wasm 2,404,746 raw / 733,718 gzip
  bytes <=734,193 budget. Wasm budget helper tests: 2/2. Fresh Linux musl packed
  consumer qualification passes Ubuntu 24.04 and Alpine via proot, including all
  frontend/starter proofs and the installed SEC6 security examples. The initial
  attempt failed on shared npm-cache ENOENT; its owned-private-cache retry passes.
  It uses `--consumer-only` because the user
  forbids full scripts/test.sh; the full source suites run independently. No
  publication-qualified receipt or actual publication is claimed.
- Root frozen install/hoist/generated/inventories/guide checks passed in the
  original run (guide 22 passed, 0 failed, 162 pages / 1937 snippets, 121 existing warnings).
  Final ref-check: 564 LLPs / 12227 refs, zero errors; docs README 319/320. All final root checks pass, including the
  1,200-second-budget generated-artifact
  repetition, standalone inventory and guide checks. The earlier chained repeat
  stopped at its 120-second inventory budget after generated checks had succeeded.
  Root source is unchanged.

All shell invocations are timeout-bounded; Cargo commands disable incremental
and dev/test debug artifacts. Earlier failures and timing/build-precondition
attempts remain in compressed evidence. Owned build outputs, installed consumer
trees, private npm cache and test scratch are removed after receipts are saved. No SEC6 implementation item is
deferred. The 0.4.36 conditional rebase is not applicable at the final fetch;
origin/main still declares 0.4.35. No publication qualification or universal
security claim is made.
