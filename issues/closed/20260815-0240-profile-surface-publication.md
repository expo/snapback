# Confirm LLP 0240's authority-profile surface ships in the next publication

**Status:** Closed
**Filed:** 2026-08-15
**Closed:** 2026-08-15
**Systems:** Publication, Codegen, Auth, Guide
**Related:** LLP 0240 (application authority profiles), LLP 0056 dated
amendment “Bounded atomic bootstrap rosters (2026-08-15)” and its verification
note, Diary 0081-clique-0121-snapback-simplified

## Check

Filed as the container for a future-event check. The `authority.profile.v1`
capability row in `guide/capabilities.md` described the `AuthorityProfileV1`
surface as “Unreleased rollout-1,” so confirmation had to wait for the next
qualified publication.

## Resolution — 2026-08-15

The event had already occurred. The full `@expo/snapback*` catalog published
0.1.22 (npm `time.modified` 2026-08-16T00:34Z). A download of the published
`@expo/snapback-codegen@0.1.22` tarball verified that `index.mjs` contains the
`.authorityProfile(...)` authoring facade (43 `authorityProfile` occurrences)
and the `bootstrap(resourceValues, initialMembers?)` atomic-roster signature.
The companion runtime packages `@expo/snapback`, `@expo/snapback-cli`,
`@expo/snapback-client`, and `@expo/snapback-runtime-darwin-arm64` are all at
0.1.22. The publication check is therefore closed.

Publication does not resolve the capability-row wording/maturity follow-on:
`authority.profile.v1` still says “Unreleased rollout-1” even though its maturity
column says `shipped`. No existing open filesystem ticket specifically covering
that row was found during this check; updating the row is outside this ticket's
scope.
