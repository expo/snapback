# Owner-#5 slice claim: extract the server writer-gate seam (with_snapback family)

**Opened:** 2026-08-10
**Lane claim:** CLAIMED 2026-08-10 by the 0199/0225 execution session (the
same session that landed the owner-#2 generation-commit slice, 99fbf9907).
First-claim-wins; coordinate here before overlapping.

**Governing record:** LLP 0225 §1 (owner 5, transport-adapters: compose the
domain owners) + §3.6/§3.7 (background CPU/network work happens outside the
global writer; adapters never commit directly). Prerequisite for the
deferred render/canonicalize-outside-the-writer move recorded in
`issues/20260808-assets-finalize-memory-and-cpu-under-global-lock.md`
(explicitly deferred there to this program).

## Scope

One boundary, one landing — a semantic seam, not a cosmetic split:

1. Extract the global-writer acquisition family from the `src/server.rs`
   god file into a dedicated transport-owned module
   `src/server/writer_gate.rs`: `with_snapback`, `with_snapback_then`,
   `lock_managed_snapback` (private), `with_snapback_authorization_write`,
   `with_snapback_staged_authorization_write`,
   `with_snapback_stream_reset_admission_effect`, and `with_read_lane`
   (the lock-free read lane is part of the same serving-gate contract).
   Re-export from `src/server.rs` so the ~248 call sites keep compiling
   unchanged.
2. The module carries the seam's contract in its docs: every serving path
   that can reach Hermes eval or rusqlite acquires the writer through this
   one gate (or the read lane); CPU/network preparation belongs outside the
   guard (LLP 0225 §3.6) — making the deferred asset-prepare choreography
   implementable in one place.
3. Manifest: assign the new module to `transport-adapters` (routine
   assignment-at-landing). Baseline: relocation re-keys only for the edges
   the moved code carries (e.g. the frozen `server.rs → local.rs` portion
   that follows `LocalSnapback`/`ReadLane` naming); no direction change, no
   new coupling.

NOT in scope: moving any asset/render CPU (that is the follow-up this seam
enables, coordinated with the LLP 0044 lane); the ownership-gate analyzer
hardening (claimed elsewhere); any behavior or locking-order change.

## Resolution

(pending)
