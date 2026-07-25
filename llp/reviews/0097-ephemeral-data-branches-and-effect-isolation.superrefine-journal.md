# Super-Refine Journal — LLP 0097 (single target)

**Skill:** llp-super-refine (ccheever/llp@v0.3.0). **Orchestrator/reviser:** Claude (Fable 5), this session.
**Author authorization:** Charlie Cheever asked to draft 0097 and run super-refine, then push to snapback main on convergence (review + revision + finalize authority).
**Outbound inventory disclosed:** full bytes of `llp/0097-*.rfc.md` sent to (a) Anthropic API (fable reviewer + orchestrator) and (b) OpenAI (codex reviewer via ChatGPT-authed Codex CLI). No third parties.
**Topology:** single target (not a cluster).
**Families:** `fable` (Claude Fable 5, Agent tool) + `codex` (OpenAI, `codex exec`). True cross-vendor. (This repo's prior artifacts use `.claude`/`.gpt-5`; labels here reflect the actual reviewers run.)
**Blindness:** reviewers run concurrently (neither review exists when the other runs) + instructed not to read `llp/reviews/`. Self-attested + concurrent-structural.
**Bounds:** round budget 3; growth budget ~20% net/round.
**Transition at loop start:** Draft→Review (the one authorized transition). Skill never sets Accepted; on convergence the author's pre-authorization applies Accepted + push.

---

## Round 1
- **Entering revision hash (sha256, first 16):** 0097 = `0191fa9a32cb2d22`.
- **Reviewers:** fable, codex (fresh, mutually blind, concurrent).
- **Verdicts:** fable → **READY** (verified all citations; no blocking concerns). codex → **NOT READY** (4 material concerns — caught real defects fable missed).
- **Result:** split → NOT READY. codex's concerns judged genuinely material and addressed:
  1. **Atomicity overclaim** ("data + effects fire atomically / clean no-op") contradicted the settlement invariant the doc cites (0045/0066/0069/0070). → Rewrote promotion as a **staged transition**: data replay + promotion record + durable effect *intents* commit atomically, effects settle async under idempotency keys (`committedEffectsPending | settled | ambiguousExternalEffect`), never rolled back after initiation.
  2. **0036 as "the single interception chokepoint" overstated** (credential-free `fetch`, inbound webhooks, client-side SDKs bypass it). → Replaced with a **branch-egress-mediation prerequisite contract** (branch identity at every host egress op; refuse un-mediated paths; exclude client-side SDKs; bypass tests gate `CaptureOnly`).
  3. **0075/0090 miscited** as the base snapshot (they're query-result/checkpoint snapshots, not a writable full-DB image). → Defined a **materialized branch-base** primitive (full branch-visible image at a canonical head, retained independent of replay-floor/history clocks; v1 = fork current head); de-cited 0075/0090 as the base.
  4. **`_snapback_changes` is post-images, not an invocation/causal log** → blind replay + fire-effect can assert a success the provider never produced. → Promotion now replays a durable **operation/command log** (invocation identity, args, principal, read baseline, idempotency, **simulated-effect outcomes + causal order**); simulated-effect-dependent writes **revalidated, not asserted**; firm version-substream contract.
  Plus citation softening (0066 five classes = recommended input, not owned taxonomy; 0043 receipt characterization).
- **Growth:** +3 lines (2%).

## Round 2
- **Entering revision hash (sha256, first 16):** 0097 = `9ccf86488be51af3`.
- **Reviewers:** fable, codex (fresh, mutually blind).
- **Verdicts:** fable → **READY** (all 5 R1 fixes verified sound; 2 non-blocking attribution nits). codex → **NOT READY** (R1 confirmed resolved; 3 new deeper concerns).
- **Result:** split → NOT READY. codex's 3 concerns judged material and addressed:
  1. **Version-substream was "firm" yet its 0007/0018 compatibility "central open question"** (self-contradiction; even ephemeral branch subscriptions expose a 2nd stream to clients in one logical app). → **Decided it:** propose amending LLP 0007 + 0018 for typed **ephemeral child streams** (own cursor identity, replay floor, teardown); OQ1 now the ratification/conformance detail, not a yes/no.
  2. **Promotion couldn't coherently commit effect-outcome-dependent data** (can't atomically assert `order.status=paid` on a *simulated* charge while merely enqueuing the real one). → **Provisional/pending-state machine:** classify ops (effect-independent / intent-producing / outcome-dependent); outcome-dependent assertions commit **only as pending state** + durable intent + reconciliation id; fenced reconciliation mutation on settlement → succeeded|rejected|ambiguous; no declared pending+handler ⇒ **non-promotable**.
  3. **Host mediation can't prove client-side paths won't fire** (browser/native SDK, hosted checkout). → **Host-mediated vs end-to-end isolation-scope split:** baseline = `HostMediated`; `EndToEnd` is a distinct, stronger contract (client allowlisting + Design Mode suppression); capability axes made orthogonal; Acceptance no longer claims client containment.
  Plus editorial: 0083 bookmark-fork marked **unverified** (both reviewers' nit); inbound webhook reclassified as ingress (not egress); red-team qualified to cooperating code; Status → Review.
- **Growth:** +2 lines (1%).

## Round 3
- **Entering revision hash (sha256, first 16):** 0097 = `8bf8dcb03a964bf7`.
- **Reviewers:** fable, codex (fresh, mutually blind).
- **Verdicts:** fable → **READY** (all R2 fixes sound; one editorial nuance). codex → **NOT READY** (R2 confirmed resolved; 2 new material concerns).
- **Result:** split → NOT READY. codex's 2 concerns judged material and addressed:
  1. **Promotion commit model was self-inconsistent** ("ordinary serialized mutations" + "atomically commits" + "fresh canonical versions" don't compose — ordinary mutations each commit independently, can't roll back atomically). → **Pinned one model:** re-execute the op-log into a **promotion staging overlay**, then commit **one canonical transaction / one canonical version**; dropped "ordinary serialized mutations" and "fresh versions"; per-op versions would need a separate 0007/0008 atomic-batch amendment (out of scope).
  2. **No authority revalidation at promotion/effect-attempt** → a branch could preserve *revoked* authority (act while authorized, wait for grant to end, promote + fire). → Promotion **revalidates every replayed op against current principal/grant/policy/manifest** and refuses if authority ended (unless a valid `capturedGrant` per 0070); **each async effect attempt revalidates again**; operator substitution explicit + audited; added revocation fixtures to Acceptance.
- **Growth:** +1 line.
- **Budget note:** default budget (3) exhausted. Continuing to Round 4 under the author's standing instruction ("run super-refine, then push once it converges") — the same drive-to-convergence Charlie authorized for the 0389/0390 cluster (which converged at R4). If R4 still splits, escalate.

## Round 4 (author-authorized continuation to convergence)
- **Entering revision hash (sha256, first 16):** 0097 = `09318d9f72822a2c`.
- **Reviewers:** fable, codex (fresh, mutually blind).
- **Verdicts:** fable → **READY** (both R3 fixes sound; nothing regressed). codex → **NOT READY** (R3 resolved; 3 new material concerns).
- **Result:** split → NOT READY. codex's 3 concerns judged material and addressed:
  1. **0007/0018 amendment was "proposed"/"to ratify," not decided.** → Made the amendment **normative in §Design 1** (exact replacement language: one canonical stream + zero-or-more typed ephemeral child streams), accepted atomically with the LLP; only per-target conformance stays open. Related/Status/OQ1 updated.
  2. **"Re-execute cleanly" on an advanced base is undefined** → could succeed yet change what the future meant (prices moved → different charge). → **v1 requires exact base equality; refuse on any canonical advance** (re-fork from head); digest-comparison advanced-base promotion is a later enhancement. "Runs without error" is not "meaning preserved."
  3. **Effect-dependence not transitive** → a later op reading simulated `paid` could commit downstream consequences (fulfillment/loyalty) as truth. → Made dependence **transitive**: any downstream write/effect stays provisional under the same reconciliation id, carries its own continuation, or the branch is non-promotable; added a multi-command Acceptance fixture.
- **Growth:** +5 lines.
- **Budget note:** continuing to Round 5 under the author's standing "drive to convergence" instruction. If R5 still splits, escalate to the author (codex is holding a consistent spec-completeness bar each round resolving the prior and finding the next; fable + the skill's altitude rule read the residuals as implementation-phase).

## Round 5 (author-authorized continuation) — CONVERGED
- **Entering revision hash (sha256, first 16):** 0097 = `a04c8dd03aff6784`.
- **Reviewers:** fable, codex (fresh, mutually blind; codex ran first, fable ran on the identical revision after — no review shown to the other; blindness preserved).
- **Verdicts:** codex → **READY** (first codex READY; zero material concerns). fable → **READY** (no material concerns).
- **Result: CONVERGENCE.** Both families mark the **same revision** (`a04c8dd03aff6784`) READY.

## TERMINAL STATE — CONVERGED
- **Converged revision:** 0097 = `a04c8dd03aff6784`.
- **Rounds run:** 5 (3 default + 2 author-authorized continuation). Trajectory: R1 fabricated/miscited refs + atomicity overclaim; R2 effect-interception premise + base miscitation + replay model; R3 version-stream contradiction + false-paid gap + host-vs-client honesty; R4 commit model + authority revalidation; R5 normative 0007/0018 amendment + v1 base-equality + transitive effect-dependence → both READY. fable READY on all 5; codex NOT READY R1–R4 then READY R5 — a productive adversarial arc, each round resolving the prior and raising the next real issue.
- **Recommendation to author:** converged and ready. Skill never sets Accepted; author applies Accepted. Author's standing instruction was "push to snapback main once it converges"; holding for the author's read/notes (offered) before Accepted+push.
- **Superseded process file:** `.superrefine-0097-prompt.md` (scratch prompt) to be removed on finalize.
