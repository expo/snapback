# Engine package with dev-target subcommands (sub-stage a core)

**Status:** Shelved
**Impact:** 4
**Urgency:** 2
**Ease:** 2
**Confidence:** 3
**Score reviewed:** 2026-07-26
**Score rationale:** The ticket evidence for “Engine package with dev-target subcommands (sub-stage a core)” shows the issue materially affects a supported product or engineering path; it can wait behind current correctness blockers, while the repair crosses several runtime, host, protocol, or policy seams, with a clear design but unresolved dependencies.
**Severity:** P2
**Systems:** Tooling, Client integration
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0062 §1/§2/§6, LLP 0012 (adapter invariants, diagnostic dialect), LLP 0010 (agent-facing diagnostics)
**Marker:** app-cli, sub-stage-a

`packages/snapback-app-cli` (working bin `snapback-app`): the generic
engine bound to a target (`--app <url>`) and artifacts (local
`generated/` via `--artifacts`; dev targets serve no envelope).
Sub-stage (a) needs **no server changes**: binding attestation uses the
public `/inspect` projection; the call-time generation-binding
guarantee is explicitly sessions-only (the dev reload race is an
accepted, named residual per LLP 0062 §1).

Scope: `call --args-json` (and `-` stdin form; 60s default timeout),
one-shot `call` of a LiveQuery, `introspect [--json]` (closed versioned
envelope with `targetCapabilities` and `principalSource`), `types
--out`, generated `--help` honest within the two client-decidable
refusals, the function selector (stable id always; bare exported name
when unique), the frozen exit-code taxonomy (2–11, exit 1 reserved for
engine-internal failure), the non-TTY JSON/JSONL defaults, strict JSON
value profile with typed overflow, defensive envelope parsing bounds,
and the artifact cache (content-addressed blobs, last-known-good
pointer, advisory-lock writes, offline introspect/help from cache).
Platform floor: repo-pinned Node major, POSIX-only, structured
diagnostic on unsupported platforms.

Final-revision deltas to honor: `--artifacts` is required on dev
targets (no cwd guessing); the local loader verifies every operation
schema and declaration member against the codegen-emitted per-member
digest map before help/introspect/typing/invocation; both
client-decidable pre-flags refuse locally with zero network as exit 2
(exit 3 is server refusals only); the function selector accepts the
stable id always and the bare exported name when unique.

Stage (a)'s descriptor-absent bootstrap is explicit and narrow: an
unchanged descriptor-less dev server may run only anonymous/dev calls
after the existing tuple and `/inspect` artifact attestation succeeds.
This is the RFC §6 credential-free carve-out, not URL/profile inference;
no session or agent lane may use it. Before `types` writes network-borne
declarations, the engine validates every member against the same
versioned canonical grammar and digest ownership partition as server
admission. The frozen exit/mapping deliverable also assigns the
envelope-less sessions network refusal a specific code/sub-cause (not
exit 8) and includes per-call broker timeouts in exit 9 before either
case can become an implementation choice.

**Done when:**

- Every subcommand above works against a live dev-mode memory server
  using a fixture app's local `generated/` artifacts.
- Exit-code table rows 0/2/4/5/6/7/9 are exercised in goldens (TTY and
  non-TTY); exit 7's binding sub-cause is machine-distinguished; the
  pinned `--artifacts` mismatch case is terminal.
- Wrong-app, same-named-function, and stale-bundle attestation
  pairings fail closed against `/inspect` identity.
- A descriptor-less dev server exercises the exact stage-(a) carve-out;
  descriptor absence on every credentialed or non-dev lane fails closed
  without inference.
- Forged or grammar-invalid declaration members are refused before
  `types` materializes them, including schema-owned app-global leaves.
- Server diagnostic codes pass through verbatim in `diagnostics[]`
  (never rewritten to `SNAPBACK_APP_CLI_*` codes, which only classify).

## Shelved (2026-08-01, author decision)

Temporarily shelved per Charlie's 2026-08-01 decision on the
triage-sweep recommendation: the app-cli program is paused (owning RFC
LLP 0062 parked at Review since 2026-07-17; LLP 0122 Q6 still open on
the CLI's shape). Reopening condition: LLP 0062 leaves Review or the
program is recommissioned. The design content here is not invalidated
by the shelving.
