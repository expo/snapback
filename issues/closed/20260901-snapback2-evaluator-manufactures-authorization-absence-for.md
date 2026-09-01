# snapback2: evaluator manufactures authorization absence for rule Exists

**Status:** Closed
**Resolution:** Made rule Exists require a held row, authority absence, or scoped verdict and suppress partial results; added missing/proved absence regressions.
**Systems:** snapback2, evaluator, authorization
**Severity:** P1
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/packages/evaluator/src/evaluator.ts:897-913

Failure scenario: posts.read is Not(Exists(blocks.byPair, [Viewer, authorId])). Hydrate a post but omit the referenced block row, an authoritative absence, and a scoped verdict. The evaluator treats the local miss as Exists=false, returns the secret post as fresh, and records no partial site; the receipt has no authority to prove that absence.

Why it happens: when no verdict is found, evaluateRule calls store.lookup and memoizes the Boolean directly. Unlike ordinary reads, it does not trace the lookup or require an absence proof. LLP 1001/1002 state that clients may issue held rows but may never manufacture absence or authorization.

Suggested fix: carry rule-probe coverage through the evaluator. A readable probe needs a held row or authoritative absence; a private probe needs a scoped verdict. Otherwise propagate Partial rather than a Boolean. Add the Not(Exists) missing-proof case.
