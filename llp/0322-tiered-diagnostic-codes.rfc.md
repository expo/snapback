# LLP 0322: Tiered diagnostic codes

**Type:** RFC
**Status:** Withdrawn
**Systems:** Diagnostics, Guide, Developer experience, Agent experience,
Build, Inventories
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-27
**Revised:** 2026-08-27 (b — **Withdrawn** by the author after round 1 of
`llp-super-refine`; see Withdrawal below. Both families returned NOT READY
(codex 3 MATERIAL / grok 3 MATERIAL) and the defects are not revisable without
replacing the proposal.) 2026-08-27 (a — Draft → Review at llp-super-refine
loop start, the one authorized transition)
**Related:** LLP 0193, LLP 0010, LLP 0061, LLP 0259, LLP 0186, LLP 0198,
LLP 0314, LLP 0323

## Withdrawal (2026-08-27)

The diagnosis stands — 3,575 codes with 452 guide-anchored is a
lookup table, not a vocabulary — but every mechanism the RFC proposed is
defective.

`httpClassified` is derived from a reviewed Rust test table in
`crates/snapback-server/src/server/tests.rs`, not from wire
reachability, so "the rest never cross a wire boundary" and the 1,702
candidate population are false; codex named
`SNAPBACK_CONNECTION_SOCKET_REQUIRED` as a counterexample that crosses
the Cloudflare boundary as 409 with `httpStatus: null`.

The `{ code, detail }` shape collides with the existing
`{ code, severity, subsystem, message, details }` contract, and
production consumers branch on exact codes — the JS client retry set,
Swift's `StateMachine`, the app-CLI's frozen exit taxonomy, and
security-sensitive issuer tuples — so demotion breaks machine behavior,
not merely tests. `@expo/snapback-client` also publishes
`SnapbackDiagnosticCode` as a union of all 3,575 codes.

LLP 0193 mechanically refuses reclassifying an agent-triggerable code to
internal, so §3's "does not weaken LLP 0193" is wrong; the RFC is an
amendment and never says so. Finally §3's claimed drift-gate win does
not exist: `sourceDigest` hashes the complete bytes of every scanned
source, so line motion restamps the artifact regardless of whether
per-site records are dropped.

A cheaper successor was considered and rejected during disposition:
tier only the *documentation* using LLP 0193's agent-triggerable
predicate, demoting nothing. That predicate is not materialized — the
registry's per-code fields are `code, subsystem, sites, httpStatus,
httpStatusClass, guideAnchor, guideAnchors` — so applying it to 3,575
codes is the same expensive judgment work with none of it done.

This document is retained unrevised as the record of the proposal and
its refutation. The reviews are the durable artifact:
[codex](./reviews/0318-one-authoring-profile.codex.md) /
[grok](./reviews/0318-one-authoring-profile.grok.md) for the
authoring-surface cluster,
[codex](./reviews/0322-tiered-diagnostic-codes.codex.md) /
[grok](./reviews/0322-tiered-diagnostic-codes.grok.md) for the
size-and-hygiene cluster, with the run journal at
[`0318-one-authoring-profile.run.md`](./reviews/0318-one-authoring-profile.run.md).

Everything below is the original text as reviewed. Its claims were not
corrected; several are false and are enumerated above.

## Summary

`guide/reference/diagnostics-registry.json` records **3,575 distinct
`SNAPBACK_*` codes** across **9,597 emitting sites** in **631 source
files**. The registry is 2.5 MB; its rendered page,
`guide/reference/diagnostics.md`, is 755 KB.

Errors-as-docs (LLP 0193) is a good idea that worked. The failure mode
is that "every refusal gets a code" produced a code space with the
cardinality of the *implementation* rather than of the *contract*. 3,575
names is not a vocabulary an author learns; it is a lookup table — and a
lookup table has different requirements than a vocabulary.

This RFC proposes a two-tier model: a small **public** tier of stable
codes an application author can actually encounter and act on, and an
**internal** tier that carries implementation detail as a field under a
public code rather than as a code of its own.

Confidence is **0.75**. The model is clearly right; the partition is the
work, and it is judgment-heavy.

## 1. Evidence

From `guide/reference/diagnostics-registry.json` `counts`:

```json
{ "codes": 3575, "sourceFiles": 631, "emittingSites": 9597,
  "receivedSites": 378, "reservedSites": 11,
  "httpClassified": 1702, "guideAnchored": 452,
  "environmentVariables": 188, "environmentSites": 367 }
