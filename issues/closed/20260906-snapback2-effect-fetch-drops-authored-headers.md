# snapback2: effect `fetch` drops the authored request headers (idempotency key, content type)

**Filed:** 2026-09-06 by Claude Fable 5.1 from the Clique full run (benchmarks/runs/2026-09-05-clique-full-3x3), builder evidence as cited; raw lanes at /Users/ccheever/clique-full-20260905/lanes/.
**Status:** open · **Severity:** correctness — the one place the platform does external I/O

## Symptom
An effect body authored a `fetch` with an `idempotency-key` header and a JSON content type. The provider's raw request receipts show the request arrived as `application/x-www-form-urlencoded` with no idempotency key. The builder moved deduplication into the provider by hashing the JSON body instead.

## Evidence
- `/Users/ccheever/clique-full-20260905/lanes/astra-snapback2/run-log.md` epoch 1788631903 (M6, attribution snapback2-defect)
- `/Users/ccheever/clique-full-20260905/lanes/astra-snapback2/evidence/push-requests.jsonl`, `/Users/ccheever/clique-full-20260905/lanes/astra-snapback2/snapback/provider.ts`

## Fix shape
The effect runtime's fetch must forward every authored header and the authored body encoding verbatim; add a corpus/effects test that asserts the provider-side receipt headers equal the authored ones.

## Resolution

Resolved 2026-09-05 by wave 1: Ibex fetch takes an engine-owned Headers handle (expo/ibex ae72807ae) and the effect prelude passes authored headers with the redirect/credential matrix (main b6a97bd29, LLP 1003). The earlier ticket 20260901-…-fetch-drops-authored-request was closed then.
