# Extract the recurring starter acceptance harness from app-owned source

**Status:** Closed
**Impact:** 4
**Urgency:** 4
**Ease:** 2
**Confidence:** 4
**Systems:** Verification, Templates, Acceptance, CLI, Developer experience
**Date:** 2026-08-21
**Governing:** LLP 0275 P5/P6/D5/D6; LLP 0146 D2; LLP 0196
**Evidence:** Messtimate published-0.1.24 diary (~680 lines of app-owned
acceptance plumbing)

## Problem

First-party templates copy a large acceptance implementation into each app.
Most of the file owns platform lifecycle, session minting, readiness, receipt
shape, cleanup, retries, and conformance projection rather than product intent.
Authors are invited to rewrite it, but the verifier then depends on implicit
structural details such as exact receipt fields. LLP 0275 D5 removes duplicated
path identity; it does not by itself remove the duplicated runner machinery.

This is both authoring cost and drift risk: every app carries a private fork of
the proof adapter, while verifier changes can make that fork fail in ways the
app cannot diagnose.

## Required design

- Inventory the common harness across React, CRUD, media, and Expo templates
  and split platform-owned lifecycle/receipt code from app-owned journey steps.
- Publish a small supported runner/builder whose inputs are generated operation
  identities and bounded journey callbacks, not raw receipt JSON assembly.
- Compose with LLP 0275 D5's single-source path registration and the exact
  field diagnostics ticket; do not create a second proof authority.
- Keep application assertions and evidence intent visible in app source.
- Preserve the ability to eject or extend the harness for advanced suites with
  an explicit compatibility contract.

## Acceptance

- A starter app changes its domain operations without copying or editing
  platform lifecycle, cleanup, identity, or receipt-shape plumbing.
- Packed-package fixtures prove timeout, cleanup, stale operation, failed
  assertion, malformed result, and verifier-version compatibility.
- The app-owned source is primarily product journey code; line-count reduction
  is measured but never earned by deleting checks or weakening the claim.

## Resolution (2026-08-22)

Implemented the publishable `@expo/snapback-acceptance` root entrypoint and moved
the shared lifecycle, application-readiness wait, identity inspection,
ordinary-session minting, bounded steps/polling, cleanup, receipt projection
and validation, and starter conformance projection into it. React, CRUD,
media, and Expo now keep their generated-operation declarations and bounded
product journey callbacks in `acceptance.mjs`; their verify profiles derive
path registration and provenance from those same declarations. Direct runner
execution remains raw debugging evidence and `snapback verify` remains the
only aggregate done-oracle.

The public package README and all four template READMEs record the supported
extension/ejection contract: add app-owned steps and cleanup, replace process
lifecycle through `StarterLifecycleAdapterV1`, or retain the public v1
receipt/projector/validator contract when fully ejected. Deep imports and
platform implementation details are not compatibility surfaces.

App-owned acceptance source changed from 1,266 to 822 lines overall (35%
smaller): React 369→152, CRUD 92→102, media 127→127, Expo 678→441. The two
smaller files did not earn a reduction by collapsing product evidence: CRUD
now binds update/delete to their generated operations, and media retains
separate thumbnail/display delivery steps. The 444-line portfolio reduction
comes from React/Expo platform plumbing; the one shared implementation is
centrally tested and shipped once.

Verification completed:

- the packed package suite covers passing admission, reverse cleanup, timeout,
  assertion failure, malformed detail, stale generated-operation remediation,
  and verifier receipt-field drift without app-source edits (7/7);
- materialized tarball installs ran all four live suites through the shared
  runner: React 7/7, CRUD 4/4, media 4/4, Expo 13/13, all with complete cleanup;
- a packed media scaffold passed `snapback verify`, including all four
  builder-derived registered paths (both generated-operation and delivery
  paths) and the package-owned unsupported-provenance conformance projection;
- CLI verify (50/50), four static template suites, publication-authority
  compatibility (14/14), cold-install library tests (45/45), public-package
  README funnel, package-test inventory (330), retrieval eval (90 cases), and
  `ref-check` passed in affected scope.

The complete guide/inventory commands also ran. They retain unrelated ambient
reds from missing generated demo/Contract artifacts and stale diagnostics and
symbol registries; the inventory report introduced no acceptance-package or
template registration failure.

**Landing SHA:** TBD
