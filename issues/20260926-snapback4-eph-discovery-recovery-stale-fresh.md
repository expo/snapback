# Snapback 4: after failed capability discovery, recovery can publish an obsolete fallback answer as fresh (LLP 3000.017 N6)

**Opened:** 2026-09-26 (Astra's confirmation of LLP 3000.017 fix round 3)
**Severity:** Medium (transient; the corrective answer follows)
**Area:** `snapback4/packages/snapback4/src/client.ts` — online-tier capability discovery (installation fence near line 177; fallback freshness near line 501)

## What happens

The scenario is an online-tier client of an ephemeral-capable backend,
while `/schema` is failing:

1. The client serves mounted watches from a 500 ms fallback refresh, marked
   `fresh: false`.
2. A generation-2 fallback response is still in flight when generation 3's
   schema installs.
3. That delayed response publishes `{data: 2, fresh: true}`. The corrective
   generation-3 answer follows it.

Installation fences outstanding reads only for the first backend. A delayed
fallback response takes its freshness from the current loading flag, not
from the flag in force when it was requested.

## Reproduction

Astra's probes on the Apartment M5 Pro mini, under
`/tmp/eph-delta-GPT-6 Astra (max)/`: `fix3-adoption-publication.test.mjs`
(deterministic) and `fix3-live-recovery.test.mjs` (real server). Both fail
at `809eb6930` and pass at `a44b11b51`.

## Fix direction

A changed-generation installation should also retire discovery-era reads.
Take freshness from the request's discovery state, not the current flag.
Turn both probes into repository tests.
