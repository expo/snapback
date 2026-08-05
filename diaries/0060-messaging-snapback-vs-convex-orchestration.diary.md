# 0060 — Orchestrating a Snapback-vs-Convex messaging bakeoff

**Date:** 2026-08-05
**Systems:** Agent orchestration, worktree isolation, git integration
**Related:** `demos/messaging-snapback` (0058), `demos/messaging-convex`,
`diaries/0058-messaging-snapback.diary.md`,
`demos/messaging-convex/NOTES.md`

## What this is

Not a diary of building an app — a diary of orchestrating two independent
agents building the *same* messaging app spec in parallel, one on Snapback,
one on Convex, each in an isolated git worktree, then landing both on main.
The user asked for this comparison explicitly and also asked me to keep this
meta-diary, so it's going in `diaries/` even though I didn't touch either
app's code directly.

## What felt good

- **Isolated worktrees were the right call and cost nothing extra.** Each
  agent got its own worktree/branch, so two `expo start` dev servers, two
  `npm install`s, and two independent commit histories never collided. I
  didn't have to think about port conflicts or file races between the two
  builds at all — I only had to think about it once, at merge time.
- **Fully self-contained prompts meant zero mid-flight questions.** Both
  agents ran 15-20+ minutes unattended (1.0M+ and 1.3M ms respectively) and
  came back with everything I asked for — including things I asked for
  somewhat speculatively, like "prove the typing indicator with a genuinely
  independent second client, not a mocked one." Both agents actually did
  that (a second `SnapbackClient` Node script; a second Puppeteer tab with
  its own session identity) rather than faking it or skipping it quietly.
  That was worth spelling out explicitly in the prompt — "must actually do
  this, not just claim it" — because both reports came back with concrete
  artifact paths (screenshots, scripts) I could have spot-checked.
- **The two agents independently surfaced real backend bugs**, not app bugs:
  Snapback's dev-mode asset upload caller-identity gap and CORP header
  mismatch; Convex's non-ASCII-key query serialization, Node action
  filesystem restriction, and circular-type inference on untyped
  `ctx.runMutation` callers. None of these were things I asked them to look
  for — they fell out of just building the same ordinary feature (image
  messages, grouped reactions) against each platform. A same-spec bakeoff is
  a decent bug-finding technique almost for free.

## What felt bad / surprising

- **`git merge-base --is-ancestor origin/main HEAD` failing wasn't a merge
  conflict, it was just staleness** — both worktrees had branched off an
  origin/main from before the build started, and origin had moved ~20+
  commits in the interim (this repo has a live multi-session fleet pushing
  to main continuously, per existing memory). I had to `git fetch` +
  `git rebase origin/main` in each worktree before either branch was
  fast-forwardable, even though neither branch's diff touched anything main
  had changed. This is expected given the concurrent-fleet reality of this
  repo, but it means "verified in the worktree" and "fast-forwardable onto
  current main" are two different checks, and skipping the second one would
  have made the `git push origin HEAD:main` fail non-obviously later, or
  worse, push a merge commit I didn't intend.
- **I nearly took a stale "final report" at face value.** The Convex agent's
  first stop event returned mid-task ("I'll pause here and wait for the
  background e2e script and monitor to report back") — that's not a
  completion, it's a checkpoint, but the task-notification framing
  (`status: completed`) made it easy to almost treat it as one. Resuming it
  with an explicit "finish or tell me honestly you're blocked" got a real
  final report with a concrete commit hash and an explicit "working tree is
  clean, no secrets staged" confirmation. Worth treating any subagent report
  that ends on a to-do rather than a result as incomplete by default, even
  when the wrapper says the task finished.
- **Discovering *other* concurrent sessions were doing near-identical work.**
  While landing my two branches I found `demos/relay-room-bakeoff/` and
  `demos/tandem-expo-bakeoff/` sitting untracked in the shared main
  worktree, plus `diaries/0058-relay-room-expo-backend-bakeoff.diary.md` and
  `0059-tandem-expo-messaging-bakeoff.diary.md` already landed — evidently
  the "other agent" the user mentioned (and possibly more than one) was
  running the same kind of messaging-app bakeoff at the same time, unrelated
  to my two agents. I left those files alone per instructions, but it's a
  reminder that "don't copy their work" was necessary advice, not
  boilerplate caution — the collision was real and simultaneous, not
  hypothetical.

## What I'd do differently

- I'd ask each agent to `git fetch && git rebase origin/main` itself right
  before its final commit, instead of leaving that entirely to the
  orchestration step — it would have caught the staleness earlier and saved
  a round trip, and the agent doing its own rebase has the context to
  resolve any real conflict, whereas I as orchestrator would have had to
  re-delegate a conflict back to a fresh agent with less context.

## Verification performed

- Confirmed both branches rebased cleanly onto `origin/main` with no
  conflicts, `git merge-base --is-ancestor origin/main HEAD` true for both
  immediately before push, and both `git push origin HEAD:main` calls
  reported clean fast-forwards (`4cf4f453b..4b30b364e`,
  `4b30b364e..a945acd12`).
- Did not re-run either app's verification myself — deferred to each
  agent's own evidence (headless acceptance suite + screenshots for
  Snapback; two-tab Puppeteer session + screenshots for Convex), since
  re-driving both dev servers myself would have duplicated, not
  strengthened, what was already independently verified.
