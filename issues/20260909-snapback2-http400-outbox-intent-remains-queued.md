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
