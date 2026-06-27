# Review: LLP 0017 - Admin console and inspection surface

**Reviewed:** `llp/0017-admin-console-inspection-surface.rfc.md` (working-tree revision)
**Family:** GPT-5 (OpenAI)
**Provider/runtime:** OpenAI API via Codex
**Date:** 2026-06-26
**Redacted:** No - reviewed local Snapback LLP files in this repository.
**Method:** Single-session read-and-critique grounded in the root Snapback explainer
([LLP 0000](../0000-snapback.explainer.md)), the local core
([LLP 0003](../0003-local-code-hosting-and-storage-core.rfc.md)), runtime security
([LLP 0009](../0009-code-execution-security.rfc.md)), agent acceptance
([LLP 0010](../0010-agent-dx-and-acceptance.spec.md)), auth and impersonation
([LLP 0011](../0011-auth-and-permissions.rfc.md)), the headless integration
contract ([LLP 0012](../0012-headless-integration-contract.spec.md)), ephemeral
state ([LLP 0013](../0013-ephemeral-realtime-state.rfc.md)), and the existing
Claude review of this RFC. Requested as "`$llp-review 0017` revise if it would make
it better"; this pass **applied** the revisions marked below.

> **Independence (LLP 0005).** This session did not author the original draft, so
> this counts as a GPT-5 family review. Caveat: this same pass also edited the
> reviewed document, so Charlie should read the revisions before treating the loop
> as settled. The separate Claude review already exists, so 0017 now has the same
> two-family review shape as the earlier core LLPs.

## Overall assessment

LLP 0017 is a strong RFC. Its central calls are the right ones: the same Snapback
server should own the admin API and packaged console; the UI should be one consumer
of a headless admin contract; Contract/Exact should not get private backend
semantics; and the first "code runner" should invoke generated functions, not
arbitrary JavaScript. The RFC is especially good where it explains why same-instance
authority is not just convenient: process-local ephemeral state cannot be truthfully
inspected by a second UI process unless that process calls back into the Snapback
server.

The prior Claude pass already closed the biggest schema-design issue by making the
admin contract extend LLP 0012's runtime-state and capability artifacts rather than
forking a private admin schema. This GPT-5 pass found one remaining security edge:
the RFC correctly treated durable row edits as privileged, but did not fully carry
that policy through permission-bypass labeling, ephemeral mutating controls, or
destructive whole-dataset operations. The applied revision tightens that boundary
without changing the product direction.

## Strengths

- **Same-instance authority is well justified.** The server that owns SQLite/Postgres,
  runtime state, live subscriptions, and process-local ephemeral rooms is the only
  truthful authority for admin facts.
- **Headless-first avoids UI lock-in.** The same facts can feed web admin, CLI,
  doctor tooling, Contract/Exact, native Exact, agents, and tests.
- **The system-app distinction is correct.** The admin console should talk to a
  privileged admin API, not depend on ordinary generated application functions that
  may themselves be broken.
- **Function runner before eval is the right runtime boundary.** Generated query and
  mutation invocation is inspectable and aligns with LLP 0009; arbitrary JavaScript
  eval would be a separate sandbox feature.
- **Validation requirements are concrete.** Serving without Vite, same-server API
  authority, schema-aware reads, Exact-optional tests, and shared Contract/Exact/web
  contracts are all testable gates.

## Concerns

Severity is this reviewer's; the first three were **applied** in the revise pass and
are the author's to confirm or revert.

- **C1 - Direct admin edits did not say whether permissions were evaluated or
  bypassed. [Medium-High, security]** LLP 0011 is explicit that admin bypass must
  never be implicit and diagnostics/logs must show bypass mode. 0017 already said
  direct edits bypass app-level mutation code, but that is not enough: an edit should
  either run under an explicit impersonated auth context or use an explicit admin
  bypass. *Resolved by:* adding the authorization-mode requirement and requiring
  diagnostics/audit events to say whether ordinary permissions were evaluated or
  bypassed. **Applied** (*Durable Data Exploration and Edits*, *Validation
  Requirements*).
- **C2 - Ephemeral inspector controls mutated live state without being classified as
  privileged writes. [Medium]** Cleanup, forced resync, delete, disconnect, and
  simulated publish do not write durable rows, but they can disrupt users and alter
  runtime truth. They should be token/admin-gated like durable admin writes. *Resolved
  by:* naming them as privileged-write controls and adding validation for the same
  admin-write capability. **Applied** (*Ephemeral Inspector*, *Security Defaults*,
  *Validation Requirements*).
- **C3 - Destructive and whole-dataset controls needed explicit local/hosted gates.
  [Medium]** Reset, seed, import/export, raw SQL, and disconnect-style operations are
  not ordinary read-only inspection. Some are writes; export is read-only but can leak
  an entire dataset. *Resolved by:* adding them to the local explicit-capability rule
  and the hosted explicit-admin-permission rule. **Applied** (*Security Defaults*).
- **C4 - The 0012 schema-version decision remains the load-bearing open question.
  [Medium-High]** The RFC now correctly says admin facts should extend 0012's pinned
  `runtimeState` and `capabilityManifest`, but it still needs an author decision on
  whether the additions extend `snapback.v0`, require a later `schemaVersion`, or
  split a small admin-only artifact. This pass did not settle that because it changes
  another document's pinned artifact contract. *Resolves when:* 0012 and 0017 agree
  on the versioning path before implementation depends on it.

## Suggestions

- Consolidate the route-migration policy later. `/_snapback/*`, v0 aliases, and
  `/_snapback/api/inspect` are described in several sections; the content is
  consistent, but one canonical route-lifecycle paragraph would reduce drift.
- When implementing export/import, treat export as a data-exfiltration operation even
  though it is not a write.
- Consider a future small matrix of admin operations vs. required capability once the
  local token lifecycle is decided.

## Open questions

- Does 0012 absorb the admin runtime fields into `snapback.v0`, bump the schema
  version, or define a separately versioned admin-only subset?
- What is the local admin token lifecycle: generated per process, stored under
  `.snapback/`, printed once, or disabled until a write/destructive operation is
  requested?
- What authorization model permits read-only browsing of hosted production data?
- What audit-log substrate exists before hosted direct admin edits are allowed?

## Recommended next step

*Proposed only - the author decides; status unchanged.*

Keep LLP 0017 in `Draft` while reconciling the 0012 schema-version question and the
local admin token lifecycle. With the Claude review plus this GPT-5 review, the
multi-family critique loop is now adequate for a Draft RFC of this scope; the next
work should be author decisions and implementation spikes, not another review pass.
