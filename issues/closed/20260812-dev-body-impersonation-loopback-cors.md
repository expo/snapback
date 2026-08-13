# Dev-mode body `auth.userId` plus localhost CORS is unauthenticated impersonation

**Opened:** 2026-08-12 · **Severity:** P2 (security; local-dev default profile) · **Area:** auth / CORS / local server

## What

Function routes in Dev resolve caller identity from the JSON body (`src/auth/invocation.rs:468-477`, `src/server.rs:10648-10656`):

```468:477:src/auth/invocation.rs
    pub fn dev_from_auth(input: &AuthInput) -> Self {
        input
            .user_id
            .as_ref()
            .map_or(Self::Anonymous, |user_id| Self::DevImpersonation {
                user_id: user_id.clone(),
                roles: Vec::new(),
                local_dev_only: true,
            })
    }
```

`app_function_route` allows `LegacyBodyAuth` / `ClientAsserted` until sessions overlay rejects it. CORS then reflects *any* `http(s)://localhost|127.0.0.1|[::1]:*` origin (`src/server.rs:18899-18914`) and allows `content-type`. CORS never rejects; it only decorates.

Host-ops impersonation correctly requires a separate `sbic_` capability. App-data Dev impersonation does not.

Sessions mode closes this (`LegacyBodyPolicy::Rejected` on the overlay). Dev is still the default local profile.

## Why it matters

This is the intended local-dev impersonation model, but CORS makes it available to **every other localhost origin**, not just the app. Any page on another port can `POST /mutation/...` with `{auth:{userId:"victim"}}` and act as that user.

Same class as the existing admin loopback-read / DNS-rebinding ticket (`issues/20260808-admin-console-origin-hardening-revisit.md` part B), but that ticket only covers admin *reads*. This is app-data identity assertion.

## Fix

Treat as the same class as admin writes: require the minted admin / console credential (or the impersonation capability) before honoring body `userId`, **or** pin CORS to the instance origin instead of every loopback origin.

## Confidence

High on the mechanism. This is a documented local-dev convenience with an unexamined CORS blast radius, not a hosted auth bypass.

## Resolution (2026-08-12)

Dev body impersonation is now Origin-aware at the shared HTTP invocation gate.
No-`Origin` callers and requests from the bound listener origin retain the
trusted-local behavior. A cross-origin browser request may select `auth.userId`
only when its exact HTTP(S) loopback origin appears in the comma-separated
`SNAPBACK_DEV_AUTH_ORIGINS` allowlist; otherwise the request is refused before
authority resolution with stable 403 diagnostic
`SNAPBACK_AUTH_DEV_ORIGIN_REFUSED`. Sessions-mode forbidden-field precedence
is unchanged.

The supervised Expo loop adds its chosen Metro port (for all loopback hostname
forms) to the backend environment automatically. Standard Vite development
continues to use the same-origin `/__snapback` relay; intentionally direct
cross-origin dev servers opt in explicitly. Tests cover no-Origin, same-origin,
configured Metro-origin, and unregistered-localhost refusal behavior, plus the
managed Expo environment projection.
