## 2026-07-28 — Snapback, deep round, product-blocked

### Environment

- Frozen source: `5f31cb6174daaefa04a1e05242acbbc22c725040`
- Fresh local SQLite + Ibex target, intended sessions mode
- Namespace: `llp0102-research-snapback-w1`
- Timed window: 20m 22.6s active before freezing the blocker
- Assistance: shipped guide; competitive-checkpoint source/witness; existing
  Snapback chat-arm lifecycle conventions; codegen source after its egress
  diagnostic did not explain generation-time enablement

### Milestones

- UI production build: passed
- Full schema/functions generation: passed
- First local read, mutation, realtime, acceptance: not reached because the
  full sessions artifact was refused before listener readiness
- Canonical dev-auth streamed-action control: 8/8 passed on the exact binary

### What felt good

The schema and function definitions made the intended authority and settlement
shape legible. Resource membership, separate durable progress events,
idempotent question starts, citations, cron, config grants, and the
host-owned stream attempt could all be expressed in one coherent model.
Codegen rejected stale output rather than leaving an old manifest behind.

The streamed-action control is unusually strong: it already proves durable
intermediate native push, cancellation fencing, timeout/ambiguity distinction,
and host-derived effect certainty.

### What felt bad or frustrating

The app could not start. Sessions artifact preflight checked a conservative
target declaration that did not incorporate the process-live outbound gate,
so it rejected `bounded_response_stream_v1` even though generation and runtime
both had egress enabled and `/inspect` would otherwise advertise it.

This was particularly frustrating because the guide presents sessions and
streamed actions as shipped local surfaces. There was no composition warning,
and the error looked like a missing runtime flag until the canonical stream
suite passed and source inspection exposed the preflight choice.

Fresh-worktree setup also required a root `bun install`; `npm install` failed
on `workspace:*`. Egress had to be enabled during codegen, a requirement found
only after a failed generation and source-test inspection. The UI initially
needed the routine Vite CSS type declaration.

### Modeling and correctness

The authored design used a private resource-membership declaration, ordinary
source/question/answer rows, a unique room/idempotency key, a unique
answer/question relation, durable progress-event sequence rows, and a cron
slot ledger. Asset metadata rows were deliberately not called file uploads,
and stored 32-dimensional fixtures were deliberately not called semantic
retrieval.

### Realtime, offline, and auth

The decisive result is a composition failure: dev-auth streaming works, and
sessions without this full capability can start, but the required
sessions-plus-streaming deployment cannot. No fallback to dev identity was
used because the assigned arm explicitly required sessions and doing so would
have weakened the authority evidence.

### Deployment and operations

Admission failed before bind, which was safe and easy to clean. Runtime/public
paths were removed, ports 3340/4340/20440/9340 were closed, and no secret was
persisted. Hosted remained an explicit product GAP.

### Documentation and diagnostics

The structured capability code was stable, but its repair direction was
misleading for this composition: the flags were already present. The guide
needs an executable sessions-plus-streaming example and explicit
generation-time egress instructions.

### Glue and workaround inventory

- Custom deterministic effect receiver and 15-scenario harness
- Explicit progress/citation/refresh ledgers
- One unsuccessful diagnostic attempt to cold-start a narrow sessions pair
  and hot-publish the full manifest; it was correctly refused and not adopted

### Outcome

- 1 pass (cleanup), 2 explicit GAPs, and 12 protocol failures; eight of those
  failures are downstream checks that could not execute after admission failed
- No Stop-class defect
- Evidence: `receipts/acceptance.v1.json` and
  `receipts/sessions-stream-admission-defect.v1.json`

### Would I choose it?

Not for this application at this commit. The streaming correctness model is
attractive, but the ordinary authenticated deployment cannot compose with it,
which blocks the core product loop before data exists.

### Lessons for Snapback

The highest-value response is a general capability-composition invariant:
cold-start auth preflight, ordinary publication, generated capability
manifests, and served `/inspect` must evaluate the same process-live target
facts. Prove it with a sessions-plus-streamed-actions acceptance fixture.
Assets and semantic retrieval remain separate table-stakes capability gaps.
