# Grok review — LLP 0269

**Reviewer family:** Grok
**Provider / runtime:** Grok 4.6 in Grok Build (interactive session)
**Date:** 2026-08-16
**Redacted:** no
**Method:** independent adversarial design review of the cwd worktree.
This session did not author LLP 0269 (document Author: Claude Fable 5,
orchestrated). Not a capsule review.

- **Target under review:**
  `llp/0269-capability-maturity-range-derivation.spec.md`, 34,006 bytes,
  SHA-256
  `5d21679c24de5e274a752ea27834dc3d5ac99a5d0fd3af6c4b5a1b50871aca9a`.
  Status: Draft. Hash and byte count verified on disk before the verdict.
- **Governing law read in full or in the cited sections:**
  LLP 0134 §4 (promotion act, receipt schema, exact-pin prose, staged-tree
  rule) and A5; LLP 0134 2026-08-16 deferral header; LLP 0189 D-4 and the
  D-4 custody paragraph; LLP 0130 ER-2; the triggering issue
  `issues/20260816-llp0134-d4-range-relaxation-needs-sound-derivation.md`.
- **Code checked (cited validator and profile surfaces):**
  `scripts/capability-maturity.mjs` (`validateClaimScope` ~279–304,
  `supportingTargetProfiles` ~319–345, pin equalities ~649 / ~719 / ~799,
  sole-parent introduction check ~747–760, `validateTransitionRange`
  ~1027–1119 including the `candidateSourceSha === parent` bind at 1053–1056,
  `TARGET_PROFILE_DEFINITIONS` import at 11–15); 
  `packages/snapback-codegen/target-profiles.mjs`;
  in-tree fixture `CLAIM_SCOPE` in `tests/capability-maturity.test.mjs`
  (`roots: ['src']`); `src/manifest.rs` `TargetCapabilityId` / `maturity()`;
  `src/local.rs` (~33,716 lines) and `src/bounded_children_cursor.rs`
  (~330 lines) as a concrete runtime-split for `bounded_children_v1`.
- **Blindness disclosure:** no `llp/reviews/0269-*` artifact existed at
  review start; none was read.

---

# Review — LLP 0269: Sound D-4 range relaxation (adversarial design)

## 1. Overall assessment

The Spec correctly names the four-cycle disease: in every prior defeat the
property that decided whether a range was clean was **read from a receipt**.
FORK B's refusal to introduce a "classified claim-relevant change" predicate
is the right instinct. FORK C as a permanent, tested exact-pin fallback is
the right availability valve. Contribution 4's *intent* (the derivation
code must sit inside every surface) is the right response to cycle 2.

It then rebuilds the same disease out of different materials.

The design bar is not "the receipt's `claimScope` field is not a JavaScript
argument to `deriveD4Surface`." The bar is: **a promoting act must never
choose its own first-promotion minimum; derivation authority must be
independently code-derived at the promoting commit.** This Spec satisfies
the lawyerly field-exclusion and fails the bar. It relocates the
self-declared minimum from `receipt.claimScope` into an author-curated
`CAPABILITY_D4_SURFACE` path list, interpreted by whatever
`deriveD4Surface` is **running at H / HEAD** — a commit the range
explicitly does not compare. That is cycle 5. Four previous designs were
defeated for less polite versions of the same move.

The document even writes the load-bearing observation and then uses it
backwards. §3.2 contribution 5: the promotion commit `H` "flips both
registries, but that flip is **outside** the range (§4 — the range ends at
`candidateParentSha` … and never includes `H`)." They used "H is outside
the window" to **drop** `src/manifest.rs` from the blanket surface
(availability). They did not use it to **pin** the running interpreter to
`P`. Cycle 2 is therefore not closed. The fixture matrix does not contain
the defeating histories.

VERDICT: NOT READY

## 2. Strengths

- **§1 / §8 diagnosis.** The four-cycle common structure is stated
  accurately. "Patching receipt provenance does not establish scope
  completeness" is the correct lesson. The triggering issue's design bar
  is quoted, not paraphrased away.
- **FORK B (partial).** §4(1)–(3) is a real fail-closed check *over
  whatever path set Σ happens to be*: ancestor + no merge, shape
  equality, blob identity via `git ls-tree` / `git cat-file` bytes. There
  is no classified-change predicate in this text. Whitespace, comments,
  and churn all refuse. That is the right shape for a check — it is not
  a complete surface.
- **FORK C.** `rangeRelaxation` absent ⇒ `MATURITY_CANDIDATE_PIN_MISMATCH`
  at the existing 649-equality. Exact-pin remains a choosable path. F8
  is the right control fixture.
- **Cycle 3 as originally stated.** If no receipt is a derivation input,
  an orphan `*.promotion.json` cannot bootstrap a later range. That
  specific history dies.
- **Cycle 4 as originally stated.** A voided equal-pin receipt is not
  consulted. The original promote/demote/re-promote *receipt* bootstrap
  has no hook.
- **§10 honesty about availability.** "No availability guarantee" is
  stated. The problem is that §3 then spends its degrees of freedom
  buying availability back (per-id descriptors, non-blanket
  `manifest.rs`) and parks the resulting soundness hole as OQ4.

## 3. Concerns

### MATERIAL 1 — Cycle 5: the first promotion still authorizes its own minimum
**(relocated self-declaration; the fifth defeat)**

**What the Spec claims.** §3.2: "Everything in this algorithm is a
function of `S` and two commits. No receipt field is read." §5: a first
promotion "may range-relax on its own code-derived surface with no
reference to any receipt, because the model needs none: authority is
the surface, not a predecessor." §8: "a receipt can only *declare* `C`;
it can never *make a range clean*."

**What is actually true.** `CAPABILITY_D4_SURFACE` is an author-written
map of path prefixes. A6 proves **key exhaustiveness** against
`TargetCapabilityId::ALL`, not **descriptor completeness**. OQ4 admits
this in so many words ("completeness of a given descriptor … is a
review judgment") and offers dual-family review of descriptor edits —
the same class of patch the issue already rejected: *"patching receipt
provenance does not establish scope completeness."* Patching registry
authorship does not either.

The "edit forces exact-pin for straddling ranges" mitigation (§5
Re-scopes, F9) is not a mitigation of *standing* under-breadth. It
fires only when `capability-d4-surface.mjs` itself changes inside
`C..P`. A descriptor that was under-broad at both endpoints is
invisible to §4(2) and §4(3).

**Defeating history (not in F1–F10).**

1. Land `packages/snapback-codegen/capability-d4-surface.mjs` with an
   exhaustive key set (A6 green) and this descriptor for the coupled
   pair `bounded_children_v1` + `write_activity_v1`:

   ```text
   runtimeModules: ['src/bounded_children_cursor.rs']
   semanticCheckers: ['tests/capability-maturity.test.mjs']
   conformanceInputs: ['tests/maturity-admission.txt']
   generatedInputs: ['schemas/capability.manifest.local-dev-sqlite-ibex.json']
   ```

   In this tree the pair's execution lives in `src/local.rs` (~33,716
   lines: schema-plan validation, cursor mint, parent-restart,
   `class_id: "bounded_children_v1"`). The cursor module is ~330 lines.
   The in-tree exact-pin fixture already treats the honest surface as
   `roots: ['src']` (`tests/capability-maturity.test.mjs` `CLAIM_SCOPE`).
   The new registry invites a per-id *subset*.

2. `C`: qualify the pair. `claimScope` may be anything; F1 already
   showed the range check will not read it.
3. Intervening commit: change `src/local.rs` (semantic change to
   bounded-children execution).
