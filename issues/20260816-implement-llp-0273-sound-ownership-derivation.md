# Implement LLP 0273 sound ownership-disposition derivation into the module-ownership gate

**Status:** Open
**Filed:** 2026-08-16
**Area:** module-ownership gate (`scripts/check-module-ownership.mjs`), LLP 0273 (Decision, Accepted), amends LLP 0225

## Motivation

LLP 0273 (landed `c781282f1`, renumbered from the 0267 design) was accepted after a
six-round dual-family super-refine (grok-4.6 READY; codex gpt-5.6-sol conceded READY —
the residual is the conservation boundary the k≥1 machinery already lives on). It defines
a **sound, content-derived** disposition for ownership split/relocation: instead of
manual `time-bounded-waiver` bookkeeping, the gate derives **carry / genuine-removal /
block** for each obligation from own-item fingerprint multisets + the two snapshots'
resolved-edge sets — with **no move proof** (no cross-snapshot reference-site pairing).

The immediate payoff is **`local.rs` god-file drainage**: obligations auto-carry across
legitimate splits instead of accreting hand-maintained waivers.

## Scope (implement §7 against the §4 fixture matrix)

Implement the Decision's algorithm in `scripts/check-module-ownership.mjs`:

- **k≥1 conservation core:** per target T, the strongest `min(k,m)` predecessor
  obligations must appear verbatim on distinct current forbidden edges; shed exactly
  `max(0, m−k)` weakest; `#new = max(0, k−m)` computed (intersection members frozen).
- **k=0 discharge predicate (symmetric, universal, NO path-presence short-circuit):**
  - Target identity: `S = {M : own(M) ⊇ own(Ti)}`; `L = {current analysis.edges targets
    of host H that are NEW targets of H OR carry any predecessor-Ti item fingerprint}`;
    `|S|=1 ∧ L⊆S ⇒ carry onto T2`; `S=∅ ∧ L=∅ ⇒ genuine removal`; else BLOCK.
    `own(Ti)=∅ ⇒ S:=∅`.
  - Host identity (symmetric `SH`/`LH`, discharge-only): present host path scanned
    directly only when `own(path) ⊇ own(Gi)`; a husk (`own(path)⊉own(Gi)`) or absent
    path computes `SH`/`LH`; `|SH|=1 ∧ LH⊆SH ⇒ scan H2→T`; `SH=∅ ∧ LH=∅ ⇒ present scan
    is backstop`; else refuse discharge. Leftover-fail / `|SH|≠1` is a **discharge
    refusal, NOT a landing veto** (byte-scan promotion still runs; k≥1 never vetoed).
  - Evaluation order (per §3.6): `S`/`SH` first (own-items only) → resolve `H` → `L` →
    decide `T` → `LH`. Not a circularity.
  - Occurrence backstop over `analysis.edges` (allowed + same-owner edges included;
    only `to===from` dropped) — not byte-identity, not `violationReason`.
  - Byte-scan failure PROMOTES (defense-in-depth), never authorizes discharge.
  - Conservation boundary (normative, §3.6): k=0 discharge is reachable only when every
    surviving coupling to T is allowed/same-owner (a forbidden survivor ⇒ k≥1 ⇒ carry).
- **§3.7 structured amendment grant** `{scope, kind, direction, priorFields, newFields}`
  matched field-for-field against the predecessor git snapshot (`git cat-file`); pin
  `direction`, `grantId` uniqueness, git-bytes-≤-predecessor.
- **Intersection strengthen-only** (conservation may tighten a retained record without
  §3.7; weakening needs §3.7).
- **Fixtures:** the full §4 matrix — negatives N14–N20 (incl. N18b husk-at-target-path,
  N20 host-husk), positives P1–P8 (P4 admits via promotion, P6/P7 genuine removal).

## Hard requirements (landing gate)

1. **No regression of existing gate behavior.** Current pushes that pass must still pass.
2. **No invalidation of existing baselines** (`ownership.baseline.json` /
   `ownership.manifest.json`). Existing `time-bounded-waiver` records and the drainage
   waivers landed at `f0edaea8e` must remain valid, or be migrated in the same change.
3. **All §4 fixtures pass**; add them as gate tests.
4. **`--update-baseline` path** works with the new derivation.
5. Dual review (grok-4.6 + codex gpt-5.6-sol) before landing.
6. `scripts/check-module-ownership.mjs` is a HOT gate depended on by concurrent sessions
   and the drift backstop — land only when fully green; consider staging behind a flag if
   the change is large.

## Notes

- Grounding anchors (verified during review): `analyseSources`/edge emission ~594-628,
  self-edge drop ~621, `violationReason` ~724 (same-owner null except unassigned→god-file
  ~725-727), `forbiddenEdges` filter ~823, `baselineDocument` ~1005-1024,
  `enforceMonotonicBaseline` ~873/889.
- Disclosed residual (do not attempt to close): analyzer-invisible rewrites (opaque
  helper / proc-macro / leading-`::` / self-edge inline) — no content gate closes these
  without a whole-program resolver; per-target scoped.
