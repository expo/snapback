# OAuth metadata trusts `Host` and always emits `http://`

**Opened:** 2026-08-12 · **Severity:** P2 (security; local OAuth facade) · **Area:** auth / OAuth / HTTP

## What

`served_origin` (`src/server/oauth.rs:87-111`) takes the request `Host` header and always formats `http://{authority}`. That string becomes `issuer`, `authorization_endpoint`, `token_endpoint`, and the registration response’s endpoints.

The main listener does not validate `Host` (same fact as `issues/20260808-admin-console-origin-hardening-revisit.md` part B). The facade is local-only (`oauth_is_local`); hosted routes 404.

## Why it matters

A DNS-rebinding or Host-spoofed request to `/.well-known/oauth-authorization-server` or `POST /auth/oauth/register` advertises attacker-controlled `token_endpoint` / `issuer`. A metadata-following client will send the authorization code and PKCE verifier there. Hard-coded `http://` also downgrades a TLS-terminated local/LAN front to plaintext token URLs.

## Fix

Ignore request `Host`. Use the bound listener origin (and the published LAN-relay origin only when that front is the one being spoken to). Never take scheme from the client.

## Confidence

High on the mechanism. Adjacent to the existing admin Host/CORS ticket, which only discusses admin reads.

## Resolution (2026-08-12)

OAuth discovery and registration now derive advertised URLs from the listener
address captured in `ServerContext` at bind time. Request `Host` is ignored;
IPv4 and IPv6 socket authorities are formatted from trusted server state. The
current published LAN relay does not route the OAuth facade, so it cannot be
the front being spoken to; a future OAuth-capable front must provide its own
trusted server-side origin identity.

The end-to-end OAuth journey now sends a spoofed `Host` to both metadata
documents and dynamic registration and asserts the bound listener origin in
every advertised endpoint.
