# snapback2: useAuth lets stale me requests overwrite logout or a new client

**Status:** Closed
**Resolution:** Added auth request epochs and client identity guards in packages/snapback2/src/react.tsx; added deferred logout and provider replacement tests.
**Systems:** snapback2, react client, auth
**Severity:** P2
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/packages/snapback2/src/react.tsx:208-226

Failure scenario: an old-token /auth/me request is delayed. logout completes, clears the token, and sets anonymous; then the delayed request returns 200 and setState changes the hook back to authenticated with the old viewer. A delayed request from a previous client prop can likewise overwrite the new client state.

Why it happens: each token/client change launches me(), but there is no request generation, cancellation, or mounted/latest check. Every completion writes state unconditionally, and logout does not invalidate in-flight calls before awaiting.

Suggested fix: maintain a monotonically increasing auth request epoch or AbortController, invalidate it before logout and on client/token changes, and allow only the latest request to update state. Add deferred-response tests for logout and provider client replacement.
