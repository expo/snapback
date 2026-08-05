# LLP 0171: Chess authoring-loop observations

**Type:** Research
**Status:** Draft
**Systems:** Competitive evaluation, Developer experience, Authoring, Tooling, Documentation, Packaging, Jobs, Testing
**Author:** Codex (gpt-5.6-sol) / Charlie Cheever
**Date:** 2026-08-04
**Related:** LLP 0041, LLP 0061, LLP 0070, LLP 0115, LLP 0134, LLP 0172, LLP 0173, LLP 0174

## Summary

One external Chessfield build recorded five concrete authoring incidents while
using the published `@expo/snapback-*` 0.1.8 closure. The Snapback arm reached a
clean 23-check result in about 25 minutes; the Convex arm reached a different,
smaller green suite in about 18 minutes. Those runs establish incidents and a
rough workload-specific time difference. They do not establish “the whole
gap,” product-wide superiority, prevalence, or a sequencing priority among
unrelated subsystems.

This document is a findings report, not an authorization to change five
systems. It records what the build and repository source support, corrects the
rejected RFC's overclaims, and routes each open mechanism to its existing
owner. Two independently coherent proposals extracted from the rejected pair
are LLP 0172 (explicit function authorization) and LLP 0173 (authorization
review projection). LLP 0174 separately verifies the two security-boundary
questions the rejected RFC incorrectly treated as DX repairs: third-party
handler admission and complete sessions deployment identity.

## Evidence boundary and method

The source observation is the Snapback arm diary at
`diaries/0057-chess-backend-bakeoff.diary.md`, synced from an external
four-backend build on 2026-08-04. The arm used a read-only Snapback worktree and
published packages. Its working application remains outside this repository.
The diary reports approximately 25 minutes from first inspection to clean
verification: six reading, five authoring, three codegen iteration, four on the
stdin lifecycle detour, and seven on auth/package findings and strengthened
tests.

The comparison is not a controlled benchmark. The two arms did not run the
same number of checks, model/cache/network/package-manager state was not fixed,
and minute attribution came from one contemporaneous diary. The evidence can
license “this incident occurred in this build.” It cannot license frequency,
global value, or a claim that fixing the named incidents accounts for every
difference between the products.

Repository verification below checks the current source contract. Claims about
what published 0.1.8 lacked remain external-arm observations unless backed by a
publication receipt; current source containing a feature does not prove that an
older closure contained it.

## Findings

### A. Guide/source truth is not published-closure truth

The arm found two current guide techniques absent from its installed 0.1.8
packages: declared `ctx.refuse` codes and anonymous-public client custody. The
current source pages are `status: current`, `maturity: shipped`, and contain
those techniques. The current checker verifies flat frontmatter, links,
repository authorities, snippet text, capability joins, reviewed-commit
freshness, and generated guide projections. It does not join individual
authoring surfaces to package versions frozen by publication.

The rejected `since:` proposal does not close that proof by itself. A
hand-authored version can compare a stated introduction version with a closure,
but it cannot detect an omitted or incorrectly stated version—the motivating
failure. Section-level “frontmatter” also does not exist in the guide's flat
page-frontmatter model. `targets:` distinguishes deployment targets; it does
not distinguish repository contributors from package consumers.

The incident is valid and already filed as
`issues/20260804-guide-gap-published-closure-drift.md`. The mechanism remains
open under LLP 0061/0134. Before proposal, the owner must choose the claim unit
(page, section, snippet, or stable surface ID) and an authority for package
membership. Plausible designs include an honestly mandatory authored fence or
release-aware surface IDs generated from publication receipts. Any design
needs a stale-closure fixture whose known-unavailable surface fails. This
Research document does not rank the issue above unrelated security or runtime
work.

### B. The non-TTY dev control channel stops on EOF

`attachDevControlChannel` in `packages/snapback-cli/index.mjs` constructs a
readline interface for non-TTY stdin and calls `stop()` on its `close` event.
The observed backgrounded process therefore starts, emits `control-ready`,
then shuts down cleanly when stdin reaches EOF. The behavior is implemented,
not speculative.

