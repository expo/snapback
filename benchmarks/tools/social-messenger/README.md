# Social-messenger (Clique) benchmark tooling — P1 scaffolding

The LLP 0201 D7 **P1 prerequisite artifacts** for the canonical
full-app benchmark. Governing documents:
`llp/0201-social-messenger-canonical-benchmark.plan.md` (Accepted) and
`benchmarks/briefs/social-messenger.md` (freeze-candidate; freezes at
P3 after the pilot). Cross-lane pins live in `CONTRACT.md`.

| Artifact | Where | What |
|---|---|---|
| Coordination contract | `CONTRACT.md` | Layout, determinism, personas, named O5 fixtures, action verbs, test-ID set, versioning |
| UI kit | `ui/` | Purely presentational RN components (dumb props, contract test IDs, tokens incl. the 8 chat accent colors), screens/wireframes, neutrality notes, Clique logo |
| Choreography harness | `choreography/` | Two-client Playwright skeleton emitting structured receipts; simulator segment spec (implementation hardens at the P2 pilot) |
| Grader harness | `grader/` | Frozen grader prompt, grader-report schema, calibration plan + planted-defect template, probe-category registry, probe hash-commit tool + rotation log |
| Fixture pack | `../../fixtures/social-messenger/` | Action schema + deterministic generator, committed starter segments and 50-action sample log, hash-pinned scale log, invariant manifests, personas, window configs, generated media |
| Scoring manifests | `../../schema/social-messenger/` | Assertion-ID manifest (executor classes), dimension applicability manifest, run-record extension schema |

Status: **P1 scaffolding (0.1.0-p1)** — everything here is
pre-freeze. The P2 pilot exercises it end to end; P3 freezes versions
and pins hashes in the brief. Known deliberate deferrals: calibration
artifacts are *specified* here and built from the pilot artifact;
wave probe sets are authored at wave time (hash-committed before the
wave, published after); the simulator choreography segment is spec
plus interface, hardened during the pilot.
