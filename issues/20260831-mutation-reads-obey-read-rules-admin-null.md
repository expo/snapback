# Reads inside mutations obey viewer read rules — admin flows get silent nulls

**Opened:** 2026-08-31 · **Systems:** snapback2 rules, engine, guide
**Source:** first Clique diagnostic run — two failed designs before the workaround.

Inside a mutation, `db.get` of a row the viewer's `viewerIs` read rule
hides returns null silently. Group-admin flows (remove/promote reading the
target's member row) therefore see absent rows and misbehave; the cold lane
burned two designs before splitting members into an inbox-pointer table +
roster source-of-truth table readable to admins. Combined with read-rule
uniformity over capped scans (`E_STRUCTURAL_COUNT`), nothing in the guide
warns about either behavior. This is the LLP 0331 actor/authority gap
surfacing in practice, and LLP 0329.014.004 dimension L's answer (declared
per-mutation read views / sealed operation authority) is the paved design.
Minimum: a guide page + a diagnostic when a mutation's read is
rule-narrowed; better: `reads:` declarations per mutation.

## 2026-09-11 triage

**Priority:** P2. **Disposition:** Open; the behavior is intentional today,
but the mutation-authoring warning or scoped authority requested here has not
landed.

`engine/runner.rs::get_tracked` applies `Effect::Read` to every point read and
returns `Null` when the row is not visible; there is no mutation-specific
diagnostic. A temporary direct-Quarry/twin probe run with
`bun test src/triage-mutation-read-probe.test.ts` on 2026-09-11 lowered
`mutation inspect(target: memberships): return memberships[target]`, supplied
a stored row owned by `bob`, and executed as `alice`: it passed and returned
`Null` with no partial site. The probe was removed after the bounded run.
Packaged `guide programs` says hidden rows yield `null`, and `guide writes`
documents read-rule denial for a returned update/upsert result, but neither
card calls out ordinary reads inside user mutations or the admin-flow trap.
`guide operator` separately establishes that the system operator skips viewer
rules; that is not scoped application authority.

Repeat from `snapback2/packages/compiler` at baseline `15c134d056` with Bun
1.3.14 on macOS: use `withProject`/`lowerProject` on these exact declarations,
then execute the lowered `admin.inspect` with `ClientStore.reexecute`:

```q
use identity
table memberships:
  group: text <=20
  principal: principal
  read <- .principal = viewer
  insert <- allow
  update <- allow
  delete <- allow
```

```q
mutation inspect(target: memberships):
  return memberships[target]
```

Supply receipt row `m1` as `{ id: Id("m1"), group: "g1", principal:
Id("bob") }` and context `{ viewer: "alice", principal_kind: "user",
auth_epoch: 1, args: { target: Id("m1") }, now: 1, read_time: 1, new_ids: [] }`.
The exact assertions that passed were `execution.result === "Null"` and
`partialSites` equals `[]`.

**Remaining acceptance:** either explicitly document, with a mutation example,
that every user-mutation read uses the caller's table read rule and can make a
present row indistinguishable from absence, or land an author-approved scoped
read-authority surface such as `reads:` with compiler/certificate/native/twin
tests. If the behavior remains, add a regression for the exact hidden point
read in a mutation.
