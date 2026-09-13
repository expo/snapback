# hosted lifecycle carrier and custody GAP

**Status:** open
**Owner:** Snapback hosted control plane
**Opened:** 2026-07-28
**Authorities:** LLP 0111, LLP 0113


## Triage (2026-08-26 leftover sweep)

Still open. LLP 0111 and LLP 0113 are **Accepted**. `hosted-control.mjs` availability is still `disabled` / `SNAPBACK_HOSTED_LIFECYCLE_CARRIER_INCOMPLETE`. Criteria 1–6 remain unmet.

## Problem

The generated `AdapterLifecycleRequestV2`/`AdapterLifecycleResponseV2` carrier
names all seventeen lifecycle operations but cannot express the closed,
operation-specific authority and recovery facts LLP 0111 requires. The gap
includes exact desired provider state, verified upload/backup/migration
receipts, cutover state, uncertain-attempt reconciliation evidence, and an
internal opaque lease handle bound to provider lease expiry, version,
supervisor generation, and control head.

The standing supervisor bootstrap also does not yet install and prove the
operator client CA, current purpose-limited response intermediate, native
custody helper, public mTLS listener, and live Fly/Tigris receipt as one
release-qualified closure.

## Current fail-closed behavior

- Every lifecycle operation, including `releaseLease`, reports
  `SNAPBACK_HOSTED_LIFECYCLE_CARRIER_INCOMPLETE`.
- The provider executor resolves no credential and performs no Fly or Tigris
  call for a blocked operation.
- The packaged CLI reports lifecycle availability as `disabled` and names the
  missing evidence.
- `releaseLease` does not expose or accept the Fly nonce as a public lease id.

## Resolution criteria

1. A separately reviewed LLP authorizes closed per-operation carriers without
   inventing a private V3 dialect.
2. Rust-owned schemas and all package mirrors land with exhaustive
   unknown-field and registry-equality tests.
3. Lease custody uses a supervisor-only journal and opaque public handle bound
   to exact current expiry, provider version, supervisor generation, and
   `HostedControlHeadV2`.
4. Bootstrap proves current purpose-head custody, public listener reachability,
   and wrong-role/cross-target credential refusal.
5. A packed live Fly/Tigris journey proves reservation-before-effect,
   interruption recovery, canonical control-head CAS, and zero pre-evidence
   capability advertisement.
6. Only then may the per-operation availability registry advance from
   `disabled`.

## Triage freshness note (2026-08-01 sweep)

Still valid. Since filing: the workspace scope rename (22ef5079)
moved the mirrors to @expo/snapback-*, and 0.1.8 published the disabled
lifecycle registry — 'the packaged CLI reports availability disabled'
(packages/snapback-cli/hosted-control.mjs:95-96, blockerCode
SNAPBACK_HOSTED_LIFECYCLE_CARRIER_INCOMPLETE) is now a public-registry
fact, raising the bar on resolution criterion 6. LLP 0111 is Review
(revised 2026-07-30, decision pending).
