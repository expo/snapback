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

## Round 3

Candidate: `cee80bc1d056f3a23087ceb338da41cc156776de`; delta from `ade40815509be3bb5ab873de3d2c02bc5182f6b0`.
Packet SHA-256: `b9bdfdd5b052600fe11a1c7c6a82c9513e7144f0e849ad11ba737ac33ee12b91`.
Fresh mutually blind packet-only review; same requested family/model/effort as above.
Session: `01a093e4-15ea-7272-8202-ed6673ba8e57`; process exited 0.

Verdict: READY

No material finding remains in the scoped delta.

The prior author-CRUD regression is repaired at [schema.q:13](/Users/ccheever/projects/snapback-1023-20260912/panel/workspace/snapback2/packages/compiler/fixtures/quarry-fanout-guide/snapback/schema.q:13), with controls covering author edit/removal, foreign refusal, stable heads on edit, and paired deletion.

The merge diagnostic is now restricted by returned-page provenance and pool ownership at [closure.rs:92](/Users/ccheever/projects/snapback-1023-20260912/panel/workspace/snapback2/crates/snapback2-core/src/certificate/search/closure.rs:92). The React and Expo templates retain only the opened asset and message identity, scoped to the account and conversation, while preserving the keyed mounted view after publication disappears: [React Thread.tsx:15](/Users/ccheever/projects/snapback-1023-20260912/panel/workspace/snapback2/packages/snapback2/templates/chat/react/src/Thread.tsx:15), [Expo Thread.tsx:11](/Users/ccheever/projects/snapback-1023-20260912/panel/workspace/snapback2/packages/snapback2/templates/chat/expo/src/screens/Thread.tsx:11). The enqueue path returns its prepared admitted identity without a vulnerable post-commit reread at [outbox.ts:443](/Users/ccheever/projects/snapback-1023-20260912/panel/workspace/snapback2/packages/snapback2/src/store/outbox.ts:443); durable FIFO order remains carrier-owned.

Unconfirmed hypotheses: none.

This is readiness for the supplied delta only. Digest final-emission eligibility remains explicitly unfulfilled, the historical 1% comparison still fails, the 80,000-byte target remains unmet, and production qualification/publication remains pending.

Limitations: frozen-packet static review only. I did not browse, run commands, builds, tests, or benchmarks; edit files; inspect credentials; access remote machines; or read peer reviews. Reported validation and measurements were not independently reproduced.
Integrator: this resolves the reviewed source findings. The actual full test script passes at the candidate; the inherited historical byte comparisons remain failed. Later imported main changes retain their own provenance. A separate small review covers the two manually reconciled guide pages. No digest or fresh-wave success is inferred.

## Guide integration follow-up

Candidate: `4229f3143917c24a9b7374a334b4010b1762cc2f`; scope is only the manual fanout/merge guide reconciliation after imported main `4a4249f7cc`.
Packet SHA-256: `550ef6a3618d2aab6a5406ba325bc89802c273ef243275fba046a1deb211b850`. Fresh mutually blind sessions; no tools or peer review.
Session: `01a093f1-bc9b-7220-95e3-5f0907956ea4`; exit 0.

READY

No material integration defect found.

- Both intended paths survive: grouped search retains membership-order pagination, empty groups, and separate chat cursors; global search adds full scope discovery plus per-conversation heads/refills.
- The added Q forms exactly match the supplied `feeds.q` fixture. Their prefixes align with `byPrincipalConversation` and `bySearch`, leaving the message suffix `(at, id)`, and their generated argument shapes match the TypeScript recipe.
- Authorization remains sound: scope discovery is restricted to `memberships[viewer]`; message reads remain governed by the membership-based `messages` read rule.
- Cursor and completeness guidance is sound: cursors remain opaque and operation-specific; dynamic scope discovery is distinct from authored bounded merge lanes; term/membership changes require recreating the pager; separate reads have separate snapshots; capped/truncated conditions are surfaced through page state/issues.
- `merge.md` preserves the prior completeness definition while correctly integrating named/positional prefixes, system-read limits, and the distinction between bounded Quarry lanes and the client-side 1,000-scope pager.

Non-material wording hypothesis: “`(at,id)` scalar order” applies specifically to each fixed-conversation message lane, not the `searchScopes` cursor. The installed recipe makes that explicit, so this does not warrant MATERIAL.

This is a manual review of the supplied integration only. I did not run tests or treat the still-running combined script, historical byte-growth failure, digest gap, or unlaunched benchmark as evidence.