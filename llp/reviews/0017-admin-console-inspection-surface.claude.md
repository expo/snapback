# Review: LLP 0017 — Admin console and inspection surface

**Reviewed:** `llp/0017-admin-console-inspection-surface.rfc.md` (working-tree revision)
**Family:** Claude (Anthropic)
**Provider/runtime:** Anthropic API via Claude Code — model Opus 4.8 (1M context)
**Date:** 2026-06-26
**Redacted:** No — reviewed locally against the in-repo LLP corpus; nothing sent
externally beyond the model serving this session.
**Method:** Single-session independent read-and-critique grounded in the documents
0017 borrows from or extends — primarily the headless integration contract
([LLP 0012](../0012-headless-integration-contract.spec.md), whose v0 `runtimeState`
and `capabilityManifest` artifacts this RFC proposes to grow), the ephemeral RFC
([LLP 0013](../0013-ephemeral-realtime-state.rfc.md), source of the room/inspector
vocabulary), and the local core ([LLP 0003](../0003-local-code-hosting-and-storage-core.rfc.md)),
with a cross-document consistency sweep over LLP 0006, 0009, 0010, and 0014 for
vocabulary and capability alignment. A delegated read verified the cross-reference
claims term-by-term (`scopeEpoch`/`entryVersion`/coalescing/resync vs. 0013, "Ibex"
vs. 0009, the adapter-type list vs. 0013/0014, the diagnostic shape vs. 0010/0012).
Requested as "review … revise if you see ways to improve it"; this **applied** the
revisions marked below.

