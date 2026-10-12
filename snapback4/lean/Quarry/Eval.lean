import Quarry.Store

/-!
# The big-step evaluator

`evalExpr` and `execStmts` are total functions (structural on a fuel
argument; a checked program never exhausts the default fuel, and
exhaustion is the model-only refusal `E_MODEL_FUEL`). Determinism is
therefore by construction; `Determinism.lean` proves the non-trivial part.

Reads see only a `View` (the visible rows of each table), never the store.
The statement executor is generic in its *world* `W`: a query runs over a
`View` and refuses every write (`E_QUARRY_PLACEMENT`); a mutation runs over a
`Store` and recomputes the view after each write (`Run.lean`).

Refusal codes are the engine's where the documents name them (`E_OVERFLOW`,
`E_DIV_ZERO`, `E_BOUND`, `NOT_FOUND`, `E_RULE`, `E_CONFLICT`,
`E_CONSTRAINT`, application codes). `E_MODEL_TYPE` and `E_MODEL_FUEL` mark
states a checked program cannot reach; the harness must treat them as a
model or emitter defect, never as agreement.
-/

namespace Quarry

/-- The meter is out of scope (LLP 3000.035 §5.2) except one abstract
ceiling: the number of *visible* candidates a request may examine
(OPEN M1). `none` is unbounded. -/
structure Ctx where
  schema : Schema
  viewer : List Nat
  helpers : List Helper := []
  budget : Option Nat := none
  mutation : Bool := false

/-- Request state: visible candidates examined so far, and whether every
read so far was complete. -/
structure RS where
  used : Nat := 0
  complete : Bool := true
  deriving Repr, DecidableEq

inductive Stop where
  | refuse (code : String)
  /-- A query whose scalar read was cut: no value, no continuation
  (bounds card: "a streaming query total with a meter cut … `loading`"). -/
  | unavailable
  deriving Repr, DecidableEq

abbrev EM := StateT RS (Except Stop)

/-- A local's value and, if it was bound directly to a page, that page's
continuation. -/
abbrev Env := List (String × (Value × Option Value))

def refuse {α : Type} (code : String) : EM α := throw (.refuse code)
def typeErr {α : Type} : EM α := refuse "E_MODEL_TYPE"

def checkI53 (n : Int) : EM Value :=
  if inI53 n then pure (.ofInt n) else refuse "E_OVERFLOW"

def ordered (op : BinOp) (o : Ordering) : Bool :=
  match op with
  | .lt => o == .lt
  | .le => o != .gt
  | .gt => o == .gt
  | .ge => o != .lt
  | _ => false