4. `P` then `H`: promote with `rangeRelaxation.candidateSourceSha = C`.

**Result under this Spec:** `src/local.rs` ∉ Σ. The registry file is
byte-identical `C..P`. Contribution 4's three files are unchanged.
§4(1)–(3) pass. F7-shaped **GREEN**. The capability is stable across a
semantics-affecting runtime change that the "code-derived" surface
never included.

This is cycle 1 with the narrowing moved from `receipt.claimScope` into
a sibling file the same author writes before `C`. It is worse than
cycle 1: a receipt scope is per-promotion and re-reviewed; a registry
row is standing authority for every later ranged promotion of that id.

F5 (**GREEN** first promotion with a descriptor and no prior receipt)
is not a proof that first-promotion-no-authority is closed. It is the
landing pad for this attack. The first promotion's minimum *is* the
descriptor the promoting party authored. The receipt is no longer the
container; the sin is the same.

**What would close it.** Either:

- **Conservative over-approximation, mechanically.** Σ for every `S`
  includes (at least) the entire `src/` tree, the entire
  `packages/snapback-codegen/` tree, `scripts/capability-maturity.mjs`
  plus its import closure, every `schemas/capability.manifest.*`, and
  the conformance/acceptance roots — the shape the in-tree
  `CLAIM_SCOPE` already uses. Per-id descriptors, if they exist at
  all, may only *add* paths. Under-breadth becomes unrepresentable.
  Availability dies for churny files; §10 already claims that is
  acceptable.

- **Or** a real derivation (module graph / `include!` / import closure
  from a code-owned entry point per id), with "entry point missing ⇒
  underivable ⇒ exact-pin only."

Review of descriptors (OQ4) is not a close. It is cycle-2-style
provenance patching.

### MATERIAL 2 — Cycle 2 is not closed: the running interpreter is at H, outside the compared window

**What the Spec claims.** Contribution 4 appends, for every capability,

```text
scripts/capability-maturity.mjs
packages/snapback-codegen/capability-d4-surface.mjs
packages/snapback-codegen/target-profiles.mjs
```

so "a change to how surfaces are derived — or a narrowing of any
capability's descriptor — is itself a semantics-affecting change that
the §4 clean-range check will catch."

**What is actually compared vs what actually runs.**

- Compared: those three *paths'* blob bytes at `C` and at `P`.
- Executed: the `deriveD4Surface` / `validateD4Range` implementation in
  the validator process. That process is loaded from the checkout of
  `H` (or `HEAD` of the push containing `H`). Today's module already
  works this way: `TARGET_PROFILE_DEFINITIONS` is a static `import`
  from the running `target-profiles.mjs` (`capability-maturity.mjs`
  11–15), while manifests are `bytesAt(..., promotion.candidateSourceSha)`
  (`supportingTargetProfiles` 319–345). The Spec tells the implementer
  to compute contribution 2 "exactly as `supportingTargetProfiles` does
  today" (§3.2 #2) *and* to compute every contribution "from git bytes
  at `candidateParentSha`" (§3.2 preamble). Those two sentences do not
  agree. The natural implementation follows the import.

`H` is not in `C..P`. The Spec says so, in contribution 5, to justify
excluding the maturity registries. The same fact means `H` can change
the interpreter without dirtying Σ.

**Defeating history A — same-commit interpreter edit.**

1. `C..P`: `src/capability_runtime.rs` changes. Descriptor (complete,
   even) names that file. `capability-maturity.mjs` is unchanged
   `C..P`.
2. `H` carries the promotion **and** an edit to
   `deriveD4Surface` / `validateD4Range` that omits `runtimeModules`
   from the union, or introduces the classified-change predicate FORK
   B forbids.
3. A5 requires `H` to touch `src/manifest.rs`,
   `packages/snapback-codegen/index.mjs`, a test, the governing LLP,
   and the guide. It does **not** forbid extra paths.
   `validateTransitionRange` (`changedPaths` + required-set checks)
   is a must-include list, not a must-only list.
4. CI checks out `H`. The running algorithm no longer puts the
   changed runtime in Σ. Contribution 4 compares
   `capability-maturity.mjs` at `C` and `P` — identical. **GREEN.**

**Defeating history B — push-HEAD after H.** A5 allows one transition
per `parent..HEAD` range, not "HEAD is H." `[P]--[H: promotion]--[H+1:
narrow deriveD4Surface]`. `validateTransitionRange` finds one
transition. The working-tree validator is `H+1`. Same result.

**Defeating history C — helper extraction (cycle 2 returns).**
Contribution 4 is a three-path *floor*, not a closure over the
derivation module graph. After the Spec lands, extract
`deriveD4Surface` into `scripts/derive-d4-surface.mjs` (or
`packages/snapback-codegen/derive-d4-surface.mjs`). That extract
dirties `capability-maturity.mjs` once. After it is at both `C` and
`P`, edit *only* the helper to drop runtime modules. The helper is
not in contribution 4. F2 does not fire. Cycle 2's exact sentence
applies: "a floor that omits the code that computes the surface can
be silently defeated by editing that code."

A6 does not freeze the derivation import graph. F2 only mutates the
three enumerated files inside `C..P`.

**What would close it.**

- Execute the derivation using the **bytes at `P`** (subprocess
  `node` of `git show P:scripts/capability-maturity.mjs` and its
  `P`-tree imports), never the checkout interpreter; **and**
- Define the derivation-code surface as the **import closure** of
  those entry points, pinned by a committed parity test (A7) that
  fails if a new file enters the closure without entering the
  surface; **and**
- Refuse the range if the derivation-code surface differs between
  `P` and `H` (or `HEAD`). `H` may flip maturity registries;
  `H` may not flip the function that decides whether a range is
  clean.

Until those three are specified, "the derivation code is in every
surface" is a compared-file floor, which is what cycle 2 already
defeated.

### MATERIAL 3 — Surface under-derivation is the standing hole; D-4's input-closure sentence is not implemented

LLP 0189 D-4: a claim digest covers "the runtime/implementation of the
claimed capability plus the checkers that define that claim's
semantics" and "**closes over the semantics-affecting inputs of its
in-digest checkers.**" This Spec's §3.2 is not a closure. It is five
unions of author-declared prefixes plus three hardcoded paths plus
supporting-profile manifests.

Consequences, each a defeating history:

**3a. File outside the prefix that the surface depends on.**
`src/bounded_children_cursor.rs` is in Σ. It calls into helpers in
`src/local.rs`. Change only `src/local.rs`. Blob-identity over Σ is
clean. Semantics changed. `git diff` over the path set cannot see a
path it was not given. Rename/copy the implementation to
`src/bounded_children_v2.rs` (outside the prefix), leave the old file
byte-identical, retarget the call from a file that is also outside Σ:
clean.

**3b. `include!` / `mod` / JS import / build-script indirection.**
The surface file is unchanged (`include!("../generated_tables.rs")` or
`from './secret.mjs'`). The included file is outside every selector.
§4(3) compares the include-site blob. Clean.

**3c. Contribution 5's explicit exclusion of `src/manifest.rs` and
`packages/snapback-codegen/index.mjs`.** They drop these "so ordinary
unrelated churn … does not suppress range relaxation." In this
monolith those files *are* the dispatcher / maturity / support-mirror
for many ids. An intervening `C..P` commit can change a match arm,
support fact, or routing table that alters a capability's runtime
without touching that capability's dedicated module. The flip *at H*
is correctly outside the range; the flip *between C and P* is a
semantic change they have chosen not to see.

**3d. Compiler / feature / generated-output inputs.** `Cargo.toml`
features, `.cargo/config.toml`, build.rs outputs, codegen templates
not named in `generatedInputs`. Same class.

