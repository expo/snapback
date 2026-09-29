# Round 0 review dispositions

Both complete inputs are retained as `review-astra.md` and `review-grok.md`.
Only Astra's trailing Markdown hard-break spaces were normalized for the
repository whitespace check; the review text is unchanged.
Astra: **NOT READY**. Grok: **READY WITH CHANGES**, source review only, received
while this round's requested full suite was already running. Neither is
represented as an independent review of this round's final code.

| Finding | Disposition and evidence |
| --- | --- |
| Astra high / Grok medium: failed retirement forgets its family | Preserve expiry and family until the retirement transaction commits. Stop first; gate every replacement mint on retirement. Locked-writer restart and expiry-independent rotation retry the retired bearer over HTTP. Removing only the named-family DELETE makes both fail (200 instead of 401). |
| Astra/Grok: symlink root/entry escape | Open schema, worker root and descendants relative to pinned directory descriptors with O_NOFOLLOW. Discover all levels, refuse non-regular files, copy from opened files and preserve permissions. Deployment tests cover schema/root/entry/helper links and FIFO. |
| Astra/Grok: fresh/replaced-store ledger collision | Use the opened SQLite connection path and a SHA-256 filename namespace of its durable store_id. Two fresh stores and two persistent incarnations perform the same reused effect ID independently. |
| Astra/Grok: child/descendant lifetime | Per-worker process group and pipe-owned watchdog. Server death closes the sole writer, even for SIGKILL, on Linux/macOS. Worker exit and host shutdown kill all remaining group members. Linux process witnesses include a helper ignoring SIGTERM. |
| Astra: ledger initialization spends attempts | Open, acquire writer, validate schema and existing JSON before any claim. Initialization errors report once and suspend until abort/restart. Corrupt file/schema/receipt and invalid parent cases assert zero claims, handlers and settlements. |
| Grok: all secrets reach every named worker | Default named entries to no schema secrets. `// snapback4 secrets: KEY_A, KEY_B` requests only known declared names in that source entry. Keep the conventional generated runtime's registry environment, broad service-seat authority, and all-value log redaction. Two-worker test distinguishes explicit subset from empty default. This is reduced environment exposure, not an invented credential ACL. |
| Grok: mint/secret failure backoff stays at 250ms | All retryable startup/retirement failures share the increasing, five-second-capped backoff. The repeated invalid-secret witness observes increasing intervals and zero launches. |
| Grok: sequential shutdown grace periods | Close every watchdog pipe before awaiting/revoking individual workers. Four TERM-ignoring workers receive TERM together rather than two seconds apart; all are dead after shutdown. |
| Grok: shared SQLite lock across provider I/O | Adopt the review's explicit documentation alternative. The guide, manual and LLP now say that one hung provider stalls all handlers sharing the file and show a provider timeout. Reject the suggested unlock/call/insert sequence: it permits two simultaneously live handlers to perform the same key and loses the implemented cross-process exclusion. This is distinct from the documented crash-after-provider ambiguity. No exactly-once guarantee is made. |
| Grok: full disk, failed rollback and corrupt stored JSON | Validate stored JSON before claims. Runtime storage/commit/rollback failures close the connection, stop polling, report once and leave claims unsettled for ordinary lease recovery. Real SQLite max_page_count exhaustion and an injected combined commit/rollback failure assert one claim, zero settlements, no completion and immediate writer reacquisition. |
| Grok: deleting SQLITE_BUSY retry survives test | Strengthen the multi-process witness to require all three identical receipts and successful exits; add deterministic pre-opened concurrent waiters. A copied-module mutation changing the run-path errcode check from 5 to 0 now fails with "database is locked"; the fixed test passes. Product modules were not mutated during the full suite. |

No change to core effect ordering, retry policy, meters or authorization.
Standalone workers remain supported. Native jobs and generated external-step
reconciliation are untouched. No macOS execution or real-provider claim is made;
Linux is the available execution host. The watchdog uses the same portable Unix
pipe/group path on both supported hosts; deliberate group escape by trusted
application code is outside this process supervision contract.
