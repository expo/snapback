# LLP 0273: Sound git-content-proof derivation of ownership-disposition lineage

**Type:** Decision
**Status:** Accepted
**Systems:** Proof/gates, Rust core, LLP governance
**Author:** Claude (Fable 5), orchestrated (author-proxy decisions recorded
below are Charlie Cheever's "git-content-proof redesign" ruling of 2026-08-16)
**Date:** 2026-08-16
**Revised:** 2026-08-16 (f — round-6 dual-family super-refine, terminal, now **ACCEPTED**
(dual-READY: grok READY; codex conceded the already-coupled-allowed-host `LH` case is the
conservation boundary, not a hole — recorded normatively in §3.6): both
round-5 families CONVERGED on ONE remaining `k = 0` launder — a **husk/stub at a
PRESENT path** defeats the leftover net because revision e's "path present ⇒ scan that
path directly" fast-path **short-circuited the leftover computation on BOTH endpoints**
(target same-path content match set `T = Ti` WITHOUT computing `L`, so the real successor
`bar` was never seen; a present host path was scanned WITHOUT a content-match or `LH`, so a
live `service_a2 → service_b` edge sat in `analysis.edges` unexamined). Revision f makes
the `k = 0` leftover check **TRULY SYMMETRIC and UNIVERSAL**, with **no path-presence
short-circuit** on either endpoint: (1) target identity **always** computes `S` and `L` —
a present `Ti`-path only places that path INTO `S`, the discharge still requires
`|S| = 1 ∧ L ⊆ S`, and `own(Ti) = ∅ ⇒ S := ∅`; (2) the HOST endpoint gets the **same
content-match + dual leftover** `SH`/`LH` — a present host path is scanned, but a present
husk (`own(path) ⊉ own(Gi)`) or an absent path computes `SH`/`LH`, with `|SH| = 1 ∧
LH ⊆ SH` ⇒ scan `H2 → T`, `SH = ∅ ∧ LH = ∅` ⇒ present scan is the backstop, else refuse
discharge; (3) leftover-fail / `|SH| ≠ 1` is a **DISCHARGE refusal, NOT a push veto** —
§3.4 byte-scan promotion still admits an honest merge (P4); (4) the "genuine re-owning"
sentence is **DELETED** (a `k = 0` re-home to a new allowed module needs a §3.7 grant).
§4 adds N20 (N19 + present stub → BLOCK) and N18b (target same-path parked copy → BLOCK);
N17/N18/P7 re-grounded on a reliable outgoing-edge host; P1/P4/P6/P7 confirmed still admit.
The §5/§6/§8 revision-c leftovers that still named byte-scan-over-allowed-occurrences as
the discharge authority remain rewritten to the `analysis.edges` occurrence backstop +
computed identity. Minors: `ownership-correction` grants pin `direction` and `grantId`
uniqueness; amendment grants must be **git-committed bytes ≤ the predecessor snapshot**,
never a Linear field that merely names a SHA; §3.10 names leading-`::` crate-relative
paths and the self-edge (`to === from`) inline as disclosed analyzer-invisible residuals.
All revision-d/e closures preserved (occurrence backstop over `analysis.edges` neither
byte-identity nor `violationReason`; byte-scan failure PROMOTES; strengthen-only
intersection; structured grant; split/inversion/multi-predecessor rulings). No `k ≥ 1`
machinery changed; no move proof reintroduced; no closed attack re-opened. Terminal
self-verdict: the `k = 0` predicate is now symmetric + universal with leftover-fail as a
discharge-refusal that preserves P4; closing the husk seam does NOT require pairing
reference sites across snapshots (no move proof).)
**Related:** LLP 0225 (core modularization — §2 dependency direction /
monotonic baseline / waiver rules and §5 enforcement protocol, which this
Decision amends), LLP 0199 (incremental core modularization, waiver blocking
rule OQ5), LLP 0189 (verification cadence and claim gating),
`issues/20260816-split-relocation-disposition-needs-sound-evidence.md` (the
motivating ticket and defeat history),
`issues/20260810-owngate-split-relocation-disposition-gap.md` (the original
edge-key-split gap), `scripts/check-module-ownership.mjs` (the enforcement arm
this design retargets)

---

## Summary

The ownership gate (`scripts/check-module-ownership.mjs`) must be able to
re-key a pre-existing forbidden-edge disposition — a frozen edge, an
`analyzer-upgrade` record, or a `time-bounded-waiver` — across a
fingerprint-changing transition (a god-file edge-key split, a module rename, or
an owner reassignment) **without** either (a) admitting unrelated new coupling
as if it were pre-existing, or (b) silently dropping the deadline and inversion
owner an obligation carries. Six successive designs were defeated. Five trusted
an *assertion* (endpoint equality, a manifest `extractedFrom` field, top-level
symbol-name overlap, or an owner label) or keyed the mandatory-discharge lookup
on the **successor** fingerprint. The sixth (round 2 of this Decision) tried to
**prove that a specific coupling *moved*** by pairing a delete-hunk at the
predecessor with a new appearance at the successor, counted as occurrence
multisets. Both round-2 review families defeated it with the same observation:
**two-snapshot occurrence identity is not causal transfer.** Clone-and-mutate
(edit the carrier at `G` by one token, paste its old bytes at `M`) yields
`del=1, new=1` and is admitted; a coincidental delete-at-`G` / add-at-`M`
is indistinguishable from a move; and a carrier edited in flight makes its
fingerprint vanish so "absence of the old fingerprint" reads as discharge while
the coupling lives on. **Trying to prove a move is the wrong frame.**

This Decision therefore stops proving movement. It enforces a **conservation
invariant** the launderer cannot satisfy, over exactly the data the gate already
computes: the set of §2-**forbidden edges** the analyzer resolves at each snapshot
(which drives the per-target count) and the **full resolved-reference edge set**
`analysis.edges` (forbidden, allowed, and same-owner — which powers the discharge
occurrence backstop), plus the obligations attached to them.

- **Obligation conservation, per target.** For each target module `T`, the pool
  of predecessor obligations pointing at `T` (each waiver's deadline + inversion
  owners, or a freeze) is conserved. While *any* forbidden coupling to `T`
  survives that the landing has not otherwise accounted for, the **strictest**
  outstanding obligations to `T` remain on the surviving edges — carried forward
  **verbatim**. An obligation leaves the baseline **only** when the count of
  forbidden couplings to `T` genuinely drops, and only the **weakest** obligation
  leaves; a strict deadline can never be shed while a coupling it could bind
  survives. This is computed from the two forbidden-edge sets plus the baseline,
  with **no inferred move locus, no byte-lineage, and no occurrence arithmetic as
  causal proof.**
- **Lineage is descriptive, not the discharge authority.** A record still names
  how an edge key relates to a predecessor (`lineage`), and this remains a
  useful, orthogonal field (it is what lets a relocated *waiver* still be
  escalated by its `obligation`). But lineage is **never** what discharges an
  obligation — the conservation counting is. A rename, an owner relabel, a
  trivial edit, or the mere disappearance of a fingerprint **never** discharges.

The governing principle is one sentence: **an obligation to a target is
discharged only when *every* coupling to that target from a predecessor-obligated
host has verifiably left the analyzer's resolved-edge set — forbidden, §2-allowed,
and same-owner alike — with nothing unaccounted, always shedding the weakest first;
lineage describes the re-key but never authorizes the discharge.** (An owner
relabel or a target rename leaves the coupling *in* the analyzer's edge set — merely
allowed, or re-keyed to the renamed target — so it has **not** left and cannot
discharge; §3.4/§3.6.) Under this
principle `split-relocation` is **not a new disposition** — it is the
`relocation` *lineage kind*, orthogonal to the *obligation* a record carries, and
the single conservation invariant governs whole-edge moves, edge-key splits,
renames, owner re-keys, and merges uniformly. It does **not** claim to *subsume*
a 1→N split into free inheritance: an honest split of one predecessor coupling
into `N` current forbidden edges is decided by the §3.2 count (`m = 1`, `k = N`) —
**one** successor carries the predecessor obligation and every surplus successor
needs its **own fresh attribution**, not an inherited clock (the round-3 overclaim
that "conservation subsumes edge-key splits" is trimmed; see §3.4).

---

## 1. Problem statement — the motivating adversary

The gate's disposition vocabulary is `analyzer-upgrade`, `relocation`, and
`time-bounded-waiver` (`FROZEN_DISPOSITIONS`, `check-module-ownership.mjs`
~line 28). An edge is identified by
`edgeFingerprint = "${from} (${fromOwner}) → ${to} (${toOwner})"` (~line 580),
so it changes whenever the `from`/`to` file path or either owner changes. A
god-file drainage routinely changes a fingerprint while the underlying coupling
is unchanged: code that carried `src/local.rs → T` moves into a new owned module
`M`, producing `M → T`. The pre-existing coupling is now keyed differently, but
it is *pre-existing*, not new — overloading `time-bounded-waiver` (reserved by
LLP 0225 §2 for genuinely new coupling) is dishonest, and the naive
`relocation` path is too weak. Every prior design shipped an unsound admission
or an unsound discharge and was defeated
(`issues/20260816-split-relocation-disposition-needs-sound-evidence.md`):

- **R1 — endpoint-assertion.** A retained frozen predecessor plus one shared
  endpoint admitted unrelated new coupling; and an *unchanged* fingerprint was
  allowed to switch disposition without entering the growth validator, silently
  shedding its deadline and inversion owner.
- **R2 — `extractedFrom`-assertion.** An unrelated pre-existing module added a
  manifest `extractedFrom` claim and was accepted as derived from the god file;
  separately, a standing waiver was reclassified as `analyzer-upgrade` and its
  obligation dropped.
- **R3 — name-only overlap + rename-launders-waiver.** Top-level symbol *name*
  overlap admitted unrelated lineage; and a rename made the old path-keyed
  fingerprint disappear while the mandatory-discharge lookup keyed on the
  **successor** fingerprint, so the predecessor waiver was invisible.
- **Codex confirm-review — owner-rekey-launders-waiver.** A deadline-bearing
  waiver kept its module endpoints but reassigned an owner and recorded a
  `relocation`; the exact-endpoint path never consulted the predecessor
  disposition and dropped the deadline and inversion owner.
- **Round-1 (this Decision) — existential content match.** Proving a move by
  *existential* carrier-fingerprint equality admitted a pre-existing identical
  destination carrier (import-plant), clone-and-mutate forgery, and fan-out
  replay, and let a trivial edit reset a live obligation into a fresh later
  waiver.
- **Round-2 (this Decision, both families) — the move proof itself is unsound.**
  Round 2 paired a delete-hunk `del(Gi,f,Ti) ≥ 1` with a new appearance
  `new(M,f,T) ≥ 1` under an injective ledger, believing occurrence multisets
  proved causal transfer. Both families produced the same defeat:
  **clone-and-mutate** — keep the carrier in `G`, change one token so `f` shifts,
  paste the *old* bytes into `M`: now `del(G,oldFp,T)=1` and `new(M,oldFp,T)=1`,
  one supply, one demand, **admitted**; the round-2 fixture N7 even miscalculated
  this as `del=0`. A **coincidental** delete-at-`G` / add-at-`M` is arithmetically
  identical to a move. And the round-2 discharge sentence ("no current forbidden
  edge bears any of `Pi`'s predecessor carrier fingerprints") is still
  absence-⇒-discharge: an **edited, wrapped, or analyzer-invisible** continuation
  makes the old fingerprint vanish and reads as discharge while the coupling
  survives; the "surviving-obligation guard" that was meant to backstop it
  depended on an undefined *move locus* and so did not fire.

Every defeat shares one root cause: **each tried to authorize a discharge (or an
admission) from a claim about, or a content coincidence with, the successor —
including two-snapshot occurrence identity, which is not causation.** The design
bar (Charlie's ruling) is therefore inverted: **stop authorizing discharges from
successor-side evidence. Discharge an obligation only when the analyzer's own
forbidden-coupling count to its target has verifiably dropped with nothing left
unaccounted, and always shed the weakest obligation first.**

---

## 2. Author-proxy decisions (ruled; not re-opened)

These decisions are Charlie's ruling and frame the model. Section 3 implements
them. Decisions 5–9 supersede the round-1/round-2 OQ rulings that the review
families identified as soundness holes rather than permissiveness knobs.

1. **Evidence standard = conservation over the analyzer's forbidden-edge set,
   not a proof of movement.** No re-key is admitted by proving a specific
   coupling *moved*. Instead, for every target `T`, the predecessor obligations
   to `T` are conserved against the current forbidden-edge set to `T` by the
   §3.2 counting invariant. Occurrence multisets, delete-hunks, byte-lineage, and
   git history may *bound* or *locate* but are **never** the discharge authority;
   file absence, a manifest field, declaration-name overlap, endpoint equality,
   existential content match, and two-snapshot occurrence identity are all
   insufficient.
2. **Predecessor-keyed obligation resolution.** Every record naming a predecessor
   resolves its obligation by looking up the **predecessor** fingerprint in the
   **predecessor** snapshot, never the successor's.
3. **Obligation is conserved and orthogonal to lineage.** A record carries two
   independent fields: a *lineage* field (how the edge key relates to a
   predecessor) and an *obligation* field (deadline + inversion owners, or none).
   Expiry/escalation keys on the obligation field, independent of lineage. **A
   lineage value never discharges an obligation** — only §3.2 conservation does.
4. **False-negative tolerance, but never a fresh clock and never a dropped
   deadline.** The proof must still admit legitimate god-file drainage (the
   standing `src/local.rs` waivers). Bias toward over-conserving: an unprovable or
   ambiguous transition over a **surviving** coupling **preserves** the strictest
   applicable predecessor obligation (carried forward verbatim, or the push
   blocks). It is **never** converted into a fresh waiver with a new deadline or a
   new inversion owner.
5. **Owner relabeling is not discharge; the discharge gate is an occurrence
   backstop over the analyzer's full resolved-reference edge set, not
   byte-identity (supersedes round-1 OQ1; closes Codex #4 and the round-4
   edited-owner-relabel / same-owner-collapse launders).** A pure owner-relabel —
   *even one paired with a trivial carrier edit* (`#[inline]`, `pub`, an extra
   statement, a `use`-tree rewrite) that shifts the fingerprint — does **not**
   discharge, and neither does collapsing both endpoints to one owner. Before any
   obligation to a target `T` is discharged, the gate scans the analyzer's **full
   resolved-reference edge set** (`analysis.edges`, ~line 594–628, which already
   contains **every** resolved edge — §2-forbidden, §2-allowed, *and* same-owner;
   only `to === from` self-edges are dropped) for **any current coupling from a
   predecessor-obligated host to `T`**. If such a coupling survives, the obligation
   is **carried/aggregated, never discharged** (§3.2/§3.4). This backstop reads the
   resolved `from`/`to` module pair directly and relies on **neither byte-identity
   nor `violationReason`** — decisive because a trivial edit defeats a byte-scan and
   `violationReason` returns `null` for both an allowed pair and a same-owner pair
   (`fromOwner === toOwner`, ~line 724), so a fingerprint scan or a forbidden-set
   scan would miss the surviving coupling. `owner-rekey` is **removed as a
   move/discharge lineage kind**; a coupling whose edge became §2-allowed or
   same-owner is retired **only** through the §3.7 author-authorized
   *ownership-correction* amendment. A worklist provenance sentence is an
   assertion, not a proof.
6. **Token-preserving carrier fingerprint over a *pinned* Rust AST (supersedes
   round-1 OQ2; closes Codex #6).** The carrier is an **item span over a pinned
   `syn` AST version** (not a new ad-hoc lexer and not brace-matching over masked
   text). The fingerprint encodes each token's **kind + exact bytes + punctuation
   jointness with explicit length framing**; doc comments (`///`, which Rust
   desugars to macro-visible `#[doc]` attributes) are **preserved as attribute
   tokens**, not silently dropped. Parse failure is **fail-closed** (a gate red).
   The `maskNonCode` mask (~lines 196–269) is **not** reused for fingerprinting.
   An edited-during-move carrier that is not token-identical is **unproven** — its
   obligation is preserved by §3.2/§3.4, never reset.
7. **Lineage is many-to-many; target identity pins *all* carriers; mixed-kind
   merge has `null` as its identity (closes Grok/Codex #5, #7).** Carriers are
   defined by the §3.1 grammar; a record's lineage names a **list** of
   predecessors; a **merge** aggregates obligations (strictest deadline + union of
   inversion owners; a `null` freeze is the aggregation **identity**, never an
   annihilator — waiver + freeze keeps the waiver); a **split** distributes them.
   Target-module identity is computed over the target's **OWN item fingerprints**
   (one consistent set — **never** the inbound forbidden-edge carriers, which a
   path-token rewrite would change) by the **total `L ⊆ S` leftover predicate**
   (§3.6) — **no similarity threshold** (a threshold is soundness-critical, not
   neutral: moving 80 boilerplate items while swapping the 20 definition-bearing
   ones would forge a target). A mixed rename+edit fails the `own ⊇ own(Ti)` match
   and either **blocks** on the live leftover or falls to conservation (the
   obligation is preserved).
8. **Discharge is a closed conservation pairing over a COMPUTED target identity —
   no locus, no git, no guess, no author claim (closes the core round-2 defeat and
   the round-4/round-5 `k = 0` cut).** Target identity is **computed, not claimed**,
   and the §3.6 **total `L ⊆ S` leftover predicate** runs **automatically** over the
   module's **own items** (not gated on a filed `module-relocation` record) on **every**
   `k = 0` discharge — **path presence never short-circuits the leftover computation on
   either endpoint** (a present `Ti`-path only places that path into `S`; the discharge
   still requires `|S| = 1 ∧ L ⊆ S`, and `own(Ti) = ∅ ⇒ S := ∅`) — computing the
   successor `T2`: `|S| = 1 ∧ L ⊆ S` carries, `S = ∅ ∧ L = ∅` is a
   genuine removal, and **every other case blocks** (ambiguous removal). The
   obligated **hosts** are resolved by the **same universal content-match +
   dual-leftover** rule (§3.6, `SH`/`LH`): a present host path is scanned, but a present
   **husk** (`own(path) ⊉ own(Gi)`) or an **absent** path computes `SH`/`LH`, and a
   moved-and-edited or split host whose live leftover survives **refuses the discharge**
   (never the genuine-removal branch). A leftover-fail / `|SH| ≠ 1` refuses only the
   `k = 0` **discharge**, not the landing — §3.4 byte-scan promotion still admits an
   honest merge (P4). An obligation may then leave the baseline only when **all** hold
   for its computed target `T`: (a) the current §2-forbidden-edge count to `T` dropped;
   (b) the strictest obligations are all still carried, weakest-first; (c) the
   decision-5 occurrence backstop finds **no** surviving coupling from any
   predecessor-obligated host to `T` in `analysis.edges` (forbidden, allowed, or
   same-owner); and (d) no byte-identical predecessor carrier survives — and a
   byte-scan **failure PROMOTES** the obligation back into the carried pool rather
   than discharging it (§3.4). There is no inferred move locus, no `git -M -C`
   heuristic, and no occurrence arithmetic standing in for causation. **The round-2
   fingerprint-absence-⇒-discharge rule is deleted entirely**, and byte-absence is
   never itself a discharge authority — only (a)+(b)+(c) authorize a discharge.
9. **Amendment authorization is anchored on the predecessor snapshot (closes
   Codex #4 / Grok #5).** An `ownership-correction`, `deadline-change`, or
   `lineage-change` amendment is valid **only** when its `authorization` names a
   Decision record (an LLP section or a signed record) that is **already present,
   with the authorizing clause, on the *predecessor* git snapshot** — checkable by
   `git cat-file` against the predecessor revision, unforgeable by editing the
   same push. §3.7 defines the exact check.

---

## 3. The sound model

### 3.0 What the gate already has

`loadRevisionSnapshot(revision)` (~line 763) already materializes the **full
source bytes** of every `src/**/*.rs` module at a named predecessor revision via
`git ls-tree` + `git show`, and `analyzeSources` (~line 584) already derives the
forbidden-edge graph (`forbiddenEdges`, ~line 823) from those bytes. The gate
therefore holds, in one process, both the predecessor forbidden-edge set and the
current one. The conservation invariant is built **entirely** from these two sets
plus the predecessor/current baselines; it needs **no new trusted input** and, for
the discharge decision, **no byte-lineage between the snapshots**. The only new
git read is the §3.7 predecessor-snapshot authorization check (a `git cat-file`
of a named `llp/**` record at the predecessor revision), which
`loadRevisionSnapshot` is extended to perform.

**Analyzer-relative soundness boundary (see §3.10).** Everything below is stated
over the analyzer's *resolved* forbidden edges. A coupling the analyzer cannot
resolve (an opaque helper, a proc-macro expansion, or a reference form
`extractModuleSyntax` does not record) is **not a forbidden edge** and is outside
this proof. Soundness is therefore **analyzer-relative**, and §3.10 states the
residual and the fail-closed option precisely. This is a pre-existing property of
LLP 0225's gate, not introduced here.

### 3.1 Carrier grammar and the token-preserving fingerprint

The atomic unit is a **carrier occurrence**: a concrete Rust *item* whose body
contains a reference site creating the coupling, together with its exact tokens.
The same §3.1 item fingerprint also fingerprints a module's **own** item nodes: for
any module `M`, `own(M)` is the multiset of §3.1 item fingerprints of every item `M`
defines. Carriers/`own`-sets are used to (a) compute target and host identity (§3.6,
over each module's **own** item fingerprints) and (b) power the §3.4 byte-scan; they
are **not** used to prove a coupling *moved*.

**Carrier span — a pinned AST, one deterministic rule (decision 6).** Parse the
module with a **pinned `syn` version** (recorded in the gate and in the fixture
harness; an unparseable file is a **gate red**, never silently skipped). The
**carrier** of a reference site is the **smallest enclosing item node** in the
`syn` item grammar. The item forms are exactly the `syn::Item` variants and their
nested associated/foreign items:

> `fn` (free, associated, foreign), `struct`, `enum`, `union`, `trait`,
> `trait` alias, `impl` (inherent and trait), `const` (free, associated,
> foreign), `static` (free and foreign), `type` alias (free, associated,
> foreign), `mod`-with-body, `extern` crate, `extern` block and every foreign
> item inside it, `use`, `macro_rules!` definition, `macro` (declarative
> macros 2.0), and a top-level **macro invocation used as an item**
> (`name! { … }` / `name!(…);` / `name![…];` at item position). A reference that
> exists **only inside a macro expansion** has **no source carrier**; per §3.10
> it is outside the analyzer boundary (the invocation item is the carrier of any
> path written in the *invocation's* token tree).

"Smallest enclosing" is item nesting: a reference in a method body has the
associated `fn` as its carrier (method granularity, so extracting one method from
a large `impl` is provable for target identity); a reference in an `impl` header
has the `impl`; a bare item-position `use` that is itself the reference site is
its own carrier; a nested `mod`'s inner item is its own carrier.

**Span content and fingerprint (decision 6).** The span runs from the first token
of the item's leading **outer attributes** through its terminating `}` or `;`
inclusive, and includes visibility and qualifiers (`pub`, `pub(crate)`, `unsafe`,
`async`, `const`, `extern "…"`, `default`). The **carrier fingerprint** is
`sha256` over a canonical serialization of the item's `syn` token stream in which
each token contributes a length-framed triple **⟨kind, byte-length, exact source
bytes⟩** and a **jointness flag** recording whether it was lexically joined to the
next token (so `Foo::Bar` and `Foo :: Bar` — identical — stay distinct from any
tokenization that would merge across a boundary). **Doc comments are preserved**:
`syn` desugars `///`/`/**` to `#[doc = "…"]` attribute tokens, which are
macro-visible and therefore load-bearing; they are serialized as the attribute
tokens they are, **not** discarded. Only *ordinary* (non-doc) comments and
inter-token whitespace are normalized away (reindent- and wrap-tolerant). Thus
`dispatch("read-only")` and `dispatch("admin")` fingerprint **differently** (the
round-1 masked-code collision is closed), two carriers differing only in a
load-bearing `#[doc]` fingerprint **differently** (the round-2 doc-drop collision
is closed), and adding `pub` or rewriting a `use`-path prefix **changes** the
fingerprint (an edited carrier is unproven, its obligation conserved by §3.2).

A **coupling occurrence** is `(carrierFingerprint, targetModule, hostModule)`.
Occurrences are counted as a **multiset**: `occ(rev, host, f, target)` is the
number of carrier items in `host` at `rev` with fingerprint `f` coupling to
`target`. Occurrence counts are used **only** to bound §3.6 target-identity proofs
and as a persisted anti-stockpile cap (§3.2, "Anti-stockpile"); they are **never**
used as causal move evidence.

### 3.2 The obligation-conservation invariant (the discharge authority)

This replaces the round-2 move proof. It authorizes every discharge and every
"genuinely-new" admission, per target, from the two forbidden-edge sets alone.

**Setup, per target identity `T`** (target identity `T ≡ Ti` is §3.6):

- `PredObl(T)` = the multiset of predecessor obligations whose forbidden edge
  pointed at `T`. Each predecessor forbidden edge `Gi → Ti` (with `Ti ≡ T`)
  contributes one element: its obligation `obl` read from the **predecessor**
  snapshot (predecessor committed baseline `frozen` map ∪ predecessor worklist
  waivers, keyed by the **predecessor** fingerprint — decision 2). A waiver
  contributes `⟨waiver, deadline, inversionOwners⟩`; a freeze / analyzer record
  contributes `⟨freeze⟩`. Let `m = |PredObl(T)|`.
- `CurEdges(T)` = the set of **current** forbidden edges `X → T`. Let
  `k = |CurEdges(T)|`.

**Strictness total order (which obligation is "weakest").** Order `PredObl(T)`
from strongest to weakest:

1. every **waiver**, by **earliest deadline first** (an earlier deadline is
   stronger — more teeth to preserve); ties broken by a stable key (inversion
   owners then predecessor fingerprint);
2. then every **freeze** (weakest — a freeze has no active escalation clock; a
   freeze on a genuinely removed coupling is ordinary §2 monotonic shrink).

So waivers are always preserved in preference to freezes, and stricter deadlines
in preference to laxer ones. (A freeze carried onto a surviving edge in place of a
discharged *waiver* would only ever make the gate **stricter**; conservation never
forces the reverse.)

**The invariant.** The landing is admitted for target `T` iff there exists an
assignment satisfying **all** of:

1. **Carry the strictest.** The `min(k, m)` **strongest** obligations in
   `PredObl(T)` each appear **verbatim** (§3.4 carry-forward: same kind, deadline,
   and inversion-owner set) as the `obligation` field of a **distinct** current
   forbidden edge in `CurEdges(T)`. If any of the strongest `min(k,m)` predecessor
   obligations is missing from the current edges' obligations, the push
   **blocks** — a strict obligation cannot be dropped or demoted while a coupling
   to `T` survives.
2. **Account for every current edge.** Every current edge in `CurEdges(T)` either
   (a) carries one of those verbatim predecessor obligations (it is a **carrier**),
   or (b) carries its **own fresh attribution recorded this landing** (a
   first-seen waiver/freeze with `deadline ≥ today` and its own reviewed worklist
   record) — it is **genuinely new**. The number of genuinely-new edges is exactly
   `max(0, k − m)`.
3. **Discharge only the weakest, and only when the coupling has verifiably left
   the analyzer.** The predecessor obligations **not** carried (there are exactly
   `max(0, m − k)` of them) must be the **weakest** `m − k` in the order above,
   **and** each must clear the §3.4 **occurrence backstop** *and* its byte-scan
   promotion check before it may discharge:
   - **Occurrence backstop (the `k = 0` gate).** For the target identity `T`
     (computed by §3.6's **universal** `L ⊆ S` predicate — **path presence never
     short-circuits**; a present `Ti`-path only enters `S`, and the discharge still
     requires `|S| = 1 ∧ L ⊆ S`, or a genuine removal `S = ∅ ∧ L = ∅`), gather the set
     of **predecessor-obligated hosts** `H(T)` = the `from` module of every predecessor
     forbidden edge in `PredObl(T)` (each host resolved by the §3.6 **symmetric
     content-match + dual-leftover host rule** — `SH`/`LH` over own-items; a present
     **husk** or an absent path computes `SH`/`LH`, and a moved-and-edited or split host
     whose live `LH` leftover survives **refuses the discharge** rather than resolving to
     `∅` and scanning the vanished old path).
     Scan the analyzer's **full resolved-reference edge set**
     `analysis.edges` (~line 594–628) for **any** edge `h → t` with `h ≡ some host
     in H(T)` and `t ≡ T`. Because `analysis.edges` retains every resolved edge —
     §2-forbidden, §2-allowed, **and** same-owner (`fromOwner === toOwner`, for
     which `violationReason` returns `null`) — this backstop sees a surviving
     coupling that a forbidden-set scan or a `violationReason` test would miss. **If
     any such occurrence survives, the obligation is NOT discharged.** If the
     surviving occurrence is itself a current forbidden edge to `T`, the obligation
     is **carried** onto it (this is the ordinary `k ≥ 1` case); if the survivor is
     only §2-allowed or same-owner (no forbidden edge exists to hold the record),
     the push **blocks** pending a §3.7 `ownership-correction` amendment — a live
     analyzer-visible coupling can never be silently dropped.
   - **Byte-scan promotion (defense-in-depth for host-moving merges).** Even when
     the occurrence backstop is clear (the obligated host itself moved, so no
     `h → T` edge remains), the gate scans all current occurrences for a
     **byte-identical predecessor carrier** of the coupling. A surviving carrier
     **PROMOTES** the obligation back into this target's carried/aggregated pool for
     §3.2 assignment (it admits the honest merge P4 — the moved carriers reappear
     verbatim in `M` and aggregate onto `M → T` — and preserves fresh-attribution
     N8 — promotion carries the **one** obligation and any surplus successor still
     needs its own attribution). **Promotion is never a discharge path and never
     manufactures a fresh clock**; a byte-scan *clear* likewise never *authorizes* a
     discharge — only the count drop (a), the weakest-first order (b), and the clear
     occurrence backstop above jointly authorize it.

   An obligation that the occurrence backstop or the byte-scan promotes may **not**
   be discharged even when `k < m`; the push blocks or the obligation carries.

Because the assignment is fully determined by the multiset of obligations present
on current edges to `T` versus `PredObl(T)`, the gate **computes** carrier-vs-new
rather than trusting any author label. An author who mislabels (calls a carrier
"new," or files a fresh clock where a strict obligation must be carried) produces
a multiset mismatch and the push blocks.

**Why this defeats the round-2 launders without a move proof.**

- **Clone-and-mutate.** Keep the carrier in `G` (edited, still coupling to `T`)
  and paste old bytes into `M`. Both `G → T` and `M → T` are current forbidden
  edges, so `k = 2 ≥ m = 1`: the one predecessor obligation must be carried by one
  of them and the **other needs its own fresh attribution**. There is no free
  inheritance and no discharge (the coupling to `T` never left). No occurrence
  arithmetic is consulted, so the round-2 `del` confusion cannot arise.
- **Edited-in-flight / helper-wrap.** The coupling to `T` survives as a current
  forbidden edge (`M → T` or the wrapper `H → T`). `k ≥ m`, so the strict
  obligation is carried **verbatim**; a fresh later deadline is refused. No move
  locus is needed — the surviving edge is simply counted.
- **Two-push copy-then-delete.** Push 1 (copy to `M`, leave `G`, file a fresh
  waiver `D'` on `M → T`): `k = 2, m = 1`; `G → T` carries the strict `D`, `M → T`
  is genuinely new with its own review — admitted honestly. Push 2 (delete `G`):
  now the predecessor pool to `T` is `{D, D'}`, `m = 2`, and `CurEdges(T) = {M→T}`,
  `k = 1`. One obligation may discharge, and it must be the **weakest**. If the
  launderer made `D'` later than `D`, `D'` is the weakest and is discharged, and
  `M → T` must carry the **strict `D`** verbatim. **The launderer's later deadline
  is the one that leaves; the strict deadline survives on the surviving coupling.**
- **Occurrence stockpile.** Cloning a carrier many times inside one host does not
  change the edge set (`G → T` is one edge regardless of how many carriers it
  holds), so it manufactures no budget. Distributing clones across `M1…Mn` on a
  later push creates `n` current edges; with `m` predecessor obligations, at most
  `min(n, m)` are carried and the surplus `n − m` **each need their own fresh
  attribution**. One waiver can never become `n` waivers.
- **Mixed-edge piggyback.** A valid moved carrier `a` and an unrelated new carrier
  `b`, both landing in `M` and both coupling to `T`, are the **same** edge `M → T`
  (edges are keyed by host/target/owners, not per-carrier). `M → T` carries the
  predecessor obligation; `b` gains nothing it would not already inherit, and a `b`
  that couples to a **different** target `U` is a separate edge `M → U` that must
  get its own attribution.
- **Multi-predecessor obligation drop.** Two predecessor waivers to `T` with
  deadlines `D1 < D2` are both in `PredObl(T)` regardless of which the author
  names in `lineage`. If only one current edge to `T` survives, invariant (1)
  forces the **strict `D1`** onto it; naming only `P2` in `lineage` cannot drop
  `D1`, because conservation is computed over `PredObl(T)`, not over the author's
  predecessor list.
- **Edited owner-relabel (round-4 codex).** Predecessor forbidden `service-A →
  service-B` carrying `D1`. Current: relabel `service-A` to an owner allowed to
  depend on `service-B` (or collapse both to one owner) **and** add a trivial token
  so the fingerprint shifts. `CurEdges(service-B) = ∅` ⇒ `k = 0`. But `service-A`
  is a predecessor-obligated host and `analysis.edges` still contains the resolved
  edge `service-A → service-B` (now §2-allowed, or same-owner with
  `violationReason = null`). The occurrence backstop finds it and **refuses the
  discharge**; with no surviving forbidden edge to carry `D1`, the push blocks
  pending a §3.7 `ownership-correction` amendment. The trivial edit is irrelevant
  (the backstop is not a byte-scan) and the same-owner collapse is caught (the
  backstop is not `violationReason`).
- **Target-rename without a record (round-4 grok).** Predecessor waiver `D1` on
  `G → src/foo.rs` (`Ti`). Current, one landing: `git mv foo.rs → bar.rs`, `mod
  foo → mod bar`, every source site `crate::…::foo:: → crate::…::bar::`, and **no**
  `module-relocation` record; `src/foo.rs` is absent. §3.6 computes identity over
  **own items**: the site rewrites live in the *hosts*, not in `foo`'s own item
  bodies, so `bar`'s own items are byte-identical to `foo`'s ⇒ `own(bar) ⊇ own(foo)`
  ⇒ `S = {bar}`; the obligated host `G` now has the resolved edge `G → bar` (a **new**
  target of `G` carrying `foo`'s items) ⇒ `L = {bar}`; `|S| = 1 ∧ L ⊆ S` ⇒ `T2 = bar`,
  `PredObl(foo)` pools onto `G → bar`, `k = m = 1`, and `D1` is carried **verbatim**.
  Were the definition-bearing items swapped at `bar` (N13 80/20), `own(bar) ⊉ own(foo)`
  ⇒ `S = ∅`, but the live leftover `L = {bar} ≠ ∅` ⇒ §3.6 **BLOCKS** (ambiguous
  removal). Either way `D1` cannot be shed while the coupling is live and
  analyzer-visible on the renamed `to` endpoint — closing the exit revision c left
  open on `to`.

**Anti-stockpile persistence (decision 7, defense-in-depth).** Although the
per-target edge count already defeats stockpiling, the frozen record additionally
persists, per target `T`, the count `k` of forbidden edges to `T` it was written
against (a **cap**, not a lineage). `--update-baseline` recomputes it; a later
push whose `PredObl(T)` exceeds the persisted history is refused as a manufactured
pool. This bound is explicitly **non-causal**: it only ever *limits* admissions.

**Git history is a locator, never evidence.** `git log --follow -M -C`,
`git blame`, and `git patch-id` may *find* moved lines to help a human author write
a record, but no discharge or admission is authorized by them; the normative
authority is the conservation counting above.

### 3.3 Orthogonal record model: `lineage` and `obligation`

The single `disposition` enum is replaced by **two orthogonal fields** (decision 3;
preserved from round 2):

```
record = {
  fingerprint,                       // the edge this record governs (S)
  lineage:    { kind, predecessors } | null,
  obligation: { kind, deadline, inversionOwners } | null,
  observationRevision, worklist, provenance,   // as today (~lines 646–648)
}
```

- **`lineage.kind ∈ { relocation, split, merge, module-relocation }`** and
  `lineage.predecessors` is a **list** of predecessor fingerprints (a rename or
  whole-edge move has one; a `merge` has N; a `split` successor names the one
  predecessor it drew from). `lineage: null` means the edge is newly recorded at
  this key with no predecessor. **`owner-rekey` is not a lineage kind** (decision
  5): an owner relabel that keeps the edge forbidden is an ordinary carried edge
  handled by §3.2; a relabel that makes the edge allowed is discharged only by a
  §3.7 amendment. Lineage is **descriptive** — it records the re-key for auditing
  and lets a relocated *waiver* remain escalatable — but it is **never** the
  discharge authority (§3.2 is).
- **`obligation.kind ∈ { time-bounded-waiver }`** with `deadline` (YYYY-MM-DD) and
  **`inversionOwners`** (a non-empty set of real owners). `obligation: null` means
  frozen / analyzer-discovered with no live deadline. The obligation is the *only*
  field expiry/escalation reads.

**How the existing gate logic changes.** Today `FROZEN_DISPOSITIONS` is a
three-value enum and every predicate branches on `attribution.disposition === …`
(`validateAttribution` ~643–661; the growth loop ~899–934;
`waiverFingerprints` / `expiredWaiverFingerprints` ~829–841). Under the orthogonal
model:

- `validateAttribution` validates `lineage` and `obligation` **separately**: a
  `relocation`/`split`/`merge`/`module-relocation` lineage requires a non-empty
  `predecessors` list; a `time-bounded-waiver` obligation requires a
  future-or-today `deadline` **for a first freeze** and a non-empty
  `inversionOwners`; a record may carry **both**. It also enforces the shape rules
  the review flagged: `obligation != null ⇒ kind === 'time-bounded-waiver'` with a
  well-formed `deadline` and non-empty `inversionOwners`; a bare `deadline` with an
  absent `obligation.kind` is rejected.
- `expiredWaiverFingerprints` / `waiverFingerprints` filter on
  `record.obligation?.kind === 'time-bounded-waiver'` — **independent of
  `lineage`** — so a relocated or merged waiver is still escalated (the exact fix
  for the round-1 expiry-vs-lineage contradiction). The **expiry scan domain is
  every current baseline obligation**, not only whichever worklist records parsed.
  Expiry escalation deliberately reads **retained past deadlines** (it is what
  escalation is *for*); the future-or-today check in `validateAttribution` applies
  to a **first** freeze of a new waiver, not to escalation of a standing one.
- The `analyzer-upgrade` and `frozen` states become `lineage`/`obligation`
  shapes: an analyzer discovery is `lineage: null, obligation: null` on an edge the
  analyzer newly *resolves* at the predecessor (the ~914–918 predicate is retained
  as a lineage-`null` admissibility rule); a plain freeze is likewise
  `obligation: null`. An analyzer-upgrade and a plain freeze both serialize as
  `null/null`; to keep them reconcilable, the record carries an explicit
  `obligation.origin ∈ { freeze, analyzer-upgrade }` discriminator that the §3.5
  intersection walk compares field-for-field.

**Predecessor-keyed obligation resolution (fixes rename/owner-rekey launder).**
The gate resolves each predecessor's obligation by looking up that **predecessor**
fingerprint in the **predecessor snapshot's** disposition set, keyed by the
predecessor string. It **must never** substitute a lookup of the successor
fingerprint `S` in the current set (the defeated `worklistRecords.get(successor‑
Fingerprint)` returned nothing after a rename/rekey).

### 3.4 Carry-forward, and the one way an obligation leaves

**Carry-forward is verbatim (no reset).** When §3.2 requires a predecessor
obligation `obl(Pi)` carried onto a current forbidden edge `S`, `S.obligation`
MUST equal `obl(Pi)` field-for-field: same kind, the **verbatim** `deadline`, and
the **same set** of `inversionOwners`. A relocation, rename, edit, or owner
relabel may re-key a waiver but never drops it, never demotes it to `null`, and
never alters the deadline or owners. A deliberate deadline change is possible
**only** through the §3.7 amendment protocol.

- **Merge (N predecessors carried onto one `S`).** `S.obligation` is the
  aggregation of the merged obligations: **`null` is the identity** — merging any
  set that contains at least one waiver yields a waiver whose `deadline` is the
  **strictest (earliest)** present and whose `inversionOwners` is the **union**;
  merging all-`null` yields `null` (a freeze). A waiver is therefore **never**
  annihilated by a `null` co-predecessor (closes Codex #7 / Grok mixed-merge).
- **Split (one predecessor coupling becomes N current forbidden edges).** This is
  **not** free inheritance onto all `N` (the round-3 overclaim is trimmed). §3.2's
  per-target count governs it directly: with `m = 1` predecessor obligation and
  `k = N` current forbidden edges to `T`, exactly **one** successor carries `obl(Pi)`
  verbatim and each of the other `N − 1` needs its **own fresh attribution recorded
  this landing** (invariant 2). An honest 1→N split therefore costs `N − 1` fresh
  reviewed records, not one inherited clock replayed `N` times; the `split` lineage
  is descriptive only. (The verbatim carry-forward above still forbids demoting or
  re-dating the one inherited obligation.)

**An obligation leaves the baseline in exactly ONE way — conservation discharge
(§3.2) — proven, never asserted.** The current §2-forbidden-edge count to the
computed target `T` dropped, the departing obligation is among the **weakest**
`m − k`, and it clears **both** the occurrence backstop and the byte-scan promotion
below. This is the *only* exit, and it always sheds the weakest.

**Proven inversion is subordinated, not a second exit (closes Codex #4).** Round-3
codex showed that treating "proven inversion" as an *independent* way out lets it
drop a **strict** deadline: with predecessors `P1(D1)` and `P2(D2 > D1)`, rewriting
only `P1` downward would, as a standalone exit, retire `D1` while `P2 → T` survives
— the opposite of §3.2, which must keep `D1` on the surviving edge and shed the
**weakest** `D2`. Proven inversion is therefore **not** an exit; it is merely
**evidence presented to §3.2** that one obligated host's coupling to `T` no longer
produces a forbidden edge, i.e. it lowers `k` by one. §3.2 then decides, over the
whole pool, **which** obligation (always the weakest) actually leaves. An inversion
that removes a coupling can never choose to retire a strict deadline while a laxer
one's coupling survives.

**Occurrence backstop + byte-scan promotion (the `k = 0` gate; closes the
owner-relabel and target-rename launders).** Before any would-be-discharged
obligation to `T` leaves, both checks of §3.2 invariant 3 run, in order:

1. **Occurrence backstop over `analysis.edges` (primary).** Scan the analyzer's
   full resolved-reference edge set for **any** edge from a predecessor-obligated
   host `h ∈ H(T)` to `T` (target identity and **host** identity both per §3.6's
   **universal** rule, over each module's **own** item fingerprints, **no path-presence
   short-circuit on either endpoint**; the host resolution is the **symmetric
   content-match + dual-leftover** `SH`/`LH` — a present **husk** or an absent path
   computes `SH`/`LH`, and a moved-and-edited or split host whose live `LH` leftover
   survives **refuses the discharge** rather than resolving to `∅` and scanning the
   vanished old path; a leftover-fail refuses only the `k = 0` discharge, not a `k ≥ 1`
   landing).
   `analysis.edges` already carries every resolved edge — §2-forbidden, §2-**allowed**,
   and **same-owner** — so this scan sees a surviving coupling that a forbidden-set
   scan or a `violationReason` test (which returns `null` for both allowed and
   same-owner pairs, ~line 724) would miss. **`violationReason` clause.** Same-owner edges
   (`fromOwner === toOwner`) are `null` (allowed) with **one exception**: an
   `unassigned → unassigned god-file` edge stays **forbidden** with a non-`null` reason
   (~lines 725–727). That exception needs no special-casing here: a forbidden survivor is
   in `forbiddenEdges`, so `CurEdges(T) ≠ ∅`, `k ≥ 1`, and §3.2 conservation **carries**
   the obligation onto it — the discharge branch is never reached. **Any surviving `h → T`
   occurrence blocks the discharge**: the obligation is carried onto the surviving forbidden
   edge if one exists, else the push blocks pending a §3.7 amendment. This closes
   the edited-owner-relabel and same-owner-collapse shapes (the coupling is still a
   resolved edge, merely allowed), the target-rename shape (the coupling moved with
   the target to the computed `T2`), the **obligated-host rename+edit** shape (the
   moved host is resolved by `SH`/`LH`, so its live `h2 → T` edge can never be missed by
   scanning the old host path, N19), **and the obligated-host husk** shape (a stub left
   at the old host path fails `own(path) ⊇ own(Gi)`, so `LH` is computed and finds the
   live `h2 → T` leftover, N20), **without** relying on byte-identity or
   `violationReason`.
2. **Byte-scan promotion (secondary, for host-moving merges).** When the obligated
   host itself moved (no `h → T` edge remains), scan all current occurrences for a
   **byte-identical predecessor carrier**. A surviving carrier **PROMOTES** the
   obligation back into `T`'s carried/aggregated pool for §3.2 assignment (admits
   P4, preserves N8); it never discharges and never mints a fresh clock. A byte-scan
   *clear* is **not** an authority — it is at most non-blocking corroboration; only
   §3.2 invariant 3(a)+(b) plus a clear occurrence backstop authorize a discharge.
   The round-2 fingerprint-absence-⇒-discharge rule stays **deleted** (decision 8).

A coupling whose edge became §2-allowed or same-owner via an owner relabel is
retired **only** by a §3.7 `ownership-correction` amendment (decision 5).

The defeated `removed.includes(priorFingerprint)` check (~line 923) and the
owner-pair retention check (~lines 929–932) are replaced by §3.2 conservation, the
occurrence backstop, and the byte-scan promotion. There is **no move-locus
computation** anywhere in the discharge path.

### 3.5 Full reconciliation: growth, removed, and the intersection

The round-2 model and the live gate walk only baseline **growth** (~line 889) and
**removed** (~line 892); a **retained (intersection) fingerprint** is never
reconciled, so its worklist record could be swapped, and `--update-baseline`
*prefers the current worklist* (`baselineDocument` ~lines 1016–1024). Both are
closed by reconciling **every** baseline member. This walk is **preserved from
round 2** and strengthened to compare the **full record** (closing the Codex
intersection note).

Partition into `growth = current − predecessor`, `removed = predecessor − current`,
and `intersection = current ∩ predecessor`.

- **Growth `F`.** Needs an explicit reviewed worklist record; its role
  (carrier-of-a-predecessor-obligation vs genuinely-new) and its `obligation` are
  decided by §3.2 conservation for `F`'s target, and its `lineage` (if any) is
  validated descriptively.
- **Removed `F`.** The predecessor obligation on `F` enters its target's
  `PredObl(T)` (target identity computed per §3.6) and is resolved by §3.2
  conservation + the §3.4 occurrence backstop: carried onto a surviving edge (or
  promoted by the byte-scan), or discharged (weakest, count dropped, backstop clear),
  or the push blocks.
- **Intersection `F` (immutable retained record).** Let `Prec`/`Crec` be the
  predecessor/current records for `F`. The gate requires the records to be
  **equal as full records** except for the intentionally-mutable provenance
  bookkeeping: specifically `Crec.lineage` (kind **and** `predecessors` list),
  `Crec.obligation` (kind, `deadline`, `inversionOwners` as a set, and `origin`),
  and `Crec.observationRevision`/`worklist`/`provenance` must all match `Prec`
  field-for-field — i.e. a retained member is **frozen in full**, so a manually
  edited baseline that swaps predecessors, provenance, worklist, or observation
  revision while keeping `lineage.kind` is refused.
  **Strengthen-only exception (point 4; makes N9b the algorithm, not a
  contradiction).** Conservation may **strengthen** a retained record **without** a
  §3.7 amendment: when §3.2 must move a stricter obligation onto an intersection
  edge that currently carries a weaker one (e.g. the two-push copy-then-delete N9b,
  where deleting `G` forces the strict `D1` onto the retained `M → T` that held the
  laxer `D'`), the gate **overwrites the retained record with the stricter
  obligation** (earlier deadline, and/or a union of inversion owners) and admits it.
  A change is a *strengthening* iff the new deadline is `≤` the old **and** the new
  `inversionOwners ⊇` the old; any **weakening** (later deadline, dropped owner,
  demotion to `null`) remains refused except by a §3.7 amendment. So an intersection
  record is immutable **downward** but conservation may tighten it **upward**.
  Enforced in a **retained-member walk** alongside
  the growth loop, and `--update-baseline` must, for an intersection `F`, **carry
  the predecessor record forward** (strengthened by conservation where §3.2 requires
  it) rather than prefer the current worklist.

Reconciliation is total: **every** fingerprint in `predecessor ∪ current` lands in
exactly one case and is checked.

### 3.6 Many-to-many lineage and non-circular target identity

**Predecessor lists.** `lineage.predecessors` is a list: a **merge (N→1)**
aggregates obligations per §3.4 (`null`-identity, strictest deadline, union of
owners); a **split (1→N)** is governed by the §3.2 count (one successor carries the
obligation, each surplus successor needs its own fresh attribution — *not* the
full obligation replayed onto every successor, per the §3.4 trim). In both cases
§3.2 conservation over the shared target is the authority — the lineage list is
descriptive and cannot itself drop or replicate an obligation.

**Deterministic multi-Git-predecessor join (closes Codex #5).** The live protocol
accepts several predecessor revisions (`--predecessor` may repeat; a Git merge has
multiple parents). Revision c defined a singular predecessor pool; revision d makes
the join **deterministic and over-blocking**: `PredObl(T)` is the **union across all
predecessor snapshots** of each snapshot's obligations to `T` (deduplicated by
`{predecessor fingerprint, obligation}`), and each surviving current edge must carry
the **strictest** obligation any predecessor imposed (deadline `= min` across
predecessors, `inversionOwners = ∪`). Comparing predecessors independently and
taking the **AND** (a discharge is authorized only if **every** predecessor pool
authorizes it; a carry is forced if **any** predecessor pool requires it) can never
drop an obligation one parent carried — divergent parents **over-block** (the push
blocks) rather than let a launderer pick the lenient parent. This is the same
strictest-wins/union rule §3.4 uses for a single-snapshot merge, lifted across Git
parents.

**Target-module identity is COMPUTED over the module's OWN items — one set, a total
`L ⊆ S` leftover predicate, symmetric across both endpoints (decision 7/8; closes the
round-4 record-less rename, the round-5 husk / parked-copy decoy, the obligated-host
rename+edit, and the §3.6 witness-set inconsistency).** The launderer never *claims*
`T2 ≡ Ti`; revision c's identity rule only fired when an author **filed** a
`module-relocation` record. Revision e makes identity a **computed property of the two
git trees plus `analysis.edges`**, over **one consistent fingerprint set** and a
**total** predicate.

**The one identity set — a module's OWN items.** For any module `M` at a snapshot,
`own(M)` (§3.1) is the multiset of §3.1 item fingerprints of **`M`'s own item nodes**
(every item `M` defines), **not** the fingerprints of the inbound carriers that
produced forbidden edges *to* `M`. This single set is used everywhere below. *(The
revision-c/d "carriers of forbidden edges to `Ti` reappear at `T2`" phrasing — Decision
7 / the old case 2 — is **deleted**: an honest `git mv foo → bar` with `foo:: → bar::`
site rewrites changes every **inbound-carrier** fingerprint, so a carriers-of-edges-to
reading would fail and wrongly BLOCK the honest N16, while leaving `bar`'s **own** items
byte-identical. The own-items reading is the correct and only one; it also never
recursively invokes the edge proof, so the round-1 circularity stays closed.)*

**Target identity is UNIVERSAL — always compute `S` and `L`, NEVER short-circuit on
path presence (closes the husk AND the same-path parked copy on the target endpoint).**
Revision e set `T ≡ Ti` directly whenever `Ti`'s path was present with a content match,
**without computing `L`** — the fast-path both round-5 families defeated: a byte-identical
copy parked at the original `Ti`-path (`own(foo) ⊇ own(foo)`) won identity while the real,
edited API moved to `bar`, so `L` never fired and `D1` discharged on the now-`k = 0`
`foo`. Revision f **deletes that short-circuit**. On **every** `k = 0` discharge, compute —
from the two git trees and `analysis.edges` alone, over **one consistent fingerprint set**
(each module's OWN items):

- `S = { current modules M : own(M) ⊇ own(Ti) }` — the candidate successors, by an
  occurrence-matched superset (a locator-grade check bounding one deletion to one
  reappearance — **no similarity threshold**, since moving 80 boilerplate items while
  swapping the 20 definition-bearing ones must not forge a target). **Special case:
  `own(Ti) = ∅ ⇒ S := ∅`** — an empty/trivial predecessor target makes `own(M) ⊇ ∅` hold
  for *every* module, so the superset test is vacuous; pin `S := ∅` (over-block) rather
  than let every module qualify.
- `H(Ti)` = the predecessor-obligated hosts (§3.2), each resolved to a current host by
  the **symmetric host rule** below;
- `L = { current module t : some edge h → t ∈ analysis.edges with h ∈ current-H(Ti),
  and t is either a **NEW target** of h (no predecessor edge h → t) **or**
  own(t) ∩ own(Ti) ≠ ∅ }` — the live couplings from an obligated host that could be the
  moved reference to a relocated `Ti`.

Then, **totally** over `(|S|, L ⊆ S)`:

1. **`|S| = 1` AND `L ⊆ S`** ⇒ `T2` = the unique member of `S`; `PredObl(Ti)` pools onto
   edges to `T2`; continue with §3.2. `T2` **may be `Ti`'s own path** — this is the
   ordinary same-path carry when nothing moved (`S = {foo}`, `L = ∅` or `L = {foo} ⊆ S`,
   honest N16 `S = L = {bar}`, `k = m = 1`, carry `D1` verbatim).
2. **`S = ∅` AND `L = ∅`** ⇒ **genuine removal**; §3.2 discharges weakest-first (P7: a
   pre-existing `G → other` is **not** in `L` — `other` is neither a new target nor
   carries `Ti`'s items — so `G`'s unrelated edges never block the honest removal).
3. **otherwise ⇒ BLOCK** (ambiguous removal). Husk-with-edit: `S = ∅`, `L = {bar}` ⇒
   block. Parked-copy identity-sink (byte-identical decoy at `unused_foo`, edited real
   API at `bar`): `S = {unused}`, `L = {bar}`, `L ⊄ S` ⇒ block. **Same-path parked copy**
   (the round-5 target fast-path: byte-identical copy left at the original `foo`-path,
   edited real API at `bar`): `S = {foo}`, `L = {bar}`, `L ⊄ S` ⇒ **block** (N18b). N13
   80/20 swap: `S = ∅`, `L = {bar}` ⇒ block.

**Path presence is NOT a short-circuit on the target endpoint; a leftover coupling to a
module outside `S` is fail-closed.** A present `Ti`-path with a content match merely
places that path **into `S`** as one candidate; the discharge still requires
`|S| = 1 ∧ L ⊆ S`, and `L` is **always** computed. Because `S` is over own-items and `L`
is checked **after** `S`, a decoy that makes some *wrong* module (or the parked original
path itself) win the `own ⊇ own(Ti)` test cannot discharge — the live leftover `L` points
at the real successor `bar ∉ S`, and the push blocks. Identity is never short-circuited by
path presence (husk), by a single full match (parked copy), nor by a byte-identical copy
at the original path.

**Symmetric fail-closed host identity — UNIVERSAL, no path-presence short-circuit
(closes the obligated-host husk, the round-6 hole).** Revision e's host rule scanned a
present host path **directly, with no content-match requirement**, and only computed a
successor set when the path was **absent**. That is exactly the target-side fast-path,
transplanted: a stub left at the old host path (`service_a`) was scanned (finds nothing)
while the live `service_a2 → service_b` edge sat in `analysis.edges` unexamined, so `D1`
discharged. Revision f gives the host endpoint the **same content-match + dual leftover**
the target endpoint has. The occurrence backstop's `H(T)` resolves each
predecessor-obligated host `Gi`, **discharge-only**:

- **Always scan a present host path** in `analysis.edges` — a partially-drained god-file
  is still its own host, so an honest drain (`P1`/`P4`) and an in-place edited host that
  still couples to `T` (N14 kept at its path) are scanned as-is. **But a present-path scan
  is trusted as the SOLE host backstop only when the present path is genuinely `Gi`**
  (`own(path) ⊇ own(Gi)`; special case `own(Gi) = ∅ ⇒ SH := ∅`). This host **content-match
  gate is NOT a path-presence short-circuit**, and it is safe for a precise reason: it
  fires only when `own(path) ⊇ own(Gi)`, i.e. the **coupling-bearing items are still present
  at that path**, so a live obligated coupling **cannot hide behind it** — the direct scan
  sees the real `Gi → T` edge if it survives (N14). It is the *content* of the path, not its
  mere *presence*, that authorizes the direct scan. A **husk** — `own(path) ⊉ own(Gi)`, the
  items replaced — **fails** the gate and falls through to `SH`/`LH` (N20). If the present
  path **fails** `own(path) ⊇ own(Gi)` (a husk/stub) **or** the path is **absent**, compute —
  symmetric to `S`/`L`:
  - `SH = { current modules M : own(M) ⊇ own(Gi) }` (same special case
    `own(Gi) = ∅ ⇒ SH := ∅`);
  - `LH = { current host h : some edge h → T ∈ analysis.edges, and h is either a
    **NEW source** of edges to `T` (no predecessor edge h → T) **or**
    own(h) ∩ own(Gi) ≠ ∅ }`.
- **`|SH| = 1 ∧ LH ⊆ SH`** ⇒ `H2` = the unique member of `SH`; the backstop **also** scans
  `H2 → T` in `analysis.edges` (a **clean** host `git mv` resolves here — `SH = {H2}`,
  `LH = {H2} ⊆ SH` — and its live `H2 → T` edge is found and blocks/carries).
- **`SH = ∅ ∧ LH = ∅`** ⇒ no leftover host survives; the present-path scan (if any) is the
  backstop (P6 in-place invert; P7 host still present, `S = L = ∅` on the target).
- **otherwise** (`|SH| ≠ 1`, or a leftover host in `LH` outside `SH`) ⇒ **refuse the
  `k = 0` DISCHARGE** (a discharge refusal, **not** a landing veto — see the next
  paragraph). **N20** (N19 + a present stub at `src/service_a.rs`): the stub fails
  `own(stub) ⊇ own(service_a)` ⇒ compute `LH`; `service_a2 → service_b` is a **new source**
  of edges to `service_b` (and `own(service_a2) ∩ own(service_a) ≠ ∅`) ⇒ `LH = {service_a2}`,
  while the `#[inline]` edit breaks `own(service_a2) ⊇ own(service_a)` ⇒ `SH = ∅` ⇒ refuse
  discharge. The genuine-removal branch (`SH = ∅ ∧ LH = ∅`) is **never** reached while a
  live `h → T` leftover exists, so the vanished-old-path launder is closed on the host
  endpoint too.

**Leftover-fail / `|SH| ≠ 1` is a DISCHARGE refusal, NOT a push veto (P4 safety).** A
host-leftover failure refuses only the `k = 0` **discharge** of `PredObl(T)`; it never
vetoes a landing outright. The §3.4 **byte-scan promotion** still runs: when the honest
merge P4 moves hosts and the carriers reappear **verbatim** in `M` (`own(M) ⊉ own(G1)`, so
`SH = ∅`), the obligation is **PROMOTED** onto a surviving forbidden edge and the landing
**ADMITS** via §3.2. Only when `k = 0` **and** nothing promotes **and** no forbidden edge
survives to carry the obligation does the push **BLOCK** (N19/N20). A `k ≥ 1` landing is
**never** vetoed by the host-leftover rule — its obligation is simply carried onto the
surviving forbidden edge (`P1`, N14).

**The "genuine re-owning" sentence is DELETED (it authorized the N20 tree).** Revision e
called an obligated host that stopped coupling to `T` while a new, differently-owned module
now couples to `T` a "genuine re-owning, not a launder." That sentence is **removed** — it
is exactly the husk-host miss: a present husk host with the live coupling moved to a new
allowed/same-owner host `H2` would discharge under it (N20). A `k = 0` re-home to a new
allowed module is **not** auto-authorized: `H2 → T` lands in `LH` (a new source of edges to
`T`), the discharge is refused, and retiring the obligation requires a §3.7
`ownership-correction` grant. This case is **not** in the positive matrix; Decisions 4/5
already prefer over-block to a silent clock drop. Owner labels are never part of identity
(decision 5).

**Evaluation order (NORMATIVE — no path-first short-circuit, no circularity).** An
implementer MUST evaluate identity in this fixed order. It is a **specification ordering,
not a circularity**: `S`/`SH` read **own-items only** (never an edge set), and `L`/`LH`
read the **resolved** `H`/`T`, so each quantity is defined before it is used.

1. Compute `S = { M : own(M) ⊇ own(Ti) }` and, for each obligated host `Gi`,
   `SH = { M : own(M) ⊇ own(Gi) }` — **own-items only**, from the two trees; **no edge set
   is consulted** (special cases `own(Ti) = ∅ ⇒ S := ∅`, `own(Gi) = ∅ ⇒ SH := ∅`).
2. **Resolve each host `H`** from a **present content-match** (`own(Gi-path) ⊇ own(Gi)`)
   **OR** a **unique `SH`** (`|SH| = 1`); if neither holds, the host is **unresolved**.
3. Compute `L` from the **resolved `H`** (`current-H(Ti)`), per its definition above.
4. **Decide `T`**: `|S| = 1 ∧ L ⊆ S ⇒ T2`; `S = ∅ ∧ L = ∅ ⇒` genuine removal; else BLOCK.
5. Compute `LH` from the **decided `T`**, per its definition above.
6. **Leftover-fail** (refuse the `k = 0` discharge, **not** the landing) if any `LH` sits
   **outside** its resolved host set `SH`, or a host is **unresolved** while a live
   leftover to `T` exists.

An implementer **cannot** rebuild the revision-e path-first short-circuit by "computing
`L`/`LH` from an empty `H`": `H` is resolved in step 2 **before** `L`, and a husk or absent
host yields **no** present content-match and (once edited) **no** unique `SH`, so the host is
**unresolved** and step 6 leftover-fails — it never silently produces `L = ∅` off a vanished
path.

**Normative: a `k = 0` discharge is reachable ONLY when every surviving coupling to `T` is
ALLOWED / same-owner (the conservation boundary — the decisive review point; recorded here
so it is not re-litigated).** A genuinely **forbidden** survivor has a **non-`null`**
`violationReason`, so it is in `forbiddenEdges`, so `CurEdges(T) ≠ ∅` and `k ≥ 1`, and the
`k ≥ 1` conservation machinery (§3.2) **CARRIES** the obligation onto it — the discharge
branch is **never reached**. Therefore discharging the waiver when only **allowed /
same-owner** couplings to `T` remain leaves **no forbidden owner→owner dependency
undetected** — which is exactly the invariant the gate enforces. Relocating `T`-dependent
code from a **not-allowed** owner into an **allowed** owner is a legitimate refactor; the
obligation retires through the §3.7 `ownership-correction` grant, and the §3.4 occurrence
backstop only refuses a **silent** discharge. This is precisely why `LH` is scoped to hosts
that **reproduce `own(Gi)`** or are a **NEW source carrying `Gi`'s coupling** — **not**
"every current source to `T`": an over-broad `LH = every source to T` would regress genuine
removals to a **shared** target (P7) by treating every unrelated pre-existing coupling as a
leftover. (This is the codex re-review's conceded point — the already-coupled-allowed-host
case is the conservation boundary, not a hole.)

### 3.7 The author-authorized amendment protocol

Three operations are legitimate but **not** content-derived: (a) **weakening** the
`deadline`/`inversionOwners` of a **retained** obligation (strengthening is done by
conservation without an amendment, §3.5); (b) changing a retained record's
`lineage`; and (c) retiring a coupling whose edge became §2-**allowed** or
**same-owner** via an owner relabel — even one paired with a trivial edit — while the
resolved reference survives (the decision-5 hole the occurrence backstop otherwise
blocks). Each requires an **amendment record**:

```
amendment = {
  priorFingerprint,            // the predecessor/old edge (old forbidden edge)
  newFingerprint,              // the current/new edge (new allowed or re-keyed edge)
  priorFields, newFields,      // exact before/after of the changed field(s)
  kind,                        // deadline-change | lineage-change | ownership-correction
  authorization,               // { record, clauseId }  — clauseId names a grantId (below)
  provenance,                  // substantive rationale (as today)
}
```

Both `priorFingerprint` (the old forbidden edge whose obligation is being changed
or retired) and `newFingerprint` (the re-keyed / now-allowed edge) are named
explicitly, resolving the round-2 single-`fingerprint` ambiguity.

**Machine-verifiable authorization is a CLOSED structured record, not prose
(decision 9; closes Codex #6).** Round-3 codex objected that "its text authorizes
exactly the transition" still requires semantic judgment. Revision d removes all
natural-language interpretation: the authorizing clause is itself a **structured
grant record** the gate parses by exact fields, embedded in the Decision as an
HTML-comment marker (the same mechanism as the frozen-edge records,
`parseFrozenEdgeRecords` ~line 791):

```
<!-- module-ownership-amendment-grant: {
  "grantId":   "…",                     // stable id; the amendment's clauseId names it
  "scope":     { "fingerprint": "<edge>" }  // OR  { "target": "<module path>" },
  "kind":      "deadline-change" | "lineage-change" | "ownership-correction",
  "direction": "strengthen" | "weaken" | "any",
  "priorFields": { … } | null,          // exact before-fields the grant permits (null = any)
  "newFields":   { … } | null           // exact after-fields the grant permits (null = any)
} -->
```

The gate admits the amendment **only** when, reading the **predecessor** git
revision via `git cat-file` / `loadRevisionSnapshot`, a grant record with
`grantId === amendment.authorization.clauseId` exists in the named predecessor
`record` file and matches **field-for-field**: (1) `scope` equals the amendment's
`priorFingerprint`/`newFingerprint` edge or its target module; (2) `kind` equals the
amendment `kind`; (3) `direction` permits the transition (`weaken` is required for a
later deadline / dropped owner; an `ownership-correction` retiring an
allowed/same-owner coupling needs `kind === "ownership-correction"`); and (4) the
grant's `priorFields`/`newFields`, when non-`null`, equal the amendment's exact
before/after fields. No clause **text** is read; a mismatch on any field refuses the
amendment. Because the grant lives in the immutable predecessor snapshot, an author
**cannot** forge it by editing the same Decision in the landing that files the
amendment (the round-2 same-push forge stays closed).

**Grant well-formedness (round-5 minors).** (1) **`direction` is mandatory** on every
grant (no default); an **`ownership-correction`** grant additionally must carry
`direction` explicitly **and** non-`null` `priorFields`/`newFields` — a `null` (any)
before/after on an `ownership-correction` is refused, so a retire grant can never be a
blank check. (2) **`grantId` is unique** across all grant records on the predecessor
snapshot; a duplicate `grantId` is a **gate red** (an ambiguous match must never
silently pick one grant). (3) **A grant is git-committed bytes ≤ the predecessor
snapshot.** "Pinned to a commit" means the structured grant record's **bytes** live in a
git object (commit/blob) at or before the predecessor revision, verifiable by
`git cat-file` — a **Linear field that merely names a SHA is NOT accepted**; a Linear
pointer is honored **only** when the identically-structured grant bytes are themselves
committed to the referenced repository at or before the predecessor and read the same way
as an in-repo grant; otherwise the amendment is refused. Without a valid grant, a
retained obligation is immutable downward (§3.5) and an allowed/same-owner relabeled
coupling is undischargeable (§3.4).

### 3.8 Disposition vocabulary decision: orthogonal fields, no new token

`split-relocation` is **not** a fourth `disposition`; the enum is dissolved into
`lineage`/`obligation` (§3.3). Whole-edge move, edge-key split, owner re-key,
rename, and merge are all expressed by `lineage.kind` + the conservation invariant.
What changes versus today:

- **Dropped precondition:** `removed.includes(priorFingerprint)` (~line 923) — the
  whole-edge-move requirement — is removed; the predecessor edge may survive (a
  split), governed by §3.2 conservation, not edge-key removal.
- **Removed precondition:** the "retain the predecessor owner pair" assertion
  (~lines 929–932) is deleted; owner identity is never lineage evidence.
- **Added preconditions:** the §3.2 conservation invariant, §3.3 predecessor-keyed
  obligation resolution, §3.4 verbatim carry-forward + occurrence backstop +
  byte-scan promotion, §3.5 total reconciliation (with strengthen-only intersection),
  §3.6 **computed** target identity + multi-predecessor join, and the §3.7 amendment
  gate.

### 3.9 Proving a genuine god-file extraction (false-negative tolerance)

A legitimate drainage of `src/local.rs`:

- **Re-key (drain, coupling still upward).** The `fn` carrying
  `crate::…::connected_clients::…` moves from `src/local.rs` into
  `src/server/writer_gate.rs` (owner-5). Predecessor `PredObl(connected_clients)`
  holds worklist item 8's waiver on `local.rs → connected_clients`;
  `CurEdges(connected_clients)` holds `writer_gate.rs → connected_clients`. With
  `k = m = 1`, conservation requires the surviving edge to carry item 8's waiver
  **verbatim**. The record carries `lineage: relocation [P8]` (descriptive) and the
  verbatim obligation. **Admitted** — the god file drains, the obligation moves
  honestly. Exactly what
  `issues/20260810-owngate-split-relocation-disposition-gap.md` needed.
- **Discharge (drain + invert).** If the extraction also inverts the coupling (the
  moved code now calls **down** through a typed kernel operation), then
  `CurEdges(connected_clients)` loses that edge (`k` drops), the departing waiver is
  the weakest, **and** the §3.4 occurrence backstop is clear (no obligated host still
  couples to `connected_clients` in `analysis.edges`, forbidden or allowed) **and**
  no byte-identical carrier survives (the code was rewritten) — so the waiver is
  discharged. Real burn-down. (The downward rewrite is *evidence to §3.2* that `k`
  dropped, not an independent inversion exit — §3.4.)
- **Edited in flight.** The carrier is edited (add `pub`), so its fingerprint
  shifts, but `writer_gate.rs → connected_clients` is still a current forbidden
  edge. `k = m = 1`, so conservation **requires the standing waiver carried
  verbatim** — never a fresh deadline. A clean move is admitted as such; an edited
  one inherits the exact standing deadline.

The bias is asymmetric and honest: *a clean move* is admitted by conservation; *an
edited or unprovable move over a surviving coupling* conserves the strictest
obligation; only *a genuinely absent coupling* (count dropped, occurrence backstop
clear over `analysis.edges`, **and** byte-scan clear, with the computed target
identity showing genuine removal) discharges it, weakest first.

### 3.10 Analyzer-relative soundness boundary (decision 6; the disclosed residual)

Every rule above is stated over the analyzer's **resolved** forbidden edges
(`analyzeSources` → `forbiddenEdges`, built from `extractModuleSyntax`'s reference
resolution ~lines 401–467). Two consequences must be stated plainly:

- **What the analyzer sees is the universe of obligations.** A coupling the
  analyzer cannot resolve is **not** a forbidden edge — not at the predecessor, not
  currently — and was never an obligation. Conservation is therefore **sound
  relative to the analyzer**: given the analyzer's forbidden-edge sets, no
  discharge is authorized while an accounted-for forbidden coupling to the target
  survives.
- **The residual.** An author who rewrites a **visible** reference into an
  **analyzer-invisible** form — a bare crate-relative `use connected_clients::Foo;`
  (which `extractModuleSyntax` records only when `pub` or `crate`/`self`/`super`-
  rooted, ~lines 425–434), an opaque helper the resolver does not follow, or a
  proc-macro expansion — makes the coupling **vanish from the analyzer's edge set**.
  Conservation then sees a genuine coupling removal and discharges the obligation,
  although the behavior still reaches `T`. This false-negative is **pre-existing to
  LLP 0225's extractor** (any content-analyzer gate has it; the plain 0225 waiver
  mechanism is evadable the same way) and is **not** a hole in the conservation
  logic — it is the analyzer's boundary.
- **Named residual — leading-`::` crate-relative paths.** The §3.10 tightening
  records `pub`/`crate`/`self`/`super`-rooted paths, but a **leading-`::`
  crate-relative** path (`::connected_clients::Foo`, `::foo::Bar`) is **not** matched
  by the extractor's `crate|self|super` regex. Rewriting a resolved reference into
  the `::`-rooted form is therefore an instance of the residual above (the coupling
  vanishes from the edge set). This is disclosed, still analyzer-relative, and closed
  only by extending the extractor's root grammar to include leading-`::` — named here
  even though a fully general close needs a whole-program resolver.
- **Named residual — the `to === from` self-edge drop.** `analyzeSources` drops
  `to === from` self-edges (~line 621). **Inlining** `T`'s body **into** its
  predecessor-obligated host `G` (so the only `h → T` coupling becomes a `G → G`
  self-reference) removes the sole possible `h → T` occurrence from `analysis.edges`,
  and the occurrence backstop then sees no survivor. This is a **pre-existing**
  analyzer-boundary residual (the self-edge drop predates this Decision), disclosed
  here; the byte-scan promotion (§3.4) saves a **byte-identical** inline but not an
  edited one — and promotion of a byte-identical inline is **never** a discharge
  oracle (it only returns the obligation to the carried pool). Closing the edited-inline
  case requires whole-program reachability, out of scope.

**Ruling (decision 6).** Soundness is defined **analyzer-relative**, and the most
common evasion is closed by a **fail-closed** tightening that lives in the same
gate: `extractModuleSyntax` is extended to record **bare crate-relative `use`
leaves and in-body paths** (not only `pub`/rooted ones), and any reference that
resolves to an **opaque helper or a macro expansion the resolver does not follow**
increments `unresolvedReferenceCount` and blocks discharges **per reachable
target**, not globally. The implementable scoping (codex raised that "reachable
through it" is not computable without resolving the helper): when an
**obligated host** `h ∈ H(T)` has any **unresolved** reference in the current
snapshot, the gate cannot rule out that `h` still reaches `T` through it, so it
**blocks the discharge of every obligation whose host is `h`** — the block is scoped
to the targets reachable *only* through that host's unresolved edges, leaving
discharges of unrelated, fully-resolved hosts unaffected (not a global freeze). The
gate already tracks `unresolvedReferenceCount`/`unresolvedReferences`
(~lines 595–617), which carry the `from` host, so the scoping is exactly the set of
hosts with a non-empty unresolved list. Couplings that remain outside even the
tightened analyzer are the **declared residual** of this Decision, not a silent gap.
All round-4, round-5, **and** round-6 laundering shapes are **analyzer-visible** (the
owner-relabel keeps a resolved `service-A → service-B` edge; the record-less rename,
the husk, the parked-copy sink, and the same-path parked copy keep resolved edges to
`bar`; the obligated-host rename+edit and the obligated-host husk keep a resolved
`service_a2 → service_b` edge), so none escape through
this residual — the residual bites only when a reference is rewritten into a form the
tightened extractor still cannot resolve (the leading-`::` and self-edge cases named
above), which no content gate can close without a whole-program resolver. Stated
plainly: soundness is **analyzer-relative**; given a sound analyzer edge set the
conservation invariant authorizes no unsound discharge.

---

## 4. Adversarial fixture matrix

Each fixture is a predecessor tree + current tree pair driven through the
sanctioned `--update-baseline` / snapshot-protocol path (the path that completed
the historical attacks), asserting the exact verdict. All live under
`tests/fixtures/module-ownership/` (implementation note, §7). Occurrence
arithmetic appears in **no** refusal rationale below — every verdict is a
conservation count over the computed target identity plus the §3.4 occurrence
backstop over `analysis.edges` (and, for host-moving merges, the byte-scan
promotion).

### Negative fixtures (must REFUSE)

| # | Attack class | Fixture | Refusal (why) |
|---|---|---|---|
| N1 | **endpoint-assertion** (R1) | Predecessor: frozen `G → T`. Current: unrelated `U` gains a new `crate::…::T` item; record claims `U → T` re-keys `G → T`. | Conservation over `T`: `G → T` still forbidden (`k ≥ m`), so its freeze is carried on `G → T`; `U → T` is a genuinely-new edge needing its own record. Shared `to = T` grants nothing. |
| N1b | **retained-record swap** (R1, round-1 §5) | Predecessor: waiver on `G → T`. Current: same fingerprint, deadline pushed later (or `lineage`/predecessors/provenance rewritten). | §3.5 intersection walk: the retained record is immutable **in full**; any change without a §3.7 amendment is refused; `--update-baseline` carries the predecessor record forward. |
| N2 | **`extractedFrom`-assertion** (R2) | Predecessor: frozen `G → T`; unrelated `X → T`. Current: `X` manifest gains `extractedFrom: G`. | Manifest fields are never consulted. `X → T` and `G → T` are independent current edges; each carries or gets its own record by conservation. |
| N2b | **obligation-null launder** (R2) | Predecessor: waiver on `G → T`. Current: same edge rewritten `obligation: null`. | §3.5 immutability + §3.4: the edge survives, so conservation requires the strict waiver carried verbatim; nulling it is refused. |
| N3 | **name-only overlap** (R3) | Predecessor: `G` has `fn handle()` → `T`. Current: removed from `G`; unrelated `M` has a **different-bodied** `fn handle()` → `T`. | Conservation over `T`: `M → T` is a current forbidden edge; `k = m = 1` forces it to carry `G`'s obligation verbatim (the different body does **not** make `M → T` "genuinely new" — a new attribution is only available when `k > m`). The launderer cannot get a fresh clock. |
| N4 | **rename-launders-waiver** (R3) | Predecessor: waiver on `G → T`. Current: `G` renamed to `G2` (bytes identical); record drops the deadline. | Conservation: `G2 → T` survives, `k = m = 1`, strict waiver carried verbatim; the byte-scan additionally sees the identical carrier. Drop refused; honest re-key admitted. |
| N5 | **owner-rekey-launders-waiver** (Codex) | Predecessor: waiver on `G → T`. Current: same file, one owner reassigned, still forbidden; record drops deadline/owner. | `owner-rekey` is not a lineage kind; `G(newOwner) → T` is a current forbidden edge to `T`, `k = m = 1`, strict waiver carried verbatim. Drop refused. |
| N6 | **import-plant** (round-1) | Both `G` and unrelated `M` already contain identical `use crate::T::Thing;`. Current: delete from `G`, make `M → T` forbidden, claim relocation. | Conservation: after deletion `CurEdges(T)` is whatever forbidden edges remain; `M → T`, being present at the predecessor too, is **not** genuinely-new, so it must carry a predecessor obligation — it cannot receive a fresh disposition. No free grandfathering. |
| N7 | **clone-and-mutate forgery** (round-2, both families) | Predecessor: waiver `G → T`. Current: keep the carrier in `G` (edit one token), paste old bytes into `M`. | Conservation: both `G → T` and `M → T` are current forbidden edges, `k = 2 > m = 1`; the strict waiver is carried by one, the other needs its **own** fresh attribution. No discharge (coupling to `T` never left); **no occurrence arithmetic consulted** (the round-2 `del` error is irrelevant). |
| N7b | **coincidental delete/add** (round-2 Grok) | Predecessor: waiver `G → T`. Current: `G`'s carrier deleted for an unrelated reason; a token-identical item independently written in `M`. | Same as N7 with `k = m = 1`: `M → T` survives, must carry `G`'s strict waiver verbatim (not a fresh clock). Causation is never claimed or needed. |
| N8 | **fan-out / stockpile** (round-1/round-2) | Predecessor: one waiver `G → T`. Current: carrier distributed into `M1, M2, M3`, all claiming the one waiver. | Conservation: `k = 3 > m = 1`; one edge carries the waiver, the other **two** each need their own fresh attribution. Intra-host cloning changes no edge count; the anti-stockpile cap refuses a manufactured pool. |
| N9 | **edited-move fresh-clock launder** (round-2 load-bearing) | Predecessor: waiver `G → T`. Current: move the carrier to `M`, add `pub`, file a fresh later waiver. | Conservation: `M → T` survives, `k = m = 1`, strict waiver carried **verbatim**; a fresh later deadline is refused. No move locus is computed. |
| N9b | **two-push copy-then-delete** (round-2 Grok) | Push 1: copy to `M`, keep `G`, fresh waiver `D' > D` on `M → T`. Push 2: delete `G`. | Push 2 conservation: `PredObl(T) = {D, D'}`, `k = 1`; one discharge allowed and it must be the **weakest** = `D'`; `M → T` carries the strict `D` verbatim. The later deadline is the one shed. |
| N10 | **literal-collision forgery** (Codex) | `fn f(){ dispatch("read-only"); }` vs `fn f(){ dispatch("admin"); }`. | §3.1 preserves literal bytes: carriers fingerprint differently, so the byte-scan and target-identity proofs do not conflate them. |
| N10b | **doc-attribute collision** (Codex #6) | Two carriers differing only in a load-bearing `#[doc]` / `///` that a proc-macro reads. | §3.1 serializes doc comments as `#[doc]` attribute tokens: the carriers fingerprint differently. |
| N11 | **owner-relabel discharge** (round-1 OQ1 / Codex #4 / Grok) | Predecessor: waiver `service-A → service-B`. Current: relabel `service-A` to an adapter owner allowed to depend on `service-B`; bytes unchanged; claim the waiver retired. | The edge is now §2-allowed, but the §3.4 occurrence backstop finds `service-A → service-B` still resolved in `analysis.edges` (the byte-scan corroborates via the identical carrier): the coupling exists, so no discharge. Retirement requires a §3.7 `ownership-correction` grant. |
| N11b | **forged same-push amendment** (Codex #4 / Grok #5) | As N11, but the author adds an `ownership-correction` amendment whose `authorization` points at a Decision-history bullet edited **in the same push**. | §3.7: authorization must be present on the **predecessor** snapshot. `git cat-file` of the named clause at the predecessor revision does not contain it → amendment refused. |
| N12 | **merge obligation-launder** (round-1 #7) | Predecessor: waivers `P1 = G1 → T` (D1) and `P2 = G2 → T` (D2 > D1). Current: both merge into `S = M → T`; record carries only D2. | §3.4 merge aggregation: strictest deadline (D1) + union of owners; carrying only D2 is refused. |
| N12b | **mixed waiver+freeze merge** (Codex #7 / Grok) | Predecessor: waiver `P1 = G1 → T` (D1) and freeze `P2 = G2 → T` (`null`). Current: merged into `S = M → T` recorded `obligation: null`. | §3.4 `null`-identity: waiver + freeze aggregates to the **waiver** (D1). Nulling it is refused; the freeze cannot annihilate the waiver. |
| N13 | **target-rename forgery** (Codex #5 / Grok) | Predecessor: waiver `G → Ti`. Current: `Ti`'s file replaced by `T2` that keeps 80% boilerplate but swaps the definition-bearing items; claim `T2 ≡ Ti` and re-home the obligation onto a benign edge. | §3.6 own-items: swapping the definition-bearing items makes `own(T2) ⊉ own(Ti)` ⇒ `S = ∅`; but `G` still resolves to the renamed module (a new target carrying some `Ti` items) ⇒ `L = {T2}` ≠ ∅. `S = ∅ ∧ L ≠ ∅` ⇒ **BLOCK** (ambiguous removal) — an un-identifiable rename cannot discharge. |
| N14 | **edited owner-relabel** (round-4 Codex, the `k=0` cut) | Predecessor: forbidden `service-A → service-B` carrying `D1`. Current: relabel `service-A` to an owner allowed to depend on `service-B` **and** add a trivial token (`#[inline]`) so the fingerprint is `f' ≠ f`; `CurEdges(service-B) = ∅`, claim the waiver retired. | §3.4 occurrence backstop over `analysis.edges`: `service-A → service-B` still resolves (now §2-allowed), and `service-A ∈ H(service-B)`, so the coupling is live. Discharge refused; with no surviving **forbidden** edge to carry `D1`, the push **blocks** pending a §3.7 `ownership-correction` grant. The trivial edit is irrelevant (the backstop is not a byte-scan). |
| N15 | **same-owner collapse** (round-4 Codex) | As N14 but collapse both endpoints to **one** owner (`fromOwner === toOwner`), so `violationReason` returns `null` and the edge is neither forbidden nor a downward allowed-dependency. | The backstop scans `analysis.edges` directly (which retains the same-owner edge; only `to === from` self-edges are dropped), **not** `violationReason` — so it still sees `service-A → service-B`. Discharge refused; push blocks pending a §3.7 grant. |
| N16 | **target-rename without a record** (round-4 Grok, the `k=0` cut) | Predecessor: waiver `D1` on `G → src/foo.rs`. Current, one landing: `git mv foo.rs → bar.rs`, `mod foo → bar`, every site `crate::…::foo:: → crate::…::bar::`, **no** `module-relocation` record; the inbound-carrier fingerprints of `G → foo` change and `foo.rs` is absent. | §3.6 **own-items**: the site rewrites are in the *hosts*, so `bar`'s own items equal `foo`'s ⇒ `own(bar) ⊇ own(foo)` ⇒ `S = {bar}`; `G → bar` is a new target carrying `foo`'s items ⇒ `L = {bar}`; `|S|=1 ∧ L ⊆ S` ⇒ `T2 = bar`, `PredObl(foo)` pools onto `G → bar`, `k = m = 1`, `D1` carried **verbatim** (dropping/re-dating refused). Confirms honest `git mv` (unique own-match) CARRIES; closes the `to`-endpoint rename c left open. |
| N17 | **husk decoy** (round-5, the `k=0` cut) | Predecessor: waiver `D1` on `G → src/foo.rs`. Current: leave `src/foo.rs` in the tree as a **stub** (items replaced), move the real API to `src/bar.rs` with at least one item **edited**, rewrite every site `foo:: → bar::`; `G` (a present, reliable outgoing-edge host, `own(G) ⊇ own(G)`) points at `bar`; claim `D1` retired. | §3.6 **universal** target rule (no path short-circuit): `foo.rs` is present but `own(foo.rs) ⊉ own(foo)` (a husk) ⇒ `foo ∉ S`; the edited `bar` gives `own(bar) ⊉ own(foo)` ⇒ `S = ∅`; the reliable host's `G → bar` is a live leftover ⇒ `L = {bar}` ≠ ∅ ⇒ **BLOCK**. Path presence no longer short-circuits identity. |
| N18 | **parked-copy identity-sink** (round-5, the `k=0` cut) | Predecessor: waiver `D1` on `G → src/foo.rs`. Current: park a **byte-identical** copy of every `foo` item at `src/unused_foo.rs`; move the real API to `src/bar.rs` with one item **edited**; delete `src/foo.rs`; `G` (a present, reliable outgoing-edge host) points at `bar`. | §3.6: `own(unused_foo) ⊇ own(foo)` ⇒ `S = {unused}`, a single full match — but `L` is checked **AFTER** `S`: the reliable host's `G → bar` is a live leftover (`bar` a new target carrying `foo`'s items) ⇒ `L = {bar}`, `L ⊄ S` ⇒ **BLOCK**. The decoy cannot make the wrong module win identity. |
| N18b | **same-path parked copy** (round-6, target `k=0` short-circuit) | Predecessor: waiver `D1` on `G → src/foo.rs`. Current: leave `src/foo.rs` **byte-identical but unused** (so `own(foo) ⊇ own(foo)`), copy the real API to `src/bar.rs` with one item **edited**, rewrite `G` from `foo` to `bar`; `CurEdges(foo) = ∅` ⇒ `k = 0`; claim `D1` retired (and a fresh `D2` on `G → bar`). | Revision e's fast-path would set `T = foo` on the same-path content match **without** computing `L` and discharge `D1`. §3.6 universal rule **deletes** that short-circuit: `foo` present with a content match only puts `foo ∈ S` (`S = {foo}`); `L` is **always** computed and the reliable host's `G → bar` is a live leftover ⇒ `L = {bar}`, `L ⊄ S` ⇒ **BLOCK**. The byte-identical copy at the original path launders nothing. |
| N19 | **obligated-host rename+edit** (round-5, the `k=0` cut) | The N14 tree **plus** `git mv src/service_a.rs → src/service_a2.rs`, relabel to an allowed owner (or same-owner collapse), one token (`#[inline]`) edited; `service_a2 → service_b` resolves in `analysis.edges`; `T = service_b` present, `k = 0`. | §3.6 **symmetric content-match + dual-leftover host rule**: `service_a`'s path is absent ⇒ compute `SH`/`LH`; the `#[inline]` edit makes `own(service_a2) ⊉ own(service_a)` ⇒ `SH = ∅`, while `service_a2 → service_b` is a new source of edges to `service_b` (and shares `service_a`'s items) ⇒ `LH = {service_a2}` ⇒ **otherwise ⇒ refuse the `k = 0` discharge**. Nothing promotes (edited carrier) and no forbidden edge survives ⇒ push **BLOCKS**. The genuine-removal branch is never reached while `LH ≠ ∅`. (A **clean** host `git mv` gives `SH = {service_a2}`, `LH = {service_a2} ⊆ SH` ⇒ the backstop scans `service_a2 → service_b` and blocks/carries correctly.) |
| N20 | **obligated-host husk** (round-6, host `k=0` short-circuit) | The N19 tree **but leave `src/service_a.rs` present as a stub** (`echo stub`) instead of deleting it; `git mv`/write the coupling into `src/service_a2.rs` (allowed/same-owner) with one token edited; `T = service_b` present, `k = 0`; claim `D1` retired. | Revision e's host rule scanned the present `service_a` path directly (finds nothing in the stub) and discharged. §3.6 universal host rule: the present stub fails `own(stub) ⊇ own(service_a)` ⇒ compute `SH`/`LH`; `service_a2 → service_b` ⇒ `LH = {service_a2}`, `SH = ∅` (edited) ⇒ **refuse the `k = 0` discharge**; nothing promotes ⇒ push **BLOCKS**. The attacker's whole budget is `echo stub` instead of deleting the path, and it no longer buys a discharge. |

### Positive fixtures (must ADMIT)

| # | Case | Fixture | Admission (why) |
|---|---|---|---|
| P1 | **genuine god-file extraction (drain, re-key)** | Predecessor: waiver on `src/local.rs → src/connected_clients.rs`. Current: the reference-bearing `fn` moved verbatim into `src/server/writer_gate.rs (owner-5)`; `local.rs` no longer references the target. Record: `lineage: relocation [P8]` + verbatim obligation. | Conservation `k = m = 1` over `connected_clients`: the surviving edge carries item 8's waiver verbatim. |
| P2 | **owner re-key with carry-forward** | Predecessor: waiver `G → T`. Current: `G` reassigned to a different owner, still forbidden, bytes identical; record carries the verbatim obligation. | `k = m = 1`; strict waiver carried verbatim. (Contrast N5, same setup with the obligation dropped.) |
| P3 | **method extraction from a large `impl`** | Predecessor: waiver `G → T`; the coupling is in one method of a 40-method `impl`. Current: that method moved verbatim into `M`; the `impl` stays in `G`. | Conservation over `T`: `M → T` survives (`k = m = 1`) and carries the waiver; the `impl` staying put does not block it. §3.1 method-granular carriers make the byte-scan precise. |
| P4 | **honest merge (N→1) — byte-scan promotion** | Predecessor: waivers `P1 = G1 → T` (D1) and `P2 = G2 → T` (D2 > D1). Current: only the coupling-bearing items move **verbatim** into a fresh merged `M` (so `G1`/`G2` no longer couple to `T`, but `own(M) ⊉ own(G1)` — `M` carries the carriers, not all of `G1`'s own items); `S = M → T` survives forbidden; record `lineage: merge [P1,P2]`, `deadline = D1`, owners = union. | The host rule gives `SH = ∅` (`own(M) ⊉ own(G1)`) with `LH = {M}` ⇒ leftover-fail — but this **refuses only the `k = 0` discharge, NOT the landing** (round-6 fix). `M → T` is a surviving **forbidden** edge (`k = 1`), so the §3.4 **byte-scan promotes** both obligations (the identical carriers reappear in `M`) onto it; §3.4 merge aggregation folds them (strictest `D1` + union). Conservation `k = 1 < m = 2` sheds **nothing** — promotion prevented a discharge and the honest merge **ADMITS**. |
| P5 | **author-authorized deadline extension** | Predecessor: waiver on retained `G → T` (deadline D). Current: same fingerprint, deadline D′ > D, with a valid §3.7 `deadline-change` amendment whose `authorization` clause is present on the **predecessor** snapshot. | §3.5 immutability is overridden **only** by the amendment, and §3.7 verifies the authorization against the predecessor tree. Without it (cf. N1b) the change is refused. |
| P6 | **honest burn-down (drain + invert)** | Predecessor: waiver `G → T`. Current: the coupling rewritten to call **down** a typed kernel op; no forbidden edge to `T` remains; no byte-identical carrier survives. | Conservation: `k < m` over `T`, the waiver is the weakest departing obligation; the §3.4 occurrence backstop is clear (`G` no longer couples to `T` in `analysis.edges`) **and** the byte-scan is clear. Real discharge — the downward rewrite is evidence that `k` dropped, not an independent inversion exit. |
| P7 | **computed-identity genuine removal** (round-4 twin of N16) | Predecessor: waiver `D1` on `G → src/foo.rs`. Current: `foo.rs` **deleted**; `G` **stays present** (a reliable outgoing-edge host, `own(G) ⊇ own(G)`) but its reference to `foo` is removed entirely (no successor module reproduces `foo`'s own items, and `G` no longer resolves anywhere for that coupling). | §3.6 universal target rule: path absent, `own(M) ⊉ own(foo)` for every module ⇒ `S = ∅`; `G`'s only edges are pre-existing to unrelated targets that carry none of `foo`'s items ⇒ `L = ∅`. `S = ∅ ∧ L = ∅` ⇒ **genuine removal**. Host side: `G` present with `own(G) ⊇ own(G)` ⇒ the present-path scan is the trusted backstop (`SH = ∅ ∧ LH = ∅`), and it finds no `G → foo` edge. Occurrence backstop and byte-scan both clear ⇒ `D1` discharges, weakest-first. This is the honest twin the universal leftover predicate must still admit. |
| P8 | **honest 1→N split (fresh attribution, not inherited)** | Predecessor: one waiver `D1` on `G → T`. Current: the coupling genuinely splits into `M1 → T` and `M2 → T` (two distinct forbidden edges). Author carries `D1` onto `M1` and files a **fresh** reviewed waiver on `M2`. | §3.2 count `m = 1`, `k = 2`: **one** successor carries `D1` verbatim, the surplus successor needs its **own** fresh attribution (the §3.4 trim). Admitted **only** with the fresh record on `M2`; replaying `D1`'s clock onto both would be refused as an un-attributed second edge. |

The matrix's discriminating property is uniform: **a discharge requires the
current forbidden-edge count to the COMPUTED target identity to drop with the
strictest obligations still carried, a clear occurrence backstop over
`analysis.edges` (with the UNIVERSAL, symmetric content-match + dual-leftover host
identity — no path-presence short-circuit on either endpoint), and a clear byte-scan; a
surviving analyzer-visible coupling — forbidden, allowed, or same-owner — forces the
strict obligation carried verbatim or blocks; there is no move proof to forge and no
`k=0` shortcut.** Every positive differs from its negative twin only by conserving
obligations honestly. The `k=0` cut is now **SYMMETRIC and UNIVERSAL** on **both**
endpoints, with **no path-presence short-circuit**: N14/N15 close the edited/collapsed
owner-relabel (occurrence backstop); N16 closes the record-less rename and N13 the
swapped-item rename (own-item `L ⊆ S`); N17 the husk, N18 the parked-copy sink, and
**N18b the same-path byte-identical parked copy** (universal `L`-after-`S`, no target
short-circuit); N19 the obligated-host rename+edit and **N20 the obligated-host husk**
(symmetric `SH`/`LH` host rule, no host short-circuit); a leftover-fail is a **discharge
refusal, not a push veto**, so P4 still **ADMITS** via byte-scan promotion; and P6/P7/P8
confirm the honest twins (in-place invert, genuine removal with the host still present,
fresh-attribution split) still pass.

---

## 5. Why the prior designs failed and this doesn't

| Defeat | The property it exploited | The property that now defeats it |
|---|---|---|
| R1 endpoint | trusted endpoint equality | §3.2 conservation: a surviving edge to `T` carries the strict obligation; endpoints grant nothing |
| R1 / round-1 §5 record swap | retained fingerprint changed outside the growth loop | §3.5 full-record intersection walk; `--update-baseline` carries the predecessor record forward |
| R2 `extractedFrom` | trusted a manifest assertion | lineage is descriptive; manifest fields never consulted; conservation is content-derived |
| R2 analyzer-upgrade launder | discharge admitted a reclassification | §3.3 predecessor-keyed lookup + §3.4: a surviving edge cannot be nulled |
| R3 name-only | trusted symbol **name** overlap | §3.2: a surviving current edge to `T` carries the obligation; a different-bodied `handle()` cannot claim a fresh clock |
| R3 rename launder | discharge keyed on the **successor** fingerprint | §3.3 keys on the **predecessor** fingerprint; §3.2 forces carry-forward |
| Codex owner-rekey launder | never read the predecessor obligation | §3.3 reads `obl(P)`; §3.2 counts the surviving edge; §3.4 carries it forward |
| Round-1 import-plant / existential match | existential content match | §3.2 conservation counts edges; a pre-existing edge is not "genuinely new" |
| **Round-2 clone-and-mutate / coincidental / occurrence identity** | **two-snapshot occurrence identity read as causal transfer** | **§3.2 never computes a move; it counts surviving forbidden edges to `T` and forces the strict obligation carried — occurrence arithmetic is not the authority** |
| Round-2 edited-move / helper-wrap fresh clock | fingerprint-absence ⇒ discharge; undefined move locus | §3.2 counts the surviving edge (no locus); the absence rule is **deleted** (decision 8) |
| Round-2 two-push copy-then-delete | delete the strict edge after seeding a lax one | §3.2 sheds the **weakest**; the strict deadline stays on the survivor |
| Round-2 stockpile / fan-out | occurrence supply as budget | edge-count conservation + anti-stockpile cap: one waiver never becomes N |
| Round-1 literal / round-2 doc collision | masked literals / dropped doc comments | §3.1 pinned-AST token serialization preserves literal bytes and `#[doc]` tokens |
| Round-1 expiry-vs-lineage | expiry keyed on a `disposition` enum | §3.3 expiry reads `obligation`, independent of lineage |
| OQ1 owner-relabel discharge | a label move retired a live coupling | decision 5 / §3.4 **occurrence backstop over `analysis.edges`** (every resolved edge — forbidden, allowed, same-owner) sees the live coupling and refuses the discharge, relying on neither byte-identity nor `violationReason`; §3.7 amendment is the only exit |
| Round-2 forged same-push amendment | in-repo authorization edited in the same push | §3.7 authorization must be present on the **predecessor** snapshot (`git cat-file`) |
| Round-2 target-threshold forgery | a similarity threshold for target identity | §3.6 computes identity over the target's **own item fingerprints** (`own ⊇ own(Ti)`), no threshold |
| **Round-4 edited owner-relabel / same-owner collapse (`k=0`)** | **discharge at `k=0` gated only by a byte-scan; a trivial edit defeats it; `violationReason` is `null` for allowed/same-owner** | **§3.4 occurrence backstop scans `analysis.edges` (every resolved edge) for an obligated host still coupling to `T`; relies on neither byte-identity nor `violationReason`; a live allowed/same-owner coupling blocks the discharge** |
| **Round-4 target rename without a record (`k=0`)** | **identity was author-claimed via `module-relocation`; a record-less rename read as removal** | **§3.6 COMPUTES identity over the target's own items (no filing needed); `|S|=1 ∧ L⊆S` carries `D1` onto the computed `T2`; an un-identifiable rename (`S=∅ ∧ L≠∅`) BLOCKS** |
| **Round-4 1→N split overclaim** | **doc claimed conservation subsumes edge-key splits (free inheritance)** | **§3.4/§3.6 trim: `m=1,k=N` ⇒ one carrier + `N−1` fresh attributions; a split is not auto-inherited** |
| **Round-4 proven-inversion independent exit** | **inversion could retire a strict deadline while a laxer coupling survived** | **§3.4 subordinates inversion to §3.2: it is evidence that `k` dropped; §3.2 still sheds the weakest** |
| **Round-5 husk / parked-copy decoy (`k=0`)** | **path-presence short-circuit, or a single full match, won target identity for the wrong module** | **§3.6: same-path REQUIRES a content match (husk ≠ `T`); the total `L ⊆ S` predicate checks `L` AFTER `S`, so a decoy in `S` with the live leftover outside `S` BLOCKS (N17, N18)** |
| **Round-5 obligated-host rename+edit (`k=0`)** | **host identity failed and fell through to scanning the vanished old path; the live `service_a2 → service_b` edge sat in `analysis.edges` unexamined** | **§3.6 symmetric fail-closed host identity: a host with no unique own-item successor BLOCKS (never the genuine-removal branch); a clean host rename resolves uniquely and the backstop scans `H2 → T` (N19)** |
| **Round-5 §3.6 witness-set inconsistency** | **all-carriers defined both over inbound forbidden-edge carriers and over the target's own items — an honest `git mv` would wrongly BLOCK under the inbound reading** | **§3.6 uses ONE set — the module's OWN item fingerprints; the inbound-carrier phrasing is deleted, so honest N16 CARRIES** |
| **Round-6 same-path target short-circuit (`k=0`)** | **revision e set `T ≡ Ti` on a present-path content match WITHOUT computing `L`, so a byte-identical copy parked at the original target path discharged while the real edited API moved to `bar`** | **§3.6 target rule is UNIVERSAL: path presence only enters `S`; `L` is ALWAYS computed and `|S|=1 ∧ L⊆S` is required, so the live leftover `L = {bar} ⊄ S` BLOCKS (N18b)** |
| **Round-6 obligated-host husk short-circuit (`k=0`)** | **revision e scanned a present host path directly with no content-match/`LH`, so a stub left at the old host path discharged while the live `service_a2 → service_b` edge sat unexamined** | **§3.6 host rule is UNIVERSAL/symmetric: a present husk (`own(path) ⊉ own(Gi)`) computes `SH`/`LH`; the live leftover `LH = {service_a2}` refuses the discharge (N20)** |
| **Round-6 host leftover-fail as a push veto (P4 regression)** | **revision e's `|SH| ≠ 1 ⇒ the push BLOCKS` would refuse the honest merge P4 (`own(M) ⊉ own(G1) ⇒ SH = ∅`) before promotion** | **leftover-fail / `|SH| ≠ 1` refuses only the `k = 0` DISCHARGE, not the landing; §3.4 byte-scan promotion still carries onto the surviving forbidden edge and ADMITS (P4)** |

The through-line: every defeat authorized a discharge or admission from
successor-side evidence — an assertion, a content coincidence, or two-snapshot
occurrence identity. This model authorizes discharges **only** from the analyzer's
own forbidden-edge count dropping, always shedding the weakest, and never trusts a
move it cannot re-derive by counting.

---

## 6. Amendment record — what this changes in LLP 0225 when Accepted

On acceptance, LLP 0225 gains a `Revised` entry and these normative edits:

- **§2 (Dependency direction / monotonic baseline / waiver rules).** The sentence
  permitting re-keying "a **proven pre-existing** edge … with provenance stated" is
  tightened: relocation provenance no longer discharges anything; obligations are
  conserved per target by the §3.2 invariant. Add: "A time-bounded waiver's
  deadline and inversion owners survive every fingerprint-changing transition and
  leave only when the forbidden-coupling count to their target verifiably drops
  (§3.2), always shedding the weakest, **and only when the §3.4 occurrence backstop
  over the analyzer's full resolved-edge set (`analysis.edges`) finds no surviving
  coupling from an obligated host to the target** — forbidden, allowed, or same-owner,
  relying on neither byte-identity nor `violationReason` — never by re-keying,
  renaming, owner reassignment, or a trivial edit. A code-unchanged coupling whose
  edge becomes allowed only because an owner label moved is retired only through the
  author-authorized ownership-correction amendment (§3.7)."
- **§5 (Enforcement).** Replace the `relocation` disposition description with the
  orthogonal `lineage`/`obligation` record model (§3.3), the §3.2 conservation
  invariant, the §3.3 predecessor-keyed resolution, the §3.4 carry-forward +
  **occurrence backstop over `analysis.edges`** (with the byte-scan as
  defense-in-depth promotion, never the discharge authority), the §3.5 total
  reconciliation (growth + removed + **intersection**), the §3.6 **computed own-item
  target identity** (the **universal** total `L ⊆ S` leftover predicate + **symmetric
  content-match + dual-leftover** `SH`/`LH` host resolution, no path-presence
  short-circuit on either endpoint, leftover-fail a discharge-refusal not a push veto),
  and the §3.7 amendment protocol. No `split-relocation` token is added
  (§3.8).
- **§6 (Semantic extraction vs. cosmetic splitting).** Add a cross-reference that a
  cosmetic split moving a coupling-bearing item is expressible as a
  `relocation`/`split` lineage carrying the predecessor obligation, rather than a
  fresh waiver.

Until 0225 is itself Accepted-superseding, this Decision governs the gate's
lineage/obligation semantics.

---

## 7. Implementation scope (follow-on; this document is the design)

This Decision is the sound model, not the patch. The implementing change (tracked
from `issues/20260816-split-relocation-disposition-needs-sound-evidence.md`)
touches:

- **`scripts/check-module-ownership.mjs`:**
  - **Pinned-AST carrier fingerprint (§3.1):** integrate a pinned `syn`-based item
    parser (via a small Rust helper invoked by the gate, or a vendored WASM build;
    pin the version and fail closed on parse error) emitting per-edge occurrences
    `{carrierFingerprint, targetModule, hostModule}` as multisets; fingerprint by
    the length-framed ⟨kind, bytes, jointness⟩ serialization with `#[doc]` tokens
    preserved — **not** `maskNonCode` (~lines 196–269), retained only for the prose
    scan. Extend `extractModuleSyntax` to record bare crate-relative `use`/in-body
    paths and to raise `unresolvedReferenceCount` on opaque-helper/macro forms that
    then block discharges to affected targets (§3.10).
  - `validateAttribution` (~643–661): replace the single `disposition` enum with
    orthogonal `lineage { kind, predecessors[] }` and `obligation { kind, deadline,
    inversionOwners[], origin }` validation, including the shape rules of §3.3.
  - `waiverFingerprints` / `expiredWaiverFingerprints` (~829–841): filter on
    `record.obligation?.kind === 'time-bounded-waiver'`, independent of lineage,
    over **every** current baseline obligation.
  - `enforceMonotonicBaseline` (~873–936): delete the `removed.includes(...)` check
    (~923) and the owner-pair retention check (~929–932); add (i) the §3.2 per-target
    conservation invariant over predecessor and current `forbiddenEdges` (counts,
    strictness order, carrier-vs-new derivation), (ii) the §3.3 predecessor-keyed
    obligation resolution reading `obl(P)` from the **predecessor** `frozen` map +
    predecessor waivers, (iii) the §3.6 **computed** target identity over each module's
    **own item fingerprints** — the **universal** total `L ⊆ S` leftover predicate (run
    on **every** `k=0` discharge, **no path-presence short-circuit**: a present `Ti`-path
    only enters `S`, `own(Ti)=∅ ⇒ S:=∅`; `|S|=1 ∧ L⊆S` carries, `S=∅ ∧ L=∅` removes, else
    blocks) **and** the **symmetric content-match + dual-leftover host resolution**
    (`SH`/`LH`: a present husk `own(path)⊉own(Gi)` or an absent path computes `SH`/`LH`;
    `|SH|=1 ∧ LH⊆SH` scans `H2→T`; `SH=∅ ∧ LH=∅` uses the present scan; else a
    **leftover-fail refuses the `k=0` discharge only, not the landing** — byte-scan
    promotion still admits P4) — and the deterministic multi-predecessor
    union/AND join, (iv) the §3.4 verbatim
    carry-forward, the **occurrence backstop** scanning `analysis.edges` (the full
    resolved-edge set — forbidden, allowed, **and** same-owner; **not**
    `forbiddenEdges` and **not** `violationReason`) for an obligated host still
    coupling to `T`, and the **byte-scan promotion** of would-be-discharged
    obligations, and (v) a **retained-member walk** over the intersection enforcing
    §3.5 full-record immutability **with the strengthen-only exception** (conservation
    may tighten a retained record without an amendment; weakening still needs §3.7).
  - `baselineDocument` (~1005–1037): for an intersection fingerprint, carry the
    **predecessor** record forward; accept a worklist record only for growth or a
    valid §3.7 amendment (closes the `--update-baseline` preference at ~1016–1024).
  - **Amendment records (§3.7):** parse `amendment` blocks and the structured
    `module-ownership-amendment-grant` markers via `parseFrozenEdgeRecords`'s
    mechanism; verify the `{scope, kind, direction, priorFields, newFields}` grant
    **field-for-field** against the **predecessor** snapshot via
    `loadRevisionSnapshot` / `git cat-file` (no clause-text interpretation).
  - Thread the predecessor snapshot's per-edge occurrence multisets, the full
    resolved-edge set (`analysis.edges`) for the occurrence backstop, and the
    predecessor grant records into the validators.
- **`tests/fixtures/module-ownership/`:** the twenty-eight negative and eight positive
  fixtures of §4, each exercised through `scripts/check-module-ownership.test.mjs`
  and, for the launder classes (N1b, N2b, N4, N5, N7, N7b, N9, N9b, N11, N11b,
  N12b, N13, N14, N15, N16, N17, N18, **N18b**, N19, **N20**), through the
  `--update-baseline` path that completed the historical attacks; the positives **P4**
  (honest merge admits via promotion, not vetoed), **P7** (computed-identity genuine
  removal, host still present) and **P8** (honest 1→N split) exercise the promotion,
  discharge, and split paths.

Sequencing note: the pinned-AST fingerprint and occurrence output are new analyzer
surface; land them behind the §4 matrix green, added in the same change, per
LLP 0189 affected-scope verification.

---

## 8. Open questions for the author

The author-proxy decisions in §2 resolve the substance, including the round-1/
round-2 OQs the review families reclassified as soundness holes:

- **Round-1 OQ1 (owner-relabel discharge) — RULED UNSOUND** (decision 5). A
  code-unchanged coupling is never discharged by a label move; the §3.4 **occurrence
  backstop over `analysis.edges`** (which retains every resolved edge — forbidden,
  allowed, same-owner) enforces it, relying on **neither** byte-identity **nor**
  `violationReason`; retirement is only via a §3.7 `ownership-correction` amendment.
- **Round-1 OQ2 (fingerprint strictness) — RULED** (decision 6). Token
  serialization over a pinned AST, literals and `#[doc]` preserved; an edited
  carrier is unproven and its obligation conserved, never reset.
- **Round-2 OQ (module-relocation similarity threshold) — RULED REMOVED**
  (decision 7). There is **no** threshold; target identity is computed over the
  target's **own item fingerprints** (`own ⊇ own(Ti)`). A mixed rename+edit is
  unproven and either blocks on the live leftover or falls to conservation. The
  threshold was soundness-critical, not a permissiveness knob.
- **Round-2 OQ (amendment authorization form) — RULED** (decision 9, tightened in
  rounds 4–5). Authorization is a **closed structured grant record**
  `{scope, kind, direction, priorFields, newFields}` present on the **predecessor**
  snapshot, matched field-for-field by `git cat-file` — **no clause-text
  interpretation** (closes Codex #6). `direction` is mandatory; an
  `ownership-correction` grant additionally pins non-`null` before/after fields; and
  `grantId` is unique across the predecessor snapshot (a duplicate is a gate red). A
  grant is **git-committed bytes ≤ the predecessor** — a Linear pointer is accepted
  only when the identically-structured grant **bytes** are themselves committed at or
  before the predecessor, never a Linear field that merely names a SHA.
- **Round-4 `k=0` exit (both laundering shapes) — RULED CLOSED** (decisions 5, 8;
  §3.2/§3.4/§3.6). Target identity is **computed** automatically over each module's
  **own items** (§3.6, not author-claimed); the discharge gate is an **occurrence
  backstop over `analysis.edges`** that sees forbidden, allowed, **and** same-owner
  couplings from an obligated host to `T` (§3.4), relying on neither byte-identity nor
  `violationReason`; byte-scan failure **promotes** rather than discharges; and
  intersection records may be **strengthened** by conservation. The edited
  owner-relabel (N14), same-owner collapse (N15), and record-less target rename (N16)
  are all refused/carried; the honest twins (P7 removal, P8 split) still pass.
- **Round-5 `k=0` totality/symmetry (three residual holes) — RULED CLOSED** (decisions
  7, 8; §3.6). Identity is over **one set — the module's OWN item fingerprints** (the
  inbound-carrier phrasing is deleted, closing the witness-set inconsistency); the total
  `L ⊆ S` predicate checks `L` **after** `S` (the husk N17, the parked-copy decoy N18
  block); and **obligated-host identity is symmetric** (N19). The honest `git mv` still
  CARRIES (N16) and genuine removal still DISCHARGES (P7).
- **Round-6 `k=0` symmetry/universality (ONE residual husk short-circuit) — RULED
  CLOSED** (decisions 7, 8; §3.6). Both round-5 families converged that revision e's
  "path present ⇒ scan that path directly" fast-path **short-circuited the leftover
  computation on BOTH endpoints** — the target set `T ≡ Ti` on a same-path content match
  without computing `L`, and the host scanned a present path without a content-match or
  `LH`, so a husk/stub left at a PRESENT path defeated the leftover net. Revision f makes
  the `k=0` leftover check **TRULY SYMMETRIC and UNIVERSAL, with NO path-presence
  short-circuit**: (1) target identity **always** computes `S` and `L` (a present path
  only enters `S`; `own(Ti)=∅ ⇒ S:=∅`; N18b blocks the same-path parked copy); (2) the
  HOST endpoint gets the **same content-match + dual leftover** `SH`/`LH` (a present husk
  or absent path computes `SH`/`LH`; N20 blocks the obligated-host husk); (3)
  leftover-fail / `|SH| ≠ 1` is a **DISCHARGE refusal, NOT a push veto**, so P4 still
  **ADMITS** via byte-scan promotion; (4) the "genuine re-owning" sentence is **DELETED**
  (a `k=0` re-home to a new allowed module needs a §3.7 grant). The honest twins P1/P4/P6/
  P7 all still admit. Terminal self-verdict: the husk seam is closed **without** pairing
  reference sites across snapshots (no move proof) — `S`/`L`/`SH`/`LH` are own-item +
  resolved-edge sets.
- **Round-4 lower-severity — RULED.** The 1→N split overclaim is **trimmed** (fresh
  attribution per surplus successor, §3.4/§3.6); the multi-Git-predecessor join is a
  deterministic union/AND that over-blocks (§3.6); proven inversion is
  **subordinated** to §3.2 (evidence that drops `k`, not an exit, §3.4); the
  unresolved-helper block is scoped **per obligated host / reachable target** (§3.10).

No soundness-bearing parameter remains open. One ergonomics item is noted for
measurement after implementation (§10): the rate at which the token-exact
fingerprint, the own-item `L ⊆ S` target-identity rule, or the symmetric fail-closed
host block forces a legitimate edited move to a verbatim-carried obligation (or a
block) rather than admitting it as a clean re-key.

---

## 9. Residual open questions (design honesty)

Two residuals are disclosed rather than hidden:

1. **Analyzer-relative boundary (§3.10).** A coupling rewritten into a form the
   (tightened) analyzer still cannot resolve — an opaque helper, a proc-macro
   expansion the resolver does not follow, a **leading-`::` crate-relative** path the
   `crate|self|super` regex misses, or an **inline** of `T` into its host `G` that the
   `to === from` self-edge drop removes — falls outside the proof and its obligation
   can be discharged as an apparent coupling removal. This is a property of the
   analyzer, not the conservation logic (which is sound relative to the analyzer), it
   is pre-existing to LLP 0225, and the most common evasion (bare crate-relative
   `use`) is closed by the §3.10 fail-closed tightening, whose discharge block is
   scoped **per obligated host** (a host with any unresolved reference cannot
   discharge its obligations), not a global freeze; the leading-`::` and self-edge
   cases are **named** in §3.10 as disclosed residuals, and promotion of a
   byte-identical inline is never a discharge oracle. **None of the round-4, round-5, or
   round-6 laundering shapes live here:** the edited owner-relabel keeps a resolved
   allowed/same-owner edge; the record-less rename, the husk, the parked-copy sink, and
   the same-path parked copy keep resolved edges to `bar`; the obligated-host rename+edit
   and the obligated-host husk keep a resolved
   `service_a2 → service_b` edge — all analyzer-visible and closed by §3.4/§3.6. A
   fully sound treatment of the *invisible* residual would require a whole-program
   resolver (e.g. a rustc query pass), out of scope here and flagged for a future
   analyzer LLP.
2. **Ambiguous edited-move attribution.** When a move is unprovable (edited carrier)
   **and** more than one standing predecessor obligation to `T` could correspond to
   the surviving forbidden edge, conservation still preserves the **strictest**
   (that is forced by §3.2 invariant (1)), so **no obligation is ever dropped** —
   but the record cannot mechanically state *which* predecessor the surviving edge
   descends from for auditing. The safe default **blocks** pending a §3.7
   carry-forward/amendment record; a git `-M -C` locator may *propose* it for human
   confirmation. This is a false-positive (over-blocking), never a laundering
   window.

Neither residual lets an obligation be shed while an accounted-for forbidden
coupling to its target survives.

---

## 10. Confidence

**High on discharge soundness within the analyzer boundary — now including the
`k = 0` cut, now SYMMETRIC and UNIVERSAL with no path-presence short-circuit.** Round-3
both families certified the invariant sound and unique while `k ≥ 1` and isolated the one
hole to `k = 0`; round-4 closed the first two shapes; round-5 closed three more; round-5's
own convergence isolated ONE remaining launder — a husk/stub at a PRESENT path defeating
the leftover net because the "path present ⇒ scan directly" fast-path short-circuited the
leftover computation on BOTH endpoints — which revision f closes. Discharge is authorized
only when (a) the current forbidden-edge count to the target identity — **computed over
each module's OWN item fingerprints** by the **universal** `L ⊆ S` leftover predicate
(§3.6, run on every `k=0` discharge with **no path-presence short-circuit**) — drops,
(b) the strictest obligations are carried weakest-first, **and** (c) the **occurrence
backstop over `analysis.edges`** — with the **symmetric content-match + dual-leftover**
`SH`/`LH` host identity — finds no obligated host still coupling to `T` (forbidden,
allowed, or same-owner), byte-scan failure promoting rather than discharging and a
leftover-fail refusing the discharge but never vetoing a landing. The `k = 0` laundering
shapes are structurally removed on **both** endpoints and made universal: the owner-relabel
(edited or same-owner-collapsed) leaves a resolved edge the backstop sees (N14/N15); the
record-less rename and the swapped-item rename resolve to the computed own-item `T2` or
**block** on the live leftover (N16/N13); the **husk**, the **parked-copy sink**, and the
**same-path byte-identical parked copy** are caught by the universal `L`-after-`S` with no
target short-circuit (N17/N18/N18b); the **obligated-host rename+edit** and the
**obligated-host husk** are caught by the symmetric `SH`/`LH` host rule with no host
short-circuit (N19/N20); and P4/P6/P7/P8 confirm the honest twins still admit (P4 via
promotion, not vetoed). The §4 matrix pins every historical, round-2, round-4, round-5,
and round-6 defeat to its refusing property, with **no** occurrence arithmetic in any
refusal rationale.

**Medium-high on the remaining soundness surface:** the §3.7 predecessor-anchored
**structured grant**, the §3.6 universal own-item `L ⊆ S` identity + symmetric `SH`/`LH`
host resolution, and the occurrence backstop are new and want their fixtures (N11b, N13,
N14–N16, **N17–N20**, **P4/P7–P8**) exercised through the real `--update-baseline` path
before a READY claim; the §3.1 pinned-AST integration adds a Rust-parser dependency to
a JS gate whose failure mode must be fail-closed.

**Bounded and disclosed** is the analyzer-relative residual (§3.10 / §9): the
conservation logic is sound *relative to* the analyzer, and the residual is the
analyzer's blindness (per-host scoped, the leading-`::` and self-edge cases now named,
and **not** where any round-4/round-5/round-6 shape lives), not a hole in the discharge rule.
**Medium on ergonomics:** the token-exact fingerprint, the universal own-item `L ⊆ S`
rule, and the symmetric `SH`/`LH` host block will occasionally over-block a genuine edited
move into a verbatim-carried obligation or a block — accepted per decision 4 and measurable
once implemented. Revision f is **ACCEPTED**: both families returned READY (grok
`VERDICT: READY`; codex CONCEDED after re-examination that the already-coupled-allowed-host
`LH` case is the **conservation boundary, not a hole**, now recorded normatively in §3.6).
The accepted verdict is that the `k = 0` predicate is
**symmetric and universal across both endpoints — computed own-item identity + the
universal `L ⊆ S` leftover with NO path-presence short-circuit + symmetric `SH`/`LH` host
resolution + leftover-fail as a discharge-refusal that preserves P4 + `analysis.edges`
backstop — with only the disclosed analyzer-invisible-rewrite residual, and closing the
husk seam WITHOUT pairing reference sites across snapshots (no move proof)**. Implementation
follows per §7.

## Revision history

- **f — ACCEPTED + consolidation (2026-08-16).** Round-6 reached **dual-READY**: grok
  returned `VERDICT: READY`; codex, which had flagged the already-coupled-allowed-host
  `LH` case, **CONCEDED** after re-examination that it is the **conservation boundary, not
  a hole**. Status flipped **Draft → Accepted**. Consolidation pass (no new design): folded
  grok's three minors and recorded the crux — (1) §3.6 now states the **normative evaluation
  order** (compute `S`/`SH` own-items-only → resolve `H` from a present content-match or a
  unique `SH` → compute `L` from `H` → decide `T` → compute `LH` from `T` → leftover-fail
  if `LH` sits outside its resolved `SH`), so an implementer cannot rebuild a path-first
  short-circuit by computing `L` off an empty `H` (a specification ordering, not a
  circularity); (2) §3.6 states the host **content-match gate is NOT a path-presence
  short-circuit** and why it is safe (`own(path) ⊇ own(Gi)` means the coupling-bearing items
  are still present, so a live coupling cannot hide behind the direct scan; a husk falls
  through to `SH`/`LH`); (3) §3.4 adds the **`violationReason` clause** — same-owner edges
  are `null`/allowed EXCEPT the `unassigned → god-file` exception (~lines 725–727), which
  stays forbidden and is therefore in `forbiddenEdges` (`k ≥ 1`, carried). Also recorded the
  **decisive review point** normatively in §3.6: a `k = 0` discharge is reachable **only**
  when every surviving coupling to `T` is allowed/same-owner (a forbidden survivor is in
  `forbiddenEdges` ⇒ `k ≥ 1` ⇒ conservation carries), so discharging then leaves no
  forbidden owner→owner dependency undetected; and `LH` is scoped to hosts reproducing
  `own(Gi)` or a new source carrying `Gi`'s coupling — **not** "every source to `T`" (which
  would regress genuine removals to shared targets, P7). No fixture, count, or `k = 0`
  algorithm changed; implementation follows per §7.
- **f (2026-08-16).** Round-6 dual-family super-refine (terminal). Both round-5 families
  (grok-4.6 + codex) CONVERGED on ONE remaining `k = 0` launder with the SAME fix, both
  explicitly NOT-shelve: a **husk/stub at a PRESENT path** defeated the leftover net
  because revision e's "path present ⇒ scan that path directly" fast-path
  **short-circuited the leftover computation on BOTH endpoints** — the target set
  `T ≡ Ti` on a same-path content match WITHOUT computing `L` (a byte-identical copy
  parked at the original target path discharged while the real edited API moved to
  `bar`), and the host scanned a present path WITHOUT a content-match or `LH` (a stub left
  at the old host path discharged while the live `service_a2 → service_b` edge sat in
  `analysis.edges` unexamined). Revision f makes the `k = 0` leftover check **TRULY
  SYMMETRIC and UNIVERSAL, with NO path-presence short-circuit** on either endpoint:
  (1) target identity **always** computes `S` and `L` — a present `Ti`-path only places
  that path INTO `S`, the discharge still requires `|S| = 1 ∧ L ⊆ S`, and
  `own(Ti) = ∅ ⇒ S := ∅`; (2) the HOST endpoint gets the **same content-match + dual
  leftover** `SH`/`LH` — a present host path is scanned, but a present husk
  (`own(path) ⊉ own(Gi)`) or an absent path computes `SH`/`LH`, with `|SH| = 1 ∧ LH ⊆ SH`
  ⇒ scan `H2 → T`, `SH = ∅ ∧ LH = ∅` ⇒ present scan is the backstop, else refuse
  discharge; (3) leftover-fail / `|SH| ≠ 1` is a **DISCHARGE refusal, NOT a push veto** —
  §3.4 byte-scan promotion still admits an honest merge (P4); (4) the "genuine re-owning"
  sentence is **DELETED** (a `k = 0` re-home to a new allowed module needs a §3.7 grant).
  §4 adds **N20** (N19 + present stub → BLOCK) and **N18b** (target same-path byte-identical
  parked copy → BLOCK); N17/N18/P7 re-grounded on a reliable outgoing-edge host; P4/P6/P7
  confirmed still admit; the matrix is now 28 negatives + 8 positives. No `k ≥ 1` machinery
  changed; no move proof reintroduced; no closed attack re-opened. Terminal self-verdict:
  the `k = 0` predicate is now symmetric + universal with leftover-fail as a
  discharge-refusal that preserves P4; closing the husk seam does **NOT** require pairing
  reference sites across snapshots (`S`/`L`/`SH`/`LH` are own-item + resolved-edge sets) —
  no move proof, not a shelve.
- **e (2026-08-16).** Round-5 dual-family super-refine (terminal). Both round-4
  families CONVERGED that the `k ≥ 1` machinery is sound/unique and isolated **three
  residual `k = 0` laundering holes**, all analyzer-VISIBLE and all closable without a
  move proof: (1) a **husk / parked-copy decoy** — a still-present husk path, or a
  single byte-identical parked copy, wins target identity for the wrong module; (2) an
  **obligated-host rename+edit** whose live `service_a2 → service_b` edge sits in
  `analysis.edges` unexamined because host identity failed and fell through to scanning
  the vanished `service_a` path; (3) the **§3.6 witness-set inconsistency** —
  all-carriers defined both over the inbound forbidden-edge carriers *and* over the
  target's own items (two different sets; the inbound reading would wrongly BLOCK an
  honest `git mv`). Both families supplied the same fix, adopted here: the `k = 0`
  predicate is made **TOTAL and SYMMETRIC** across both endpoints. §3.6 now computes
  identity over **one set — the module's OWN item fingerprints** (the inbound-carrier
  phrasing is deleted); **same-path identity REQUIRES a content match** (a husk is not
  `T = Ti`); identity is the **total `L ⊆ S` leftover predicate** run AFTER the
  candidate set `S` (`S = {M : own(M) ⊇ own(Ti)}`; `L = {targets of an obligated host
  that are a NEW target or carry any `Ti` item}`; `|S| = 1 ∧ L ⊆ S` carries, `S = ∅ ∧
  L = ∅` is genuine removal, every other case BLOCKS); and **obligated-host identity is
  symmetric and fail-closed** (a host resolved by its own items; a moved-and-edited or
  split host with no unique successor BLOCKS, never the genuine-removal branch). The
  §5/§6/§8 revision-c leftovers that still named byte-scan-over-allowed-occurrences as
  the discharge authority are rewritten to the `analysis.edges` occurrence backstop +
  computed identity. Minors: `ownership-correction` grants pin `direction` and
  `grantId` uniqueness; amendment grants must be **git-committed bytes ≤ the
  predecessor snapshot**, never a Linear field naming a SHA; §3.10 names leading-`::`
  crate-relative paths and the `to === from` self-edge inline as disclosed
  analyzer-invisible residuals. §4 adds N17 (husk → BLOCK), N18 (parked-copy
  identity-sink → BLOCK), N19 (obligated-host rename+edit → BLOCK); N13/N16 rationales
  re-grounded on own-items `L ⊆ S`; P7 re-grounded; matrix now 26 negatives + 8
  positives. No `k ≥ 1` machinery changed; no move proof reintroduced; no closed attack
  re-opened. Self-verdict: the `k = 0` predicate is **total and symmetric with only the
  disclosed analyzer-invisible residual — the leftover close does NOT force pairing
  reference sites across snapshots (no move proof)**.
- **d (2026-08-16).** Round-4 dual-family super-refine (convergence-or-shelve). Both
  round-3 families certified the conservation invariant **sound and unique while
  `k ≥ 1`** and isolated the one surviving hole to the **`k = 0` exit**, exploited by
  an *edited owner-relabel* (codex — relabel to allowed/same-owner + a trivial token
  so `k = 0` and the byte-scan misses `f`) and a *record-less target rename* (grok —
  `git mv` + path-token rewrites so every carrier fingerprint changes, no
  `module-relocation` filed, `k = 0` on the vanished path). Revision d closes only
  that cut, as a single deterministic algorithm and **without** a move proof:
  **§3.6 computes target identity** (all-carriers test runs automatically on an absent
  path; a leftover obligated host-edge to an un-identifiable successor **blocks**);
  **§3.4 replaces the byte-scan-as-authority with an occurrence backstop over
  `analysis.edges`** — any coupling from a predecessor-obligated host to `T`
  (forbidden, §2-allowed, **or** same-owner, for which `violationReason` is `null`)
  refuses the discharge, relying on **neither byte-identity nor `violationReason`**;
  **byte-scan failure PROMOTES** (admits P4, preserves N8); **§3.5 intersection
  records may be STRENGTHENED** by conservation without a §3.7 amendment (makes N9b
  the algorithm) but never weakened. Lower-severity: **§3.7 authorization is a closed
  structured grant** `{scope, kind, direction, priorFields, newFields}`, no
  clause-text interpretation; the **1→N split overclaim is trimmed** (fresh
  attribution per surplus successor); the **multi-Git-predecessor join** is a
  deterministic union/AND that over-blocks; **proven inversion is subordinated** to
  §3.2 (evidence that drops `k`, not an exit); the analyzer residual is scoped
  **per obligated host**. §4 adds N14 (edited owner-relabel → REFUSE), N15 (same-owner
  collapse → REFUSE), N16 (record-less rename → CARRY), P7 (computed-identity genuine
  removal → DISCHARGE), P8 (honest 1→N split → fresh attribution); N13/N11 rationales
  re-grounded on the computed identity / occurrence backstop. No `k ≥ 1` machinery
  changed; no closed attack re-opened. Self-verdict: the `k = 0` exit is **closed
  against both laundering shapes as one unique algorithm**.
- **c (2026-08-16).** Round-3 dual-family super-refine. Both round-2 families
  returned NOT READY on the same defect: the round-2 occurrence-matched "move
  proof" mistook two-snapshot occurrence identity for causal transfer
  (clone-and-mutate, coincidental add, edited-move fresh clock, two-push,
  stockpile). Reframe: **§3.2 replaced by an obligation-conservation invariant**
  over the analyzer's per-target forbidden-edge sets — carry the strictest
  `min(k,m)` obligations verbatim, shed only the weakest, no move locus, no
  byte-lineage, no occurrence arithmetic as causal proof; the round-2
  fingerprint-absence-⇒-discharge rule is **deleted** (decision 8). §3.4 adds the
  coupling-absence **byte-scan over current allowed occurrences** and drops
  `owner-rekey` as a lineage kind (decision 5, closes Codex #4). §3.7 anchors
  amendment **authorization on the predecessor snapshot** and names
  `priorFingerprint`/`newFingerprint` (decision 9, closes the same-push forge).
  §3.1 pins the carrier grammar to a **`syn` AST**, encodes ⟨kind, bytes,
  jointness⟩ with length framing, and **preserves `#[doc]` tokens** (decision 6).
  §3.6 pins target identity to **all** forbidden-edge carriers and **removes the
  similarity threshold** (decision 7). §3.4 defines **`null`-identity mixed-kind
  merge** (waiver + freeze keeps the waiver). §3.10 states the **analyzer-relative
  soundness boundary** and its fail-closed tightening. Preserved from round 2: the
  orthogonal `lineage`/`obligation` fields (expiry keyed on obligation) and the
  intersection walk, now made **full-record** immutable. §4 expands to nineteen
  negatives + six positives; §8 records the ruled OQs (no soundness parameter
  open); §9 discloses the two residuals.
- **b (2026-08-16).** Round-2 dual-family super-refine. Replaced existential
  fingerprint match with an occurrence-aware injective move proof, orthogonal
  `lineage`/`obligation` fields, verbatim carry-forward + surviving-obligation
  guard, total reconciliation including the intersection, many-to-many lineage and
  non-circular target identity, the amendment protocol, and a token-preserving
  carrier fingerprint. Defeated by both families: two-snapshot occurrence identity
  is not causal transfer; the move proof admitted clone-and-mutate and the
  discharge guard depended on an undefined move locus — all closed in (c).
- **a (2026-08-16).** Initial Draft. Byte-lineage derivation, predecessor-keyed
  discharge, obligation carry-forward, generalize `relocation`, five-attack
  matrix, LLP 0225 §2/§5 amendment record. Defeated in round-1 review by
  existential-match grandfathering, edited-move fresh-clock launder, the
  literal-stripping collision, the unchecked intersection, and owner-relabel
  discharge.
