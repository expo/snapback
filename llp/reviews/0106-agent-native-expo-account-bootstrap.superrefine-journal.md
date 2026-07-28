# /llp-super-refine — journal: LLP 0106 (Agent-native Expo account bootstrap)

**Loop:** `/llp-super-refine` on the single RFC LLP 0106.
**Families:** GPT (OpenAI Codex CLI 0.145.0 / GPT-5 `gpt-5.6-sol`, `--sandbox read-only`, cwd `/home/tuft/projects` so `universe` + `eas-hosting` were readable for grounding) and Fable (via isolated subagent, same repos readable). Orchestrator / reviser: Claude (never a review family). Author: Charlie Cheever.
**Date:** 2026-07-28. **Rounds run:** 4. **Status transition applied:** Draft → Review at loop start. **This loop never sets Accepted.**

## Status: ACCEPTED (Option A — round-4 items folded in, 2026-07-28)

Both families verified the RFC's core is sound and its Universe/standards grounding is accurate. Fable rated it **READY on revisions 2, 3, and 4**; GPT (a deliberately adversarial protocol/security reviewer) stayed **NOT READY on all four**, each round surfacing a *narrowing* set of {IN-DELTA} precision defects in the newly-revised text — a **sustained-asymmetry** terminal at which the orchestrator stopped (round-4 cap) rather than grind indefinitely.

The author chose **Option A**: a post-convergence touch-up (r5) folded in GPT's two round-4 material items and the wording details — no new design decisions — after which the author set **Accepted**. See the resolution note below. **Accepted-revision hash: `978cdf77`.**

## Revision lineage

| Revision | 0106 hash | Instruction |
|---|---|---|
| r1 (entry, Draft→Review) | `b142323c` | `ff0b8d30` |
| r2 (after round-1 revision) | `1ddc3b17` | `63283838` |
| r3 (after round-2 revision) | `eac83dce` | `2a3d8af6` |
| **r4 (after round-3 revision — current)** | **`30f072c9`** | `22e697b4` |

## Verdicts by round

| Round | Rev | GPT (Codex/GPT-5) | Fable |
|---|---|---|---|
| 1 | r1 | NOT READY — 4 MATERIAL | READY (6 detail) |
| 2 (delta) | r2 | NOT READY — 2 MATERIAL {IN-DELTA} | READY |
| 3 (delta) | r3 | NOT READY — 3 MATERIAL {IN-DELTA} | READY |
| 4 (delta) | r4 | NOT READY — 2 MATERIAL {IN-DELTA} | READY |

Both families' grounding was checked against the real `universe` code each round (DPoP validator `server/mcp/src/auth/dpop.ts`, `PreventSSOUserOAuthIdentityValidator`, OAuth dedup/SSO-conflict, `AccessTokenEntity`, `RobotEntity`, Stripe routes, `eas-hosting` deployment-api) — all of the RFC's "Universe already provides X" claims verified accurate, and the 0103/0104 amendments it names are real, honestly-framed amendment points, not misreadings.

## What the four rounds produced (headline hardening)

- **Bearer-claim ownership capability** with confirmation/notification/hold-reversal/recovery, and a **recovery-authority + evidence hierarchy** anchored on the bootstrap-request proof-of-possession holder — closing the stolen-claim-URL takeover *including the no-contact-hint anonymous case* (a URL thief lacks the agent-installation key).
- **Normative trusted-host account-linking rule** (never auto-link on asserted email; first-time link requires auth under the existing identity or approved enterprise policy; new identity only after collision-check + terms/recovery + liveness gate), plus a two-branch continuation contract (resolved `(issuer,subject)` completes in-agent; unresolved cases use an Expo-authored continuation) — grounded on the real SSO block.
- **Normative RFC 9449 proof/replay contract** (`(jkt,jti)` replay rejection, `iat`-window retention, `use_dpop_nonce`/`DPoP-Nonce` challenge, eviction bounds) — grounded on Universe's DPoP validator, which itself notes the `jti`-cache/nonce gap as required new work.
- **Orthogonal six-dimension state model** → immutable append-only claim-attempt + current-claim pointer, single `CLAIM_COMMITTING` cutover pinned to 0103/0104, and a **lifecycle fence** preventing expiry/cleanup from destroying a workspace mid-hold.
- Standards discipline (8628 UX-only, 9396/8693 as frameworks needing Expo authorization-detail types + subset checking, CIMD-draft SSRF policy) and coherence pins to 0103/0104/0089/0060, with required 0103/0104 amendments explicitly named.

