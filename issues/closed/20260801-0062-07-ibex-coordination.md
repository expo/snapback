# 0062-07: ibex-side contracts for the one-file executable

**Status:** CLOSED — the reviewed Ibex contract cluster landed on 2026-08-03
at `36442ab9fa399b315ca562da1bdb72190a4aa4f6`; 0062-08 is unblocked.
**Authority:** LLP 0062 §6 phase 2 (the author's 2026-08-01 one-file
direction); ENG-25410/25411 (the filed-not-landed ibex 0028/0029
correcting amendments).

What Snapback needs from ibex, precisely: (1) the 0028 correction
(its citation of this RFC predates §6's scoping — no phase-1
embedded-Ibex or computed-import requirement exists); (2) the 0029
correction ("prototypes the Snapback CLI" lacks the external-script
lane); (3) the NEW reviewed extension — the author-direction gap: a
trusted embedded parent admitting one caller-selected local TS/JS file
as a separately attributed restricted principal, transformed under the
pinned 0028 toolchain, granted only the broker capability, with the
worker filesystem/network/import/clock/subprocess/environment posture
stated as enforced policy and the threat model honest per ibex
0013/0014 (supply-chain authority, not hostile-code sandbox).

Done when: the three ibex-side documents land reviewed in the ibex
repo and this ticket records their identifiers; 0062-08 unblocks. **Satisfied
2026-08-03.**

## Resolution — 2026-08-03

The required Ibex documents landed together in commit
`36442ab9fa399b315ca562da1bdb72190a4aa4f6` (`Specify restricted external
script broker`):

- **LLP 0028**, correcting the false Snapback phase-1/computed-import
  attribution while retaining candidate tables as an independent Ibex
  module-runner capability;
- **LLP 0029**, preserving one trusted embedded parent and defining the
  caller-selected file/stdin input as bounded data admitted into a distinct
  restricted worker; and
- new **LLP 0048**, `Restricted External Script Admission and Broker ABI`,
  specifying the transform/admission profile, separate arming principal,
  native worker ABI, broker/timer/lifecycle/resource contract, app-bound
  format rotations, target-specific evidence chain, honest non-sandbox threat
  model, and literal product acceptance.

The same commit reconciles collateral LLPs 0000, 0002, 0014, and 0047. Dual-
family review artifacts are under
`llp/reviews/0048-external-script-admission-and-broker.{codex,fable}.md`, with
four recorded rounds. Both final delta reviews returned **READY** with no
remaining MATERIAL or MINOR findings; the 0028/0029/0047 review artifacts point
to those cluster bodies.

This closes only the cross-repository documentation dependency. LLP 0048 and
LLP 0047 explicitly record the worker implementation and per-target evidence
as open. 0062-08 owns that implementation and acceptance work and is now
unblocked, not completed.

## 2026-08-01 precise maintainer handoff

Observed state, without modifying the concurrently dirty ibex worktree:

- ibex LLP 0028 is still Draft and still cites Snapback 0062 as requiring
  computed dynamic imports. Correct that statement: Snapback phase 1 has no
  embedded-Ibex dependency and no computed-import obligation. A future Ibex
  host must instead implement the explicit, host-portable erasable-TypeScript
  profile below.
- ibex LLP 0029 is Accepted and defines exactly one trusted embedded entry. It
  explicitly excludes file-execution ingress, so saying that it prototypes the
  Snapback CLI does not yet cover `run analysis.ts`.
- ibex LLP 0047 is the active standalone-executable finish-line plan. Its SFE
  compilation work is useful but does not supply the missing admission and
  broker contract. The next available ibex LLP number observed was 0048.

The requested ibex-side document work is:

1. Revise LLP 0028 to remove the phase-1/computed-import claim and pin the
   external-file transform, if adopted, to the same finite erasable-only
   language semantics across the Node and Ibex hosts.
2. Revise LLP 0029 (and LLP 0047 where its finish-line matrix is affected) to
   preserve the single trusted embedded parent entry while permitting one
   caller-selected TS/JS path or stdin stream to be read as bounded data,
   hashed and attributed, transformed under a pinned toolchain/profile, then
   started as a distinct restricted worker principal. This is not a general
   `eval`, REPL, module-import facility, or runtime-selected compiled entry.
3. Author the next reviewed LLP (0048 if still available) to own the extension's
   ABI and enforced policy. The parent retains credentials, network transport,
   target/envelope authority, and result framing. The worker receives only the
   broker capability plus `api`, `snapback`, `args`, `signal`, bounded console,
   and bounded timers. It receives no bearer, origin, ambient environment,
   filesystem authority after ingress, direct network, module import,
   subprocess, or arbitrary clock/random source. State which constraints Ibex
   actually enforces, and use ibex 0013/0014's supply-chain-capability threat
   model rather than claiming a hostile-code sandbox.
4. Freeze a host-portable v1 lifecycle/resource/broker contract that matches
   Snapback 0062: closed frames and bounds, per-call and establishment
   deadlines, latest-wins live-query delivery, explicit iterator disposal,
   cancellation/graceful teardown, call/subscription/output ceilings, and the
   same exit-class outcomes as the Node engine.
5. Define the app binding embedded in each executable as fixed origin + app id
   + engine/protocol compatibility + release provenance only. It must not
   contain credentials, the current envelope, or handler source. The executable
   fetches the current envelope, so an ordinary app deploy never triggers a
   rebuild; offline operation is limited to honestly cached
   help/introspection/types.
6. Add acceptance for a literal single file running
   `./example introspect`, `./example call`, and `./example run analysis.ts`;
   a Node-versus-Ibex host-portable suite; planted-secret non-transmission;
   iterator/lifecycle/ceiling behavior; policy inspection; current macOS arm64
   and Linux x64 tuples with unsupported tuples refusing; no Node/npm tree,
   sidecar, or dynamically loaded Hermes; and rebuilds only when the app
   binding, engine/policy, platform, or provenance changes.

This ticket closes only when the 0028 and 0029 corrections plus the new
reviewed extension have landed and their document identifiers and commits are
recorded here. Standalone compilation becoming green by itself is not that
condition.

## Running log

- **2026-08-03 — closing condition satisfied.** Ibex LLPs 0028, 0029, and new
  0048 landed reviewed in
  `36442ab9fa399b315ca562da1bdb72190a4aa4f6`. The final dual-family delta was
  READY with no MATERIAL or MINOR findings. 0062-08 is unblocked; its one-file
  implementation/evidence condition remains open.

- **2026-08-02 late — standalone compilation landed ibex-side; the contract
  documents have not.** The ibex agent reports the LLP 0047 finish line
  complete: `ca97519a` ("Finish standalone executable support"), static Linux
  networking `77799377`, and 0029/0039/0047 Accepted after a dual-family loop
  (`653aa005`). Verified against this ticket's done-when: ibex LLP 0028 is
  still Draft (last revised 2026-07-18) and still carries the
  "Snapback requires computed dynamic imports" claim; LLP 0029 (Accepted,
  revised 2026-08-02) contains no external-script / caller-selected-file
  lane; no LLP 0048 exists. Per this ticket's own closing condition,
  standalone compilation green is explicitly not sufficient — asks 1–3
  (0028 correction, 0029 correction, new reviewed extension contract)
  remain open and 0062-08 stays blocked on them. A follow-up handoff prompt
  was given to the ibex maintainer session.
