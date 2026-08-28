# LLP 0326 cluster — super-refine run journal

Loop: `llp-super-refine` (LLP 0010.001). Orchestrator/reviser: Claude Opus 5
(this session). Author: Charlie Cheever.

## Cluster and topology

Targets, reviewed **lockstep** (tightly coupled: parent/child, mutual
cross-reference, shared `Systems:`). Reviewers see both documents; the cluster
review is preserved verbatim once in this cluster's primary artifact
(`0326-*.<family>.md`) with per-target verdict sections.

| Slot | Document | Type | Status at loop start |
|---|---|---|---|
| A (primary) | `llp/0326-volatile-coordinates-in-committed-projections.rfc.md` | RFC | Draft → **Review** |
| B | `llp/0326.000-registry-coordinate-removal.plan.md` | Plan | Draft → **Review** |

`Draft → Review` is the one status transition this loop is authorized to apply.
The loop never sets `Accepted`.

## Authorization and disclosure

- Document authority (review + revision): the author, who invoked
  `/llp-super-refine` on these two targets in-session on 2026-08-28.
- External sends: the author is the repository owner and holds
  repository-disclosure authority. Outbound inventory disclosed before launch
  (below). No secrets, credentials, or `.agent-local-secrets.md` content is in
  the outbound set.

### Outbound inventory (round 1)

| Family | Runner | What leaves the machine |
|---|---|---|
| codex | `codex exec -m gpt-5.6-sol`, read-only sandbox, repo root | The review instruction, plus whatever files codex chooses to read from this repository under a read-only sandbox. Instructed to read the two targets and named source/test files, and explicitly barred from `llp/reviews/`. |
| grok | `grok -m grok-4.6`, headless, **terminal banned** | The review instruction plus the **complete verbatim text of both target documents**, inlined. No other repository content. |

## Blindness

Structurally blind for round 1: no `llp/reviews/0326*` artifact existed at
launch, so codex's repository read cannot reach either review. Grok has no file
access at all. No artifact is written until both families return. Codex is
additionally instructed not to read `llp/reviews/`.

## Round 1

- Launched: 2026-08-28
- Entering revision hashes (sha256, post-transition):
  - A `24d77757b35bddc38f7c0933936a069317e1031f45cab5522489621f2f204a3d`
  - B `e7667087dbaceb9765b076bb6e67ee411e08f29f6715badfdea509459558e735`
- Shared instruction core sha256: `7d2a5ae643e972d3…`
- codex instruction sha256: `557d124f00c72070…`
- grok instruction sha256: `60c453f3d3602084…`
- Reviewers: codex `gpt-5.6-sol` @ xhigh (read-only sandbox);
  `grok-4.6` @ xhigh (headless, full terminal ban)
- Lens: none (standard round)

Runtimes and verdicts appended on receipt.

### Round 1 results

| Family | Runtime | Verdict (A / B / cluster) | MATERIAL | DETAIL |
|---|---:|---|---:|---:|
| codex `gpt-5.6-sol` @ xhigh | 954s | NOT READY / NOT READY / NOT READY | 8 | 0 |
| `grok-4.6` @ xhigh | 319s | NOT READY / NOT READY / NOT READY | 4 | 9 |

Voided launches (recorded, not counted, per LLP 0010.001):

- grok launch 1 — `--max-turns 1` exhausted before a review was produced;
  the CLI had offloaded the oversized inline prompt to a file the terminal ban
  prevented it from reading. Relaunched with the packet in an isolated
  directory outside the repository (which also strengthens blindness: grok had
  no path to the repository at all).
- codex launch 1 — wedged reading stdin, produced no model output. Relaunched
  with stdin closed.

Launch count: 2 per family, against a cap of 6. Budget: round 1 of 3.

### Cross-family contradiction, resolved

The families directly contradicted each other on the §1.5 "contributor-only"
finding: grok affirmed it, codex called it false.

**Codex is right, and the orchestrator caused the contradiction.** The grok
packet asserted the contributor-only claim as background; grok had no
repository access and could not check it. Codex verified against the code and
found the raw registry is a published surface. This is not a genuine
cross-family disagreement requiring escalation under the contradiction rule —
it is one reviewer correctly refusing an unverifiable orchestrator assertion
and the other reasonably accepting it. Future rounds must not state contested
findings as background fact in the blind family's packet.

### Orchestrator verification of the round-1 findings

Every high-stakes codex finding was independently re-verified before revision.
All confirmed:

