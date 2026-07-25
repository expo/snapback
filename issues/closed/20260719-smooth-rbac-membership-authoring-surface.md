# Smooth the RBAC/membership authoring surface (memberId reachability and guide coverage)

**Status:** Resolved (2026-07-23 — all three Done-when criteria verified against main; posture B: foreclosure documented, alternatives paved)
**Severity:** P2
**Systems:** RBAC, Memberships, Codegen, Guide
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-19
**Related:** diaries 0013, 0014, 0015; llp/0056-scoped-roles-and-memberships.rfc.md;
guide/auth/scoped-roles.md; ENG-25263
**Linear:** ENG-25269 (related to ENG-25263)
**Marker:** rbac, memberships, authoring-ergonomics, guide

The membership/RBAC *enforcement* model is consistently praised in the
diaries — fail-closed denials with no existence leak, raw roster writes
refused below handler level, non-member live subscriptions delivering
nothing. Keep all of that. The *authoring* surface above it is where authors
repeatedly hit walls: membership/RBAC is the largest closed-issue cluster in
this directory (~15+ tickets), and diary 0015 records a full demo redesign
forced by the reachability cliff.

Concrete pains:

1. **memberId reachability cliff.** With fully private roster rows (no
   reads, no existence oracle, insert returns null), no handler can ever
   obtain a memberId — making `setRole`/`remove`/`patch` unreachable from
   app code, while the guide's own `pendingRoles: ['invited']` example
   implies invite-then-promote works (diary 0015, ENG-25263). Diary 0014
   named the same cliff. `setSelfRole`/`removeSelf` closed the self-service
   corner, but admin-driven role changes over a private roster still lack a
   paved authoring path.
2. **Discovery required source-diving.** The 0015 author "only got there
   after grepping storage.rs" — the privacy/authority split and its
   consequences for which mutations are reachable are not stated where an
   author designs their schema.
3. **Composition seam complexity.** Diary 0013 catalogs the captures an auth
   integration must align (coordinator epoch, queue generation, artifact
   identity, principal scope, descriptor, query lease) and a cascade of
   integration-only bugs; auth correctness "lives in lifecycle edges." The
   guide teaches the happy path but not the seams.

Direction: give private-roster apps a supported admin path (e.g. capability-
scoped roster handles or host-mediated role mutations that never expose the
row), and make the guide state the reachability consequences of each privacy
posture up front, with the invite-then-promote example made honest.

**Done when:**

- An app with a fully private roster can express admin-driven
  setRole/remove/patch through a documented, fail-closed authoring path —
  or the guide states plainly that this posture forecloses those operations
  and shows the supported alternative postures.
- guide/auth/scoped-roles.md documents the privacy-posture → reachable-
  operations matrix and corrects the `pendingRoles` example's implication.
- The diary 0013 seam catalog is absorbed into guide or LLP 0056 material so
  the next auth integration doesn't rediscover it.

## Resolution (2026-07-23, audited against origin/main)

Landed via c5d67b0a (2026-07-19) + d6ccce21 (2026-07-18); this file now
matches the Done Linear twin ENG-25269.

1. **Reachability:** the repo deliberately keeps the private v1 roster without
   an admin id resolver (the absence is the security contract —
   llp/0056 §"no general private-roster resolver"; src/runtime.rs id-addressed
   forms still require memberId; host-resolved `setSelfRole`/`removeSelf`/
   `patchSelf` close the self corner). guide/auth/scoped-roles.md states the
   foreclosure plainly and shows supported postures (invitation table +
   self-insert, pendingRole + self transition, bootstrapRole).
2. **Matrix:** guide/auth/scoped-roles.md §"Privacy posture and reachable
   operations" documents the operation → reachable-path matrix, and the
   `pendingRoles` example is now honest (invitee self-promotes;
   "Do not imply that the inviter can promote the private row later").
3. **Seam catalog absorbed:** all six diary-0013 seams (coordinator epoch,
   queue generation, artifact identity, principal scope, descriptor, query
   lease) live in guide/auth/scoped-roles.md §"Keep the authorization
   composition seams aligned" with anti-patterns.

Follow-through: Linear ENG-25263 (guide-gap twin) marked Done — its substance
is delivered by the same guide sections.
