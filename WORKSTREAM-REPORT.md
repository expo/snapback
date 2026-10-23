# SEC9 workstream report (in progress)

Branch `sb4-b25-sec9`, based on SEC8 `3361d0e47d`. No push or version bump.

Read SEC8's report; wave-25 day-two bakeoff in full; wave-24 §§2/6; Snapback 4 fence, root LLP and security amendment. `llp-orient` scope: column declaration/binding, core write admission/constraints, security advice/campaigns, deploy/check and tested guide. Governing contracts: LLP 3000.036 §22, LLP 3000.015 §1, LLP 3000.036.004 §§3/4/15–17. SEC9 semantics are drafted in LLP 3000.036.004.000.

## Changes

- S1/S5: `e5ea853117` adds column write audiences and conditional freezing, capability fencing, raw validation and initial adversarial coverage (3 tests passed). Review hardening is in progress.
- S2/S3: exact table changed-column extraction, explicit update-only disposition, column-write enforcement exemption and authority-before-hygiene presentation are implemented; focused verification in progress.
- S4: derived candidate contracts, unique rule identities, bounded deploy campaign, rule-bound acknowledgment path and separate authored-refutation handling are implemented; measurement in progress.
- S6: concrete clock/arithmetic/reference/read-through evaluation and actual-clock write tracing, plus bounded schedule-boundary history candidates are implemented; verification in progress.
- S7/S8: successful-check presence baseline, independent release comparison, explicit null/presence intent and complete column/save-while-missing recipe implemented; packed verification pending.

## Reviews

Round 1 Muse and fresh Codex: NOT READY. Both verbatim logs and provenance under `llp/reviews/3000.036.004.000-sec9-r1-*`. Blockers are being addressed; no final READY claim. Muse plan quota failed and its approved Meta fallback completed.

## Verification

Setup frozen Bun install, native build, wasm build and client build completed. Initial wasm 734,863 / 735,388 gzip bytes (inherited source). Initial column-write suite: 3 passed. Initial guide extended run: 124 passed, 3 editorial failures; fixes pending verification. All commands use bounded timeout and Cargo's three required profile flags.

Mac runs skipped by instruction: Studio unreachable; black M5 reserved for publication. Integration owns Mac qualification. DX8 owns backfill/down semantics, process hygiene, dev clock, sql, account helper and rename-down. Integration owns rollback_views.rs, release_bridge* and rollback_visibility.rs; none touched.

## Remaining

Final dual READY review; exact finding/corpus measurement; full Rust/client/differential/packed/Linux/wasm/root checks; merge origin/main; cleanup and final report. No security or publication qualification claim is made while these remain open.
