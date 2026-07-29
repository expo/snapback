# Diary 0031: Research room backend bakeoff

**Type:** Diary
**Status:** Active
**Systems:** Backend bakeoff, AI workflows, Files, Search, Streaming, Effects
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-28
**Related:** LLP 0102

## 2026-07-28 — Stage 0, protocol freeze

No provider arm has started. The frozen Research Room workload uses
deterministic embeddings and streamed progress for comparable acceptance, with
an optional real-model hosted run reported separately. Cancellation, retry,
ambiguous effects, outsider isolation, source deletion, citations, secrets,
and scheduled refresh are explicit evidence boundaries.

## 2026-07-28 to 2026-07-29 — Snapback, deep round, product-blocked

### Environment and outcome

The arm used exact frozen Snapback source commit
`5f31cb6174daaefa04a1e05242acbbc22c725040`, a fresh intended sessions-mode
SQLite + Ibex target, and `SNAPBACK_OUTBOUND_ACTIONS=1` during generation and
runtime. Codegen and the production UI build passed. The full application was
then refused before listener readiness.

The final result is one pass (exact cleanup), two explicit product GAPs
(asset bytes/upload and semantic/vector retrieval), and 12 failures. Four
failures directly cover the core sessions-plus-streaming composition;
eight downstream checks could not execute because the target never admitted
the artifact. No downstream behavior is inferred from authored code.

Coordinator evidence confidence is 8/16. Target identity and artifact
reproducibility are direct. Transaction, transport, and settlement have
indirect evidence from generated artifacts and an exact-binary diagnostic
control. Actor authority and reconnect were never reached. Cleanup proves
exact final absence, but no separately timestamped pre-write baseline was
retained.

### What felt good

The intended authority and settlement model was legible in one backend.
Private resource membership, source/question/answer rows, idempotent question
starts, citations, durable progress sequence rows, cron slots, configuration
grants, and a host-owned streamed attempt could all be expressed coherently.
Codegen also removed stale output after failure rather than letting an old
manifest masquerade as current.

The existing streamed-action control is strong. On the exact same binary, the
canonical dev-auth witness passed 8/8 and directly proved durable intermediate
native push, cancellation fencing, timeout/ambiguity separation, and
host-derived effect certainty. This localized the failure instead of leaving
“streaming is broken” as a vague conclusion.

Admission failed before bind. That fail-closed behavior prevented half-created
data or secrets and made cleanup exact: runtime/public paths, startup carrier,
restore sidecars, and ports `3340/4340/20440/9340` are absent.

### What felt bad or frustrating

The application could not start. Sessions cold-start preflight evaluated a
conservative declared local capability set that did not include the
process-live outbound streaming grant. It therefore rejected
`bounded_response_stream_v1`, even though generation and runtime both had
egress enabled and the generated capability manifest included the capability.

This is a particularly damaging composition defect because the Guide presents
sessions and bounded streamed actions as shipped local surfaces. The diagnostic
looked like a missing flag until the exact-binary control passed and source
inspection exposed the preflight path.

A tempting workaround—start a narrow sessions carrier, then hot-publish the
full manifest—was correctly refused with
`SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH`. The arm did not weaken the authority
model by falling back to dev auth or adopt a carrier that violated the closed
startup pair.

Fresh-worktree setup also required a repository-root `bun install`; ordinary
`npm install` failed on the workspace protocol. Action egress again had to be
enabled during codegen, a requirement discovered only after a failed
generation. The UI needed the routine Vite CSS declaration.

### Modeling and evidence boundary

The authored app used membership-protected sources and questions, unique
room/idempotency and answer/question relations, durable ordered progress
events, citations, and a refresh ledger. Asset metadata rows were not mislabeled
as file upload. Stored deterministic 32-dimensional fixtures were not
mislabeled as semantic/vector retrieval.

Because the target never bound, seed, outsider denial, keyword search,
citations, retry, cron, secret configuration, and performance remained
failures—not code-review passes. Authenticated progress, collaborator
observation, cancellation, and the outcome matrix are direct product failures
of the composition that blocked deployment.

### Would I choose it?

Not for this application at the frozen commit. The underlying streaming
settlement model is attractive, but the ordinary authenticated deployment
cannot compose with it. That blocks the core Research Room loop before any
data exists.

This finding does not by itself imply a fundamental architectural dead end.
The evidence points to inconsistent capability resolution across admission
paths, while the exact runtime already proves the hard streaming semantics in
dev auth. It is a high-severity implementation/product-integration defect that
must be fixed generally and rerun before the architectural conclusion.

### Lessons for Snapback

Make capability composition a single invariant. Cold-start sessions preflight,
ordinary publication, generated manifests, and served inspection must resolve
the same process-live target facts without weakening complete-pair startup or
auth-mode fences.

Prove that outcome with a CI-verified sessions-plus-streamed-actions fixture:
mint two genuine sessions, stream authoritative progress, cancel, and prove no
late durable patch while preserving the full outcome distinction. Assets and
semantic retrieval remain separate table-stakes capability gaps.
