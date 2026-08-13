# Codex review — LLP 0250/0251 single-family super-refine

## Round 1 — 2026-08-12

**Topology:** lockstep cluster; LLP 0250 is primary and this artifact preserves
the full cluster review once. LLP 0251 has a per-target pointer artifact.

**Reviewed revision:** LLP 0250 SHA-256
`1b9936f4c6bd14a031729d76cf55e5db8f89a82d05df82cfad8c287623085626`;
LLP 0251 SHA-256
`39aa47f2792f1d4ff83b0ebe00d43523f3fc4f564d03780ee880b2df5415bfdf`.

**Capsule:** inventory SHA-256
`44a677fe6f14bef30eaa64e7b6eabf9cf512632223d1ac41fe69738265d7dd95`;
instruction SHA-256
`b5e3da596c404d7ed06aed512af69a57bb12e8ab97f0be12a8469e3fb6d8613a`.

**Runtime:** fresh Codex collaboration agent, `gpt-5.6-sol`, reasoning effort
`xhigh`. The reviewer self-attested capsule-only compliance and made no edits.
The human author explicitly authorized this single-family variation; no Claude
review was requested or run.

**Outcome:** LLP 0250 `READY`; LLP 0251 `NOT READY`; set `NOT READY`.

## Verbatim review

## 1. Overall assessment

LLP 0250 is a strong, supportable research record. Representative high-severity findings were confirmed against the capsule, its duplicate-ticket accounting is honest, and it correctly delegates the broader outbound-policy decisions to LLP 0251. Its remaining weaknesses are evidence-hygiene details, not defects in the findings or prioritization.

LLP 0251 has the right architecture—webhooks as the floor’s source, strict separation between the non-overridable floor and narrower app allowlists, all-answer DNS validation and pinning locally, redirect refusal, proxy suppression, and explicit loopback treatment—but is not decision-complete. It currently describes “one floor” while Cloudflare cannot enforce its defining DNS invariant, leaves central loopback and hosted-claim questions open, does not define canonical allowlist matching or authority-header behavior, introduces an unsafe underspecified proxy escape hatch, and leaves observable redirect and HTTP behavior inconsistent across consumers. Its acceptance section is too narrow to establish the RFC’s stated all-consumer claim.

## 2. LLP 0250

### Strengths

- The concrete R1 mechanism is supported. `src/webhooks.rs` resolves every answer, rejects mixed/non-public sets, pins the resolver, disables redirects, and ignores environment proxies. Both local action-fetch lanes build bare `ureq::AgentBuilder`s, and both Cloudflare lanes call `fetch()` without a destination policy.
- R2’s owner-visibility exit mechanism is supported: visibility participates in `row_matches_query_filters`, but `update_may_have_changed_query_membership` examines only `plan.filters`, while the dependency gate does not consult `Query.rows` as point membership. A transferred-away row can therefore be skipped before delta removal.
- R3’s replay mechanism is supported: `mutate()` defaults to `queue: 'auto'`, replay preserves `clientMutationId`, and Cloudflare explicitly mints a fresh mutation identity because it has no client-mutation replay ledger.
- The document distinguishes observed facts from inferred judgment and gives each active finding a filesystem ticket. The cited open tickets exist, including the updates to the admin-origin and asset-finalize tickets.
- It is honest about masked or conditional findings: R13’s symptom is currently hidden by conservative reserved-projection reruns, R14 carries medium confidence for the stopped-instance case, and Cloudflare proof exposure is not misrepresented as hosted-auth support.
- It preserves the correct policy boundary. R1 records the concrete sibling-control defect, while loopback posture, Cloudflare residual acceptance, and cross-consumer policy remain assigned to LLP 0251.

### MATERIAL concerns

None.

### DETAIL suggestions

- `C250-01`: Bind the review to a repository commit or content digest and record a compact pass map. A date plus moving line numbers is weak provenance in this repository: several issue line references have already shifted within the included snapshot. Symbol names plus a snapshot identity would make the record reproducible without adding process bulk.
- `C250-02`: Qualify the “constant-time compares on admin tokens” bullet as local-target behavior. R9 correctly says the Cloudflare proof uses ordinary string comparison, so the unqualified later bullet reads as contradictory.
- `C250-03`: Separate present operational severity from latent invariant severity for R13. Calling it P2 is defensible for the authorization failure it would produce, but the table should state directly that today’s production path masks it and that it is a dormant boundary defect.
- `C250-04`: The “four parallel passes” statement would be more useful with one sentence mapping each pass to directories and principal checks. Commands and exhaustive logs are unnecessary; the missing coverage map is the useful part.
- `C250-05`: Prefer symbols or section anchors alongside line numbers in the tickets. The mechanisms remain supportable, but line-only references are already stale.

