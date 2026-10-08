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
  view cx s := visibleRows cx.schema s cx.viewer
  apply := applyWrite

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
  program : Program
  args : List (String × Value) := []
  budget : Option Nat := none

def Case.ctx (c : Case) : Ctx :=
  { schema := c.schema, viewer := c.viewer, helpers := c.helpers, budget := c.budget,
    mutation := c.program.kind == .mutation }

def flowValue : Flow → Value × Value
  | .normal => (.null, .null)
  | .ret v nx => (v, nx.getD .null)

def runQuery (c : Case) : Outcome :=
  match bindArgs c.program.params c.args with
  | .error (.refuse code) => .refused code
  | .error .unavailable => .unavailable
  | .ok env =>
    let vw := visibleRows c.schema c.store c.viewer
    match (execStmts queryHooks defaultFuel c.ctx vw env c.program.body).run {} with
    | .ok ((fl, _, _), rs) => let (v, nx) := flowValue fl; .answer v rs.complete nx
    | .error (.refuse code) => .refused code
    | .error .unavailable => .unavailable

def runMutation (c : Case) : Outcome :=
  match bindArgs c.program.params c.args with
  | .error (.refuse code) => .refused code
  | .error .unavailable => .unavailable
  | .ok env =>
    match (execStmts storeHooks defaultFuel c.ctx c.store env c.program.body).run {} with
    | .ok ((fl, s', _), _) => .committed (flowValue fl).1 s'
    | .error (.refuse code) => .refused code
    | .error .unavailable => .refused "E_BOUND"

def run (c : Case) : Outcome :=
  match c.program.kind with
  | .query => runQuery c
  | .mutation => runMutation c

end Quarry
