# Refusals name the requirement but not the acquisition path; next[] is never populated on failure

**Status:** Open
**Opened:** 2026-08-08 · **Severity:** P1 · **Area:** admin / auth / host_ops envelopes

From the 2026-08-08 agentic surface audit (LLP 0202 theme 4). LLP 0186 W3's
bar: every refusal names the violated rule and either the fix or a resolving
guide anchor. The envelope has the carrier; almost nothing uses it:

- **`next[]` is populated on exactly one path repo-wide.**
  `src/host_ops.rs:229` declares it; the only push is the dry-run mutation
  hint (`:2575`). Every failure construction is `next: Vec::new()`
  (`src/host_ops.rs:761,2583-2590`; `src/cli.rs:3133,6896,7112,7143,7318,14901`;
  `src/auth/recovery.rs:381`). `recommendedNext` exists only in
  `packages/snapback-cli/verify.mjs:940-941`.
- **`SNAPBACK_ADMIN_TOKEN_REQUIRED`** (`src/admin.rs:3807-3811`) conflates
  missing vs wrong token (`evaluate_access`, `:3495-3524`) and names neither
  the `x-snapback-admin-token` header, the `SNAPBACK_ADMIN_TOKEN` env var,
  nor the 0600 `<ready-file>.admin-token` sibling the server itself wrote.
  The CLI-side refusals are the model to copy (`src/cli.rs:6558,6567,6602`).
- **`SNAPBACK_AUTH_IMPERSONATION_REQUIRED`**
  (`src/admin_impersonation.rs:233-239`) names neither its header
  (`x-snapback-impersonation-capability`) nor the mechanically-fixed
  `<ready-file>.impersonation` sibling; worse, `impersonation_file_invalid()`
  (`:241-246`) reports a capability-file problem as
  `SNAPBACK_AUTH_PROVIDER_UNAVAILABLE`, sending the agent to debug the wrong
  subsystem.
- **`auth.mintSession` mode refusal** (`src/server.rs:17977-17985`,
  `SNAPBACK_AUTH_POLICY_UNAVAILABLE`) discards the four mode facts it just
  checked and omits the remedy (`ensureApp({requestedMode:'sessions'})` +
  restart), which lives only in guide prose.
- **`SNAPBACK_AUTH_GRANT_SCOPE_DENIED`**
  (`src/auth/invocation.rs:1741-1748`) has details
  `{"reason":"missing_scope"}` — neither the blocked function id nor the
  missing scope, though the presenter already holds the token (no
  enumeration oracle; LLP 0055's non-enumeration rule targets pairing
  probing, not post-auth invocation).
- **`SNAPBACK_AUTH_TRANSPORT_INSECURE`** (`src/admin.rs:143-148`) still
  doesn't name `SNAPBACK_PROFILE` — diary 0056 flagged this verbatim and it
  was never absorbed.

## Fix

1. Populate `next[]` on every `ok: false` host-ops envelope with at least
   the operation's catalog `guide` anchor and `projections.cli` spelling —
   mechanical once the catalog anchors are backfilled
   (`issues/20260808-control-catalog-discovery-metadata.md`).
2. Per-code detail repairs above: loopback binds may safely include
   `{presented, envVar, tokenFile}` (the token file is same-user-readable
   anyway); give the invalid-impersonation-file case its own code; emit the
   observed mode facts and named remediation; add
   `functionId`/`missingScope`; name the two-switch override.

The remediation-carrier shape (details.remediations vs next[]) is the open
author ruling in `issues/20260806-llp0146-oq6-remediation-carrier-decision.md`
— these repairs should adopt whatever that ruling picks.
