# A3 sweep: search visibility cannot express membership, so org-wide issue search is inexpressible

**Opened:** 2026-08-01
**Systems:** Search, Auth
**Related:** LLP 0137 (A3 arm), LLP 0073, LLP 0056, demos/improvement-sweep/arms/a3-snapback-web/findings/0137-a3-f2-search-visibility-cannot-express-membership.json

Search-index visibility v1 accepts only `public-read` or `owner` (principal
match). The Linear-shaped fact — full-text search over the organization's
issues, visible to any member — is inexpressible: `public-read` would
disclose issue text to outsiders; `owner` reaches only rows assigned to the
caller. The guide states the restriction, so this is a documented capability
gap; the A3 arm shipped owner-partition "search my issues" (green, with
per-principal partition negatives) and recorded org-wide search as a GAP.

Frozen comparison: the Firebase Linear arm had no native search at all
(diary 0029, LINEAR-09 GAP); Convex composes search with function-level
membership gating by construction.

Fix shape: `visibility: { kind: 'membership', membership, resource }` on the
search index, resolving the caller's seats in the same transaction as the
posting recheck. Witness: member search returns cross-assignee matches;
outsider gets zero; seat revocation zeroes the next search.

## Resolution (2026-08-01, 0100 membership program lane M3)

Implemented whole, per LLP 0100 §8a's routed interface, together with the
owning dated LLP 0073 amendment ("2026-08-01 amendment: membership
visibility", appended, citing §8a as commissioning authority):

- `SearchVisibilityV1` gains `{kind:'membership', declaration, resourceField,
  roles}` (src/search/types.rs), authored through the same closed-union gate
  in packages/snapback-codegen/define.mjs; app-scoped declarations,
  unknown declarations, and out-of-vocabulary roles are refused at
  generation and at manifest load (fail-closed at both layers).
- The generated search function requires one equality-bound resource
  argument (`resourceArg` on `defineSearchQuery`) beside the unchanged
  `SearchRequestV1`; every invocation addresses one singular
  `membership:{resource}` partition. Multi-seat traversal is rejected per
  the RFC — searching several rooms means iterating one's own seats.
- Seat resolution (memberOf/hasRole semantics via the declaration's role
  vocabulary) and the posting/source-row release recheck execute on the
  same pinned connection — one snapshot by construction; the Live read
  path now pins a snapshot around search for the same guarantee.
- An outsider's (or revoked caller's) fresh search is the empty success
  page through the exact zero-candidate path, byte-identical to the
  nonexistent-resource result; revocation zeroes the next search.
- Continuations bind resource value, declaration, role set, and the
  durable `AuthorizationVersion {incarnation, epoch}`; a stale
  continuation minted before a revocation fails custody pre-evaluation
  with the uniform `SNAPBACK_SEARCH_CURSOR_RESTART`, byte-identical
  across causes. Both post-revocation observables have their own
  acceptance rows.

Witness (all green): src/search suite 39 tests incl.
membership_member_sees_cross_owner_matches_within_resource,
membership_outsider_empty_is_byte_identical_to_nonexistent_resource,
membership_revocation_zeroes_next_fresh_search,
membership_stale_cursor_after_revocation_is_uniform_restart,
membership_partition_is_pushed_down_and_bound_into_cursors,
membership_roles_filter_admits_only_listed_roles,
paired_membership_observations_do_not_reveal_other_resource_matches, plus
validation-refusal rows; full cargo lib suite 1582 passed; codegen suite
green incl. membership-search-authoring.test.mjs (generation, manifests,
required-arg api.d.ts typecheck, 8 refusal cases); guide text-search page
and capability row updated; generated artifacts rotated once for the
toolchain change (established chore(regen) pattern), including the
packaged comparator fixture.