FORK B is fail-closed on the path set. It is not fail-closed on the
capability. An under-broad Σ makes the fail-closed check a
self-narrowing floor — cycle 2 again, now at rest in the registry.

There is no mechanical "this prefix actually covers the id" check.
"Each array is non-empty" is satisfied by pointing
`generatedInputs` at a never-changing stub and `semanticCheckers` at
a README.

### MATERIAL 4 — The admission theorem is a non sequitur (Σ / `claimScope` split-brain)

§4 last paragraph: when (1)–(3) pass, "the candidate evidence
witnessed at `C` (E2 corpus runs, E4(a) candidate audit …) is admitted
as if witnessed at `P`, **because** the surface that defines the
claim's semantics is provably byte-identical across `C..P`."

That "because" requires the evidence at `C` to have covered that
surface. It does not.

- Range authority: `Σ(S, ·)` from the registry, "never" `claimScope`
  (§2, §4.1, §6.1).
- Evidence authority: `validateOwnCorpusEvidence` and
  `validateCandidateAuditEvidence` still bind the receipt's
  `claimScope` digest / exact object (`capability-maturity.mjs`
  347–388, 651–674). That is unchanged, and the Spec is proud of
  the separation.

So the theorem is:

```text
Σ unchanged C..P
E2/E4(a) green on claimScope
∴ evidence at C is valid for the claim at P
```

This is valid only if `claimScope ⊇ Σ`. The Spec requires no such
inclusion. A ranged promotion may therefore reuse C-anchored evidence
that never touched files the Spec itself calls "the surface that
defines the claim's semantics."

This is not cycle 1 (the range check does not *narrow* to
`claimScope`). It is a different defect: the range check and the
evidence check talk about different sets, and the Spec uses the first
to waive re-witnessing the second.

Using `claimScope` as a **coverage floor** (`resolved(claimScope) ⊇ Σ`,
else refuse the range) is not receipt-as-authority. The receipt would
be forbidden to sit *below* the code surface. Using `claimScope` as
the range path set *is* cycle 1. The Spec does neither; it just
asserts the implication.

F1 only tests "runtime in Σ, omitted from `claimScope`, **changed**."
It does not test "runtime in Σ, omitted from `claimScope`,
**unchanged**, never in E2/E4(a)." That second case is GREEN under
this text and is how a first promotion self-authorizes an untested
minimum.

### MATERIAL 5 — F1–F10 do not cover cycle 5, the H-interpreter, or first-promotion-no-authority

| History | Covered? |
| --- | --- |
| Cycle 1 as receipt-`claimScope` hiding a change *that is in Σ* | F1 |
| Cycle 2 as C..P edit of the three enumerated files | F2 |
| Cycle 3 orphan receipt | F3 (inertness) |
| Cycle 4 voided-receipt bootstrap | F4 (as originally framed) |
| Standing under-broad descriptor + runtime change outside Σ | **No. This is GREEN. F5 helps it.** |
| `H` or `HEAD` edits `deriveD4Surface` | **No** |
| Helper file extracted out of contribution 4 | **No** |
| `src/local.rs` / `src/manifest.rs` / include-site change | **No** |
| First promotion with no prior *receipt* but an author-written descriptor | F5 **GREEN** — the opposite of a close |
| `claimScope ⊊ Σ`, evidence reused | **No** |
| Exact-pin fallback | F8 yes |
| Honest clean range / re-scope / merge | F7 / F9 / F10 |

The brief required fixtures for all four cycles **including a first
promotion with no prior authority.** F5/F6 only show "no receipt ⇒
still works if a descriptor exists / refuses if not." They do not show
that the first promotion cannot pick its minimum. Under this design
the first promotion *does* pick its minimum. The required fixture is
absent because the required property is absent.

F4 additionally does not test: first exact-pin *with* a standing
under-broad descriptor, demote, change the omitted runtime,
range-re-promote. That is cycle 4 reincarnated on the registry
instead of the voided receipt. The Spec's "closed by construction
because no receipt is a derivation input" is true and insufficient.

### MATERIAL 6 — Implementability contradictions that become soundness bugs the moment someone "makes the feature work"

These are not polish. Each is a place the implementer must choose, and
the availability-friendly choice reopens a gate.

**6a. A5 pin vs §9 "existing A5 checks are unchanged."**
`validateTransitionRange` 1053–1056:

```text
if (record.candidateSourceSha !== parent || record.candidateParentSha !== parent
    || canonicalJson(record.capabilityIds) !== canonicalJson(ids))
  fail('MATURITY_TRANSITION_PARENT_MISMATCH', ...)
```

LLP 0134 A5: the sole parent must equal **both** pins. §6.1 wants
`candidateSourceSha = C ≠ P` when `rangeRelaxation` is present. §9
says A5 "gains the §6.2 D-4 range proof" and "all existing A5 checks
(sole-parent pin, …) are unchanged." Those sentences cannot be true
together.

- Leave 1053 unchanged: every ranged promotion dies
  `MATURITY_TRANSITION_PARENT_MISMATCH`. Feature is dead; fail-closed.
- Drop `candidateSourceSha !== parent` without wiring `validateD4Range`
  on **that same path**, with the same `S` A5 derived from the
  registry diff: the pin is gone and the surface proof is optional.

The Spec must strike and replace the A5 sentence explicitly.

**6b. Staged-locator bind.**
`validateLocator` staged branch (247–251):
`locator.sourceSha !== context.candidateSourceSha` refuses, then reads
bytes from `context.recordCommit` (`H`). LLP 0134 §4 staged-tree rule:
that `sourceSha` is `candidateSourceSha` **= `candidateParentSha`**.
If top-level `candidateSourceSha` becomes `C`, staged locators must
either lie (`sourceSha = C` for a tree built on `P`) or fail. The Spec
never retargets the staged bind at `P`. Fail-closed until someone
"fixes" it by accepting the lie.

**6c. `supportingTargetProfiles` "exactly as today."**
Today: profile *population* = running import;
manifest *bytes* = `candidateSourceSha` (`C`), not `P`.
If contribution 2 is only evaluated at `C`, a profile that *gains*
support for `S` between `C` and `P` does not enter Σ, its manifest
change is not diffed, and E2 is not required for the new supporting
profile at `P`. Supporting-set drift is a claim-relevant change. The
Spec's "identical computation at both endpoints + shape equality"
would catch it **if** that text wins over "exactly as today." It must
say which sentence is load-bearing, and it must say the profile
population is read from `git show <commit>:packages/snapback-codegen/target-profiles.mjs`,
not from `import`.

**6d. Transition uniqueness vs F4.**
`validateMaturityRecordTree` 914:
`key = candidateSourceSha + capabilityIds`. A re-promotion that
honestly reuses the same `C` as the voided first promotion collides
and dies `MATURITY_TRANSITION_CONFLICT`. F4 as specified may fail for
the wrong reason, or pressure the implementer to loosen the key
without a replacement uniqueness rule.

**6e. `ls-tree` flags.**
§3.2 says `git ls-tree -r`. The in-tree staged-tree helper already
uses `git ls-tree -r -z --full-tree` (`treeManifest` 922). The Spec
must require `--full-tree` and `-z`, and must define the object types
that count (blob vs 120000 symlink vs 160000 gitlink). A gitlink in
Σ whose pointer is unchanged while the submodule content moved is
another outside-the-surface change.

## 4. The seven requested attacks, answered

### 4.1 Receipt self-authorization

Traced inputs to `Σ` and to the range check, as specified:

