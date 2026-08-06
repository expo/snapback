# LLP 0184 — super-refine run journal

**Target:** `llp/0184-agent-accessible-control-plane.rfc.md`
**Invoked:** 2026-08-05 by the author (Charlie Cheever), via `/llp-super-refine 0182 --max-rounds 3`
**Orchestrator/reviser:** Claude Sonnet 5 (this session)
**Round budget:** 3 · **Launch cap:** 6 per family per target
**Topology:** single document, single loop (0182 is a standalone RFC; its
`Related` list is other authority owners it reads and defers to, not tightly
coupled siblings under simultaneous refine)

## Authorization and disclosure

- Document authority: the author invoked the loop directly on this named
  target.
- Status transition applied **before** launch: `Draft → Review`.
- Revision identifier: this document is not yet committed to git (new file,
  untracked at loop start), so revisions are identified by content sha256
  rather than a commit hash.
- Outbound disclosure: each review capsule instructs the reviewer to read the
  target document in full, plus — at the reviewer's discretion, to check the
  RFC's factual and scope claims — the LLPs it cites as authority owners
  (0017, 0024, 0031, 0036, 0042, 0058, 0061, 0146, 0167, 0179) and the source
  paths it names (`src/cli.rs`, the host-operation/route registries, the two
  MCP servers, `packages/snapback-admin-client`, `guide/`). No credentials or
  secrets are in scope. Destinations: Anthropic (claude family, via a fresh
  subagent in this same local checkout) and OpenAI (gpt-5 family, via local
  `codex exec` in this same local checkout).

## ⚠ Blindness is instruction-based, not structural

Both reviewers run inside this same repository checkout with full filesystem
read access — there is no git-archive export or sandboxed capsule excluding
`llp/reviews/0184*`. Each reviewer is explicitly instructed not to read
`llp/reviews/0184-*` or this run journal. This is self-attested
instruction-based blindness (LLP 0010 §2), disclosed per the invariant.
Neither family authored this RFC (`Author:` line reads "Charlie Cheever /
Codex" — a prior Codex session contributed drafting, but the reviewing gpt-5
session here is fresh and has no memory of that work), so there is no
self-review bias in either direction.

## Round 1

- **Entering revision:** content sha256
  `39e3bc4ffbdf7b8210941a78def35a7fa4b15d1bf26aec929fa93cde80d180e8`
- **Entering status:** Review (transition applied pre-launch)
- **Reviewers:** claude family = fresh Opus 5 subagent (general-purpose, no
  prior context); gpt-5 family = local `codex exec -m gpt-5.6-sol -c
  model_reasoning_effort=xhigh`, sandboxed read-only.
- **Lens:** none declared (standard review).

### ⚠ ORCHESTRATOR ERROR — stale hash given to reviewers

The `bd7584d1…` hash quoted in both review-capsule prompts was computed
*before* the `Draft → Review` status-line edit, not after. The true entering
revision is `39e3bc4f…` above. The gpt-5 reviewer caught this independently
(refused to bind to bytes not present on disk) and bound its verdict to the
correct hash; recorded here rather than quietly fixed. The claude-family
prompt carries the same stale value — its round-1 verdict binding will be
checked against its own stated hash on receipt, and if it also used
`bd7584d1…` without independent verification, that binding is treated as void
and round 1 does not count as a real, hash-bound verdict for that family;
round 2 would need to re-run for it against a correct hash.

Round record persisted; launched.

### Round 1 verdicts — both NOT READY, both correctly self-corrected the hash

Both reviewers independently detected the stale `bd7584d1…` hash in their
prompts, refused to bind to bytes not on disk, and bound their verdicts to
the true entering revision `39e3bc4f…` instead. Round 1 counts as a real,
hash-bound round for both families — the orchestrator error above did not
void it.

| family | verdict | MATERIAL | DETAIL |
| --- | --- | --- | --- |
| claude (Opus 5, blind) | NOT READY | 6 | 7 |
| gpt-5 (codex exec, gpt-5.6-sol@xhigh, blind) | NOT READY | 8 | 3 |

Full text: `llp/reviews/0184-agent-accessible-control-plane.claude.md`,
`llp/reviews/0184-agent-accessible-control-plane.gpt-5.md`.

### Cross-family agreement — concerns both families independently raised

- **`agentAccess`/`api` disposition is not cleanly enforceable and OQ5 breaks
  it** (claude MATERIAL 3; gpt-5 DETAIL 1 raises the same non-exclusivity,
  less forcefully).
- **`data.patch`'s preview→apply binding is underspecified** (gpt-5 MATERIAL
  5, most forcefully; claude did not flag this one directly — see
  disagreement note below).
- **Completeness-rule domain/enforceability gaps** (claude MATERIAL 4 and 5
  on console/route domain fail-open-ness; gpt-5 MATERIAL 1 on the same
  general failure mode — undeclared operations are invisible to the
  checker).
- **Selected-operation scope contradicts open questions** (gpt-5 MATERIAL 8
  — force-resync targeting and patch bypass rule stated as settled in the
  design but reopened in OQ3/OQ4; claude's OQ3/OQ4 verification notes read
  these as *not* foreclosing, a partial disagreement — see below).

### Where the two families disagree or found different defects

- **gpt-5** found the **ephemeral-delete ABA/epoch hole** (MATERIAL 6) and
  the **table-scan cursor-vs-offset mismatch** (MATERIAL 3) — claude did not
  raise either.
