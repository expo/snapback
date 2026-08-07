# `main` client bundle ratchet: React profiles grew ~35%

**Status:** Resolved — accidental HMR closure removed; remaining feature and
correctness growth dispositioned prospectively
**Impact:** 4
**Urgency:** 4
**Ease:** 3
**Confidence:** 4
**Systems:** Packaging, Testing
**Date:** 2026-08-06
**Resolved:** 2026-08-06
**Related:** `issues/closed/20260804-bundle-closure-growth-review.md`,
`issues/closed/20260805-static-capability-composition.md`,
`issues/20260806-react-optional-capability-composition.md`,
`issues/20260803-first-npm-latest-promotion.md`

## Original measurement

At `167a9e080`, under the Node 24.18.0 receipt toolchain, the two React
profiles exceeded their active Move-3 ceilings by about 35%:

| profile | minified | gzip | brotli |
| --- | --- | --- | --- |
| `external-react-application` | 50,114 → 67,830 | 15,841 → 21,759 | 13,908 → 19,242 |
| `react-external` | 49,943 → 67,655 | 15,781 → 21,701 | 13,865 → 19,165 |

The same run had a separate 1–2% cluster in assets, shared outbox, registered
RQS, and the persistent-store entries. The ratchet correctly refused to absorb
either cluster without attribution.

## Root cause

The 35% step was **accidental production closure growth**. Bisect-by-inspection
and profile measurement identified `8ce5ca33e` (`fix(react): recover HMR
generation splits with an atomic binding handoff`) as the first commit whose
React closure retained the step. That change put the complete development-only
HMR re-admission loop in `packages/snapback-client/react-binding.mjs`, which is
statically imported by `packages/snapback-react/index.mjs`.

Comparing the last committed green report (`9ba26b096`) with `167a9e080`, the
module-own minified attribution changed as follows in each React profile:

| module | before | at `167a9e080` | delta |
| --- | ---: | ---: | ---: |
| `packages/snapback-contract/result-contract-validator.mjs` | 232 | 9,380 | +9,148 |
| `packages/snapback-client/react-binding.mjs` | 4,170 | 10,478 | +6,308 |
| `packages/snapback-react/index.mjs` | 32,967 / 32,819 | 37,509 / 37,356 | +4,542 / +4,537 |
| `packages/snapback-client/rqs.mjs` | 1,010 | 3,746 | +2,736 |

The retained code was the result-contract compiler, RQS artifact hashing, and
the polling/validation machinery that rebuilds and atomically publishes a new
generation. It is used only after a positive development/HMR signal.

The two candidates named in the original ticket are excluded by chronology:
`167a9e080` is the parent of the LLP 0081 quarantine commit `6ec40820d`, and
the LLP 0179 conversation-surface commit `c7a8b9031` landed after the ticket.
Neither can cause a measurement taken at `167a9e080`.

## Code disposition

The HMR implementation moved to
`packages/snapback-client/react-binding-hmr.mjs` behind a literal dynamic
import. The synchronous classifier and single-flight wrapper remain in
`react-binding.mjs`; once the development path loads, the extracted runtime
performs the same deployment-proved re-admission and publishes the overlay in
one synchronous swap. HMR behavior and production refusal semantics are
unchanged.

Metrology now asserts both sides of this boundary for
`external-react-application` and `react-external`: the static closure must not
contain `react-binding-hmr.mjs`, and the output must retain the external
dynamic import. On current HEAD the heavy HMR module is absent; the previously
inflated validator and RQS ownership are back to 232 and 1,018 bytes,
respectively, and `react-binding.mjs` owns 7,613 bytes after later feature
landings. No successor ceiling includes the removed HMR implementation.

## Later main growth and the small-drift cluster

Current HEAD contains accepted changes that postdate the original measurement:
LLP 0179 `provider.surface`/`useSurface`, LLP 0180's synchronous command-task
projection, its asset child, and operation-lifecycle/store correctness work.
After removing HMR, the two React profiles are 89,345 / 89,170 minified. Their
largest retained owners are the real shipped React module (49,290 / 49,137),
assets (14,670), and commands (9,824).

That remaining mass is classified as **legitimate feature weight** under the
current root API. `provider.surface(...)` is a synchronous capability of every
prepared provider, and LLP 0180 requires command `start()` and `retry()` to
synchronously return stable task objects. An asynchronous import would change
those contracts. A compatibility-preserving narrow React composition is
tracked separately in
`issues/20260806-react-optional-capability-composition.md`.

Following the 2026-08-04/05 precedent, historical receipts remain immutable.
`baseline.client-bundle-disposition.v1.json` advances exactly the ten profiles
still over ceiling after the accidental HMR bytes are removed:

| profile | predecessor min/gzip/brotli | successor min/gzip/brotli |
| --- | ---: | ---: |
| `external-react-application` | 50,114 / 15,841 / 13,908 | 89,345 / 27,938 / 24,378 |
| `react-external` | 49,943 / 15,781 / 13,865 | 89,170 / 27,875 / 24,315 |
| `public-subpath-assets` | 13,860 / 5,564 / 4,814 | 15,229 / 5,879 / 5,087 |
| `resolved-public-subpath-assets` | 13,864 / 5,555 / 4,817 | 15,238 / 5,883 / 5,087 |
| `public-subpath-outbox-shared` | 16,352 / 5,841 / 5,236 | 18,377 / 6,494 / 5,811 |
| `public-subpath-rqs-registered` | 32,045 / 10,649 / 9,383 | 32,045 / 10,650 / 9,387 |
| `public-subpath-rqs-store` | 34,851 / 12,233 / 10,811 | 37,597 / 13,123 / 11,580 |
| `public-subpath-rqs-store-default` | 53,835 / 16,393 / 14,444 | 57,291 / 17,435 / 15,397 |
| `public-subpath-rqs-store-expo` | 36,669 / 12,468 / 11,023 | 38,946 / 13,163 / 11,660 |
| `public-subpath-rqs-store-file` | 35,156 / 12,151 / 10,770 | 37,481 / 12,855 / 11,368 |

The new `./commands` export also receives two prospective first-run profiles
instead of mutating the earlier nine-profile local-sync-absence receipt:
`public-subpath-commands` is 24,752 / 8,643 / 7,510 and
`resolved-public-subpath-commands` is 24,761 / 8,647 / 7,511. The resolved
profile continues to prove the local-sync modules are absent.

## Verification

The rollover writers and final `client-bundle-metrology --check` ran the full
JavaScript metrology behavior train: 56 profiles, no frozen-ceiling
regressions. Direct verification covered the packaged client, browser closure,
client commands, packaged React bindings, React commands, and all HMR handoff
scenarios. `./ref-check --verbose` also passed with 188 LLP documents, 3,425
references, and zero errors or unchecked references.

This gate is JavaScript-only. The original reproduction note suggesting an
Ibex bootstrap and Cargo build was unrelated to client-bundle metrology and is
removed from the disposition path; only installed JS dependencies and the
pinned Node runtime are required.
