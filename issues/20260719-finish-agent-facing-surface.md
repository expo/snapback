# Finish the agent-facing surface: agent principals GAP plus the app-CLI program

**Status:** Open
**Severity:** P2
**Systems:** Auth, Agent Principals, App CLI, Guide
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-19
**Related:** guide/capabilities.md (auth.agent-principals GAP row); llp/0055;
LLP 0062; issues/20260717-app-cli-phase1-program.md;
issues/20260717-app-cli-guide-obligations.md
**Linear:** ENG-25270; related program references ENG-24904 and ENG-22205
**Marker:** agents, auth, app-cli, umbrella

Agent-checkability is Snapback's stated differentiator against Convex and
Supabase — the diaries repeatedly credit stable diagnostics, the capability
manifest, and server-authoritative mutations as what makes Snapback "more
agent-checkable." But the agent-facing surface itself is the least finished
area of the product:

1. **`auth.agent-principals` is the only explicit GAP row in
   guide/capabilities.md** (maturity: partial; witness route
   `/auth/agents/pair`; authority llp/0055; owner ccheever, review
   2026-08-15). Agents can pair, but the authoring surface and guide page
   for agent principals and scoped grants do not exist.
2. **The app-CLI / code-mode program (LLP 0062) is the largest open
   workstream** — 19 open tickets under the `app-cli` marker, from the
   unpackaged `SnapbackClient` (`demos/_kit/client.mjs`, no package.json)
   through envelope codegen, principal selection, session custody, mutation
   settlement, and agent onboarding.

This ticket is the umbrella tying the two together as one product outcome:
an agent should be able to discover an app's API, authenticate as a scoped
principal, mutate, subscribe, and verify — through a first-class packaged
surface, not demo-tree glue. It does not duplicate the phase-1 program
index; it adds the GAP-row closure and guide obligations as exit criteria
alongside it.

**Done when:**

- The `auth.agent-principals` GAP row in guide/capabilities.md is closed
  with a real guide page covering agent pairing, principals, and scoped
  grants.
- The app-CLI phase-1 program index
  (issues/20260717-app-cli-phase1-program.md) is complete or explicitly
  rescoped, including the `clients.app-cli` capability row promised by
  issues/20260717-app-cli-guide-obligations.md.
- The headless client core is consumable as a versioned package outside the
  demos tree.
- A diary or acceptance suite demonstrates the end-to-end agent journey
  (discover → pair → scoped principal → mutate → subscribe → verify)
  against the packaged surface.
