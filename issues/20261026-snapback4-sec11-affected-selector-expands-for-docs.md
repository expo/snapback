# Snapback 4 affected docs selection expands SEC11 to full pools

Status: Open
Date: 2026-10-26
Scope: Snapback 4 affected selector

SEC11 changes CLI witness decisions, one language campaign read-history record,
security guide prose, and the commissioned 0.4.44 guide-changes entry.
`node snapback4/scripts/affected.mjs --base origin/main --worktree --json`
selects six whole Rust crates and 439 client files (`broad: false`). The guide
path adds the conservative docs-consumer pool; the reverse dependency closure
also includes otherwise untouched core/device/simulator crates.

The workstream brief explicitly prohibits the full five-crate suite and full
client pool, while also requesting the affected selector. SEC11 retains the
original plan and runs a disclosed affected subset for the changed crates and
security/guide consumers; it does not label the original broad plan complete.
Integration owns the remaining broad coverage.

Follow-up: narrow docs-consumer evidence and distinguish semantic dependency
changes from campaign-history-only changes so ordinary security work does not
select the complete client/runtime battery. Do not remove genuine dependencies
just to make a plan smaller.
