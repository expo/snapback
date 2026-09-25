# Intent integration round 11 — refusal-safe acknowledgements

2026-09-25. Branch `sb4-intent/integration-042b`, starting at `4126e145a`.
Merged the exact requested V head `9a96e042e` with `--no-ff` in `78ec322cf`.
The implementation is V's `7df63b7d1`. No push, publication or version bump.

## Context and resolution

The llp-orient scope is server acknowledgement lookup and client terminal
receipt custody. Governing contract:
[LLP 3000.013 §6](../../../llp/3000.013-quarry-states-intent.rfc.md#6-a-paved-client),
linked in `llp/current/`, under the existing Snapback 4 root LLP. The current
surface is [CLIENT-AND-OPERATIONS.md](../../packages/snapback4/CLIENT-AND-OPERATIONS.md).
Idempotency storage includes refused outcomes, so row existence is not proof
of successful execution. Known authored refusals must survive old
acknowledgement data; positive success still repairs an unknown-outcome
replacement refusal. These are the binding constraints and rationale from
LLP 3000.013 §6. No open design question or LLP hand-off was needed. V supplies
the contract update; this integration adds its qualification journal entry.

All source, test and contract changes merged cleanly. The only conflict was
`JOURNAL.md`, resolved by retaining the complete integration journal and
appending exactly V's new entry. Earlier clock, routing, retained-history,
store-binding and admission fixes remain intact. No integration-specific code
or test change was necessary.

## Files and behavior

Paths are relative to `snapback4/` except the governing LLP.

| File | Change |
|---|---|
| `crates/snapback4-core/src/engine/mod.rs` | Both `acknowledged` and `committed_above` accept only stored `sent` outcomes; existing principal, pending-ID and watermark bounds remain. |
| `packages/snapback4/src/writes.ts` | A known non-replacement refusal wins over legacy acknowledgement evidence without persisting success. |
| `packages/snapback4/src/local.ts` | Final send preflight returns the guarded recovered receipt rather than the original apparent success. |
| `crates/snapback4-core/tests/stream_receipts.rs` | Exercise actual successful/refused mutations, durable refusal replay and the event-cut/image-head acknowledgement split. |
| `packages/snapback4/test/acquisition.test.mjs` | Require a known `NOT_ADMIN` refusal to survive legacy acknowledgement lookup with zero success saves. |
| `packages/snapback4/test/web-admission-review.test.mjs` | Add real-browser lost-refusal-response, legacy acknowledged-refusal and sent-sequence-only durable repair cases, plus two negative-control variants. |
| `packages/snapback4/CLIENT-AND-OPERATIONS.md`, `../llp/3000.013-quarry-states-intent.rfc.md` | Record that refusal idempotency is not success evidence and known authored refusals take precedence over legacy acknowledgements. |
| `JOURNAL.md` | Append V's entry during the merge and one integration qualification entry afterward. |
| `reports/20260925-lane-v-r11.md`, `reports/20260925-lane-v-r11-evidence/` | Preserve V's supplied report and evidence verbatim. |
| `reports/20260925-intent-integration-r11/` | This report and compressed full-suite/reference evidence. |

No new syntax, API or diagnostic. Existing `await app.mutate(ops.remove, args,
{ id })` and `await app.client.write(id)` preserve `failed` / `NOT_ADMIN`
after a lost response, sync and reopen. A matching successful outbox sequence
still repairs `E_STORE_REPLACED` to `{ state: "sent", id, seq, replayed: true }`.
The new lookup-only browser test proves that repair is durable before flushing,
then survives removal of the outbox and an offline reopen.

The imported core, unit and three browser regressions are exercised by the
full integrated suite. No additional integration regression was needed because
there was no source conflict or new implementation choice. V's intentional
old-server and faulty-client controls remain in its evidence; they are not
failures of this integration run.

## Qualification

One full run, exit 0: **`== 0 failure(s) in 726 s`**.

- Rust group: 246 s; target summaries total 3,196 passed, zero failed and 19
  existing ignored tests. Both stream-receipts tests and all 83 guide tests pass.
- Client group: 194 s; 1,978 tests, 1,968 passed, zero failed, zero cancelled
  and ten existing skips. All three new browser cases pass on the integrated
  server/client, along with every earlier integration regression.
- Models: 241 s; all 78 tests pass. Online and local session models each run
  5,000 seeded sequences; online publication runs 3,000 seeded interleavings.
- No integration test failed, no intermittent rerun was needed, and no baseline
  or environmental exemption was used.

[Full-suite evidence](full-suite.log.gz). Tested code head: `78ec322cf`;
the following qualification commit changes only this report directory and
appends the integration journal entry.

The rebuilt wasm remains **1,850,576 B raw / 521,814 B gzip**, identical to
round 10 and within the unchanged **522,000 B** ratchet (186 B headroom).

Command, from `snapback4/`:

```sh
export PATH=$HOME/.local/bin:$HOME/.cargo/bin:$PATH
CARGO_BUILD_JOBS=16 SNAPBACK4_RUST_TEST_PROCESSES=8 SNAPBACK4_TEST_SERIAL_CLIENT_FILES=0 SNAPBACK4_SESSION_SEQUENCES=5000 SNAPBACK4_ONLINE_SEQUENCES=3000 bash scripts/test.sh
```

Reference check: `ref-check: ok — 509 LLP docs, 9338 refs in 26500 files,
0 errors, 0 unchecked`. [Reference evidence](ref.log.gz).
The six changed source/test files remain below 1,500 lines; largest:
`local.ts`, 1,423 lines. Source/contract diffs have no whitespace errors.
The imported verbatim negative-control logs contain trailing whitespace and
one trailing blank line, reported by the unrestricted `git diff --check`;
those historical raw outputs were preserved rather than rewritten.

The supplied baseline tail was read (`== 1 failure(s) in 276 s`, cargo test).
The baseline failure did not recur; no failure was waived. No model count, timeout,
authorization rule, runtime meter ceiling or storage bound changed. No scale
remeasurement is part of this acknowledgement-only follow-up. No design
deviation or stopped part; no new unresolved scoped defect is known after full qualification.
