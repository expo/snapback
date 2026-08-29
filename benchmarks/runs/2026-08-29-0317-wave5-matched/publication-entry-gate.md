# Wave 5 publication entry gate

**Observed:** 2026-08-29  
**Candidate:** Snapback `0.1.30`  
**Source revision:** `eb9989261ddb31afce40f31e6cc401cafb5074f1`  
**Disposition:** blocked before registry mutation

Wave 5 step 4 requires a published pin before any candidate cell may begin.
The exact candidate was built for both runtime platforms and completed
receiptless pass-1 staging. Its staged runtime identities were:

| Platform | Runtime binary SHA-256 |
| --- | --- |
| `darwin-arm64` | `a14e3cee9ad6f9183ba83c9f54a6e6c5954cddd20fc446afb0151f060c48fdaa` |
| `linux-x64` | `491d19e927214cbbd5757d1f69aaa969d73e36bb492a82b1f684235562988cb2` |

Darwin store qualification then refused with
`SNAPBACK_PUBLICATION_CAPABILITY_REQUIRED_MISSING`: codegen requires
`assets.media-collection.v1`, but the public-package runtime advertisement
does not support it. `assets.media-command.v1` is transitively in the same
blocked family. No npm publish or dist-tag mutation ran.

This is an honest O26 prevention result. The public package must retain the
LLP 0110 relation/activity GAPs until the release-key-verified
`PackageCapabilityAttestationV1` exists; contributor-source evidence and the
single-table qualification receipt are not substitutes. The repository's
2026-08-06 author ruling defers that attestation to the 2026-09-30 review.

Registry probes after the refusal returned `@expo/snapback` latest `0.1.29`
and E404 for exact `0.1.30`. Therefore:

- published `0.1.29` Explicit baseline cells may run with the repaired
  `social-messenger@0.3.5-m8` instrument;
- Familiar baseline cells remain behind their preregistered candidate-first
  order and do not run early;
- all `0.1.30` cells are blocked at the publication entry gate; and
- no matched-pin existence or ordering comparison can be claimed from this
  partial matrix.

The product blocker and exact authority boundary are recorded in
`issues/20260815-finish-media-happy-path.md`.