- **claude** found the **`mcp-control` guide-resource embedding
  infeasibility** (MATERIAL 1, arguably the most severe finding of the
  round — it says the RFC's central discovery fix is unbuildable as
  specified) and the **LLP 0146 remediation dependency being unbuilt/open**
  (MATERIAL 2) — gpt-5 did not raise either, though gpt-5 MATERIAL 7 raises
  an adjacent point about the same LLP 0146 remediation carrier being
  undecided at the *owner* level (converges with claude MATERIAL 2 from a
  different angle: gpt-5 frames it as "0182 has no delivery dependency that
  settles the owner decision," claude frames it as "0182 covertly answers
  half the owner's open question" — same defect, complementary framings).
  Both stand.
- **claude** found the missing LLP 0044 boundary disclaimer (MATERIAL 6) —
  gpt-5 did not.
- **OQ3/OQ4 reading differs slightly:** gpt-5 MATERIAL 8 treats §A/§B's
  concrete v1 rules as *contradicting* OQ3/OQ4's framing of the same
  questions as open. claude's verification notes read §A's rule as
  consistent with OQ3's stated "conservative default," i.e. not a
  contradiction, and score OQ3/OQ4 as legitimately open. This is a real
  disagreement worth resolving in the revision by making OQ3/OQ4's text
  explicitly reference the v1 defaults already chosen in §A/§B, framing them
  as narrower residual questions (e.g. "is bypass ever allowed to widen past
  this default") rather than reopening the default itself.

All 14 distinct MATERIAL concerns (6 claude + 8 gpt-5, with 1 cross-family
overlap on the disposition-enum issue) are addressed in the round-1 → round-2
revision below.

## Round 1 → round 2 revision

Applied directly to `llp/0184-agent-accessible-control-plane.rfc.md`. Summary
(full detail in the file's own `**Revised:**` line and diff):

- Split `agentAccess` into a checkable surface axis (`native`/`cliOnly`/`api`/
  `mediated`/`internal`/`unavailable`) plus independent `destructive`/
  `approvalPosture` fields — claude MATERIAL 3, gpt-5 DETAIL 1.
- Named the `mcp-control` guide-resource carrier (packaged, build-stamped
  generated guide artifacts + running-server proxy + mismatch refusal) —
  claude MATERIAL 1.
- Scoped the LLP 0146 remediation dependency as conditional, not a resolution
  of 0146 OQ6 — claude MATERIAL 2, gpt-5 MATERIAL 7.
- Closed rule 1's domain (`RouteClass != AppData` ∪ `host_ops.*`, explicit
  app-data exclusion) and rule 2's fail-open gap (walks `app.contract`'s
  declared `action` enumeration, requires a `uiLocal` marker) — claude
  MATERIAL 4, 5.
- Added LLP 0044 (and 0094/0095 for §B) to the authority-disclaimer list;
  added LLP 0044/0009/0158 to `Related` — claude MATERIAL 6.
- Fixed `data.patch`'s authority vocabulary (`devUser`/`devAdminBypass`
  projected as-is; `operatorBypass` reframed as a disclosure flag, not a new
  authority axis) and added a single-use apply token binding preview to apply
  — gpt-5 MATERIAL 4, 5.
- Fixed the ephemeral-delete ABA hole: fence on scope epoch **and** entry
  generation together, plus a room-recreate acceptance case — gpt-5 MATERIAL
  6.
- Fixed the P1 table-scan claim to offset paging (matching the shipped
  route), not a cursor — gpt-5 MATERIAL 3.
- Made §A/§B state explicit v1 defaults and reworded OQ3/OQ4 as narrower
  widening questions instead of reopening the same default; reworded OQ5
  around the new independent `approvalPosture` field — gpt-5 MATERIAL 8,
  cross-family disagreement note above.
- Also applied: claude DETAIL 1, 2, 3, 4, 5, 6 (17-tool wording, disconnect
  row nuance, in-code host-op allowlist, LLP 0167 OQ5 citation + HTTP-marker
  specificity, `--install` authority disclosure, SQL-hatch carve-out) and
  gpt-5 DETAIL 2 (resync fencing shape). claude DETAIL 7 (notAuthorFacing↔
  agentAccess mapping table) and gpt-5 DETAIL 3 (already covered by DETAIL 1)
  were not separately added — logged here as **not fixed this round**
  (DETAIL-only, does not block READY per the altitude rule).

**New revision:** content sha256
`74135492985dbcb563d0ed6cbd259d20875f0a35ba9a56cac87119b87151b28b` (884
lines, +22.4% over the 722-line entering revision — slightly over the ~20%
growth guideline; disclosed rather than silently exceeded, given the volume
of distinct MATERIAL concerns from two independent families addressed in one
pass).

## Round 2

Full fresh blind review (not a delta round — round 2 of a 3-round budget,
and the revision touched enough of the document's structure that a full
re-read is more useful than a delta classification exercise). Same
blindness/independence setup as round 1.

- **Entering revision:** content sha256
  `74135492985dbcb563d0ed6cbd259d20875f0a35ba9a56cac87119b87151b28b`
- **Entering status:** Review (unchanged)
- **Reviewers:** claude family = fresh Opus 5 subagent; gpt-5 family = local
  `codex exec -m gpt-5.6-sol -c model_reasoning_effort=xhigh`.
- **Lens:** none declared, but each reviewer is told round 1 happened and
  where to find the round-1 concern list, and asked to check whether each
  round-1 MATERIAL concern was actually resolved, in addition to a normal
  full adversarial pass for new defects.

Round record persisted; launched.

### Round 2 verdicts — both NOT READY, real progress + new defects from the revision itself

| target | family | verdict | round-1 concerns resolved | new MATERIAL | new DETAIL |
| --- | --- | --- | --- | --- | --- |
| claude (Opus 5, blind to gpt-5, saw own round-1 review) | NOT READY | 3 resolved / 2 partial / 1 not resolved (of 6) | 6 | 6 |
| gpt-5 (codex exec, blind to claude, saw own round-1 review) | NOT READY | 5 resolved / 3 partial (of 8) | 4 | 3 |

Full text: `llp/reviews/0184-agent-accessible-control-plane.claude-round2.md`,
`llp/reviews/0184-agent-accessible-control-plane.gpt-5-round2.md`.

This round validated the "revision is a proven defect source" warning in the
skill's own advisory text: round 1's two most structural fixes — the guide
resource carrier and the `agentAccess`→domain predicate — were each written
from a plausible-sounding but unverified claim about the code, and both
families caught it independently (claude: guide carrier "NOT RESOLVED" with
`build.rs`/`guide-lib.mjs` citations proving the two commits are designed to
diverge; gpt-5: "commit-only guide matching does not establish a build-matched
carrier," converging on the same root defect from the build-identity-fields
angle). Both families independently converged on the disposition-enum still
not being mutually exclusive (claude New MATERIAL 3, gpt-5 New MATERIAL 1)
and on §B's invented per-subscription generation being undiscoverable/
undefined (claude New MATERIAL 5, gpt-5 New MATERIAL 2) — strong
cross-family signal that both are real, not reviewer idiosyncrasy.

