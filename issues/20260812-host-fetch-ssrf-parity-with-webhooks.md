# `ctx.fetch` / `ctx.fetchStream` lack the webhook SSRF policy

**Opened:** 2026-08-12 · **Severity:** P1 (security; exploitable once outbound actions are enabled) · **Area:** runtime / egress / security

## What

When `SNAPBACK_OUTBOUND_ACTIONS=1`, host-mediated fetch builds a bare `ureq` agent and requests the handler-supplied URL. Admission is only “bounded absolute `http://`/`https://`.” There is no public-IP check, no metadata-host block, no DNS pin, no `redirects(0)`, and no `try_proxy_from_env(false)`.

```1572:1578:src/server.rs
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(request_timeout)
            .timeout_read(request_timeout)
            .timeout_write(request_timeout)
            .build();
```

The buffered sibling (`host_fetch` at `src/server.rs:1813`) is the same construction. ureq 2 defaults to following redirects (5) and honoring `HTTP(S)_PROXY`. `fetchStream` then returns the **post-redirect** URL to the handler (`src/server.rs:1676`).

Webhooks already do the right thing (`src/webhooks.rs:80-218`): resolve once, refuse `localhost` / `.localhost` / `metadata` / `metadata.google.internal` / non-public answers (including `169.254.169.254`), pin the resolver, disable env proxy, and `redirects(0)`. Ibex ambient `fetch` also denies `PeerClass::Metadata | Unspecified`. `ctx.fetch` never enters either classifier.

The Cloudflare coordinator has the same hole (`cloudflare/src/coordinator.js:2808` and `3187`): `fetch(url)` with no destination policy. Comment in that file: “Destination allowlisting is not yet implemented on this profile.”

The official egress fixture takes `args.url` and fetches it (`guide/backend/actions-and-fetch.md`).

## Why it matters

A user-invocable action (default function admission is `optional-user`) that forwards a URL, or any action that calls `ctx.fetch`/`ctx.fetchStream`, can reach:

- `http://169.254.169.254/` and other link-local metadata
- `http://127.0.0.1:<port>/_snapback/api/inspect` — loopback admin **reads are tokenless** (`evaluate_access` at `src/admin.rs:3581`)
- RFC1918 / internal services
- whatever `HTTP_PROXY`/`HTTPS_PROXY` the process inherited

Jobs and cron run as `ResolvedAppAuthority::System`. Combined with a tunnelled loopback server (`issues/20260804-tunnelled-loopback-server-keeps-dev-profile.md`), this is a public SSRF of the developer machine.

This is not “hosted allowlists are Missing.” It is a control that already exists on the webhook path and is skipped on the action-fetch path.

## Fix

Share `webhooks::prepare_target` / `is_public_ip` (or Ibex `classify_network_peer`) on both host-fetch lanes and the Cloudflare `hostActionFetch` path:

- deny metadata, unspecified, and non-public answers
- re-validate every DNS answer
- `redirects(0)` or pin-and-recheck every hop
- `try_proxy_from_env(false)` unless an explicit proxy is configured
- keep echoing the **authored** URL (already done for buffered `ctx.fetch`)

Decide explicitly whether loopback HTTP is a local-dev exception (webhook’s `allow_test_loopback_http`) rather than the default.

Design home: LLP 0251 (unified outbound destination policy). LLP 0009 / 0049 / 0076 inherit it.

## Confidence

High on the mechanism. High that it is not already ticketed (capability manifests declare `egress_destination_allowlist` as a gap; that is “you may only call 511.org,” not “you may not hit the IMDS”).
