# Hosted authorization posture detection and security notification

**Opened:** 2026-08-18
**Owner:** LLP 0105 P0.5 / Expo-hosted control plane
**Systems:** Hosted platform, Security/authorization, Deployment, Observability, Notifications
**Related:** LLP 0103, LLP 0105 P0.5 and Gates 0–1, LLP 0156, LLP 0173, LLP 0234, LLP 0264, LLP 0274

## Problem

LLP 0105 now requires hosted admission to reject implicit or incomplete
authorization posture, to record each admitted release's exact authorization
review posture, and to notify project owners when a high-confidence exposure is
discovered after activation. The repository has the machine-readable source in
`generated/authorization-review.json`, and LLP 0103 already makes permissions
part of deployment admission, but the hosted control plane does not yet define
the finding lifecycle or product-security notification operation.

This is not Supabase's literal “RLS disabled” condition. Snapback exposes named
operations rather than an ad-hoc table API. A useful finding must therefore
prove a reachable path from external invocation authority through an operation
and data surface to an exposed read or write effect. A table policy or function
auth declaration alone is not a vulnerability verdict.

## Required design and implementation

Before LLP 0105 private beta:

1. Define a versioned hosted authorization-posture record bound to app,
   environment, release, deployment identity, authorization-review
   `inputsHash`, derived posture digest, and predecessor posture digest.
2. Define the exact admission refusal set from LLP 0105 P0.5 and prove that no
   production-profile compatibility warning becomes warn-and-serve.
3. Define a closed finding schema that distinguishes at least
   `confirmed-exposure`, `review-required`, `resolved`, and a stale/superseded
   release. A confirmed finding must carry the exact reachable path and may not
   be inferred merely from `public`, `optional-user`, `public-read`, or
   `open-write`.
4. Select rescan triggers. At minimum they include activation/promotion,
   governed policy-program activation, target-capability changes that affect
   enforcement, and repair/reconciliation of a previously incomplete posture
   record. Periodic scanning is optional unless one of those inputs can drift
   without an event.
5. Resolve recipients from current Expo project/organization ownership and any
   future explicit security-contact setting. Transfer, suspension, deletion,
   and stale-release cases must not notify an obsolete owner or leak project
   existence.
6. Specify durable delivery, retry, deduplication, cooldown/escalation, and
   acknowledgement/suppression semantics. Suppression may control delivery; it
   may not authorize deployment, mutate the posture record, or relabel a
   confirmed path as safe.
7. Reuse an existing email/webhook transport where appropriate, but keep the
   security-finding lifecycle distinct from LLP 0156 runtime error groups.
8. Redact row values, credentials, protected arguments, secrets, and raw
   handler results from stored findings and notifications. The notice should
   contain operation/table/policy identities, exposure class, first/last
   observed release, and a precise remediation path.

## Acceptance

- Production admission refuses fixtures for legacy-default function auth,
  implicit legacy table visibility, uncomposed table-policy surfaces, and
  migration-pending/incomplete generic write posture before any route serves.
- Activation stores an authorization-posture record whose input hash matches
  the admitted artifact graph; promotion compares the exact predecessor and
  successor records without inventing approval authority.
- A reachable anonymous-read and anonymous-write fixture each produce one
  path-specific `confirmed-exposure` finding after injected post-activation
  discovery; retry is durable and duplicate scans do not duplicate notices.
- Explicit-public controls that are reachable by design produce no
  vulnerability finding merely from their declarations.
- An opaque-handler fixture is `review-required` and is never described as a
  confirmed leak or compromise without additional evidence.
- Transfer and stale-release fixtures notify only the current authorized
  project recipient set and reveal no project or finding data to the former
  owner.
- Stored findings, dashboard projections, delivery payloads, and delivery logs
  contain no protected values or credentials under sentinel tests.
- A muted or acknowledged finding still blocks any admission rule it violates;
  notification state cannot act as a waiver.
- The internal canary injects confirmed, review-required, resolved, duplicate,
  delivery-failure, transfer, and intentional-public cases before Gate 1.

## Scope boundary and LLP trigger

This issue does not design general runtime anomaly detection, abuse detection,
incident response, or a proof system for arbitrary JavaScript. It also does not
own the email/webhook transport itself.

Graduate the work to a dedicated LLP only if implementation needs a new
cross-cutting security-findings subsystem—for example a general severity and
lifecycle model shared across posture, abuse, runtime intrusion evidence, and
incident escalation. The scoped admission record and canary notification work
can land under LLP 0105 without another RFC.
