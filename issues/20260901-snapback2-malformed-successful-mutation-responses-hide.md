# snapback2: malformed successful mutation responses hide post-commit uncertainty

**Status:** Open
**Systems:** snapback2, client, mutation wire
**Severity:** P1
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/packages/snapback2/src/client.ts:534-541

Failure scenario: the owner commits a mutation, but its HTTP 200 body is truncated or loses a required field in transit. response.json or wireMutation throws a non-retryable E_WIRE_SHAPE; useMutation leaves transport unset. The caller can reasonably retry and duplicate the already-committed write.

Why it happens: successful-body JSON and shape failures are classified as terminal operation refusals regardless of request kind. The mutation method has no ambiguity boundary after the request is sent, while LLP 1002 requires every possible post-commit uncertainty to remain transport and leave last untouched.

Suggested fix: classify mutation response decode/shape failure as retryable ambiguous transport (without automatic mutation retry), set the hook transport state, and preserve last. Add truncated JSON and malformed committed-envelope tests after a server-side commit.
