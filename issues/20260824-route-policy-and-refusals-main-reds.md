# Inherited main reds: route_policy_v1 (4 failures) and served_http_refusals digest

- Status: Open
- Date: 2026-08-24
- Systems: crates/snapback (route_policy_v1), crates/snapback-server tests
- Governing: LLP 0189 (fix-forward), LLP 0232
- Found by: the LLP 0301 Lane A landing's verification

Reproduced identically at base `2dfb176d6` (clean bootstrapped worktree):

1. `route_policy_v1`: 28 passed / 4 failed —
   `registry_and_router_have_black_box_path_method_parity` (the router has
   `POST /auth/guest/claim/password`, the frozen expected set does not — the
   guest-entry landing did not extend the baseline),
   `auth_provider_routes_are_classified_and_dev_refusal_is_opaque_no_store`,
   `sessions_presented_optional_bearer_fails_closed_before_dispatch`
   (`SNAPBACK_AUTH_PROVIDER_UNAVAILABLE` vs expected
   `SNAPBACK_AUTH_PROJECTION_UNAVAILABLE`), and
   `sessions_runtime_rejects_body_auth_on_every_http_ingress`.
2. `snapback-server::served_http_refusals_project_typed_candidates_and_argument_contracts`:
   manifest digest `sha256:000b4026…` vs expected `sha256:8686ea0f…` — the
   assertion trails the checked-in Todo manifest.
3. `snapback-activation` lib tests do not compile:
   `no method named private_failure_context` at
   `crates/snapback-activation/src/config.rs:1059` (test harness only; the
   production build passes).

Likely owners: the guest-entry landing (1), the manifest re-stamp
`6a4d913c2` (2), and the F-1 diagnostics refactor (3). The LLP 0301 Lane A
landing extends the route-policy expected set ONLY with its own new
identity route and does not touch these.
