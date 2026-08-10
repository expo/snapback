# Review: LLP 0223 — GPT family

## Round 1

**Provenance**
- Round: 1
- Date: 2026-08-10
- Target: `llp/0223-zero-config-connect-and-knowledge-closure.plan.md`, revision b, blob `fb714266c13d09b7532aa9333247a54daac85f05`
- Capsule: `round1-capsule`, sha256-16 `35d30046c8c91415`
- Reviewer runtime/mechanism: `codex exec --skip-git-repo-check -m gpt-5.6-sol -c model_reasoning_effort=xhigh --sandbox read-only`, capsule cwd; mutually blind to the Claude reviewer
- Verdict: NOT READY

**Review (verbatim, final message after the last "tokens used" line)**

Overall assessment: The chosen architecture is sound and the principal code anchors are accurate: Metro receives the rendezvous origin before spawn, the descriptor is written mode `0o600` and removed on close, the mint body matches `MintSessionRequest` and the CLI projection, the registry lists five sites with no anchor, case 25 exists, and the capability rows have the stated maturity. However, four proof obligations do not currently establish the contracts they claim, so the Plan is not ready as written.

1. **MATERIAL — Provider `ready` does not prove zero-config connection.** Ticket 1 treats a fresh scaffold reaching provider `ready` as proof that it connected, but LLP 0181 explicitly says `ready` does not assert live transport (`llp/0181-zero-configuration-expo.rfc.md:424`). Smallest fix: require one successful app-level backend round trip or an explicit live-connection fact after boot, alongside the existing no-`.env*`-change and descriptor cleanup assertions.

2. **MATERIAL — The durable-copy prohibition contradicts the retained offline design.** The Decision says every durable copy of a binding is a stale-lifecycle bug, while `guide/clients/react-expo.md:596` and `guide/capabilities.md:103` describe a deliberately persisted, non-secret binding cache that is expiry-checked and enables the persisted-receipt fallback. This could mislead implementation into removing a load-bearing feature. Smallest fix: reject only durable exported/ambient connection configuration and explicitly exempt the provider-owned admitted cache and receipt.

3. **MATERIAL — The per-context contract collapses back to per-site/per-code in Tickets 2 and 4.** The two registry sites in `auth_host_operation_input` are shared by `auth.mintSession`, rescue, retire, suspend, and resume; therefore a “per-site” registry note cannot distinguish emitting contexts. Likewise, `snapback guide SNAPBACK_AUTH_REQUEST_INVALID` contains no operation context and cannot by itself prove mint-specific routing. Smallest fix: grade this helper at least by `(code, operation)`, and make the invalid mint HTTP test assert `operation`, the expected argument contract, and resolution of the emitted relative anchor. A bare guide-code search can remain a supplemental discoverability check.

4. **MATERIAL — Ticket 3’s proof cannot test its behavioral requirements.** The proposed proof is only that the new case passes the guide check. `guide/retrieval-eval.md:445` explicitly says that check proves only lexical routing, not that a cold agent reaches the page, uses the paved technique, or avoids anti-patterns. Smallest fix: require both the static guide check and one retained cold-agent eval transcript satisfying the existing budget and rubric.

5. **MINOR — The ControlCatalog factual anchor is incomplete.** The capsule’s `schema_export` excerpt shows `inputSchema` on HTTP-route records and the control-catalog route’s output schema, not an operation-level `auth.mintSession` catalog entry. Smallest fix: cite the exact catalog generator/schema entry that establishes the existing field and missing mint value, or phrase this as adding catalog schema exposure without asserting the current representation.

6. **MINOR — The knowledge-gap chronology is internally inconsistent.** Lines 31–34 say the persisted-receipt gap now has documentation and case 25, while line 48 says both gaps lack retrieval keys. Smallest fix: state neutrally that the current capsule has closed the persisted-receipt content/regression case and that mint remains the concrete gap; avoid claiming the mechanism “demonstrably worked” without a retained eval result.

