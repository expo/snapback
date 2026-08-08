# guide-gap: no page teaches a real browser sign-in journey under sessions mode

**Opened:** 2026-08-08 · **Severity:** P2 (documentation)

The only code-delivery path guide/auth/sessions-and-principals.md teaches
(:99-124, :131-157) is the admin+impersonation-gated test mailbox,
explicitly labeled "local-test material". Lines 119-124 state the
no-mail-adapter boundary and route *native* apps to the broker seam — but
give no equivalent answer for a web app (dev mode? broker? personas-only?).
Wiring `AuthCoordinator` + `authRequestCode`/`authExchange` into a browser
client is never shown anywhere (client APIs at
packages/snapback-client/index.mjs:4932, 5262; coordinator at
packages/snapback-contract/index.mjs:29).

Journey verdict from the review: "email-code login, React web" is blocked —
a cold agent has no documented answer for how a real browser user receives
a code, and coordinator/custody construction is split between an open
ticket and nothing.

Scope boundaries with existing work:
- issues/20260806-guide-gap-browser-auth-custody-indexeddb-adapter.md covers
  only the storage-adapter choice, not the journey;
- issues/20260808-guide-gap-principal-to-app-identity-binding.md covers the
  principal↔app-user mapping, not sign-in;
- LLP 0196 T4's queued "real-auth sign-in beyond test personas" recipe is
  the natural home for the worked example — this ticket asks, at minimum,
  for the honest interim subsection ("browser app under sessions today":
  the options and their boundaries) plus one coordinator-construction
  snippet, so the sessions page stops routing web authors into silence.

Found by the 2026-08-08 comprehensive docs review (auth slice).

## Resolution

Fixed at the ticket's stated minimum 2026-08-08 (docs-review execution,
1284ae8a5): guide/auth/sessions-and-principals.md now carries "A browser
app under sessions today" — the honest options (dev mode, test personas as
local-test material, the broker seam, the supervised Expo web carrier), a
CI-executed `new AuthCoordinator({...})` transclusion from
demos/party-wall/tests/acceptance/headless.mjs, the
memory-vs-IndexedDB custody choice, and the pointer that the full worked
recipe remains queued as LLP 0196 T4.
