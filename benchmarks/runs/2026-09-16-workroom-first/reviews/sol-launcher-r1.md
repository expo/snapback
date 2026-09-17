# Sol launcher review, round 1

Received 2026-09-16 from independent `gpt-5.6-sol`, xhigh, fresh review
session. Read-only; no other review supplied. Verdict: **MATERIAL**.
This artifact preserves the actual returned findings, not a synthesized review.

1. `run-pilot.mjs:193,223`: process-group cleanup is conditional on the Codex
   leader still running, and the escalation timer is cleared as soon as that
   leader closes. Concrete scenario: Codex starts a backend redirected to a
   log, the backend ignores/delays SIGTERM, and Codex exits promptly at the
   four-hour signal. The driver clears escalation and returns while the
   backend remains alive. Natural Codex exit likewise performs no residual-group
   cleanup. An exception after detached spawn can also bypass cleanup entirely.
   This breaks the cap and process-isolation lifecycle. Cleanup should be in
   finally, test the validated group itself, and record TERM/KILL plus confirmed
   group disappearance.
2. `run-pilot.mjs:134`: codex exec -o targets the same app/FINAL.md that the
   prompt requires the builder to author. Concrete scenario: the builder
   writes the required detailed report, then its short final chat response is
   written by -o, truncating/replacing that report. Preserve the last message
   under private/ separately and receipt the independently authored app/FINAL.md.
3. `run-pilot.mjs:105,240`: packet digests are checked only before execution.
   Read-only modes are not immutable against the same-UID, unsandboxed child.
   Concrete scenario: the builder chmods and patches a fixture/tool while
   debugging; acceptance then uses altered neutral material, but end.json
   records no packet-integrity failure. Re-hash the bound packet at termination
   and retain a pass/fail receipt.
4. `run-pilot.mjs:57,89`: the driver validates its own Node version but passes
   the ambient PATH without validating the node resolved there. Invoking the
   script explicitly with Node 24 while PATH resolves Node 22 satisfies
   preflight, yet all builder shell/npm commands use Node 22. Validate
   node --version under the exact child environment.

Reviewed SHA-256:

- stage-pilot.mjs: `f1ff8973d57afe3ec70bad62ea2b735cd3422b121f3ef1dadc0d3f806eba9177`
- run-pilot.mjs: `d6d7a9a92cf28ad4af6b3335cab98be82c15ed9796a6a3e4348788f3dfb97c13`
- pilot-prompt.md: `93969c649dab511b59e9d1d5bf212e732ad50b641b44950eaed07504feeeb260`

Both scripts pass node --check. Lead disposition: accept all four; repair and
mock-test before any real pilot launch. Independent Grok review is still pending.
