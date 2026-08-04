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

---

## Round: 2026-08-03 — amendment delta review (one-time operator claim link)

**Provenance:** reviewer = codex exec (OpenAI family, default model,
model_reasoning_effort=xhigh), mutually blind to the concurrent Claude-family
reviewer; orchestrator/reviser = Claude Fable 5 session (wrote the amendment;
did not review). Target revision sha256
`b632aad74c998f982ef3744e8b3005a755c421869ea724e7fe217b7cff3c51a2`
(uncommitted amendment atop 52383ce4b). Capsule: target + LLP 0150 context +
delta instructions, structurally excluding llp/reviews/* and orchestrator
notes. Scope: the four amendment edits only (target is Accepted; single delta
round authorized by the author — no status transition). Verdict binds to the
delta, not the whole document. Review body verbatim below.

1. **MATERIAL — IN-DELTA**

   **Exact text:**

   > “Opening the link exchanges the claim atomically for one newly derived `sbcc_` console credential…”

   > “Minting refuses hosted targets; a non-loopback local bind may mint claims only when an explicit `SNAPBACK_ADMIN_TOKEN` enabled admin on that bind.”

   > “non-loopback and hosted targets cannot mint, renew, or device-approve browser console credentials even when another admin bearer is present;”

   The amendment permits a non-loopback target to exchange a claim for a newly minted browser credential, directly contradicting the existing acceptance requirement. This leaves implementations and tests with incompatible normative rules.

   **Suggested fix:** Decide the rule explicitly. If the claim link is the intended exception, revise the validation requirement to say that hosted targets always refuse, while non-loopback local targets may mint a claim-derived credential only when enabled by an explicit `SNAPBACK_ADMIN_TOKEN`. Add acceptance tests for that exception. Otherwise, remove the non-loopback claim allowance.

2. **MATERIAL — IN-DELTA**

   **Exact text:**

   > “Opening the link exchanges the claim atomically for one newly derived `sbcc_` console credential through the ordinary credential path (`no-store`, fragment removed before boot, same storage rules)…”

   > “An active derived credential may renew itself only on a loopback local target in the `dev` profile and dev auth policy. Renewal slides the ten-minute expiry but never moves the absolute eight-hour deadline established at first mint…”

   > “the minting terminal prints a claim notification … so a raced or stolen link is visible…”

   Atomic consumption prevents replay but makes a race strictly first-wins. In the common loopback-server-plus-tunnel deployment, the winning claim-derived credential inherits sliding renewal and can retain `AdminWrite` for up to eight hours. The design provides notification but no way to revoke or contain the credential won by an attacker, so the five-minute claim lifetime does not bound the resulting compromise.

   **Suggested fix:** Mark claim-derived credentials with distinct provenance, make them non-renewable with a short absolute lifetime, and bind the redemption record to the issued credential so the minting terminal can revoke it immediately. If renewable claim sessions are required, specify an authenticated terminal confirmation before renewal becomes available.

3. **MATERIAL — IN-DELTA**

   **Exact text:**

   > “`--url-base` substitutes the operator's tunnel or reverse-proxy origin…”

   > “the minting terminal prints a claim notification (time and requesting address) when the code is redeemed…”

   The notification is not specified well enough to implement reliably. A command that has returned cannot later print, while no blocking, polling, streaming, reattachment, or delivery-loss behavior is defined. Moreover, through the expressly supported tunnel/reverse-proxy path, the server usually sees the proxy or loopback peer rather than the browser address; trusting arbitrary forwarding headers would create spoofable audit output. Consequently, the promised security signal may either never arrive or report a misleading address.

   **Suggested fix:** Specify that `snapback admin link` remains attached until redemption, expiry, or interruption and observes an atomically recorded redemption event using a separate status receipt unavailable to the browser. Define disconnect behavior and whether observation can reattach. Define the address as the direct transport peer by default, and derive a browser address from forwarding headers only through explicitly configured trusted proxies, labeling which address is shown.

4. **minor — IN-DELTA**

   **Exact text:**

   > “held server-side only as a digest alongside the device-approval registry and sharing its pending cap and rate windows.”

   Sharing budgets couples an unauthenticated claim-exchange endpoint to device approval. Invalid exchange traffic or unauthenticated device-request floods can exhaust a common window or pending pool and prevent an operator from redeeming a legitimate claim. The uniform refusal and unguessable code adequately address enumeration, but they do not prevent cross-flow starvation.

   **Suggested fix:** Retain a global work ceiling but partition quotas between authenticated claim creation, claim exchange, and device approval; apply per-effective-source limits to unauthenticated attempts so one lane cannot consume the others’ entire budget.

5. **altitude:detail — IN-DELTA**

   **Exact text:**

   > “Opening the link exchanges the claim atomically…”

   The wire details belong to implementation, but the security tests should ensure the code is submitted by `POST` in a body rather than a URL, is never logged, receives `no-store`, uses constant-time digest comparison, and preserves the same status/body for invalid, expired, and consumed claims.

   **Suggested fix:** Record these as implementation acceptance cases rather than adding further RFC-level protocol machinery.

VERDICT: NOT READY

---

## Round: 2026-08-03 — amendment delta review #2 (claim-link reachability affordances)

**Provenance:** reviewer = codex exec (OpenAI family, default model,
model_reasoning_effort=xhigh), mutually blind to the concurrent Claude-family
reviewer; orchestrator/reviser = Claude Fable 5 session (wrote the amendment;
did not review). Target revision sha256
`a2894d70d886e91f2c4bfedb4e89d31d5c69042c8f4de753ec08489a6637e828`
(uncommitted amendment atop 59b9d9aed). Capsule: target + delta instructions
only, structurally excluding llp/reviews/* and orchestrator notes. Scope: the
four reachability-affordance edits (target is Accepted; single delta round
authorized by the author — no status transition). Verdict binds to the delta.
Review body verbatim below.

1. **MATERIAL — IN-DELTA**

   **Exact quoted text:**

   > “without changing the server's bind or the loopback-only exchange rule.”

   > “`--lan` makes the attached CLI process itself host an **ephemeral relay**: it enumerates the device's non-loopback interface addresses, binds the selected LAN interface on an OS-assigned port, and forwards to the server's loopback listener”

   > “The server still sees only loopback peers”

   > “the relay exposes one namespace for at most one credential lifetime, on an unguessable port”

   **Concern:** This preserves only the server’s transport-peer check, not the security meaning of a loopback-only exchange. The exchange becomes reachable by non-loopback clients through a first-party proxy. That can be a legitimate delegated-ingress design, consistent with the previously accepted tunnel posture, but the amendment incorrectly treats it as having no trust-boundary change. It specifies no authenticated or encrypted browser-to-relay transport. If the resulting origin is plain HTTP, an active on-link attacker can modify the console JavaScript, read the claim from the fragment, race redemption, or capture the returned `AdminRead`/`AdminWrite` bearer. An OS-assigned port is also scannable, not unguessable.

   **Suggested fix:** Explicitly define the relay as a trusted proxy that changes end-client reachability, remove port secrecy from the security argument, and require authenticated HTTPS for `--lan`—for example, a certificate/key explicitly supplied by the operator and trusted by the receiving device. If authenticated TLS cannot be provided, remove `--lan` or obtain an explicit threat-model ruling that active LAN peers are trusted; document that ruling prominently and require interactive acknowledgement.

2. **MATERIAL — IN-DELTA**

   **Exact quoted text:**

   > “make the printed URL loadable where the human actually is”

   > “`--tailscale` publishes the server's loopback port through a running tailscaled's `serve` proxy”

   > “The relay is HTTP-aware”

   > “the reflected localhost CORS (any `http(s)://127.0.0.1|localhost|[::1]:*` origin)”

   > “browser write requests should have origin and CSRF protections appropriate to local development”

   **Concern:** A console loaded from a LAN or tailnet origin sends that origin in POST and WebSocket handshakes, while the accepted server policy recognizes loopback origins only. The amendment neither admits the new origins nor defines safe Origin/Host translation, so the supposedly loadable console may fail its exchange or later API calls. Blindly stripping or rewriting `Origin` would make the server’s existing CSRF check meaningless unless the relay first enforces an equivalent policy. This is a new integration obligation of the managed affordances even though the older operator-managed `--url-base` posture has a similar latent gap.

   **Suggested fix:** Pin an end-to-end origin contract. The LAN relay must accept only its exact generated `Host`, require absent or exactly matching `Origin` for state-changing requests and WebSocket upgrades, reject all others, then translate Host/Origin to the exact loopback upstream origin. Tailscale mode must either register one exact, claim-scoped HTTPS origin with the server through a master-authenticated operation or place an equivalent validating shim before the server. Do not broaden CORS to arbitrary non-loopback origins. Add acceptance tests for POST, preflight, redirects, hostile Host/Origin values, and WebSocket handshakes in both modes.

3. **MATERIAL — IN-DELTA**

   **Exact quoted text:**

   > “The relay is HTTP-aware and forwards only the reserved `/_snapback/*` namespace (including WebSocket upgrades within it), refusing every other path with a stable diagnostic”

   **Concern:** The namespace is a security boundary, but the RFC does not define which parsed representation is checked or require the relay and upstream router to interpret request targets identically. A raw-prefix check can be bypassed when the two hops disagree about absolute-form targets, percent-encoded separators or dot segments, duplicate framing headers, or normalization. Upgrade handling is also unspecified: the namespace must be validated before switching protocols, and untrusted forwarding headers must not survive the relay. Merely testing ordinary paths does not establish the claimed isolation from the app plane.

   **Suggested fix:** Specify that the relay uses a standards-compliant HTTP stack, accepts only origin-form request targets (or the HTTP/2 equivalent), matches the canonical path against the exact `/_snapback/` segment, and rejects ambiguous encoding, dot segments, malformed framing, `CONNECT`, and conflicting `Content-Length`/`Transfer-Encoding`. Strip hop-by-hop and all client-supplied forwarding headers; allow `Upgrade` only for a validated WebSocket handshake whose canonical path and Origin passed policy before the `101`. Add adversarial validation cases for encoded separators/traversal, absolute-form requests, prefix lookalikes, conflicting framing, forwarded-header spoofing, and upgrade attempts outside the namespace.

4. **MATERIAL — IN-DELTA**

   **Exact quoted text:**

   > “By default `snapback admin link` stays attached and reports redemption, expiry, or revocation as it observes them”

   > “it dies immediately on revocation, on credential expiry, or with the CLI process”

   **Concern:** “As it observes them” does not support “immediately.” The RFC does not say whether observation is polling, streaming, or leased; what happens when the status channel fails; or how server restart/startup-nonce change is handled. A relay that keeps listening during lost observation can outlive an invalidated unredeemed claim or a revoked/expired credential. Polling also necessarily creates an unstated revocation-delay window. Separate simultaneous claims must not accidentally extend one another’s relays.

   **Suggested fix:** Define a fail-closed lifetime mechanism tied to the exact claim digest and then its exact credential digest. Prefer a short server-issued relay lease renewed over an authenticated status/watch channel; close the listener on explicit revocation/expiry, lease expiry, server startup-nonce change, or loss of observation. If polling is retained, replace “immediately” with a pinned maximum detection latency and close on the first failed or indeterminate status check. Validate unredeemed restart, redeemed restart, observer failure, revocation races, idle/sliding expiry, concurrent claims, graceful exit, and hard CLI termination.

5. **MATERIAL — IN-DELTA**

   **Exact quoted text:**

   > “The CLI reuses a serve mapping that already covers the port, otherwise creates one and removes exactly what it created when its observation ends”

   > “it never leaves behind standing serve configuration it did not find”

   > “`--no-wait` prints the URL and exits”

   > “`--lan` conflicts with `--no-wait`.”

   **Concern:** The Tailscale ownership/lifetime contract is internally incomplete. If `--tailscale --no-wait` creates a mapping, observation ends immediately and cleanup makes the printed link unusable; if cleanup is deferred, the command violates its no-standing-configuration promise. A crash may also strand daemon-owned configuration unless Tailscale supplies a genuine disconnect-scoped lease. Reuse is unsafe without exact matching and concurrency rules: one invocation can reuse a mapping created by another, after which the creator removes it while the second claim still depends on it. “Covers the port” also does not establish the required root-path behavior, tailnet-only access policy, or absence of a broader/public exposure.

   **Suggested fix:** Define an exact reusable mapping as tailnet-only HTTPS at the required root, targeting the exact loopback address and port, with no conflicting path or public policy. Manage command-created mappings through a foreground/disconnect-scoped lease or a locked, reference-counted ownership record with compare-and-delete cleanup and crash reconciliation. Allow `--no-wait` only when an independently owned exact mapping already exists, or make it conflict with `--tailscale`; otherwise introduce a separate bounded helper that owns the mapping through claim/credential termination. Add concurrent-owner, external-mutation, hard-crash, reused-mapping, and `--no-wait` tests.

6. **MATERIAL — IN-DELTA**

   **Exact quoted text:**

   > “Opening the link exchanges the claim atomically for one newly derived `sbcc_` console credential through the ordinary credential path (`no-store`, fragment removed before boot, same storage rules)”

   > “The shared client may persist the derived credential plus its expiry under `snapback_console_credential_v1`”

   > “printing the relay origin in the link”

   **Concern:** The ordinary persistent-client rule is not safe without qualification on an ephemeral or repointable origin. LAN ports can later be reused, and a stable tailnet HTTPS origin can be remapped to another Snapback instance or service. A still-valid bearer stored under the fixed origin/key can then be restored or disclosed to the later service. Early CLI exit tears down the LAN listener but does not currently revoke the bound credential or remove the browser’s persisted copy.

   **Suggested fix:** Give reachability sessions distinct storage semantics: retain the credential only in tab-scoped `sessionStorage`, key it by an unguessable relay-session and instance identifier, and never restore or transmit it until the backend identity matches that session. Revoke the bound credential when an invocation-owned relay or mapping terminates early, and clear its browser record when expiry/revocation is observed. Validate port/origin reuse, backend remapping, reload, CLI exit, and stale-record behavior.

7. **minor — IN-DELTA**

   **Exact quoted text:**

   > “Three composable `snapback admin link` options”

   > “`--qr` renders whichever link the invocation selected (default loopback, `--url-base`, `--tailscale`, or `--lan`)”

   > “it enumerates the device's non-loopback interface addresses, binds the selected LAN interface”

   **Concern:** The option and address-selection grammar is underdetermined. `--qr` clearly composes with an origin selector, but `--url-base`, `--tailscale`, and `--lan` all select competing origins and have no precedence or conflict rule. `--lan` also names a “selected” interface without specifying how selection occurs on multi-homed or non-interactive hosts.

   **Suggested fix:** State that `--qr` composes with at most one of `--url-base`, `--tailscale`, and `--lan`, while those three origin selectors are mutually exclusive with stable usage errors. Define `--lan=<interface-or-address>` or a deterministic interactive selection rule, refuse ambiguity when no TTY exists, and prohibit wildcard binding.

VERDICT: NOT READY