| Finding | Verified |
|---|---|
| C1 `buildIdentity.sourceDigest` hashes raw bytes of every input path, so removing coordinates does not stop restamps | **Confirmed** — `generate-diagnostics-registry.mjs:608–613` + `:730–747`; `sourceDigest` changed in **59 of 60** sampled registry commits |
| C2 the raw registry is a published surface | **Confirmed** — `guide-lib.mjs:1229–1240` declares `projections: {http, mcp, llms}` and a `servedPath`; `served_guide_v1.rs:368–379` asserts the server returns the exact bytes; `generate-docs-site.mjs:961` copies it into the published docs site |
| C3 two formatters dereference `line`/`column` | **Confirmed** — `guide_reference.rs:606–616` (a `filter_map` with `?`, so a missing `line` silently drops the row, yielding an empty "Emitting sites:" heading) and `reference-lookup.mjs:457,471` (would print `:undefined:undefined`) |
| C8 the `:321` comparator carries a `sitePriority` primary key feeding subsystem classification | **Confirmed** — not equivalent to `:704`/`:726` as LLP 0326 §5 claimed |

### Consequence: the ruling's stated benefit is falsified

LLP 0326's headline — 624 restamps per 30 days falling to ~156 — is **wrong**.
The orchestrator's 60-commit replay measured a *content projection it invented*,
not the artifact that would actually be committed. Because `sourceDigest` is
published in the file and changes on essentially every production-source edit,
the registry still restamps at roughly today's frequency under Option A alone.

Re-measured honestly (40 most recent registry diffs, `--unified=0`, counting
changed lines that are not `line`/`column`/`sourceDigest`):

| | Today | Option A alone |
|---|---:|---:|
| **Median** changed lines per registry diff | **734** | **8** |
| Mean changed lines per registry diff | 1,451 | 521 |
| Total over the 40-diff sample | 58,028 | 20,824 (−64.1%) |

So Option A's real benefit is **diff volume, not commit count**: the typical
registry commit stops being a 734-line content-free restamp and becomes an
8-line change. That is a strong result for review legibility and repository
size, but it is not the result the author ruled on.

### Loop status: STOPPED for author authorization

Round 1 surfaced feedback that changes the basis of the ruling, not merely the
prose. Per LLP 0010.001, fundamental feedback stops the loop for the author
rather than being absorbed by the reviser. Two questions are the author's:

1. **Re-base or re-open the ruling?** Option A still looks right as a
   mechanism, but its justification changes from "75% fewer restamps" to "the
   median diff falls from 734 lines to 8, at unchanged restamp frequency."
2. **New scope: does the fix extend to `buildIdentity.sourceDigest`?** Making
   the committed registry's identity a digest over its *semantic projection*
   would recover the restamp-frequency benefit, but it touches build identity,
   which is load-bearing beyond this artifact and is the same defect class as
   LLP 0194's 2026-08-28 amendment. That is a scope expansion the reviser must
   not make unilaterally.

Both targets remain `Review`. No revision has been applied; the round-1
revision hashes above are still the current bytes.

---

## Rounds 2 and 3, and the terminal

### Round 2 — delta round

| Family | Verdict (A / B) | MATERIAL in-delta | MATERIAL pre-existing |
|---|---|---:|---:|
| codex | NOT READY / NOT READY | 7 | **0** |
| grok | NOT READY / NOT READY | 3 | 2 |

Round 2's central finding was about the **orchestrator, not the documents**.
Several round-1 fixes reported as FOLDED had not landed: the revision script's
replacements were written against assumed line-wrapping, missed silently
because no assertion guarded them, and the punch list supplied to both
reviewers asserted they were folded. `half the problem` and
`keep working untouched` were both still present when the families were told
they were gone.

Codex additionally found the replacement metric was wrong the *same way* as the
round-1 metric: 734 → 8 filters `line`/`column`/`sourceDigest` out of **v1**
diffs rather than replaying a **v2** artifact that also deduplicates, adds
`count`, and reorders. Its own replay gave median 7 and ~17,800 total.

Every subsequent edit was guarded by an assertion and verified present on disk
by string search before round 3 launched.

### Round 3 — delta round (final budgeted round)

| Family | LLP 0326 | LLP 0326.000 | MATERIAL in-delta | MATERIAL pre-existing |
|---|---|---|---:|---:|
| codex | **READY** | NOT READY | 5 | **0** |
| grok | **READY** | NOT READY | 1 | **0** |

**LLP 0326 reached dual-family READY on revision 3**
(`027f600f…`). That target has converged.

