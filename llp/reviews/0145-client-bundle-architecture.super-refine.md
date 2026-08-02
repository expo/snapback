# LLP 0145 super-refine journal

## Authorization

Charlie Cheever invoked `/llp-super-refine` on LLP 0143 on 2026-08-01. The
target was uncommitted in the working tree at v0.1, authored the same day by
Codex. Mid-loop, a concurrent fleet session renumbered the document to **LLP
0145** because main had independently assigned 0143 to the Expo
push-notification seam RFC; the number in this journal's title reflects the
final assignment.

The READY bar is the program's standing bar:

> "We've really thought this issue and concept through as much as we can
> without writing code and running it to gather empirical evidence" — as much
> as, not the same as, "there are no flaws in this."

The target is a **Research** document at Draft. It may leave questions open;
what it may not do is state as measured what was not measured, state as
as-built what the tree contradicts, present a hypothesis as a finding, or
recommend a program whose gates pass while the thing gated is broken.

## Runtime deviation, recorded

The skill pins orchestration to Claude Fable 5 Max. This loop was orchestrated
from **Claude Opus 5**. Each round used a fresh Claude Fable 5 reviewer and a
fresh OpenAI `gpt-5.6-sol` Codex CLI reviewer at `ultra` effort, neither of
which was the orchestrating/editing session, and the orchestrator belongs to
neither reviewer family — so reviewer independence is stronger, not weaker,
than the pinned configuration. Precedent: the LLP 0129 and 0140 journals.

## Mechanics

