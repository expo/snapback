# Extract the recurring starter acceptance harness from app-owned source

**Status:** Open
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

