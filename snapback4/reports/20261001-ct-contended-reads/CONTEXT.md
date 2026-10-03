# CT round 0 context

Scope: HTTP request dispatch, request admission, read checkout, server scheduling,
and the Node token transport. Base: `9845a1f013cf0c0a14194efecef86f865cfdc2a1`.

Governing documents (all in `llp/current/`; none in `llp/foundation/`):

- LLP 3000 §7, HTTP overload diagnostics: seven separately reserved request
  classes, bounded connection admission, static best-effort refusals, no body
  drain on refusal, no lease eviction. This is the admission/runtime owner.
- LLP 3000.019 §§3.6–3.7: detached identity-checked transactions, reader epochs,
  old-program reads during adoption, separate mutation and sync reservations;
  existing latency semantics and disclosure fences.
- LLP 3000.026 §4: atomic Following launch may hold sync, never query slots.
- LLP 3000.013 §4: FIFO writer ownership and bounded maintenance deferral.
- LLP 3000 §7, KA connection reuse: private Node dispatcher, idle retirement,
  exactly one fresh retry only with proven zero-response reused-socket failure.

Paved surfaces read: compiled reads guide, the token client's `createClient`,
Node default transport, dev/serve/doctor options. No authoring change is needed.
No answers, credentials, transactions or authorization decisions may be cached.
The supplied task authorizes the qualification script, report, and structural
regression. Root Snapback 1 gates do not apply inside the Snapback 4 fence.

Measured questions: request-thread creation/wakeup cost; parser/accept handoffs;
client event-loop delay; lock wait versus CPU work. Linux cannot raise inherited
nice values without privilege. Darwin scheduling remains operator qualification;
this lane must not run the harness on the Macs.

Likely document updates: LLP 3000's runtime decision, LLP 3000.019's timing scope,
and one append-only journal entry. Hand-off: none.