### Open questions

- What priority rubric distinguishes P1 from P2 for local-only, opt-in, or proof-target findings? The choices are reasonable, but stating the threat-model assumptions would make later reprioritization less subjective.
- Should the research record explicitly say it is a high-confidence defect inventory rather than an exhaustive assurance claim? “Whole-codebase review” and “every load-bearing claim spot-verified” are supportable; “complete inventory” would not be.

## 3. LLP 0251

### Strengths

- The RFC correctly identifies webhooks as the intended source of truth and accurately captures their important invariants: bounded credential-free URL parsing, HTTPS default, special-host refusal, all-answer public-address classification, DNS pinning, redirects disabled, and environment proxies disabled.
- The floor/allowlist split is the right conceptual model. An app allowlist must narrow the floor and must never authorize metadata or private destinations.
- Mixed public/private DNS answers are explicitly refused, avoiding “choose the good answer for validation, connect to the bad answer” behavior.
- Local loopback is treated as an explicit exception rather than inferred from the listener bind address. The tunnel warning is important.
- The RFC correctly preserves authored URLs rather than returning secret-substituted or post-redirect representations.
- Capability honesty is directionally good: the document does not call a Cloudflare lexical check plus platform DNS a multi-tenant SSRF proof, and its acceptance currently withholds a hosted-outbound claim.
- The v1 no-follow posture substantially simplifies secret propagation and DNS revalidation.

### MATERIAL concerns

#### `C251-01` — Cloudflare does not implement the stated floor

The floor is defined by classifying every resolved address and pinning the validated set. The Cloudflare design can do neither for hostname URLs, yet the Summary and Consumers table say Cloudflare receives the same floor. Refusing literal private IPs and using `redirect: 'error'` is a useful lexical subset, not the same invariant.

Open question 2 therefore cannot remain open in an RFC ready for acceptance. The document must define a target-specific capability result. A coherent minimal decision would be:

- local/webhook/push paths using the shared Rust transport may report the floor `Enforced`;
- Cloudflare reports the floor `Missing` or an explicitly weaker non-claim state for user-selected hostname destinations;
- a narrowly scoped fixed-provider claim may be retained only if the exact provider authority is enforced by an app/deployment allowlist and the reliance on Cloudflare’s platform resolver is named as a target residual;
- generalized or user-supplied-hostname outbound remains unclaimed.

This also needs explicit reconciliation with LLP 0049’s existing narrow `refreshFeed`/`routeEstimate` claim. The current text’s “no hosted-outbound claim” can be read as silently withdrawing that Implemented claim, while other passages appear to preserve it.

#### `C251-02` — Canonical URL and allowlist matching semantics are missing

“Port the same predicates” and “allowlists compose on top” are insufficient for a security boundary implemented by different URL parsers. Two nominally conforming implementations can disagree on IDNA, trailing dots, non-canonical IPv4 spellings, default ports, percent encoding, or whether validation and transport use the same normalized authority.

The RFC need not define an exhaustive schema, but it must decide the minimum interoperable algorithm:

1. parse once with the target’s designated parser;
2. reject control characters, oversize input, userinfo/passwords, and fragments;
3. normalize hostname/IP and effective port;
4. match the allowlist against that canonical authority;
5. reject caller-supplied `Host`/`:authority` overrides;
6. resolve and classify every answer;
7. pin exactly that address set where the target supports pinning;
8. send using the same parsed authority and prepared target.

Allowlist matching also needs a minimal rule—preferably exact normalized host plus effective port in v1, with no wildcard or suffix semantics until separately decided. This is policy, not merely the deferred authoring UX.

#### `C251-03` — Consumer policy and redirect behavior are observably inconsistent

The closed enum is not mapped to each consumer/profile. It is therefore unclear whether local `ctx.fetch` and `ctx.fetchStream` are HTTPS-only, whether public HTTP remains supported, and how the Expo test-loopback override selects the loopback policy. This matters because Accepted LLP 0076 currently promises absolute HTTP(S), while LLP 0143 has a local/test loopback Expo carrier.

Open question 1 also conflicts with the Design text: Design says loopback is default-off unless explicitly enabled or under the test harness, while the open question asks whether it should be default-on.

Redirect handling is additionally non-portable:

- local `ureq` with `redirects(0)` exposes a 3xx response to buffered and streamed actions;
- Cloudflare with `redirect: 'error'` converts the same 3xx into a transport-style refusal;
- webhooks classify it as a delivery rejection;
- push classification consumes the HTTP status.

The RFC must provide a consumer/profile matrix covering scheme, loopback, and 3xx behavior. For the portable action surface, either every target exposes the original 3xx response without following it, or every target returns the same typed refusal. The current mixture is not one coherent contract.

