# Super-Refine Review — fable family — LLP 0097

**Family:** fable (Claude Fable 5, via Agent tool). Independent, blind. Skill: llp-super-refine.
**Blindness:** run concurrently with the codex reviewer; instructed not to read `llp/reviews/`. Self-attested + concurrent-structural.

## Round 1
- **Revision hash reviewed (sha256, first 16):** 0097 = `0191fa9a32cb2d22`.
- **Verdict:** 0097 READY (no blocking concerns; verified every load-bearing citation; central version-stream question correctly held behind a claim boundary).
- **Verbatim review below.**

---

# Review: LLP 0097 — Ephemeral data branches and effect isolation

## 1. Summary

This is a strong, unusually disciplined RFC. It correctly identifies itself as LLP 0088's named revisit trigger, and — critically — it does not smuggle in the general branching capability 0088 deferred. It scopes itself to the *ephemeral* (throwaway-or-promote) case, inherits 0088's three hard constraints verbatim (no semantic merge in the sync core; two independent retention clocks; the per-app gap-free version stream / DK-2), and builds its two genuinely-new pieces (effect capture at the egress chokepoint; effect-replay-on-promotion) on cited substrate rather than inventing parallels. Its central safety hazard — double-charge / duplicate-send across N live futures — is named explicitly and answered with a fail-closed, default-deny capture posture routed through the one interception seam (0036), with real firing deferred to an atomic promotion step governed by the existing settlement invariant (0066/0070).

I verified every load-bearing citation against the corpus. The claims hold. The document is honest about its unresolved central risk (Open Question 1, the version-stream/portability resolution) and correctly gates its own claim boundary on it. I find no unresolved material concern that blocks READY. The concerns below are either self-acknowledged-and-appropriately-deferred or implementation-phase.

## 2. Material concerns

None rise to blocking. Closest candidate dispositioned:

C1 (dispositioned, not blocking) — Open Question 1 (branch-scoped version substream vs LLP 0007 DK-2) is load-bearing and unresolved, but the RFC correctly refuses to claim past it: the §Non-goals claim boundary + §Status forbid any target reporting a class above `Missing` until the acceptance corpus + OQ1 land. The RFC's hypothesis (substreams that never persist into the canonical gap-free stream except via promotion's serialized replay) is coherent with 0088 §4 and 0007's DK-2. Not blocking; the correctly-scoped open question, not a defective decision.

## 3. Dispositioned implementation-phase notes
Egress-chokepoint exhaustiveness (RFC OQ3); external-effect receipt ownership (RFC OQ6); resource bounds for N COW overlays (OQ5); base-state fork authorization (OQ4); Cloudflare/Postgres mappings (OQ2). All named as open with correct altitude.

