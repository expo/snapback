# Round 9 failure accounting

All failures below are **ours**. No baseline or environmental exemption is claimed.
The expected negative controls remain failures of the tested implementation;
they are not counted as passing qualification.

| Run | Failure | Disposition |
| --- | --- | --- |
| `native-fixture-error.log.gz` | All six new native cases failed during fixture compilation: `Ctx::get` returns `Option<Map<…>>`, not `Json`; `.is_null()` and returning its result directly failed Rust typechecking. | Our fixture setup error. Use `is_none()` and map the secret into `Json::Object`. Rebuilt through the real native module path; corrected cases run. |
| `native-before.log.gz` | `round 9 {online, process, wasm}: evaluated native {E_HTTP_RESPONSE, E_STORE_BUSY} withdraws retained authority` — all six fail at “evaluated denial must replace the mounted secret before return.” | Expected reproduction on the existing round-8 client/server build, before either was rebuilt. Direct callers receive the actual native denial and message; retained watches still show the secret. All pass with the origin fix. |
| `native-offline-before.log.gz` | `round 9 {process, wasm}: evaluated native E_OFFLINE withdraws retained authority` — two failures; online passes. | Expected follow-up reproduction with the first origin fix built. The remaining local `code !== E_OFFLINE` condition still suppressed replacement. Removed it after the origin gate; all three pass. |
| `affected.log.gz` | `process: ephemeral replacement fences buffered direct reply at equal durable cut`: `timed out: initial ephemeral owners` at `hook-retention-ephemeral.test.mjs:78`. Aggregate **1,027 pass / 1 fail**. | Timed out before revocation/evidence delivery. The unchanged complete file passes **20/20** and ten repeated executions of the exact case pass **10/10**. The same kind of initial-owner timeout is recorded in rounds 5–6. Cause remains unconfirmed; repeated passes are not a diagnosis or a baseline/environmental exemption. No timeout or assertion was relaxed. |
| Orientation shell lookups | Some combined read commands used nonexistent guessed paths (`serve_queries.rs`, `serve_route_ops.rs`, `serve/ops.rs`, device `query*.rs`, guide `reads.md`); `rg`/`cat` returned path errors and skipped dependent `&&` commands. Large reads also exceeded display limits. | Operational errors, not product tests. Located the actual files (`serve.rs`, `device.rs`, guide `reads.rs`) and repeated the required reads/fetch explicitly. No command failure is treated as passed verification. |

The native fixture alone gets a 90-second cold Cargo-build startup allowance
(the established native Following fixture uses the same allowance). Existing
5-second helper polling and all inherited test deadlines remain unchanged.
No full suite was invoked; the supervisor owns landing qualification.
