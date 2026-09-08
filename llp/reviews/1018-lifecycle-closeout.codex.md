# LLP 1018 lifecycle/consumer closeout review — Codex

**Reviewer:** fresh independent collaboration session `/root/lifecycle_closeout_review`
**Model provenance:** Codex, identified as GPT-6; exact variant/effort unavailable
**Date:** 2026-09-07
**Target:** 703bc5235, base d7e130e54; architecture source pinned 02e13629b
**Method:** eight read-only source/diff/probe inspection calls; no tests, builds or edits
**Verdict:** one material P2 correction required

The initial census incorrectly grouped `startOffline` with purely internal
controls. Pinned `src/expo/index.ts:28–40` exports `CreateExpoClientOptions`
containing that option and exported `createExpoClient` accepts it. Expo
`Witness.tsx:39` consumes it. Absence from base `CreateClientOptions` does not
make the Expo option internal. Split it from `offlineReadObserver` and
`offlinePrincipal`.

No additional material finding in the bounded review. Inspected lifecycle
boundaries support separate query identity, shared snapshots, durable
settlement, authority fencing and maintained-target retirement. The pinned
negative mask and probe support missing-base suppression at both issued
sequences; source hash and stated stub/integration limits match. Native
migration guidance matches scalar-only extraction, Scalar range prefixes,
`Vec<Value>` point keys, `n2_suffix`, missing PartialEq and canonical IDs. The
ticket retains public cold-reopen/cap acceptance and leaves architecture repair
and qualification outstanding.

**Author disposition:** accepted. Correction `c99496ac7` separates the public
Expo startup option from the internal base-client controls. No runtime change
was requested or made by this review.