## 4. Citation-accuracy check
Checked each load-bearing citation against source. No fabricated or mislabeled citations found: 0088 defer + trigger (verbatim), 0088 §4 no-sync-merge, 0088 §5 two clocks, 0008 journal/retention, 0007 DK-2, 0066 taxonomy + invariant, 0070 `CaptureOnly`, 0036 `uses`/egress, 0069 conformance provider, 0045 capture adapter, 0028 action/egress, 0043 receipts, 0055 attenuation-only, 0075/0090 snapshots (labeled as read-snapshot primitive), 0083 PITR, 0018 cooperating-not-adversarial, 0089 publication-vs-activation + teardown-unowned — all accurate in kind. (Note: I treated the 0075/0090 "consistent base version" as accurate-in-kind; the codex reviewer's Round-1 finding that neither supplies a full writable DB image is the sharper reading and was adopted in revision.)

## 5. Verdict

`0097: READY`

---

## Round 2
- **Revision hash reviewed (sha256, first 16):** 0097 = `9ccf86488be51af3`.
- **Verdict:** 0097 READY. All five R1-targeted fixes verified sound and internally consistent; only two non-blocking attribution imprecisions remain.
- **Verbatim review below.**

---

# Review of LLP 0097 (Round 2)

## 1. Summary
Read the target in full and verified against 0088/0008/0007/0018/0066/0070/0036/0069/0045/0028/0043/0055/0075/0090/0083/0089. The five focus areas the revision targeted are now sound and internally consistent: (a) staged promotion respects the settlement invariant (external effects can't be transactional — 0045/0066/0069/0070; "once an external effect is initiated, promotion is never rolled back"); (b) branch-egress mediation correctly reframed as a prerequisite contract, 0036 disclaims egress enforcement, bypass classes named, CaptureOnly gated on negative tests; (c) materialized branch-base coherent, 0075/0090 correctly de-cited (verified: 0075 Convex checkpoint protocol, 0090 resumable read snapshots — neither a writable full-DB image); (d) command/operation-log replay + simulated-effect-dependent-write revalidation soundly prevents fabricated provider successes; (e) firm version-substream contract matches 0007 DK-2 (distinct stream identity, gap-free, no cross-stream comparability). No unresolved material concern.

## 2. Material concerns
None.

## 3. Dispositioned implementation-phase notes
N1 journal-cannot-preserve-arbitrary-base argument really concerns the deferred prior-state fork (v1 = current head); N2 atomic materialized-base capture cost at scale (OQ5); N3 the two promotion models (re-execute vs state-diff) left as an honest sub-decision fork; N4 external-effect receipt ownership (OQ6).

## 4. Citation-accuracy check
0088/0007/0066/0070/0069/0045/0028/0043/0055/0018/0089 accurate. Two non-blocking imprecisions: (Flag 1) "bookmark-fork (LLP 0083)" — 0083 describes PITR + read-consistency bookmarks as separate mechanisms and is silent on forking a DO from a bookmark; the RFC frames it as a non-anchoring candidate deferred to OQ2, so weaker than the fixed 0075/0090 miscitation, but worth rewording so 0083 isn't credited with a fork capability. (Flag 2) the `retryable|terminal|ambiguousExternalEffect` triple is most precisely 0070's; citing "0066(F3)+0043" for taxonomy+invariant is defensible (0066 discusses the vocabulary + invariant, 0043 supplies ambiguity/receipt rules) — minor.

## 5. Verdict

`0097: READY`

---

## Round 3
- **Revision hash reviewed (sha256, first 16):** 0097 = `8bf8dcb03a964bf7`.
- **Verdict:** 0097 READY. All four R2-fix areas (version-stream amendment; provisional/pending promotion; host-mediated vs end-to-end; reclassifications) verified sound and consistent with the corpus; only a one-line editorial ("never fires real effects" summary compression, scoped by §Design 2 / Capability classes) noted as non-blocking.
- **Verbatim review:** confirmed proposing the 0007/0018 typed-child-stream amendment is coherent (0007 already models `(stream,version)` opaque cursors + multi-stream evolution "left open"); provisional-then-reconcile prevents false-paid without firing before the durable boundary; HostMediated/EndToEnd split retires the earlier overclaim; 0083-fork/inbound-webhook/agent-sandbox reclassifications accurate. Citations all accurate. `0097: READY`

---

## Round 4 (author-authorized continuation)
- **Revision hash reviewed (sha256, first 16):** 0097 = `09318d9f72822a2c`.
- **Verdict:** 0097 READY. Both R3 fixes (single-canonical-transaction promotion model; authority revalidated-not-preserved) verified sound and consistent with 0007's per-app version contract and 0055/0070; no earlier area regressed; no material concern.
- **Verbatim review:** single-transaction/one-version framing consistent across all 5 mention sites, no leftover "ordinary serialized mutations"/"fresh versions"; authority revalidation closes the preserve-revoked-authority hole per 0055 (validate against live durable authority at settlement) + 0070 (capturedGrant, fail-closed revalidatePrincipal); all citations accurate. `0097: READY`

---

## Round 5 (author-authorized continuation) — CONVERGED
- **Revision hash reviewed (sha256, first 16):** 0097 = `a04c8dd03aff6784`.
- **Verdict:** 0097 READY. No material concerns. All three R4 fixes verified sound + consistent; no regression. **Same revision as codex's READY → loop converged.**
- **Verbatim review:** (a) 0007/0018 typed-child-stream amendment is a strict additive extension reusing 0007's existing multi-`(stream,version)`-cursor machinery, canonical contract unchanged, exactly the change 0088 §3 predicted; making it normative-and-atomic is coherent, only per-target conformance (OQ1) remains. (b) v1 exact-base-equality (refuse on any advance) is the conservative safe choice, consistent with 0088 §4's no-sync-merge; refusing never asserts anything false. (c) transitive effect-dependence closes the downstream-consequence hole (same reconciliation identity / own continuation / non-promotable — exhaustive, fail-closed), grounded in 0070's fenced-lease/ambiguous machinery; multi-command fixture tests it. No-regression set intact (staged settlement; host-mediated vs end-to-end; materialized base; provisional promotion; authority revalidation; single-canonical-transaction commit). All citations accurate. `0097: READY`
