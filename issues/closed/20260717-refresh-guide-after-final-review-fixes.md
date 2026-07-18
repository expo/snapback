# Refresh guide review provenance after final review fixes

**Status:** Closed
**Severity:** P2
**Systems:** Guide, Auth, RBAC, Storage, Client integration
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0061; issues/closed/20260717-reject-authority-independent-membership-and-scope.md; issues/closed/20260717-keep-logout-response-through-self-terminal-cut.md
**Marker:** guide, freshness, auth, rbac, review-provenance

After the final code fixes were committed, the canonical guide check correctly
reported 16 pages whose declared authority files had changed since their last
review identity. The snippets and existing behavioral claims still matched,
but landing with those warnings would leave the agent-facing freshness signal
stale. Two changes also deserved explicit teaching: membership dependence
cannot claim `authorityIndependent`, and self-terminal logout has exact
response/successor/diagnostic semantics.

**Done when:**

- Every warned page is intentionally reviewed against the final code commit.
- Scoped-role guidance names the authority-independent refusal.
- Headless auth guidance names exact-empty-204 logout, self-terminal response
  ownership, peer-successor preservation, and fatal diagnostic preservation.
- Generated guide projections are refreshed and `check-guide` reports zero
  warnings.

## Resolution

All 16 pages were reviewed against commit
`8a6bbd1ec980a49010aa67269ee908433a257c9a`; unrelated authority changes did
not alter their author-facing contracts. Scoped roles and the headless client
received the two material clarifications, review dates/identities were updated,
and the generated manifest/flat projection were regenerated. The guide checker
now completes with no freshness warnings.
