# Guide gap: the local session-mailbox fixture is incomplete

**Status:** Open
**Area:** Guide, Sessions auth, Acceptance testing
**Found by:** LLP 0102 Partiful/Snapback deep-round arm
**Date:** 2026-07-28
**Governing:** LLP 0039, LLP 0057, LLP 0061, LLP 0102

## Problem

`guide/auth/sessions-and-principals.md` shows `authRequestCode` and
`authExchange`, but the snippet uses `mailbox.code` without showing how an
authorized test obtains `mailbox`. The Partiful arm needed four genuine local
sessions and had to inspect the card-game acceptance suite to discover the
admin-plus-impersonation capability, startup artifact, mailbox request, and
safe credential-custody sequence.

The Guide correctly says the mailbox is local-only and must not be exposed to a
browser or native bundle. What is missing is the complete server-side test
fixture that observes those boundaries.

## Suggested resolution

- Add a CI-verified helper or complete snippet that mints multiple local test
  sessions through request-code, gated mailbox read, and exchange.
- Show ownership and cleanup of the admin token, impersonation capability,
  startup artifact, and returned session bearers.
- Keep the production refusal and client-custody warnings adjacent.

## Evidence

- `demos/backend-bakeoff/arms/partiful/snapback/work/tests/acceptance.mjs`
  (`mintSession`)
- `demos/backend-bakeoff/arms/partiful/snapback/run-capsule.v1.json`
  (`assistanceEvents`)
- `diaries/0030-partiful-backend-bakeoff.diary.md`

## Acceptance

- a clean sessions-mode demo creates two or more distinct local principals
  using only the Guide's paved test path;
- the example is exercised by `node scripts/check-guide.mjs`; and
- no mailbox, impersonation capability, or session bearer enters browser code,
  logs, or committed evidence.

---

**RESOLVED 2026-08-01 (fix-wave docs sweep).** The complete local persona recipe — client construction, code request, admin+impersonation-gated mailbox read, exchange — is transcluded from the CI-exercised `demos/party-wall/tests/acceptance/headless.mjs` at guide/auth/sessions-and-principals.md §"Mint test personas: the complete local recipe", with both carrier headers named in a table, the `dev.ready.json` sidecar source of the impersonation capability, and the custody boundaries adjacent.
