# Elevated handler reads have no audit surface: absent from the authorization review projection and from runtime observability

**Filed:** 2026-08-15 · **Source:** diff of LLP 0231 D7 / LLP 0234 against the
Clique 0.1.21 sweep authority-gap analysis; follow-up to
`issues/closed/20260815-owner-visibility-filters-handler-reads-membership-authority-gap.md`
· **Systems:** Security/authorization, Code generation, Generated artifacts,
Diagnostics

**Related:** LLP 0231 (D5, D7), LLP 0173 (authorization review projection),
LLP 0234 (distinguishes call-local elevation from governed overrides)

## Problem

LLP 0231 D7's `ctx.db.elevated` answers *when* a trusted named handler may
read rows another principal owns and *how* that authority is declared (a
visible call-site selection). The third leg of the original concern —
*how it is audited* — is only half-answered:

1. **No projection census.** LLP 0231 D5's principle is that "an auditor
   reads one page rather than N handlers," and its projection lists every
   table policy, refinement, override, and `fieldBoundary:` residual. Elevated
   read call sites appear nowhere on it, and LLP 0173's projection spec has no
   mention of them. An auditor asking "which functions in this app read across
   Class-R visibility, and against which tables?" is back to grepping N
   handlers — the exact posture D5 exists to end.
2. **No runtime observability.** Nothing counts, traces, or exposes elevated
   reads executing, so there is no way to notice an unexpected growth in
   elevated usage between revisions or to corroborate that a function's
   elevated reads match its reviewed intent.

The mitigating facts also make the fix cheap: `ctx.db.elevated` is a
host-recognized literal surface, not general opaque JavaScript, so a static
census is derivable (from the host/codegen inline-handler analysis or even
token-level scanning), unlike arbitrary JS reads which LLP 0170 rules opaque.

## Suggested fix

- Extend the LLP 0173 projection (and LLP 0231 D5's enumeration) with an
  `elevatedReadSites[]` section: one entry per named function that selects
  elevated authority, with the read shapes/tables where derivable and
  `handlerEvidence: opaque` where not. Never label an entry safe, per LLP
  0173's existing rule.
- Consider a runtime signal — a per-function elevated-read counter or trace
  event family — so operational review can see elevated usage, not only its
  static declaration.
- Keep the guide's mandatory negative identity test as the per-site evidence;
  this ticket is about the corpus-level review surface, not per-site proof.

Amend LLP 0231 D5 / LLP 0173 in the same change that implements the
projection entry, per the living-documents rule.

## Resolution (2026-08-15)

Closed by two independent landings:

- **Static census** — `fbf405bac` implemented the full LLP 0173
  authorization-review projection (now Status: Implemented). Each operation's
  `elevatedDatabase` fact reports whether call-local elevation is available
  plus every statically captured direct `ctx.db.elevated` member use, literal
  table where available, source span, and capture scope, with honest opacity
  for module computation the capture cannot prove. That satisfies this
  ticket's projection ask directly in the 0173 artifact rather than a
  side-car census file.
- **Runtime observability** — this landing. The trusted host seam records
  each successful non-empty elevated read as non-billable system telemetry
  named counts by function and by member (operation-class registry v3,
  LLP 0154 amendment), and the opt-in `SNAPBACK_ELEVATED_READ_TRACE` path
  appends fact-only JSONL events naming function, member, table, invocation
  mode, and correlation. No diagnostic code, no new endpoint, no verdict
  vocabulary. Runtime tests cover all four elevated members, the
  ordinary-read exclusion, the empty-batch exclusion, and the trace fields;
  LLP 0231 D5 records both halves.

A broader-reach static census (TypeScript-AST reachability through local
helpers and callbacks, plus an always-emitted dedicated census artifact) was
built and verified but deliberately not landed once `fbf405bac` shipped the
projection-integrated capture — one review surface beats two overlapping
ones. The implementation is preserved on the local `save-full-landing` branch
if the projection's direct-capture scope ever needs widening.