| Input | Source | Trusted as authority? |
| --- | --- | --- |
| `S` (capability ids) | Receipt, A5-checked against the registry diff at `H` | Identity of the act, not the surface. Sound. |
| `C` | `rangeRelaxation.candidateSourceSha` = top-level `candidateSourceSha` | Window selector. Independently falsified as ancestor + evidence-resolves. Sound **if Σ is complete**. Combined with M1/M3, `C` chooses a window that contains a change Σ does not include. |
| `P` | Git sole parent of `H` (A5) | Sound. |
| `CAPABILITY_D4_SURFACE` | Author-written code, claimed read at `P` | **This is the scope authority.** Not independently derived. M1. |
| Running `deriveD4Surface` | Checkout of `H`/`HEAD` (today's import style; Spec also says git-bytes-at-P) | **This is the interpreter authority.** Outside the compared window. M2. |
| `TARGET_PROFILE_DEFINITIONS` | Running import today; Spec contradicts itself | Interpreter-side. M2 / 6c. |
| Manifests | Git at `C` today; Spec says both endpoints | 6c. |
| `claimScope` | Receipt | Not a range input **as written**. Still the E2/E4(a) input. M4. |
| `derivedSurfaceDigest` | Optional receipt | Recomputed; mismatch is a receipt error. Not authority. (It hashes the **path list**, not blob contents — informational even as a checksum.) |
| Prior / voided / orphan receipts | — | Not inputs. Cycles 3 and 4 *as originally stated* are closed. |

The sentence "the receipt contributes nothing the validator trusts as
authority" is **true of receipt fields** and **false of the promoting
act**. Cycle 5 does not need a receipt field. Cycle 4's "closed by
construction because no receipt is a derivation input" is the tell:
they optimized for the previous indictment's wording.

### 4.2 Surface under-derivation

Yes. See M1 and M3. An under-broad descriptor is a hole. The
straddling-edit mitigation is not sufficient and is gameable by never
editing the descriptor. Prefix selectors without a dependency closure
are gameable by moving the definition, adding an include, or retargeting
from `src/manifest.rs` / `src/local.rs`.

### 4.3 Scope-derivation-code-in-its-own-surface

Not achieved. See M2. There is a path where the derivation code
changes (at `H`, at `HEAD`, or in a non-enumerated helper) and the
range still relaxes.

### 4.4 Range-check gaming

Over a *complete* Σ, blob-identity-by-path is hard to game:
whitespace is a change; a rename is a shape change; `git diff -M` is
not what §4(3) specifies. Over the Σ this Spec actually produces, the
game is "don't put the changed file in Σ" (M1/M3), not "make the diff
look empty." No classified-change predicate appears in the text.

### 4.5 Fail-closed completeness / FORK C

No classified-change predicate in this draft. Exact-pin is retained
when `rangeRelaxation` is absent and is a permanent fallback the
promoter may always choose. It is **not** unbypassable as a
*requirement*: any id with a (possibly under-broad) descriptor and an
unchanged listed path set takes the ranged path. That is the feature,
and under M1 it is the bypass.

### 4.6 Availability vs soundness

§10 states the trade. §3 then unsays it. Per-id descriptors and the
non-blanket registry exclusion exist *only* to restore availability
on churny files. That is the pressure that creates M1 and M3c. The
in-tree exact-pin fixture already paid the availability cost
(`roots: ['src']`). This Spec invents a narrowing mechanism and calls
the leftover hole an open question.

| OQ | Soundness hole or availability knob? |
| --- | --- |
| 1 Per-file sub-selectors | Availability knob that **adds** a parsing surface. Sound only if the parser is in the derivation-code closure and runs from `P`'s bytes. Otherwise a new H-interpreter. |
| 2 Manifest-input narrowing | Same. A code-owned projection is sound only if the projection code is in-surface and pinned at `P`. |
| 3 Standing LLP 0130 rule vs per-receipt adjudication | Governance / availability. Not a soundness hole. |
| 4 Descriptor-review discipline | **Soundness hole parked as a process knob.** Dual-family review does not establish completeness. This is not an OQ; it is M1. |

### 4.7 Completeness / implementability / fixture matrix

See M5 and M6. The matrix covers the four cycles *as previously
indicted* (receipt as input). It does not cover the fifth defeat, the
H-interpreter, dependency under-derivation, or first-promotion
self-authorization. Several A5/locator/import seams are unspecified
and fail closed only until the implementer resolves the
contradictions in the feature's favor.

## 5. Minors (not independently defeating)

1. `derivedSurfaceDigest = sha256(canonicalJson(Σ(S, P)))` is a hash
   of the path list, not of surface contents. Name it so an
   implementer does not treat it as a content proof.
2. §3.2 "promoting commit" vs `candidateParentSha` is used for both
   `H` and `P`. Pick one word per commit and keep it.
3. Demotion and introduction keep the 719 / 799 exact-pin equalities.
   State that range relaxation is promotion-only, so a future helper
   does not "generalize" them.
4. F9 says `MATURITY_RANGE_SURFACE_SHAPE_CHANGED` for any registry
   edit. A registry edit that does not change the key set of `S` but
   changes comments / another id's rows is a **content** change of a
   contribution-4 file (`MATURITY_RANGE_SURFACE_CHANGED`), not
   necessarily a shape change of `Σ(S)`. The fixture's expected code
   is underspecified.
5. `git ls-tree` vs the "plain git diff" wording in the issue/§4
   intro should be unified on `ls-tree` + `cat-file` so nobody
   implements `git diff -w`.

## 6. Suggestions (only after M1–M6)

A design that would be reviewable as READY, in outline:

1. Σ is a **conservative over-approximation** (entire `src/`, entire
   codegen package, derivation import closure, all capability
   manifests, conformance/acceptance roots). Descriptors may add,
   never remove. Delete OQ4 as a soundness question.
2. `deriveD4Surface` **executes as the tree at `P`**. Refuse the range
   if the derivation-code closure differs `P..H` (or `P..HEAD`).
3. A7: committed import-graph freeze of the derivation closure.
4. Admission rule: `resolved(claimScope) ⊇ Σ`; E2/E4(a) therefore
   cover the surface whose cleanliness waives re-qualification.
   `claimScope` still does not *select* the range path set.
5. Explicit A5 amendment: `candidateParentSha == parent`;
   `candidateSourceSha == C`; staged locators still bind `P`;
   `validateD4Range` on that same path; supporting-profile
   population evaluated at both endpoints from git bytes.
6. Fixtures: M1 standing under-broad + `src/local.rs` change (must
   **not** be GREEN unless (1) made under-breadth unrepresentable);
   M2 H-interpreter edit; M2 helper extraction; M4 `claimScope ⊊ Σ`;
   M3c `src/manifest.rs` change between `C` and `P` for an id that
   does not name it; retain F1–F4, F6–F10.

If that availability cost is unacceptable, **do not relax the pin.**
Exact-pin is already sound. This relaxation is optional (§2 FORK C).
Shipping a narrower-than-`src/` registry so agents can skip
re-qualification is how the fifth defeat gets into `main`.

## 7. Open questions

None that should remain open. OQ1–OQ2 are post-soundness availability
work. OQ3 is author policy. OQ4 is M1.

## 8. Recommended next step

Revise and stay `Draft`. Do not spend a dual-family super-refine
budget on this authority model; the fifth defeat is in the model, not
in the prose. The author (not this reviewer) applies any status
change.

VERDICT: NOT READY

---

# Round 2 — 2026-08-16 (revised v0.2)

**Reviewer family:** Grok
**Provider / runtime:** Grok 4.6 in Grok Build (interactive session)
**Date:** 2026-08-16
**Redacted:** no
**Method:** independent adversarial design re-review of the cwd worktree
against the round-1 defeat set and the v0.2 mechanisms. This session
did not author LLP 0269 (document Author: Claude Fable 5, orchestrated)
and did not author the v0.2 revision. Not a capsule review. Same-family
re-review: dated section, no overwrite of round 1.

- **Target under review:**
  `llp/0269-capability-maturity-range-derivation.spec.md`, 47,409 bytes,
  SHA-256
  `d476498781a8cb9ac2693ec6905101d3d4bedaa714286474b0ee9423226bb40c`.
  Status: Draft. Hash and byte count verified on disk before the verdict.
  Document header: Revised 2026-08-16 (v0.2).
- **Governing law re-read:** LLP 0134 §2 E2/E4 and §4 exact-pin / A5
  (`validateTransitionRange` 1027–1119, sole-parent skip at 1033,
  pin at 1053–1056, staged locator 247–251); LLP 0189 D-4 (runtime +
  semantic checkers + input-closure sentence); LLP 0130 ER-2; triggering
  issue `issues/20260816-llp0134-d4-range-relaxation-needs-sound-derivation.md`.
- **In-tree surfaces used as oracles (not as the spec):**
  `include_str!("../packages/snapback-harness/…")` in `src/runtime.rs`
  and `src/workerd_exec.rs`; `include_str!("../packages/snapback-admin-client/index.mjs")`
  in `src/admin.rs`; `include!(concat!(env!("OUT_DIR"), "/embedded_guide.rs"))`
  in `src/guide.rs` produced by repo-root `build.rs` (`rerun-if-changed=guide`,
  `schemas/http.routes.v1.json`); in-tree `CLAIM_SCOPE`
  (`tests/capability-maturity.test.mjs` 18–31) which names
  `guide/capabilities.md`, `tests/maturity-admission.txt`, and
  governing LLP paths that v0.2 Σ does not; `scripts/check-capability-maturity.mjs`
  (static-imports `capability-maturity.mjs` from the checkout, then
  walks `base..HEAD`).
- **Blindness:** round-1 Grok artifact in this file was re-read in
  order to reconstruct each named defeat against the revision (required
  by the brief). No other family's 0269 artifact exists in-tree.

---

## 1. Overall assessment

v0.2 is a real revision, not a rename. It takes every close I named
in round 1 as a *direction* and writes it down: the per-id descriptor
is no longer a standing minimum; derivation is specified to run from
`P`; `claimScope` is a coverage floor; A5's merge skip is
strike-and-replaced; comparison is complete tree-entry equality;
F1–F14 are rebuilt around those claims.

The disease is not gone. It moved to the **boundary of the chosen
floor**.

The load-bearing sentence of v0.2 is COMMITMENT A: Σ "cannot omit a
real input, because it is a superset of every plausible one." That
sentence is false in this repository. The same document then
contradicts it: §3.4 exists *because* "true surface reaches *outside*
the conservative base (e.g. a `cloudflare/…` worker, a `guide/…`
semantic contract, a doc that defines the claim)." An optional
additive registry whose omission "can at worst fail to add an
out-of-base path" is exactly cycle 5a, now standing at the base
boundary instead of in a per-id row. The in-tree runtime already
compiles `packages/snapback-harness/*` and the `guide/` tree into the
binary without those paths sitting in the base. A ranged promotion
can therefore still authorize itself across a semantics-affecting
change the author never had to declare.

Cycle 5b is specified in the right *direction* (bytes at `P`, pin
the derivation closure) and is **not closed**. The pin is `P..H`,
CI executes from `HEAD`, isolation is parked as §11 Q3, the
"static-import closure" check only names `import()`/`require()`, and
the additive registry is executable JavaScript. Those are not
implementation polish. They are the remaining interpreter levers.

Change-detection *over whatever Σ the document actually enumerates*
is well-shaped (total tree-entry identity, no classified-change
predicate, exact-pin fallback, merge repair). That is not the same
as a sound relaxation. The design bar is a complete independently
derived D-4 surface. v0.2 still ships a chosen floor plus an
optional widening.

One-line soundness (independent of the availability tradeoff the
author has already accepted): **not sound — Σ is a chosen floor, not
a conservative over-approximation, so a real semantics-affecting
change can still sit outside the protected range.**

VERDICT: NOT READY

## 2. What v0.2 actually closed (credit, so the remaining holes are
not a re-litigation)

