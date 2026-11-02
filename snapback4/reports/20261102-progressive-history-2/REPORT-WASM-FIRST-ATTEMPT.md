# 2026-11-02 — Progressive history, chunk 2: stopped at wasm budget

**Chunk 2 is not implemented.** The required wasm rebuild exceeded the existing
budget. The user explicitly instructed: “If it exceeds, report the number and
STOP — do not raise the budget yourself.” I ran this prerequisite early, before
editing the TypeScript client, and stopped implementation when its result arrived.
The remaining deliverables and their tests are not claimed complete.

## Result

From `snapback4/`:

```sh
PATH=/Users/ccheever/.volta/bin:$PATH bash scripts/build-wasm.sh
```

Exit **1**. Verbatim final output:

```text
wasm 2440792 B raw, 746060 B gzip (budget 739004: OVER by 7056 B — issues/20260913-snapback4-wasm-device-diet.md)
wasm budget: the web device exceeds metrics/wasm-budget.json. A landing that needs the bytes raises the budget in the same commit, with the reason in its why, the commit message and the journal (LLP 3000.002; issues/20260913-snapback4-wasm-device-diet.md).
```

The optimizer reported:

```text
Binaryen 132.0.0 (locked workspace dependency)
```

The artifact is **2,440,792 B raw / 746,060 B gzip**. The existing limit is
**739,004 B gzip**, so the overrun is **7,056 B**. This is a whole-artifact
measurement of the inherited tree, with no chunk 2 source changes; it does not
attribute bytes to a particular prior change. The shell used Volta on PATH.
No separate Node-version command was run.

## What changed

Paths are relative to `snapback4/`.

| File:line | Change |
| --- | --- |
| `reports/20261102-progressive-history-2/REPORT.md:1` | This stop report. |
| `reports/20261102-progressive-history-2/COMMANDS.json:1` | Exact command ledger, working directories, observed exit codes, and summaries. |
| `reports/20261102-progressive-history-2/wasm-build-summary.log:1` | Verbatim optimizer and final size/refusal lines. |

The build regenerated ignored device outputs under
`packages/snapback4/src/wasm/` and Cargo build outputs. Those generated artifacts
failed the budget gate and are not qualified for publication. No client, Rust,
guide, README, JOURNAL, LLP source, budget, or contract edits were made.
Before creating this report, `git status --short -- snapback4 llp` printed
nothing; the budget/contract diff check also printed nothing and exited 0.

No agents, clones, remote commands, other checkouts, commits, stashes, restores,
rebases, pushes, dependency installs, or budget changes were used.

## Inspection and handoff

Applied the read-only `llp-orient` workflow to the client acquisition seam.
The governing design is LLP 3000.001.001 revision 1, especially §§4–9, with
parent Repairs A and B, the Snapback 4 instructions, exclusion list, and sync
guide. Read both prior chunk reports and inspected their actual server/device
types before using the handoff.

Verified integration facts relevant to the next attempt:

- `crates/snapback4-device/src/device.rs:87`: `SyncState` exposes
  `acquisition_cursor`, `acquisition_exhausted`, `acquired_tables`,
  `floored_groups`, and `replacement_required`. The cursor is optional;
  exhaustion is separately exposed. Negotiation must check this device seam
  as well as the server's advertised capability.
- `crates/snapback4-core/src/partition/acquire.rs:21`: response progress
  includes `unit`, `cursor`, `exhausted`, `whole_tables`, optional
  `hint_ignored`, and `skipped`. The server bounds the skip list at 32
  and enforces a normal walk step between out-of-order priority units.
- `packages/snapback4/src/local.ts:725`: the existing sync loop owns
  snapshot continuation, ordinary drain, overflow recovery, and adoption.
  It currently refreshes acquisition status after the round. Progressive
  integration must notify from durable published state after each unit and
  preserve the existing restore-refusal halt and staged replacement.
- `packages/snapback4/src/query-dependencies.ts:6`: `dependencies()`
  exposes table/field footprints, not an argument-to-audience extraction
  plan. `backend.ts` exposes compiled program bodies, and the Rust Scan
  type carries index and prefix facts; no hint extraction was implemented
  or validated.
- `packages/snapback4/src/acquisition.ts:5`: the existing progress type
  has `acquired`, `rows`, and `tables`, with no `usable` field.
  `react.tsx:504` reads that source through `useSyncExternalStore`.
- `packages/snapback4/src/local.ts` already exceeds 1,500 lines in the
  inherited tree (inspection reached line 2018). A future edit must split
  it to satisfy this chunk's line limit; no split was attempted here.

Code versus RFC description: as the chunk 1b report records, the pre-existing
device also permits legacy terminal ordinary-page acquisition, not only staged
snapshot completion as RFC §2 describes. This makes selecting progressive
acquisition before such a cold ordinary terminal page important. No new
behavioral discrepancy was tested in this stopped chunk.

The one-watermark, published-only coverage, current-image/Repair B, global
prediction gate, and staged-replacement constraints remain the required
implementation boundaries. No new decision or LLP number was introduced.

## Commands and validation limits

[COMMANDS.json](COMMANDS.json) records **all 29 directly invoked shell commands**,
including exact multiline inspection commands. Inspection commands have no
independent test verdict or summary line; the ledger says so instead of
inventing one. The build's verbatim summary is above and in
[wasm-build-summary.log](wasm-build-summary.log). Session polls continue the build
command; they are not additional commands. An intermediate compiler-warning
tool response was truncated, so the summary log is explicitly not a full
build transcript. Patch-tool report creation is represented by the files above.

Not run after the explicit budget stop:

- Client implementation, module split, foreground hints, negotiation,
  progressive scheduling, progress type/hook changes.
- New `progressive-acquisition.test.mjs` or its process and wasm/memory
  witnesses; no new test file was authored.
- `acquisition.test.mjs`, `ordinary-history.test.mjs`,
  `retained-history*.test.mjs`, and `progressive-start.test.mjs`.
- `bun run --cwd packages/snapback4 typecheck`.
- `node scripts/affected.mjs --base origin/main --worktree --run`.
  The explicit budget STOP took precedence; no affected receipt or pass
  is claimed.
- `react.test.mjs` and `witness/idb.mjs`: **not run (sandbox)**, per
  the supplied SIGABRT limitation; supervisor verification remains required.
- No loopback suite was run, so no loopback failure or retry occurred.

## Open work

The supervisor must resolve the wasm budget stop before this chunk resumes.
The budget was not raised, and no size-reduction work outside the assigned
client chunk was attempted. All chunk 2 implementation and functional
verification remain outstanding. No performance, browser persistence,
compatibility, or publication claim is made.

Stopped after this report. The supervisor owns committing and further work.
