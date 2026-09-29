Reviewed `git diff b7d05baff..13a00b80b`. **Two findings remain, including a live-token leak.**

The earlier reproductions now pass on disposable copies:

| Earlier finding | Detecting coverage passed |
|---|---|
| Failed revocation during restart or rotation | Locked-writer restart; rotation with stored expiry extended; retired bearers return 401. |
| Removal forgets failed retirement | Separate tests require immediate `/q`, `/m` and refresh refusal, then eventual family/session deletion. |
| Symlink discovery/deploy/restart escapes | Schema, root, entry, helper and FIFO refusals; rejected-symlink restart; replacement of source paths after validation. |
| Fresh/replaced stores suppress unrelated effects | Four stores reuse the same effect ID and independently execute the handler. |
| Orphaned workers and descendants | Worker death, host TERM/KILL, watchdog KILL, and watchdog TERM/INT/HUP cleanup. |
| Sequential shutdown | All four workers receive termination within one shared grace period. |
| Excess secrets; missing backoff/admission retry | Secret subsets, increasing failure backoff, and recovery after repairing Node without another source edit. |
| Ledger failures consume attempts | Corrupt file/schema/receipt/parent-path initialization makes zero claims; disk-full and failed commit/rollback make zero settlements. |
| Weak contention/durability tests | Both contention paths pass. I reran FULL→OFF and open-path busy-retry mutations: both are now detected. |

The shared ledger’s transaction across provider I/O remains an explicit, documented tradeoff.

1. **High — Refreshed service tokens bypass log redaction.**
   [snapback4/crates/snapback4/src/dev_worker.rs:312](/home/ccheever/sb4-intent/review-wk-r2-astra/snapback4/crates/snapback4/src/dev_worker.rs:312), with refresh issuance at [auth.rs:245](/home/ccheever/sb4-intent/review-wk-r2-astra/snapback4/crates/snapback4/src/auth.rs:245).

   Each log reader receives a fixed redaction list containing the initially injected bearer. `/auth/refresh` issues another bearer in that supervised family without updating the list.

   **Reproduced:** a declared worker refreshed its injected token and logged the response with `console.error`. The new bearer appeared verbatim in the server log and successfully authenticated `/q/who` with **HTTP 200**. This violates the token-redaction claim through a supported credential operation.

   **Smallest fix:** register refreshed supervised-family bearers with the live log redactors before returning them. Alternatively, refuse refresh for supervised seats and rely on supervisor rotation. Add a refresh-response logging test, including split writes.

2. **Medium — Private snapshots omit schema-local package dependencies.**
   [snapback4/crates/snapback4/src/worker_declarations.rs:124](/home/ccheever/sb4-intent/review-wk-r2-astra/snapback4/crates/snapback4/src/worker_declarations.rs:124).

   Snapshot construction preserves project-root and ancestor `node_modules`, and copies `snapback/package.json`, but omits `snapback/node_modules`.

   **Reproduced:** `snapback/workers/push.mjs` imports a package installed under `snapback/node_modules`. Running that exact entry directly succeeds. Supervised execution fails with `ERR_MODULE_NOT_FOUND` and restarts. If another version exists at the project root, resolution can instead silently select that version.

   **Smallest fix:** preserve the schema-local `node_modules` lookup alongside its package scope, using the same host-dependency linking approach already used for project ancestors. Test the exact entry directly and under supervision.

What is sound: initial-bearer redaction handles split chunks; declared-secret subsets and sanitized launch environments work; doctor status contains no credential. The source snapshot closes the reported pathname-replacement holes. A dependency able to write a regular declaration still gains trusted service execution—this is explicitly trusted application code, not a sandbox.

The ledger commits successful receipts before settlement, rolls back failed handlers, serializes concurrent processes, and scopes supervised files to store identity. Effect IDs remain stable across redelivery. Moving a store requires moving its ledger; the provider-call/commit ambiguity is documented accurately. Effect ordering, retries and meters are unchanged.

**Test strength:** 94 tests passed across the four worker-related files. A confirmed surviving mutation removes automatic service-token replacement from [worker.ts:151](/home/ccheever/sb4-intent/review-wk-r2-astra/snapback4/packages/snapback4/src/worker.ts:151): all **94 still pass**. Add standalone error-reporting coverage containing the bearer. An initial copy lacked `undici`; after supplying that dependency, the affected tests passed.

The worktree is unchanged; no commit was made. I did not open any `provider-secrets.env`.

**Verdict: NOT READY.**
