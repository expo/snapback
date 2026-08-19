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

## Update 2026-08-16 — first implementation attempt reviewed: DO NOT LAND

A full first implementation was produced (branch `impl-0273-ownership`, pushed,
NOT on main) and dual-reviewed (grok-4.6 + codex gpt-5.6-sol). Both verdicts:
**DO NOT LAND.** The pinned-`syn` AST helper approach + the 54-fixture scaffold are
a good starting point, but the k=0 predicate diverges from the spec and the fixtures
pass while real laundering trees still discharge. Fix-and-reverify before any landing.

**Correctness — the k=0 predicate is not faithful (must fix):**
1. **Ticket-only / forbidden inherited edges are excluded from conservation** (the
   backstop filters by `violationReason===null` and drops predecessor "inherited
   unadmitted" fingerprints from `currentEdges`). Live laundering: predecessor obligated
   `G→T` + ticket-only `U→T`; current removes `G→T`, keeps `U→T`; spec says `k=1`
   (carry onto `U→T`), code computes `k=0` and discharges. **The backstop must scan ALL
   `analysis.edges` to T, forbidden included** — not just allowed/same-owner.
2. **Content-match skip reintroduced** — an obligated PRESENT host path must always be
   scanned in `analysis.edges`; a content-match is not a skip (this is the exact husk
   seam the Decision closed at revision f).
3. **Unresolved host ⇒ leftover-fail the k=0 discharge.** Never take the `S=∅ ∧ L=∅`
   genuine-removal branch when `H` is empty because hosts were unresolved.
4. Implement the §3.10 extractor tightening (bare crate-relative `use`, in-body paths).
5. Do not use `lineage.predecessors.length ≥ 2` to consume the PredObl pool —
   conservation assigns, lineage only describes.

**Rust helper (must fix):**
6. **Fingerprint the original token stream** ⟨kind, byte-length, exact source bytes,
   jointness⟩ per Decision 6 — NOT `ToTokens` (a pretty-printer that COLLIDES
   `Foo::Bar` vs `Foo :: Bar`). **Fail closed on invalid spans** (currently silently
   dropped, which shrinks `own(M)` and pushes trees into genuine-removal).
7. **Content-addressed rebuild** — rebuild when helper source/manifest/lockfile change
   (`cargo build --locked` every run, or a digest receipt over
   source+manifest+lockfile+triple+compiler+exe). Currently only builds when the binary
   is ABSENT → a stale binary silently runs old fingerprinting.
8. Make the crate a **workspace member** (so CI's cargo cache applies); keep `Cargo.lock`
   committed. Narrow the offline→online build fallback to missing-registry-cache only,
   and wrap cargo-absent failures in the gate's stable diagnostic.

**Operational — the no-Cargo blocker (must resolve before default-on):**
9. The **self-hosted Expo CI runner has no Cargo**; the selection policy also marks
   `module-ownership` `rustToolchain:false` when only the helper `Cargo.toml`/`.lock`
   changed. Either provision + declare Rust for every environment that selects this gate
   and mark `module-ownership` as Rust-requiring, **or** stage the new 0273 derivation
   behind a **default-OFF flag** that selects new-derivation-vs-current-enforcement
   (NEVER a JS/`maskNonCode` fingerprint fallback — grok: that reopens the Decision-6
   literal/doc collisions). Default-off = zero blast radius on the live gate + no-Cargo
   runner until Rust is provisioned; promotion to default-on is a separate step.

**Fixtures to add (green today, must go red→green):** N14 without `Stable`, dual-husk
(A2/A3), bare `use target::…` (A7), two-host N16 carrying `D1`, combined N17+N20.

**Minors:** §3.2 persisted anti-stockpile cap not implemented (implement or amend the
Decision); `///` vs `#[doc="…"]` fingerprint differently.

**What passed (keep):** k≥1 conservation core matches spec (min(k,m) verbatim, shed
weakest, #new computed; clone-and-mutate/fan-out/two-push-D2-shed behave; P1–P8 incl.
P4 promotion); `own(Ti)=∅⇒S:=∅`; structured-grant path (predecessor-bytes-only,
grantId uniqueness, null before/after rejected, same-push refused, no Linear-SHA back
door); fingerprint construction otherwise sound + deterministic (no practical collision
beyond the jointness case); selection-policy + drift-fixture edits necessary; baseline
SHA-256 byte-unchanged; 54/54 fixtures + 12 legacy tests pass.
