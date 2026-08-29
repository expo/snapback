# coterie: CHAT_ENVELOPE_EXCEEDED discloses another profile's conversation saturation

**Status:** Open
**Impact:** 3
**Urgency:** 2
**Ease:** 4
**Confidence:** 4
**Systems:** Demos, Authorization, Benchmarks
**Date:** 2026-08-28
**Related:** LLP 0120 §Noninterference, LLP 0329.011, LLP 0329.008

## Summary

`demos/coterie` refuses `openDm` and `addMember` with the declared code
`CHAT_ENVELOPE_EXCEEDED` when the **other** party is at their conversation-envelope
limit. The refusal is therefore a one-bit disclosure about a third party's private
state, readable by any authenticated principal for any profile id.

This is an application-level defect in a benchmark instrument, not a platform
vulnerability, and the disclosure is small. It is filed because it is a reachable,
concrete instance of the leak class LLP 0120 predicted analytically — "the refusal
threshold itself becomes a side channel unless the ceiling is stated so that refusing
does not reveal invisible-row counts" — and because it is the evidence in
LLP 0329.011 S1.

## Path

`demos/coterie/snapback/functions.mjs`:

```js
export const openDm = defineJsMutation({
  auth: 'authenticated',
  args: { otherProfileId: v.id('profiles') },     // caller-supplied, arbitrary
  refusals: [ …, 'CHAT_ENVELOPE_EXCEEDED' ],       // declared, so part of the surface
  handler: async (ctx, args) => { … return openDmCore(ctx, creator, other, existing); },
});
```

`openDmCore` → `createConversationCore(ctx, creator, input, fixture)` →
`requireChatEnvelopeCapacity(ctx, input.initialProfiles)`, where `initialProfiles`
includes the other party. The helper counts per profile:

```js
const chats = await ctx.db.query('conversationMembers')
  .withIndex('by_profile_latest_chat_page')
  .eq('profileId', profile._id).eq('isLatest', true)
  .take(chatHistoryEnvelopeLimit()).collect();
if (chats.length >= chatHistoryEnvelopeLimit()) ctx.refuse('CHAT_ENVELOPE_EXCEEDED');
```

`addGroupMemberCore` calls it as `requireChatEnvelopeCapacity(ctx, [targetProfile])` —
the target, not the caller.

An authenticated principal can therefore probe any profile id and distinguish
"at limit" from "not at limit" from the refusal code alone.

## Scope of the claim

Established by reading the call chain: the path is reachable by construction, the
argument is caller-supplied, and the refusal is declared. **Not** established: I did
not execute the probe against a running server, so this is a code-path claim rather
than an observed disclosure.

## Why it is worth recording beyond the fix

Capable agents wrote this, and review did not catch it. Nothing *could* have caught
it automatically: in a `defineJsMutation` handler, no analysis relates a refusal to
the visibility of the rows that produced it. The same check expressed as a
declarative bounded read plus a `count(binding)` would be analyzable, which is the
argument LLP 0329.011 makes for the declarative form.

## Suggested fix

Two options, in preference order:

1. **Check only the caller's envelope**, and let the other party's saturation surface
   (if at all) through a mechanism that does not distinguish it by refusal code.
2. If the invariant genuinely requires both parties to have capacity, collapse the
   outcome into a code that does not identify *whose* envelope was exceeded, and
   confirm the timing does not reintroduce the distinction.

Under LLP 0329.011 §S3's proposed contract — counts admitted only over a domain the
caller is authorized for — this check would be refused at generate time.