/-- Binary operators on evaluated operands. Integers are i53 and refuse
overflow; `/` and `%` are Euclidean (language card: "the same Euclidean
parts as divmod") and refuse a zero divisor. `+` also concatenates text and
lists. Ordered comparison needs two non-null scalars of one kind. -/
def binop (op : BinOp) (a b : Value) : EM Value :=
  match op, a, b with
  | .add, .s (.int x), .s (.int y) => checkI53 (x + y)
  | .add, .s (.text x), .s (.text y) => pure (.s (.text (x ++ y)))
  | .add, .arr xs, .arr ys => pure (.arr (xs ++ ys))
  | .sub, .s (.int x), .s (.int y) => checkI53 (x - y)
  | .mul, .s (.int x), .s (.int y) => checkI53 (x * y)
  | .div, .s (.int x), .s (.int y) =>
    if y = 0 then refuse "E_DIV_ZERO" else checkI53 (Int.ediv x y)
  | .mod, .s (.int x), .s (.int y) =>
    if y = 0 then refuse "E_DIV_ZERO" else checkI53 (Int.emod x y)
  | .eq, a, b => pure (.ofBool (a == b))
  | .ne, a, b => pure (.ofBool !(a == b))
  | op, .s x, .s y =>
    if x.rank = y.rank && x != .null then pure (.ofBool (ordered op (x.cmp y)))
    else typeErr
  | _, _, _ => typeErr

def asBool : Value → EM Bool
  | .s (.bool b) => pure b
  | _ => typeErr

def asScalar : Value → EM Scalar
  | .s x => pure x
  | _ => typeErr

/-! ## Reads -/

def rowKey (order : List String) (r : Row) : Key := order.map r.get ++ [.id r.id]

def keyLe (order : List String) (a b : Row) : Bool := keyCmp (rowKey order a) (rowKey order b) != .gt

/-- Candidates in index order: ascending by the order columns then `id`;
`last` descends, with `id` breaking ties in the same direction (language
card). -/
def sortRows (order : List String) (desc : Bool) (rs : List Row) : List Row :=
  let up := rs.mergeSort (keyLe order)
  if desc then up.reverse else up

/-- Strictly after the cursor, in scan direction. -/
def afterCursor (order : List String) (desc : Bool) (cur : Option Key) (rs : List Row) : List Row :=
  match cur with
  | none => rs
  | some k => rs.filter fun r => keyCmp (rowKey order r) k == (if desc then .lt else .gt)

def candidates (vw : View) (t : String) (pins : List (String × Scalar)) (order : List String)
    (desc : Bool) (cur : Option Key) : List Row :=
  afterCursor order desc cur (sortRows order desc ((vw t).filter (keyMatch pins)))

inductive StopReason where
  | filled | exhausted | cut
  deriving Repr, DecidableEq

structure Walk where
  rows : List Row
  last : Option Row
  stop : StopReason
  deriving Repr

/-- Walk the candidates in order. Each examined candidate is charged one
unit against the request's ceiling; a full page stops with a lookahead (a
remaining candidate means more may follow). -/
def walk (f : Row → EM Bool) (budget : Option Nat) (take : Nat) :
    List Row → Option Row → List Row → EM Walk
  | acc, last, [] => pure ⟨acc.reverse, last, .exhausted⟩
  | acc, last, c :: cs =>
    if take ≤ acc.length then pure ⟨acc.reverse, last, .filled⟩
    else do
      let rs ← get
      if budget.any (· ≤ rs.used) then pure ⟨acc.reverse, last, .cut⟩
      else do
        set { rs with used := rs.used + 1 }
        let keep ← f c
        walk f budget take (if keep then c :: acc else acc) (some c) cs

