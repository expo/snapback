---
title: Network condition profiles
id: operating.network-profiles
order: 2
audience: agent-first
capabilities: [operating.network-profiles]
authorities: [llp/0167-network-condition-profiles.rfc.md]
examples: [demos/zero-bakeoff]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-05
reviewed-authorities-digest: sha256:430e7d2de7660d7ca5a556dd5ff753626578baa669e46f85e8a72728448a3c55
---

# Network condition profiles

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Use a network condition profile when you need real Snapback responses to arrive
slowly while commits and server-side ordering remain unchanged. The delay is
applied on the server's mutation-ack, live-delta, and query-response egress
lanes, so optimistic UI, settlement, and convergence experience the same
conditions an actual client would.

## Choose a built-in or custom profile

Snapback ships three built-ins:

| Profile | Mutation ack | Live delta | Query response | Jitter | Use it for |
| --- | ---: | ---: | ---: | ---: | --- |
| `normal` | 0 ms | 0 ms | 0 ms | 0 ms | Ordinary operation; the identity profile. |
| `optimistic` | 1,000 ms | 1,000 ms | 0 ms | 0 ms | Exercising optimistic UI and coordinated post-commit settlement. |
| `demo-slow` | 2,000 ms | 2,000 ms | 2,000 ms | 250 ms | Making slow-server behavior visible in a demo. |

Anywhere a built-in name is accepted, you may instead supply an inline JSON
object with a name and the three lane delays. `jitterMs` is optional and
defaults to zero. This is the real `demo-slow` shape from the zero-bakeoff
acceptance environment:

```json source=demos/zero-bakeoff/protocol/environment.v2.json
{
      "name": "demo-slow",
      "mutationAckDelayMs": 2000,
      "liveDeltaDelayMs": 2000,
      "queryResponseDelayMs": 2000,
      "jitterMs": 250
    }
```

## Set or inspect a profile from the CLI

Address the running server through its readiness file. `get` is read-only;
`set` uses the ordinary admin-write authority and returns the structured
`hostOpsResult` envelope.

```sh
snapback network-profile get --ready-file .snapback/dev.ready.json
snapback network-profile set optimistic --ready-file .snapback/dev.ready.json
snapback network-profile set demo-slow --ready-file .snapback/dev.ready.json
```

Pass custom JSON as the positional profile value:

```sh
snapback network-profile set '{"name":"ack-slow","mutationAckDelayMs":1500,"liveDeltaDelayMs":0,"queryResponseDelayMs":0,"jitterMs":0}' --ready-file .snapback/dev.ready.json
```

## Give an agent the same control through MCP

The tools are exposed by `snapback mcp-control` and call the same host
operations as the CLI:

| Intent | MCP tool | Input |
| --- | --- | --- |
| Read the active profile and provenance | `snapback_network_profile_get` | No input. |
| Activate a profile | `snapback_network_profile_set` | `profile` is a built-in name or the inline object above; `operatorPrincipal` is optional. |

The underlying operations are `debug.networkProfileGet` and
`debug.networkProfileSet`. The latter is mutating even though a profile does
not change durable app data. Use `snapback_network_profile_set` with
`profile: "normal"` as the MCP restore step.

## Select a profile at server startup

Set `SNAPBACK_NETWORK_PROFILE` to a built-in name or inline JSON before the
server starts:

```sh
SNAPBACK_NETWORK_PROFILE=optimistic \
  snapback start --memory --ready-file .snapback/dev.ready.json
```

This is startup configuration. Restarting with the same environment selects
the profile again, and a non-`normal` selection is re-announced in startup and
readiness output. Startup selection still passes through the same activation
gate as every runtime control.

## Read or change the profile through the admin API

The admin API exposes one path with policy split by method:

| Request | Authority | Body |
| --- | --- | --- |
| `GET /_snapback/api/debug/network-profile` | `AdminRead` | None. |
| `PUT /_snapback/api/debug/network-profile` | `AdminWrite` | A JSON built-in name such as `"optimistic"`, or the inline profile object. |

For example, after resolving the server URL and admin token from the readiness
handoff:

