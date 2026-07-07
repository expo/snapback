# Review: LLPs 0039–0047 as a set — the gap-closure slices

**Reviewed:** `llp/0039…0047` (nine working-tree drafts, 2026-07-07), as a set,
against LLP 0038 (the system review they execute) and the corpus.
**Family:** Claude (Anthropic)
**Provider/runtime:** Anthropic API via Claude Code — model Fable 5
**Date:** 2026-07-07
**Redacted:** No — reviewed locally; nothing sent beyond the model serving this
session.
**Method:** Set-level pass by the same session that produced the nine
per-document reviews (`0039-…claude.md` through `0047-…claude.md`); this
artifact covers only cross-cutting findings. One family's review.

> **Independence (LLP 0005).** The nine drafts are Codex-authored (GPT-family);
> this review is cross-family. Caveat worth stating at set level: LLP 0038 —
> the review these drafts answer — is Claude-authored. Checking Codex's slices
> against Claude's critique is partially this family grading its own homework;
> everything below was therefore anchored to the governing LLPs and the code,
> with 0038 used only as the coverage checklist.

## Overall assessment

As a set, this is the right move executed with the right grain: nine narrow,
individually buildable slices, each explicitly subordinate to a governing
design doc, each with capability-honest non-goals, uniform headers, and the
root explainer's index updated in the same change. The set covers LLP 0038's
recommendations 1, 2, 4, 5, and 6 directly and gives previously owner-less
subsystems (assets, notifications, Postgres, hosted limits) real owners.

Three set-level defects, in descending order of importance:

1. **One 0038 recommendation has no owner — the one 0038 called cheapest.**
   Rec 3's local security/availability holes: 3(a), the action watchdog, turns
   out to have shipped already (`action_wall_clock_timeout: Enforced`,
   ENG-23324) — the set should not re-own it, and 0047 now cites it. But 3(b)
   — the unauthenticated connection-id namespace, public `/inspect` returning
   module source, the non-constant-time admin-token compare — appeared in no
   draft. The revision applied to 0039 now owns the connection-namespace part
   (sessions bind the live/outbox namespace); `/inspect` source exposure and
   the constant-time compare remain unowned and are small enough for a Linear
   issue rather than an RFC — but they should be *somewhere* before any demo
   binds beyond loopback.
2. **The set has dependency structure it never states.** 0042's mutation
   authority and 0045's real delivery gate on 0039's session core; 0043's
   auth posture consumes 0039's epochs; 0047 gates what 0040's target may
   claim; 0041 packages what 0042 serves over MCP. And there was one genuine
   circular deference: 0039 said auth codes would "later" use notifications
   while 0045 asked whether auth codes should use it "immediately" — each
   waiting for the other. The applied revisions resolve the circle (0045 now
   records the decision and owns the shared capture mailbox) and add the
   missing intra-set Related links (0039↔0042/0043/0045, 0040↔0047, 0041→0042,
   0044→0028/0039).
3. **Two drafts inherited a phantom subsystem.** 0044 and 0045 both leaned on
   a "background work" model that no LLP owns and no code implements. The
   applied revisions ground both in 0028's cron machinery for v1 and name the
   durable work queue as explicitly unowned future work — but the set-level
   fact stands: if reference apps need on-demand durable jobs beyond these two
   consumers, that subsystem needs its own LLP before a third RFC invents it
   implicitly.

Recurring per-document pattern worth naming once: **five of nine drafts
paraphrased their governing document where they should have cited it, and
drifted in the paraphrase** — 0042 renamed 0024's pinned tool table, 0043
re-enumerated DK-9 divergently and reversed 0008's replay executor, 0046
re-opened DK-2 and assumed a storage seam that doesn't exist, 0039 dropped
`roles` and `_auth_accounts` silently, 0040 pinned-and-reopened D1. None was
malicious drift; all are the failure mode LLP 0005's review loop exists to
catch, and the per-document artifacts record the details. A one-line authoring
rule would prevent most of it: *when a slice RFC restates a pinned contract,
quote and cite; never paraphrase from memory.*

## What the set does well

- Uniform anatomy (Summary → Motivation → Design → Non-goals → Acceptance →
  Open Questions) makes the nine documents skimmable as one program.
- Every draft correctly positions itself as selecting a path through its
  parent rather than replacing it — the corpus's subordination discipline
  held.
- Capability manifests and stable `SNAPBACK_*` diagnostics are used as the
  spine in all nine; no draft invented a parallel error or reporting dialect.
- Non-goals sections are genuinely load-bearing everywhere — each one turns
  down a real temptation (become Clerk, claim general Cloudflare support,
  CRDT merge, exactly-once delivery, engine-specific SQL).

## Set-level suggestions (beyond the applied revisions)

- **State the sequencing once.** 0038 ranks its recommendations; the nine
  slices are unranked. A short ordering note — 0040 and 0039 first (the two
  evidence-buying legs), 0041/0042 next (the public surface), 0043/0046
  after auth, 0044/0045 demand-driven, 0047 gating any hosted claim — belongs
  in the LLP 0000 follow-on ledger or a one-paragraph addition to 0038, not
  in each RFC.
- **File the leftover rec-3(b) items** (`/inspect` module source,
  constant-time admin compare) as Linear issues under the Exact project per
  repo convention, cross-referenced from 0038.
- When any of these drafts moves to `Review`, the loop should include a
  non-Claude family: the per-document reviews here all share this family's
  blind spots, and the parent critique is already Claude-flavored.

## Recommended next step

All nine: revise (applied) and stay `Draft`. The set is coherent enough to
enter `Review` together once the author ratifies the applied revisions; 0039
and 0040 deserve the most review investment (highest stakes, per LLP 0005's
scaling rule), 0047 the least (smallest delta from settled design).

## Correction (2026-07-07, later same session)

Set-level defect 1 overstated the remaining gap. On direct code verification,
**all** of LLP 0038 rec 3(b) had already been closed by hardening commits that
landed after 0038 was written: public `/inspect` handler source redacted
behind a typed `PublicInspect` projection (ENG-23441); the admin-token compare
is constant-time (`token_eq`, `src/admin.rs`); and the connection-id endpoints
require a server-minted `connectionToken` (`ConnectionAuth` in the route
taxonomy). No Linear issues were needed — the author approved filing them and
the filing was cancelled on verification, which is the correct outcome of the
check. The residual work is only 0039's principal-binding of the existing
connection guard, which 0039 now owns explicitly. The author ratified the
applied revisions the same day (recorded in each document's Revised header);
per-document reviews by a non-Claude family remain the recommended next step
before any status transition.
