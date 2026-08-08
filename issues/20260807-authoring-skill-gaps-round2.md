# Authoring skill: six content gaps from the four-lane measurement

**Status:** Open
**Impact:** 2
**Urgency:** 3
**Ease:** 4
**Confidence:** 5
**Systems:** Agent skills, Guide
**Date:** 2026-08-07
**Related:** Diary 0068 (four-lane measurement, 0.1.13)

Round 2, from diary 0068's lanes: (1) headless command invocation lives
at `app.commands.*`, not on the `api` export; (2) `createAssetClient` root
export gap → use the /assets subpath (drop when the export ticket closes);
(3) supervisor reclaims Metro/bootstrap when the backend dies — "stop the
backend, keep the client" proofs need the cached-binding cold-boot lane +
`EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN`; (4) verify-config authoring: the
identity-bound profile shape lives in the CLI package's verify.mjs — add
the guide anchor; (5) sessions-mode non-session clients need
`authClientProtocol: 1` + `custody: 'anonymous-public'` together; (6)
`snapback dev --expo` supervises but never launches a device/simulator —
launching is the author's job. One or two lines each; sync the packaged
copy (byte-match test enforces).
