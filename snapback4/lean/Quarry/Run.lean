import Quarry.Write

/-!
# Running a program

`run` takes (schema, helpers, store, viewer, program, arguments, ceiling)
to an outcome. This is the function the later harness oracle calls.
-/

namespace Quarry

/-- An outcome. A query answers with data, `complete` and the returned
page's continuation (`next`, null when none), or is unavailable (a cut
scalar read), or refuses. A mutation commits a result and a new store, or
refuses (and changes nothing). -/
inductive Outcome where
  | answer (data : Value) (complete : Bool) (next : Value)
  | unavailable
  | committed (result : Value) (store : Store)
  | refused (code : String)

/-- The world of a query: the view; every write refuses. -/
def queryHooks : Hooks View where
  view _ vw := vw
  apply _ _ _ := throw (.refuse "E_QUARRY_PLACEMENT")

/-- The world of a mutation: the store; reads see its visible rows. -/
def storeHooks : Hooks Store where
  view cx s := visibleRowsAt cx.schema s cx.viewer cx.now
  apply := applyWrite

-- @ref LLP 3000.036.003#6 — born-expired and updated-expired final images retire in the writer transaction.
/-- Rows whose final images a mutation changed. Commit-end expiry retirement
is scoped to this set; pre-existing expired backlog remains for the ordinary
sweep. -/
abbrev ChangedRows := List (String × List Nat)

structure MutationWorld where
  store : Store
  changed : ChangedRows := []

/-- The explicit address of an insert-like write that reached its write arm.
This retains a structurally identical expired replacement for commit-end
retirement, while excluding `insert if absent` live-clash no-ops. -/
def RWrite.changedExplicitId? (cx : Ctx) (s : Store) : RWrite → Option (String × List Nat)
  | .insert t fields ifAbsent => do
    let td ← cx.schema.table? t
    let fs ← (scalarsE fields).toOption
    let rid ← (insertId fs).toOption
    let img ← (buildImage td rid fs eInput).toOption
    if ifAbsent && (findClash ((s t).filter (unexpired td cx.now))
        (["id"] :: td.uniques) img none).isSome
    then none
    else some (t, rid)
  | .upsert t key patch =>
    match key.lookup "id" with
    | some (.s (.id rid)) => some (t, rid)
    | _ => match patch.lookup "id" with
      | some (.s (.id rid)) => some (t, rid)
      | _ => none
  | _ => none

def changedFinalRows (sch : Schema) (before after : Store) : ChangedRows :=
  sch.tables.flatMap fun td => (after td.name).filterMap fun row =>
    match (before td.name).find? fun old => old.id == row.id with
    | none => some (td.name, row.id)
    | some old => if old == row then none else some (td.name, row.id)

def mutationHooks : Hooks MutationWorld where
  view cx w := visibleRowsAt cx.schema w.store cx.viewer cx.now
  apply cx w rw := match applyWrite cx w.store rw with
    | .error e => .error e
    | .ok (value, store) =>
      let changed := w.changed ++ changedFinalRows cx.schema w.store store
      let changed := match rw.changedExplicitId? cx w.store with
        | some address => changed ++ [address]
        | none => changed
      .ok (value, { store, changed := changed.eraseDups })

/-- Runtime retires changed expiry rows in reverse through-table order, then
ascending id order. Read-through tables are outside this model fragment, so
its through order is the schema's lexical table order. -/
def changedRetirementOrder (sch : Schema) (changed : ChangedRows) : ChangedRows :=
  (expiryRetirementTables sch).flatMap fun td =>
    (changed.filter fun address => address.1 == td.name).mergeSort fun a b =>
      lex cmpNat a.2 b.2 != .gt

/-- Retire only rows written by this mutation whose final image is already
expired. A restrict refusal aborts the mutation; cascade and set-null actions
are in the same transition. -/
def retireExpiredChanged (sch : Schema) (now : Int) : Store → ChangedRows → Except Stop Store
  | s, [] => pure s
  | s, (t, rid) :: rest =>
    match sch.table? t with
    | none => retireExpiredChanged sch now s rest
    | some td =>
      match findRow (s t) [("id", .id rid)] with
      | none => retireExpiredChanged sch now s rest
      | some row =>
        if expired td now row then do
          let s ← refDeleteFrom sch (unexpiredStore sch s now) s t row
          retireExpiredChanged sch now s rest
        else retireExpiredChanged sch now s rest

def bindArgs (params : List Param) (args : List (String × Value)) : Except Stop Env :=
  params.mapM fun p => match args.lookup p.name with
    | some v => pure (p.name, (v, none))
    | none => if p.optional then pure (p.name, (.null, none)) else throw (.refuse "E_INPUT")

def defaultFuel : Nat := 100000

structure Case where
  schema : Schema
  helpers : List Helper := []
  store : Store
  viewer : List Nat
  now : Int := 0
  program : Program
  args : List (String × Value) := []
  budget : Option Nat := none
  /-- Run only the server expiry sweep and return its resulting store. -/
  sweepOnly : Bool := false
  /-- In-engine sweep continuation supplied by the differential driver. -/
  sweepCursor : SweepCursor := {}
  /-- Visited-row bound for the sweep; examples default to a complete pass. -/
  sweepLimit : Option Nat := none

def Case.ctx (c : Case) : Ctx :=
  { schema := c.schema, viewer := c.viewer, now := c.now, helpers := c.helpers, budget := c.budget,
    mutation := c.program.kind == .mutation }

def flowValue : Flow → Value × Value
  | .normal => (.null, .null)
  | .ret v nx => (v, nx.getD .null)

def runQuery (c : Case) : Outcome :=
  match bindArgs c.program.params c.args with
  | .error (.refuse code) => .refused code
  | .error .unavailable => .unavailable
  | .ok env =>
    let vw := visibleRowsAt c.schema c.store c.viewer c.now
    match (execStmts queryHooks defaultFuel c.ctx vw env c.program.body).run {} with
    | .ok ((fl, _, _), rs) => let (v, nx) := flowValue fl; .answer v rs.complete nx
    | .error (.refuse code) => .refused code
    | .error .unavailable => .unavailable

def runMutation (c : Case) : Outcome :=
  match bindArgs c.program.params c.args with
  | .error (.refuse code) => .refused code
  | .error .unavailable => .unavailable
  | .ok env =>
    match (execStmts mutationHooks defaultFuel c.ctx { store := c.store } env c.program.body).run {} with
    | .ok ((fl, w, _), _) => match retireExpiredChanged c.schema c.now w.store
        (changedRetirementOrder c.schema w.changed) with
      | .ok s' => .committed (flowValue fl).1 s'
      | .error (.refuse code) => .refused code
      | .error .unavailable => .refused "E_BOUND"
    | .error (.refuse code) => .refused code
    | .error .unavailable => .refused "E_BOUND"

def run (c : Case) : Outcome :=
  if c.sweepOnly then
    let (store, cursor) := sweepExpired c.schema c.store c.now c.sweepCursor c.sweepLimit
    .committed cursor.toValue store
  else match c.program.kind with
    | .query => runQuery c
    | .mutation => runMutation c

end Quarry
