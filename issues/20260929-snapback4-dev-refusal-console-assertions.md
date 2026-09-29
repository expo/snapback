# Dev refusal tests: assert counted console lines for asset and job refusals

Status: Open
Date: 2026-09-29
Systems: Snapback 4 dev server refusal diagnostics (lane DX, merged 2026-09-29)

Astra's confirmation review of lane DX round 1 (`~/sb4-intent/reviews/dx-r1.astra.md`
on eb1000) found a surviving mutation. Adding `&& record["code"] != "E_ASSET_UNKNOWN"`
to the writer's console guard suppresses every asset-refusal notice, while all
20 refusal process tests still pass. Suppressing records that carry a `jobId`
also passes.

The asset and job tests in `crates/snapback4/tests/dev_refusals/round3.rs`
(around lines 53 and 81) check persistence and the HTTP result, but not the
counted console line.

Fix: extend those tests to await the counted console line and assert its
operation, code, identity and count. The reviewer's added assertions detect
the mutation, and the landed implementation passes them.
