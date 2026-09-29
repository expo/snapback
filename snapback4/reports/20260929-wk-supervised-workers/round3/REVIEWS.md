# Round-2 review disposition in WK round 3

Astra's complete NOT READY review is retained in `review-astra.md`.

| Review item | Disposition and detecting evidence |
| --- | --- |
| High: refresh creates a bearer outside the live log redactors | `/auth/refresh` refuses named and conventional supervised families with HTTP 403 `E_WORKER_REFRESH`. The supervisor retains sole rotation ownership. Both live-worker regressions log the complete response and split writes, check no bearer, verify no successor row and retain initial-token authority. They fail against round 2 on the leaked successor. Manual seats with the same service name still refresh and retire their old bearer. |
| Medium: schema-local dependencies disappear or lose precedence | Private snapshots link the existing schema-local `node_modules` alongside its package scope. Tests execute the exact entry directly, then under supervision, importing from both entry and nested helper. One has only a schema-local package; another also has a different project-root version. Both fail against round 2 and pass after repair. Existing no-follow traversal, private regular-file copies and per-launch validation are untouched and their regressions pass. |
| Surviving mutation: removing `runWorker`'s automatic bearer replacement stays green | New standalone fetch-error/onError regression includes the bearer twice. Removing replacement from a disposable compiled module fails the test; original module is untouched. |

The named source snapshot still owns validated entry/helper bytes. Its explicit
host-dependency links retain the established trust boundary: installed packages
are trusted application code, not bundled source or sandboxed code. The existing
source-symlink/FIFO and replacement-during-launch controls pass.

Grok's file was checked at the start and during verification. At those checks it
contained only progress notes, later including a compaction notice. Final status
and any further disposition are recorded in REPORT.md and the final saved copy.
No independent READY verdict for the round-3 implementation is claimed.

## Completed Grok review

The complete **READY WITH CHANGES** review arrived during the full run's client
stage; it was read in full and is saved in `review-grok.md`. Grok explicitly
performed a code/test reading, not a test rerun in its unbuilt worktree.

| Additional item | Disposition |
| --- | --- |
| Medium: automatic conventional dev entry follows a symlink and reopens it on restart | Fixed. Automatic entries preserve their declared spelling and execute a private no-follow schema-tree snapshot, including generated modules and relative helpers. Three real-process controls detect initial symlink execution, replacement on restart, and an entry/helper swap after validation. All three reproduce against pre-fix code. Explicit operator-selected `serve --worker` remains its separate external-entry contract. |
| Low: fallback group kill after watchdog death could hit a reused group ID | Not claimed fixed. The live-watchdog path reserves Node's PID with WNOWAIT; unexpected watchdog death removes that reservation. A rare fully-exited/reused group remains a nonblocking follow-up, as Grok allowed. Recorded in the filesystem ticket; signalling only a pidfd would not itself clean up surviving group members. |
| Low: ledger initialization suspension leaves a live process whose last reported status is running | Retained deliberately: the round-1 instruction requires reporting once and suspending polling. `runWorker` is also a library/standalone API and must not call process.exit for its host. The guide and manual tell the operator to repair storage and restart. Doctor reports process state, not a readiness/claim-progress guarantee. |
| Low: doctor retains historical status after startup family cleanup | Retained as documented last-reported status, not a live-process probe. The governing LLP explicitly states this boundary; no token is in the record. No stronger readiness/liveness claim is made. |
| Mutation: deleting FULL leaves SQLite's default FULL and still passes | Semantically equivalent on the tested runtime: the test intentionally pins the real connection's synchronization at durable commits rather than the spelling of a PRAGMA. FULL→OFF is detected; explicit FULL remains in production code for configuration clarity. No source-text test added. |

The existing process-group and ledger tradeoffs remain explicit. No independent
READY verdict is claimed for the changes made after either round-2 review.