#### `C251-04` — The explicit-proxy carve-out invalidates the pinning argument

The RFC says v1 ignores environment proxies “unless the operator sets an explicit Snapback proxy config,” but supplies no trust or resolution model for that proxy. A forward proxy may resolve the hostname itself, so local pre-resolution and pinning no longer constrain the actual destination. The proxy endpoint can also be non-public.

The simplest safe v1 decision is to forbid all proxies. A later trusted-proxy profile can define whether the proxy is the policy-enforcement boundary, how its own endpoint is classified, how destination allowlists are conveyed, and what capability state is reported. The current carve-out silently weakens the webhook source-of-truth floor.

#### `C251-05` — Secret-bearing refusal ordering and diagnostics are underspecified

The RFC inherits LLP 0036/0076 redaction requirements but does not say when destination and allowlist checks occur relative to descriptor unwrap, nor how new destination refusals map to consumer diagnostics. A conforming implementation could materialize a descriptor into a query parameter and then include the rejected raw URL or a 3xx `Location` header in an error.

The normative order should be: parse/canonicalize, allowlist, DNS/classification/pinning, then unwrap secret descriptors immediately before send. Every new refusal and redirect path must be value-free or pass through the invocation’s staged-value redactor; raw URLs, headers, bodies, and substituted locations must not enter diagnostics or retained receipts. Public codes may remain consumer-specific, but the internal reason vocabulary should be closed.

The `runtime.log` ticket is a valid sibling defect, but it should not be described as something this RFC “adds” unless the acceptance checklist also makes it part of implementation. Keeping it explicitly separate is cleaner.

#### `C251-06` — Migration and acceptance do not cover the RFC’s claimed scope

The migration consequences are material and currently absent:

- public HTTP action callers may break if `PublicHttpsOnly` is selected;
- local loopback tests and the Expo fake carrier need an explicit policy selection;
- LLP 0049’s existing narrow Cloudflare claim must be retained, narrowed, or withdrawn explicitly;
- `egress_ssrf_floor` is new capability vocabulary and needs defined semantics, especially when the loopback exception is active;
- existing app/deployment allowlist gaps need a transition rule.

The acceptance checklist covers local action fetch, webhook regression, a limited Cloudflare lexical check, and manifest posture. It does not prove the stated all-consumer policy. An Implemented claim needs, at minimum:

- parse/canonicalization fixtures shared across Rust and JavaScript;
- a resolve-once/connect-pinned TOCTOU witness, not only classifier unit tests;
- exact allowlist composition and authority-header negative tests;
- loopback opt-in/default-off and tunnel-profile negatives;
- consistent 3xx behavior for buffered and streamed action fetch on both targets;
- secret-bearing rejected-target and redirect tests;
- the production push carrier and its local fake endpoint using the shared primitive;
- explicit-proxy refusal;
- capability assertions for each target, including Cloudflare’s degraded state.

### DETAIL suggestions

- `C251-07`: The metadata says `Review`, while the final Status section says `Draft` and says ratification may follow implementation. Make the status text consistent with the author-authorized loop state.
- `C251-08`: Add LLP 0070 to `Related`; `src/webhooks.rs` itself identifies that LLP as the owner of the webhook primitive.
- `C251-09`: Push is already implemented under LLP 0143, so replace “later push-provider calls” with current-tense wording.
- `C251-10`: If redirects remain disabled in v1, the statement about ureq’s default Authorization propagation is not load-bearing. For a future follow mode, require explicit stripping of every sensitive header and secret placement across an authority change, not just `Authorization`.
- `C251-11`: State that `is_public_ip` is a conservative destination-admission classifier, not a general claim about global routability. This makes future reserved-range updates easier to reason about.

### Open questions

The present OQ1 and OQ2 are acceptance-blocking decisions and must be resolved in the RFC text.

OQ3 should resolve to “action fetch needs its own cross-target matrix”; webhook tests alone cannot prove consumer integration, redirect semantics, or secret-safe diagnostics.

OQ4 is already answered “yes” by the proposal and should move out of Open questions into the consumer matrix.

Additional decisions needed are:

- Is v1 entirely proxy-free?
- Are local action fetches public-HTTPS-only, and how is the Accepted LLP 0076 HTTP(S) surface migrated?
- Does the portable action API expose or refuse unfollowed 3xx responses?
- What exact canonical authority does an allowlist match?

## 4. Cross-document consistency and concern ledger

LLP 0250 and LLP 0251 agree on the core defect: webhook delivery has a materially stronger destination boundary than local and Cloudflare action fetch. LLP 0250 correctly avoids deciding loopback, Cloudflare residual acceptance, and allowlist semantics itself.

The inconsistency is inside LLP 0251 and between it and governing Implemented/Accepted documents:

- it calls Cloudflare’s lexical subset the same floor while admitting the defining DNS invariant is unavailable;
- it does not reconcile its hosted-claim posture with LLP 0049’s narrow implemented egress claim;
- it does not reconcile HTTPS-only policy with LLP 0076’s accepted HTTP(S) surface;
- it includes push but does not map or test LLP 0143’s production and local/test provider endpoints;
- it inherits secret safety from LLP 0036/0076 without specifying new refusal ordering or evidence.

Complete ledger:

| ID | Target | Class | Disposition |
|---|---|---|---|
| `C250-01` | 0250 | DETAIL | Add snapshot identity and pass map. |
| `C250-02` | 0250 | DETAIL | Scope constant-time admin-token claim to local. |
| `C250-03` | 0250 | DETAIL | Clarify R13’s latent/masked operational posture. |
| `C250-04` | 0250 | DETAIL | Record compact pass-to-directory coverage. |
| `C250-05` | 0250 | DETAIL | Prefer symbols/anchors alongside drifting lines. |
| `C251-01` | 0251 | MATERIAL | Define Cloudflare’s degraded enforcement and reconcile hosted claims. |
| `C251-02` | 0251 | MATERIAL | Define canonical authority, allowlist matching, ordering, and Host-header rules. |
| `C251-03` | 0251 | MATERIAL | Resolve per-consumer scheme, loopback, and 3xx semantics. |
| `C251-04` | 0251 | MATERIAL | Remove or fully specify the explicit-proxy exception. |
| `C251-05` | 0251 | MATERIAL | Specify pre-unwrap checks and secret-safe refusal/redirect diagnostics. |
| `C251-06` | 0251 | MATERIAL | Add migration decisions and all-consumer acceptance evidence. |
| `C251-07` | 0251 | DETAIL | Reconcile Review metadata with Draft footer. |
| `C251-08` | 0251 | DETAIL | Add LLP 0070 relationship. |
| `C251-09` | 0251 | DETAIL | Describe push as a current consumer. |
| `C251-10` | 0251 | DETAIL | Tighten future redirect secret-header rule. |
| `C251-11` | 0251 | DETAIL | Clarify conservative classifier terminology. |

## 5. Provenance

Model: GPT-5.6-sol. Reasoning effort: xhigh.

I reviewed only the supplied capsule directory. I did not read the parent repository or any path outside the capsule, did not consult target-specific prior review artifacts or orchestrator notes, and did not edit any file. I inspected the exact two target documents, their cited governing LLPs, relevant implementation, capability manifests, guide material, and issue records contained inside the capsule.

LLP 0250 VERDICT: READY
LLP 0251 VERDICT: NOT READY
SET VERDICT: NOT READY

## Round 2 — 2026-08-12 (delta + implementer lens)

**Topology:** lockstep cluster; LLP 0250 remains primary. Fresh reviewer; the
writer of r2 did not review it.

**Reviewed revision:** LLP 0250 SHA-256
`3e3ed0749284e9d47a1860457c788586728c5d1d14282e46c13fc2806bab49f6`;
LLP 0251 SHA-256
`59c115052c93a0cc0b0687f8ef2c6a0d3ca305230c684f30cf8a0ef8714dd32f`.

**Capsule:** inventory SHA-256
`772c371197481546cb4f797e7c85ab9aa6461258f36242fabd6d5d6e7bbf8841`;
instruction SHA-256
`69b54c4e6c6a314941b877d7e12f389e7d361d7daebb1fcd882db9e6d9cc14f8`.

**Runtime:** fresh Codex collaboration agent, `gpt-5.6-sol`, reasoning effort
`xhigh`. The reviewer self-attested capsule-only compliance, did not write r2,
and made no edits.

**Outcome:** LLP 0250 `NOT READY`; LLP 0251 `NOT READY`; set `NOT READY`.
Three MATERIAL concerns: one PRE-EXISTING in LLP 0250 and two IN-DELTA in LLP
0251. No other material concern was found.

### Verbatim review

## 1. Overall assessment and implementer derivation

The pair is not ready. Most of LLP 0251 is now implementable and security-coherent, but the claimed universal consumer scope is incomplete, and its trusted-local loopback exception lacks an authoritative admission fact even though the repository explicitly records that a loopback bind cannot distinguish a public tunnel.

From LLP 0251 alone, an implementer would otherwise derive:

1. Parse the original URL once, before secret materialization. Reject malformed, oversized, control-bearing, credential-bearing, fragmented, zoned, hostless, or non-HTTP(S) input.
2. Canonicalize the destination key as `{host, effectivePort}`:
   - parser-emitted ASCII/IDNA lowercase host;
   - one terminal DNS dot removed;
   - canonical IP spelling;
   - explicit `443` or `80` when the port is omitted.
   Scheme, path, suffixes, wildcards, and implicit ports do not participate in v1 allowlist matching.