/-- A rule is decided by the pinned prefix when every row column it reads
is pinned (bounds card: "the deciding fields include a column the scan does
not pin" makes a page never complete). -/
def uniform (sch : Schema) (t : String) (pins : List (String × Scalar)) : Bool :=
  match sch.table? t with
  | some td => td.read.selfCols.all fun c => pins.any (·.1 == c)
  | none => false

/-- A readable grant (LLP 3000.036 §12.1): a disjunct of `t`'s read rule
that reads no row column (`exists staff[viewer]`, `viewer = 'service:x'`)
and holds for the caller makes every row of `t` readable to them, so the
page is decided once, per caller, as a uniform page is. The disjunct is
evaluated over the caller's **view**, never the store, so the verdict is a
function of what the caller may read (`query_noninterference` covers it);
it is positive, so a view verdict of true holds over the store too
(`granted_readable`). The engine evaluates it over the store, but only for
disjuncts whose every probed row the caller can read (`self_disclosing`),
where the two agree (OPEN C8). -/
def granted (sch : Schema) (vw : View) (v : List Nat) (t : String) : Bool :=
  match sch.table? t with
  | some td => td.read.disjuncts.any fun d => d.positive && d.selfCols.isEmpty && d.eval vw v {}
  | none => false

/-- A scan whose read rule is decided for this caller: by its pins
(`uniform`) or by a readable grant (`granted`). Only a decided scan can
prove absence: a page is complete, and an `exists` may answer `false`. -/
def decided (cx : Ctx) (vw : View) (t : String) (ps : List (String × Scalar)) : Bool :=
  uniform cx.schema t ps || granted cx.schema vw cx.viewer t

def keyValue (k : Key) : Value := .arr (k.map .s)

def parseCursor (order : List String) : Value → EM (Option Key)
  | .s .null => pure none
  | .arr xs =>
    match xs.mapM (fun x => match x with | .s y => some y | _ => none) with
    | some k => if k.length = order.length + 1 then pure (some k) else refuse "E_INPUT"
    | none => refuse "E_INPUT"
  | _ => refuse "E_INPUT"

/-- A point read: the visible row with this id or unique key, or null; a
null key component returns no row. -/
def pointRead (vw : View) (t : String) (ks : List (String × Scalar)) : Value :=
  if ks.any (·.2 == .null) then .null
  else match (vw t).find? (keyMatch ks) with
    | some r => r.toValue
    | none => .null

def markIncomplete : EM Unit := fun rs => .ok ((), { rs with complete := false })

def markIf (b : Bool) : EM Unit := if b then markIncomplete else pure ()

/-- A cut scalar read: unavailable in a query, `E_BOUND` in a mutation. -/
def cutScalar {α : Type} (cx : Ctx) : EM α :=
  if cx.mutation then refuse "E_BOUND" else throw .unavailable

def pageAnswer (order : List String) (w : Walk) : Value × Option Value :=
  let next := match w.stop with
    | .exhausted => none
    | _ => w.last.map fun r => keyValue (rowKey order r)
  (.arr (w.rows.map Row.toValue), some (next.getD .null))

/-- A page: walk the candidates; a cut page is incomplete (and refuses
`E_BOUND` in a mutation); a page whose read rule is not decided (by its pins
or a readable grant) is never complete; `next` follows the last examined
row unless the walk exhausted the candidates (reads card; LLP 3000.007
§5.6). -/
def pageRead (cx : Ctx) (vw : View) (t : String) (ps : List (String × Scalar))
    (filt : Row → EM Bool) (order : List String) (desc : Bool) (take : Nat) (cur : Option Key) :
    EM (Value × Option Value) := do
  let w ← walk filt cx.budget take [] none (candidates vw t ps order desc cur)
  if w.stop = .cut && cx.mutation then refuse "E_BOUND"
  else do
    markIf (w.stop = .cut || !(decided cx vw t ps))
    pure (pageAnswer order w)

/-- `count(domain)`: the number of visible rows that match, or unavailable
when cut (bounds card). -/
def countRead (cx : Ctx) (vw : View) (t : String) (ps : List (String × Scalar))
    (filt : Row → EM Bool) : EM (Value × Option Value) := do
  let cs := candidates vw t ps [] false none
  let w ← walk filt cx.budget (cs.length + 1) [] none cs
  if w.stop = .cut then cutScalar cx
  else return (.ofInt w.rows.length, none)

/-- An undecided search `exists` with no visible match has no answer: in a
query it is unavailable (`loading`); a mutation cannot reach it (the binder
refuses the form, `E_STRUCTURAL_FANOUT`), and refuses it here too. -/
def undecidedScalar {α : Type} (cx : Ctx) : EM α :=
  if cx.mutation then refuse "E_STRUCTURAL_FANOUT" else throw .unavailable

/-- A search `exists domain` (LLP 3000.036 §15.12): stops at a visible
match, which proves presence (`true`; incomplete when the scan is not
decided). Absence needs a decided scan: `false` when the pins or a readable
grant decide the read rule, otherwise no answer, never `false` (OPEN C5). A
cut cannot establish a negative answer (reads card). `exists t[key]` is a
point read (`t[key] != null`, `Syntax.lean`), not this. -/
def existsRead (cx : Ctx) (vw : View) (t : String) (ps : List (String × Scalar))
    (filt : Row → EM Bool) : EM (Value × Option Value) := do
  let w ← walk filt cx.budget 1 [] none (candidates vw t ps [] false none)
  if w.stop = .cut then cutScalar cx
  else if w.rows.isEmpty then
    if decided cx vw t ps then return (.ofBool false, none) else undecidedScalar cx
  else do
    markIf !(decided cx vw t ps)
    return (.ofBool true, none)

/-! ## Expressions -/

def evalExpr : Nat → Ctx → View → Env → Option Value → Expr → EM (Value × Option Value)
  | 0, _, _, _, _, _ => refuse "E_MODEL_FUEL"
  | fuel + 1, cx, vw, env, dot, e =>
    let ev := evalExpr fuel cx vw env dot
    let evs := fun (xs : List Expr) => xs.mapM fun x => do return (← ev x).1
    let evPins := fun (ps : List (String × Expr)) => ps.mapM fun p => do
      let v ← ev p.2
      return (p.1, ← asScalar v.1)
    let filt := fun (f : Option Expr) (r : Row) => match f with
      | none => pure true
      | some g => do asBool (← evalExpr fuel cx vw env (some r.toValue) g).1
    match e with
    | .lit v => pure (v, none)
    | .var x => match env.lookup x with
      | some p => pure p
      | none => typeErr
    | .viewer => pure (.s (.id cx.viewer), none)
    | .dot c => match dot.bind (·.field? c) with
      | some v => pure (v, none)
      | none => typeErr
    | .field a c => do
      let (v, _) ← ev a
      -- `why E_FIELD`: "Ordinary Quarry field access propagates a null base
      -- as null" (OPEN E4, confirmed by that document).
      if v.isNull then return (Value.null, none)
      match v.field? c with
      | some x => pure (x, none)
      | none => typeErr
    | .neg a => do
      let (v, _) ← ev a
      match v with
      | .s (.int n) => return (← checkI53 (-n), none)
      | _ => typeErr
    | .bin op a b => do
      let (x, _) ← ev a
      let (y, _) ← ev b
      return (← binop op x y, none)
    | .and a b => do
      let (x, _) ← ev a
      if ← asBool x then
        let (y, _) ← ev b
        return (.ofBool (← asBool y), none)
      else return (.ofBool false, none)
    | .or a b => do
      let (x, _) ← ev a
      if ← asBool x then return (.ofBool true, none)
      else
        let (y, _) ← ev b
        return (.ofBool (← asBool y), none)
    | .not a => do
      let (x, _) ← ev a
      return (.ofBool !(← asBool x), none)
    | .assert a code => do
      let (v, nx) ← ev a
      if v.isNull then refuse code else pure (v, nx)
    | .coalesce a b => do
      let (v, nx) ← ev a
      if v.isNull then ev b else pure (v, nx)
    | .cond c a b => do
      let (x, _) ← ev c
      if ← asBool x then ev a else ev b
    | .call f args => do
      let vs ← evs args
      match cx.helpers.find? (·.name == f) with
      | none => typeErr
      | some h =>
        if h.params.length = vs.length then
          -- A helper body sees only its own parameters: each call is
          -- evaluated independently of the caller's locals and of other calls.
          let (v, _) ← evalExpr fuel cx vw (h.params.zip (vs.map fun v => (v, none))) none h.body
          pure (v, none)
        else typeErr
    | .arr xs => do return (.arr (← evs xs), none)
    | .record fs => do
      let vs ← fs.mapM fun p => do return (p.1, (← ev p.2).1)
      return (.row vs, none)
    | .point t key => do
      let ks ← evPins key
      return (pointRead vw t ks, none)
    | .page t pins f order desc take after => do
      let ps ← evPins pins
      let cur ← match after with
        | none => pure none
        | some a => do parseCursor order (← ev a).1
      let (v, nx) ← pageRead cx vw t ps (filt f) order desc take cur
      -- A cursorless page (no `after`) has no continuation: "A cursorless
      -- top-N answer has no `next`" (LLP 3000.027 §1; OPEN C9).
      pure (v, if after.isSome then nx else some .null)
    | .count t pins f => do
      let ps ← evPins pins
      countRead cx vw t ps (filt f)
    | .exists_ t pins f => do
      let ps ← evPins pins
      existsRead cx vw t ps (filt f)

/-! ## Statements -/

/-- A write with its expressions evaluated. An update condition is kept as a
function of the old row. -/
inductive RWrite where
  | insert (t : String) (fields : List (String × Value)) (ifAbsent : Bool)
  | upsert (t : String) (key : List (String × Value)) (patch : List (String × Value))
  | update (t : String) (key : List (String × Value)) (patch : List (String × Value))
      (cond : Option (Row → Except Stop Bool))
  | delete (t : String) (key : List (String × Value))

/-- What a world provides: the view reads see, and how it applies a write. -/
structure Hooks (W : Type) where
  view : Ctx → W → View
  apply : Ctx → W → RWrite → Except Stop (Value × W)

inductive Flow where
  | normal
  | ret (v : Value) (next : Option Value)

def liftE {α : Type} (x : Except Stop α) : EM α := fun rs => x.map (·, rs)

def evalFields (fuel : Nat) (cx : Ctx) (vw : View) (env : Env) (fs : List (String × Expr)) :
    EM (List (String × Value)) :=
  fs.mapM fun p => do return (p.1, (← evalExpr fuel cx vw env none p.2).1)

def resolve (fuel : Nat) (cx : Ctx) (vw : View) (env : Env) (rs0 : RS) : WriteOp → EM RWrite
  | .insert t fs ifAbsent => do return .insert t (← evalFields fuel cx vw env fs) ifAbsent
  | .upsert t key patch => do
    return .upsert t (← evalFields fuel cx vw env key) (← evalFields fuel cx vw env patch)
  | .update t key patch cond => do
    let k ← evalFields fuel cx vw env key
    let p ← evalFields fuel cx vw env patch
    let c := cond.map fun g => fun (old : Row) =>
      ((do asBool (← evalExpr fuel cx vw env (some old.toValue) g).1 : EM Bool).run' rs0)
    return .update t k p c
  | .delete t key => do return .delete t (← evalFields fuel cx vw env key)

def execStmts {W : Type} (H : Hooks W) : Nat → Ctx → W → Env → List Stmt → EM (Flow × W × Env)
  | 0, _, _, _, _ => refuse "E_MODEL_FUEL"
  | _ + 1, _, w, env, [] => pure (.normal, w, env)
  | fuel + 1, cx, w, env, s :: ss =>
    match s with
    | .assign x e => do
      let p ← evalExpr fuel cx (H.view cx w) env none e
      execStmts H fuel cx w ((x, p) :: env) ss
    | .require c code => do
      let (v, _) ← evalExpr fuel cx (H.view cx w) env none c
      if ← asBool v then execStmts H fuel cx w env ss else refuse code
    | .ret e => do
      let (v, nx) ← evalExpr fuel cx (H.view cx w) env none e
      pure (.ret v nx, w, env)
    | .ite c th el => do
      let (v, _) ← evalExpr fuel cx (H.view cx w) env none c
      let b ← asBool v
      let (fl, w', env') ← execStmts H fuel cx w env (if b then th else el)
      match fl with
      | .ret .. => pure (fl, w', env')
      | .normal => execStmts H fuel cx w' env' ss
    | .write bind op => do
      let rs ← get
      let rw ← resolve fuel cx (H.view cx w) env rs op
      let (v, w') ← liftE (H.apply cx w rw)
      let env' := match bind with
        | some x => (x, (v, none)) :: env
        | none => env
      execStmts H fuel cx w' env' ss

end Quarry
