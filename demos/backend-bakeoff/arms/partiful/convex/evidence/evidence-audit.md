# Partiful / Convex evidence audit

- **Frozen protocol:** all 15 frozen Partiful scenarios have one retained
  scenario artifact. Fourteen are direct PASS results; hosted deployment is one
  explicit `UNAVAILABLE_REMOTE_DEPENDENCY` GAP because the supplied deploy key
  was empty.
- **Fixture and authority:** the authoritative seed contains exactly 20 events,
  one host plus 49 guests on the contended event, capacity 50, and four
  deterministic personas. Positive and negative host/cohost/guest/outsider
  checks use native `ctx.auth` boundaries.
- **Conflict:** Bob and Casey cross one `Promise.allSettled` barrier against the
  same final seat. Convex's native mutation transaction/OCC behavior settles
  exactly one success, one `PARTY_CAPACITY_EXCEEDED`, and 50 occupied seats.
- **Transport:** guest-list and wall-burst evidence comes from already-connected
  `ConvexClient` WebSocket subscriptions. There is no application polling path.
- **Asset:** the exact 262,144-byte deterministic payload has matching source
  and delivered SHA-256 hashes, an authorized storage URL, an outsider denial,
  and a negative fetch/metadata probe after deletion.
- **Scheduler/effects:** the scheduler receipt includes the returned schedule
  ID and successful `_scheduled_functions` system row. Known-success retry is
  suppressed by a durable attempt ledger. Fault injection records two provider
  receipts and preserves the transport outcome as ambiguous rather than
  claiming exactly once.
- **Performance:** seven paths each retain two warmups plus seven recorded raw
  samples, median, nearest-rank p95, clock/machine context, and an honest local
  cost window.
- **Target:** target kind, deployment name, backend version, assigned ports,
  namespace, and a secret-free identity hash are retained. The final cleanup
  proves all namespace tables zero, exact process groups stopped, assigned
  ports closed, fresh local target/config/browser/credential paths absent, and
  no hosted mutation attempt.
- **Secrets:** raw admin, instance, and hosted values existed only in ignored
  worktree-local state during the run. That state was retired; committed
  artifacts contain only key names and hashes.
- **Confidence:** high for the measured local target; no hosted behavior or
  hosted price/performance is inferred from local evidence.
