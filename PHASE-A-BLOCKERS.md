# Phase A semantic blockers

**Status:** Resolved by the 2026-08-15 author rulings below; no Phase A
semantic blocker remains.

## 2026-08-15 — sharing-plan grammar and generated-op inputs

LLP 0239 D4's 2026-08-15 dated ruling defines the admitted *classes* of
sharing, requires the collection descriptor to own a ceiling and default, and
explicitly makes the as-built descriptor/operation surface the normative
spelling. It still does not define the concrete `assetCollection({ grants:
... })` data grammar, the generated operation argument carrying an
active/pending recipient plan, how a named generated derivation is invoked
inside this HostPlan, or how the RFC example's `"inherit-command"` value
behaves when `append`/`replace` is invoked outside a Phase-B media command. The
existing table `assetSharing(...)` declaration is a single via-reference read
policy, not a maximum/default set of grant mutations.

Question: what exact versioned declaration and generated-op input shapes bind
the collection sharing ceiling/default and the operation-selected plan without
creating ambient principal authority? Phase A must not invent this authority
grammar. Work on collection storage, no-grant attachment lifecycle, identity,
reads, invalidation, GC, and cut custody can proceed independently.


---

## AUTHOR RULINGS (Charlie, 2026-08-15, relayed by orchestrator) — both blockers RESOLVED

### Ruling 1 — sharing-plan grammar: ship the FULL closed grammar in Phase A

Define the closed `grants` grammar now, covering exactly the D4-admitted
classes and nothing more:

- the collection descriptor owns a **ceiling** (the set of admitted sharing
  classes) and a **default** plan;
- admitted classes: no grant change; owner-only attachment; active or pending
  recipient grants per LLP 0210/0220; app-authorized recipients derived by an
  explicitly named generated function; `inherit-command` (valid only where an
  exact versioned command binding exists — Phase B; declaring it in the ceiling
  is legal in Phase A, selecting it outside a command binding refuses);
- each generated op (`append`/`replace`/`remove`) takes one exact plan
  selection within the ceiling, defaulting to the descriptor default; it can
  never broaden the ceiling;
- no client-supplied principal is authority by assertion: recipient principals
  are admitted only through the declared 0210/0220 grant ops or the named
  generated derivation function, revalidated at commit time;
- parent-row/authority-profile-derived sharing stays generation-refused (R5).

Derive the exact JS/type surface consistent with these constraints and the
existing 0210/0220 grant-op shapes; keep every refusal source-attributed. The
orchestrator is recording this ruling as an LLP 0239 amendment and will
reconcile the amendment's example to your as-built grammar before landing.

### Ruling 2 — `order: "created"`: reorder REFUSES AT GENERATION

- Created-order collections do not emit a `reorder` op. Declaring a collection
  with `order: "created"` and then invoking/generating reorder refuses with a
  source-attributed diagnostic whose remediation points at `order: "manual"`.
- `replace` under created order: retained items keep their original creation
  order; newly allocated items follow all retained items, ordered by input
  position within the replacement attempt.
- No second ordering concept: `created` means creation sequence, immutable.

## As-built resolution

- `grants` is either the shorthand `"none"`, `"owner-only"`, or
  `"inherit-command"`, or an object with a named `ceiling` (at most eight
  plans) and an input-free `default` plan.
- Named plans cover the five ruled classes exactly: `none`, `owner-only`,
  bounded active/pending `recipients`, bounded active/pending `derived`, and
  `inherit-command`.
- `append`, `replace`, and `remove` accept one optional exact `sharing`
  selection. Direct-recipient selections contain a bounded principal list;
  derived plans name a generated owner-authorized query whose rows supply the
  principal field. Every selection is revalidated during the ordinary commit.
- `inherit-command` can be declared but direct Phase A invocation refuses
  until Phase B provides the exact command binding.
- Created-order collections omit the generated reorder operation and preserve
  the dated ruling's immutable creation sequence in `replace`.
