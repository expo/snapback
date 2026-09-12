**Reviewer family:** OpenAI
**Provider / runtime:** Codex CLI; requested gpt-5.6-sol, xhigh
**Date:** 2026-09-12
**Redacted:** no; repository source only
**Method:** Independent read-only source review. No Grok review was supplied.

# LLP 1023 implementation review — Sol

## Round 1

Candidate: `5d46d2ab55a747c876d1595f224026231d229bcb`; base: `a41a132f8200ea20c5cb80300b4a4837d31389d8`.
Prompt SHA-256: `10de92a167d5e272aeea91f085848120f5fded28c62763088ed75fe392fea793`.
The workspace advanced to `71039e4a86` for native package-version alignment;
its product implementation was identical. CLI exited successfully and returned
the following actual review. No served model identity beyond the requested
configuration was reported here.

Verdict: MATERIAL

- Material — demonstrated control-flow defect: a post-admission auth-cleanup failure loses the durable intent identity. In [client-mutations.ts](/Users/ccheever/projects/snapback-worktrees/clique-shapes/snapback2/packages/snapback2/src/client-mutations.ts:90), `terminalRefusal()` is awaited before the admitted-aware return at line 95. If an admitted mutation receives `E_AUTH_SESSION` and either sealing or `tokenStore.save(null)` fails, existing cleanup propagates that failure ([client.ts](/Users/ccheever/projects/snapback-worktrees/clique-shapes/snapback2/packages/snapback2/src/client.ts:1189), [client.ts](/Users/ccheever/projects/snapback-worktrees/clique-shapes/snapback2/packages/snapback2/src/client.ts:1301)). Execution therefore bypasses line 95; the outer public catch returns a `rejected` result without `intent` ([client.ts](/Users/ccheever/projects/snapback-worktrees/clique-shapes/snapback2/packages/snapback2/src/client.ts:342)). The original entry remains durably queued/sealed and can later commit, but the caller cannot correlate the refusal with that work and may submit a duplicate. This violates LLP 1023.002’s committed-carrier boundary and the new refused-wait identity contract. Route cleanup failures through the admitted-aware mapping, preserving the captured intent and the appropriate typed refusal. Add a deterministic durable-mutation test where token clearing or sealing fails after admission, then verify same-account recovery commits that exact intent once.

I found no other material defect in the once-media occurrence matching, uniform-merge accounting, hub cursor forms, or Timed Insights recipe. The digest eligibility gap remains explicitly documented and unclaimed, so I did not treat it as a new defect.

Per instruction, I did not run builds or tests; reported size and browser qualification were not independently reproduced.
## Integrator disposition after round 1

The admitted-intent finding was reproduced with four deterministic file-carrier
controls. `f65f1e463b` preserves the cleanup refusal and original admitted intent;
209 affected custody/auth/recovery tests pass. Independent delta review is still
pending. This disposition does not change the reviewer's original verdict.

## Round 2

Candidate: `ade40815509be3bb5ab873de3d2c02bc5182f6b0`; base: `89b705dbb222ecb77977b586377ca39447cad854`.
Packet SHA-256: `c6a99339bd59428a03852bfa0ddf9037b8512934b8fdce1fb67eb94bcba46c42`.
Provider/runtime: Codex CLI, requested `gpt-5.6-sol`, xhigh.
Fresh packet-only review received its own prior finding and repair, no peer review.
Session: `01a093b9-2726-7da0-9d0e-f0d141eac61a`; process exited 0.

Verdict: MATERIAL

- Material — the candidate removes the existing author authorization for post updates and deletes at [schema.q](/Users/ccheever/projects/snapback-1023-20260912/panel/workspace/snapback2/packages/compiler/fixtures/quarry-fanout-guide/snapback/schema.q:11), while retaining `feeds.editPost` and `feeds.removePost` in [feeds.q](/Users/ccheever/projects/snapback-1023-20260912/panel/workspace/snapback2/packages/compiler/fixtures/quarry-fanout-guide/snapback/feeds.q:18). Trigger: a post author invokes either shipped mutation. With no authorizing update/delete rule, the operation refuses; published posts can no longer be edited or removed, and removal cannot maintain the paired `postHeads` lifecycle. This is a regression of previously accepted main behavior introduced while expanding the hub fixture, not a necessary read-model change. Smallest correction: restore:
  ```q
  update <- .author = viewer
  delete <- .author = viewer
  ```
  Retain a runtime control proving the author can edit/remove, another principal cannot, edits preserve the head, and removal deletes both post and head.

The prior durable-identity finding is repaired in the inspected source: admission is captured after carrier completion in `client-outbox.ts`, and [client-mutations.ts](/Users/ccheever/projects/snapback-1023-20260912/panel/workspace/snapback2/packages/snapback2/src/client-mutations.ts:89) now maps cleanup failures through the admitted-aware result with the original intent. I found no remaining material issue in that path, the uniform-merge accounting, the owner consumed-image sequence repair, or the small runtime refactors.

Unconfirmed hypotheses: none.

The digest final-emission eligibility gap remains explicitly unfulfilled and was not treated as a defect or completed capability.

Limitations: packet-only static review. I did not run commands, tests, builds, browser checks, or independently reproduce reported validation and measurements. I did not inspect credentials or peer reviews and remained mutually blind.

Integrator: the prior admission cleanup finding is resolved by this reviewer. The new fixture author-rule regression is assigned for correction with author/other-principal and paired-head lifecycle controls. Its repair and subsequent template/diagnostic changes still require a scoped delta review.
