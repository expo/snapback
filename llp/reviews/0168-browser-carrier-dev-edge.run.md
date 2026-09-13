# LLP 0168 + 0169 — super-refine run journal (cluster)

**Targets:** `llp/0168-browser-carrier-dev-edge.research.md` (primary),
`llp/0169-insecure-context-store-diagnostic.spec.md`
**Invoked:** 2026-08-04 by the author (Charlie Cheever)
**Orchestrator/reviser:** Claude Opus 5
**Round budget:** 3 · **Launch cap:** 6 per family per target

## Topology: lockstep cluster

0169 is the split-out decided half of 0168 and the two cross-reference each
other, so they are tightly coupled. Both reviewers see both documents in one
capsule and return **per-target verdicts** plus a set-level verdict. The
cluster review is preserved verbatim once, here in the primary target's
artifacts.

## Authorization and disclosure

- Document authority: the author invoked the loop on both targets directly.
- Outbound disclosure: the capsule carries both documents in full, the Warble
  evidence receipt, and excerpts of `rqs-store-default.mjs`, `src/admin.rs`,
  and LLP 0030. No credentials or secrets. Destinations: Anthropic, OpenAI.

## ⚠ Reviewer-independence asymmetry (material to how these verdicts read)

**The gpt-5 family authored both documents** in a prior session. Its review is
therefore **self-review, not independent review**, and is recorded as such. It
was launched with an explicit adversarial-self-review instruction ("your job is
to find what you got wrong, not to defend it"), but that mitigates the bias — it
does not remove it.

**Only the claude family is a genuinely blind reviewer of this revision.** Any
convergence claim in this loop is scoped accordingly: dual-READY here is
**not** equivalent to the dual-family convergence achieved on the predecessor
RFC, and must not be reported as if it were. A claude-family NOT READY carries
full weight; a gpt-5-family READY carries reduced weight.

This asymmetry was disclosed to the author before the rewrite was commissioned
and accepted as the cost of a fresh-author rewrite.

## Round 1

- **Entering revisions:** 0168 `dc5d70a10faecacfba9ca1b5f4f1067a24c1c5c2`,
  0169 `ec5ae2516a38a660bf32e29838949eb41481e17d`
- **Entering status:** both Draft
- **Capsule:** sha256 `a59f0999dbbd3954…` (739 lines)
- **Launched:** both families concurrently on identical capsule bytes; the
  gpt-5 prompt carries the additional self-review disclosure noted above.

### Verdicts

_(recorded on receipt; see the per-family artifacts)_

### Round 1 verdicts

| family | 0168 | 0169 | SET | counts | weight |
| --- | --- | --- | --- | --- | --- |
| claude (blind) | NOT READY | NOT READY | NOT READY | 5 MATERIAL, 5 DETAIL | full |
| gpt-5 (**self-review**) | NOT READY | NOT READY | NOT READY | 4 MATERIAL, 1 DETAIL | reduced |

**Convergence across the blind and self reviews on three findings**, which is
the strongest signal available given the asymmetry — and notably the
self-review conceded authoring error ("the prior authoring choice was
mistaken"), so the adversarial framing did work:

1. The LLP 0030 policy-sharing section was **normative design inside a Research
   document**, binding another owner's implementation.
2. The go/no-go gate was **internally unsatisfiable** — it demanded artifacts
   that require building the very thing it gates, while the next sentence
   forbade building it.
3. LLP 0169's `S3` development-warning predicate was **contradictory and inert
   under Vite** (`globalThis.process` defeats bundler `define` substitution).

Blind-family-only findings, both accepted:

4. **0168 contradicted itself on whether a raw receipt exists** — a defect
   introduced by the *orchestrator's* own pre-review edit, which added the
   receipt in one section and left "not the raw capture" in two others.
5. **A present-tense exposure was dispositioned into a hypothetical.** The
   direct-tunnel finding describes the server shipping today, not an unbuilt
   edge.

## Revision 1 (orchestrator)

- 0169 `S3`: build-mode gating removed entirely; reporting adopts the package's
  existing record → optional sink → un-gated `console.warn` shape, matching the
  §0B.6 downgrade precedent and LLP 0008 DK-9. Acceptance 9–10 rewritten to
  assert the Vite-browser realm specifically.
- 0168: receipt contradiction resolved in all three places; cookie corrected
  from "origin-scoped" to host-scoped with the cookie/IndexedDB boundary
  mismatch stated; the 0030 section demoted to a finding plus successor
  constraint with the amendment folded into gate B5; the gate split into
  **A (preconditions to open)** and **B (conditions before acceptance)** with a
  time-boxed fenced spike as the sanctioned way to produce B-evidence.
- The live tunnel exposure re-routed out of the deferred gate to
  `issues/shelved/20260804-tunnelled-loopback-server-keeps-dev-profile.md`, plus a
  present-day mitigation sentence on the tunnel rows (set `SNAPBACK_PROFILE`
  explicitly).

**Revised:** 0168 `5fc28d7892a980f43a84e8d0d17ee901784d6b05`, 0169 `50bb63027e7f54d6b5eb03f78392542264621852`

`./ref-check` passes: 170 LLP docs, 0 errors, 0 unchecked.

## Round 2 (delta)

- **Entering:** 0168 `5fc28d78…`, 0169 `50bb6302…` · **Capsule** `fcc9d965b613a149…`
- **Verdicts:** claude (blind) — 0168 NOT READY, **0169 READY**; gpt-5 (self) —
  both NOT READY. SET: NOT READY.
- **Delta convergence on pre-existing text: ACHIEVED — 0 PRE-EXISTING MATERIAL
  from either family.**
- Both converged: the "set `SNAPBACK_PROFILE` explicitly" mitigation the
  orchestrator added in revision 1 was **a no-op** (explicit `dev`/`demo`/`test`
  all permit provisioning; only `prod` fails closed) and would have granted
  false confidence.
- Revision 2 → 0168 `411c3288…`, 0169 `cc838a30…`

## Round 3 (delta, final)

- **Entering:** 0168 `411c3288…`, 0169 `cc838a30…` · **Capsule** `60860245f8197b72…`
- **Verdicts:** both families NOT READY on both targets.
- claude: 1 PRE-EXISTING MATERIAL (0169 S2 `secure-random-unavailable`
  precedence is not visible in the included ladder excerpt), 3 IN-DELTA
  MATERIAL. gpt-5: 0 PRE-EXISTING MATERIAL, 2 IN-DELTA MATERIAL.
- Both converged again on two contradictions **introduced by the orchestrator's
  revision 2**:
  1. The spike **reachability fence** permitted any "non-`dev`" profile — the
     exact laxity the mitigation paragraph two sections earlier condemns.
  2. 0169's `S3` lead sentence said "exactly once per realm" while the new sink
     contract specified per-client delivery and recording.

## Terminal state: round-budget exhaustion

Rounds: 3 of 3. Launches: 6 (3 per family). Both convergent round-3 defects were
self-inflicted by the loop's own revisions — the same pattern the predecessor
RFC showed.

### Final revision, applied after budget exhaustion and therefore UNREVIEWED

The two convergent in-delta contradictions above were unambiguous and
orchestrator-introduced, so they were fixed rather than left standing:

- 0168 fence now requires `SNAPBACK_PROFILE=prod` explicitly, defines
  "reachable off-loopback" to include a tunnel fronting a loopback bind, and
  states that an unprovable positive proof is a finding, not a licence to relax.
- 0169 `S3` now states three explicitly different budgets (console once per
  realm; sink once per client; recording never deduplicated) and defers to the
  sink contract as normative.

**Final revisions `057c9af330c27ca0e494337653ab59182253505e` (0168) and
`9b750663151957a2c4d7be770e4cf7098f38e865` (0169) have NOT been reviewed by
either family.** The last reviewed revisions are 0168 `411c3288…` / 0169
`cc838a30…`.

### Open at close

| target | concern | family | class |
| --- | --- | --- | --- |
| 0169 | `S2`/acceptance-8 `secure-random-unavailable` precedence is asserted but not visible in the cited source | claude | PRE-EXISTING MATERIAL |
| 0168 | The fence may make B1/B3 positive proofs unproducible under `prod` (partially addressed in the unreviewed revision) | claude | MATERIAL |
| 0168 | Distribution fence's "or behind a flag" weakens the claimed no-merge fence | gpt-5 | DETAIL |
| BOTH | Review history narrated inside normative text | claude | DETAIL |
| 0169 | Sink surface-shape parity and delivery timing vs. the wire-diagnostic precedent | claude | DETAIL |

## Recommendation

**Both stay `Draft`.** Neither reached READY from the blind family on the final
revision, and the final revision is unreviewed.

- **0169 is close.** It earned a blind READY at round 2 and regressed only on
  contradictions introduced afterward. One more delta round on 0169 alone —
  verifying the budget wording and resolving the `secure-random-unavailable`
  precedence question against the real source — would likely converge it. It is
  the shippable half and should be finished first.
- **0168 should not be refined further right now.** Six reviews across two
  documents have not produced a stable security model, and every round's
  MATERIAL findings are now about text the loop itself wrote. That is the
  signal to stop refining and answer the underlying question — gate item A1,
  whether any carrier demand justifies an edge at all — before spending more
  review budget on it.

This skill does not set `Accepted` and has not done so.
