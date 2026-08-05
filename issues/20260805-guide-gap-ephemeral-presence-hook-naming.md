# guide-gap: no vocabulary bridge between schema "ephemeral" and the `useSnapbackPresence` React hook

**Status:** Open
**Impact:** 2
**Urgency:** 2
**Ease:** 4
**Confidence:** 3
**Systems:** Guide, React client, Ephemeral state
**Date:** 2026-08-05
**Related:** `demos/messaging-snapback` (typing indicators),
`packages/snapback-react/index.d.mts`, `guide/` (ephemeral state pages)

## Summary

Found while building `demos/messaging-snapback`'s typing indicators. The
agent building that feature grepped the repo for `useSnapbackEphemeral` and
`subscribeEphemeral`, found only the latter — a raw `SnapbackClient` method —
and concluded (stated in `diaries/0058-messaging-snapback.diary.md`) that
"there is no React hook for ephemeral typing," hand-wiring the client method
directly instead.

That conclusion is likely wrong. `packages/snapback-react/index.d.mts`
exports `useSnapbackPresence<Ref extends ConnectionEphemeralCollectionReference>(reference, {scope, value, ttlMs})`,
which returns live `entries`/`status`/`selfKey` — on its face, exactly the
shape a typing indicator needs. The agent never found it because the schema/
ephemeral-state vocabulary uses "ephemeral" throughout, while the hook
vocabulary uses "presence" — there is no cross-reference connecting the two
terms for someone searching from the schema side.

## Open question (not yet verified)

Whether `useSnapbackPresence`'s `ConnectionEphemeralCollectionReference`
type actually supports the shape a typing indicator needs — "one typing
row per user per conversation," scoped per conversation — or whether it
only models "per connection" state more globally. This needs to be
confirmed by actually building a typing indicator against the hook before
treating this purely as a naming/discoverability issue rather than a real
capability gap.

## Suggested fix shape

- If `useSnapbackPresence` does cover the conversation-scoped-typing case:
  add a guide example (ideally literally "typing indicator") under the
  ephemeral-state guide page, and cross-link "ephemeral" and "presence"
  terminology in both directions (schema page → hook, hook doc → schema
  concept) so a grep from either vocabulary finds the other.
- If it does not cover that case: file this as a real capability gap
  instead of a doc gap, since the demo's hand-wired `subscribeEphemeral`
  approach (borrowed from `demos/cursors-web`) is then the only working
  path, and should be the one the guide points to.