3. Reject case-insensitive caller or secret-slot attempts to set `Host` or `:authority`; match any allowlist against the exact canonical key.
4. Apply the consumer profile:
   - production destinations are HTTPS;
   - webhook production has no loopback exception;
   - local actions have a default-off loopback exception;
   - Cloudflare has no loopback exception;
   - Expo production is pinned to the Expo authority;
   - the Expo fixture uses an explicit test-only loopback profile.
5. On an enforcing Rust target, resolve exactly once, sort and deduplicate, reject empty, mixed, or any non-public answer set, and retain only an all-loopback set for the selected exception.
6. Connect with the same authority and exactly the prepared address set, with no resolver replay, redirects, or environment/explicit proxies. Only then may query-parameter or non-authority-header secret slots unwrap.
7. Map 3xx outcomes as follows:
   - webhook: existing permanent delivery classification;
   - local buffered and streamed actions: `SNAPBACK_OUTBOUND_REDIRECT_REFUSED`;
   - Cloudflare buffered and streamed actions: the same code after `redirect: 'manual'`, with `Location` discarded;
   - Expo: no follow and an existing closed provider outcome;
   - future workerd action fetch: the same action refusal.
8. Report capabilities independently:
   - `egress_ssrf_floor: Enforced` only when resolution, every-answer classification, pinning/equivalent, proxy refusal, and no-follow are all enforced;
   - Cloudflare reports that floor `Missing`;
   - `egress_destination_allowlist` is `Enforced` only for exact canonical authorities;
   - loopback posture is separately qualified as `off`, `test-only`, or `operator-enabled-trusted-local`.
9. Migrate webhooks without weakening outcomes, move local buffered/streamed actions and Expo production/fixture traffic onto the Rust primitive, require HTTPS for public action destinations, add exact Cloudflare provider authorities, preserve Cloudflare’s platform-DNS residual wording, and satisfy the seven-part acceptance matrix before claiming implementation.

That derivation is determinate except for the two material LLP 0251 concerns below.

## 2. LLP 0250 findings and verdict rationale

The r2 hash matches the requested vector. The delta edits are useful and accurate:

- the evidence snapshot and stable symbol/anchor guidance improve reproducibility;
- the four-pass method and P1/P2/P3 rubric preserve the original findings;
- the local-target scoping fixes the prior overbreadth around constant-time comparisons;
- R13 accurately describes `CapturedReadKind::Permission` as dormant and presently masked by the always-rerun reserved-asset path.

**C250-01 — PRE-EXISTING — MATERIAL.** The unchanged “Outbound destination policy is three different products” finding is factually incomplete and sends LLP 0251 to an incomplete design inventory. `src/ask.rs` is already a current, host-mediated provider HTTP consumer: it accepts a manifest-selected OpenAI-compatible HTTPS base or loopback HTTP fixture, is guarded by the outbound-action switch, attaches a bearer credential, and uses a separate ureq transport with redirects disabled but without webhook DNS classification, address pinning, or proxy refusal. LLP 0204 D5 explicitly describes this model plumbing as riding the egress machinery. It is therefore a current additional destination-policy product, not an eventual edge case. The document’s non-exhaustive-assurance disclaimer does not make the categorical architectural count accurate. The finding should include the ask carrier, relate LLP 0204, and decide whether its omitted floor is a finding, a separately tracked gap, or an explicitly justified exclusion.

Because that error changes the scope of the very RFC LLP 0250 commissions, it is material to the research record rather than editorial detail.

## 3. LLP 0251 findings and verdict rationale

The central security decisions are strong: exact normalized authority keys, every-answer classification, address pinning, proxy-free transport, same typed action redirect refusal, pre-unwrap destination admission, value-free failures, Cloudflare’s honest `Missing` floor, and separation of floor/allowlist/loopback capability facts all align with the governing webhook, execution, secret, action-stream, push, and hosted-claim contracts.

Two material concerns remain.

**C251-01 — IN-DELTA — MATERIAL / UNDERDETERMINED.** The rewritten universal scope, consumer matrix, migration text, and acceptance matrix still omit current host-mediated consumers. The clearest is `src/ask.rs`, whose custom provider destination and bearer-bearing transport are exactly the sort of non-overridable destination-policy boundary the RFC claims to govern. The phrase “still action-only” is also inaccurate for the externally invoked ask loop, even though its provider call reuses the outbound-action enablement switch. The S3-compatible asset transport further demonstrates why “every host-mediated outbound HTTP hop” cannot be taken literally without another decision: it accepts an operator-selected endpoint, uses a bare ureq transport, and intentionally supports local MinIO, which conflicts with the RFC’s public-HTTPS-only profiles.

