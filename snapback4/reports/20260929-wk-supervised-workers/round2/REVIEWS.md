# Round-1 review dispositions in WK round 2

Read Astra's complete NOT READY review at the start and Grok's full streamed
READY WITH CHANGES review when it completed during the required full-suite run.
The raw reviews are retained in review-astra.md and review-grok.md. Neither is
represented as an independent review of this round's final implementation.

| Reviewer / finding | Repair / detecting evidence |
| --- | --- |
| Astra high; Grok medium: removed family survives failed retirement and authenticates ordinary HTTP | Retain the retiring worker until deletion commits. Apply the revision fence in owner/detached authentication, route and poll reauthentication; refresh also rechecks under the engine guard. Locked-removal tests require query, mutation and refresh 401 while pending, then durable session/marker deletion. Core tests preserve manual seats. |
| Astra high: rejected symlink executes on restart | Validate every launch and execute a private copy of opened entry/helper bytes, including secret selection. Rejected-entry and delayed-Node source replacement tests fail against round 1. |
| Astra medium: watchdog SIGKILL leaves Node behind | Supervisor kills its retained Node group when the watchdog exits by signal, on tick and shutdown, before replacement. Real SIGKILL test checks Node and descendant at replacement. |
| Astra surviving FULL→OFF mutation | Real-connection PRAGMA checks at both commits; mutation killed with synchronous 0 rather than 2. |
| Grok medium: direct watchdog TERM/INT/HUP destroys cleanup owner | Catch signals and initiate the same bounded cleanup as EOF. This intentionally improves on ignoring them: a signal addressed only to the watchdog also stops its group. Three tests without a supervisor fallback fail before repair and require the TERM-ignoring worker/helper to die after it. Simultaneous SIGKILL of host and watchdog remains outside a userspace cleanup guarantee. |
| Grok low: failed initial admission of an added declaration is forgotten | Retain its name and bounded retry deadline, revalidate source on each attempt. Repairing the Node probe starts it without another adoption/source edit. |
| Grok surviving open-path SQLITE_BUSY mutation | Open while a real writer lock is held; readiness waits until rollback. A disposable `errcode !== 5`→`!== 0` copy now fails this test. |

Grok's existing-ledger comments reaffirm the documented serialization and
provider/commit ambiguity; no policy change is needed. Its description of
initialization suspension as a running process remains accurate. No claims of
macOS execution, sandboxing against trusted code, or exactly-once provider I/O.
