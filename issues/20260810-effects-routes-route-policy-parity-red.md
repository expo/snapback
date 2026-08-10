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
