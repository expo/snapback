# 0093 P-4 spec defect: `authorizationNamespace` is required for auth-scoped live and documented in none of the protocol specs

**Opened:** 2026-07-26
**Source:** LLP 0093 D4 clean-room discipline (P-4 Kotlin client build, `clients/kotlin`).
**Systems:** Wire Protocol, Auth, Live Queries, Client SDK

## The blocker

In sessions mode, `POST /live/{name}/subscribe` for an auth-scoped live query
refuses:

```
HTTP 400
{"diagnostic":{"code":"SNAPBACK_AUTH_INVALIDATION_NAMESPACE_REQUIRED",
  "severity":"error","subsystem":"auth",
  "message":"auth-scoped live queries require authorizationNamespace","details":{}}}
```

`SNAPBACK_AUTH_INVALIDATION_NAMESPACE_REQUIRED` appears in **none** of the
refusal registries: not LLP 0094 §0E, not LLP 0096 §2.2's refusal list.

The word `authorizationNamespace` (and `clientStoreId`, `queryKey`,
`queryInstanceId`) appears in **zero** of LLP 0093, 0094, 0095, 0096 —
verified by grep over the four documents. Its only appearances in the repo's
documentation are:

- a description string inside `schemas/live.subscribe.input.schema.json`
  ("required in sessions mode for every other live function"), which is not
  a normative statement anywhere and is easy to skim past because the field
  is not `required` in the schema's `required` array;
- `guide/clients/headless.md` (one line about `clientStoreId` binding
  namespaces to a durable client store) and `guide/auth/protecting-data.md`
  (a lease-route code snippet). The guide is not in LLP 0093 D1's precedence
  ranking, so a clean-room implementer working from the named normative
  sources never reaches it.

## What the client actually has to construct

Derived from `QueryNamespace::validate` (`src/auth/invalidation.rs`), which is
the only authority:

| Member | Rule |
| --- | --- |
| `clientStoreId` | opaque id, nonempty, ≤256 chars, `[A-Za-z0-9][A-Za-z0-9._:-]*` |
| `queryKey` | nonempty, ≤8192 bytes, "canonical key" (canonicalization unspecified) |
| `queryInstanceId` | integer ≥ 1 (`MAX_PROTOCOL_COUNTER` upper bound) |

**Still undocumented after reading the validator**, and these are the parts
that actually matter for correctness:

1. What identity `clientStoreId` must have — per install? per process? per
   durable row store? Must it survive process restart? The guide says it
   "binds authorization and retained query namespaces to one durable client
   store", which implies persistence, but no spec states the obligation.
2. Whether `queryKey` must be a *canonical* encoding of (function, args) that
   the server also computes, or is opaque to the server. If two clients must
   agree on it, the canonicalization is a wire contract and belongs in a spec.
3. Whether `queryInstanceId` must be monotonic per store, unique per
   `(clientStoreId, queryKey)`, or globally unique — and what the server does
   when a value repeats.
4. What happens on collision between two live subscriptions sharing a
   namespace tuple.

## Cost

~30 minutes, of which ~20 was searching four LLPs, the schema set, and finally
the Rust source for a field name the refusal did not spell out beyond its own
message text.

## Fix wanted

LLP 0096 §2.2 gains an `authorizationNamespace` sub-section: the member, its
three fields, their validation rules, their identity/lifetime obligations, and
the refusal code. LLP 0094 §0E registers
`SNAPBACK_AUTH_INVALIDATION_NAMESPACE_REQUIRED` (HTTP 400). The
subscribe-input schema's `authorizationNamespace` description should point at
that section rather than carrying the only statement of the rule.

Without this, **no clean-room client can subscribe to an auth-scoped live
query**, which makes `auth/live` unclaimable from the documents alone.
## Resolution

LLP 0096 now specifies the namespace members, matching boundary, lifetime, and
collision behavior. The generated subscribe schema points clients to that
normative definition.
