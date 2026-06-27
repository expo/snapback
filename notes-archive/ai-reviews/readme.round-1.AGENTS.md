# Review: README, Round 1

**Reviewed:** 2026-06-25
**Reviewer:** Codex
**Target:** `README.md`

## Overall Assessment

The README is readable and gives a strong first-pass explanation of Snapback.
It captures the pitch, the v1/v2 split, the platform pieces, local-first,
realtime, MIT licensing, and the LLP workflow. It is good for an early public
repo with no runnable code yet.

The biggest issue is audience ordering. The founder brief says Snapback is
primarily for Contract/Exact and that agent DX is critically important while
human DX is not the driver. The README currently reads first as a human-facing
backend-platform pitch, then introduces Contract/Exact and agent-first later.
That is not fatal, but it can let early contributors optimize for the wrong
audience.

## Strengths

- The opening pitch is concise and memorable.
- The status callout correctly says there is no runnable code yet.
- The parts list is concrete enough for readers to understand the intended
  backend surface.
- The README does not overspecify v2; AI/data gateway is correctly marked
  post-launch.
- The LLP section tells contributors how design rationale is expected to live
  in the repo.

## Concerns

1. **Primary audience appears too late.** Contract/Exact and agent-first are the
   core design drivers, but they do not appear until the Principles and mobile
   sections. A reader could reasonably think the primary audience is generic
   human developers building any app backend. If that is not intended, move the
   priority order earlier.

2. **The agent-first principle is softened.** The README says apps will be
   "mostly" built by AI agents. The founder brief was stronger: basically all
   code for Snapback should be expected to be agent-written, and human DX does
   not really matter compared with agent DX. If that is the real constraint,
   say it more sharply.

3. **The scale claim needs caveats in the README.** The north-star statement
   about a few hundred thousand monthly users on SQLite plus a lightweight
   runtime is compelling, but it needs to be framed as a goal with workload
   limits, not as a broad promise that any app of that size will work.

4. **Asset storage wording is too categorical.** "Not inside the database" is
   directionally right for object bytes, but a backend platform will almost
   certainly store asset metadata, processing state, permissions, and references
   in SQLite/Postgres. Use more precise language so future agents do not avoid
   the database for asset-adjacent state.

5. **The Valet wording is candid but maybe too casual for a public README.**
   "A bit of a mess now" is useful internal context, but public readers may
   hear it as dismissive or unstable. The LLP can keep the frank version; the
   README might say Valet was an earlier prototype whose architecture and
   empirical failures will inform Snapback.

6. **No roadmap from design docs to implementation.** The README says the
   design is being worked out in LLPs, but does not name the immediate next
   design documents. A short "Next design work" section could guide agents and
   contributors toward storage, sync/realtime, runtime/deployment, auth, and
   Valet retrospective.

## Suggestions

- Move Contract/Exact and agent-first into the first "What it is" section, not
  only the Principles section.
- Change the agent-first line to cover Snapback's own implementation and apps
  built with Snapback.
- Rephrase the scale target as "the goal is..." and link to LLP 0000 for
  caveats and benchmark work.
- Say "asset bytes live in filesystem/object storage; metadata and workflow
  state live in the database" instead of "not inside the database."
- Soften the Valet paragraph for public tone while preserving the useful
  pointer to prior empirical work.
- Add a brief "Next LLPs" list matching LLP 0000's follow-on list.

## Open Questions

- Should this README optimize for public open-source readers now, or for agents
  and internal Exact/Contract work until code exists?
- Should Contract/Exact be named in the tagline or first paragraph?
- What is the first supported hosted target after local development?
- Is the README allowed to make scale claims before a benchmark LLP exists?

## Status Recommendation

The README is good enough as an early design README, but it should be revised
before inviting broad outside contributors so the audience priority and scale
claims are not misread.

The LLP process also recommends a GPT review unless this Codex review is the
GPT review wanted for this round.
