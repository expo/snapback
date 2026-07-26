# 0093 P-4 spec defect: the "casing is mixed by lane" rule has an undocumented exception inside `LiveEnvelope`

**Opened:** 2026-07-26
**Source:** LLP 0093 D4 clean-room discipline (P-4 Kotlin client build, `clients/kotlin`).
**Systems:** Wire Protocol, Schema governance, Client SDK

## The rule as documented

`src/live_wire.rs`'s module doc, cited by LLP 0094 §0C.2 and repeated in
LLP 0093's gotcha inventory:

> Casing is preserved from the pre-typed wire, which is mixed by lane:
> durable-lane envelopes use snake_case fields (`subscription_id`), the socket
> control lane and receipts use camelCase (`requestId`, `receivedAtMs`).

An implementer takes the obvious lesson: dispatch on `kind`, then read
snake_case for `LiveEnvelope` variants and camelCase for
`LiveSocketServerFrame` variants. That is what the gotcha ledger teaches.

## The exception

`LiveEnvelope::AuthorizationInvalidation` is a durable-lane envelope whose
nested payloads are **camelCase**:

```json
{"kind":"authorization_invalidation",
 "obligation":{"protocolVersion":1,
   "scopeId":{"kind":"subscription","subscriptionId":"sub_…",
              "namespace":{"clientStoreId":"…","queryKey":"…","queryInstanceId":1},
              "connectionGeneration":9,"scopeSequence":12},
   "maxDisposition":"quarantine","ownerContinuityId":"owner_…"},
 "resolution":{"ackToken":"ack_…","maxDisposition":"quarantine"},
 "snapshot":{"subscriptionId":"sub_…","function":"listEvents","version":15,"rows":[…]}}
```

`AuthorizationInvalidationSnapshot` carries `subscriptionId`, not
`subscription_id` — while its sibling `live_replace` in the *same* family
carries `subscription_id`. So the casing split is not "by lane"; it is
by-lane-except-for-this-subtree. `ResyncObligation`, `ResolutionTicket`,
`ScopeId`, and `QueryNamespace` are all camelCase for the same reason
(`#[serde(rename_all = "camelCase")]` on the imported auth types).

The committed `live.envelope.schema.json` does show this correctly — the
schema is right. The *prose rule everyone is taught* is the thing that is
wrong, and the prose is what an implementer internalizes before writing a
decoder.

## Why it bites

A decoder written from the lane rule reads `subscription_id` off the snapshot,
gets `null`, and cannot attribute the snapshot to a subscription. Because the
frame's `obligation.scopeId.subscriptionId` is *also* camelCase, both
attribution paths fail together, and the symptom is "the auth-scoped
subscription never updates" rather than a decode error.

## Cost

~5 minutes, because the raw-frame dump made it obvious. It would have been
much worse without one: there is no error, just silence.

## Fix wanted

The module doc in `src/live_wire.rs` (and LLP 0094 §0C.2 where it restates the
rule) says the split is by lane **with the auth-invalidation subtree as a named
exception**, or better: states the actual rule, which is that casing follows
the *defining Rust type's* serde attribute and the schema is the only
authority. LLP 0093's inventory item should carry the same correction, since
that inventory is the thing clean-room implementers read first.
