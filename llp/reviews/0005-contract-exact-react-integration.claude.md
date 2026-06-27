# Review: LLP 0005 — Contract/Exact and React integration

**Reviewed:** `llp/0005-contract-exact-react-integration.explainer.md` (working-tree revision)
**Family:** Claude (Anthropic)
**Provider/runtime:** Anthropic API via Claude Code — model Opus 4.8 (1M context)
**Date:** 2026-06-25
**Redacted:** No — reviewed locally against the in-repo document; no document
content was sent to any external provider beyond the model serving this Claude
Code session.
**Method:** Single-session, independent read-and-critique of the full document
at its uncommitted working-tree state.

> **Independence (LLP 0005 process).** This session did **not** author the draft
> — it was drafted by Charlie Cheever / Codex (a GPT-family agent). A Claude
> review is therefore genuinely cross-family. This is **one** family's review of
> an Explainer at `Draft`; a second non-author family is optional and lower
> priority than supplying the one dependency this document is blocked on (the
> canonical Contract/Exact definition — C1).

## Overall assessment

This is a clear, well-structured Explainer that does the genuinely hard thing it
sets out to do: turn "Contract/Exact first; React/Expo a strong second" (LLP
0000) from a slogan into a *boundary* with design force. The keystone idea — a
**headless integration contract** beneath both, "usable without Contract/Exact
installed" — is the right one, and it is stated as a *falsifiable* test (can a
plain React/Expo project consume the same generated facts with no Contract/Exact
runtime?). The relationship rule ("richest paved path, but not a private backend"
/ "high-quality adapter, but not veto power") is crisp and internally consistent
across the document.

The most important thing to say is what this document is *not*, and the document
says it itself, honestly: **it does not define Contract/Exact.** That keeps the
corpus's single highest-priority gap (C1 from the LLP 0000 review) open — and,
because this is exactly the document a reader would open expecting the
definition, its absence is now more conspicuous, not less. This is honest
scoping, not a defect of the draft; but the corpus now needs to decide *where*
the definition lives so it is not permanently homeless. After that, my concerns
are about **ownership seams** with LLP 0003/0004 and a couple of **arbitration
rules** the boundary implies but doesn't state. I applied the two clarifications
I could make without inventing direction; the rest are flagged.

## Strengths

- **The headless contract is the right keystone, stated falsifiably**
  (*Headless integration contract*). "This contract should be usable without
  Contract/Exact installed. A plain React/Expo project, a local doctor command,
  or an agent validation tool should be able to inspect the same generated facts"
  — this is a testable invariant, not an aspiration, and it is the mechanism that
  actually protects React/Expo from second-class status.
- **The boundary has teeth and is consistent** (*Relationship model*,
  *Boundaries*, *React and Expo*). "Not a private backend" / "not veto power,"
  reinforced by "Where React conventions conflict with Snapback's core
  constraints, the core constraints win" and "Contract/Exact-specific affordances
  belong in the adapter... unless the capability is actually a general backend
  requirement." The principle is stated once and then honored everywhere.
- **Authorization/sync framed as non-negotiably backend** (*Design
  implications*). "If the client only hides unauthorized or unsynced data
  visually, the integration has failed" is exactly the lesson LLP 0001's
  synthesis draws (authorization belongs in the sync layer) and exactly what the
  card-game reference app (LLP 0000) demands. This sentence alone prevents a
  classic mistake.
- **Design Mode mappings are concrete and tie to reference apps** (*Contract/Exact
  integration*). "Add RSVPs to this event screen" → data model + mutations + live
  query + authorization + checkable subscription, and "Only the current player can
  see this hand" → authorization-aware sync rule, make the abstract legibility
  principle testable and connect it to Partiful and the card game.
- **Honest about its own limits** (*Summary*, *Deferred work*, *Open questions*).
  It states plainly that it does not define Contract/Exact, does not settle the
  headless contract's file shape, and depends on sync/auth models that do not yet
  exist. The provisionality is foregrounded, not buried.

