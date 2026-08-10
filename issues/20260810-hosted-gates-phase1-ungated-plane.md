# Hosted gates Phase 1 — the ungated hosted plane (serve the anonymous/declared external surface)

- **Status:** Open
- **Date:** 2026-08-10
- **Systems:** Hosted platform, API, Serving, Auth
- **Governing:** LLP 0217 (hosted-gates program) Phase 1; LLP 0204 D2/D7
- **Author ruling:** 2026-08-10 sitting — "land the plan, then build the
  ungated plane first."

## Scope (LLP 0217 §Phase 1)

Serve, on the first hosted profile (the LLP 0098 Rust-origin
`loopback-terminated-single-instance.v1`, NOT the Workers gateway — its
manifest is dev-only with all hosted-auth unavailable and its gateway has
no `/api/v1` family), the **gate-free** external lanes that need only
serving posture, no LLP 0060 admission (Gate A) or LLP 0071 audit ledger
(Gate B):

- the exposure envelope + OpenAPI/`API.md` projections (already served on
  local; extend to the hosted profile);
- `/api/v1` **anonymous + declared-tier** calls to the external anonymous
  set (the routes + admission ladder already exist in the binary — what's
  needed is hosted serving posture and the LLP 0071 network-evidence
  floors on hosted, not new authority);
- the remote MCP anonymous tool set;
- v1 anonymous-set capability links (no new execution authority);
- the declared-tier / pre-auth admission ledger.

Explicitly OUT of Phase 1 (they need Gate A / Gate B — later phases):
every credentialed lane, the OAuth facade, granted reads/writes, `ask`,
integration installations, approval-gated effects.

## Why this is a ticket, not a landed change today

The LLP 0217 plan targets serving on a **hosted deployment**. The
end-to-end acceptance — a stranger hitting the hosted URL, the LLP 0201 M6
grader run against a hosted URL for the anonymous variation — is only
verifiable on a real hosted deploy (fleet + Cloudflare/Fly tokens per the
machine-fleet docs), which the authoring session could not do locally
without fabricating an unverifiable capability claim (LLP 0189 forbids
claims without scoped evidence).

## Execution plan for whoever picks this up

1. **Precondition:** ratify LLP 0217 Phase 0 first — the sender-constrained
   question (0217 OQ-1) does NOT block Phase 1 (it's gate-free), but the
   Phase 0 anchoring amendments (naming the gate referents) should land so
   the program has checkable referents.
2. **Locally-verifiable slice:** the serving-posture policy — hosted target
   serves the anonymous/declared external route set + envelope projections;
   unit-test the policy (which lanes the hosted profile admits) the way
   route_policy_v1 tests the local matrix. This part can land with local
   evidence.
3. **Deploy-verified slice:** stand up the Rust-origin hosted profile, serve
   the external surface, run the M6 anonymous grader against the hosted URL,
   and confirm the network-evidence floors + declared budgets hold under
   the LLP 0071/0090 abuse posture. Bind the capability claim to that
   scoped hosted evidence (LLP 0189).

## Related
LLP 0217 (plan), LLP 0098 (hosted-edge Rust-origin profile), LLP 0060
(deployment security — Gate A, not needed here), LLP 0071 (network-evidence
floor + declared ledger), LLP 0201 M6 (the hosted anonymous grader).
