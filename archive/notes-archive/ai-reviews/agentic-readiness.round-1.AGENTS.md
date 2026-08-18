# Review: LLP 0019 - Agentic readiness (round 1)

**Reviewed:** `llp/0019-agentic-readiness.research.md`
**Reviewer:** Codex
**Date:** 2026-06-26
**Revision outcome:** Applied focused revisions to the LLP after review.

## Overall assessment

This is a strong Research LLP and the central thesis is right: Snapback's
agentic gap is less about the shape of its data API and more about ratifying the
operator surface that agents can actually script against. Leading with one
host-ops core, shared structured diagnostics, and thin CLI/HTTP/MCP projections
is the right move.

The draft's other important strength is the build-time agent / runtime AI split.
That distinction prevents a common design mistake: trying to solve "Codex can
operate my local backend" and "my shipped app can call an LLM" with one protocol
or API. Those are related product priorities, but they have different authority,
cost, side-effect, and deployment constraints.

The revise pass kept the document in Research/Draft form. It did not ratify the
proposal or move status. The changes mostly tighten boundaries that would matter
if an implementation followed this document directly.

## Strengths

- The one-core / multiple-projection recommendation is the right abstraction.
  It reduces drift between CLI, HTTP, MCP, tests, and the admin console.
- Treating the function manifest as the app-data MCP catalog is a high-leverage
  observation. LLP 0012 already contains most of the schema an MCP tool catalog
  needs.
- The document correctly says not to redesign the data API. Structured
  predicates, immutable builders, source spans, and fail-closed diagnostics are
  already agent-friendly.
- Dry-run, service principals, permission-dependency metadata, and generated
  context packs are the right next layer of agent affordances.
- Runtime AI is framed as vector storage plus actions plus cost metering, not as
  a bespoke AI query language.

## Concerns

- **C1 - Generated app-data MCP needed an explicit authority gate.
  [Medium-High]** Turning every generated function into a candidate tool is
  powerful, but it is not an auth model. Mutation tools in particular must run
  under an explicit actor/effective-principal/scope tuple, and hosted exposure
  should wait for the service-principal capability-token story in F2.

- **C2 - The control-plane/app-data MCP wording risked blurring runtime AI back
  into the build-time-agent story. [Medium]** MCP is an excellent operator and
  external-tool protocol. It should not become an implied in-process protocol for
  AI features inside shipped apps. The revision now says runtime AI should use
  ordinary app/runtime mechanisms and actions.

- **C3 - Checkpoint/restore overclaimed what the version substrate gives us.
  [Medium]** A monotonic commit version is necessary for "restore to N," but not
  sufficient unless the system also has retained before-images, a byte-level
  snapshot, or a branch/clone mechanism. The revision lowers confidence and
  names this as a storage contract, not a free consequence of `_version`.

- **C4 - Dry-run needs to be identical-path, not a second evaluator. [Medium]**
  The valuable property is "this is what the real mutation would do if committed."
  That means dry-run should execute through the same buffered invocation path and
  discard the writes, while reporting deterministic runtime inputs and blocked
  side-effect capabilities.

- **C5 - The generated context pack should be treated as a versioned artifact,
  not prose. [Low-Medium]** A hand-authored `llms.txt` would drift. The useful
  artifact is generated, schema-versioned, tied to bundle hashes, and redacted
  according to the same rules as diagnostics and manifests.

## Suggestions

- Keep LLP 0019 in `Draft` until the owner decides whether the operating surface
  extends LLP 0010 or becomes its own spec.
- Ratify host-ops names and result schema before investing in more UI or MCP
  surface area.
- Generate the app-data MCP catalog early, but gate callable mutation tools
  behind local explicit impersonation first and hosted service-principal tokens
  later.
- Treat runtime AI as a v2 product track that should not block build-time
  agentic readiness.

## Open questions

- Which document owns the normative host-ops API: an extended LLP 0010 or a new
  operating-surface spec?
- Which generated functions are exposed as app-data MCP tools by default, and
  how do function capabilities map to token scopes?
- What exact audit tuple records agent operation: actor principal, effective
  user/principal, scope grant, target function, and dry-run-vs-commit mode?
- What storage primitive makes checkpoint/restore real for v0: byte-level local
  snapshot, retained before-images, logical undo changesets, or branch clone?
- What redaction/versioning policy governs the generated context pack?

## Revisions applied

- Added the missing `Revised` metadata field.
- Tightened F1 so generated app-data MCP is a catalog/projection, not an
  implicit authorization grant.
- Clarified that MCP remains an external agent/tool surface and should not be
  treated as the runtime-AI protocol inside shipped apps.
- Added actor/effective-principal language to F2.
- Made dry-run depend on the same buffered invocation path as real mutations.
- Lowered and sharpened checkpoint/restore confidence, naming the missing undo
  substrate.
- Removed the overbroad last-writer-wins framing from the checkpoint/restore
  finding.
- Reframed the generated context pack as a generated, versioned, redacted
  artifact.
- Updated sequencing and open questions to reflect those constraints.

## GPT review note

The LLP process also recommends a GPT-family review. This Codex review can serve
as that pass if that is what the author intended; otherwise, create a separate
canonical GPT review artifact before treating the review loop as complete.
