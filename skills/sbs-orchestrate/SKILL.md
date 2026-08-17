---
name: sbs-orchestrate
description: Orchestrate and supervise a body of work using a fixed model roster — codex gpt-5.6-sol (xhigh or high, orchestrator's call) for all coding implementation, BOTH codex gpt-5.6-sol AND grok-4.6 at xhigh for code review, and whatever model the orchestrator judges best for design, design docs, and other non-coding tasks. Use when the user invokes /sbs-orchestrate or asks to orchestrate/supervise work with the codex+grok roster.
---

# sbs-orchestrate

Invoke as `/sbs-orchestrate <work description, tickets, LLP refs, or free text>`.

You (Claude) are the **orchestrator and supervisor**. You plan, dispatch, monitor,
review-gate, integrate, and land. You do not write implementation code yourself —
delegate it per the roster below. Small mechanical glue (a one-line rebase fixup, a
lockfile regen) may be done inline when dispatching would be absurd; say so when you do.

## Model roster (fixed by this skill)

| Task kind | Who | Effort |
|---|---|---|
| Coding implementation | codex `gpt-5.6-sol` | `xhigh` or `high` — your call (see below) |
| Code review | BOTH codex `gpt-5.6-sol` AND grok `grok-4.6` | `xhigh` |
| Design, design docs, analysis, synthesis, planning | whatever model you judge best (Claude subagents, codex, grok) | your call |

**xhigh vs high for implementation:** default to `xhigh`. Drop to `high` for
mechanical or high-volume work where judgment density is low (bulk renames, test
scaffolding, applying an already-specified diff plan) or when wall-clock across many
parallel lanes matters more than per-lane depth. Record which you chose per lane.

## Workflow

1. **Plan.** Break the work into lanes with explicit deliverables and verification
   commands. Independent lanes get their own worktrees; state the lane plan to the
   user before dispatching.
2. **Design first when needed.** If a lane needs a design decision or doc, produce it
   with your best-judgment model choice before implementation dispatch, and give the
   implementer the doc, not a paraphrase.
3. **Dispatch implementation** to codex (recipes below), one lane per
   worktree/checkout. Briefs must include: exact scope, files in play, verification
   commands to run, and "commit locally; do not push."
4. **Supervise actively.** Poll from the orchestrator — do not trust lane subagents to
   self-resume (see traps). When a lane finishes or stalls with a usable commit,
   pick it up yourself.
5. **Review-gate every implementation** before landing: run BOTH reviewers (codex +
   grok, xhigh) on the actual diff/commit, independently — neither sees the other's
   review. Triage findings yourself: real → fix loop (back to codex, or inline if
   trivial) and re-review the fix delta; refuted → record the refutation. Land only
   when both reviews are clean or every finding is fixed or explicitly refuted.
6. **Integrate and land** per the repo's landing policy (rebase on fresh main, run the
   affected checks, push). Report per-lane outcomes honestly: what landed (SHAs),
   what's still open, what each reviewer caught.

## Codex recipes (paid-for, use verbatim)

- Non-interactive implementation run:
  `~/.volta/bin/codex exec -m gpt-5.6-sol -c model_reasoning_effort=xhigh -o <final.md> "<brief>" </dev/null`
  (swap `xhigh`→`high` per the effort call above; cwd = the lane worktree).
- Read-only review run:
  `~/.volta/bin/codex exec -m gpt-5.6-sol -c model_reasoning_effort=xhigh -s read-only -o <review.md> "<review prompt>" </dev/null`
  — add `--skip-git-repo-check` when reviewing a non-git dir (e.g. an exported capsule).
- **TRAP:** bare `codex` on PATH may be a cmux shim; shim-wrapped background lanes get
  killed when cmux restarts. Always invoke `~/.volta/bin/codex` directly.
- **Kill-proof background dispatch** (macOS has no `setsid`; harness task kills
  SIGPIPE piped children): launch via
  `python3 -c "import subprocess; subprocess.Popen([...], start_new_session=True, stdin=open(prompt), stdout=open(log,'w'), stderr=subprocess.STDOUT)"`
  and watch the `-o` final-message file for completion.

## Grok recipe

- `grok -p "<review prompt>" -m grok-4.6 --reasoning-effort xhigh --output-format plain --disable-web-search --permission-mode auto --max-turns 200`
  (cwd = the checkout under review; stdout is the final response, arriving at the end).
- **TRAP:** the grok wallet can 402 mid-run and top-ups may not reach the CLI's
  wallet. Probe with a cheap one-liner call before dispatching real reviews. If grok
  is unavailable, say so and ask the user whether to proceed codex-only or wait —
  never silently drop the second reviewer.

## Supervision traps

- **Subagent monitor stall:** lane subagents that background a codex run, arm a
  monitor, and end their turn go idle forever. As orchestrator, run your own poll
  loop (worktree HEAD vs base every ~60s, or watch the `-o` file) and land finished
  work yourself; SendMessage a stand-down to the lane afterward.
- **Fast-moving main:** `git fetch` + rebase immediately before every push and expect
  to retry. Before dispatching and before landing, check main for competing work on
  the same files/slug (concurrent agent fleets are normal).
- Follow any repo-specific landing law (e.g. this repo's CLAUDE.md / lane field
  manual memory) — this skill sets the model roster and supervision shape, not the
  landing policy.

## Reporting

End with a per-lane table: lane, implementer effort used, commit(s)/SHA landed or
current state, reviewer verdicts (codex / grok), open findings or refutations, and
what remains. Never claim a review happened that didn't; a skipped or failed reviewer
is reported as such.
