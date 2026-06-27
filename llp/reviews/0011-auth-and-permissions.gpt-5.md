# Review: LLP 0011 - Auth and permissions

**Reviewed:** `llp/0011-auth-and-permissions.rfc.md` (working-tree revision)
**Family:** GPT-5 (OpenAI)
**Provider/runtime:** OpenAI API via Codex
**Date:** 2026-06-25
**Redacted:** No - reviewed local repo artifacts only.
**Method:** Single-session read-and-critique against LLP 0006 and 0008; targeted
revision applied to answer the auth/sync direction call.

## Overall assessment

The stable-principal, protected-core-auth-tables, BYOP, and write-side RLS model
is right. My answer to the direction call is: adopt server-directed
resubscribe-on-permission-change for v1, with authz epochs and fail-closed stale
handling; reserve precise live remove-deltas for analyzable rules later.

## Strengths

- Separates authentication from authorization and routes visibility into sync.
- Adopts Valet's stable principal plus identity links and BYOP safety rules.
- Handles local/offline `ctx.auth` parity and user-switch wipe explicitly.

## Concerns

- **C1 - Offline revocation cannot be instant. [High]** No model can remove data
  from an offline client at the moment another actor revokes access. Sensitive
  apps need retention/online-only policy knobs.
- **C2 - Authz epochs need a dependency model. [Medium-High]** Broad epoch bumps
  are safe; narrow invalidation requires structured permission metadata.
- **C3 - "Auth data is first-class" needs continued precision. [Medium]**
  Protected identity/session state and app-queryable profile/membership state
  must stay distinct.

## Suggestions

- Encode authz epoch, stale-result, resync-required, and clear-retained-slice as
  runtime states visible to adapters.
- Add doctor explanations for allow, deny, stale, and resubscribe-required.

## Open questions

- Which permission rule subset later earns precise live remove-deltas?
- What retention policy should finance/card-game style sensitive data default to?

## Recommended next step

Keep `Draft`. The author should ratify or amend the v1 resubscribe decision
before sync implementation hardens.
