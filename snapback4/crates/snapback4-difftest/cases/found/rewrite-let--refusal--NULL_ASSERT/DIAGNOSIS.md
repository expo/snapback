# rewrite-let--refusal--NULL_ASSERT

2026-10-07. Diagnosis: **harness defect, fixed**.

Both programs assert the same null argument and correctly refuse NULL_ASSERT.
`return (n ! else NULL_ASSERT)` versus `answer = (n ! else NULL_ASSERT)` moves
the assertion from source column 13 to 15. Source columns are not invariant
under this rewrite. The public bound Require statements retain their explicit
source sites. The harness relates the same ordered assertion/code roles while
retaining and comparing the full refusal envelope. `replay` now passes.
Shipped code is unchanged.
