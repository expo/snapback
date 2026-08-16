# Coterie setAvatar seam mismatch blocks the profile-photo UI

**Opened:** 2026-08-16
**Status:** Open
**Related:** LLP 0266 D4/D7, demos/coterie/src/data/memory-provider.ts, demos/coterie/src/data/snapback-provider.ts, demos/coterie/src/data/generated/coterie.bindings.ts, diaries/0086

An avatar-editing UI lane (UI-only, data layer frozen by the concurrent M2
slice) stopped on three seam defects around the M1 `setAvatar({ avatarRef })`
mutation. Probe evidence: generated-binding calls against both providers.

1. **Provider-divergent avatarRef vocabulary.** The memory provider accepts
   only `media/avatar-alice.png` | `media/avatar-bob.png` (two refs; the
   fixture pack has eight personas) and rejects served paths and data URLs
   with `AvatarReferenceInvalidError`. The Snapback adapter treats
   `avatarRef` as a fetchable URL. The same UI cannot form a valid ref for
   both providers, which violates the D4 seam (UI must not know which
   provider is active).
2. **Ref→URL mapping is not derivable.** The accepted token
   `media/avatar-bob.png` returns `avatarUrl: /assets/fixtures/avatar-bob.png`;
   a relative ref resolved from a profile route maps to
   `/profile/media/...`, which is not the served asset location.
3. **Missing chat projection.** Generated `setAvatar.writes` is
   `posts, profiles, search` — no `chats`. A probe received no second
   `listChats` delivery after a successful `setAvatar`, so chat list rows
   would render a stale avatar after a change.

**Fix shape:** normalize an enumerable avatarRef vocabulary covering all
eight personas, identical semantics in both providers (declaration doc +
memory impl + snapback adapter mapping), and make chat projections update
(add the projection and/or the missing write). Contract has no file-input
primitive (Exact guide marks image-picker as a GAP), so the UI affordance
will be a fixture-avatar picker; the normalized vocabulary is its enabling
requirement.

**Ownership:** CLAIMED by the active Coterie M2 slice (session fdf0bf22,
2026-08-16) — the normalization lands inside its v6 freeze as required
round-1 fix items, with a `setAvatar@2` compatibility-token bump for the
semantics change; it closes this ticket with the M2 landing SHA. The queued
v6→v7 UI slice builds the fixture-picker affordance against the 8-ref
vocabulary afterward.
