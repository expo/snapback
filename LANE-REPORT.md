# Lane report — auth-whoami

Sweep lane A of `llp-ship/sweep-followups-20260812`. Ticket
`issues/20260812-guide-gap-auth-client-surface-and-whoami.md` is closed in
this commit.

## What landed

Typed `@expo/snapback-client` identity/custody accessors that already
existed at runtime and were listed on the headless inventory:

- `currentAuthorityDescriptor()` / `currentAuthorizationScope()`
- `registerAuthBarrierParticipant()`, `setBearerToken()`,
  `replaceBearerToken()`, `clearAuthSession()`, `replaceAgentCredential()`
- `authCoordinator?: AuthCoordinator | null`
- `authSession()` → `AuthSessionProjectionV1` (mode/authority, not whoami)

Guide: **Ask who I am (am I signed in)** on
`guide/auth/sessions-and-principals.md` with a CI-verified
`source=packages/snapback-client/auth-identity-types.fixture.ts` snippet.
Headless page cross-links it. Retrieval-eval case 48 covers `who am I`,
`am I signed in`, `settledView`, `currentAuthorizationScope`, `whoami`.

Blessed whoami is `currentAuthorizationScope().principalScope.userId`.
`authSession()` stays the handshake projection.
`AuthCoordinator.settledView()` is mentioned once as the lower-level
equivalent, not the app read.

## Verification

- `tsc --noEmit --strict` on
  `exact-reference-types.fixture.ts`, `push-registry-types.fixture.ts`,
  `auth-identity-types.fixture.ts` — pass, no `as`/`any`
- `node packages/snapback-client/unrecognized-authority-recovery.test.mjs`
  — 7/7, including the new whoami/restore case
- `node packages/snapback-client/export-parity.test.mjs` — pass
- `node packages/snapback-client/app-data.test.mjs` — pass
- `node scripts/check-guide.mjs` — ok (123 pages, 1395 snippets)
- `node scripts/check-retrieval-eval.mjs --check` — 48 cases, 0 errors
- `node scripts/check-inventories.mjs` — pass (no new `.test.mjs`)

Did not cargo/bootstrap, did not push, did not touch other worktrees.

## Notes

Runtime methods are in published 0.1.20+; the new `.d.mts` declarations
ship with the next closure. The guide says that explicitly and does not
unreleased-fence the 0.1.20 runtime call.
