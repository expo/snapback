# Snapback2 terminal HTTP 400 can leave a durable outbox intent queued

**Status:** Open
**Impact:** 3
**Urgency:** 3
**Ease:** 2
**Confidence:** 4
**Systems:** Snapback2 client, Durable outbox, Diagnostics
**Date:** 2026-09-09
**Related:** LLP 1018.003.000

## Summary

A copied Clique web run submitted one stable message intent once. The owner
answered HTTP 400, but the online bridge retried the same intent about 374 ms
later and the durable outbox row remained `queued`. The app now rejects its
known 2,000-scalar schema violation before taking outbox custody, but that
application preflight does not settle the general client behavior.

The retained evidence is attempt 017 described in
`snapback2/packages/compiler/fixtures/quarry-clique/corrections/README.md`.
This behavior predates the copied-app correction.

## Required resolution

Classify an HTTP 400 response from the owner using its validated refusal body,
not status alone. Settle only a verified terminal refusal; keep an intent
queued when the response is malformed or transport outcome remains uncertain.
Retain the original intent identity across retries, and add ordinary,
malformed-body, terminal-refusal, and restart cases before changing custody.

## Disposition — 2026-09-11

**Priority:** P2. **State:** keep open, narrowed. Current main `15c134d056`
deliberately keeps a validated terminal refusal as an unspent, dismissible
queued row; it records the refusal and blocks the FIFO. That supersedes the
earlier instruction to settle the row, but not the unexplained-retry report.
The focused all-carrier test passed:

```sh
cd snapback2
node --test --test-name-pattern="a queued intent refused non-retryably as input" \
  packages/snapback2/tests/outbox.test.ts
```

A real headless Chromium/IndexedDB diagnostic observed exactly one mutation
request during a 750 ms post-response window: public `rejected/E_INPUT`,
authenticated epoch 1, ready custody, one durable queued row carrying that
refusal, and `status.blocked.intent` equal to the row intent. The persona had
one `snapback2-signup:<viewer>` database. Attempt 3 passed; attempts 1–2 only
corrected the probe taxonomy (`rejected`, not `refused`). Launcher PID 74568;
real Chromium, Web Locks and IndexedDB.

Repeat by copying `scripts/witness-web.mjs`, adding this route immediately
before the profile mutation in `signupWitness`, recording `client.snapshot`,
`outbox.status()`, `outbox.entries()` and `indexedDB.databases()`, then running
the copied script with `--signup`:

```js
await page.route("**/api/mutation", route => route.fulfill({
  status: 400, contentType: "application/json",
  body: JSON.stringify({ state: "refused", code: "E_INPUT", family: "input",
    message: "diagnostic terminal refusal", rewrite: "dismiss the refused intent",
    guide: "input/runtime" }),
}));
const mutation = await witness.client.mutation(window.__api.profiles.createMyProfile, profile);
await new Promise(resolve => setTimeout(resolve, 750));
```

Queue preservation is custody policy; progress UX is the explicit blocked
status plus dismissal, not silent settlement. Close only after the original
copied-app retry and validated, malformed-body, restart and byte-identity cases
agree with that policy.
