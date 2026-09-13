# Snapback 4: Honor the documented bare-token client option

Status: Closed
Resolved: 2026-09-13
Priority: P2
Observed: 2026-09-12
Review finding: R31
Evidence: Reproduced with a fetch spy
Baseline: `d6c803878a5432cce5f045777786a049972d3d70` / Snapback 4 0.0.16
Related: [LLP 3000.003](../../llp/3000.003-one-semantics-and-credible-verification.research.md), [comprehensive review](../../llp/reviews/3000-architecture-code-review-20260912.md)

## Problem and reproduction

`ClientOptions.token` is documented for apps that keep sessions themselves,
and the client includes it in the Authorization header. However, without a
full session or persona, the client has a null viewer and refuses queries and
mutations as signed out before issuing a request.

Reproduction: create the online client with `{url, token: 'test-token', fetch}`
and make a query. It returns `E_AUTH`; the fetch spy records zero calls. The
configured bearer token is never given a chance to be resolved by the server.

Make the supported token-only path establish the state it needs, or revise
the option contract and caller migration coherently if it genuinely requires
a supplied principal. Verify a valid token reaches the server, invalid/expired
tokens produce the documented state, and session-managed clients still work.
This is an API correctness finding, not an authentication security assessment.

## Implementation locations

- [packages/snapback4/src/client.ts](../../snapback4/packages/snapback4/src/client.ts)

## Resolution — 2026-09-13

A supplied bearer token can establish the viewer from authority without a separately supplied local identity. Invalid/expired sessions clear the viewer and notify session observers through the existing contract.

Verification and independent review are recorded in the [correction qualification](../../llp/reviews/3000-review-corrections-20260913.md). Relevant regression or artifact locations:

- [packages/snapback4/test/client-lifecycle.test.mjs](../../snapback4/packages/snapback4/test/client-lifecycle.test.mjs)