Two reasonable implementations can therefore diverge materially:

- one can apply the RFC only to the six listed consumers while still claiming universality;
- another can include ask and infrastructure/provider transports, which requires additional fixed-provider, trusted-infrastructure, loopback, secret-ordering, outcome, capability, and migration decisions.

Resolve this by either narrowing the RFC’s normative scope to a precisely named application-egress class and explicitly excluding other transports, or inventorying every current in-scope consumer. At minimum, ask needs a matrix row, LLP 0204 relation, prepared-target/secret-order rule, capability consequence, migration, and acceptance witness. Operator infrastructure such as S3 must be explicitly included under a decided trusted-service profile or explicitly excluded from the universal claim.

**C251-02 — IN-DELTA — MATERIAL / UNDERDETERMINED.** The loopback exception requires a “trusted, non-tunnelled local profile,” says a loopback bind is not evidence, and requires tunnelled profiles not to inherit the switch, but defines no authoritative fact that distinguishes those states. LLP 0060 D1 and the open tunnel issue establish that a loopback-bound server behind ngrok, Cloudflare Tunnel, Tailscale, or a reverse proxy remains bind-derived `dev`, and that the current server cannot detect the front. This is load-bearing because the motivating R1 explicitly combines tunnelled dev exposure with loopback-fetch authority.

An implementer could treat `SNAPBACK_OUTBOUND_LOOPBACK=1` plus `ServerProfile::Dev` as sufficient, reintroducing loopback SSRF through a tunnel; another could require a new exposure attestation; a third could permit loopback only in the test harness. Those are materially different security policies. The RFC must choose one. Safe determinate options include:

- make loopback HTTP test-harness-only;
- define the egress-specific switch as an explicit, machine-reported operator attestation and weaken the claim to declared trusted-local posture, while naming undeclared tunnels as undetectable;
- bind it to a new effective-exposure authority and keep it refused until that authority exists.

The acceptance test must then exercise the exact decided fact source rather than merely a loopback bind or generic server profile.

## 4. Cross-document consistency and complete stable-ID concern ledger

The documents agree on the original R1 mechanism, webhook behavior as the source of truth, Cloudflare’s DNS-pinning residual, HTTPS migration, no-follow policy, exact provider authorities, and the fact that allowlists cannot upgrade a missing SSRF floor. LLP 0251’s push treatment is compatible with LLP 0143’s fixed production endpoint and closed outcomes. Its action treatment intentionally and clearly narrows LLP 0076’s former absolute HTTP(S) input shape. Growth remains within the declared budget.

The remaining inconsistency is the outbound-consumer inventory: LLP 0250’s unchanged architectural finding omits ask, while LLP 0251’s rewritten universal contract and acceptance matrix perpetuate that omission.

| Stable ID | Classification | Affected document | Required resolution |
|---|---|---|---|
| C250-01 | PRE-EXISTING — MATERIAL | LLP 0250 | Correct the categorical outbound-policy inventory to include current ask provider egress and disposition its missing floor. |
| C251-01 | IN-DELTA — MATERIAL / UNDERDETERMINED | LLP 0251 | Precisely bound “every host-mediated outbound HTTP hop”; include ask and decide infrastructure/provider transport treatment, or explicitly exclude them and narrow the claim. |
| C251-02 | IN-DELTA — MATERIAL / UNDERDETERMINED | LLP 0251 | Define the authoritative trusted-local/non-tunnelled admission fact and capability semantics for loopback HTTP. |

No other unresolved material concern was found.

## 5. Provenance and capsule-only self-attestation

Fresh Codex GPT-5.6-sol reviewer, xhigh reasoning, implementer/delta lens. I did not write r2 and did not read, consult, or infer any prior target-specific review response.

I read only files rooted under the supplied round-2 capsule, including `REVIEW_INSTRUCTIONS.md`, both baseline/current targets, governing LLPs 0009, 0036, 0047, 0049, 0060, 0070, 0076, 0143, 0204, and 0216, relevant issues, and relevant implementation under `src/` and `cloudflare/`. All commands used the capsule as their working directory and relative paths. I did not read the parent repository or any outside path, and I made no edits.

I verified the current target hashes exactly:

- LLP 0250: `3e3ed0749284e9d47a1860457c788586728c5d1d14282e46c13fc2806bab49f6`
- LLP 0251: `59c115052c93a0cc0b0687f8ef2c6a0d3ca305230c684f30cf8a0ef8714dd32f`

LLP 0250 VERDICT: NOT READY
LLP 0251 VERDICT: NOT READY
SET VERDICT: NOT READY

## Round 3 — 2026-08-12 (final delta + cross-consistency lens)