| Round-1 defeat | v0.2 status |
| --- | --- |
| M1 specific: `CAPABILITY_D4_SURFACE` omits `src/local.rs` / `src/manifest.rs` | **Closed.** Entire `src/` is in the base. F2b/F5/F6 pin this. |
| M1 general: first promotion picks a standing minimum | **Not closed.** The minimum is now the chosen base. Anything outside it is opt-in (§3.4). |
| M2 specific: C..P compare of three files, execute `deriveD4Surface` at H | **Direction taken.** Specified algorithm loads P's bytes. |
| M2 general: H / HEAD still chooses the interpreter | **Not closed.** See MATERIAL 2. |
| M3a/b in-`src/` `mod`/`include!` | **Closed** for targets that live under `src/`. |
| M3c explicit exclusion of `src/manifest.rs` | **Closed.** |
| M3d compiler / generated / out-of-tree inputs | **Not closed.** See MATERIAL 1. |
| M4 `claimScope ⊊ Σ`, Σ unchanged, evidence reused | **Partially closed** as a path-set floor (F7). Coverage ≠ witnessing. Not an independent change-detection defeat. |
| M5 fixture holes for the *named* histories | **Closed as restated.** Remaining defeats (out-of-base include, HEAD≠H, hidden load) are un-fixtured. |
| M6a A5 `candidateSourceSha === parent` contradiction | **Closed** (§6.2 strike-and-replace). |
| M6b staged locator still bound to `candidateSourceSha` | **Closed** as specified (retarget to `P`/`H`). |
| M6c supporting-profile population / "exactly as today" | **Closed** by putting *all* manifests in the base. |
| M6e `ls-tree` flags, symlink/gitlink | **Closed** (`-r -z --full-tree`, `MATURITY_RANGE_SURFACE_NONBLOB`). |
| Cycles 3 and 4 as *receipt-as-input* | Still closed. No receipt is a derivation source. |

The A5 merge repair and tree-entry equality are sound as specified.
I do not re-open them below except to answer the brief's probes.

## 3. Reconstruction of each round-1 defeat against v0.2

### 3.1 Cycle 5a / M1 — standing under-broad descriptor

**Round-1 history.** Land an exhaustive-key, under-broad
`CAPABILITY_D4_SURFACE` row; change `src/local.rs`; range-promote.
Σ never contained the file. GREEN.

**v0.2 against that history.** The file is under `src/`. F5/F2b
refuse `MATURITY_RANGE_SURFACE_CHANGED`. The per-id row can no
longer drop an in-base path. **That history dies.**

**Reincarnation (the same disease, new boundary).** v0.2's own
§3.4 admits out-of-base *true* surfaces and makes their membership
author-optional. Combined with a base that does not in fact contain
the runtime's compiled-in inputs, the standing minimum is again
whatever the author failed to add.

**Defeating history R2-1 (not in F1–F14).**

1. `C`: qualify `inline_handler_v1` (or any id whose execution
   goes through the handler VM). No additive registry row, or a
   row that names a guide page and not the harness.
2. Intervening commit: edit
   `packages/snapback-harness/allowlist.json` (or
   `invocation-iife.js`, `ctx-bootstrap.js`,
   `workerd/entry.mjs`). These bytes are `include_str!`'d into
   `src/runtime.rs` / `src/workerd_exec.rs`. The include *site*
   is unchanged, so the `src/` blob is identical.
