**Reviewer family:** GPT
**Provider / runtime:** OpenAI Codex / gpt-5.6-sol
**Reasoning effort:** xhigh
**Date:** 2026-08-15
**Redacted:** no
**Method:** manual, independent fresh-session review
**Revision reviewed:** `llp/0264-table-write-policy.spec.md` blob `69f81ec2476faf8c9a9cfa4570169ec6277e0ff5` at repository commit `6af92793517e5b688337f4914fa8bf7a15c50065`

## Overall assessment

The central storage design is feasible. Both HostPlan execution and buffered
handler settlement already hold the authoritative SQLite write transaction,
have the installed schema and `HandlerInput.auth.user_id`, and can stamp or
check owner state there. `DeleteWhere` already lowers through the shared SQL
predicate builder, so composing an owner conjunct before selection is a natural
implementation. The draft also draws the right hard boundaries around
membership/permission-backing writers, write elevation, immutable owner fields,
and the unclaimed result-egress phase.

Four material gaps remain. They affect governance, confidentiality, and the
implementability of normative projection/absence requirements, so this revision
should not be accepted yet.

## Findings

1. **MATERIAL — LLP 0234's accepted comparator does not yet govern the write axis, and the G1 legacy-omission rule leaves policy removal ambiguous.**

   LLP 0264 says that any write-broadening or write-incomparable policy change
   uses LLP 0234's ordinary-policy transition machinery, and introduces a
   versioned policy semantic identity (LLP 0264 D1, lines 143–157). But the
   machinery it incorporates is presently defined over admitted *read*
   principals/rows: `public-read` is the maximum, and anything provably
   read-narrower is admitted as `narrowing` (LLP 0234 D5, lines 910–942 and
   972–986). Under LLP 0264 D2, `public-read -> owner` is read-narrowing while
   changing generic writes from `refused` to owner-admitted. The existing D5
   comparator can therefore admit precisely the write-posture widening that D1
   says must have remotely prior approval. Merely putting a semantic version in
   generation/activation inputs or storing the same digest in the ledger (LLP
   0264 Migration, lines 490–499) does not make D5's recomputed partial order
   compare that axis.

   The same missing state distinction affects omission during migration. D2 and
   Phase 1 preserve unchecked behavior for an undeclared table behind a warning
   (lines 161–167 and 428–446), while the same Phase 1 says a broader edit must
   remain inert/refused when G0 is unavailable. The draft does not specify how
   an implementation distinguishes a genuinely pre-cut legacy-undeclared table
   from an app author removing `owner` after Phase 1. LLP 0234 allows only G1
   roots to grandfather pre-gate policy (D5, lines 1010–1014), but LLP 0264 has
   no corresponding pre-G1 write baseline/allowlist or acceptance case. An
   owner-to-omitted edit must not fall into `legacy-undeclared` and recover
   unchecked generic writes.

   **Concrete resolution:** define the normalized ordinary-policy body and
   transition comparator as a product order over read admission *and* the exact
   write disposition/owner field/write-policy semantic version. A transition is
   self-proving narrowing only if it is no broader on either axis; otherwise it
   needs LLP 0234's prior approval and receipt. Version and retain the migration
   root that identifies the exact pre-cut `legacy-undeclared` set, and refuse any
   new omission or declared-to-omitted transition rather than warning it. Add
   acceptance cases for `public-read -> owner`, each refused-kind `-> owner`, a
   policy-semantic-version change, `owner -> omitted`, and a newly introduced
   undeclared table, both before and after G0/G1.

2. **MATERIAL — the HostPlan IR does not bind an operation-declared absent disposition to the authoritative write check, so D4's non-disclosing contract is not defined for all legal plans.**

   The draft promises that a HostPlan with `Get`/`Guard` returns the same
   declared refusal for missing and not-owned rows, while a bare `Patch`/`Delete`
   has no effect (LLP 0264 Scope, lines 122–127; D4, lines 221–252; D10, lines
   404–415). But `Patch` and `Delete` carry neither an `elseError` nor an identity
   linking them to a preceding `Get`/`Guard`. D5 only says that the owner check
   happens in the same transaction as those arbitrary plan steps (lines
   263–277). A legal plan may therefore `Get(id, elseError: X)` and then issue a
   bare `Patch`: a missing row refuses at `Get`, while another owner's present
   row can pass that raw binding and reach the central patch's no-effect path.
   The plan has distinguished the two states before the write check decides its
   absent behavior.

   The shipped wedge demonstrates the mismatch rather than resolving it.
   `ownedRowGuard` emits separate `Get` and owner `Guard` steps with the same
   code (`standard-patterns.mjs`, lines 174–188), while the executor currently
   reads/binds the unscoped row and emits a table/id/`Get` message for absence
   (`src/storage.rs`, lines 3275–3353) and a different message/details body for
   guard failure (lines 3419–3437). `mutation_plan_refusal` canonicalizes only
   `SNAPBACK_RELATION_PARENT_UNAVAILABLE`, not `SNAPBACK_ROW_NOT_FOUND`
   (`src/storage.rs`, lines 12558–12569). Thus even the canonical generated plan
   currently has equal codes but not the byte-identical public result required
   by Phase-1 acceptance item 3 (LLP 0264, lines 457–460). D8's egress nonclaim
   cannot defer this: the draft itself makes absence non-disclosure a v1 write
   requirement.

   **Concrete resolution:** give the authoritative owner point-write operation
   an explicit host-owned absent disposition in the IR (for example, a checked
   `Patch`/`Delete` carrying a canonical `elseError`), or define and validate one
   exact `Get`/owner-check/write compound whose policy check occurs before any
   plan-visible row binding. Canonicalize the complete public diagnostic body,
   not only its code. Arbitrary `Get`/`Guard` sequences must not be inferred as
   write authorization. Add negative fixtures for `Get` without the canonical
   guard, differing Get/Guard codes, multiple reads/writes to the same id, and
   both missing and other-owner rows. The generic read-composition work may
   independently scope `Get`, but Phase 1 cannot rely on a later G1 closure to
   satisfy this Spec's own byte contract.