> **Independence (LLP 0005).** Drafted by Codex; reviewed by Claude (cross-family),
> so this counts as one independent family pass. Caveat: this same pass also *edited*
> the document, so it is no longer fully independent of the revised text — a second
> family (GPT-5, the corpus's other reviewer) and Charlie should read the revisions.
> No GPT-5 companion review exists for 0017 yet; the loop is not complete. (0013 and
> 0016 are in the same state — recent RFCs have a Claude pass but no GPT-5 companion.)

## Overall assessment

This is a strong, well-scoped RFC that does the right thing with a surface that is
easy to get wrong. The keystone decisions are all correct and well-argued: **same
Snapback server owns both the admin API and the packaged console** (Vite is an
optional dev convenience, not a runtime dependency); **the console is one consumer
of a headless admin contract, not the owner of admin truth**; and **the function
runner — not an arbitrary JS eval — is the first "code runner."** The
process-local-ephemeral argument for same-instance authority (*Serving Model*) is
the sharpest single point in the document: a separate UI server *cannot* truthfully
inspect rooms, subscribers, or queue pressure that live in another process's memory,
so the serving model isn't a preference, it's forced by [LLP 0013](../0013-ephemeral-realtime-state.rfc.md)'s
v1 in-memory carrier. The three-tier write policy (generated function → labeled
direct admin edit → raw SQL, the last disabled-by-default and local-only) is exactly
the right escalation with the right defaults, and the security posture (loopback
convenient, non-loopback locked, hosted disabled until auth exists, secrets redacted)
is appropriately sober.

The draft's weak spot was not its thesis but its **most load-bearing seam: the
headless admin contract's relationship to [LLP 0012](../0012-headless-integration-contract.spec.md)**.
0017 says the contract "should extend the runtime-state and capability facts from
LLP 0012 rather than inventing a parallel schema," then lists ~40 facts that mix
ones 0012 *already pins* with genuinely new ones, without distinguishing them or
naming where the new ones live — while 0012 **pinned its v0 artifact schemas on
2026-06-26, the same date as this RFC**. The document's own last open question
("extension of 0012 or a separately versioned admin artifact?") circles this without
resolving it, even though the *No private Exact semantics* principle already implies
the answer. The revision closes that seam and four smaller edges (a route/call
attribution to 0003 that 0003 does not actually make; unflagged forward-reference
debt on borrowed vocabulary; two overlapping normative fact-lists; and two open
questions the body had already half-answered).

## Strengths

- **Same-instance authority, forced by ephemeral reality** (*Design Principles*,
  *Serving Model*). The strongest argument in the doc: because v1 ephemeral state is
  process-local memory ([LLP 0013](../0013-ephemeral-realtime-state.rfc.md)), a
  second UI process literally cannot inspect it truthfully, so "the server that owns
  the instance owns the admin truth" is a consequence, not a stance. This also keeps
  the doc consistent with 0012's "Design Mode should not keep hidden backend state"
  rule.
- **Headless-first, console-as-consumer** (*Design Principles*, *Contract/Exact
  Shape*). Treating the admin app as a **system app** over a privileged admin API —
  explicitly *not* an ordinary Snapback app over generated application functions —
  correctly dodges the bootstrap trap where the tool for repairing broken
  schema/functions depends on that same schema/functions being healthy. The
  *Alternatives Considered* "Ordinary Snapback app" entry names this cleanly.
- **Function runner before code eval** (*Function Runner and Code Runner*). Drawing
  the line at "run a generated query/mutation with explicit args and auth context"
  vs. "arbitrary JavaScript needs the full [LLP 0009](../0009-code-execution-security.rfc.md)
  sandbox" is the right safety boundary and keeps the paved path reason-about-able.
- **The three-tier write policy** (*Durable Data Exploration and Edits*). Generated
  invocation preferred; direct admin edit allowed but routed through validators,
  system fields, one-version changesets, and realtime notification *and visibly
  labeled as bypassing app code*; raw SQL disabled by default, local-only, excluded
  from the first Contract/Exact surface. Good defaults, correctly ordered.
- **Security defaults are sober and correctly gated.** Non-loopback bind disables
  admin or demands a token; writes need a token even when read-only health is public;
  hosted admin is disabled until 0011/control-plane auth exists; "the local console
  must not be used as evidence that Snapback is ready to host untrusted multi-tenant
  admin traffic" is exactly the right disclaimer.
- **Validation requirements are concrete and testable**, mirroring the 0010/0012/0013
  acceptance shape — especially "serves `/_snapback/admin/` and `/_snapback/api/inspect`
  from the same server without Vite" and "a missing Exact/Contract toolchain is a
  capability diagnostic and does not break core admin API tests," which turn the two
  central principles into gates.

## Concerns

Severity is the reviewer's; all were **applied** in the revise pass and are the
author's to confirm or revert.

- **C1 — The admin contract silently grows 0012's same-day-pinned v0 artifacts.
  [Medium-High]** *Headless Admin Contract* lists facts that already live in 0012's
  pinned `runtimeState`/`capabilityManifest` (storage engine, runtime engine,
  isolation mode, resource-limit enforcement, connected clients, subscriptions,
  pending mutations, database version, schema/bundle hashes and load times)
  *interleaved with* genuinely new ones (host, port, process id, uptime, outbox
  depth, the whole ephemeral block, Ibex/V8 capability, stale-artifact diagnostics,
  known runtime gaps, admin-write capability) — with no line drawn between them and
  no home assigned to the new ones. Because [LLP 0012](../0012-headless-integration-contract.spec.md)
  was "Ratified on 2026-06-26: v0 pins the logical artifact schemas" — the same date
  as this RFC — adding fields is a *schema event* under 0012's own rule that each
  artifact declares `schemaVersion` and diagnostics report version mismatches. Left
  unstated, an implementer cannot tell whether to extend `snapback.v0` in place or
  bump a version, and "admin-write capability" risks becoming a private admin flag
  instead of a `capabilityManifest` field. *Resolves when:* the contract names which
  facts are reused vs. new, routes the new ones through 0012's artifact-kind/version
  machinery, makes admin-write a capability field, and states the
  extend-in-place-vs-bump question. **Applied** (*Headless Admin Contract*, new two
  paragraphs) + tightened the last open question.
- **C2 — `No private Exact semantics` vs. the last open question were in tension.
  [Low-Medium]** The principle says "extend … rather than inventing a parallel
  schema," but the open question left "extension of 0012 *or* a separately versioned
  admin artifact" fully open, as if undecided. The default the principle implies —
  extend 0012; split only a clearly admin-only subset — is more decisive. *Resolves
  when:* the open question takes the extend-by-default position and narrows the
  genuinely-open part to the `schemaVersion` mechanics. **Applied** (last open
  question; folds into C1).
- **C3 — The 0003 attribution named routes and calls 0003 does not make. [Low-Medium]**
  *Motivation* said "LLP 0003 already requires health, admin upload, inspect, reset,
  invocation, and agent-validation calls." 0003 requires the *capabilities*
  (health/readiness, inspect, schema+function load, deterministic reset, invocation,
  and "enough inspection for an agent to know whether its code and schema are loaded
  and working"), but it does not use "admin upload," does not name "agent-validation
  calls," and does not define the concrete route strings (`/health`, `/inspect`,
  `/admin/schema`, …). Those routes are current *implementation*, which *Serving
  Model* already labels accurately as "current local routes." *Resolves when:*
  Motivation attributes to 0003 the capabilities it actually states. **Applied**
  (*Motivation*).
- **C4 — Forward-reference / vocabulary-ownership debt was unflagged. [Low-Medium]**
  The verification confirms 0017's borrowed identifiers currently match their owners
  exactly — `scopeEpoch`/`entryVersion`/coalescing/resync vs. 0013, the adapter-type
  list vs. 0013/0014, "Ibex" vs. 0009, "syncability class"/read-set/write-set vs.
  0012 — which is good, but nothing in 0017 said these names are *borrowed and owed
  elsewhere*, so future drift in 0012/0013/0008 would silently desync this RFC. The
  corpus already set this convention in the 0013 revision (flag the debt). *Resolves
  when:* a note says the field names track 0012's artifacts and 0013's ephemeral
  diagnostics and must be revised if those change. **Applied** (*Headless Admin
  Contract*, closing sentence of the new text).
- **C5 — Two overlapping normative fact-lists risked drift. [Low]** *Headless Admin
  Contract* and *Console Surfaces* both read as authoritative inventories of the same
  facts (and both overlap 0012's `runtimeState`). Three lists that must agree will
  eventually disagree. *Resolves when:* one is named normative and the other
  illustrative. **Applied** (*Console Surfaces* intro now defers to the contract as
  the normative list).

## Suggestions (non-blocking, not applied — author's call)

- **Consolidate the route-migration policy.** The "reserve `/_snapback/*` now / keep
  v0 routes as aliases / make `/_snapback/api/inspect` canonical over time" story is
  stated in *Serving Model*, *Headless Admin Contract*, *Implementation Sketch*, and
  the *Open Questions* — four places, slightly different emphasis each. One canonical
  statement of the migration policy with the others pointing at it would prevent the
  alias list from drifting. Left unedited to avoid churn on a presentational point.
- **Classify the ephemeral controls as writes.** *Ephemeral Inspector* lists "force
  room resync, delete an entry, disconnect a connection, simulate a publish" as
  controls. Those are privileged mutations of live runtime state; *Security Defaults*
  ties "write operations" to a token but doesn't explicitly fold these controls into
  that class. A one-line statement that ephemeral mutating controls are token-gated
  like durable writes (even on loopback) would close the gap.
- **The `0006` motivation tie is now in *Function Runner*; consider echoing it in
  *Motivation*.** The data-explorer + function-runner are the direct antidote to the
  Valet "counts stuck at zero" silent-namespace failure ([LLP 0006](../0006-valet-retrospective.research.md),
  retold in [LLP 0012](../0012-headless-integration-contract.spec.md) *Function
  Manifest*). I added the tie to *Function Runner* and put 0006 in *Related*; a
  sentence in *Motivation* would let the evidentiary base lead.

## Open questions (for the author / ratifying source)

- **The `schemaVersion` decision is genuinely cross-document and should not wait.**
  0017 now asserts the admin facts flow through 0012's artifact-kind/version
  machinery, but whether they extend the *pinned* `snapback.v0` in place or bump a
  version is 0012's author's call as much as 0017's. This is the one item that
  touches another document's ratified artifact and should be reconciled with 0012
  directly (hand 0012 the new fields, or agree on the bump).
- **Local admin token lifecycle** (already 0017's open question) — generated per
  process / stored under `.snapback/` / printed once / disabled-until-write. The most
  security-load-bearing unknown in the doc; everything in *Security Defaults* leans on
  it existing.
- **Read-only browsing of hosted production data before row-level admin authz**
  (already 0017's open question) — interacts directly with [LLP 0011](../0011-auth-and-permissions.rfc.md);
  worth resolving there, not here.
- **Audit substrate for direct admin edits** (already 0017's open question) — 0017
  correctly makes a real audit log a precondition for hosted direct edits; where that
  substrate lives is still open and likely a control-plane concern.

## Recommended next step

*Proposed only — the author decides; status unchanged.*

1. **Status stays `Draft`.** The revisions are precision and seam-closure (the 0012
   contract relationship, the 0003 attribution, forward-reference debt, two
   open-question resolutions), not a new direction.
2. **Reconcile the admin contract with 0012's author before anything else.** C1 is the
   load-bearing seam: 0017 now says the admin facts extend 0012's *pinned* v0
   artifacts, so 0012 should either absorb the new fields (host/port/uptime, the
   ephemeral block, admin-write capability) into `runtimeState`/`capabilityManifest`
   or agree on a `schemaVersion` bump. Settle this while both docs are Draft.
3. **Gather a second family.** Every LLP 0000–0012 has a `.gpt-5.md` companion; 0013,
   0016, and now 0017 do not. A GPT-5 pass is the honest completion of the
   multi-family loop, and matters more here because this Claude pass also edited the
   text.