7. **MINOR — The Open Questions are conditional decisions, not open questions.** OQ1 fixes a re-open threshold and outcome; OQ2 fixes an escalation rule. Smallest fix: rename the section “Re-open and escalation triggers.” The conditional file fallback at lines 91–93 belongs there as a constraint on any future reconsideration.

AUTHOR-DECISION: None.

VERDICT: NOT READY

## Round 2

**Provenance**
- Round: 2
- Date: 2026-08-10
- Target: `llp/0223-zero-config-connect-and-knowledge-closure.plan.md`, revision c, blob `58858aecc63b6f5fdde0c907df4f08b0e3e92d2e`
- Capsule: `round2-capsule`, sha256-16 `a923788f92a78367`
- Reviewer runtime/mechanism: `codex exec --skip-git-repo-check -m gpt-5.6-sol -c model_reasoning_effort=xhigh --sandbox read-only`, capsule cwd; blind to round 1 and to the Claude reviewer; delta (b -> c) enumerated in instructions
- Verdict: NOT READY

**Review (verbatim, final message after the last "tokens used" line)**

The revision is substantially stronger: the chronology, live-round-trip requirement, cache exemption, per-context grading rationale, shared-parser facts, and catalog override mechanism align with the capsule. Tickets 2 and 3 now have clear proof obligations. It is not yet ready because Ticket 1 targets a scaffold that cannot reach the required provider state as currently defined, and Ticket 4 puts the canonical grade in the wrong artifact.

1. **MATERIAL — PRE-EXISTING.** Ticket 1 requires a fresh `expo-chat` scaffold to reach provider `ready`, but LLP 0186 says that scaffold deliberately omits Sessions auth and keeps the dev-auth profile ([LLP 0186](</private/tmp/claude-501/-Users-ccheever-projects-snapback/cf8b89ea-a653-41df-af84-db9d2afb2beb/scratchpad/loops/0223/round2-capsule/llp/0186-agent-authoring-efficiency-program.plan.md:832>)). LLP 0181 and the Expo guide state that the automatic mint requires settled Sessions mode and otherwise produces `authority-required`, not `ready` ([LLP 0181](</private/tmp/claude-501/-Users-ccheever-projects-snapback/cf8b89ea-a653-41df-af84-db9d2afb2beb/scratchpad/loops/0223/round2-capsule/llp/0181-zero-configuration-expo.rfc.md:467>), [React Expo guide](</private/tmp/claude-501/-Users-ccheever-projects-snapback/cf8b89ea-a653-41df-af84-db9d2afb2beb/scratchpad/loops/0223/round2-capsule/guide/clients/react-expo.md:323>)). Smallest fix: state that the generated acceptance fixture declares Sessions mode before launch, and stop implying the stock dev-auth `expo-chat` scaffold can reach `ready`.

2. **MATERIAL — IN-DELTA.** Ticket 4 requires the “graded-ledger entry in LLP 0193 itself,” but LLP 0193 explicitly defines the canonical checked-in ledger under `tests/acceptance/diagnostics/` ([LLP 0193](</private/tmp/claude-501/-Users-ccheever-projects-snapback/cf8b89ea-a653-41df-af84-db9d2afb2beb/scratchpad/loops/0223/round2-capsule/llp/0193-errors-as-docs-completeness.plan.md:80>)). This would direct implementation and proof to the wrong artifact. Smallest fix: require the dated clarification in LLP 0193 itself and the corresponding per-context entry in the canonical ledger under `tests/acceptance/diagnostics/`.

3. **MINOR — IN-DELTA.** The capsule verifies that the generator applies authored `inputSchema` overrides, that `config.set` carries one, and that `auth.mintSession` does not. The supplied two-entry excerpt does not independently establish the global claim that “exactly one” catalog entry carries `inputSchema`. Smallest fix: remove “exactly one” and retain the supported contrast with `config.set`.

PRE-EXISTING MATERIAL concerns exist: concern 1.

AUTHOR-DECISION: None.

VERDICT: NOT READY
