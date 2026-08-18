# Review: LLP 0005 Contract/Exact and React integration, Round 1

**Reviewer:** Codex
**Date:** 2026-06-25
**Target:** `llp/0005-contract-exact-react-integration.explainer.md`

## Overall assessment

This is a useful LLP document and should stay in the corpus. It captures a real
product boundary that the root LLP intentionally leaves open: Snapback is
Contract/Exact-first, but React/Expo must remain a serious secondary consumer
over the same backend model.

The central idea is good: Contract/Exact gets the richest paved path and Design
Mode integration, while React/Expo uses framework bindings over generated
Snapback artifacts. The document is careful not to invent the missing canonical
definition of Contract/Exact, which is the right level of restraint.

The main weakness is that the first draft says "same generated Snapback
contract" several times without naming the contract's likely parts or making it
testable. That leaves room for future code to drift into hidden bridge logic,
one-off project templates, or a React adapter that accidentally becomes a second
client model.

## Strengths

- It preserves the root LLP's priority order without making Snapback a private
  backend for Contract/Exact.
- It gives React/Expo a strong role and explicitly includes local-first partial
  sync, live queries, pending mutation state, and diagnostics.
- It keeps sync and authorization in Snapback rather than letting clients hide
  unauthorized or unsynced data visually.
- It treats diagnostics as part of the product surface for both Design Mode and
  agent-edited React apps.
- It leaves the canonical Contract/Exact definition open instead of guessing.

## Concerns

1. **The shared contract needs a name and shape.**
   The draft relies on "generated Snapback artifacts" as a phrase. That is
   directionally right but too soft. A future implementation should have a
   headless integration contract that both adapters consume, with at least
   schema/function manifests, generated function references, capability reports,
   and diagnostics.

2. **The document needs an acceptance path.**
   Without a validation section, "same backend, different adapters" is easy to
   say and hard to enforce. The LLP should say how we would know the integration
   boundary is working.

3. **Design Mode source of truth is still ambiguous.**
   The draft says Design Mode actions produce or modify Snapback artifacts, but
   does not say whether the durable truth is source files, generated manifests,
   an intent log, or some mix. That can remain open, but it should be called out.

4. **React should not be framed only as a hook layer.**
   Hooks are likely, but the deeper requirement is that React/Expo can run a
   serious local-first app without Contract/Exact present. The draft says this,
   but could make it more explicit in validation criteria.

## Suggestions

- Add a section defining the headless integration contract as the shared layer
  under Contract/Exact and React/Expo adapters.
- Add a validation path with concrete checks: one generated backend, one
  Contract/Exact surface, one React/Expo surface, shared diagnostics, and no
  private backend semantics.
- Tighten the Contract/Exact section so Design Mode is a consumer/editor of
  Snapback source and generated artifacts, not a hidden side channel.
- Add open questions about the generated file split, local store ownership, and
  whether Design Mode persists an intent log or only source edits.

## Open questions

- What exactly is the generated integration contract: one manifest, several
  generated files, a package API, an adapter protocol, or all of these?
- Does Design Mode persist high-level authoring intent, or only materialize
  source files and generated manifests?
- Which layer owns the client local store lifecycle in React Native and Expo?
- What minimum cross-adapter fixture proves that Contract/Exact and React are
  using the same Snapback semantics?
- Should LLP 0005 move to `Review` after these revisions, or stay `Draft` until
  the canonical Contract/Exact definition exists?

## Revisions applied

After this review, the LLP was revised to add an explicit headless integration
contract, a validation path, and sharper open questions. The status remains
`Draft`; promotion to `Review` should be a human decision.
