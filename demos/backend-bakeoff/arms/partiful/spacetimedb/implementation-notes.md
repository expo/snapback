# Implementation notes

## Native path

- Private SpacetimeDB tables hold personas, the event, membership, RSVP,
  event-wall, inline binary asset, schedule, run, and notification-attempt
  facts.
- Caller-dependent views expose only the event facts the connected identity is
  authorized to read. The public invitation preview is an anonymous view.
- Reducers enforce host/cohost/member authority and serialize the final-seat
  contention transactionally.
- Generated SDK bindings and WebSocket subscriptions provide all product
  realtime delivery. The application contains no polling loop.
- A scheduled procedure performs reminder delivery. Manual procedure calls use
  the same durable effect-attempt ledger.
- Known-success retries are suppressed. A 5xx after the receiver accepted the
  request remains `ambiguous`; retry reuses the same idempotency key.

## Deliberate glue and limits

- The standalone procedure HTTP client correctly rejects loopback and private
  destinations. For the deterministic test receiver, an anonymous,
  arm-lifetime Cloudflare Quick Tunnel supplies a public HTTPS route. It is
  test plumbing, not a hosted SpacetimeDB deployment.
- Assets are native durable table bytes rather than provider object storage.
  Identity-aware views enforce delivery authorization, but this would not be
  the preferred production shape for large media.
- SpacetimeDB Maincloud was not exercised because its credential was
  unavailable in the frozen inventory. Local standalone evidence is not
  relabeled as hosted evidence.
- SpacetimeDB has no arm-scoped export command used here. Reproducibility comes
  from the committed module, generated bindings, exact lockfiles, target
  identity receipt, and deterministic seed reducer; this is recorded honestly
  in the backup manifest.
