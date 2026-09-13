# Prioritize and execute LLP 0235 field masking from real app demand

**Status:** Open
**Impact:** 5
**Urgency:** 3
**Ease:** 1
**Confidence:** 5
**Systems:** Field masking, Authorization, Queries, Live delivery, Code generation
**Date:** 2026-08-21
**Governing:** Accepted LLP 0235; LLP 0231 D3; LLP 0053
**Ruling:** Accepted by author ruling 2026-08-22 as the governing class-M
design; implementation is scheduled after LLP 0294 W6 closes
**Evidence:** Messtimate published-0.1.24 diary (phone number split into a
second table solely to hide one field)

## Problem

Real application work now confirms the product demand behind LLP 0235: a row
needed to remain consumer-visible while one phone-number field did not. The app
split the sensitive field into a second table because current Snapback has
row-level visibility but no claimable field-level masking/projection.

LLP 0235 already contains the needed security design and explicitly prevents a
naive `maskField` helper from leaking through filters, ordering, joins,
aggregates, constraints, diagnostics, handlers, or live timing. Creating a new
LLP or shipping projection-only nulling would duplicate or violate that owner.
The design decision is now accepted. The missing artifacts are the costed
implementation plan and implementation itself, sequenced after LLP 0294 W6.

## Required work

- After LLP 0294 W6 closes, cost the conservative executor/physical-
  certification blocker and sequence a smallest claimable local-target slice;
  use the Messtimate phone-field case as an additional fixture beside
  pointing-room.
- Preserve exact field-addition fences, noninterference positions, handler-read
  masking, writeback semantics, view revisions, and remasking obligations.
- Until the spec is implemented, retain the Guide recipe for the honest
  split-table workaround and label field masking a GAP.

## Acceptance

- The corpus records LLP 0235 as the accepted governing class-M design, with
  implementation sequenced after LLP 0294 W6 closes.
- Any shipped slice passes both vote-value and phone-number cases through
  direct plans, handlers, live updates, identity switches, hidden-only changes,
  and disclosed-to-masked transitions.
- No convenience helper ships ahead of LLP 0235's physical and logical
  noninterference gates.

## Interim Guide deliverables — 2026-08-21

The interim deliverables from LLP 0294 W8 and Sequencing 8 landed without
waiting for a masking implementation:

- `guide/recipes/split-sensitive-fields.md` documents the honest split-table
  workaround using Messtimate's phone-number case, including separate reads,
  bounded owner-only joins, and explicit nonclaims;
- `guide/capabilities.md` records field masking as a GAP owned by Accepted LLP
  0235; and
- retrieval-eval case 80 preserves the diary's plausible wrong vocabulary.

The 2026-08-22 author ruling accepts LLP 0235 as the governing class-M design
and sequences implementation after LLP 0294 W6 closes. This ticket remains
**Open** because it tracks costing, productization, implementation, and the
required evidence. Until those land, the split-sensitive-fields workaround is
the only shipped pattern and keep-row/null-cell disclosure has no shipped
answer.
