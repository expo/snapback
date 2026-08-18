# Exact: mutations need a core compatibility-token schema key

**Opened:** 2026-08-17
**Source:** Coterie M1 provider freeze (Diary 0086); LLP 0279 item 2

## Gap

Provider-native queries carry core `compatibilityToken` fields, but the
closed declaration schema rejects the same key on mutations. Coterie froze
its mutation token set in a namespaced `coterie.m1CompatibilityTokens`
extension — workable, but every adapter must know to read the extension, and
the milestone-namespaced vocabulary grew again at M2.

## Ask

Add the core compatibility-token field to mutation declarations so query and
mutation tokens live in one schema surface. Acceptance: Coterie's namespaced
token extensions collapse into core fields across a declaration version bump
with no adapter-side special casing. External (Exact repo) fix; graduate to
Linear (Exact project) when picked up.

## Resolution (2026-08-17)

Graduated to the Exact repo: `issues/20260817-exact-mutation-compatibility-token-schema.md` there. Picked up by the
sbs-orchestrate Exact-side batch; further state lives in the Exact ticket.