The rejected `snapback serve` design was premature. `snapback dev` already owns
generation, sessions startup, watching, live reload, signal handling, the
`snapback.dev.v1` event stream, and `HostReadyDescriptor`. A `--no-control` or
`--non-interactive` mode that keeps the existing supervisor alive until a
signal is the smallest candidate that satisfies the observed need. A distinct
`serve` verb is justified only if a separately specified no-watch lifecycle
cannot use that supervisor.

Any proposal remains with LLP 0041 and LLP 0115. It must reuse the existing
ready descriptor and its nonce/ownership semantics. Credential-adjacent paths,
database paths, admin URLs, and token material must not be duplicated into a
stdout readiness dialect. EOF, signal shutdown, managed-child failure,
descriptor cleanup, and readiness timeout need deterministic tests.

### C. The handler-source guide sentence is false

Current code verifies that `{ source, exportName }` reads one closed script and
rejects `ImportDeclaration` with `BUNDLE_UNSUPPORTED_IMPORT`. It supports
top-level helpers in that same file, not imported helpers. The guide currently
says the lane remains useful for logic needing imported or sibling helpers.
That sentence should be corrected to the verified contract and is already
filed as `issues/20260804-guide-gap-handler-source-imports.md`.

The correction is limited to the documentation fact. It must point third-party
package needs to LLP 0174 rather than recommend a build workaround that changes
the executable-admission boundary.

### D. Job retry visibility and retry policy are distinct

The source confirms:

- `maxAttempts` defaults to 1 and participates in the idempotency identity;
- the product job-status row exposes `attemptCount` and `lastErrorCode`;
- success clears `lastErrorCode`, so `attemptCount > 1` reveals a retry but not
  its prior diagnostic cause;
- the operator job detail exposes append-only attempt records with each
  diagnostic code; and
- `SNAPBACK_AUTH_RESERVATION_STALE` is an auth-reservation conflict carrying
  `retryable: true`, `retryStrategy: "short-jitter"`, and
  `effectCommitted: false`.

The rejected RFC was wrong to say a retry is invisible and wrong to offer
raising the generic default or recording history as alternatives. There are
two questions: whether product code needs a bounded prior-cause projection,
and whether a proved no-effect platform conflict receives a separate retry
budget. Raising the generic default silently opts arbitrary at-least-once
actions—including external effects—into more replay and changes idempotency
matching for callers that omit the value. It is not justified by one push
workflow.

LLP 0070 owns both questions. A stage-aware platform retry remains only a
hypothesis and would need its own finite cap, backoff/jitter, generation pin,
and a proof that the failed stage committed no application or external effect.
The current diagnostic supplies that proof for this refusal instance; that
does not prove a generic action retry policy.

## Observed strengths, without comparative overclaim

In this run, the packaged doctor proved launch, handler load, query, mutation,
live subscription, and shutdown before app authoring. Codegen emitted stable,
specific diagnostics and failed closed. The guide's intent index, capability
rows, and verified snippets made most feature questions quick to answer.
Mutation receipts plus `defineJobStatusQuery` supported product-side proof that
queued work ran. These are properties to preserve. This single arm does not
show that Snapback is stronger than every comparator on every axis.

## Follow-up routing

| Finding | Owner | Status after this Research document |
|---|---|---|
| Published-closure guide truth | LLP 0061 + LLP 0134; existing guide-gap issue | Incident verified; claim unit and release authority open. |
| Backgroundable dev loop | LLP 0041 + LLP 0115 | EOF behavior verified; extend existing supervisor is the lead hypothesis, not a decision. |
| False handler-import guidance | LLP 0061; existing guide-gap issue | Immediate wording correction is clear; security implications are LLP 0174. |
| Third-party handler packages and sessions deployment identity | LLP 0174 | Removed from this DX document; security findings and owner routing live there. |
| Job retry observability | LLP 0070 | Product prior-cause projection open. |
| Platform conflict retry | LLP 0070 | Separate bounded execution-policy question; generic default unchanged. |
| Omitted function auth | LLP 0172 | Separate Draft RFC. |
| Authorization review view | LLP 0173 | Separate Draft RFC. |

