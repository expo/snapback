# Snapback 4: Cross-origin pages can use loopback personas and seed

Status: Closed
Resolved: 2026-09-13
Priority: P0
Observed: 2026-09-13
Review finding: S01
Evidence: Code-traced; DNS-rebinding argument. Not browser-exercised in this pass.
Baseline: `6918cccbc264cf000982b03a5a11a2cf5563f885` / Snapback 4 0.1.15
Related: [security review](../../llp/reviews/3000-security-review-20260913.md), [LLP 3000](../../llp/3000-snapback4.explainer.md)

## Problem and reproduction

`snapback4 dev` binds `127.0.0.1` and treats a loopback TCP peer as the developer: `x-snapback-persona` becomes `dev:<name>` and `POST /seed` writes as the system principal, bypassing every insert rule. Every JSON response, including those doors, sends `Access-Control-Allow-Origin: *` and allows the persona header. There is no Origin allowlist and no `Access-Control-Allow-Private-Network` header.

A page whose origin is not the developer can therefore:

1. DNS-rebind `attacker.example` to `127.0.0.1:4400` (Private Network Access does not apply once the origin is local).
2. `OPTIONS` then `POST /seed` with a JSON array of `{table, row}` and impersonate `alice` on `/q/*` and `/m/*` via `x-snapback-persona`.
3. Read the CORS-exposed JSON.

Chrome's public-to-private preflight is not a complete mitigation. Safari/Firefox PNA coverage is incomplete; another process on the machine already has a loopback peer address.

`serve` refuses both doors. The hole is the default development server that holds the project store.

## Acceptance

- Reject cross-origin use of personas and `/seed` (allowlist `Origin`, or bind a random unguessable prefix, or require a loopback-only secret header that browsers cannot set from a foreign origin without CORS permission you do not grant).
- Keep same-origin `snapback4 dev` + the reference app working.
- `serve` must continue to refuse both doors even from loopback.
- Add a regression that a foreign `Origin` cannot seed or act as a persona.

## Implementation locations

- [crates/snapback4/src/serve.rs](../../snapback4/crates/snapback4/src/serve.rs) (`cors`, `principal_of`, `/seed`)
- [crates/snapback4/src/main.rs](../../snapback4/crates/snapback4/src/main.rs) (`dev` bind)

## Resolution — 2026-09-13

Development requests now require a loopback peer, one literal-loopback/localhost Host, and an absent or valid local Origin. Foreign, null, duplicate, and rebinding hosts/origins are refused before routing. CORS reflects only the admitted local origin. Deployed serve still refuses personas and seed. Raw HTTP regressions exercise both denied requests and admitted local development; this does not claim a live DNS-rebinding browser experiment.

Validation: Linux `cargo test --workspace --no-fail-fast --quiet`, wasm build, and the full `scripts/test.sh` at `8d8c1b7c170183d6a54d7a37af8b34596410160d` passed (0 failures in 45 seconds; 71 client tests). The final audience-index selection correction at `90152c6f2` passed its affected regression. See the [remediation and review record](../../llp/reviews/3000-security-remediation-20260913.md) for review scope and follow-up integration fixes.
