# snapback2: deleting an unseen maintain source leaves a Fresh stale aggregate

**Status:** Closed
**Resolution:** Tracked missing delete preimages and applied maintained-target taint to both point and range reexecution until rehydration in both client twins; added point and range regressions.
**Systems:** snapback2, core client, maintained aggregates
**Severity:** P1
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/crates/snapback2-core/src/client.rs:46-122

Failure scenario: the server has waitlist row w1 and waitCounts[r]=1. Hydrate only maintainedWaitlistDepth(r), so the client holds the aggregate but not w1, then apply the certified deletion of w1. Locally the missing delete is a successful no-op and the aggregate stays 1; the server changes it to 0. Reexecution finds the held point and reports Fresh.

Why it happens: pair classification at snapback2/crates/snapback2-core/src/certificate.rs:437-469 does not retain maintain source preimages, delete deliberately no-ops on a missing row, and point freshness has no maintain-dependency taint. No later reconciliation changes the Fresh result.

Suggested fix: include maintain source/preimage requirements in pair certification, or conservatively mark affected maintained targets and query sites Partial whenever a local update/delete cannot observe its source preimage. Add this waitCounts case to both client twins.
