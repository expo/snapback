# LLP 0268 exit-extension completion draft — G2-C re-record

Date: 2026-08-24  
Branch: `g2-stage-c`  
Baseline: LLP 0209 v0.8 exit note plus landed G2-B and the 0268 prover

This is the G2-C completion evidence requested by the two 2026-08-24
commission packets. It does not edit, supersede, or accept an LLP. The status
words below disposition LLP 0268 §7 input carriers; they are not a capability,
scale, latency, or publication claim. `graph_query_v1` remains instance-opt-in
and the served executor remains controlled by
`SNAPBACK_GRAPH_EXEC_DISABLED=1`.

## Final nine-label re-disposition

| LLP 0268 §7 label | Final disposition | Completion evidence | Scope / remaining claim gate |
| --- | --- | --- | --- |
| `G0-BCAST-CLASS` | **SATISFIED** | The prover-owned class-1 `publicRooms` fixture, paired hidden worlds, and row-23 counterfeit refusal remain executable. | Supported root/equality/bounded class-1 slice only. |
| `G0-BCAST-SEPARATION` | **SATISFIED** | Codegen source proof and host recomputation retain the admit-only/null-overlay certificate and row-24 refusal. | Unsupported forms remain query-shaped. |
| `G0-BCAST-SCOPE` | **SATISFIED** | Executable P-member/Q-instance mismatch and canonical scope derivation remain in the main corpus. | No Q snapshot or result bytes are produced. |
| `G0-BCAST-SCOPE-BINDING` | **SATISFIED** | Installed-owner required nominal-ID checks and row-25 refusal remain executable. | Supported slice only. |
| `G0-BCAST-AUDIENCE` | **SATISFIED** | Independent establishment and strict checks retain exact allow/deny parity; the allowed graph is evaluator-executed and the denied graph never runs. | Point evaluation; scheduled ordering is covered separately below. |
| `G0-BCAST-INVALIDATION` | **SATISFIED** | The 18-selector host map is unchanged. `authorityTransition` now executes an authority-only commit through a served graph subscription and observes fence ordinal 0 before delivery ordinal 1. `mixedCommit` executes one data+authority commit and observes the same order with exactly one post-commit delivery. | LLP 0200 §2.4 fencing, write priority, coalescing, and auth-lane classification are reused unchanged. |
| `G0-BCAST-IDENTITY` | **SATISFIED** | Plan/instance/materialization/partition/version/cut and installed-owner identities remain reconstructed and exact-checked. | No identity weakening in G2-C. |
| `G0-BCAST-CORPUS` | **SATISFIED** | All seven case kinds are executable in `corpus.v1.json`, including `authorityTransition` and `mixedCommit`; `broadcast-cases.g2-pending.v1.json` has an empty `cases` array and records why. | The retained sidecar is an empty historical seam, not a pending arm. |
| `G0-BCAST-BOUNDS` | **PARTIAL** | Normal-fixture `GraphG0ExitObservationV1` rows record group count, subscriber fan-out, result bytes, dependency bytes, and retained group-state bytes from the actual serving/group path for all three graphs. Real served `StructuralWorkV1` and window ledgers fit every `[G2 measures]` declaration. | Large/hot observations are absent. The corpus row carries the exact missing carrier and both `zb5` commands below; no pseudo-observation is recorded. |

## Executable scheduler cases

| Case kind | Commit shape | Observed served sequence | Executable test |
| --- | --- | --- | --- |
| `authorityTransition` | authority event only; no data changes | `0 fence → 1 delivery`, both on the successor authorization version | `graph_scheduler_case_authority_transition_fences_before_delivery` |
| `mixedCommit` | one data change plus one authority event in the same commit | `0 fence → 1 delivery`; exactly one fenced post-commit replacement | `graph_scheduler_case_mixed_commit_has_one_fenced_delivery` |

The corpus runner consumes each corresponding main-corpus row, establishes an
admitted graph subscription, executes its exact mutation plan and contextual
authority through the same LLP 0200 turn/frame machinery used by ordinary live
delivery, and derives `observed` solely from emitted frames. The substitute
fixture tests remain unit coverage only.

Follow-up: `declare_graph_query_v1_capability` remains test-support-only until a
production class-2 authority-resolver seam exists. A stock production instance
must not be able to declare the capability into a state that refuses every
class-2 evaluation.

## Normal group-state and fan-out observations

These are deterministic N=1 shape observations on `normal-seed-v1`. They prove
that the required fields exist and are bounded for these shapes; under
`benchmarks/protocol.md` they do not establish magnitude, variance, or a
ratchet.

| Graph | Group count | Subscriber fan-out | Result bytes | Dependency bytes | Group-state bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| `issueListV2` | 1 | 1 | 436,163 | 2,754,464 | 3,192,038 |
| `issueDetail` | 1 | 1 | 20,261 | 16,672 | 38,512 |
| `listIssueByID` | 1 | 1 | 6,479 | 9,647 | 17,488 |

The source rows are `corpus.v1.json.g0ExitObservations`; the served physical
counter source is `served-observations.g2-c.v1.json`, and its declaration
consumption is frozen in `bound-derivation.v1.json`.

## Large / hot typed gaps and exact reruns

The large CSV fixture is absent from this worktree. The primary checkout's
`hot-diag-baseline` directory exists, but its owning server was not reachable
on loopback port 4290; the primary checkout was not touched. No pseudo-result
or inferred magnitude is recorded.

Large fixture:

```sh
ZBUGS_LARGE_FIXTURE_ROOT=demos/zerobugs/fixtures-local/large-seed42-v1 ZBUGS_ATTEMPT=v4 volta run --node 24.18.0 node demos/zerobugs/control/tests/acceptance/gates/zb5-large.mjs
```

Hot fixture:

```sh
ZBUGS_LARGE_FIXTURE_ROOT=demos/zerobugs/fixtures-local/large-seed42-v1 ZBUGS_ATTEMPT=v11 volta run --node 24.18.0 node demos/zerobugs/control/tests/acceptance/gates/zb5-hot.mjs
```

The committed spike-harness A/B arm, to be run from a checkout that can reach
the owning baseline service, is:

```sh
cd demos/zerobugs/control && zsh scripts/run-p1-ab.sh
```

## Re-record boundary

Eight labels are `SATISFIED`; `G0-BCAST-BOUNDS` remains `PARTIAL`. The 0268 B1
dependency is gated solely on the large/hot `G0-BCAST-BOUNDS` observations.
This does not unblock B3, flip default capability support, or modify LLP 0183
§D2's publication gate.