3. **MATERIAL — generic owner inserts and patches can disclose another owner's row through global uniqueness conflicts, reopening the exact existence oracle preserved by the tiny-data wedge.**

   The existing owner CRUD lowerer treats a unique index that omits the owner
   field as a cross-owner existence disclosure and refuses it unless the
   operation explicitly declares that disclosure (`standard-patterns.mjs`,
   lines 277–304). LLP 0255 S0/S2 deliberately reuses that lowering and its
   non-disclosure obligations (LLP 0255, lines 58–64 and 244–268). LLP 0264,
   however, admits every generic insert and patch to an owner table once the row
   owner rule passes (D3/D4), without inspecting unique-index partitioning or
   governing constraint-error output. Alice can probe a candidate slug/email
   owned by Bob: success versus a uniqueness conflict discloses whether an
   unreadable row has that value. Patching Alice's own row provides the same
   oracle. This does not mutate Bob's row, but it violates the table's read
   confidentiality through the newly authorized write surface.

   D8 enumerates returned/copied values but not storage constraint failures
   (lines 329–353), and D10's value-free rules cover old-row comparison legs,
   not the conflict/success bit (lines 397–422). Therefore neither deferral nor
   diagnostic redaction closes the oracle.

   **Concrete resolution:** for generic owner insert/patch, require every
   reachable unique constraint to include the installed owner field; otherwise
   generation/activation must refuse the generic surface. Treat an intentional
   non-owner-partitioned uniqueness disclosure as a separately declared and
   governed egress/specialized-operation capability, not as generic owner-write
   admission. Project the conflict disposition and add Alice/Bob create and
   patch fixtures. Merely redacting the database error is insufficient because
   success versus conflict remains observable.

4. **MATERIAL — D9's projection key and scalar vocabulary cannot represent legal multi-site or runtime-targeted writes.**

   D9 specifies one row per `operation × write form × exact target table`, with
   an id derived from those facts and policy identity (LLP 0264, lines 362–384).
   Legal HostPlans can contain two inserts of the same form/table where one
   omits the owner and another carries the sealed `AuthUserId` marker; the
   required scalar `ownerInputDisposition` differs. They can likewise contain
   a bare patch and a canonically guarded patch of the same table, whose scalar
   `absentDisposition` differs, and multiple source spans that cannot fit one
   `sourceEvidence`. JavaScript can have the same collisions across call sites.

   Runtime targeting is also internally unrepresentable. D9 says not to invent
   a table for a runtime/opaque target, yet still requires scalar
   `policyKind`, `policyDigest`, `ownerField`, `genericWriteDisposition`, and
   transaction checks. Those facts vary across members of a closed table
   ceiling and are unknowable for an opaque target. Consequently the exact
   positive/refused/legacy/runtime golden rows required by Phase-1 acceptance
   item 9 (lines 475–478) cannot be generated without collapsing facts or
   inventing them.

   **Concrete resolution:** key rows by stable source-site/plan-step identity in
   addition to operation/form, and emit one row per exact ceiling member when a
   closed runtime ceiling exists. For a genuinely opaque site, add explicit
   `runtime-resolved`/`unknown` vocabulary for every target-dependent scalar and
   omit invented policy facts; Phase 2 can then refuse that class as already
   intended. Alternatively, make dynamically targeted generic writes
   unsupported. Separate preflight checks from authoritative-transaction checks
   in the projection rather than assigning every check, including field-set
   immutability, the transaction locus.

## Recommended next step

Revise the draft to close these four contracts, keep it `Draft`, and obtain a
fresh targeted re-review of the revised governance comparator, HostPlan absent
IR, constraint-conflict posture, and projection schema before acceptance.

VERDICT: MATERIAL