3. `P` then `H`: promote with `rangeRelaxation.candidateSourceSha = C`
   and a `claimScope` that expands to ⊇ the v0.2 base (the in-tree
   fixture already uses `roots: ['src']` plus a file list; inflate
   the file list / add the base prefixes).

**Result under v0.2:** harness path ∉ Σ. Registry unchanged (or
absent). Derivation-code closure unchanged. §4.2 passes. §4.3
passes. F11-shaped **GREEN**. The promoted id is stable across a
change to the sandbox allowlist that the next `snapback` binary
will compile in.

The same shape works for:

- `packages/snapback-admin-client/index.mjs` (`src/admin.rs:399`).
- `guide/**` via `build.rs` → `OUT_DIR/embedded_guide.rs` →
  `src/guide.rs` (`include!(concat!(env!("OUT_DIR"), …))`). The
  include site in `src/` is unchanged; the generated producer
  and its inputs are outside `packages/snapback-codegen/`.
- `tests/maturity-admission.txt` and `guide/capabilities.md` —
  both are in today's honest `CLAIM_SCOPE` and **not** in v0.2 Σ.
- `Cargo.toml` / `Cargo.lock` / `rust-toolchain.toml` — change
  compiled behavior with every `src/` blob identical.
- `packages/snapback-contract/**` (named as `sourceTest` from
  `src/local/authorization_acceptance.rs`); `cloudflare/**`;
  `clients/**`; `vendor/ibex/**` for `ibex_ctx_db_host_bridge`
  / handler VM.
- Semantic checkers under `tests/*.rs`, `tests/*.mjs`,
  `tests/conformance/` — contribution 5 put
  `tests/acceptance/` in Σ (the maturity *process* tree), not
  the id's own E2 corpus. D-4's "checkers that define that
  claim's semantics" mostly do not live in `tests/acceptance/`.

§3.1 #1's claim that "No import/`include!`/macro closure analysis
of Rust is required for soundness, because the whole tree is in"
is false for every `include_str!("../packages/…")` and for
`include!(OUT_DIR/…)`. The user-asked case — "a macro/include
reaching outside" — is not hypothetical. It is on disk.

**Additive-only registry, gamed.** As a *set-union of path
expansions*, the registry cannot remove an in-base path. F5 is
the right fixture for that property. It can still be gamed to
*appear* to add while failing to protect:

- Omission / absence is the game. That is standing under-breadth
  for every out-of-base input. No "appear to add" trick is
  required.
- The registry is a `.mjs` module that is **loaded**. A
  `Proxy`, a getter, a top-level side effect, or
  `process.env`-dependent export is Turing-complete. "Frozen
  map" is prose unless the runner *parses data* and does not
  execute JS. A module that, when executed, mutates the
  derivation's union into a replacement, is a subtractive
  registry that F5 only catches if the fixture's process
  happens to take the same branch.
- There is no specified exclusivity rule. An implementer who
  treats a more-specific registry prefix as replacing a base
  prefix reintroduces narrowing. The spec must say: Σ is the
  union of independently expanded blob sets; no prefix is
  exclusive.

**What would close it.** Either:

1. **Actually conservative base.** Deny-list, not allow-list:
   every tracked blob is in Σ except an enumerated set of
   paths justified as non-semantic (and that set cannot include
   `packages/`, `tests/`, `scripts/`, `schemas/`, `guide/`,
   `clients/`, `cloudflare/`, `vendor/`, `build.rs`,
   `Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml`,
   `.gitattributes`). Or mechanically close
   `include!`/`include_str!`/`build.rs rerun-if-changed`/Cargo
   inputs *and* the entire `packages/`, `tests/`, `scripts/`,
   `schemas/`, `guide/` trees. The additive registry, if it
   remains, cannot be the home of any class of input the spec
   itself calls a "semantic contract."
2. **Withdraw COMMITMENT A's completeness sentence** and admit
   the base is a chosen floor. Then cycle 5a is acknowledged
   open and the design is not a sound relaxation. Exact-pin
   stays.

Review of registry rows, or "authors should add harness paths,"
is the OQ4 we already rejected.

### 3.2 Cycle 5b / M2 — H-boundary derivation escape

**Round-1 histories.** (A) `H` edits `deriveD4Surface` in the
same commit as the promotion. (B) `[P]--[H: promotion]--[H+1:
narrow derive]`, CI runs at `HEAD = H+1`. (C) extract helper
out of the three-path floor, then edit the helper.

**v0.2 against those histories, as specified.**

- (A): derivation is loaded from `P`; `P..H` drift of the
  static-import closure refuses. **Closes (A) if and only if
  the H-side wrapper actually loads P and actually runs the
  drift check.** That "if" is the remaining hole.
- (B): the specified extra check is `P..H`, not `P..HEAD`.
  `scripts/check-capability-maturity.mjs` static-imports
  `./capability-maturity.mjs` from the checkout and then walks
  `base..HEAD`. A push that adds `H+1` after the promotion
  keeps one A5 transition (at `H`) and executes `H+1`.
  `P..H` is clean. v0.2 *claims* this history is closed
  (§1 cycle 5b, §3.3, §8). It is not.
- (C) as *static* `export … from` / `import` of a new helper:
  the helper enters the closure; `capability-maturity.mjs` at
  `H` differs from `P`; `MATURITY_RANGE_DERIVATION_DRIFT`.
  **Closes the static extract.** Does not close a hidden load
  (below).

**Can H still influence the derivation outcome?** Yes.

1. **The documented "irreducible root of trust" is not
   irreducible; it is a wide, unpinned wrapper.** The
   CI entry is `check-capability-maturity.mjs` →
   `validateTransitionRange`. Only
   `capability-maturity.mjs` and its import graph are in
   the derivation-code closure. The entrypoint is *not*.
   Rewriting the entrypoint to skip the range proof is the
   general CI-integrity problem and I do not score that as
   a 0269-specific defeat. What *is* 0269-specific: the
   entrypoint already imported H's `capability-maturity.mjs`
   before any P-load happens, and §6.2 puts
   `validateD4Range` in that module. If the checkout's
   `validateD4Range` (HEAD) computes Σ from P but then
   intersects it, drops the drift check, or swaps in HEAD's
   `deriveD4Surface`, the specified defenses do not run.
   That is not "skip the gate"; it is "run a lookalike
   gate." Tightening that is in scope: pin the entrypoint
   and its H-imported closure `P..HEAD` (or require
   `HEAD == H` whenever a `rangeRelaxation` promotion is
   in the walked range), and specify the H-wrapper as
   identify `{C,P,H,HEAD}` / materialize P / invoke / compare
   — nothing else.

2. **Isolation is load-bearing and explicitly unfinished.**
   §11 Q3 parks "fresh module registry, no shared mutable
   state, no network/fs beyond `git show`" as an
   implementation detail. The close of cycle 5b *is* that
   contract. An implementer who `import()`s a single temp
   copy of `capability-maturity.mjs` will resolve
   `../packages/snapback-codegen/target-profiles.mjs` from
   the **checkout** (HEAD), not from P. An implementer who
   runs P's function inside H's already-loaded module graph
   inherits H's `require.cache`, `process.env`, and any
   monkey-patch the entrypoint applied. The availability-
   friendly implementation is the one that reopens H.

