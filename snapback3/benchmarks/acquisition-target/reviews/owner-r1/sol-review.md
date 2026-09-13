# Owner/HTTP acquisition review

**Verdict:** changes requested. I found one material cursor/declaration-binding defect in the frozen owner implementation. I did not find a confirmed authorization bypass, mixed-sequence admission, hard-bound escape, or HTTP cache/compression correctness defect in the reviewed slice.

## Confirmed material finding

### Continuations advance the caller's raw arguments instead of the arguments the owner actually executed

**Location:** `snapback3/crates/snapback3-worker/src/protocol.rs:427-470`, especially `:468-470`; the continuation is later serialized at `:485-488`. `PendingAcquisition::advance` mutates its stored raw `chain.args` at `:68-72`.

`query_delivery` returns `actual_args`, the schema-decoded canonical arguments used by the execution. The page correctly reports those arguments at line 462. When a followed page has `next`, however, the code discards `actual_args` for continuation purposes and calls `pending_chain.advance(next)` on the original request object. The returned continuation therefore need not equal the executed arguments with only the certified cursor replaced.

Concrete counterexample: take a certified page query with `c: Optional<Cursor>` and another optional argument `scope`. A valid caller sends `args: {c: null}`. Argument decoding executes and reports the canonical `{c: null, scope: null}`. If the page returns cursor `N`, this implementation returns continuation args `{c: "N"}`, not `{c: "N", scope: null}`. A client enforcing declaration/page-chain binding cannot prove that the continuation is the canonical successor of the page it just admitted; a checkpoint identity based on canonical executed arguments can also change at the response boundary.

Before advancing an executed chain, replace its stored args with `actual_args` (or construct the continuation from `actual_args`) and then overwrite only the certified cursor. Declarations stopped before execution should remain verbatim, because the owner has no executed canonical form for them.

## Missing tests, not additional confirmed defects

- `protocol.rs:683-735` tests a page query whose cursor is its only argument, so raw and canonical args are identical. Add a query with an omitted optional non-cursor argument and assert that an executed continuation contains the canonical value and differs from the page args only at the cursor.
- The included tests do not exercise partial, denied, or capped-without-next acquisition pages. Those states should remain transport-terminal and must not produce runnable continuations merely because `follow` is true.
- The 17-declaration test covers the 16-execution bound, but the packet has no boundary test for the 1 MiB soft response stop, the 20 ms soft work stop, or the 15 MiB hard response rejection.
- The packet contains no HTTP-level test of `/api/acquire` strict body parsing, 409 mapping for sequence/generation drift, 413 mapping for acquisition oversize, or gzip negotiation. The implementation reads consistently with the stated contract, but these transport paths are unproved by the included tests.
- Cross-request cursor-cycle rejection is explicitly an SDK responsibility. The owner test at `protocol.rs:834-840` proves only repetition inside one owner turn; an integration test should preserve that division of responsibility.

## Performance observations, not correctness findings

`http.ts:358-372` serializes the full response and performs `gzipSync` on the Node event-loop thread. `protocol.rs:459-466` also serializes every page to count bytes before serializing the full response again at `:489-499`. These copies and synchronous compression can affect tail latency for large pages, but this packet contains no measurement establishing a material availability failure or failure of the sub-three-second target.

## Provenance and limits

Review performed by the Codex subagent `/root/acquisition_client` from the source embedded in the frozen packet. The runtime does not expose a trustworthy exact model identifier to the reviewer, so none is asserted here. No tests or executable checks were run for this review. I only computed hashes to confirm that the local sources still matched the packet and did not inspect a different revision.

- Packet: `.llp/ship-runs/snapback3-acquisition-20260912/reviews/owner-r1/prompt.md`
- Packet SHA-256: `40b3044a9ff861bc00f8f99a57efc89a4da908092784ad29d0bd0ab4b328ed89`
- Inputs SHA-256: `0a32a0dbe734d7af5643b06d853d5fea7c1b4e5de6b9df344ea8aa94922d1d7e`
- `snapback3/crates/snapback3-worker/src/protocol.rs`: `a19ba8d5115a50e8da25982b399a3e57aedb2b722a3910ba0c73dc10baf49224`
- `snapback3/packages/snapback3/src/node/http.ts`: `16e29bd5cd5818278b376d171f3c71601c8ec7378239d1b219980fb2d6cfc195`
- `snapback3/packages/snapback3/src/node/worker.ts`: `cf43a5f2f9d335740d37df373ed379d08ec7da3a294b10dc690ac8c6e7eceea5`
- `snapback3/crates/snapback3-core/src/offline.rs`: `47743590c8ec792a1cc07045db0fc244c6a98c245f4b7265d9a620e72e933ab3`

Review completed 2026-09-12 (America/Los_Angeles).

## Fix disposition

**Resolved after review.** `PendingAcquisition::advance` now installs the canonical `actual_args` returned by the executed query before replacing only the certified cursor. Chains stopped before execution do not call `advance` and retain their original declaration arguments.

The focused `acquisition_canonicalizes_only_executed_continuations` regression sends one followed declaration plus sixteen one-page declarations. It asserts that the executed continuation contains the normalized omitted optional argument while a declaration stopped by the execution bound still omits it.

- Updated `snapback3/crates/snapback3-worker/src/protocol.rs` SHA-256: `9307fa74ad3436fdd7e6f543e0b5deaf89ec65ef4ad61f92d3af2ea75102f022`
- Verification: `cargo test -p snapback3-worker acquisition_`
- Result: 4 passed, 0 failed, 0 ignored, 0 measured, 0 filtered out.
