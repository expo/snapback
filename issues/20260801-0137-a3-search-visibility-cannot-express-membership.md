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