3. **Static-import-closure computation can be gamed.**
   `MATURITY_RANGE_DERIVATION_DYNAMIC_IMPORT` refuses
   `import()` / `require()` as a "checkable syntactic
   property." That is not a complete dependency closure.
   Standing (identical `C..P..H`) derivation bytes that
   then execute extra JS via `fs.readFile`+`vm`/`eval`/
   `Function`/`createRequire`/`child_process` leave the
   helper outside Σ and outside the `P..H` pin. Conditional
   `await import(x)` is refused if the scanner is real;
   `import { readFileSync } from 'node:fs'` is a *static*
   import and is not. Re-exports (`export … from`) are in
   the specified graph — good — if the parser actually
   walks `ExportAllDeclaration` / `ExportNamedDeclaration`
   with a `source`. Package `"imports"` / export maps can
   retarget a specifier to a file the walker never listed.
   After such a pattern is standing, editing the hidden
   file is cycle 2 exactly: "a floor that omits the code
   computing the surface."

4. **Executable registry is a new interpreter.** Loading
   `capability-d4-surface.mjs` as a module is not "reading
   a frozen map." It is running author JS on the authority
   path.

**What would close it.** Specify, uniquely:

- Fresh child process, cleaned env, no H module cache.
- Materialize the *entire* static-import closure into an
  isolated directory with repo-relative layout; import only
  from that directory.
- Tree reads are `git ls-tree` / `git cat-file` / `git show`
  with an explicit revision argument; never the worktree.
- Execute no bytes except that materialized closure.
  Registry is JSON (or an AST-extracted object literal of
  string arrays), not a runnable module.
- Refuse `import()`, `require`, `createRequire`, `vm`,
  `eval`, `Function`, and `child_process` of JS inside the
  closure.
- Pin the derivation-code closure **and** the CI entrypoint
  across `P..HEAD`, or refuse unless `HEAD == H`.
- Fixtures: R2-1 (harness/`include_str!`), `H+1` edit of
  derive (must not be GREEN), `fs`+`vm` hidden helper
  (must not be GREEN once standing).

Until those are in the Spec, "derivation executes at P" is
an intent, not a closed algorithm.

### 3.3 M4 — evidence bound to Σ

**Round-1 hole.** `Σ` unchanged ⇏ E2/E4(a) at `C` is evidence
about Σ. Evidence binds `claimScope`.

**v0.2.** `resolved(claimScope) ⊇ paths(Σ(S,C))` or
`MATURITY_RANGE_EVIDENCE_UNDERCOVERAGE` (F7). `claimScope` is
still not the range path set. Broadening it cannot hide a
change *inside* Σ. Narrowing it below Σ now fails. The
cycle-1 reuse of a *narrow* label over an *unchanged* Σ is
closed as a path-set matter.

**Coverage is not witnessing.**
`validateOwnCorpusEvidence` (`capability-maturity.mjs`
347–366) checks schema, ids, supporting profile, `status:
green`, and `claimScopeSha256 === sha256(canonicalJson(scope))`.
It does not record which paths were executed. E2's actual
obligation (LLP 0134 §2) is "the promoted id's own acceptance
corpus reruns green" — selected by id, not by walking
`claimScope.roots`. Inflating `claimScope.roots` /
`.files` to a set whose `git ls-tree -r` expansion covers
Σ (e.g. add `packages/snapback-codegen`, `scripts`,
`schemas`, `tests/acceptance` to the in-tree
`roots: ['src']`) makes §4.3 pass without one extra
corpus row running.

A single root cannot match the whole repo:
`validateClaimScope` rejects `''`, `'.'`, and trailing `/`.
`git ls-tree -r` under a root is a tree prefix, not a
string prefix (`s` does not cover `src/`). Inflation is
by *listing enough real prefixes*, not by a universal
root. That is enough.

The optional "equivalent" form — bind
`sha256(Σ entry manifest)` into E2/E4 — is **not**
equivalent. One is a path-set declaration; the other is a
content-and-mode witness. Calling them equivalent is a new
implementer fork: the weaker one will ship.

**Does this admit a bad promotion?** Not by itself, if Σ is
complete and unchanged: transporting C's (possibly vacuous)
evidence across an identical surface is the same evidence
about the same implementation. It becomes a change-detection
defeat only when combined with MATERIAL 1 (E2's real inputs
live outside Σ and changed). I therefore do **not** score
this as an independent MATERIAL. It is a false premise in
the stated admission theorem (premise (c) is not
established by the check) and a fixture gap (no inflation
row).

**What would make premise (c) true.** Require the
content-addressed `Σ(S,C)` entry-manifest digest in E2/E4
as a mandatory bind, *and* define what the corpus runner
must have done with those paths — or drop the "evidence
spanned Σ" sentence and rest transport solely on Σ-identity
plus the existing E1–E8 bar at `C`.

### 3.4 A5 merge / exact-pin unbypassable

**Round-1 (adjacent).** Unconditional `if (parents.length
!== 1) continue;` at line 1033 lets a two-parent `H` change
the maturity projection with no receipt and no pin.

**v0.2.** For ≠1 parent, compare `projectionAt` and
`registryProjectionAt` against **every** parent; differ
from any ⇒ `MATURITY_MERGE_TRANSITION_UNSUPPORTED`. Equal
to all parents ⇒ benign skip. Promotions must be
sole-parent. F8.

**Does projection-compare-vs-every-parent catch a merge
that changes maturity via one parent?** Yes, for A5's
definition of a transition. Those two JSON projections
(`tests/acceptance/capability-maturity.experimental.json`
and `capability-registry.ids.json`) are what
`classifyTransition` already uses. Cases:

- Merge result ≠ parent A and ≠ parent B → differs from a
  parent → refuse.
- Result = A (already promoted) ≠ B (still experimental)
  → differs from B → refuse. This is the
  "merge a finished promotion onto main" path. Intended.
- Result = all parents → no A5-classified transition.
  Benign.

A merge that flips `src/manifest.rs` `maturity()` *without*
touching those JSON files is not an A5 transition today on
a sole-parent commit either. The repair makes exact-pin
unbypassable for **classified** transitions. I do not treat
"unofficial manifest flip, projection untouched" as a 0269
regression.

Octopus merges are covered ("every parent"). A merge *inside*
`C..P` is independently refused by §4.1 (first-parent walk
must be all sole-parent). `P` itself being a merge is in
`C..P` under standard `rev-list` and is refused. Good.

**Exact-pin is unbypassable for A5-classified promotions.**
This probe does not reopen a MATERIAL.

Minor: specify that `projectionAt` returning `null`
(missing file) is a difference from a non-null parent, so
an implementer does not `==` two nulls into a skip when
one parent lacked the file.

### 3.5 Tree-entry equality

**Round-1.** Blob-bytes-only / `git diff -w` would miss a
mode flip and invite a whitespace-insensitive compare.

**v0.2.** `(mode, type, oid)` via `ls-tree -z --full-tree`
and `cat-file`. No `git diff` variant. Regular `100644` /
executable `100755` only; gitlink and symlink refuse
`MATURITY_RANGE_SURFACE_NONBLOB`. F9, F10.

**Remaining git-state channel with equal (mode, type, oid)
of Σ entries?**

- Executable bit: covered.
- Symlink / gitlink / submodule content behind an unchanged
  gitlink: refused as non-blob. Covered.
- **`.gitattributes` clean/smudge/`ident`/`working-tree-encoding`:**
  committed oid is the repo blob. `git show` / `cat-file`
  do not smudge. A *checkout-based* runner would execute
  smudged bytes. That is isolation (MATERIAL 2), not a
  comparison bug. `.gitattributes` itself is outside Σ, so
  a filter added `C..P` is MATERIAL 1 (out-of-Σ input),
  not a remaining equality hole.
