# Reviews — LLP 0204: App external surfaces (family: gpt-5.6-sol)

## Round 1 — 2026-08-08

**Provenance:** External family reviewer — OpenAI gpt-5.6-sol via
`codex exec`, reasoning effort xhigh, cwd = capsule worktree at commit
26c16b2eb (structural blindness: capsule excludes `llp/reviews/0204-*`
and orchestrator notes). Orchestrator: Claude Fable 5 super-refine
session; reviser: orchestrator (did not review). Target revision:
26c16b2eb; target sha256:
b3d39fad27a8aba8f9deb61a3b39647725cefc4ca39fa2d441755e81ca50aac6.
Review received 2026-08-08 and preserved verbatim below.

**Verdict: NOT READY** (6 material, 6 minor).

---

The “one authority, many projections” direction is strong, but revision `b3d39fad27a8aba8f9deb61a3b39647725cefc4ca39fa2d441755e81ca50aac6` is not ready. Several decisions currently weaken established authority boundaries or claim guarantees their proposed evidence cannot support.

## Material concerns

1. **M1 — D6, lines 363–387: server-side code mode treats the handler VM as an untrusted-code sandbox.** Type-checking, `no-eval`, and per-call authorization prevent authority widening through the injected client, but do not establish containment of hostile caller-supplied programs. LLP 0062 explicitly classifies server-side code mode as ad-hoc function deployment with unresolved isolation, provenance, and resource limits; LLP 0047 requires a killable runtime, enforced CPU/heap/result limits, no ambient powers, and per-invocation isolation before untrusted execution is claimed. This is MATERIAL because `/api/v1/run` otherwise creates a denial-of-service or escape boundary on every exposed app. **Disposition:** gate code mode on a separately evidenced untrusted-code capability satisfying all LLP 0047 requirements; refuse it on targets lacking that capability. Do not treat ordinary handler qualification as sufficient evidence.

2. **M2 — D7 lines 395–404 and D8 lines 456–466: integration, OAuth-client, and agent ownership are conflated.** The integration record simultaneously carries OAuth client metadata, an LLP 0055 agent credential, budgets, and a required app-user owner, while DCR creates it before user consent. Under LLP 0055/0150, an owning user may re-credential the agent, revoke all its grants, and assume durable memberships it accumulated. If one OAuth integration serves multiple users, its first owner therefore gains control over other users’ installation; if every user gets a separate record, the proposed stable OAuth-client/DCR and per-integration semantics are not what the RFC describes. This is a load-bearing authority ambiguity, not storage plumbing. **Disposition:** separate client/integration registration from per-user installation/grant authority, or explicitly choose a strictly per-user client model. In either case, define when ownership is established and prove that no user can re-credential or assume another user’s delegated installation.

3. **M3 — D7 lines 405–432: the declared tier promotes an unauthenticated string into durable and later claimable identity.** Auto-creating a ledger row for every caller-chosen value contradicts LLP 0071’s requirement that unknown caller strings cannot create unlimited durable buckets; composing request budgets with a network ceiling limits rate, not accumulated rows over time. More fundamentally, an identifier with no secret or registration proof cannot later be “claimed” with continuity: another party can claim an aged, attributed, or operator-blessed string and inherit its history or treatment. This is MATERIAL as both a durable-state abuse channel and an unsound trust transition. **Disposition:** bound pre-auth state with a low-cardinality outer gate, global quota, TTL, and eviction; issue a new authenticated identifier on upgrade. Prior declared history may be attached only as explicitly untrusted attribution, or after a real contact/operator proof.

4. **M4 — D1 lines 211–214 and D7 lines 412–424: anonymous eligibility contradicts the corpus’s `optional-user` semantics.** LLP 0058 and LLP 0172 state that both `public` and `optional-user` admit anonymous callers. This RFC says exposure preserves existing function authorization, but then defines the declared lane as reaching only exposed `public` functions while claiming this is “same as anonymous.” Implementations can therefore legitimately derive different public APIs. Because the exposure declaration is the RFC’s keystone, this ambiguity is MATERIAL. **Disposition:** decide the external anonymous set explicitly. Either include both `public` and `optional-user`, or define and mechanically enforce a stronger external `public`-only rule across API, MCP, CLI, code mode, envelope, and documentation.

5. **M5 — D9.1 lines 481–495: “multi-viewer by default” is not authority-non-widening.** Stream chunks from an action or `ask` may be derived from data read under the initiating caller’s grant. A second principal’s permission to subscribe to a session or room does not prove that principal could have read every input incorporated into those chunks. Existing ephemeral machinery authorizes each subscriber and keeps authorization domains separate; “normal query authorization” does not by itself supply the missing result-level proof. This is MATERIAL because the chosen default can disclose one principal’s data to another. **Disposition:** make streams private to the initiating authority by default. Multi-viewer streams should require an explicit sharing declaration and either per-viewer re-evaluation/non-widening proof or delivery through a durable result query whose ordinary row authorization independently admits that viewer.

6. **M6 — D5 lines 351–354 and D9.5 lines 539–550: receipts are assigned guarantees they do not provide.** Function names plus argument/result digests are an audit trace; without result bytes and a stable snapshot identity they cannot verify the agent’s answer or its derivation. Likewise, an approval binding that revalidates only generation and authority can execute a materially different effect after relevant data, deterministic inputs, or provider state changes. LLP 0149 F4 and F9 explicitly distinguish these cases. This is MATERIAL because these receipts are presented as the trust basis for near-data answers and consequential writes. **Disposition:** label call traces as provenance only unless they carry verifiable evidence. For approval, use a short-lived plan receipt binding read/data versions, deterministic inputs, and effect summary, then re-execute and compare or refuse stale; otherwise present the ceremony honestly as prospective authorization, not approval of a verified preview.

## Minor / implementation-phase notes

1. **m1 — D1 lines 202–210:** `disclosure: "full"` is a deliberate exception to the preceding claim that exposure governs callability, disclosure, and documentation “as one fact.” State the exception directly so projections do not diverge accidentally.

2. **m2 — D2 lines 234–252:** the stability regime needs an implementation-phase compatibility classifier covering input, result, refusal, auth, pagination, and effect metadata, plus evidence that deprecated implementations remain callable throughout their window.

3. **m3 — D1/D2/D6:** add adversarial acceptance proving that an integration cannot reach an unexposed function through legacy `/query|mutation|action` routes, live subscriptions, nested calls, MCP, or code mode. The RFC states the invariant but does not enumerate these bypass paths.

4. **m4 — D9.4 lines 524–537:** capability links should formally amend LLP 0150’s bearer-exception inventory and inherit secret-URL controls: no logging or referrer leakage, no mutation on GET, preview-crawler safety, bounded maximum expiry, and explicit single-use/approval semantics.

5. **m5 — D4 lines 314–317 and D5 lines 341–357:** define the CLI’s currently undefined “task tier,” and specify no-store/redaction/custody rules for caller-supplied model credentials.

6. **m6 — D9.3 lines 510–522:** implementation should inherit LLP 0070’s captured-grant/revalidation, webhook SSRF, idempotency, retry, and ambiguity contracts rather than treating durable work as sufficient by itself.

VERDICT: NOT READY