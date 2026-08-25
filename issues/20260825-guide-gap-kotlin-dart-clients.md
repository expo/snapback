# Guide gap: Kotlin and Dart client arms do not exist

**Status:** Open
**Systems:** Guide, Native clients, Capability registry
**Date:** 2026-08-25
**Governing:** LLP 0064, LLP 0093
**Capability row:** `clients.non-js`

## Gap

The versioned protocol and language-neutral conformance corpus exist, and the
in-repository Swift arm proves part of that contract, but Snapback has no Kotlin
or Dart client. The closed Swift consumability ticket corrected the Swift
nonclaim; it did not deliver either missing client arm.

## Acceptance

- at least one maintained Kotlin or Dart arm consumes the protocol and passes
  the applicable conformance corpus;
- its installation, target, auth, live, and lifecycle boundaries are taught in
  the Guide; and
- `clients.non-js` is split or promoted to match the exact shipped arms.