- LFS: same pointer oid ⇒ same object.
- Case-fold / Unicode: distinct tree paths, compared
  separately.

Over the stated Σ, tree-entry equality is sound. I do not
re-open it.

### 3.6 Fixtures F1–F14

They adversarially pin the *named* v0.2 claims, not merely
happy paths: F1/F2b/F5/F6 (in-base change vs scope/registry
narrowing), F2a (H edit / static extract), F4a/F4b (receipt
and registry reincarnations of cycle 4), F7 (undercoverage),
F8 (merge), F9 (mode), F10 (non-blob), F13 (malformed
range), F14 (registry re-scope). F11/F12 are the required
positive controls.

**Still un-fixtured, and those are the remaining defeats:**

| History | In F1–F14? |
| --- | --- |
| `include_str!` / `build.rs` / `Cargo.*` / harness / guide / `tests/maturity-admission.txt` change, Σ as specified | **No. This is GREEN.** |
| `HEAD = H+1` edits derive; `P..H` clean | **No.** |
| Standing `fs`+`vm`/`eval` helper outside the static graph | **No.** |
| Isolation failure: P-load resolves `target-profiles.mjs` from the checkout | **No.** |
| `claimScope` inflated to ⊇ Σ, E2 still id-tagged only | **No** (F7 is the opposite). |
| Merge projection equals parent A, differs from parent B | Subsumed by F8 if F8 is written as "differs from a parent"; not separately pinned. |
| Dynamic `import()` in the closure | Named as a code, not as a fixture. |

F3 remains an inertness assertion, not a refusal. Acceptable
for "orphan is not an input," weak as an adversarial pin.

F2a bundles two attacks and asserts drift "and derivation
ran from P." A fixture that only checks the diagnostic
code does not prove P-execution. Split: (i) H-edit ⇒
drift; (ii) if someone *disabled* drift, Σ still includes
the changed `src/` file because derive ran from P.

F13/F14 each allow two codes. That is an implementer
judgment. Pick one per history.

## 4. New holes the revision introduced

1. **Self-contradiction in COMMITMENT A vs §3.4.** "Superset
   of every plausible input" and "true surface reaches
   outside the base" cannot both be true. This is the
   authority model talking out of both sides.
2. **Base-revision runner as a new, unfinished mechanism.**
   §11 Q3. See MATERIAL 2.
3. **Executable additive registry.** New Turing-complete
   declaration lever, even though its *honest* contract is
   union-only.
4. **False equivalence** of `resolved(claimScope) ⊇ Σ` and
   a Σ-manifest digest in E2/E4 (§4.3 last paragraph).
5. **`S` is capability-independent in the base.** Not a
   soundness hole (it cannot shrink Σ). It does mean a
   client-arm id is protected by `src/` and *not* by
   `packages/snapback-react` unless someone adds a registry
   row — i.e. MATERIAL 1 again.
6. **CI range vs `H`.** v0.2 writes as if the entrypoint
   runs from `H`. It runs from `HEAD`. New overclaim.

## 5. Implementability / uniqueness

The design is **not uniquely implementable**. Judgment calls
that reintroduce an assertion:

- Isolation (Q3): in-process `import` of P vs fresh process
  vs temp tree. The first is the availability-friendly
  choice and reopens H.
- What the static-import walker accepts (re-exports, JSON
  imports, package exports, `node:` builtins + `fs`).
- Registry as executed JS vs parsed data.
- Which of the two "equivalent" evidence binds to ship.
- F13/F14 dual diagnostics.
- Whether `check-capability-maturity.mjs` is in the pinned
  closure; whether the pin is `P..H` or `P..HEAD`.
- How registry "paths/prefixes" expand (must be the same
  `ls-tree -r` rule as `claimScope.roots`, unioned, no
  exclusivity).

A READY spec names one algorithm for each of those.

What *is* unique and good: no classified-change predicate;
union-or-nothing registry *if* parsed as data; total
tree-entry compare; sole-parent promotions; exact-pin
default unchanged.

## 6. The seven requested probes, answered briefly

1. **Can any real semantics-affecting D-4 input escape Σ?**
   Yes. Harness/`include_str!`, embedded guide/`build.rs`,
   `Cargo.*`/`rust-toolchain.toml`, other `packages/` and
   `clients/`/`cloudflare/`/`vendor/ibex`, E2 checkers
   outside `tests/acceptance/`, `tests/maturity-admission.txt`,
   `.gitattributes`. Additive-only cannot remove the base;
   omission of out-of-base paths is the game.
2. **H-boundary.** Derivation-at-P is the right direction.
   H/HEAD can still influence the outcome. The root of
   trust can and should be tightened (entrypoint + `HEAD`,
   isolation, data-only registry, complete load-primitive
   refuse). Static-import closure is gameable via non-import
   loads and via executing the registry.
3. **Evidence.** `resolved(claimScope) ⊇ Σ` is path-set
   coverage of a declaration, not a witness that E2/E4
   exercised those paths. Inflation works. Not an
   independent change-detection defeat if Σ is complete.
4. **A5 merge.** Projection-compare-vs-every-parent catches
   a classified transition that arrived via one parent.
   Exact-pin is unbypassable for classified promotions.
5. **Tree-entry.** No remaining equality hole inside Σ.
   `.gitattributes` is an out-of-Σ input, not a
   `(mode,type,oid)` miss.
6. **Fixtures.** The named v0.2 claims are pinned. The
   remaining defeats are not.
7. **New holes / unique implementability.** Yes: see §4–§5.
   Not unique.

## 7. Minors (not independently defeating)

1. Premise (c) / inflation: do not call path-set inclusion
   "the evidence spanned Σ." Fixture the inflation or
   require the Σ-manifest digest.
2. `projectionAt == null` vs a parent must be a difference.
3. F13/F14: one diagnostic per history.
4. F2a: split drift vs P-execution.
5. F3: keep inertness, but also assert a straddling
   out-of-receipt `src/` change still refuses (so the
   orphan cannot be mistaken for a green-maker).
6. Transition-key uniqueness (`candidateSourceSha + ids`,
   line 914): a re-promotion that reuses the same `C` as a
   voided first promotion still collides
   `MATURITY_TRANSITION_CONFLICT`. F4a may fail for the
   wrong reason. Specify a replacement uniqueness rule
   when `rangeRelaxation` is present (e.g. key includes
   `H` or the record path).
7. Standalone lint for static-only derivation imports
   (§11 Q2) is a good hardening once the refuse-set is
   complete; not a close by itself.
8. Word "promoting commit" is now consistently `H`. Good.

## 8. What would make this READY

1. Make COMMITMENT A *true*: conservative base by deny-list
   or by a mechanical input-closure that includes every
   class currently parked in §3.4 and every on-disk
   `include_str!`/`build.rs` input. Delete the
   "fail to add an out-of-base true surface" sentence, or
   withdraw the completeness claim and keep exact-pin.
2. Close execute-at-P uniquely (isolation, `P..HEAD` or
   `HEAD==H`, data-only registry, complete load-primitive
   refuse).
3. Drop or really implement premise (c).
4. Add fixtures for R2-1, `HEAD=H+1`, and a hidden load.
   Keep F1–F14 for the histories they already pin.

If that availability cost is the empty range (Σ so wide
that only exact-pin ever succeeds), **do not relax the
pin.** That is an acceptable conclusion and a sound one.
Shipping the current floor so a ranged promotion can
ignore `packages/snapback-harness/allowlist.json` is how
the fifth defeat stays in the model.

## 9. Recommended next step

Revise and stay `Draft`. The author applies any status
change. This family is not the author.

VERDICT: NOT READY