## Remaining GPT round-4 concerns (reviser's disposition)

| # | Concern (r4) | GPT | Fable | Disposition |
|---|---|---|---|---|
| 1 | Lifecycle-fence "held until a bounded cutoff" never defines the transition *at* the cutoff (indefinite hold = resource-farming; destructive expiry = violates the fence) | MATERIAL | detail (Slice-0 parameter; RFC forbids silent erasure + pins resolve-toward-reversibility) | **Real edge, cheap.** Add a durable adjudication state + explicit cutoff transition (support-controlled tombstone/export + non-destructive quarantine) that atomically clears the dispute fence. Defensibly Slice-0-owned, but cheap to pin now. |
| 2 | Host-rendered continuation branch (b) claims non-observability, but an opaque token can't hide UI content/timing/results from the rendering host | MATERIAL | detail (conformance obligation; prefer branch (a) or require constant-shape artifacts) | **GPT is correct; cheap + worth doing.** Require an Expo-controlled isolated component/origin with a uniform-shape envelope for branch (b), OR restrict the strict non-enumeration guarantee to the Expo-hosted branch (a). |
| 3 | "Undersized hold window degrades usefulness, not safety" contradicts calling the floor a security parameter | detail | detail | Cheap wording fix: violating the floor weakens the reversal guarantee (absent-ack/active-contest still fail safe). |
| — | Fable details: effective idempotency key = (caller-key, generation); nonce-window ≤ `iat` window; floor-vs-gate-limb prose; branch-(b) shape-uniformity conformance | — | detail | Cheap clarifications; fold with #1–#3. |

**Summary:** the two GPT round-4 MATERIAL items are real, both families identified them, and both are cheap. #2 (host isolation for the non-enumeration guarantee) is a genuine security-correctness improvement worth having. None reflects a defective *core* decision — the design is agreed sound; these are the last precision edges.

## Recommendation (author decides — this loop does not set Accepted)

- **Option A (recommended):** one final targeted touch-up folding GPT r4 #1–#3 + the Fable details (a durable adjudication/cutoff transition; Expo-isolated component OR guarantee-restricted-to-branch-(a) for the trusted-host continuation; the wording fixes), then set Accepted. Small, additive, mirrors the 0103–0105 resolution.
- **Option B:** Accept now with GPT r4 #1–#2 recorded as Slice-0/implementation-phase obligations — Fable (a full independent family) rates the RFC READY across the last three revisions.
- **Option C:** keep iterating (further rounds will likely keep finding narrow precision edges in newly-added text).

## Resolution — Option A + ACCEPTED

The author chose **Option A**. A post-convergence touch-up (r5, `978cdf77`) folded in GPT's two round-4 material items and the wording details, all reviewer-identified, no new design decisions:
- **Lifecycle-fence cutoff:** a durable `CLAIM_DISPUTED`/`ADJUDICATING` adjudication state with an explicit bounded-cutoff transition to a **support-controlled `QUARANTINED`/tombstone terminal** (non-destructive, exportable, never silently erased while a dispute was live; quarantine-retention TTL before ordinary cleanup becomes eligible), atomically clearing the in-flight-dispute fence.
- **Trusted-host continuation:** branch (b) restricted to an **Expo-controlled isolated component/origin with a uniform observable envelope + generic signed terminal result**; the strict non-enumeration guarantee restricted to branch (a)/isolated-branch (b), never a plain host-rendered protocol; shape-uniformity made an explicit conformance requirement.
- **Details:** hold-window-floor wording corrected (violation weakens the reversal guarantee); effective idempotency key = `(caller-key, claim-attempt generation)`; DPoP nonce window ≤ `iat` window; floor-vs-gate-limb prose clarified (two mechanisms for two cases).

The author then set **LLP 0106 → Accepted** (header field and `## Status` footer reconciled). The r5 change is confined to the round-4 detail items; the dual-family review record binds to r4 (`30f072c9`) plus these non-blocking refinements.

Status: **Accepted** on the RFC. Committed and pushed to `main` (`ccheever/snapback`).
