# RT3b follow-ups from the final blind review

Status: Open
Date: 2026-10-23
Scope: Snapback 4 serving authority (`serve_ephemeral.rs`, `serve.rs`, `actions.rs`, `serve_changes.rs`, `serve_sync.rs`)
Severity: P1 (ephemeral snapshot) / P2 (others)

RT3b and RT4 landed after three fix rounds. The final blind review of fix
rounds 1–3 (`9820593eb5` before rebase) left these findings. One reviewer
returned APPROVE WITH NITS; the other returned CHANGES REQUIRED. Each item
needs a dual-store witness that fails before its fix.

1. **Ephemeral authority is checked in a different snapshot than execution
   (P1, inherited).** `check_detached`/`check_expected` (`serve_ephemeral.rs`
   ~239) resolve authority in a transaction that then closes. After that,
   `mutate_ephemeral` (`engine/ephemeral.rs` ~439) opens another snapshot. A
   revocation or scope change committed between the two still executes and
   publishes. Resolve and compare authority inside the ephemeral execution
   snapshot.
2. **Retryable `E_GENERATION` after durable action admission (P2, introduced
   by fix round 2).** `generation_reply` (`serve.rs` ~676) normalizes every
   generation refusal to retryable 503. HTTP action admission commits
   (`engine/actions.rs` ~187), and then its wait re-resolves authority and
   rereads the request (`actions.rs` ~103). A foreign activation during that
   wait answers retryable 503 for an accepted action. A refusal after
   admission must keep accepted-intent custody: report it as accepted, with
   reconciliation by the same id. It must never be a pre-execution
   refusal.
3. **A capability change during a held `/changes` poll ends as a terminal
   `E_AUTH` (P2, inherited).** The final check (`serve_changes.rs` ~132–151)
   sends every live-but-different capability through `diagnostics::refused`.
   That is non-retryable and returns HTTP 401, or a final chunk once a
   heartbeat has been sent, so the SDK drops a live credential. Use the
   shared stale-capability classification (retryable `E_AUTH`).
4. **`/sync` launch wait and memory fallback check the principal only
   (inherited).** `Admission::check` is called from `serve_sync.rs` ~68,
   ~109 and ~167. Compare kind and scope, as on the other doors.
5. **Wire guide gaps.** Document `409 E_STORE_REPLACED` at non-ephemeral
   ingress, and the ephemeral ingress exception (HTTP 200 failure envelope).
   Merge the `Access-Control-Expose-Headers` values in `respond_empty`,
   `/native.wasm` and `/api.ts`.
6. **Latent:** if a program member ever returns `RuntimeError::Generation`
   after the `program` savepoint, `mutation.rs` ~203–228 would commit a keyed
   failure receipt that `serve.rs` then advertises as retryable 503. No
   current constructor does this. Add a debug assertion or classify it there.
