# Prioritize and execute LLP 0235 field masking from real app demand

**Status:** Open
**Impact:** 5
**Urgency:** 3
**Ease:** 1
**Confidence:** 5
**Systems:** Field masking, Authorization, Queries, Live delivery, Code generation
**Date:** 2026-08-21
**Governing:** Draft LLP 0235; LLP 0231 D3; LLP 0053
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
The missing artifact is a reviewed execution decision and implementation plan.

## Required work

- Bring LLP 0235 through author review/acceptance or record a bounded reason to
  shelve it; use the Messtimate phone-field case as an additional acceptance
  fixture beside pointing-room.
- Cost the conservative executor/physical-certification blocker and sequence a
  smallest claimable local-target slice.
- Preserve exact field-addition fences, noninterference positions, handler-read
  masking, writeback semantics, view revisions, and remasking obligations.
- Until the spec is accepted and implemented, add a Guide recipe for the honest
  split-table workaround and label field masking a GAP.

## Acceptance

- The corpus has one explicit product ruling: accepted implementation plan or
  shelved decision with reopen criteria.
- Any shipped slice passes both vote-value and phone-number cases through
  direct plans, handlers, live updates, identity switches, hidden-only changes,
  and disclosed-to-masked transitions.
- No convenience helper ships ahead of LLP 0235's physical and logical
  noninterference gates.

