# LLP 0134 receipt/comment digest cycle blocks first real promotion

**Status:** Closed
**Systems:** Testing, Capability publication
**Related:** LLP 0134 §4 and A2/A5,
`issues/closed/20260802-wave1-0134-capability-maturity.md`

LLP 0134 §4 originally required the maturity registry comment to cite the
promotion receipt's SHA-256. The same receipt carries
`stagedTreeManifestSha256`, computed over the staged tree with exactly one
excluded path: the receipt. That tree therefore includes the registry comment,
creating a cryptographic self-reference with no constructible write order.

## Resolution — 2026-08-02

Chose option 1. The registry comment now cites the exact repo-relative
promotion-record path and the closed
`@ref LLP 0134#4-the-promotion-act` marker, with the promotion UTC date; it no
longer duplicates the receipt digest. A2/A5 continue to bind the receipt's exact
bytes, capability set, sole candidate parent, same transition commit, and
complete self-excluding landed tree.

`scripts/capability-maturity.mjs` mechanically refuses a promotion whose
`src/manifest.rs` lacks the exact dated path citation.
`tests/capability-maturity.test.mjs` retains the end-to-end constructible
promotion/demotion history and adds a negative citation case. The dated LLP
0134 correction records why removing the redundant digest weakens no existing
same-commit, parent, or tree check.