```

Two ratios are informative:

- **452 of 3,575 codes are guide-anchored** (12.6%). Seven in eight codes
  have no prose in the guide explaining them. That is either a large
  documentation debt or evidence that most codes were never meant to be
  read by an author — this RFC argues the latter.
- **1,702 of 3,575 are HTTP-classified** (47.6%). The rest never cross a
  wire boundary to a client at all.

Downstream costs:

- `guide/reference/diagnostics-registry.json` is 2.5 MB and
  `diagnostics.md` is 755 KB, both embedded in the shipped binary
  (LLP 0314 F4; see also
  [LLP 0314.001](./0314.001-derived-guide-bytes.rfc.md)).
- CLAUDE.md carries a standing warning that "the diagnostics registry
  records emitting *sites*, not just codes, so shifting line numbers
  invalidates `guide/reference/diagnostics-registry.json` even when no new
  `SNAPBACK_` code is introduced," and that "grepping the diff for new
  codes is **not** a sufficient check." A registry keyed on 9,597 sites
  makes every code motion a regeneration event.

## 2. Proposal

**Two tiers, one registry.**

**Public tier** — the codes an application author or agent can meet and
act on. Target size: 50–150. Properties:

1. Stable. A public code is API. It does not get renamed, and its
   meaning does not narrow.
2. Actionable. Each answers "what do I change?" Codes that only answer
   "what broke internally?" are not public.
3. Guide-anchored, all of them. The 12.6% anchor rate becomes 100% by
   construction, because the tier is defined as "the codes worth
   anchoring."
4. Resolvable by `snapback guide <CODE>`, unchanged.

**Internal tier** — everything else. Properties:

1. Carried as a `detail` field on a public code, not as a top-level code.
   The wire shape becomes roughly
   `{ code: "SNAPBACK_SCHEMA_INVALID", detail: "table-index-unknown-field", ... }`.
2. Free to churn. No stability promise, no guide anchor required, not in
   the published registry.
3. Still greppable in source, still unique, still useful in a bug report.

**The registry splits accordingly.** The published artifact carries the
public tier with prose. The internal tier keeps a build-time inventory
for uniqueness checking, but it does not ship and it does not need a
per-site record in the consumer-facing file.

## 3. What this does not do

- **It does not remove codes from source.** Every refusal keeps a unique
  identifier. The change is which identifiers are *promised* and which
  ship in the guide.
- **It does not weaken LLP 0193.** Errors-as-docs asked that failures be
  self-documenting. A public code with prose and a detail field is more
  self-documenting than one of 3,575 codes with an 87% chance of no
  prose.
- **It does not reduce emitting sites.** 9,597 sites is a property of a
  large program that refuses precisely. That is fine.
- **It does not remove the drift gate.** The public tier still needs
  regeneration discipline. But a 50–150 entry registry that keys on
  *codes* rather than *sites* stops churning on line-number motion, which
  is the specific pain CLAUDE.md documents.

## 4. Open questions

- **OQ1 — What is the partition rule, precisely?** "Actionable by an app
  author" is the intent, but the boundary needs to be mechanical enough to
  enforce in CI. Candidate: a code is public iff it can be returned across
  the HTTP/wire boundary *or* emitted by `snapback generate` against
  author-written input. That rule is checkable and roughly matches the
  1,702 HTTP-classified figure as an upper bound before further pruning.
- **OQ2 — Is 50–150 achievable, or is the real number 400?** The 1,702
  HTTP-classified codes are the population to prune from. If the honest
  public tier is 400+, the RFC still pays (an 88% reduction) but the
  "learnable vocabulary" framing weakens to "a manageable reference."
- **OQ3 — Migration compatibility.** Demoting a code from public to
  internal changes an observable string. LLP 0041's publication posture
  ("no current users depend on stability") makes this cheap now and
  expensive later — which argues for doing it before there are users, not
  after.
- **OQ4 — Do acceptance tests assert on internal codes?** Many probably
  do, since they are the precise signal. Those assertions move to
  `{ code, detail }` pairs. Mechanical but wide, and it is most of the
  migration cost.
- **OQ5 — What happens to the 188 environment variables and 367
  environment sites** tracked in the same registry? They are a different
  taxonomy sharing a file and may want their own artifact.

## 5. Cost

Moderate. The partition is judgment work over ~1,700 candidates
(mechanically narrowable first), the wire-shape change is small, and the
test migration is wide. The guide and the shipped registry both shrink
substantially, and the drift-gate churn CLAUDE.md warns about mostly
stops.

## 6. Why it matters

A code space is a contract surface, and Snapback currently promises 3,575
of them while documenting 452. Either the promise is too big or the
documentation is too small, and the cheaper correction is the first. The
agent-facing benefit is concrete: under the LLP 0259 read budget, a
refusal is supposed to be a *shortcut* — read the code, run
`snapback guide <CODE>`, get the rule. That shortcut works when the code
is one of a hundred documented contract violations. It degrades when the
code is one of 3,575 and has a seven-in-eight chance of no prose behind
it.
