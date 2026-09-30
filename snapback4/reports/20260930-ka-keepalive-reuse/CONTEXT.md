# KA orientation

Scope: Snapback 4's bounded vendored HTTP parser, dev/serve framing, Node
transport, and affected durable SDK dispatchers. The root project gates for
Snapback 1–3 do not apply (snapback4/AGENTS.md).

Governing LLPs:

- LLP 3000 (foundation): §HTTP overload diagnostics owns admission, transport
  error classification, retry exclusions and the Node implementation.
- LLP 3000.019 (current): §3.7 requires response completion before unread-body
  cleanup, including manually framed held polls; §3.6 keeps read reservations.
- LLP 3000.013 (current): §6 preserves durable write ID and store binding across
  ordinary and exit delivery.
- LLP 3000.009 §5.1: replay binds principal, operation, arguments and write ID.
- LLP 3000.022 §6: an existing durable receipt precedes a replacement operation,
  including conversion to ephemeral. The unreceipted ephemeral path cannot be
  qualified for retry merely because its call carries an ID.

Active constraints: retain the 128-connection and two-upload limits; preserve
E_RATE_LIMIT and its existing bounded backoff; do not replay uploads, once-view
GETs, auth or ephemeral calls on ambiguous failure. Keep a response that has
started on its original error path. The new retry cannot create an outbox owner
or settle an unacknowledged write. Keep TLS and streaming; an idle timeout is
not a held-response timeout. Retain the wasm ratchet and 1,500-line source cap.

Rationale: a close/reuse race is narrower than an arbitrary E_OFFLINE. A successful
past response on this exact socket plus zero newly received bytes is the evidence
required for one immediate safe replay. Platform fetch does not expose that
information, so opaque browser/native failures cannot qualify at the SDK layer.

Open risks: the original calibration log does not expose the failing socket's
reuse or byte state. Linux and Darwin can report different errors for the same
close. HTTP/1.0 and forced-close responses must not advertise a false lease.
Browser/native pools have their own recovery policies and execute outside JS.

Doc update: extend LLP 3000's existing HTTP section; keep the guide's assets
transport paragraph accurate; append the journal and this commissioned report.
Hand-off: none. No new LLP, contract API, publication or external service needed.