## Concerns

Severity reflects impact on a reader/agent/adapter author trying to *act* on this
document.

- **C1 — The canonical Contract/Exact definition is still owed, and this document
  makes its absence more conspicuous without designating a home for it. [High]**
  The document correctly does not invent the definition (*Summary*: "does not
  define Contract/Exact from first principles"), and LLP 0000 now cross-links here
  while keeping its "Terminology gap" note — so both sides are honest and the
  navigation gap is closed. What remains is that the definition has *no owner*: it
  is perpetually "to be supplied by the ratifying source" with no document slated
  to hold it. This is the corpus's top unresolved dependency; an adapter author
  still cannot resolve the term the whole boundary is organized around. *Resolves
  when:* the ratifying source either (a) quotes a short ratified definition + a
  canonical link in this document (the doc's own first open question offers this),
  or (b) names the specific document that will own the definition, so it stops
  being homeless. I deliberately did **not** invent either — this is Charlie's
  call, exactly as in the 0000 review.

- **C2 — The "headless integration contract" overlaps LLP 0004's generated API
  and LLP 0003's server surfaces without a stated ownership seam. [Medium]**
  The artifact list (schema/function manifests, generated function references,
  typed bindings, capability reports, diagnostics, runtime-state channels) is
  almost exactly what LLP 0004 already defines as the generated app-facing API —
  and LLP 0004 was itself just revised to say "the generated API should also be
  the contract that automated agents inspect." A reader cannot tell whether
  0005's headless contract *is* 0004's generated API (re-framed as the
  cross-adapter substrate) or a *new* parallel artifact set. Left implicit, two
  LLPs appear to own "the generated facts adapters consume." *Resolves when:* the
  section states these artifacts are produced by LLP 0004 (API/manifests/bindings)
  and LLP 0003 (server capability/diagnostic/runtime-state surfaces), and that
  0005's contribution is the *requirement that every adapter consume the same
  ones* — not a new artifact set. (Applied as a clarifying paragraph.)

- **C3 — The boundary implies an arbitration rule it never states: when does a
  Contract/Exact need become a *core* feature vs. stay in the adapter? [Medium]**
  This is the operational heart of "Contract/Exact first." *Boundaries* says
  Contract/Exact-specific affordances stay in the adapter "unless the capability
  is actually a general backend requirement," but the test for *that* judgement is
  left implicit — and it is exactly where "Contract/Exact drives core design"
  (LLP 0000) and "not a private backend" (this doc) press against each other. An
  agent or contributor facing a Contract/Exact-motivated request has no rule for
  which side of the seam it lands on. *Resolves when:* the doc names a test —
  e.g. a Contract/Exact need is promoted to core only if (i) at least one other
  client/target would also need it, or (ii) it is required for the
  legibility/validation guarantees Snapback owns; otherwise it stays an adapter
  convenience. I flagged this rather than apply it — picking the test is a
  direction call, and it interacts with LLP 0000's "useful design test."

- **C4 — The two-adapter "first serious validation" sits awkwardly against the
  deferral of whether React ships before/with/after Contract/Exact, and against
  LLP 0004's single-adapter first validation. [Low-Medium]**
  *Validation path* requires "at least two client surfaces" for "the first serious
  validation," while *Deferred work* defers "whether React/Expo bindings ship
  before, with, or after the first Contract/Exact adapter," and LLP 0004's
  implementation sketch validates one adapter first. Read together, the first
  milestone both needs two adapters and hasn't decided the second adapter exists
  yet. *Resolves when:* the validation path clarifies that the two-adapter test
  validates the *integration boundary specifically* — a later, distinct milestone
  from the first single-adapter functional validation — and does not pre-commit
  adapter ordering. (Applied as a clarifying sentence.)

- **C5 — Capability reporting is required, but the degradation contract for an
  *absent* capability is unspecified. [Low-Medium]**
  *Design implications* makes capability reporting mandatory (local execution,
  offline sync, optimistic replay, auth impersonation, search, asset upload,
  subscriptions), but not what an adapter must *do* when a capability is absent —
  graceful degradation vs. hard failure. This connects to LLP 0000's "acceptable
  degradation behavior" (scale targets) and LLP 0004's "explicit capability gap"
  language. Reporting a gap is half a contract; reacting to one is the other half.
  *Resolves when:* the doc (or a follow-on it points to) states that adapters must
  surface, not silently swallow, an absent capability, and notes that the
  degradation policy per capability is owned downstream. (Folded into the C2 edit's
  cross-reference; the policy itself left open.)

- **C6 — Minor: "Contract/Exact" vs. "Exact Design Mode" vs. "Contract/Exact
  Design Mode" naming is slightly inconsistent, compounding C1. [Low]**
  *Relationship model* writes "Exact Design Mode" (line 58) while *Headless
  integration contract* writes "Contract/Exact Design Mode" (line 74); LLP 0000
  uses "Exact's Design Mode." With the term still undefined (C1), the reader can't
  tell whether "Contract" and "Exact" are one stack, two products, or a product
  and a mode. *Resolves when:* the eventual definition (C1) settles it; until
  then, a single consistent spelling for Design Mode would reduce the ambiguity at
  no cost. (Noted; not applied — it is downstream of C1.)

## Suggestions (non-blocking)

- When the C1 definition lands, add a one-line **Terms** note here (Contract,
  Exact, Design Mode, adapter) — this is the document where those names are used
  most densely, so it is the natural glossary host.
- Consider stating the **capability-absent contract** as a named principle beside
  "Sync and authorization cannot be frontend-only concerns" — both are
  "the client must not paper over a backend fact" rules and belong together.
- The **arbitration test (C3)** could reuse and extend LLP 0000's "useful design
  test" for Design Mode affordances, so the corpus has one coherent rule for
  "does this belong in the backend?" rather than two adjacent ones.

## Open questions (for the author / follow-on work)

- Where does the canonical Contract/Exact definition live — quoted here, or in a
  named future document? (C1; the doc's own first open question.)
- Is the headless integration contract identical to LLP 0004's generated API plus
  LLP 0003's server surfaces, or a distinct layer? (C2.)
- What is the test for promoting a Contract/Exact need into Snapback core vs.
  keeping it in the adapter? (C3.)
- What must an adapter do when a reported capability is absent? (C5.)
- Is the two-adapter validation the first milestone, or the integration-boundary
  milestone after single-adapter functional validation? (C4 — addressed in the
  applied edit, but worth confirming.)

## Recommended next step

*Proposed only — the author decides; this review changes no `**Status:**`.*

1. **Status stays `Draft`.** I did not change it. The doc's status note already
   gates revision on the canonical definition and the first generated adapter.
2. **Supply the Contract/Exact definition (C1).** This is the gating dependency,
   not just for 0005 but for the root's terminology gap; only Charlie can resolve
   it. Deciding *where* it lives (here vs. a named doc) unblocks the rest.
3. **Charlie reviews the two applied clarifications** (C2 ownership seam, C4
   validation sequencing) and ratifies or reverts; both are faithful, no new
   direction.
4. **Decide the arbitration rule (C3)** — the one genuinely new design question
   this boundary raises; a suggested test is offered above but not imposed.
5. **A second non-author family is optional** at Explainer/`Draft` altitude; on
   request I can prepare the standard review prompt, but per the honesty rules I
   will not run it against an external provider, or record a review that wasn't
   produced, without an explicit human action. (Session sub-agents are all
   Claude-family and would not satisfy the cross-family requirement.)

*Note: LLP 0000 already cross-links this document in `Related:` and its
"Terminology gap" note, so that navigation gap is closed; no 0000 edit was
needed this pass.*