**Topology:** lockstep cluster; LLP 0250 remains primary. Launch 1 failed
before receipt due to a Codex response-stream transport disconnect and produced
no review body. Launch 2 used a fresh reviewer against the same unchanged
capsule and hash vector.

**Reviewed revision:** LLP 0250 SHA-256
`12023fa7aaba5e23555c7b7a482c701a28096ca04e975d35285ccd1a6afd1d66`;
LLP 0251 SHA-256
`e8bdef3288ecc24c2470ab22b774792138f95d72bf2999e60fab0e3253bb0c08`.

**Capsule:** inventory SHA-256
`3da169acaedc7aee76df0dce23da1a406f1099c4dfbacd1f1dfd0c352faf6f63`;
instruction SHA-256
`1f7decf9dff4b71d78c7fb33b2a8750e18a1c8f8fa63b26981533382e58d4f04`.

**Runtime:** fresh retry Codex collaboration agent, `gpt-5.6-sol`, reasoning
effort `xhigh`. It did not write r3, made no edits, and self-attested that it
used no project or review evidence outside the capsule. It disclosed reading
the platform-required super-refine workflow only as controlling process
guidance; that supplied no target or prior-review evidence and does not impair
review blindness.

**Outcome:** LLP 0250 `READY`; LLP 0251 `READY`; set `READY`. No MATERIAL
concern. One IN-DELTA DETAIL was recorded and is altitude-dispositioned after
the verbatim review; no text changed after this verdict.

### Verbatim review

## 1. Overall assessment and final implementer derivation

The r3 pair is READY. I found no unresolved MATERIAL correctness, coherence, feasibility, safety, or decision-quality concern.

An implementer can derive one coherent contract:

- The governed class is application/integration egress: host HTTP whose destination is selected by application input or declaration and which carries application effects, application data, or provider credentials. Webhooks, action fetch, Ask, Expo push, and future app-facing workerd fetch are explicitly in scope.
- S3-compatible asset transport, deployment, CLI/control-plane HTTP, and private workerd invocation/readiness are operator/target infrastructure. They are outside the class and receive no capability implication from this RFC.
- A Rust request earns `egress_ssrf_floor: Enforced` only after parse-once canonicalization, exact authority admission, caller `Host`/`:authority` refusal, public-HTTPS selection, every-answer DNS classification, resolve-once connection pinning, proxy refusal, and no-follow behavior. Credential placement occurs only after the destination is fixed.
- Cloudflare applies the lexical, exact-authority, literal-address, and redirect subset, but hostname requests remain `egress_ssrf_floor: Missing`; an allowlist cannot upgrade that fact.
- Floor enforcement and exact-authority allowlisting are separate capabilities. Every served target reports loopback `off`; infrastructure transports and internal fixture receipts cannot enlarge either served capability.
- `TestLoopbackHttp` is the sole positive loopback authority. It is unexported, constructed directly by test code, absent from all app/operator configuration and wire surfaces, and never inferred from bind address, Dev/Test profile, or tunnelling.
- Current Ask derives its destination from the manifest provider string: the default is `https://api.openai.com/v1`; a custom `openai-compatible:<base>` currently accepts HTTPS or literal localhost/loopback HTTP, appends `/chat/completions`, sends an app-custodied or caller-presented bearer, disables redirects, but uses ordinary resolver/proxy behavior without every-answer classification or address pinning.
- Under LLP 0251, served Ask becomes exact-manifest-authority HTTPS through the shared Rust primitive, with the bearer attached only after target preparation, no redirects, no proxy, and no served loopback. Only a directly supplied test capability may reach a loopback fixture.
- That Ask derivation composes with LLP 0204: LLP 0204 continues to own caller authority, consent, billing, provider/model declaration, and secret custody, while LLP 0251 owns the network destination floor.

The r2 security decisions remain intact: canonical exact authorities, no wildcard/suffix/path allowlists, caller authority-header refusal, every-answer classification and pinning for Enforced, public HTTPS, proxy-free v1, portable action 3xx refusal, pre-send credential ordering, value-free diagnostics, honest Cloudflare Missing, distinct floor/allowlist facts, and executable migration/acceptance obligations.

## 2. LLP 0250 findings and rationale

LLP 0250 remains an accurate research record and is consistent with LLP 0251.

The Ask addition is supported by the capsule code: `src/ask.rs` uses a manifest-selected OpenAI-compatible base, emits an `Authorization: Bearer` header, creates a zero-redirect ureq agent, and lacks webhook-style DNS classification, pinning, and explicit environment-proxy refusal. Its distinction from R1 is sound: R1 is the handler-authored/user-URL action-fetch defect, while Ask’s destination is deployment-manifest-selected and belongs in the architectural policy migration.

