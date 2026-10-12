# UNION: expiry and acquisition windows deferred after disclosure reproduction

**Status:** Open
**Date:** 2026-10-12
**Systems:** Snapback 4 partition log, logical expiry, union admission, device windows
**Related:** LLP 3000.036.000.000 §§5, 8, 10

The coordinator explicitly authorized narrowing if the next GPT round found
another High around expiry/windows/epochs. The fresh round-10 session on
revision 11 reproduced a High D2 violation, then the provider terminated
before a final verdict. The actual transcript and incomplete provenance are
saved under llp/reviews; no final GPT review or READY is inferred.

Reproduction: non-expiring membership table `members[team, person]`; content
`notes` read by owner or members, with `expire at .until`. A Bob-owned row in
g expires at 2,000. Alice joins g at 3,000, after logical expiry but before
physical sweep. Her snapshot at 3,100 contains no note. Sweeping at 4,000
and streaming from snapshot watermark at 4,100 names the note id as a del,
although Alice could read it at neither boundary. The reviewer reproduced
both horizon-free and windowed unions at limits 1/2/1,000.

Revision 12 refuses expiry on union content and membership scopes (including
inherited ancestors), every union acquisition window, and windowed membership
scopes/ancestors. Diagnostics name the excluded source and offer `online only`
that preserves rule, lifetime and queries; removing only the sync window is a
working full-row alternative when no other excluded source remains. Per-arm
window planning and device boundary paths are removed. Full non-expiring
unions retain all supported column/group readers, generic commit accounting,
leave sparing, epoch guards and both-store disclosure coverage.

Future work requires a fresh commission and paired reviews before relaxing
admission. Address logical-expiry-before-acquisition D2 for the underlying
single-audience machinery as well; it predates unions and this narrowing
makes no claim to repair it. Require actual authority at content-lifetime
boundaries, not merely group membership at sweep time. Add delayed-sweep,
renewal/replacement, schema activation, inherited scope and page-straddling
witnesses on both stores before reconsidering union expiry/windows. No exact
horizon maintenance or released-store migration is claimed.
