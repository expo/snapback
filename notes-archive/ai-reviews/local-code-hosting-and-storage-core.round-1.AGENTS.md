# Review: LLP 0003 Local Code Hosting and Storage Core, Round 1

**Reviewed:** 2026-06-25
**Reviewer:** Codex
**Target:** `llp/0003-local-code-hosting-and-storage-core.rfc.md`

## Overall Assessment

This is the right first implementation RFC. Code hosting, SQLite ownership,
Ibex handler execution, schema application, and realtime delivery are one
vertical slice; splitting them before anything runs would create false seams.

The main issue was terminology: the doc used "API" in places where it meant
HTTP/WebSocket transport. That risked conflicting with LLP 0004, which should
own the app-facing API contract.

## Strengths

- It turns LLP 0000's implementation order into a buildable local server shape.
- It correctly inherits Valet's useful shape while keeping Valet failure modes
  open.
- It names concrete server responsibilities instead of staying abstract.
- It includes agent/test feedback as a first-class requirement.

## Concerns

1. The product API and wire transport needed sharper separation.
2. Temporary bring-up routes could accidentally become app-facing API if not
   marked internal.
3. The trigger plus polling realtime pipeline is plausible, but still depends
   on Valet retrospective and prototype validation.
4. Security/isolation remains deferred but adjacent to any code-execution work.

## Suggestions

- Keep `Status: Draft`.
- Treat LLP 0004 as the contract the local core implements.
- Mark any non-generated routes as internal/admin/diagnostic.
- Validate the pipeline with one tiny app before broadening subsystems.

## Open Questions

- How much of Valet's wire protocol should be copied?
- Does Ibex need fresh runtime per invocation for v1?
- Where should local app database files live by default?
- Which Valet failures should harden this RFC before promotion?

## Revisions Applied

- Reworded client-facing "API" language to "transport surface."
- Added a `Relationship to LLP 0004` section.
- Added the public wire protocol shape to deferred work.

The LLP process also recommends a GPT review unless this Codex review is the GPT
review wanted for this round.