**LLP 0326.000 did not**, but both families independently reported **zero
MATERIAL concerns in pre-existing text** — the delta-round convergence
condition for the document's settled body. Every remaining MATERIAL was in text
the round-3 revision itself had touched, and the two families' lists agreed
almost exactly: the §1.3 pin-count heading, residual "four tests" framing, the
OQ2 ruled-yet-awaiting-confirmation contradiction, the stale 6,781-byte figure,
and Stage 4 lacking the replay step §6 promised.

### Terminal: budget exhausted

Round budget (3) is spent. Per LLP 0010.001 that is a terminal escalation to
the author, with dispositions enumerated.

All round-3 MATERIAL findings were folded after the round closed, each guarded
by an assertion and verified on disk:

| Finding | Disposition |
|---|---|
| §1.3 heading claims three pins | Retitled: three appearances, two validating pins |
| "four tests" framing recurs | All four sites now defer to the §2a inventory |
| OQ2 ruled *and* "Author to confirm" | "Author to confirm" removed; marked closed |
| 6,781-byte record figure | Corrected to 6,255 raw / ~6,734 as a CLI payload |
| Stage 4 lacks the promised replay | Stage 4 now produces the real v2 diff-volume number and supersedes §6 |
| Formatter acceptance too weak | Now requires exact v2 output, not non-emptiness |
| A/B "measured" vs "estimate" drift | A relabelled consistently as an estimate throughout |
| A "kills line-drift restamps" | Restated as removing coordinate-driven bulk diff hunks |
| A "carries every emitting site" prose survives | Aligned with B Stage 3 |
| A "does not reduce the shipped binary" | Now notes the embedded input shrinks ~31% |

**The final revision (A `3d922ede…`, B `bfb943c7…`) is therefore labeled
UNREVIEWED.** The round-3 verdicts bind to A `027f600f…` / B `467388b6…`, not
to these bytes. LLP 0326's dual-READY was earned on `027f600f…`; the subsequent
edits to it were the four consistency relabellings above.

### Recommendation to the author

- **LLP 0326** — converged dual-READY. Proposed next step: **stay `Review`**,
  and accept once the author is satisfied with the four post-round edits. The
  loop does not set `Accepted`.
- **LLP 0326.000** — **stay `Review`**. Its settled body is clean across both
  families; the residue is one revision's worth of in-delta churn, now folded.
  One further delta round would confirm the fold, and is the natural use of an
  author-authorized extension round if wanted.
- **Do not implement from these documents yet.** The one thing three rounds
  could not settle is the headline metric: a trustworthy diff-volume number
  requires a v2 generator that does not exist. That is now honestly scoped —
  §6 is a declared bounded estimate and Stage 4 produces the real figure — but
  it means the plan's benefit claim is provisional until implementation begins.

### Loop honesty notes

- Two launches were voided and are recorded above; neither was counted.
- The round-1 cross-family contradiction was caused by the orchestrator
  asserting a contested finding as background fact in the blind family's
  packet. Round 2 and 3 packets carried no such assertions.
- Growth: A 340 → 447 lines (+31%), B 331 → 492 (+49%), both over the ~20%
  guidance. The overage is retraction and correction of false claims rather
  than new normative surface, and is recorded rather than waived.

## Post-loop author edits (2026-08-28)

Recorded for accuracy: LLP 0326 earned its dual-READY at `027f600f…`. Edits
made after the loop closed, none reviewed by either family:

1. The four consistency relabellings enumerated in the terminal above.
2. **OQ4 closed** — `packages/snapback-cli/reference-lookup.mjs`, one of the two
   coordinate-rendering formatters, is in `@expo/snapback-cli`'s published
   `files` array. A shipped package renders `file:line:column` to users, so this
   is a user-visible change in a published package.
3. **"What the coordinates are for" subsection added**, after the author asked
   what purpose they serve. New evidence: 46.2% of codes have neither a guide
   anchor nor an HTTP status, so for those the site list is the only actionable
   lookup content; site paths split 5,114 `crates/` to 5,090 `packages/`, so
   roughly half point somewhere a published user can actually open; codes are
   unique literal strings so grep recovers the line, except for the 11
   `synthetic` sites, which Option A's retained `synthetic` field still flags.
   A fourth option — coordinates for `packages/` sites only — was considered
   and declined.

The author **reaffirmed Option A** on that record.

This strengthens the RFC's justification rather than changing its decision, but
it is unreviewed text in a document whose READY verdict predates it. A single
confirming delta round would close that gap if the author wants the verdict to
bind to the current bytes (`8af04afa…`).