Per round: one fresh reviewer per family, mutually blind, both given the same
SHA-pinned revision and a SHA-pinned instruction capsule. Reviewers were barred
from `llp/reviews/` (except, from round 2, their own family's prior artifact)
and from any path containing `super-refine`. Reviewer sessions were never
resumed. Between rounds the orchestrator verified every decisive claim against
the tree before acting on it. Reviews are recorded verbatim; verification and
disposition notes sit outside the verbatim body.

**Author self-verification ran alongside round 1** and independently
reproduced the document's Snapback-side measurements before either review
landed.

## Round-by-round

| Round | Revision | Fable | Codex |
| --- | --- | --- | --- |
| 1 | v0.1 (842 lines) | NOT READY — 7 MATERIAL, 4 DETAIL | NOT READY — 4 BLOCKING, 7 MATERIAL, 1 DETAIL |
| 2 | v0.2 (1,282) | **READY** — 4 DETAIL | NOT READY — 4 BLOCKING, 4 MATERIAL |
| 3 | v0.4 (1,413) | NOT READY — 1 MATERIAL, 4 DETAIL | NOT READY — 5 BLOCKING, 3 MATERIAL |
| 4 | v0.6 (1,567) | NOT READY — 1 MATERIAL, 2 DETAIL | NOT READY — 5 BLOCKING, 5 MATERIAL |
| 5 | v0.8 (1,729) | NOT READY — 1 MATERIAL, 6 DETAIL | NOT READY — 2 BLOCKING, 6 MATERIAL |
| 6 | v1.0 (1,887) | **READY** — 8 DETAIL | NOT READY — 1 BLOCKING, 2 MATERIAL |

Roughly 90 findings applied across twelve reviews. **No applied finding was
refuted at any point.** Final revision: v1.1, 1,933 lines.

## What the measurements established

The document's evidential base survived unusually hard scrutiny. The Snapback
rows were reproduced **five separate times** — once by the orchestrator before
either round-1 review landed, and once per family in rounds 1, 2, 4, and 5 —
each time to within 0.1 kB: the headless closure (250.9 / 70.1 / 60.2 kB), the
`/online` identity, all four F3 counterfactuals, and both F4 search figures.
esbuild 0.28.1, the exact version named, is in the tree, and the method section
proved precise enough to re-run.

Two evidential defects were found and corrected. The Signal Desk **Supabase**
row (218.8 kB / 57.5 kB gzip) did not reproduce from the committed fixture,
which pins `@supabase/supabase-js` 2.57.4 and bundles to 127.5 / 34.9 —
measured against an unrecorded dependency upgrade. And the row's companion
Snapback figure was labelled `0.1.8` while the fixture uses a workspace `file:`
dependency, so its bytes cannot be tied to any published artifact. Both are now
labelled honestly, and the "explaining about 98% of the full-app delta" causal
claim was weakened to corroboration, since the arms differ in scaffolding and
dependencies as well as SDK.

## The defect pattern, and what it says about the instrument

Nearly every defect was a claim about **what the corpus had already decided**,
not about the measurements. The document had done good empirical work and had
not finished reading its own authorities. Examples: the hosted sender-constraint
mandate (LLP 0096 §7, ratified 2026-07-25) carried as an open question; the LLP
0095 conformance corpus never invoked; `terminalDelete` folded into a
blank-and-resnapshot path that LLP 0095 says has no snapshot; LLP 0059's
final-await authority fence absent; LLP 0115 decision 4's CLI-fold re-litigated
twice; and `packages/snapback-client/react-binding.mjs` — which imports no
React at all — described as the React binding, when `@expo/snapback-react`
already exists as a separate published package.

From round 3 onward the pattern changed, and both families named it
independently: **every MATERIAL was introduced by the revision under review,
not discovered in stable text.** The document grew 842 → 1,933 lines, and each
fix pass created new seams. The clearest instance: fixing Codex's round-4
carrier finding, the orchestrator conditioned `auth/live` on "auth-scoped" —
correct in LLP 0096 §7's deployment-floor context, inverted in §2.2's client
contract, which states that "clients cannot safely branch on it; always
offering is the conformant rule."

Round 5's Fable review stated the consequence directly:

> "Review has exhausted the stock of defects and is now working off the flow —
> it catches what each revision introduces, and nothing else, because there is
> nothing else left of the kind reading can find."

Codex reached the same conclusion in the same round, blind to it.

## Cross-family value

The two families found different things, and the loop's value came from the
divergence as much as the convergence.

**Codex found what Fable's READY had passed over.** Its round-2 findings
included the `/online` collision — the migration section proposed "introducing"
a subpath that already exists and exports full semantics — in text Fable had
just declared clean. That resolved round 2's split verdict against stopping.
Its round-5 BLOCKING found the **admission/invocation TOCTOU**: the mechanism
the orchestrator proposed in v0.6 and both families had accepted for two rounds
cannot enforce identity at the effect boundary, because admission is a separate
request and a deployment can change before the call. That is the loop's single
most valuable finding.

**Fable found what Codex's severity threshold understated,** and twice caught
orchestrator over-corrections. Its round-3 MATERIAL showed that applying
Codex's round-2 hosted finding had conflated the Cloudflare arm with LLP 0096
§7's actual referent — a defect a single-family loop would very likely have
shipped, because the family that prompted it had no reason to doubt it.

**Both, independently and blind, found:** the hosted-availability conflation,
the Convex provenance row, the "React bindings" residue, the two round-6
open-question echoes, the orphan table header, and the Revised ordering.

## The process defect, and how it was handled

Round 6 was announced as frozen. A concurrent fleet session then renumbered and
committed the document mid-review, so the pinned path vanished. Codex recorded
the charge plainly: "The content stayed frozen; the worktree did not. That is a
process defect." The charge is accepted.

The Fable reviewer's response is worth preserving as method: rather than
aborting or waving it through, it reconstructed the pinned revision
byte-exactly — reverse the title, delete the inserted renumber line, revert two
path strings — and proved the break was confined to path and number. The
orchestrator independently re-ran that reconstruction; it matches
`37592dcc…8b34fe`. Both round-6 reviews are therefore valid against LLP 0145.

## Disposition

**The loop did not converge on dual-READY.** Round 6 ended Fable READY / Codex
NOT READY, and the disagreement was about severity, not fact: both families
found the same two open-question echoes, Fable rating them DETAIL and Codex
MATERIAL. Codex's blocker was its own — gate 12a's *extension* list enumerated
four LLP 0077 lifecycle families and stopped, while 0077 also requires
reconnect, rotation, expiry, reset/restore, and authorization invalidation,
reproducing one layer down the defect the gate was written to remove.

**v1.1 applies every round-6 finding from both families, including that
blocker.** It has not been re-reviewed. Both families agree no further *broad*
review is warranted: Codex — "None requires implementation evidence to settle…
Another broad prose review should not be necessary"; Fable — "apply both
families' round-6 DETAILs in one pass, without re-review, and commission
Phase A."

**The document remains Draft.** The skill authorizes Draft → Review only on
dual-READY of the same revision, which no revision received. Advancing it is
the author's call, and there are three honest options: run one narrow
verification pass on v1.1 confined to the corrected passages; accept the
round-6 consensus and promote; or leave it Draft and commission Phase A, which
is where the remaining risk now lives.

## What the loop could not settle

Twenty-four open questions stand. Several are the author's, not the loop's:

- **OQ23 — a genuine spec/code drift the research surfaced and cannot fix.**
  LLP 0053 is Accepted and defines every non-`authorityIndependent` subscription
  as obligation-backed, carving out no mode; the shipped code gates obligation
  delivery to sessions mode. The local-dev row of the profile's byte floor
  depends on which is right.
- **OQ20** — which of three atomic mechanisms closes the identity TOCTOU. One
  is a wire change and therefore outside this document's scope to propose.
- **OQ22** — gate 11b is currently *unsatisfiable*: LLP 0064's seven-fact
  receipt is the `Online`-class bar and includes optimism and offline retention
  that this profile disclaims, and 0064 defines no browser receipt at all. A
  narrower capability class must be minted before any carrier claim.
- **OQ6, OQ14, and the Phase C posture** — thresholds, graduation ownership,
  and which auth posture the first spike declares. The byte hypothesis the
  document reports differs materially between postures.

The first-order question — whether a 10–25 kB gzip Online client is reachable —
was never answerable by review. That is Phase C's job, and the loop's honest
end state is that the document is now a sound enough basis to commission it.