gpt-5 additionally caught that round 1's `data.patch` fix got LLP 0024's
`devAdminBypass` semantics backwards (described it as "evaluated under the
application's own authorization" when LLP 0024 defines it as an *explicit
bypass*) and that the apply token bound only the coarse evaluation mode, not
the full authority tuple — both are round-1-concern-4/5 residue, not new.
gpt-5 flagged `config.unset`'s misclassification as `mediated` as New
MATERIAL 3 with an exact code citation
(`src/server.rs:17522-17535`, "carries no value... the admin write gate
does").

## Round 2 → round 3 revision

Applied directly to `llp/0184-agent-accessible-control-plane.rfc.md`. This
is the **last revision in the 3-round budget** — round 3's review (below) is
the final scheduled round.

- **Replaced the single `agentAccess` enum with two independent closed
  fields** — `surfaceAccess` (`native`/`cliOnly`/`mcpOnly`/`apiOnly`/`none`)
  and `operability` (`direct`/`mediated`/`internal`/`unavailable`) — so a
  CLI-only *and* human-mediated operation (`snapback admin link`) or an
  MCP-only *and* directly-invocable one (`host.restart`) each get an
  unambiguous pair instead of contending for one slot. Rules 4-8 and every
  downstream `native`/`api`/`agentAccess` reference updated to match. This
  directly answers claude New MATERIAL 3 and gpt-5 New MATERIAL 1
  (independently converged).
- **Fixed the domain predicate**: `RouteClass::SystemApi` (+ `host_ops.*` +
  the one named `app.ensure.provision` policy exception), not "not
  `AppData`" — the old predicate literally included `direct_runner.*` and
  swept in `SystemStatic` console/guide routes while excluding an
  `AdminWrite`/`Operator` route by route class. Added a fourth domain leg
  (CLI-side declarations) for operations with no route/host-op owner
  (`snapback fork`, `auth`, `build-identity`, the SQL hatch), which rule 3
  required rows for but the old domain rule could never produce — claude New
  MATERIAL 1, 2.
- **Replaced the packaged-guide-snapshot carrier with invoking the
  co-installed native runtime binary directly** — round 1's fix compared a
  commit that is deliberately allowed to diverge from the running build's;
  round 3 removes the duplicate artifact entirely rather than trying to
  compare it correctly — claude round-1-concern-1 (still NOT RESOLVED after
  round 1's fix) + gpt-5 New MATERIAL 4.
- **Split `config.set` (secret-carrying, `mediated`) from `config.unset`
  (no value crosses the wire, ordinary direct `AdminWrite` operation)** —
  gpt-5 New MATERIAL 3, with the exact handler-comment citation.
- **§A: wrote the actual v1 target rule into the text** instead of leaving it
  implicit and having OQ3 assert a default that wasn't there; scoped
  `devAdminBypass` derived-instance eligibility as a *proposed new grant* to
  LLP 0158 (whose text today recognizes derived identity for network-profile
  activation only, not general authority) rather than an existing one;
  fixed `devUser`/`devAdminBypass` to match LLP 0024's actual semantics
  (bypass is an admitted skip, not "evaluated"); bound the full authority
  tuple (not just the mode) into the apply token — claude New MATERIAL 4 +
  gpt-5 round-1-concern-4/5 residue.
- **§B: removed the invented per-subscription generation**, fencing instead
  on subscription id + connection id + startup nonce, matching what LLP
  0095's actual subscription-scoped resync transition requires and what the
  operator inspect projection can actually expose — claude New MATERIAL 5 +
  gpt-5 New MATERIAL 2 (independently converged).
- **Scoped rule 9 / the surface-map projection claim**: the catalog
  generates only the control-domain half of `guide/surface-map.md`; LLP
  0061's app-data rows stay separately owned, so generating from the catalog
  alone doesn't silently drop ~40 rows the existing check requires — claude
  New MATERIAL 6.
- Also applied: gpt-5 round-2 DETAIL 1 (`cliOnly`/`mcpOnly` guide entries
  don't need the surface they don't have), DETAIL 2 (receipt names the token
  by digest, not the live value), DETAIL 3 (ephemeral-delete v1 states it is
  always operator-bypass, not "reports whether"). **Not fixed this round**
  (DETAIL-only, logged per the altitude rule): claude round-2 DETAIL 3
  (`snapback dev` verb channel unenumerated), DETAIL 4 (`CLI_ONLY_HOST_OPS`
  false `host.restart` ownership claim), DETAIL 5 (`notAuthorFacing`↔
  disposition mapping table, carried over from round 1), DETAIL 6 (Phase 1
  backfill vs. phased rule activation). claude round-2 DETAIL 1 (package
  name) was fixed as a side effect of the guide-carrier rewrite.

**New revision:** content sha256
`1260f4e716b257f27f9756ff2ef374c22e0bd3c49ad23dc962f263619c3fe030` (1022
lines, +41.6% over the 722-line entering revision). This is well past the
~20% growth guideline. Disclosed rather than trimmed: two full review rounds
surfaced 24 distinct MATERIAL concerns across two independent model
families, several structural (the disposition model, the domain predicate),
and the reviewers' own pattern — vague/under-specified text is exactly what
produced defects — argued against cutting words to hit a budget at the cost
of reintroducing the ambiguity. Flagged explicitly for the author rather
than silently exceeded.

## Round 3

- **Entering revision:** content sha256
  `1260f4e716b257f27f9756ff2ef374c22e0bd3c49ad23dc962f263619c3fe030`
- **Entering status:** Review (unchanged)
- **Round budget note:** this is round 3 of 3 — the last review in budget.
  If NOT READY on both families again, the loop terminates per the bounds
  rule (budget exhaustion) with a terminal escalation to the author rather
  than a fourth round.
- **Reviewers:** claude family = fresh Opus 5 subagent; gpt-5 family = local
  `codex exec -m gpt-5.6-sol -c model_reasoning_effort=xhigh`.
- **Lens:** same as round 2 — each reviewer reads its own family's round-2
  review, checks resolution of those concerns specifically, and does a full
  fresh adversarial pass for anything new. Blind to the other family's
  review and to this run journal.

Round record persisted; launched.

### Round 3 verdicts — both NOT READY; budget exhausted (3/3 rounds used)

| target | family | verdict | round-1/2 concerns resolved | new MATERIAL | new DETAIL |
| --- | --- | --- | --- | --- | --- |
| claude (Opus 5, blind to gpt-5, saw own round-1+2 reviews) | NOT READY | 6 resolved / 3 partial (of 9 tracked) | 4 | 9 |
| gpt-5 (codex exec, blind to claude, saw own round-1+2 reviews) | NOT READY | 9 resolved / 3 partial (of 12 tracked) | 2 | 1 |

Full text: `llp/reviews/0184-agent-accessible-control-plane.claude-round3.md`,
`llp/reviews/0184-agent-accessible-control-plane.gpt-5-round3.md`.

**Disclosed tooling note (gpt-5):** one `rg` invocation surfaced a single
line from this run journal restating the `snapback admin link` example. The
reviewer flagged this itself, did not use the line as evidence, and the
independence of its verdict is not materially affected — noted here rather
than silently accepted, per the "self-attested" blindness discipline.

**Trajectory across three rounds** (distinct MATERIAL concerns, both
families combined, dedup'd where the same defect was independently found by
both): round 1 → 14, round 2 → 10 (4 recurring/residue + 6 new), round 3 → 6
(0 recurring at MATERIAL severity + 6 new, 2 of which — the `unavailable ⇒
surfaceAccess: none` contradiction on `acceptance.run` — were found
independently by both families again). Both families explicitly characterize
the round-3 remainder as small and mostly mechanical:

- claude: "All four MATERIAL concerns are drafting-scale and none touches
  the RFC's approach... Two small things would benefit from the author
  rather than a drafter."
- gpt-5: "The remaining defects are solvable, but not all by another
  drafting pass. The false completeness and operator-tuple claims can be
  repaired mechanically once their registration/identity seams are chosen.
  The access-axis model, hosted catalog scope, and derived-operation grants
  require explicit author and semantic-owner judgment."

### Round 3 remaining MATERIAL concerns — full ledger (nothing summarized away)

1. **`app.ensure.provision` domain exception keyed on route, not operation
   identity** (claude) — `/app/ensure` serves three operations on one path;
   a route-keyed rule both requires and forbids a row for it. Mechanical fix:
   key by operation identity, as the prose already intends.
2. **`unavailable ⇒ surfaceAccess: none` misclassifies `acceptance.run`**
   (claude New MATERIAL 2, gpt-5 concern 9 second bullet — independently
   convergent). The constraint forces an exposed-but-unbuilt, LLP
   0024-pinned tool into `internal` (false: it is not deprecated/unsupported,
   it is desired-but-unbuilt) to avoid a contradiction that does not
   actually exist — the tool's own MCP wrapper already returns the pinned
   unimplemented diagnostic rather than a fake success. Mechanical fix: drop
   the constraint.
3. **`apiOnly → native` promotion is unconditioned by response sensitivity**
   (claude) — `auth/mailbox` (`CredentialSecret`/`ImpersonationCapability`)
   is promotable by usage evidence into a typed MCP tool whose ordinary
   result is credential plaintext, contradicting "No secret in convenience
   channels." Mechanical fix: pin promotion refusal on
   `responseSensitivity`/effect.
4. **`host.restart`, the chosen `mcpOnly` archetype, is a client-composed
   envelope over no real server operation** (claude) — `snapback_restart`
   synthesizes its result from stop-then-start; no `host.restart` host-op
   exists to catalog. Author-level: keep the composition and represent it
   honestly, or pick a different archetype, or build the real operation.
5. **The catalog's own domain predicate is Rust/local-registry-only; the
   hosted (Cloudflare) arm has no enforceable route registry to join
   against** (gpt-5, new) — LLP 0031 explicitly documents "the hosted arm
   has no enforceable route registry (the gateway is a hand-routed Worker)";
   real hosted system controls (e.g. `/_snapback/api/object/evict`) have no
   Rust `RouteClass` entry to be caught by. **This is the most structural
   remaining item** — it means the "no accidental click-only controls"
   completeness claim is unfalsifiable for the hosted target as scoped.
   Author-level: either explicitly scope the catalog to the local/derived
   arm for v1 (stating hosted completeness is future work with its own
   enforcement seam), or design a hosted-adapter declaration seam now.
6. **Derived-instance authority widening is fixed for §A but not
   consistently for §B/§C/Risks** (gpt-5, new) — §A now correctly refuses
   derived-instance bypass pending an LLP 0158 owner grant; §C's ephemeral
   delete says "local/derived-only" without the same conditional refusal,
   §B refuses only "primary hosted instances" without addressing derived,
   and §Risks still says "Restrict v1 to existing-row patches on
   local/derived instances" unconditionally. Mechanical fix: apply §A's
   exact conditional wording to all three.
7. **Console/AdminClient completeness is still a voluntarily maintained
   manifest, not a mechanically closed boundary** (gpt-5, reopened from
   round 1/2) — the two known imperative exceptions are now named, but
   nothing forces a *future* imperative call or new public `AdminClient`
   method to appear in any manifest; no negative fixture is specified.
   Author-level: decide whether a mechanically closed boundary (import
   restriction, AST check, reflection-based enumeration) is worth building,
   or accept a maintained-manifest model with periodic drift audits as the
   v1 posture (a real trade-off, not obviously wrong, but currently
   undecided rather than chosen).
8. **The `data.patch` bypass receipt requires an "operator identity" that
   does not exist in any cited owner or implementation** (gpt-5, reopened
   from round 2 — and the error compounds a round-2 suggestion the
   orchestrator carried into a normative requirement without checking it).
   LLP 0024's `devAdminBypass` and the shipped `ResolvedAppAuthority::
   AdminBypass`/host-ops projection carry only a reason, `actor_principal:
   None`. Author-level: either bind the tuple that actually exists (mode +
   reason, no principal) or make an explicit decision to introduce and
   authenticate a stable operator identity (a real LLP 0024/0058 change, not
   something this RFC can assert into existence).
9. **`operability` still isn't fully independent of the other fields**
   (gpt-5, reopened from round 2, additional angles) — `mediated` and
   `approvalPosture: humanApprovalRequired` can both true simultaneously
   with `operability: direct`; `config.set`'s mediation-vs-direct-ness
   varies by which safe carrier is used for a given call, which a
   per-semantic-operation field cannot represent. Converges with concern 2
   above (same root: `operability` conflates implementation status, support
   policy, and per-invocation mediation into one field). Author-level: this
   is the one item both families now agree is the load-bearing open
   decision — whether classification belongs to the semantic operation, the
   invocation variant, or the credential carrier.

### Terminal disposition — budget exhausted, escalating to the author

Per the bounds rule (LLP 0010 §2): round budget (3/document) is exhausted
with both families still NOT READY. This is not a sustained-asymmetry or
cross-family-contradiction escalation (both families agree on direction and
substantially on specific findings — items 2 and 9 above were found
independently by both); it is ordinary budget exhaustion after real,
measured convergence (14 → 10 → 6 distinct MATERIAL concerns across rounds,
with two of round 3's six independently cross-confirmed).

### Author extension — rounds 4-5 authorized

The author reviewed the round-3 terminal report and extended the round
budget: "You can do a 4th and 5th round." The three open judgment calls from
the report were resolved directly by the author:

1. **Hosted/Cloudflare arm in v1 scope?** — **Yes.** Not deferred; §Design/3a
   (new) adds a fifth domain leg for it.
2. **Console/AdminClient completeness: mechanical enforcement or maintained
   manifest?** — author said "I don't understand this," so the orchestrator
   explained the trade-off in plain terms via AskUserQuestion (mechanical
   enforcement makes "silence is a build failure" literally true for this
   surface but costs more to build; a maintained manifest with periodic
   audit is simpler but relies on the existing LLP corpus audit cadence to
   catch drift, not CI) and the author chose **hand-maintained manifest +
   periodic audit**. Recorded explicitly in the RFC (§Design/3, rule 2) as
   the chosen v1 posture rather than an open question.
3. **`operability` decomposition (per operation / per invocation variant /
   per credential carrier)?** — author had no strong view and delegated the
   call. Orchestrator's resolution: separate `mediated` (an intrinsic
   property of the operation's own design — the agent structurally cannot
   hold the protected material) from `approvalPosture: humanApprovalRequired`
   (a safety gate on an otherwise-direct call, already independent per round
   1); for the one genuinely carrier-dependent case (`config.set`), split it
   into two rows (`config.secret.acquire`, mediated; `config.set`, direct)
   rather than trying to make one row's `operability` vary by call.

## Round 3 → round 4 revision

Applied directly to `llp/0184-agent-accessible-control-plane.rfc.md`, using
the author's rulings above plus the mechanical fixes both families flagged
as fixable without redesign:

- **`app.ensure.provision` domain exception re-keyed to operation identity**,
  not route — `/app/ensure` serves three operations on one path; the
  checker now tests the dispatched operation, not the shared path (claude
  round-3 New MATERIAL 1).
- **Dropped the `unavailable ⇒ surfaceAccess: none` constraint** — rule 7
  now requires no surface on an `unavailable` row to return success, without
  forcing `acceptance.run`'s real `mcpOnly` projection into a false
  `internal` classification (claude New MATERIAL 2, gpt-5 concern 9 —
  independently convergent both round 2 and round 3).
- **Pinned `apiOnly → native` promotion against `CredentialSecret`/
  `ImpersonationCapability` rows** (`auth/mailbox` is the concrete case) —
  usage-evidence promotion can no longer mint a typed MCP tool whose
  ordinary result is credential plaintext (claude New MATERIAL 3).
- **`snapback_restart` declared as a composed projection** (`composedFrom`
  field), not a false thin projection of a nonexistent `host.restart`
  host-op; `CLI_ONLY_HOST_OPS`'s false ownership claim added to Phase 0 item
  1 (claude New MATERIAL 4).
- **Added §Design/3a, the hosted (Cloudflare) domain leg** — a hosted-adapter
  manifest checked against `gateway.js`'s actual dispatcher, the same
  positive-enumeration shape as rule 2's console check, per the author's
  scope ruling (gpt-5 New MATERIAL 1, the most structural round-3 finding).
- **Aligned §A/§B/§C/Risks derived-instance target wording** to §A's exact
  conditional (refused on derived until an LLP 0158 grant, not implied to
  already exist) — §B and §C previously drifted from §A's own fix, and
  Risks still had the pre-fix phrasing (gpt-5 New MATERIAL 2).
- **Fixed `data.patch`'s receipt/apply-token authority tuple** to bind what
  LLP 0024 actually defines — `devAdminBypass` has no operator-principal
  field (`actor_principal: None` in the shipped projection); the round-2→3
  text asserted one that doesn't exist, compounding an unverified round-2
  suggestion into a normative requirement (gpt-5, reopened concern 5).
- **Split `config.secret.acquire`/`config.set`** so `config.set`'s
  carrier-dependent mediation lives in two rows instead of one field trying
  to hold two values (gpt-5, reopened concern 9, per the author's ruling
  above).
- **Named the console-completeness manifest's posture explicitly** as
  hand-maintained + audit for v1, with AST/import-boundary enforcement noted
  as deferred-not-ruled-out (gpt-5, reopened concern 1, per the author's
  ruling above).
- **Not fixed this round** (DETAIL-only, logged per the altitude rule):
  gpt-5 round-3 DETAIL 1 (forced-resync negative-case acceptance witnesses);
  claude round-3 DETAILs 1, 2, 3, 5, 6, 7, 8, 9 (research-snapshot scope
  realism, runtime-binary platform coverage, the catalog's own carrier vs.
  the guide's, `config.unset` disposition stated two ways — now moot after
  the P2/P3 rewrite made both say `(cliOnly/native, direct)` consistently,
  `mcpOnly`'s definition embedding one operation's rationale, phase/rule
  activation timing, the `snapback dev` verb channel, the `notAuthorFacing`↔
  new-fields mapping table, and §A's derived-leg-as-availability-target
  framing).

**New revision:** content sha256
`3c71252e10685adbace8f21467c6433e0a12e5e622fa475f0b26e27694237868` (1197
lines, +65.8% over the 722-line entering revision). Growth continues past
the ~20% guideline for the same reason as rounds 1-3: this round added a
genuinely new domain (the hosted arm) at the author's explicit direction,
which is new scope, not padding. Disclosed, not hidden.

## Round 4

- **Entering revision:** content sha256
  `3c71252e10685adbace8f21467c6433e0a12e5e622fa475f0b26e27694237868`
- **Entering status:** Review (unchanged)
- **Round budget note:** author-extended to 5 rounds total; this is round 4
  of 5.
- **Reviewers:** claude family = fresh Opus 5 subagent; gpt-5 family = local
  `codex exec -m gpt-5.6-sol -c model_reasoning_effort=xhigh`.
- **Lens:** same pattern as rounds 2-3 — each reviewer reads its own
  family's full history (rounds 1-3), checks resolution of concerns still
  open after round 3 specifically, and does a full fresh adversarial pass,
  with extra attention to the newly added hosted-arm domain leg and the
  `config.secret.acquire`/`config.set` split since those are genuinely new
  surface this round rather than fixes to existing text. Blind to the other
  family's review and to this run journal.

Round record persisted; launched.

> **Editorial note:** the round-3 terminal-escalation paragraphs ("Final
> verdicts bind to... 1022 lines... outside this loop's 3-round budget")
> that previously closed this journal are superseded by the author's
> round 4-5 extension above and are removed from here rather than left
> trailing after the round-4 section, where they would misstate that no
> later revision exists. The round-3 verdicts themselves remain accurately
> recorded in the round-3 section above, bound to revision
> `1260f4e716b257f27f9756ff2ef374c22e0bd3c49ad23dc962f263619c3fe030`.

### Renumbering event — 0182 → 0184

Mid-round-4 (during the gpt-5 review), a concurrent process in this shared
working tree renumbered this document and its entire review family from
`0182` to `0184` — LLPs 0182 (`zerobugs-snapback-parity.research`) and 0183
(`zerobugs-quality-surface.rfc`) landed from another session and collided
with this document's number. The rename covered the RFC file, this journal,
and all six per-round review artifacts, rewriting internal path references
consistently (verified: zero stale `reviews/0182` references remain in this
journal). Content was **not** altered by the rename — the gpt-5 round-4
reviewer independently proved this by substituting `0184`→`0182` in the
renamed file and reproducing the exact pre-rename hash
(`3c71252e10685adbace8f21467c6433e0a12e5e622fa475f0b26e27694237868`). All
prior-round verdicts and hashes above remain valid; only the path and title
number changed, from this point on to `llp/0184-agent-accessible-control-plane.rfc.md`.
Post-rename content hash: sha256 `05f5fa6be0fe5f0295be875a562a0ed41ef6fb11357ed1d07cdd21c285fe1edd`
(1197 lines, byte-identical to the pre-rename `3c71252e...` except for the
title line's number). Round 4 verdicts below bind to whichever of the two
hashes each reviewer computed at its own review time; both denote the same
content.

### Round 4 verdicts — both NOT READY; strong convergence on one bug

| target | family | verdict | round-1/2/3 concerns resolved | new MATERIAL | new DETAIL |
| --- | --- | --- | --- | --- | --- |
| claude (Opus 5, blind to gpt-5, saw own round-1/2/3 reviews) | NOT READY | 8 resolved / 1 partial (of 9 tracked) | 3 | 11 |
| gpt-5 (codex exec, blind to claude, saw own round-1/2/3 reviews) | NOT READY | 6 resolved / 1 not resolved / 2 partial (of 9 tracked) | 3 | 0 |

Full text: `llp/reviews/0184-agent-accessible-control-plane.claude-round4.md`,
`llp/reviews/0184-agent-accessible-control-plane.gpt-5-round4.md`.

**Both families independently caught the same bug**, the strongest
cross-family convergence signal in the whole loop: round 4's claim that
`host_ops.host.restart` "isn't" a registered operation is false —
`src/server.rs:15531-15536` registers it, and `snapback_restart` already
declares `operation: 'host.restart'` against it (`mcp-control.mjs:209-210`).
Both reviewers also independently found round 4's hosted-leg claim
("the same shape as rule 2's `app.contract` check") doesn't survive contact
with `gateway.js`'s actual imperative dispatch — no routing table exists to
enumerate without an AST parse. And both flagged that two round-4 fixes
(the hosted leg, the `apiOnly` sensitivity pin) existed only in prose, never
reaching the enumerated CI rules or Acceptance.

gpt-5 additionally found `config.secret.acquire` was underspecified — no
defined artifact crossing to `config.set` — and, checking the shipped setup
page directly, found the human-entry path already POSTs straight to
`config/set` itself, which is what made the round-5 fix below possible.

### Author extension #2 and the hosted-arm judgment call

The round-4 report surfaced one remaining judgment call (both families
agreed it needed the author, not more drafting): should the hosted-arm
completeness check be (a) hand-maintained-plus-audit, matching rule 2's
existing v1 posture for the console's two exception pages, or (b) a real
`gateway.js` refactor into a declared route table so the check becomes
genuinely mechanical? The author chose **(a)**, via AskUserQuestion.

## Round 4 → round 5 revision

Applied directly to `llp/0184-agent-accessible-control-plane.rfc.md`:

- **Reverted the false `host.restart` ownership claim.** `projections.hostOps`
  and `composedFrom` are now both populated (additive, not substitutive);
  the real anomaly — HTTP refuses `host.restart` outright while MCP executes
  it via direct binary spawn with no admin-credential gate — is disclosed
  explicitly, and "No projection creates authority... same result semantics"
  is restated as "no projection *widens* the authority its own gate
  enforces," honest about this one process-lifecycle family rather than
  claiming a parity the shipped code doesn't have (claude New MATERIAL 1,
  gpt-5 New MATERIAL 3 — independently convergent).
- **§3a rewritten to hand-maintained-plus-audit**, matching rule 2's own v1
  posture: the manifest is checked against its own known `gateway.js` cases
  at generation time; a *new* hand-routed case with no manifest entry is an
  audited gap (LLP 0016 reconcile cadence, per LLP 0031's own designation of
  the Cloudflare acceptance suites as the hosted enforcement seam), not a CI
  failure — stated as such rather than claimed away (claude New MATERIAL 3,
  gpt-5 New MATERIAL 1 — independently convergent; author's ruling above).
- **Added CI rule 11** (hosted-adapter manifest ↔ known `gateway.js` cases,
  with its audited-gap limitation stated in the rule itself) and **added
  both the hosted leg and the `apiOnly` sensitivity pin to rule 10's trigger
  list, rule 5's enumerated text, and both relevant Acceptance bullets** —
  previously prose-only (claude New MATERIAL 2).
- **Reworked `config.secret.acquire`/`config.set`** from a sequential
  handoff (unspecified artifact) to two disjoint paths: the human-entry page
  already writes directly to `config.set`'s route without agent involvement,
  so `config.secret.acquire`'s poll response is a bare status, never a value
  or reference — nothing needs to cross to `config.set` because the two
  paths never chain. Framed explicitly as a proposed LLP 0036 catalog
  addition (projecting 0036's existing L0 guided-human mechanism), not a new
  authority this RFC invents (gpt-5 New MATERIAL 2).
- **Fixed `Phase 0 item 1`** to also repair the `SNAPBACK_HOST_OP_CLI_ONLY`
  diagnostic text callers actually receive, not only the allowlist comment.
- Also applied: `config.unset`/`config.set` Phase-1-backfill (`apiOnly`)
  framing, the shortfall table's `Config set` row noting the split, the
  `mcpOnly` definition's `host.restart`-specific rationale moved to its own
  `cliDeferralReason`, and OQ3's premise narrowed to the branch (`
  devAdminBypass` only) that's actually conditional. **Not fixed this
  round** (DETAIL-only): the catalog's own `mcp-control` carrier (distinct
  from the guide's, carried since round 3), CI-rule phase-activation timing,
  the `snapback dev` verb channel, the `notAuthorFacing`↔new-fields mapping,
  and the observed fifth authority mode (`adminSecretRead`) worth folding
  into Phase 0's truth repair.

**New revision:** content sha256
`c81845de5135aaef9325521f850716b98663212b57553ae395a67c78528dfb81` (1310
lines). Growth continues to be driven by genuinely new scope (the hosted
leg, the config split) and defect fixes, not padding; disclosed as in prior
rounds.

## Round 5 (final round in the author-extended budget)

- **Entering revision:** content sha256
  `c81845de5135aaef9325521f850716b98663212b57553ae395a67c78528dfb81`
- **Entering status:** Review (unchanged)
- **Round budget note:** this is round 5 of 5 — the author-extended budget
  is now exhausted regardless of outcome. No round 6 without a further
  explicit author extension.
- **Reviewers:** claude family = fresh Opus 5 subagent; gpt-5 family = local
  `codex exec -m gpt-5.6-sol -c model_reasoning_effort=xhigh`.
- **Lens:** same pattern as rounds 2-4 — each reviewer reads its own
  family's full history (rounds 1-4), checks resolution of round-4 concerns
  specifically (with extra weight on the `host.restart` reversion and the
  §3a posture change, since both are corrections of round-4's own errors,
  not new features), and does a full fresh adversarial pass. Blind to the
  other family's review and to this run journal.

Round record persisted; launched.

### Round 5 verdicts — both NOT READY; author-extended budget exhausted (5/5)

| target | family | verdict | round-1/2/3/4 concerns resolved | new MATERIAL | new DETAIL |
| --- | --- | --- | --- | --- | --- |
| claude (Opus 5, blind to gpt-5, saw own round-1/2/3/4 reviews) | NOT READY | 5 resolved / 2 partial (of 7 tracked) | 4 | 7 |
| gpt-5 (codex exec, blind to claude, saw own round-1/2/3/4 reviews) | NOT READY | 2 resolved / 4 partial (of 6 tracked) | 2 | 1 |

Full text: `llp/reviews/0184-agent-accessible-control-plane.claude-round5.md`,
`llp/reviews/0184-agent-accessible-control-plane.gpt-5-round5.md`.

Both families confirm the round-5 `host.restart` reversion is correct
(independently re-derived every clause of the disclosed HTTP-refuses/
MCP-executes anomaly against the code) and confirm the `config.secret.
acquire`/`config.set` "disjoint paths" structural premise is true (both
independently traced `src/admin/setup.html`'s direct POST to `config/set`).
Both also independently converge on: (a) the hosted-leg posture fix in
§Design/3a is right but never propagated to Phase 1's delivery-plan wording,
which still describes the disproven mechanical-enforcement mechanism, and
(b) `config.secret.acquire`'s underlying authority/mechanism is unresolved —
claude found the LLP 0036 citation itself is fabricated (no "Acquisition
tiers" section exists; the mechanism needed is L1, which 0036's own status
block says is not built); gpt-5 independently reached the same operation
from the implementation-feasibility angle (no state machine exists to back
the promised initiate/poll/cancel semantics) and additionally found a new,
serious defect: `config.set` targeted as `(native, direct)` has no feasible
MCP secret carrier — stdin/fd works for a CLI process but an already-running
MCP server has no equivalent transport for a file descriptor, so the
`native` target as stated is not buildable.

### Full remaining MATERIAL ledger (nothing summarized away)

**Pure drafting (no judgment call, three-to-four clause edits):**

1. Phase 1 item 3 still instructs building the mechanical `gateway.js`
   dispatcher-enforcement §3a proved impossible — reword to match §3a/rule
   11 (claude).
2. §Security and ergonomics invariants still carries the original, now
   disproven "No projection creates authority... same result semantics"
   bullet verbatim; §Design/2's restated form ("no projection widens the
   authority its own gate enforces") never reached it — the document
   simultaneously asserts and refutes its own central security invariant
   (claude, and gpt-5 independently: "the normative Security section was
   not restated... the proposed replacement is also vacuous" — see judgment
   call D below for the deeper half of gpt-5's finding).
3. `host.restart`'s worked `cliDeferralReason` is factually wrong — nothing
   structurally prevents a `snapback restart` CLI command; the HTTP-specific
   reasoning was transplanted onto the CLI, where it doesn't apply (claude).
4. Hosted manifest entries are keyed by path only, but at least one real
   path (`/_snapback/api/debug/network-profile`) carries two distinct
   semantic operations dispatched by method (GET vs. PUT) at the coordinator
   layer — needs method+path+operation-identity keying, not path alone
   (gpt-5).
5. `unavailable`/target-refused terminology collision in §A persists a third
   round despite §3a now explicitly naming it as a miscoding risk (claude
   DETAIL, but recurring enough to fix now).

**Author judgment calls (four, all with the trade-off already scoped by the reviews):**

A. **`config.secret.acquire`'s scope and authority.** Its cited LLP 0036
   mechanism doesn't exist as described (claude), and no state machine
   backs its promised semantics regardless (gpt-5). Both reviews converge
   on the same two options: condition it explicitly on an LLP 0036 L1
   amendment (mirroring how this RFC already handles the LLP 0158 and LLP
   0146 dependencies), or drop it from v1 scope — §P3's own text already
   works without it, since completion is confirmed via `config.status`/
   `config.verify` either way.
B. **`config.set`'s MCP carrier.** Targeting `(native, direct)` requires a
   typed MCP tool, but no safe MCP transport exists for a secret value
   today (gpt-5, new in round 5). Options: define a new carrier with LLP
   0036/security-owner approval, or keep `config.set` `cliOnly` (not
   `native`) until one exists.
C. **The `direct`/`mediated` boundary has no structural test.** Carried
   since round 2, still open after round 5: an out-of-band human approval
   can be coded as either `direct + humanApprovalRequired` or `mediated`,
   and nothing in the document distinguishes which applies, which affects
   real enforcement (rule 6's plan/initiate/status/resume and negative-leak
   obligations apply only to `mediated` rows) (gpt-5).
D. **The process-lifecycle authority model itself.** Round 5 correctly
   *disclosed* that `host.restart`'s MCP path has no admin-credential gate
   where its HTTP path does — but disclosure isn't a decision. gpt-5:
   "Phase 2 may either gate MCP equivalently or preserve the divergent
   lifecycle authority indefinitely. The author and LLP 0024/security owner
   must decide whether owner-only local process/filesystem access is the
   intended lifecycle authority or whether MCP must prove an
   AdminWrite-equivalent credential." Item 2 above (the invariant-wording
   fix) is downstream of this decision, not a substitute for it.

### Terminal disposition — author-extended budget (5 rounds) exhausted

The original 3-round budget (LLP 0010 §2) was extended once by the author
("4th and 5th round," resolved via the two AskUserQuestion judgment calls
recorded above) and is now fully used. Both families remain NOT READY on
round 5, with a materially narrower and more specific remaining ledger than
round 3's terminal report (4 pure-drafting items + 4 judgment calls, vs.
round 3's mixed ledger of 9). This is ordinary extended-budget exhaustion,
not a cross-family contradiction or sustained asymmetry — both families
agree on substance throughout, including two independent convergences this
round (the `host.restart` verification and the `gateway.js` propagation
gap).

**Final verdicts bind to** content sha256
`c81845de5135aaef9325521f850716b98663212b57553ae395a67c78528dfb81` (1310
lines). **No later revision exists.** The document remains at `Status:
Review` (this skill never sets `Accepted`).

**Orchestrator's recommendation: stay at `Review`, not revert to `Draft`.**
Both families explicitly state the round-5 remainder is not a design
problem: claude — "Nothing in this round touches the RFC's approach. The
two-field model has absorbed every operation shape five rounds of
adversarial reading could throw at it... without needing a third axis or a
precedence rule"; gpt-5 — "the remaining concerns are fundamentally
solvable, but not by another prose-only cleanup... require author and
semantic-owner decisions [after which] the overbroad completeness claims...
can then be repaired mechanically." The five-clause drafting fixes are
low-risk and could reasonably be applied without another full review round.
The four judgment calls are genuine author/semantic-owner decisions this
loop cannot make — two of them (A, B) are about `config.secret.acquire`/
`config.set`, which is Phase 4, non-blocking, and does not gate Phase 0-3's
delivery; the other two (C, D) are pre-existing model questions this loop
surfaced but that predate and outlast this specific RFC. A targeted
follow-up (either a manual pass on the five drafting items plus author
rulings on A-D, or one more super-refine round scoped only to the delta if
the author wants independent re-verification) would very plausibly close
this out, but that is the author's call, not this loop's to make
unilaterally at a 5/5 budget.

## Post-round-5 author-directed closing pass

The author reviewed the round-5 report and ruled on all four remaining
judgment calls directly ("Fix these, I have no strong opinion at this
time"), delegating the specific choice within each while confirming the
document should close at `Review`. Applied to
`llp/0184-agent-accessible-control-plane.rfc.md` directly (no further
super-refine round — this is a manual pass per the author's explicit
instruction, not part of the AI-reviewed loop, and is disclosed as such):

- **(a) `config.secret.acquire`:** dropped from v1, per the "drop it" branch
  of the author's own two-option framing — the lower-risk choice, since it
  avoids asserting a cross-document dependency LLP 0036 hasn't ratified.
  §Product contract and §P3 rewritten: human config entry stays outside this
  catalog's agent-facing surface (the shipped setup page already writes the
  value directly with no agent in the call chain); an agent's role is
  detect-via-`config.plan`/`status`, direct the human, confirm via
  `config.status`/`config.verify`. Re-addable later if LLP 0036's owner
  ratifies an agent-trackable acquisition tier.
- **(b) `config.set`'s MCP carrier:** pinned to `cliOnly` (not `native`) for
  v1, per the "keep `cliOnly`" branch — promotion to `native` requires a
  future LLP 0036/security-owner-approved MCP secret carrier design.
- **(c) `direct`/`mediated` boundary:** given a bright-line, checkable test
  — is the request already fully specified without the human step (→
  `direct`, with `approvalPosture` carrying any confirmation gate), or does
  a required input have to originate from a human/external party during the
  call itself (→ `mediated`). Per-operation classification, checkable by one
  question, not a per-invocation runtime choice.
- **(d) `host.restart`'s MCP/HTTP authority gap:** resolved toward closing
  it, the more conservative option — Phase 2's `host.restart` vertical slice
  (added to the delivery plan) gates the MCP path behind the same
  admin-credential proof the HTTP path already requires. §Security and
  ergonomics invariants keeps its original "no projection creates authority"
  wording, with one explicit, scoped, temporary exception named for the
  three process-lifecycle operations rather than a permanent, vacuous
  restatement (round-5 gpt-5's finding that the round-5 restated form was
  circular is honored by reverting to the original wording plus a named,
  dated carve-out instead).

Also applied, the remaining pure-drafting items from the round-5 ledger:
Phase 1 item 3 reworded to match §Design/3a's hand-maintained-plus-audit
posture (was still describing the disproven mechanical `gateway.js`
dispatcher check); hosted-adapter manifest entries re-keyed by
`(method, path, operation)` instead of path alone, closing the
network-profile GET/write-split gap; rule 11's mechanism restated precisely
("matches the audited inventory," not "resolves to a real case," fixing the
circularity); `host.restart`'s `cliDeferralReason` corrected (not
structurally impossible, just not built yet; Phase 2 lands it); and the
`unavailable`/target-refused terminology collision in §A fixed (its third
occurrence, now consistent with §3a's own naming of the risk).

**Final revision:** content sha256
`4d5c25cf3fa467264ee0daf44651931d7a061b5f8be4029e358b2f94b911059c` (1371
lines). This revision has **not** been run through another super-refine
round — the author explicitly closed the loop with this pass rather than
authorizing a round 6. `Status` remains `Review`, per the author's "promote
to review" instruction (already the document's status throughout the loop;
this skill never sets `Accepted`, and the author did not ask for that
transition — a human maintainer read is the natural next step before any
`Accepted` decision).