## Evaluation method

A cold-start agent run remains useful as periodic comparative evaluation, not
conformance. Record model, prompt, package versions, cache policy, network
state, host, start/finish timestamps, checks attempted, and checks passed.
Never use “nothing written outside the app directory” as a gate: ordinary
package caches and runtime temporary state violate it without affecting the
product property.

Mechanisms need deterministic owner-level acceptance instead: stale-closure
fixtures for the guide; EOF/signal/descriptor lifecycle tests for the dev
supervisor; bounded contention/effect-safety cases for job policy; and LLP
0174's security-specific acceptance for any future fence change. A cold run
may reveal what to test, but it cannot substitute for those tests.

## MATERIAL review disposition

| Review concern | Disposition |
|---|---|
| GPT-5 M1 — prioritization overgeneralized from one build | Resolved by the evidence boundary, exact 25-minute diary total, removal of global rankings, and separation of observations from hypotheses. |
| GPT-5 M2 — evidence report plus five RFCs | Resolved by retyping 0171 as Research; no A–E mechanism is authorized here. LLP 0172/0173 are the only coherent extracted proposals. |
| GPT-5 M3 — authored `since:` is not closure proof | Resolved in Finding A: the incident survives, the mechanism does not; claim unit and publication authority remain open with a required stale fixture. |
| GPT-5 M4 — `serve` is not shown cheapest and duplicates readiness | Resolved in Finding B: existing-supervisor `--no-control` is the lead hypothesis; a new verb and stdout readiness dialect are not proposed. |
| GPT-5 M5 — bundler output hashing loses handler properties | Resolved in LLP 0174; package admission is removed from this DX document. |
| GPT-5 M6 — identity subset weakens LLP 0058 | Resolved in LLP 0174; the fence analysis and retained complete-pair conclusion are removed from this DX document. |
| GPT-5 M7 — retry diagnosis partly false and remedies differ | Resolved in Finding D: `attemptCount` and operator history are recorded accurately; observability and execution policy are separate; no default increase is proposed. |
| GPT-5 M8 — cold agent run is not conformance | Resolved in Evaluation method: it is periodic evidence only; deterministic owner-level tests are required. |
| Claude M1 — bundled bytes versus handler subset is the whole decision | Resolved in LLP 0174; this document keeps only the verified guide wording defect. |
| Claude M2 — auth fence relaxation rested on unverified reading | Resolved in LLP 0174; this document retains only the authoring symptom, routed to Finding B. |
| Claude M3 — Acceptance was vacuous and non-runnable | Resolved by removing RFC Acceptance and separating periodic evaluation from deterministic mechanism tests. |
| Claude M4 — `since:` repeats the failure and misreads frontmatter | Resolved in Finding A: no `since:` proposal, no `maturity: shipped`-only predicate, no section-frontmatter claim, and no misuse of `targets:`. |
| Claude M5 — job default changes idempotency and remedies are not alternatives | Resolved in Finding D: idempotency impact is explicit; observability and retry policy are separate; the default is unchanged. |
| Claude M6 — bundling moves npm resolution inside replay identity | Resolved in LLP 0174; package resolution and replay identity are not DX mechanisms. |
| Claude M7 — findings report typed as RFC | Resolved by the Research type and follow-up routing table. |
| Claude M8 — priority contradicted the evidence | Resolved by removing all cross-item ranking. |
| Claude M9 — “whole gap” lacked reconciled totals | Resolved by reporting the diary's approximately 25-minute total and the non-normalized 18-minute Convex result without claiming the delta is fully attributed. |
| Claude M10 — ready stdout could leak credential-adjacent data | Resolved by deleting the ready-line design; any future mode reuses `HostReadyDescriptor` and emits no token or credential-adjacent fields to stdout. |

## Confidence

High for current-source findings B–D: each follows directly from code, guide,
or accepted LLP contracts. Moderate for Finding A's external publication fact:
the diary compared installed 0.1.8 with the source tree, but this authoring pass
did not reconstruct the 0.1.8 tarballs from publication receipts. Low for
frequency, product-wide prioritization, and comparative superiority; this
document makes none of those claims.