The LLP 0204 linkage is also correct. LLP 0204 D5 makes provider/model selection app policy, places provider HTTP behind outbound egress, and requires disclosure that authorized app data leaves for that provider. LLP 0250 does not incorrectly move caller admission or provider consent into the destination RFC.

One non-blocking editorial precision issue remains: LLP 0250 names Ask’s missing DNS/proxy controls but does not explicitly record that current `parse_provider` also accepts manifest-declared loopback HTTP without a distinct test-only authority. The RFC’s migration makes the intended correction unambiguous, and LLP 0250 expressly disclaims exhaustiveness, so this is DETAIL rather than a defective decision.

## 3. LLP 0251 findings and rationale

No MATERIAL concern.

The application/integration class is determinate because the RFC supplies both a semantic inclusion rule and an explicit initial inventory, then names the neighboring infrastructure class and denies it inheritance. The capability definition is correspondingly scoped to “every in-scope served request,” and Acceptance item 7 requires excluded transports to gain no claim.

Ask’s destination, credential, redirect, and loopback treatment is complete enough to implement without a new design decision:

- exact authority comes from the manifest provider;
- served traffic is HTTPS;
- full Rust admission and pinning precede outbound bearer placement;
- redirects are closed provider failures with no `Location`;
- proxies are unavailable in v1;
- served loopback is refused;
- fixture loopback requires direct possession of the unexported capability.

The loopback contract has one authoritative positive source. Profiles, listener binds, tunnels, manifests, environment variables, CLI, HTTP, host operations, and handler arguments are all explicitly non-authoritative. Runtime manifests therefore always report `off`, while fixture evidence alone may say `test-only`.

The migration is feasible. The existing webhook preparation/pinning transport supplies the concrete Rust precedent; local action fetch, Ask, and Expo are named migrations; Cloudflare has an explicitly degraded subset; and the acceptance section requires both buffered and streamed paths, Ask, production/fake push, secret-safe negative cases, TOCTOU evidence, and capability honesty.

## 4. Cross-document consistency and complete stable-ID ledger

The pair is internally consistent:

- LLP 0250 records the observed split and assigns unification to LLP 0251.
- LLP 0251 preserves R1’s handler-authored action-fetch urgency without pretending that ticket already covers fixed-provider Ask.
- LLP 0204 retains Ask authority, consent, billing, and provider policy; LLP 0251 adds destination safety.
- LLP 0076’s prior absolute HTTP(S) action shape is explicitly narrowed to served public HTTPS.
- LLP 0143’s current local/test endpoint override is intentionally replaced by direct fixture capability injection rather than silently grandfathered.
- Cloudflare’s existing fixed-provider action shapes survive only under residual wording and cannot claim the full SSRF floor.

Stable-ID ledger:

- **SR3-0250-D1 — IN-DELTA — DETAIL:** LLP 0250’s current-state Ask paragraph should ideally state that `src/ask.rs::parse_provider` presently accepts manifest-declared loopback HTTP without a separate test authority. This is an editorial completeness improvement, not a MATERIAL defect: LLP 0251 clearly removes served loopback and defines the sole future test authority.
- **PRE-EXISTING ledger:** none. Full-document review found no unresolved PRE-EXISTING MATERIAL or DETAIL concern.
- **MATERIAL ledger:** none.

## 5. Provenance and capsule-only self-attestation

Reviewer: fresh Codex-family final-round reviewer, assigned GPT-5.6-sol at xhigh reasoning. I did not write r3.

The reviewed r3 vector matches the instructed hashes:

- LLP 0250: `12023fa7aaba5e23555c7b7a482c701a28096ca04e975d35285ccd1a6afd1d66`
- LLP 0251: `e8bdef3288ecc24c2470ab22b774792138f95d72bf2999e60fab0e3253bb0c08`

The exact capsule r2 baselines compared were:

- LLP 0250: `3e3ed0749284e9d47a1860457c788586728c5d1d14282e46c13fc2806bab49f6`
- LLP 0251: `59c115052c93a0cc0b0687f8ef2c6a0d3ca305230c684f30cf8a0ef8714dd32f`

I inspected no project or review evidence outside the supplied round-3 capsule, did not consult target-specific review artifacts, did not infer prior review responses, and made no edits. Before reviewing, I read the platform-required `llp-super-refine` workflow instruction solely as controlling process guidance; it supplied no target evidence or prior-review content.

LLP 0250 VERDICT: READY
LLP 0251 VERDICT: READY
SET VERDICT: READY

### Altitude-rule disposition

- **SR3-0250-D1:** dispositioned as editorial/implementation-phase detail and
  deliberately not applied after the verdict. LLP 0251's normative migration
  already makes current Ask loopback removal determinate; changing LLP 0250
  would create a later unreviewed revision for no decision-quality benefit.
