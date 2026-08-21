# Retrieval eval run — 2026-08-21 — Familiar handler dialect (cases 63–68)

**Fixture:** fresh `gpt-5.6-sol` Codex context, read-only in the LLP 0295
lane worktree, with `AGENTS.md` as the repository steer and each exact diary
phrase queried independently.

**Verdict: PASS.** The Familiar page was reached and all requested rewrites
were recovered in 12 of 15 tool calls: `array[i]` → `for...of` or a literal
index; imported helper → same-file named function declaration; top-level
`const` capture → handler-local value or validated args; `Date.now()` →
`ctx.runtime.now()`; mutation document arrays → one document or a closed
receipt/id array; app-side counter → Explicit declared sequences; point read
→ a singleton relational array until direct-value Familiar execution is
qualified.

## Agent tool transcript

1. Read `AGENTS.md`.
2. Read the Guide/start indexes.
3. Read the no-template mental model.
4. Literal lookup: `array[i]`.
5. Literal lookup: `imported helper`.
6. Literal lookup: `top-level const`.
7. Literal lookup: `Date.now`.
8. Literal lookup: `document arrays`.
9. Literal lookup: `app-side sequence allocation`.
10. Literal lookup: `point read`.
11. Read the routed Familiar, sequences, and query sections.
12. Followed the documented dense-number vocabulary and completed the rubric.

## Post-landing note

The six dialect rewrites above remain the retrieval verdict. After this run,
the packed Familiar document-result parity receipt landed: bare and nullable
document queries now generate and execute as direct values, query document
arrays remain row-shaped, and mutation/action document arrays refuse before
activation output. The former singleton relational-array point-read wording in
the run record is historical evidence, not current guidance.
