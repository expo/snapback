READY

D4 honesty holds. Factory refuses `sync: "reauthorize-on-change"` with `SNAPBACK_CUSTOM_AUTHORIZATION_PRECISE_COMPLETENESS_UNAVAILABLE` (`define.mjs:241`). Brand-only forgeries never reach a generated precise fact: AST extraction requires `authorization.custom(...)` (`index.mjs:4182`). Review validation rejects any non-coarse fact (`authorization-review.mjs:443`). Activation rejects `preciseInvalidation`, `inputCompleteness != unproven`, non-`coarse-global` sync, retention, or pushdown (`manifest.rs:5388`). Completeness warning is unconditional `warn()` (`index.mjs:4373`); familiar disposition 4 routes custom auth to explicit rather than silencing it. Coarse wake is real: `custom_authorization.is_some()` returns `ConservativeFallback` before the Ibex read-set skip (`live_matcher.rs:178`), so an unrelated table write resnapshots/re-runs the evaluator (replace lane, `local.rs:25667`). Auth-context is forced onto `userId`+`opaque` dependence (`index.mjs:5466`, `manifest.rs:5437`). Incapable target refuses (`index.mjs:4321`). `UNCOMPOSED_READ_SURFACE` is only the unknown snapshot-batch error (`index.mjs:4653`); custom auth does not suppress it.

Search compile-direct is honest. Codegen closes authored `roles: ['member']` through `roleLattice` into `['admin','member','owner']` and writes the existing `SearchVisibilityV1::Membership` carrier (`index.mjs:3644`; `demos/rbac/snapback/generated/schema.manifest.json:572`). No second visibility-plan consumer. Runtime seat miss takes the ordinary zero-candidate path (`search/sqlite.rs:2015`); unit tests pin outsider ≡ absent-scope ≡ revoked (`search/sqlite.rs:2874`, `2901`). Generation-consumer allowlist still covers the only new profile reader (`membership_rules.rs` D6); search/sqlite does not touch `AuthorityProfileV1` fields. `invited` stays out of the closed search roles.

D6 auth is pre-lookup. Route is `AdminWrite` (`admin.rs:4415`). `inspect_body` is false for this path (NotApplicable, `effect_policy` None, not in `registered_invocation_source`), so the route layer authorizes then returns without `next()` / JSON extract (`server.rs:13003`, `13550`, `13566`). Unauthenticated distinct principal/scope probes are byte-identical 401 (`admin.rs:6334`). Public `/inspect` drops `customAuthorization` (`manifest.rs:10435`). Payload is ids/enums/policy identities; private membership query projects `_id`/role/status/provenance ids only (`membership_rules.rs:1051`). Unauthorized callers never see profile/scope/principal distinctions.

RBAC acceptance asserts the report: member hits, Bob≡Eve outsider bytes, post-join hits, post-leave search equals the captured outsider page (`demos/rbac/tests/acceptance/rbac.mjs:462-601`). Asset composition still refused (`index.mjs:3661`). New runtime code `SNAPBACK_CUSTOM_AUTHORIZATION_MANIFEST_INVALID` is HTTP 400 (`api_error.rs:1296`).

MINOR

1. `llp/0240-application-authority-profiles.rfc.md:580` — Open question 2 still asks compile-direct vs visibility plan after D2 already records compile-direct.

2. `packages/snapback-codegen/index.mjs:4391` — `compileCustomAuthorization` copies `declaration.sync` and does not itself refuse `reauthorize-on-change`. Closed by factory + review validate + activation, not by the compiler lane.

3. `demos/rbac/tests/acceptance/rbac.mjs:593` — revocation byte-identity compares query `"revocation"` to the earlier `"members"` outsider page. Holds only because empty pages do not echo the query. Absent-scope is not asserted here (covered by `search/sqlite.rs:2874`).

4. `packages/snapback-codegen/index.mjs:3644` — compile-direct does not constrain `storedFields`/`textFields` to `roster.visibleFields` when the searched table is the profile membership table. A private roster column could be search-projected to members while `list` hides it. Shipped RBAC searches `announcements`, not `appMembers`.

5. `src/membership_rules.rs:949` — view `membership-visible-search` admits any Active seat when the composition class is permitted. It does not consult a particular index's lowered role set. An admin-only index would still D6-Admit a `member`.
