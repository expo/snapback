# Review: LLP 0018 — App and instance boundaries

**Reviewed:** `llp/0018-app-instance-boundaries.rfc.md` (working-tree revision)
**Family:** Claude (Anthropic)
**Provider/runtime:** Anthropic API via Claude Code — model Opus 4.8 (1M context)
**Date:** 2026-06-26
**Redacted:** No — reviewed locally against the in-repo LLP corpus; nothing sent
externally beyond the model serving this session.
**Method:** Single-session independent read-and-critique, grounded in a
term-by-term verification of 0018's cross-references against the *primary* text of
LLP 0000, 0002, 0003, 0007, 0008, 0009, 0011, 0012, 0013, 0014, and 0017. A
delegated reader extracted each neighbor's contract; because that reader's line
numbers drifted on two docs, I re-verified the load-bearing claims directly —
0012's pinned `appId`/target-profile-id and its evolution policy
([LLP 0012](../0012-headless-integration-contract.spec.md) lines 91–147), 0008's
single "the database version" framing, 0013's `collection + normalized scope
values` room key, 0007's one-database→one-bundle assumption, and 0017's "system
app, not an ordinary app" line. Requested as "0018 / revise as appropriate"; this
**applied** the revisions marked below.

> **Independence (LLP 0005).** 0018 was drafted by Codex (GPT-5 family) and is
> reviewed here by Claude (cross-family), so this is one genuine independent family
> pass — and the strongest second perspective available, since the corpus's usual
> companion reviewer is GPT-5, which *authored* this document and therefore cannot
> be independent of it. Two honesty caveats: (1) this same pass also *edited* the
> document, so it is no longer fully independent of the revised text; (2) the loop
> is **not** complete — a fresh GPT-5 session would be same-family as the author,
> so the cleanest remaining read is Charlie's own, or a third family. Recent RFCs
> (0013, 0016, 0017) sit in the same partial state: a Claude pass, no truly
> independent companion.

## Overall assessment

This is a strong, correctly-scoped **vocabulary-and-boundary** RFC. Its job is to
install one distinction — *physical Snapback instance* vs. *logical Snapback app* —
and one rule — **default isolation with explicit sharing** — *before* an
implementation quietly hard-codes the wrong default (either "one deployment per
app forever" or "one unnamespaced database for everything"). It does that job
well, and the keystone calls are all correct: physical placement is separated
from logical ownership; isolation is defined by an **observable contract**
(code, db, secrets, auth, logs, limits, realtime) that stays storage-strategy
agnostic *provided the capability report names the mechanism*; the commit-version
stream is per app, not per instance; and ephemeral presence is treated as
sensitive even though it is not durable. The cross-references to philosophy and
constraints are accurate (0000's "paved path, not a cage," 0002's canonical local
shape, 0009's untrusted-execution gate, 0011's user-switch and cross-provider
cautions, 0014's Durable-Object keying options).

The weak spots are not in the thesis; they are all **seams with neighbors**, and
they cluster:

1. **The threat model is never named.** The isolation contract and the validation
   suite are written as correctness/leak tests for *cooperating* apps, but the
   document also reaches toward multi-tenant hosting, where the real adversary is
   *untrusted code*. 0018 gates untrusted execution on LLP 0009 in three places,
   yet the isolation and validation sections themselves carry no caveat — so a
   reader who passes the 0018 acceptance suite could wrongly conclude the instance
   is safe for untrusted tenants. This is the single omission most likely to cause
   harm.
2. **`appId` is treated as a future invention when it already exists.**
   *Implementation Implications* says manifests "should eventually include a stable
   logical app identifier," but [LLP 0012](../0012-headless-integration-contract.spec.md)
   **pinned `appId` into its ratified v0 schema manifest on 2026-06-26** — the same
   date as this RFC — and defined the evolution policy for adding more. 0018 both
   under-claims its own grounding and risks implying a parallel identifier.
3. **The per-app version stream, app-scoped rooms/bundles/admin are correct but
   impose new constraints on Draft neighbors (0008, 0013, 0007, 0017) that those
   docs don't yet carry — and 0018 doesn't name the follow-up edits as
   obligations**, against the corpus's land-docs-with-the-change convention.
4. **The admin console is filed as a peer client surface**, blurring 0017's
   deliberate "system app over a privileged admin API, *not* an ordinary app over
   generated functions" line — the very distinction that lets the admin tool repair
   broken schema/functions.
5. **The app-id's uniqueness/portability scope ("stable within a deployment") is
   too weak** for the export/import and suite-cross-reference cases 0018 itself
   raises.

The revision closes all five. None is a redirection; they are precision and
seam-closure on an RFC whose core is right.

## Strengths

- **Physical/logical split + "default isolation with explicit sharing"**
  (*Summary*, *Decision*). The keystone, and correct. Naming the two boundaries
  separately is what lets the doc say "share one logical app across surfaces" and
  "isolate many logical apps on one instance" without contradiction. "Default
  isolation with explicit sharing, not ambient shared state" is the quotable rule
  the rest of the document hangs off.
- **The tenant-vs-app distinction** (*Terms*). "Do not confuse app tenants with
  logical Snapback apps" is exactly the confusion real products get wrong (is a
  customer org an *app* or a *row*?). Pinning it down — orgs/teams/workspaces are
  ordinary application data and authorization unless a profile deliberately maps
  them to physical isolation — is high-value vocabulary work.
- **The isolation contract is observable and implementation-agnostic** (*Isolated
  apps on one instance*). Defining isolation by *behavior* (code/db/secrets/auth/
  logs/limits/realtime scoped per app) and then declaring the physical layout —
  db-per-app, schema-per-app, table-prefix, row-level app id, DO-per-app — an
  implementation detail *only if the contract holds and the capability report names
  the mechanism* is the right abstraction. It matches 0012's "missing features are
  data, not prose" culture: the isolation mechanism becomes a reported fact, not a
  claim.
- **Per-app version stream** (*Default App Boundary*). "The commit-version stream
  is per logical app, not per physical instance … a global instance-wide version
  number may exist for hosting internals, but it is not the observable app data
  version" prevents a noisy neighbor from advancing another app's sync cursor. The
  instinct to keep any instance-wide counter internal-only is correct.
- **Ephemeral state is sensitive even when non-durable** (*Realtime, Sync, and
  Ephemeral State*). "Presence, cursor, and selection state can leak sensitive
  information even when it is not durable data" is the easy-to-miss point, and it
  is the coarse-grained version of 0013's existing rule that a room must never
  merge two authorization domains. Consistent with 0013 and with 0017's treatment
  of ephemeral state as inspectable.
- **Concrete, testable Validation Requirements** (*Validation Requirements*).
  Collision tests, load-isolation, version-stream isolation, room/outbox
  non-leak, app-scoped auth denial, app-scoped secrets and destructive controls —
  this is the 0010 acceptance-suite tradition applied well, and it turns the
  isolation contract into gates rather than prose.
- **Sober gating of co-tenancy** (*Hosted multi-tenant*, *Local multi-app
  supervisor*, *Non-Goals*). "Allows multiple logical apps per physical instance,
  but … does not approve running untrusted customer code together" and "a
  development convenience, not proof that one runtime/store can safely host
  untrusted apps together" are the right disclaimers. (C1 below is that these
  disclaimers live *away from* the sections a reader will cite as proof.)

## Concerns

Severity is the reviewer's; all were **applied** in the revise pass and are the
author's to confirm or revert.

- **C1 — Accidental isolation and adversarial isolation are never distinguished;
  passing the 0018 suite must not read as "safe for untrusted tenants."
  [High]** The contract in *Isolated apps on one instance* and the *Validation
  Requirements* are correctness and leak tests for *cooperating* apps: same table
  names don't collide, loading app A doesn't affect app B, rooms don't bleed.
  Defending against *adversarial* code sharing a runtime is a different threat
  model that additionally needs the runtime isolation, resource enforcement, and
  admin authorization gated by [LLP 0009](../0009-code-execution-security.rfc.md).
  0018 gates untrusted execution on 0009 in *Hosted multi-tenant*, *Local multi-app
  supervisor*, and *Non-Goals* — but the isolation and validation sections, which
  are exactly what an implementer will cite as evidence, carry no caveat. The
  failure mode is concrete: "we pass the 0018 isolation acceptance suite" becomes
  "we can host untrusted customers," and that is how a multi-tenant data leak
  ships. *Resolves when:* *Isolated apps* states the contract+suite prove isolation
  against bugs and accidents among cooperating apps, and that adversarial isolation
  is 0009's and stays gated there; *Validation Requirements* repeats the caveat at
  the point of proof. **Applied** (new paragraph in *Isolated apps on one
  instance*; closing sentence in *Validation Requirements*).

- **C2 — `appId` is not a future addition; LLP 0012 already pinned it.
  [Medium-High]** *Implementation Implications* opens with "Generated manifests
  should eventually include a stable logical app identifier or deployment target
  identifier." But 0012's v0 schema manifest (Ratified 2026-06-26) **already
  requires `appId`** (line 117) and the capability manifest **already requires a
  target profile id** (line 147), and 0012's evolution policy (lines 96–109) makes
  it "the registry for the shared artifact shapes," where other LLPs add fields
  non-breakingly rather than forking a parallel schema. So 0018 (a) under-claims
  its grounding — the identifier exists in a ratified artifact — and (b) risks an
  implementer inventing a second id. *Resolves when:* *Implementation Implications*
  acknowledges `appId`/target-profile-id already live in 0012's pinned artifacts,
  frames 0018's contribution as defining their **meaning and scope**, and routes
  any further per-app facts through 0012's evolution policy. **Applied**
  (*Implementation Implications*, rewritten opening).

- **C3 — The per-app constraints oblige reconciling edits in Draft neighbors that
  0018 doesn't name. [Medium]** 0008 frames "*the* database version represented by
  the snapshot" (line 104) — a single stream written for one-app-per-instance;
  0013 keys rooms by "collection + normalized scope values" (line 163) with no app
  dimension; 0007's logical portable bundle assumes one database → one bundle
  (lines 323–329); 0017 reserves `/_snapback/` but defines no app-scoped admin
  routes. 0018's positions on all four are sound and forward-compatible, but
  *accepting* 0018 obliges edits in those documents, and the corpus convention is
  to land doc updates with the change. Left implicit, the neighbors silently
  desync from the boundary 0018 declares. *Resolves when:* the version paragraph
  points at 0008, and a closing note in *Implementation Implications* enumerates
  the reconciling edits owed in 0007/0008/0013/0017. **Applied** (inline 0008
  pointer in *Default App Boundary*; obligations note in *Implementation
  Implications*).

- **C4 — App-id uniqueness/portability scope ("stable within a deployment") is too
  weak for the cases 0018 raises. [Low-Medium]** *Storage and Migration* relies on
  app-scoped export/import and, for suites, "cross-app references and their
  referential integrity policy." An id merely "stable within a deployment" doesn't
  say whether it survives an export imported onto another instance — which those
  cross-references need. *Resolves when:* *Implementation Implications* states the
  id's uniqueness, says whether it travels with a logical export, and requires
  cross-app references to carry their own stable key where it does not.
  **Applied** (folded into the *Implementation Implications* rewrite; first open
  question sharpened).

- **C5 — The admin console is filed as a peer client surface, blurring 0017's
  "system app" line. [Low-Medium]** *Terms* lists "admin console" inside the
  *Client surface* definition, and *Multiple surfaces, one logical app* says a
  "mobile app, web app, Contract/Exact surface, React surface, test harness, and
  admin console … should usually share one logical Snapback app." But
  [LLP 0017](../0017-admin-console-inspection-surface.rfc.md) is deliberate that
  "the admin app is a **system app**, not an ordinary Snapback user app. It talks
  to the admin API, not to ordinary app tables through generated functions" — the
  exact property that lets the admin tool repair broken schema/functions. The
  reconciliation is simple: the admin console is *scoped to* one logical app, but
  it is a privileged system surface, not a function-consuming peer. *Resolves
  when:* both spots distinguish function-consuming surfaces from privileged system
  surfaces scoped to the app. **Applied** (*Terms*; *Multiple surfaces, one logical
  app*).

- **C6 — "workspace" is used for two different things. [Low]** *Summary* calls the
  sharing model a "suite/workspace model," while *Terms* lists "workspaces" as an
  example of an **in-app tenant**. In a document whose value is precise vocabulary,
  the collision undercuts the *Terms* section it is trying to establish. *Resolves
  when:* *Summary* stops using "workspace" as a synonym for suite. **Applied**
  (*Summary*).

## Suggestions (non-blocking; not all applied — author's call)

- **Name the trust axis as a term.** The real safety pivot is *trusted co-tenancy*
  (apps one operator owns) vs. *untrusted co-tenancy* (mutually distrusting customer
  code). *Terms* defines instance/app/surface/suite/tenant but not this axis — yet
  it is what determines whether shape #2 ("multiple isolated logical apps per
  instance") is safe to run. A one-line term would let C1's distinction hang off
  the vocabulary instead of prose. *Not applied* — C1's clarifying paragraph covers
  the immediate risk; promoting it to a defined term is a larger editorial call.
- **Mark the suite model explicitly as direction, not contract.** *Non-Goals*
  already says "require suite sharing in v1" is out, and every suite detail is an
  *Open Question*, yet *Explicit app suites* enumerates sharing rules in a way that
  can read as settled. A sentence framing the suite section as a sketch that a
  later RFC will design would prevent the enumerated rules from being treated as a
  committed contract. *Not applied.*
- **Per-tenant physical isolation appears once and never returns.** *Terms* allows
  a profile to "deliberately map [an app tenant] to physical storage isolation"
  (the compliance / db-per-customer path), but nothing else in the document
  addresses when or how. If it is a real future path it deserves an open question;
  if not, the clause may mislead. *Not applied.*

## Open questions (for the author)

- **The `appId` semantics decision is cross-document and shouldn't wait.** 0012
  owns the pinned field; its uniqueness, stability, portability, and any per-app
  additions to `runtimeState`/`capabilityManifest` should be settled *with* 0012
  while both documents are Draft, not implied independently here.
- **Does the per-app version stream change 0008's retention/resume math?** 0008's
  `min_last_sync_version()` watermark and retention horizon are framed
  instance-globally; if the version stream is per app, those become per-app too.
  Worth confirming with 0008's author.
- **Process question: what counts as the independent second review for a
  GPT-5-authored doc?** Since the corpus's companion reviewer (GPT-5) authored
  0018, a fresh GPT-5 session would be same-family as the author. Is that an
  acceptable second pass under LLP 0005's letter (different *session*), or should
  the second independent read be a different family / Charlie? This affects 0013,
  0016, and 0017 too.

## Recommended next step

*Proposed only — the author decides; status unchanged.*

1. **Status stays `Draft`.** The revisions are seam-closure and precision (the
   threat-model distinction, the 0012 `appId` reconciliation, neighbor-doc
   obligations, the admin-surface line, the id-scope tightening, one vocabulary
   collision), not a new direction.
2. **Reconcile `appId` semantics with 0012 first.** C2/C4 touch another document's
   *ratified* artifact; settle uniqueness/stability/portability and any new per-app
   fields with 0012 directly before either document advances.
3. **Land (or open tracking notes for) the reconciling edits in 0007, 0008, 0013,
   and 0017**, per the land-docs-with-the-change convention, so the corpus does not
   desync from the boundary 0018 declares.
4. **Get a read that is neither this editing Claude pass nor the GPT-5 author** —
   ideally Charlie, since this pass both reviewed and edited the text.
