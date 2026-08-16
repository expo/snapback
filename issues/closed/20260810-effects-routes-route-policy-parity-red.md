# main red: /effects routes break route_policy_v1 parity + body-auth ingress coverage

- **Status:** Open
- **Date:** 2026-08-10
- **Systems:** server routes, route registry, testing
- **Detected during:** clippy-debt landing verification (touched-target sweep)

At 84097094b (pristine tree, proven by stash-cycling an unrelated sweep away
and reproducing identically), `cargo test --test route_policy_v1` fails 2 of
32:

1. `registry_and_router_have_black_box_path_method_parity`
2. `sessions_runtime_rejects_body_auth_on_every_http_ingress`

Both point at the S5 approval-gated-effects routes — `/effects`,
`/effects/{id}/approve`, `/effects/{id}/deny` — mismatching between the
router, the route registry, and the black-box probe coverage set. None of the
commits between that base and current origin/main touch the involved files,
so this persists on main. Owner: the S5 Landing C (c575f221e) author —
register the routes in the registry/probe tables (or exclude them with the
documented exemption shape route_policy_v1 supports) and re-run the two tests.

Related main-red family: issues/20260809-main-red-handler-error-exposure-triple.md and
issues/20260810-main-red-fork-custody-unclassified-rehearsal-provenance.md
(different landings, same "new surface missed a reviewed inventory" shape —
like the s5_d10 diagnostic-inventory case there, this is the route-table
equivalent).

## Dated note — 2026-08-10 (third failing test in the same family)

At `45044929b` (pristine `src/`+`tests/`, proven by stash-cycling the
LLP 0223 changes away and reproducing identically),
`durable_watch_rows_pin_the_session_only_policy_tuples` also fails (6 != 5
at tests/route_policy_v1.rs:608) alongside the two above; the extra actual
tuple is `POST /watches/{id}/renew` (the D9.3 automations bundle,
`4e71043c8`), the same surface-missed-a-pinned-inventory shape. Whoever
fixes this ticket should pin all three: the `/effects` trio and the watches
renew row. Observed during LLP 0223 execution, which touches no routes
(`host_ops_v0` 13/13 and the mint lib tests are green on the same tree).

## Resolution — 2026-08-15 (backlog sweep)

The S5 effects trio and the D9.3 watches-renew row are now first-class
`route_policy_v1` inventory. `tests/route_policy_v1.rs` registers `/effects`,
`/effects/{id}/approve`, `/effects/{id}/deny`, and `POST /watches/{id}/renew`
in both the parity table and the body-auth probe set. The 2026-08-10 main red
(router/registry/probe mismatch) no longer matches the tree.
