# Asset-intent implementation identity omits the reachable helper closure

**Status:** Open
**Filed:** 2026-08-01
**Area:** Codegen, assets, identity
**Found by:** LLP 0140 super-refine loop, round 16 (Codex family), verified independently

## What

`snapback.asset-intent-implementation.v1` hashes the authorizer's root canonical
AST but **not** the reachable inline-helper closure, while the equivalent
identity for ordinary functions does.

Compare:

- Functions (`packages/snapback-codegen/index.mjs:4787-4796`) fold
  `helpers: [{ name, contentHash }]` into the handler record that feeds the v1/v2
  `implementationHash`.
- Asset intents (`packages/snapback-codegen/index.mjs:2384-2397`) build
  `implementationIdentity` from `{ format, app, intent, handler: { form,
  canonicalAst }, policy, reads }` — no helper edges — and hash that into
  `implementationHash`.

Asset runtime source **does** include the reachable helper subset
(`packages/snapback-codegen/inline-handlers.mjs:857`, spliced at
`index.mjs:2341`). So changing only a reachable asset-authorizer helper leaves
the root canonical AST and the marker token identical while changing the helper
content hash and the rendered runtime bytes: **different executable
authorization code, same `implementationHash`.**

## The second half

Even when `implementationHash` does move — a direct authorizer-body or
`reads` change — it is not the lifecycle carrier:

- the client discards it and sends only `intentPolicyHash`
  (`packages/snapback-client/assets.mjs:173`, `:180`, `:411`);
- attempt admission compares only the policy hash (`src/local.rs:5519`);
- per-intent generation is keyed and bumped only by the policy hash
  (`src/assets.rs:958`);
- finalization selects current-versus-retained authorizer code by policy-hash
  equality alone (`src/local.rs:7235`).

## Why it matters

LLP 0044 promises that a changed intent bumps its generation and that
revalidation runs the frozen generation's authorizer code
(`llp/0044-asset-storage-pipeline.rfc.md:423`, `:451`). Under the current chain,
a helper-only change to an authorizer alters what executes without altering any
identity the server observes — so no generation bump, and an in-flight attempt
can finalize against authorizer code that no longer matches the source.

## Disposition needed

This is a design question, not only a bug: decide which identity is the
lifecycle carrier.

1. If `implementationHash` is meant to be it, extend it to the complete
   executable helper closure (mirroring the functions record) **and** carry it
   through the client, admission, generation, and finalization chain.
2. If policy and implementation identities are meant to have deliberately
   separate lifecycle semantics, state those semantics in LLP 0044 and explain
   why a helper-only authorizer change is intentionally invisible to generation.

Either way, add metamorphic lifecycle fixtures: direct-body change, helper-only
change, and `reads` change, each asserting generation bump, stale-reference
refusal, frozen-code finalization, rollback, and stability of unrelated intents.

## Relationship to LLP 0140

LLP 0140 (Vite/Rolldown/Oxc convergence) names this carrier in its identity
constraint and must not freeze a Stage-0 baseline that bakes the collision in.
The Plan records this ticket as a prerequisite disposition. The defect is
pre-existing and independent of that migration — it should be fixed on its own
merits.
