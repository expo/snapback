**Artifact:** the brief given to every coverage-audit slice for LLP 0331
**Author:** Claude Fable 5 (orchestrator), 2026-08-30
**Target:** `llp/0331-scoped-roles-diary-feedback.research.md` at sha256 `3d6b2b95d00246f4c1ab7a212ef59a3266f473d6693ed9395b8b18c643a386aa`
**Note:** the scratchpad paths in the text were the session's working directory; the slice reports now live beside this file as `0331-coverage-audit.<slice>.md`.

---

# Authorization coverage audit brief — LLP 0331 vs the 37 paper applications

Repository: /Users/ccheever/projects/snapback (read-only for you; write ONLY your
output file in the scratchpad path given in your task).

## The question

LLP 0331 (`llp/0331-scoped-roles-diary-feedback.research.md`, §"Snapback2
synthesis") proposes ONE authorization model for Snapback 2. The founder asks:
across all 37 paper applications that were written to design the bounded
data-program language (LLP 0329.014.001/.002/.003/.005 and their verbatim
per-app artifacts under `llp/reviews/`), would 0331's model handle most or all
of their authorization needs? Where not, what is the smallest bounded
extension? The founder is equally worried about sprawl — so every extension you
name must be justified by a concrete rule in a concrete app, quoted.

## The 0331 CORE model (what you are testing against)

Read `llp/0331-scoped-roles-diary-feedback.research.md` lines 104–420 first.
The core, precisely:

- Per-table rules per effect: `read`, `insert`, `update(old, next)`, `delete`.
  Default-deny; a query can only narrow a read rule.
- Rule terms: fields of the row (`old`/`next` for update), `viewer` (ONE opaque
  scalar `Principal`, server-derived from the session), literals.
- Rule operators: `==`, `!=`, comparisons, `&&`, `||`, `!` (negation is
  admitted), `public(reason)`.
- ONE bounded indexed relational probe, **one hop**: `exists(table.index,
  [key terms])` where key terms are row fields / viewer / literals, optionally
  with a `where` on the found row (e.g. `role in ['admin','owner']`). The found
  row's fields may NOT feed a further probe (that would be two hops).
- Scoped roles = an ordinary app table `{ scope: ref, principal: Principal,
  role: enum }` with a unique `(scope, principal)` index. Closed role enum.
  NO role hierarchy — rules spell explicit role sets.
- Named bounded programs (mutations) derive the acting principal, check
  old/new, commit atomically; raw writes bound by the same table rules.
- Transaction-local creation provenance: a creator self-seat is admissible only
  while the scope row is being inserted in the same transaction by the same
  viewer.
- Constraints: unique / cap / immutable / appendOnly.
- Every relationship read enters the trace → revocation is live.
- Retention is a per-table consequence separate from authorization.
- Failure/disclosure: reads compose policy into selection (no existence
  oracle); writes return one stable denied envelope.
- Personas (dev) resolve to ordinary principals; no roles in sessions.

Explicitly DEFERRED by 0331 (i.e. NOT in core): principal kinds or sets,
role hierarchy/lattice, multi-hop, bounded tree/DAG traversal, pending
invitations, global roles, arbitrary relationship graphs, guest/anon
principals, service/agent principals, API scopes.

## The design RFC's wider vocabulary (the candidate extensions)

`llp/0329.014.004-bounded-data-programs-v1-design.rfc.md` §2, §2.1, §2.2,
§3, §4 "Rules", §5, §6. Use this FIXED extension list so results merge:

| Code | Extension | Typical spelling in the RFC |
|---|---|---|
| X1 | Multi-hop probe: a probe key needs a field of a row reached by another probe/get (receipt→message→conversation) | second `exists`/`get` in a rule; 0331 says "denormalize the scope id" |
| X2 | Hierarchy: authority inherited along a parent chain (folder tree, org unit, DAG) | `tree`/`dag`, `nearest(index,key,{along})`, `inherits(table, fk)` |
| X3 | Principal kinds/sets: `principal.kind` (`anon`, `system`, `host`, `service`, `contact`, `link`, webhook, API scope, device), `bearerOf`, `viewer.bindings` closure (`existsAny(index,{principalIn})`), org/team-as-principal | dimension N |
| X4 | Bearer capability: possession of an unguessable full key admits (invite link, share link, one-use token) | `unique({bearer:true})`, capability kind |
| X5 | Audience projection: one row whose columns have different audiences, or one entity with several party-specific views | `E_SECRECY_MIX` split, projections with declared audience, broadcast projection keyed (resource, audience) — dimension O |
| X6 | State/attribute beyond simple field compare: rule depends on a computed value, a status flipped by schedule (time-as-state), interval containment, or a comparison the rule language must support beyond `==`/`in` | dimension B/G in rules |
| X7 | One-hop probe on a NON-relationship row with a `where` (e.g. `exists(publications,[row.id]) where status=='public'`, a settings row) — this IS core if one hop; mark it CORE(where) and only mark X7 if it needs more | data-conditioned disclosure |
| X8 | Rule ownership/composition: tenant-installed rules, `ruleset` deny-wins, `ctx.initiator` (confused deputy), plugin | dimension Q |
| X9 | Session/device/freshness context in rules: `ctx.session`, `ctx.device`, `fresh(row,{...at:'commit'})`, posture rows, policy version, assurance level | zero-trust additions to N/G |
| X10 | Device-plane rule evaluation (server cannot evaluate: E2EE, vault) | `db.evaluate(rule,{as,asOf})`, `runsOn:'device'` — dimension P |
| X11 | Sealed/system authority: a named mutation that must read rows the viewer cannot read, or run as system/host | `getHidden`, `reads:[tables]`, `callable:'system'|'host'`, `phase:'system'`, schedule under system principal |
| X12 | Negation over a relationship (blocks/mutes: `!exists(blocks,[row.author, viewer])`) — this is CORE; mark CORE(neg) and note any existence-oracle subtlety | — |
| X13 | Derived/maintained membership or engine fan-out for authority: authority from `maintain.rows`, `propagate({from,onto,along})` on revoke | dimension K/E (E2EE) |
| X14 | Retention/disclosure distinct from the rule: delivered-history, `readable` on an aggregate with cadence/minGroup, `retain(...)` — NOT authorization; note it but do not count it as a rule extension | dimension F/J |
| X15 | Role lattice / many roles: the app needs role ≥ comparison, or > 4 roles, such that explicit sets become unreviewable | — |
| X16 | Roles/permissions as data: permission bits or custom roles stored in rows so the vocabulary is open at runtime (not a closed enum) | stored-predicate algebra, "data as rules" |
| X17 | Quantified/aggregate rule: authorization depends on a count or an `any` with take>1 (e.g. ≤ N admins, quorum, "at least one owner remains") | `any(index,prefix,{take,where})`, cap constraints |
| X18 | Rule over a ranked/geo read site's result or partition | dimension M |
| X19 | Two-sided/relational write rule beyond (old,next) of one row: a write whose admissibility depends on another row's state in the same transaction (event-coupled transitions, decision-with-write, grant-with-review) | dimension C additions |
| X20 | Something else — name it precisely, quote the rule |

## What to extract PER APP

For each app in your slice, read BOTH artifacts (the `.design.md` and the
`.v0.md`; wave 1 has one artifact per app) AND the wave synthesis's per-app
paragraph. Then write:

1. **App** — name, wave, artifact paths.
2. **Principal shapes** — which kinds of actor the app has: registered user,
   anon/guest/visitor, pre-identity contact (phone/email invitee), service /
   webhook / effect principal, host/system, device, org/tenant as scope,
   API-key holder, operator/admin-of-the-platform. One line.
3. **Authorization requirements** — a table. One row per distinct
   requirement (aim for 4–12 rows; collapse duplicates). Columns:
   `# | Requirement (who may do what, under what relationship/attribute) |
   How the paper design expressed it (quote the rule or program fragment,
   ≤ 2 lines, with artifact line number) | Verdict: CORE / CORE(where) /
   CORE(neg) / CORE-with-denorm / X<n>[,X<m>] | Note (if denorm: what column
   gets duplicated and whether the design already did it; if X: why core
   cannot express it in ONE hop with a closed enum and a scalar viewer)`.
4. **App verdict** — one of: `COVERED` (all rows CORE*), `COVERED-WITH-DENORM`
   (all rows CORE* or CORE-with-denorm), `NEEDS: X.. ` (list, most important
   first). Then 2–4 sentences: was authorization the app's hard problem or
   incidental? Which single extension, if any, would flip it to COVERED? Did
   the paper design itself reach for something the RFC later refuted (cite §8
   of the RFC if so)?
5. **Sprawl check** — for every X you named: could the app ship an honest
   reduced product WITHOUT it (say what it loses), or is the X load-bearing
   for the product's stated bar? One line per X.

Be exact. Quote rules verbatim with line numbers (`file:line`). Do NOT
paraphrase a requirement the design did not state. If an artifact skipped
authorization (some designs concentrate on other dimensions), say so — an
unstated requirement is not evidence either way. Do not invent requirements
from your general knowledge of the product category; the product as the paper
design stated it is the unit.

## Output

Write your full report to the scratchpad path given in your task. Then reply
with ONLY: the per-app verdict list (app → verdict) and a one-paragraph slice
rollup (which X codes appeared, in how many apps each, and which were
load-bearing vs droppable). Keep the reply under 400 words; the file carries
the detail.
