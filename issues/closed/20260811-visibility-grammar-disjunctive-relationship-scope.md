# Visibility grammar cannot express disjunctive relationship scoping (the Clique feed shape)

**Opened:** 2026-08-11 · **Closed:** 2026-08-11 · **Landed:** `908f52350` ·
**Status:** resolved — implemented in Lane C · **Systems:**
Security/authorization, Code generation, Live queries

**Related:** LLP 0231 (OQ1 — the visibility grammar), LLP 0201 (Clique
benchmark), LLP 0056 (memberships), ship run `llp0231-visibility-20260811`
(Lane C)

## Problem

The shipped visibility union (`public-read | owner | membership`) had no
disjunction. A follow-graph feed policy is:

> a post row is visible to the caller if the caller follows its author
> **or** the caller is its author

Both arms were individually expressible, but there was no way to declare their
union on a table. Clique's Following feed also deliberately has no persisted
self-follow edge, so a membership-only workaround was not faithful.

## Resolution

The table visibility grammar now admits one bounded top-level `anyOf` of 2–8
distinct owner/membership leaves. It refuses nesting, malformed/duplicate
arms, and `public-read` arms; preserves authored order; carries the exact
policy through the manifest and executable query plan; groups the OR before
ANDed query refinements in storage; captures each membership dependency; uses
conservative live replacement for membership-containing policies; and demotes
every restricted policy from RQS.

The real-session acceptance fixture
`tests/acceptance/table-visibility-any-of-live.mjs` models Following as a
dedicated membership projection. It proves the author arm without a self-edge,
follow insertion and deletion in a live result, an anonymous empty result, and
an authenticated stranger's positive owner arm plus negative cross-user leak
probe.

LLP 0231 OQ1 and the auth guide record the exact bounded decision and its
nonclaims: this does not expand into `ctx.db`, search, relational queries,
class-M field masking, writes, or egress.
