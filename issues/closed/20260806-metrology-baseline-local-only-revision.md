# S2 bundle baseline named a local-only source revision

**Status:** Closed — fixed forward 2026-08-06
**Opened:** 2026-08-06
**Systems:** Client bundle metrology, CI, Git history
**Related:** LLP 0145, LLP 0179, GitHub Actions runs `31142327486` and
`31147355293`, PR #18

## Failure

`client-bundle-metrology --check` reproduced every current profile, then failed
while reopening the frozen S2 command baseline. Its recorded revision
`c7433d34cb8a1de0297eefa3381a5cfb9e99ec7f` exists only in the local object
store and is not reachable from the GitHub repository, so a clean CI checkout
could not reopen `packages/snapback-client` at that identity.

## Attribution

The S2 freeze landed in `382958bde3` with the pre-landing local commit identity.
The same client, Contract, and React package trees subsequently landed under
reachable commit `9884a820c66f4c6abd624641400ca5663eaef3c4`; local proof had masked the
mistake because the unreachable object remained available in this clone.

## Resolution

The baseline now names reachable commit `9884a820c66f4c6abd624641400ca5663eaef3c4`.
All three recorded package-tree hashes are byte-identical at that commit, so no
measurement, ceiling, profile, or disposition changed. The v2 disposition's
predecessor digest was refreshed to authenticate the corrected S2 receipt, and
the complete 56-profile metrology train passes against the resulting chain.

## Successor receipt recurrence — GitHub run 31147355293

The next clean runner reopened the older v1 disposition and found the same
provenance class independently: revision `7c5728ae5ac2d57b9b1f50d97c814fade3294502`
exists, but predates `packages/snapback-client`, so it cannot authenticate the
three package-tree hashes recorded beside it. Those hashes are again
byte-identical at reachable revision
`9884a820c66f4c6abd624641400ca5663eaef3c4`. The v1 source revision and its v2
predecessor digest are corrected together; ceilings and measurements do not
change.
