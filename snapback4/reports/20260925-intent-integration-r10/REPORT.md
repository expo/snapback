# Intent integration round 10 — 0.4.2 candidate

2026-09-25. Branch `sb4-intent/integration-042b`, starting from round 9
`22dd0c466`. The two requested exact heads were merged, each without
fast-forward, in order:

| Lane | Requested head | Merge |
|---|---|---|
| U | `e58b83c4e` | `d0717cc30` |
| V | `54eca743a` | `b87ed10bb` |

No push, publication or version bump. The final evidence commit adds only this
report directory and one journal entry after the tested code head `b87ed10bb`.

## Context and constraints

The llp-orient scope is query publication, issued/estimated clocks, retained
row composition and terminal receipt recovery. Governing constraints are
[LLP 3000.016 §2.2](../../../llp/3000.016-following-on-a-bounded-device.rfc.md#22-device-reads),
[LLP 3000.014 §5](../../../llp/3000.014-a-child-reads-through-its-parent.rfc.md#5-what-derives-from-the-capture)
and [LLP 3000.013 §6](../../../llp/3000.013-quarry-states-intent.rfc.md#6-a-paved-client).
All three governing documents and the Snapback 4 root LLP are linked in
`llp/current/`; this integration applies the requested revisions without
reopening their design. The current client forms are recorded in
[CLIENT-AND-OPERATIONS.md](../../packages/snapback4/CLIENT-AND-OPERATIONS.md).
The round-9 publication/session/binding fences remain in force. The main merge
risk is reintroducing wall time for device or server deadlines, or skipping
those fences after the bounded retry. Receipt correction is limited to the
matching positive outbox acknowledgement established in the device transaction.
No new design question or LLP hand-off is needed; the lanes supply the narrow
contract updates and this integration records its resolutions in the journal.

## Files and resolutions

Paths are relative to `snapback4/` except the governing LLP.

| File | Integrated result |
|---|---|
| `packages/snapback4/src/local-query.ts` | U's first observation and single expiry retry share `routeLocal`; each external candidate crosses the publication fence, and only accepted server answers enter memory. Keep round 9's issued clock for local expiry, estimated server clock for server/memory expiry, separate deadline fields, T's source-provenance composition and clamped wall-time `since`. Local/server expiry leaves independent unexpired memory intact. |
| `packages/snapback4/test/prediction-routing.test.mjs` | Keep all round-9 and U tests; adapt the remembered-answer deadline assertion to the separate server deadline. Add three combined expiry-retry/read-through cases: successful composition, issued expiry and server expiry. |
| `packages/snapback4/test/retained-history.test.mjs` | Keep all old and six new U device cases. Extract round 9's actual client-clock-fork calibration into a shared helper and use it in the new branch/page cases; advance the captured clock rather than mocking Date.now after its capture. The deliberate +5 ms sample remains. |
| `packages/snapback4/src/writes.ts` | Import V's acknowledgement-first selection and replacement-refusal repair. |
| `packages/snapback4/src/local-receipts.ts` | Use acknowledgement evidence before terminal-history lookup and settlement. |
| `packages/snapback4/src/local.ts` | Apply that selection in flush, send preflight and write lookup; preserve round-9 binding, session authority and clock integration. |
| `crates/snapback4-device/src/device/store_identity.rs` | Correct an existing replacement-refusal receipt only when an individual sent receipt matches the transaction's outbox sequence; keep its place in the receipt window. |
| `crates/snapback4-device/tests/write_authority.rs` | Keep V's memory/SQLite matching, missing/mismatched acknowledgement, authored-refusal and reopen coverage. |
| `packages/snapback4/test/acquisition.test.mjs` | Keep V's failed-save replacement refusal versus acknowledgement regression. |
| `packages/snapback4/test/web-admission-review.test.mjs` | Keep V's real-browser acknowledgement repair and receipt-rewind interleavings. |
| `packages/snapback4/test/client-seams.test.mjs` | Keep V's deterministic lost-response HTTP replay test. |
| `packages/snapback4/CLIENT-AND-OPERATIONS.md`, `../llp/3000.013-quarry-states-intent.rfc.md` | Retain both lanes' retry routing and narrow acknowledged-receipt contract changes. |
| `JOURNAL.md` | Preserve all prior bytes, append each lane's new entry while merging, then append one integration entry. |
| `reports/20260925-bounded-following-r10/`, `reports/20260925-lane-v-r10.md`, `reports/20260925-lane-v-r10-evidence/` | Preserve the lanes' review-round reports and evidence. |
| `reports/20260925-intent-integration-r10/` | This report and compressed integration verification logs. |

## Forms and tests

No new language form, refusal code or public API. The merged tests exercise
`query expiryBranch()` switching from an expired local permit to an online-only
source, and `query expiryPage(c: cursor ?)` retaining its continuation after
the retry. `await client.write(id)` returns the original acknowledged
`{ state: "sent", id, seq, replayed: true }` across replacement-refusal repair
and reopen. Authored refusals keep their prior behavior.

The three new integration regressions require one expiry retry plus the
ordinary retained-composition observation. They assert source-identity pairing,
incomplete/nonfresh composition, independent local/server deadlines, no memory
entry for composed history, and a dirty watch after either deadline expires.
The valid server answer has a deadline earlier than issued device time but
later than estimated server time, so using the wrong clock fails the test.

Focused results: **140 routing tests**, **eight round-9 expiry/permit cases**,
and **six new real-device branch/watch/cursor cases** passed, with zero failures
or skips. Package typecheck and build passed. The full suite rebuilds and tests
V's changed device receipt writer on the integrated artifact.

## Full qualification

One full run, exit 0: **`== 0 failure(s) in 647 s`**.

- Rust group: 190 s; target summaries total 3,195 passed, zero failed and 19
  existing ignored tests.
- Client group: 193 s; 1,974 tests, 1,964 passed, zero failed, zero cancelled
  and ten existing skips.
- Models: 240 s; all 78 tests passed. Online and local session models each ran
  5,000 seeded sequences; online publication ran 3,000 seeded interleavings.
- Reference check: `ref-check: ok — 509 LLP docs, 9337 refs in 26498 files,
  0 errors, 0 unchecked`.
- All 83 guide tests and eight device write-authority tests passed inside the
  full Rust group. There were no integration test failures, intermittent reruns,
  baseline exemptions or environmental exemptions in this round.

Logs: [full suite](full-suite.log.gz), [routing](routing.log.gz),
[round-9 expiry cases](retained.log.gz), [new device retry cases](retry-device.log.gz)
and [reference check](ref.log.gz).

Command from `snapback4/`:

```sh
export PATH=$HOME/.local/bin:$HOME/.cargo/bin:$PATH
CARGO_BUILD_JOBS=16 SNAPBACK4_RUST_TEST_PROCESSES=8 SNAPBACK4_TEST_SERIAL_CLIENT_FILES=0 SNAPBACK4_SESSION_SEQUENCES=5000 SNAPBACK4_ONLINE_SEQUENCES=3000 bash scripts/test.sh
```

The rebuilt web artifact measures **1,850,576 B raw / 521,814 B gzip**, within
the unchanged **522,000 B** ratchet (186 B headroom). Relative to round 9:
+850 raw / +282 gzip bytes, a whole-artifact comparison. No runtime meter
ceiling changed. Changed source files stay below 1,500 lines; the largest is
`local.ts` at 1,423 lines.

The provided baseline tail was read (`== 1 failure(s) in 276 s`, cargo test).
No baseline failure recurred and no failure was waived. No inventory remeasurement is
needed for this retry/receipt follow-up; round-9 measurements remain historical.

## Scope and open problems

No design deviation or stopped part. The resolution choices adapt U's pre-Y
fixtures and router changes to the already integrated two-clock contract.
No source/slot/storage layout, authorization rule or public API was changed
beyond the requested narrow receipt repair. No new skip, reduced model count,
timeout increase, push or publication occurred.

U's existing whole-page remembered-expiry limitation remains unchanged:
remember a page containing a permanent row and a typing row expiring at T,
then query offline at T; the remembered answer's earliest deadline withdraws
the whole page. U records the deferred ticket as
`issues/20260925-snapback4-remembered-answer-row-expiry.md` on origin/main.
This round preserves independent memory only while its own deadline is valid.
No new unresolved integration defect is known after full qualification.
