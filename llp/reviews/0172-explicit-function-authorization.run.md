# LLP 0172 + 0173 — super-refine run journal (two independent loops)

**Targets:** `llp/0172-explicit-function-authorization.rfc.md`,
`llp/0173-authorization-review-projection.rfc.md`
**Invoked:** 2026-08-04 by the author — refine the RFCs only, independently
**Orchestrator/reviser:** Claude Opus 5
**Round budget:** 3 per document · **Launch cap:** 6 per family per target

Covers both loops; 0173's per-family artifacts live under its own stem.

## Topology: two independent loops

The author's judgement, which the documents bear out: these are separate
proposals. 0172 makes an authorization *requirement* explicit at authoring time
(warn, then fail). 0173 emits a deterministic authorization *projection* for
review. Neither's correctness depends on the other's acceptance — 0173 consumes
0172's requirement provenance if it exists, but does not require it. Separate
capsules, separate reviews, separate verdicts, no set-level verdict.

The Research documents (0170, 0171, 0174) are deliberately **out of scope**:
they record findings and authorize nothing, so refine effort belongs on the two
documents that actually propose something.

## Authorization and disclosure

- Document authority: the author invoked the loop on the RFCs by name.
- Status transition applied **before** launch: both `Draft → Review`.
- Outbound disclosure: each capsule carries its target in full plus source
  excerpts (`packages/snapback-codegen/index.mjs`, `define.mjs`) and guide
  excerpts (`auth/sessions-and-principals`, `getting-started/generated-artifacts`).
  No credentials, no secrets. Destinations: Anthropic, OpenAI.

## ⚠ Reviewer-independence asymmetry

**The gpt-5 family authored both RFCs** (it split them out of the failed 0170/
0171 predecessors). Its review here is **self-review**, launched with an
explicit adversarial instruction; that mitigates but does not remove the bias.

**The claude family is the blind reviewer of these bytes.** One caveat kept on
the record: a claude-family session authored the *predecessor* RFCs from which
these were extracted, so claude is blind to this text but not naive about the
subject matter. It is still the stronger independence signal of the two, and a
claude NOT READY carries full weight while a gpt-5 READY carries reduced weight.

## Round 1

- **Entering revisions:** 0172 `63967ae6a759e9c9d51d03a8b7eef84d6db0252b`,
  0173 `2f42d48ccd68677ee9f6f20c3e8ed90a6744a8d4`
- **Entering status:** both Review (transition applied pre-launch)
- **Capsules:** 0172 sha256 `15b25f1650ff65f0…` (367 lines);
  0173 sha256 `62941238b95ef8be…` (356 lines)
- **Launched:** four reviews — two families × two targets, mutually blind.
- **Lens:** each family was additionally asked to verify the *narrowing* is
  honest — that the predecessor's two rejected mechanisms (`authScopeField` as
  an authorization witness; "unexplained widening" with no machine semantics)
  were not carried across under new names.

### Verdicts

_(recorded on receipt; see the per-family artifacts)_

### Round 1 verdicts — all four NOT READY

| target | family | verdict | MATERIAL | DETAIL |
| --- | --- | --- | --- | --- |
| 0172 | claude (blind) | NOT READY | 5 | 5 |
| 0172 | gpt-5 (self) | NOT READY | 3 | 2 |
| 0173 | claude (blind) | NOT READY | 6 | 5 |
| 0173 | gpt-5 (self) | NOT READY | 5 | 0 |

Mid-round integrity: both targets byte-unchanged; neither round void.

### ⚠ ORCHESTRATOR CAPSULE DEFECT — one convergent finding is an artifact, not a document defect

Both families' **first** MATERIAL concern on 0172 was that the "Verified current
behavior" premise is unsupported by the appended source. **That concern is
invalid, and the cause is mine.**

The 0172 capsule built its codegen context with
`grep -B4 -A12 authRequirement … | head -70`. That truncation cut off the actual
defaulting sites. Verified directly against the working tree:

```
packages/snapback-codegen/index.mjs:6003  authRequirement: def.auth ?? 'optional-user'
packages/snapback-codegen/index.mjs:6333  authRequirement: fn.authRequirement ?? 'optional-user'
packages/snapback-codegen/index.mjs:6358  authRequirement: fn.authRequirement ?? 'optional-user'
packages/snapback-codegen/index.mjs:4760  (cron-specific check)
src/manifest.rs:6209                      .unwrap_or(AuthRequirement::OptionalUser)
```

The RFC's sentence — "Generated identities, public function entries, and
validation diagnostics use `def.auth ?? 'optional-user'`" — is **accurate**.
Both reviewers reasoned correctly from an incomplete capsule and reached a false
conclusion, which is exactly the failure mode a capsule is supposed to prevent.

Disposition: concern 0172/claude-1 and 0172/gpt-5-1 are **withdrawn as capsule
artifacts**. They are preserved verbatim in the artifacts and are not counted
against the document. The round-2 capsule carries the real defaulting sites and
`src/manifest.rs`.

**What survives from that pair is narrower and real:** the default has **two
loci** — four codegen sites and the server's manifest loader — and the RFC
decides only the codegen one. That is claude's concern 2 and gpt-5's concern 2,
and it stands.

Recorded rather than quietly fixed, because a capsule that induces false
MATERIAL findings in both families is a defect in the loop, not in the document,
and the ledger should say which is which.

## PAUSED after round 1 — resume instructions

The loop is **paused, not terminated**. No revision was applied. Both targets
remain at `Review`, round 1 of 3 used, launches 2 of 6 per family per target.

**Verdicts bind to** 0172 `63967ae6a759e9c9d51d03a8b7eef84d6db0252b` and
0173 `2f42d48ccd68677ee9f6f20c3e8ed90a6744a8d4`. No later revision exists.

### Before launching round 2 — fix the capsule

The round-1 capsule for 0172 was defective (see the section above). A round-2
capsule MUST include, verbatim and untruncated:

- `packages/snapback-codegen/index.mjs` lines 5995-6010, 6325-6365 (the four
  `?? 'optional-user'` sites), and 4755-4765 (the cron-specific one);
- `src/manifest.rs` around line 6209 (`.unwrap_or(AuthRequirement::OptionalUser)`)
  — the **server-side** locus, absent from round 1 entirely;
- for 0173, the artifacts.json emission path and the consumer-committed custody
  policy, which round 1 covered only partially.

Do not build capsule context with truncated greps. That is what produced two
false MATERIAL findings.

### The open, legitimate agenda for round 2

**0172**
1. The default has **two loci** (four codegen sites + `src/manifest.rs:6209`);
   the RFC decides only codegen. Decide what happens at the server locus, or
   scope the RFC explicitly to codegen and say the runtime default persists.
2. `derived` requirement provenance is load-bearing but undefined — who may
   assert it, and how is it verified? Define or remove.
3. Scope: asset intents are neither included nor excluded.
4. Cron/job-only targets are compelled to declare a value none of the three
   correctly expresses (a cron target cannot be `authenticated`).

**0173**
1. **§4 reintroduces the rejected baseline under another name** — the blind
   family caught precisely the trap the round-1 lens asked about. This is the
   most serious item; cut §4 or give it real machine semantics.
2. The `authorizationPredicates` classifier is undefined, and omission is
   indistinguishable from absence.
3. Mandatory vs opt-in custody is undecided, so Acceptance 7 guarantees nothing.
4. Several acceptance items are vacuous as written (read/write summaries carry
   no provenance field; the content boundary is normative but untested).

### Artifacts on disk

| path | contents |
| --- | --- |
| `llp/reviews/0172-explicit-function-authorization.{claude,gpt-5}.md` | round-1 reviews, verbatim |
| `llp/reviews/0173-authorization-review-projection.{claude,gpt-5}.md` | round-1 reviews, verbatim |
| `llp/reviews/0172-explicit-function-authorization.run.md` | this journal (covers both loops) |
| `llp/reviews/0173-authorization-review-projection.run.md` | pointer to this journal |

Predecessor context: the failed 0170/0171 RFCs are backed up in the session
scratchpad; their review artifacts and terminal-stop ledger are at
`llp/reviews/0170-derived-authorization-obligations.*`.