```sh
curl -sS \
  -H "x-snapback-admin-token: $ADMIN_TOKEN" \
  http://127.0.0.1:4287/_snapback/api/debug/network-profile

curl -sS -X PUT \
  -H "x-snapback-admin-token: $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  --data '"demo-slow"' \
  http://127.0.0.1:4287/_snapback/api/debug/network-profile
```

The response reports the active profile and activation provenance. Do not
build a separate policy path around these routes; the CLI, host-ops, MCP, and
console are thin clients over the same activation decision.

## Toggle a profile while debugging in the console

The admin console's Developer panel offers all three built-ins plus custom
fields. While any non-`normal` profile is active, the console shows a
persistent banner on every tab. The panel inherits the same refusal and
authority behavior as the API; it does not have a browser-only bypass.

## Know where activation is allowed

Network profiles fail closed at one activation chokepoint. The complete matrix
and rationale live in [LLP 0167](repo:llp/0167-network-condition-profiles.rfc.md),
but these limits matter when operating the feature:

- A local, non-`Prod` server may activate a non-`normal` profile.
- A primary hosted target refuses every non-`normal` profile. The narrow
  hosted exception is an LLP 0158 derived/forked instance with authoritative,
  boot-validated identity. On Cloudflare that identity comes from the dedicated
  `SNAPBACK_DERIVED_INSTANCE_ID` binding, independently of `SNAPBACK_TESTING`.
- An explicit or defaulted `ServerProfile` of `Prod` always refuses a
  non-`normal` profile, including on a derived instance.
- Hosted, missing, malformed, or contradictory classification refusals use
  `SNAPBACK_NETWORK_PROFILE_FORBIDDEN` on every activation surface.
- The hard per-response delay ceiling is 30,000 ms. A profile that could
  exceed it is refused with `SNAPBACK_NETWORK_PROFILE_DELAY_CEILING`; Snapback
  never silently clamps it.

These rules are why this page declares `targets: [local]`: the derived-instance
allowance is a contained exception, not general hosted or production support.

## Tell whether a response was perturbed

Every response served under a non-`normal` profile names the profile that
actually governed its delay:

| Surface | Observation marker |
| --- | --- |
| HTTP | `snapback-network-profile` response header, exposed through CORS. |
| Socket and poll live protocol | `network_profile` field on the frame. |

The profile is snapshotted when the response or frame enters the delay seam, so
a concurrent toggle cannot relabel an in-flight response. `normal` is a true
identity: it emits no marker and adds no measurable overhead.

## Understand what survives a restart

A profile selected at runtime through the API, host-ops, MCP, or console is
deliberately process-local and is not persisted. After restart, the server uses
`normal` unless `SNAPBACK_NETWORK_PROFILE` supplies startup configuration.
This prevents a forgotten interactive toggle from silently becoming durable;
an environment-selected profile is different because the launcher explicitly
selects it again at startup.

## Restore `normal` when you're done

Restoring the identity profile is mandatory cleanup for every test, demo, or
debugging session that activates a non-`normal` profile. It is part of the
honest-perturbation contract in LLP 0167, not an optional courtesy:

```sh
snapback network-profile set normal --ready-file .snapback/dev.ready.json
```

If the profile came from `SNAPBACK_NETWORK_PROFILE`, also remove that setting
from the launcher or change it to `normal`; otherwise the next restart will
select the non-`normal` profile again.

The exact MCP equivalent is `snapback_network_profile_set` with
`profile: "normal"`. Confirm with the CLI `get` command or
`snapback_network_profile_get` before handing the server to another task.

## Anti-patterns

- **Do not leave a slow profile active.** Always perform and verify the
  restore-to-`normal` step above, even when a test fails midway.
- **Do not add client-side sleeps to simulate server latency.** Latency
  Kanban's old sleep delayed the caller without exercising Snapback's pending,
  settlement, and live-convergence paths; the server profile exists to replace
  that false test.
- **Do not assume hosted or production accepts non-`normal`.** Primary hosted
  and every `Prod` profile refuse it; the derived-instance rule is the only
  narrow hosted exception.
- **Do not use latency profiles to model disconnects, drops, reordering, or
  offline state.** Profiles delay otherwise unchanged, in-order observations;
  those other perturbations belong to their dedicated test controls.
