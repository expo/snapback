# LLP 0134 receipt/comment digest cycle blocks first real promotion

**Status:** Open
**Systems:** Testing, Capability publication
**Related:** LLP 0134 §4 and A2/A5,
`issues/closed/20260802-wave1-0134-capability-maturity.md`

LLP 0134 §4 requires the maturity registry comment to cite the promotion
receipt's SHA-256. The same receipt carries `stagedTreeManifestSha256`, computed
over the staged tree with exactly one excluded path: the receipt. That tree
therefore includes the registry comment.

There is no constructible write order: changing the comment to the receipt
digest changes the staged-tree digest; changing the staged-tree digest changes
the receipt digest; changing the receipt digest changes the comment again.

Before the first real promotion, make a dated LLP 0134 correction choosing one
closed answer without weakening the existing same-commit/parent/tree checks:

1. remove the redundant registry-comment digest and cite the record path plus
   LLP section (A2/A5 already bind its exact bytes and commit), or
2. define a second self-excluding digest domain whose exclusions and purpose
   are explicit and mechanically validated.

The 2026-08-02 implementation deliberately does not claim this comparison.
All other A1/A2/A5 pins are executable and tested.
