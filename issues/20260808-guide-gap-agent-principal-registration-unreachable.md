# guide-gap: agent-principals.md teaches registration as if a user-reachable surface exists

**Opened:** 2026-08-08 · **Severity:** P2 (documentation honesty)

guide/auth/agent-principals.md:38-39 says "Registration is an owner or
invitation flow that creates the agent and returns its one-time credential"
— and that is the page's only registration content. guide/index.md:194
advertises "register, pair, mint scoped". But no reachable surface creates
an agent:

- the complete `/auth/*` route list (src/server.rs:8070-8367) has no
  registration/creation route;
- `create_agent_principal`/`issue_initial_agent_credential` are invoked only
  from test setup (src/server.rs:29260, 35609, 36128, 37456) and the
  internal activation lane (src/local.rs:40699);
- the app CLI only consumes an existing `sbac_` credential from file/env
  (packages/snapback-app-cli/auth.mjs:203-204); `snapback agent setup` is
  MCP config, not registration;
- the capability-index witness for `auth.agent-principals` is only
  `route /auth/agents/pair` (guide/capabilities.md:74).

A cold agent cannot complete the "agent principal with a scoped token"
journey because step zero is unteachable. Pairing→token→fence→release is
otherwise fully and accurately taught.

Ask: state the honest boundary on the page (registration currently has no
user-reachable surface; credentials come from harness/test-lane
provisioning), or document the real surface if one exists; align the
index.md one-liner and consider a GAP row for the registration half.

Found by the 2026-08-08 comprehensive docs review (auth slice).
