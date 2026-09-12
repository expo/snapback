# Snapback 2 public-asset `?s=` redirect interpolates raw `w` into `Location`

**Status:** Closed
**Priority:** P0
**Date:** 2026-09-11
**Systems:** `snapback2/crates/snapback2/src/asset_http.rs`, `serve.rs` (`header_value`)
**Source:** Snapback 2 codebase review 2026-09-11
**Related:** LLP 1006 §2b (session carrier); public-row tokenless redirect

## Symptom

After a public-row delivery, any request that *has* an `s` query parameter (valid, expired, empty, or garbage — `carrier.is_some()` is query presence, not a resolved token) 302s to a tokenless URL. The `w` value is interpolated **verbatim** into `Location` **before** the later `u32` parse used on the non-redirect path.

`split_url` percent-decodes query values (`serve.rs`), so `w=%0d%0aSet-Cookie:%20…` becomes CR/LF in the header. `header_value` builds a `tiny_http::Header` via `AsciiString::from_ascii`, which accepts CR/LF, then `.expect("static HTTP header")`. tiny_http writes `{field}: {value}` raw. That is HTTP response splitting on an **unauthenticated** public asset URL.

Non-ASCII `w` (`%80`) fails `from_ascii` and **panics the HTTP worker**.

The owner still binds `127.0.0.1` only, so this is a browser-to-loopback issue today and a hosted issue the day bind leaves loopback. Public asset id must exist for the redirect to fire.

## Evidence

```433:447:snapback2/crates/snapback2/src/asset_http.rs
    if carrier.is_some() && public {
        let location = query.get("w").map_or_else(
            || format!("/api/asset/{id}"),
            |width| format!("/api/asset/{id}?w={width}"),
        );
        respond_empty(
            request,
            302,
            vec![
                header_value("Location", &location),
```

`id` is a minted `s2id-…` after successful delivery, so it is not the vector. `w` is.

## Proposed patch

Parse `w` as a positive integer before any header is built (same rule as the non-redirect path at `asset_http.rs:464`). Defense in depth: refuse CR/LF/NUL in `header_value` instead of `expect` on query-derived values.

```rust
    if carrier.is_some() && public {
        let location = match query.get("w") {
            None => format!("/api/asset/{id}"),
            Some(raw_width) => {
                let Some(width) = raw_width.parse::<u32>().ok().filter(|width| *width > 0) else {
                    respond_asset_refusal(
                        request,
                        422,
                        asset_type("image width must be a positive integer"),
                        &context.mode,
                    );
                    return;
                };
                format!("/api/asset/{id}?w={width}")
            }
        };
        respond_empty(
            request,
            302,
            vec![
                header_value("Location", &location),
                header_value("Cache-Control", "no-store"),
                header_value("Referrer-Policy", "no-referrer"),
            ],
            &context.mode,
        );
        return;
    }
```

And in `serve.rs`:

```rust
pub(crate) fn header_value(name: &str, value: &str) -> Header {
    if value.bytes().any(|byte| matches!(byte, b'\r' | b'\n' | 0)) {
        panic!("HTTP header value must not contain CR, LF, or NUL");
    }
    Header::from_bytes(name.as_bytes(), value.as_bytes()).expect("HTTP header")
}
```

Prefer returning a 500 refusal over panicking for query-derived headers. The integer parse above should make the panic path unreachable for `Location`.

## Acceptance

- `GET /api/asset/<public-id>?s=x&w=%0d%0aSet-Cookie:%20a=1` does not emit a second header or a `Set-Cookie`. Status is 422 (invalid width) or a tokenless 302 whose `Location` is `/api/asset/<id>` or `/api/asset/<id>?w=<u32>`.
- `w=%80` does not panic the worker.
- `w=256` still 302s to `/api/asset/<id>?w=256`.
- A test in `crates/snapback2/tests/assets/` covers the CRLF and non-ASCII cases on a public row.

## Notes

Do not treat `header_value` as static when the value is query-derived. Private/once image + `?s=` is already 404 (`writer_assets.rs`); this hole is the public redirect only.

## Resolution (2026-09-11)

Asset delivery parses `w` as a positive `u32` before public redirects and formats
only that canonical number into `Location`. Dynamic Location construction also
uses the checked HTTP-header builder, returning a refusal instead of panicking
on invalid header bytes. The integrated HTTP hardening rejects controls and
non-ASCII dynamic header values independently of this width validation.

The existing raw asset roundtrip passed on the integrated owner (23.93s). It
covers CRLF/Set-Cookie injection, invalid UTF-8, valid non-ASCII, zero, and u32
overflow: all return 422 without Location or injected Set-Cookie. A valid 256
width still redirects to the canonical tokenless URL. The same roundtrip checks
no-store/no-referrer delivery and redirect behavior.
