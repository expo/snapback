# LLP 0162 scoped re-read + LLP 0163-0165 extraction review — Codex family

## Combined light round — 2026-08-03 (targets: 0162 v0.9 SHA-256 54e2e686…, 0163 96e1b62b…, 0164 a2d1afe2…, 0165 af90ffdf…; tree at f0c2fd53)

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, codex exec, model gpt-5.6-sol, model_reasoning_effort=xhigh, sandbox read-only
**Date:** 2026-08-03
**Redacted:** no
**Method:** single light cross-family round after LLP 0162's acceptance (same capsule as the companion fable artifact); barred from llp/reviews/ and from re-litigating the converged architecture; recorded verbatim below.

---

## 1. Overall assessment

All four SHA-256 values and commit `f0c2fd53` matched. The scoped v0.8 architecture remains sound and consistent with LLP 0043, 0097, 0133, 0158, and 0081, but the extraction introduced several bounded contract defects: an epoch-closure weakening, two reopened decisions, stale ownership metadata, and amendment-level ownership/conformance conflicts. None requires re-litigating the converged architecture.

## 2. Verdict — DEFECTS FOUND

- **0162-delta:** DEFECTS FOUND — the substantive contracts are sound, but §8’s component table contradicts the accepted/extracted ownership state.
- **0163:** DEFECTS FOUND — its epoch-closure summary weakens 0162, and an Open item improperly reopens `result-expired`.
- **0164:** CLEAN — it faithfully carries the scoped fork, promotion, identity, re-seal, and conditional-fairness contracts.
- **0165:** DEFECTS FOUND — its normative summary is faithful, but an Open item reopens the decided two-part write-authority choke point.
- **Amendments:** DEFECTS FOUND — the 0012/0095 amendments are accurate, but 0097’s `DenyAll` fixture substitution and 0133/0043’s overlapping ownership claims need reconciliation.

## 3. Findings

1. **MATERIAL — 0163 — the extracted epoch-closure predicate permits an over-broad expiry arm.** Evidence: `llp/0163-operation-identity-and-commit-envelope.spec.md:42-44` says every ranged identity may be “acknowledged, range-window-expired … or purged” and requires issuer termination only; `llp/0162-agent-safe-storage-profile.rfc.md:321-336` restricts expiry to **never-admitted** identities, allows issuer termination **or revocation**, and requires every admitted identity to be acknowledged, while `llp/0043-offline-replay-retention.rfc.md:255-259` forbids eviction of an unacknowledged result. Resolution: restate the exact predicate as issuer terminated or revoked, with each ranged identity either admitted-and-acknowledged, never-admitted and window-expired as outcome-unknown, or operator-purged.

2. **MATERIAL — 0163 — Open item 3 reopens an accepted semantic distinction.** Evidence: `llp/0163-operation-identity-and-commit-envelope.spec.md:45-52` normatively carries distinct `result-expired` and `identity-horizon-passed` outcomes, but `llp/0163-operation-identity-and-commit-envelope.spec.md:90-91` asks whether they should collapse; LLP 0162 fixes their precedence and meanings at `llp/0162-agent-safe-storage-profile.rfc.md:346-358`, and the client amendments depend on that distinction at `llp/0012-headless-integration-contract.spec.md:1268-1270`. Resolution: remove the Open item; changing this decision requires a dated reconciliation of 0162, 0163, and the owning amendments.

3. **MATERIAL — 0165 — Open item 3 reopens the decided write-authority mechanism.** Evidence: `llp/0162-agent-safe-storage-profile.rfc.md:542-552` and `llp/0165-proof-domains-and-checkpoints.spec.md:37-42` require both a generated transaction API with an unforgeable writer token **and** a SQLite authorizer, while `llp/0165-proof-domains-and-checkpoints.spec.md:80-81` presents “generated facade vs authorizer-only” as undecided. Resolution: remove that alternative or narrow the Open item to implementation details that retain both required controls.

4. **MATERIAL — 0162-delta — §8’s component ownership table was not reconciled after acceptance and extraction.** Evidence: `llp/0162-agent-safe-storage-profile.rfc.md:896-902` still assigns envelope, diff, and explanation to “this RFC” with status `Draft`, despite the RFC being Accepted and `llp/0162-agent-safe-storage-profile.rfc.md:903-906` assigning committed contracts to LLP 0163-0165; that paragraph also interrupts the Markdown table before the remaining rows at `llp/0162-agent-safe-storage-profile.rfc.md:907-912`. Resolution: rebuild one valid table, split envelope/explanation from diff where necessary, identify the extracted Specs as contract/schema owners, and distinguish their Draft status from the umbrella RFC’s Accepted status.

5. **MATERIAL — amendments — LLP 0097’s literal `DenyAll` acceptance substitution leaves incompatible capture requirements standing.** Evidence: the original corpus requires blocked paths to be “blocked-and-captured” and effects to “capture, not fire” at `llp/0097-ephemeral-data-branches-and-effect-isolation.rfc.md:114-121`; the amendment replaces only “effect-settlement fixtures” and says all other rows stand at `llp/0097-ephemeral-data-branches-and-effect-isolation.rfc.md:158-161`, while `DenyAll` deliberately records only a payload-free attempt marker at `llp/0164-fork-and-promotion.spec.md:33-37`. Resolution: explicitly make the capture-specific clauses conditional on `CaptureOnly`, and substitute marker/refusal/bypass fixtures for every incompatible clause under `Promotable(noEffects)`.

6. **MATERIAL — amendments — disposition and parameter ownership is assigned to multiple documents.** Evidence: LLP 0163 claims the disposition vocabulary and generated projections at `llp/0163-operation-identity-and-commit-envelope.spec.md:64-75`; LLP 0133 adds the same dispositions to its own vocabulary and says range/retention parameters are fixed there at `llp/0133-local-settlement.spec.md:839-849`; LLP 0043 separately says range size/window are owned there at `llp/0043-offline-replay-retention.rfc.md:559-565`; LLP 0162 instead names the 0043/0012/0095 amendments at `llp/0162-agent-safe-storage-profile.rfc.md:316-320`. Resolution: publish one ownership split—0163 for generated schemas and disposition spellings, 0133 for collision/identity semantics, 0043 for ACK/retention parameters, and 0012/0095 for client behavior—and replace competing “owned here” claims with references.

## 4. Suggestions (non-blocking)

- In LLP 0165’s eventual checkpoint-specific state machine, name a staged-verified state whose proof receipt is durable before rename.
- Make Acceptance row 12 explicitly say “the full adapted LLP 0158 intra-state crash-cut matrix,” including rename-versus-directory-fsync and sentinel-unlink cuts.
- In LLP 0164’s summary, repeat that the admission-ticket identity is server-minted and governed by the host-originator epoch protocol.

## 5. Recommended next step

Apply only the scoped documentary repairs above, keep LLP 0163-0165 in Draft, record this as the provenance-tracked scoped review, and perform one changed-lines re-read before advancing the Specs; no new full architectural review round is warranted.
