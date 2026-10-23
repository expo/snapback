# SEC9 workstream — progress checkpoint

Branch `sb4-b25-sec9`, SEC8 base `3361d0e47d`; no push or version bump. Merged origin/main `901a362705` at `ca8ea5efd9`. Integration owns Mac and publication; DX8 owns the friction list.

Implemented S1–S8 across commits `e5ea853117`, `44e804e805`, `0fcff18637`, `5af2d3d501`, `9b4bceb09e` (device omission experiment subsequently withdrawn), `456083755b`, `f4144b0bbb`, `002a911ff1`, `43f7c1619d`, `7f19df4a79`.

- S1: inline column write audience for insert/update/upsert, old/new admission, completed sequence values, hidden-cell opacity, raw schema validation, actual generated write contracts and outside-role/write-arm tests.
- S2: create/edit review gates, table and conditional guards, creator substitutions, explicit matching update-only intent. Removed attributed-creator and unrelated-unchanged-field false gates.
- S3: five lookup hygiene codes demoted; write authority priority 3, structural retention test.
- S4: rule-bound derived contracts, actual replay, 10s/8192-work production campaign refusing reachable FIX; individual derived acknowledgments cannot waive authored/enforced failures. Full selected schema/program/invariant comparison.
- S5: conditional immutable fields enforced at store writes/import replacement and tested on preimage, null omission, trusted system, hidden targets and live parent status; explicit trusted persistence restoration remains outside the mutation boundary.
- S6: per-step clocks, typed cross-row/read-through/aggregate element evaluator, role-compatible principal tuples, pending-child setup ordering, distinct image samples, explicit optional missing alternatives.
- S7/S8: first-successful-check presence baseline and independent production release comparison; explicit optional intent; complete only-X-save-while-Y-missing and write/freeze recipe. Guide changes entry targets 0.4.41.

RFC `llp/3000.036.004.000-structural-write-authority.rfc.md`. Review rounds 1–3 found and repaired concrete defects. Both round 4 READY. Round 5 found live-reference reflexivity unknown erasure; fixed. Both round 6 READY. Round 7 reviews final missing-evidence proposal ordering; pending at this checkpoint. Verbatim logs/provenance under llp/reviews (gzip retains exact bytes).

Validation so far: packed security test 3/3 passed in 806s; root generated artifacts passed after a bounded first timeout; root inventories pass; root guide 22/22 pass; ref-check 566 docs/12388 refs, zero errors. Wasm 2414852 raw /737825 gzip; budget738325 with same-commit journal and rationale. Full Rust/client campaigns are running; inherited metadata failures and repaired SEC9 expectation failures must be reported separately. Full model pool and fresh-pack Linux consumer qualification remain pending. Mac deliberately skipped.

Corpus baseline: SEC8 450 projects, 15 gated projects/36 retained-role sites. Penultimate SEC9 run (before final missing-value ordering): 450 projects, 32 gated projects; 21 create/edit +1 private-create/edit +36 retained-role sites; 38 production refusals. These are observed counts, not yet an independently certified zero-false claim. Wave25 after false-positive corrections: 3 new gated lanes (015,017,045), 5 production refusals (three pending gates, two authored roles.read contradictions). Initial mistakenly broad run has500 projects; never report it as450. Final fresh-source campaign pending.

Full finding matrix is retained under reports/20261023-sec9/final/findings. One-line spec witnesses: 007F2=104,008F1=6,011F1=4,013F1=16,015F1=10,015F2=0,016F1=10,029F1=0 with the original broad always intent (the correct update-only edit boundary needs the separate replay),031F1=1,033F1=11,036F1=29,036F2=1,048F1=2,w25-015F3=2,w25-036F2=1,w25-043F1=0 before final missing-value correction. The inspection regression now reaches the exact policy-false scheduled transition; full final CLI replay pending.

No mathematical all-app zero-hole guarantee is claimed from finite exploration. Remaining coverage limits, inherited failures and qualification failures must stay explicit in the final report.
