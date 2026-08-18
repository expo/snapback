# Exact: generator emits self-referential type alias on result-name collision

**Opened:** 2026-08-17
**Source:** Coterie M1 and M2 entries (Diary 0086); LLP 0279 item 5

## Symptom

A mutation named `logout` with a result shape named `LogoutResult` generated
`type LogoutResult = LogoutResult`; the identical collision recurred with
`createPost`/`CreatePostResult`. Renaming the row (`LogoutMutationResult`,
`CreatedPost`) is a harmless workaround, but the generator accepts the
collision silently and emits an unusable alias.

## Ask

Detect operation-derived versus declared type-name collisions and either
refuse with a diagnostic naming both sources or deterministically
disambiguate. Acceptance: the two Coterie rename workarounds can be
reverted and generation either succeeds with distinct names or refuses
loudly. External (Exact repo) fix; graduate to Linear (Exact project) when
picked up.

## Resolution (2026-08-17)

Graduated to the Exact repo: `issues/20260817-exact-generated-alias-self-reference.md` there. Picked up by the
sbs-orchestrate Exact-side batch; further state lives in the Exact ticket.
