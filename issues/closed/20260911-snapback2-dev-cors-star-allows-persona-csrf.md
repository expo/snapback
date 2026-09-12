# Snapback 2 `dev` CORS `*` plus `X-Snapback-As` is persona CSRF

**Status:** Resolved
**Priority:** P2
**Date:** 2026-09-11
**Systems:** `snapback2/crates/snapback2/src/serve.rs` (`DEV_CORS_ALLOWED_HEADERS`, `respond_json`)
**Source:** Snapback 2 codebase review 2026-09-11
**Related:** LLP 1002 §4 / §9 (personas are a dev shortcut); serve mode already refuses the header

## Symptom

In `dev` mode every JSON and SSE response, including OPTIONS preflight, sends `Access-Control-Allow-Origin: *` and allows the `X-Snapback-As` header. `request_identity` treats that header as a persona, and `resolve_authority` **mints that persona on first use**.

A page the developer visits can:

```js
fetch('http://127.0.0.1:<port>/api/mutation', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Snapback-As': 'alice' },
  body: JSON.stringify({ op: '...', args: {} }),
})
```

pass preflight, impersonate or create `dev:alice`, and read the JSON because `*` lets the script see the response. `GET /` and `/api/manifest` are unauthenticated and also CORS `*`, so the page can scan loopback for a running owner first.

Serve mode closes this: personas are refused and CORS headers are omitted. Bearer CSRF is not the issue (the browser will not attach `Authorization` unless that origin already has the token). Persona CSRF is.

Removing `X-Snapback-As` from `Access-Control-Allow-Headers` would also break the paved Vite/Expo split-origin loop, which is how the React template talks to the owner. Reflect a loopback Origin instead of `*`.

## Proposed patch

Echo the request `Origin` only when it is loopback HTTP(S). Keep `X-Snapback-As` allowed. Add `Vary: Origin`.

```rust
fn loopback_cors_origin(request: &Request) -> Option<String> {
    let origin = header(request, "Origin")?;
    let url = origin.parse::<http::Uri>().ok()?; // or a tiny parser; do not pull http if unused
    let host = url.host()?;
    let loopback = host == "localhost"
        || host == "127.0.0.1"
        || host == "[::1]"
        || host == "::1";
    let http = url.scheme_str() == Some("http") || url.scheme_str() == Some("https");
    (loopback && http).then_some(origin)
}
```

If you do not want a URL crate: allowlist prefixes `http://127.0.0.1:`, `http://localhost:`, `http://[::1]:`, and the https variants, with no extra `/` or `@` in the host.

In `respond_json` / SSE / asset `add_cors`, when `mode == "dev"`:

```rust
    if mode == "dev" {
        if let Some(origin) = loopback_cors_origin(&request) {
            response.add_header(header_value("Access-Control-Allow-Origin", &origin));
            response.add_header(header_value("Vary", "Origin"));
            response.add_header(header_value(
                "Access-Control-Allow-Headers",
                DEV_CORS_ALLOWED_HEADERS,
            ));
            response.add_header(header_value(
                "Access-Control-Allow-Methods",
                "GET, POST, OPTIONS",
            ));
        }
    }
```

`respond_json` currently takes `request` by value and does not keep headers — pass Origin in, or parse it before the body is consumed. OPTIONS already has the `Request`.

Do **not** add `X-Snapback-Control` to the CORS allow-list (already tested).

## Acceptance

- A `Origin: https://evil.example` preflight against `snapback2 dev` does not get `Access-Control-Allow-Origin: *` or `https://evil.example`. The browser will hide the response.
- `Origin: http://localhost:5173` and `http://127.0.0.1:<vite>` still work with `X-Snapback-As` (template path).
- Serve mode still emits no CORS and still refuses personas.
- curl / no-Origin requests still work (no CORS headers needed).

## Resolution (2026-09-12)

Resolved with the P0 browser-persona boundary: only valid loopback origins are reflected and all browser persona headers are rejected before persona auto-mint. CLI/journey persona use remains available without browser headers. Admission and raw owner wire regressions pass; the guide records the distinction.
