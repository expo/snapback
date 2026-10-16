import Quarry.Store
import Quarry.Calendar

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
  /-- The server request clock used by lower read lifetimes. -/
  now : Int := 0
  helpers : List Helper := []
  budget : Option Nat := none
  mutation : Bool := false
  /-- Evaluating a helper's body: the engine never plans a helper's page as a
  merge of its branches (LLP 3000.036.001 §2), so neither does the model. -/
  inHelper : Bool := false

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

/-- Truncating quotient/remainder followed by one exact rounding step. The
model deliberately derives truncation from the existing Euclidean primitive,
so its oracle is independent of the Rust implementation. -/
def roundedDiv (rounding : Rounding) (scale : Option Nat) (x y : Int) : EM Value := do
  if y = 0 then refuse "E_DIV_ZERO"
  let x := x * (10 : Int) ^ scale.getD 0
  let qe := Int.ediv x y
  let re := Int.emod x y
  let q := if x < 0 ∧ re ≠ 0 then qe + (if y < 0 then -1 else 1) else qe
  let r := x - q * y
  if r = 0 then checkI53 q else
    let direction : Int := if (x < 0) = (y < 0) then 1 else -1
    let away := q + direction
    let result := match rounding with
      | .towardZero => q
      | .awayFromZero => away
      | .floor => if direction < 0 then away else q
      | .ceiling => if 0 < direction then away else q
      | .halfAwayFromZero => if Int.natAbs r * 2 ≥ Int.natAbs y then away else q
      | .halfEven =>
          if Int.natAbs r * 2 > Int.natAbs y ∨
              (Int.natAbs r * 2 = Int.natAbs y ∧ Int.emod q 2 ≠ 0)
          then away else q
    checkI53 result

/-- A calendar builtin over unbounded integers; the caller checks i53. A
non-positive period or an offset outside `[0, period)` is unreachable from a
checked program. -/
def calApply : CalFn → Int → Option Int
  | .period ms off, t => if 0 < ms ∧ 0 ≤ off ∧ off < ms then some (Calendar.periodOrdinal t ms off) else none
  | .month, t => some (Calendar.monthOf t)
  | .year, t => some (Calendar.yearOf t)
  | .monthStart, m => some (Calendar.monthStart m)
  | .yearStart, y => some (Calendar.yearStart y)

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

/-! ### Decided pages (OPEN C8, LLP 3000.036.001)

A page is *decided* when its pins decide the read rule: every row column the
rule reads is pinned, or the rule is true by the pins' form (a `.col = viewer`
disjunct pinned to `viewer`, a `.col = 'x'` disjunct pinned to `'x'`). A query
page whose pins do not decide the rule may still be *branch-decided*: its
`where` is one `or` whose alternatives each pin a prefix that decides the rule,
or its read rule is an `or` of parties (`.col = viewer`). The engine reads such
a page as the merge of its branches; every branch's rows are decided by its
own pins, so the page is complete. The page's rows, order and cursor are the
same either way. -/

/-- A predicate whose evaluation never refuses: comparisons and boolean
operators over the row's columns, locals, literals and `viewer` (no member
of a value, which the engine may resolve by reading a referenced row). -/
def Expr.total : Expr → Bool
  | .lit _ | .var _ | .viewer | .dot _ => true
  -- A member of anything but the row may read a referenced row on the
  -- engine, which a meter can cut mid-predicate (LLP 3000.036.001 round 4).
  | .field _ _ => false
  | .not e => e.total
  | .bin op a b => (op == .eq || op == .ne || op == .lt || op == .le || op == .gt || op == .ge) && a.total && b.total
  | .and a b | .or a b => a.total && b.total
  | _ => false

/-- Reads no column of the row (conservatively: only the total forms). -/
def Expr.rowFree : Expr → Bool
  | .lit _ | .var _ | .viewer => true
  | .field e _ | .not e => e.rowFree
  | .bin _ a b | .and a b | .or a b => a.rowFree && b.rowFree
  | _ => false

def Expr.conjuncts : Expr → List Expr
  | .and a b => a.conjuncts ++ b.conjuncts
  | e => [e]

def Expr.disjuncts : Expr → List Expr
  | .or a b => a.disjuncts ++ b.disjuncts
  | e => [e]

def Expr.isOr : Expr → Bool
  | .or _ _ => true
  | _ => false

def Expr.isViewer : Expr → Bool
  | .viewer => true
  | _ => false

/-- `.col = e` with `e` free of the row, or a bare boolean column: a
conjunct the planner can turn into an index pin. -/
def Expr.eqPin : Expr → Option (String × Expr)
  | .bin .eq (.dot c) e => if e.rowFree then some (c, e) else none
  | .bin .eq e (.dot c) => if e.rowFree then some (c, e) else none
  | .dot c => some (c, .lit (.ofBool true))
  | .not (.dot c) => some (c, .lit (.ofBool false))
  | _ => none

/-- The first pin on column `c`: the planner pins each column once. -/
def pinOf (pins : List (String × Expr)) (c : String) : Option Expr :=
  (pins.find? (·.1 == c)).map (·.2)

def pinnedLit (pins : List (String × Expr)) (c : String) (v : Scalar) : Bool :=
  match pinOf pins c with
  | some (.lit (.s x)) => decide (x = v)
  | _ => false

def pinnedViewer (pins : List (String × Expr)) (c : String) : Bool :=
  (pinOf pins c).any Expr.isViewer

/-- The rule is true for every row the pins select, by the pins' form. -/
def Rule.byForm (pins : List (String × Expr)) : Rule → Bool
  | .allow => true
  | .eq (.col .self c) .viewer | .eq .viewer (.col .self c) => pinnedViewer pins c
  | .eq (.col .self c) (.lit v) | .eq (.lit v) (.col .self c) => pinnedLit pins c v
  | .or a b => a.byForm pins || b.byForm pins
  | .and a b => a.byForm pins && b.byForm pins
  | _ => false

/-- The pins decide the read rule. -/
def decidedPins (td : TableDecl) (pins : List (String × Expr)) : Bool :=
  td.read.selfCols.all (fun c => pins.any (·.1 == c)) || td.read.byForm pins

/-- The parties of a read rule that is an `or` of at least two `.col = viewer`
disjuncts, and nothing else. -/
def Rule.partyLeaves : Rule → Option (List String)
  | .eq (.col .self c) .viewer | .eq .viewer (.col .self c) => some [c]
  | .or a b => do return (← a.partyLeaves) ++ (← b.partyLeaves)
  | _ => none

def Rule.parties (r : Rule) : Option (List String) :=
  match r with
  | .or _ _ => r.partyLeaves.map List.eraseDups
  | _ => none

/-- One static descriptor of an owner-or-membership plan. The membership
descriptor keeps the exact probe; at runtime its one row-dependent key
component becomes the dynamic target prefix. -/
inductive AccessBranch where
  | party (column : String)
  | membership (table : String) (point : List String) (key : List (String × Term))
  deriving Repr

/-- The syntactic leaves accepted by PAGE: parties and exact probes, joined
only by top-level `or`. Eligibility of a probe is checked separately. -/
def Rule.accessLeaves : Rule → Option (List AccessBranch)
  | .eq (.col .self c) .viewer | .eq .viewer (.col .self c) => some [.party c]
  | .probe t point key => some [.membership t point key]
  | .or a b => do return (← a.accessLeaves) ++ (← b.accessLeaves)
  | _ => none

def Term.fixedExpr : Term → Option Expr
  | .viewer => some .viewer
  | .param name => some (.var name)
  | .lit v => some (.lit (.s v))
  | _ => none

/-- The single target-row column in a membership probe, including the target
row's intrinsic `id`. A fully fixed probe is an ordinary static grant. -/
def membershipTarget (key : List (String × Term)) : Option String := do
  let dynamic := key.filterMap fun p => match p.2 with
    | .col .self outer => some outer
    | _ => none
  let [target] := dynamic | none
  if key.all (fun p => p.2.fixedExpr.isSome || p.2 == .col .self target)
  then some target else none

/-- The one row-dependent `(source column, target column)` of a membership
probe. Every other exact-key component must be viewer/literal fixed. -/
def membershipColumns (key : List (String × Term)) : Option (String × String) := do
  let dynamic := key.filterMap fun p => match p.2 with
    | .col .self outer => some (p.1, outer)
    | _ => none
  let [pair] := dynamic | none
  if key.all (fun p => p.2.fixedExpr.isSome || dynamic.contains pair && p == (pair.1, .col .self pair.2))
  then some pair else none

/-- An exact membership probe selects a declared unique point or the intrinsic
`id` point, has one target-row component and fixed readable source pins, and
has a total point, a fully fixed total discovery unique, or a cap grouped
wholly by the fixed discovery columns (LLP 3000.036.001 §15). Either total
unique bounds one witness, while the runtime read meter bounds any inverted
population.
Equalities outside `point` are residual predicates rather than point-key
components. -/
-- @ref LLP 3000.036.001#15 — original point, discovery unique and cap are distinct source proofs.
def membershipEligible (sch : Schema) (t : String) (point : List String)
    (key : List (String × Term)) : Bool :=
  match sch.table? t, membershipColumns key with
  | some td, some _ =>
    let columns := key.map (·.1)
    let fixed := key.filterMap fun p => p.2.fixedExpr.map (p.1, ·)
    let exactUnique := point.eraseDups.length == point.length
      && point.all columns.contains
      && (point == ["id"] || td.uniques.any fun unique => unique == point)
    let totalUnique := fun unique => unique.all fun c =>
      td.cols.any fun col => col.name == c && !col.nullable && col.onDelete != some .setNull
    let totalPoint := point == ["id"] || td.uniques.any fun unique =>
      unique == point && totalUnique unique
    let totalDiscovery := td.uniques.any fun unique =>
      totalUnique unique && unique.all fun c => fixed.any (·.1 == c)
    let capped := td.caps.any fun cap =>
      cap.columns.all fun c => c != "id" && fixed.any (·.1 == c)
        && !(td.cols.any fun col => col.name == c && col.onDelete == some .setNull)
    exactUnique && (totalPoint || totalDiscovery || capped)
      && td.read.byForm fixed
  | _, _ => false

/-- Classify the exact PAGE rule. At least one party and membership branch
are required, every leaf is eligible, and the static descriptors plus the
system lane fit the ordinary eight-descriptor limit. -/
def Rule.ownerMembership? (sch : Schema) (r : Rule) : Option (List AccessBranch) := do
  let leaves ← r.accessLeaves
  let parties := leaves.filterMap fun b => match b with | .party c => some c | _ => none
  let memberships := leaves.filter fun b => match b with | .membership _ _ _ => true | _ => false
  let membership := !memberships.isEmpty
  let eligible := leaves.all fun b => match b with
    | .party _ => true
    | .membership t point key => membershipEligible sch t point key
  if membership && eligible
      && parties.eraseDups.length + memberships.length + 1 ≤ 8
  then some leaves else none

/-- An exact owner-or-membership point shape is reserved for PAGE even when
one of its stricter eligibility checks declines. This mirrors the compiler's
fallback fence, including hidden sources and physical plans that do not fit. -/
def Rule.ownerMembershipReserved (sch : Schema) (r : Rule) : Bool :=
  match r.accessLeaves with
  | none => false
  | some leaves =>
    let topOr := match r with | .or _ _ => true | _ => false
    let party := leaves.any fun b => match b with | .party _ => true | _ => false
    let membership := leaves.any fun b => match b with | .membership _ _ _ => true | _ => false
    let exact := leaves.all fun b => match b with
      | .party _ => true
      | .membership t point key => match sch.table? t with
        | none => false
        | some td =>
          let columns := key.map (·.1)
          (membershipTarget key).isSome
            && point != ["id"]
            && point.eraseDups.length == point.length
            && point.all columns.contains
            && (point == ["id"] || td.uniques.any fun unique => unique == point)
    topOr && party && membership && exact

/-- The core's `disclosing` (`rules.rs`): every fact a guard reads is one its
holder may read. A probe's target row must be readable by its own read rule
given the probe's key (`byForm`), where a pinned row column is an unknown
value that decides nothing; or the target's rule carries the same probe.
Nested `or` and `not` disclose nothing. -/
def Term.asKnown : Term → Option Expr
  | .viewer => some .viewer
  | .param name => some (.var name)
  | .lit v => some (.lit (.s v))
  | .col _ _ => none

/-- Infallible lexical names remain opaque fixed expressions. Their actual
values never become literals and cannot manufacture a viewer/literal proof. -/
def Term.guardPin (pins : List (String × Expr)) : Term → Term
  | .col .self c => match pins.lookup c with
    | some .viewer => .viewer
    | some (.lit (.s v)) => .lit v
    | _ => .col .self c
  | t => t

/-- Probe components may carry opaque lexical pins. Local Boolean guards
retain their row field identity so required/nullable checks remain explicit. -/
def Term.witnessPin (pins : List (String × Expr)) : Term → Term
  | .col .self c => match pins.lookup c with
    | some (.var name) => .param name
    | _ => (Term.col .self c).guardPin pins
  | t => t.guardPin pins

/-- The guard form inspected by PAGE after its known page pins are applied. -/
def Rule.guardForm (pins : List (String × Expr)) : Rule → Rule
  | .probe t point key => (Rule.probe t point (key.map fun p => (p.1, p.2.witnessPin pins))).normalize
  | .and a b => (Rule.and (a.guardForm pins) (b.guardForm pins)).normalize
  | .or a b => (Rule.or (a.guardForm pins) (b.guardForm pins)).normalize
  | .not a => (Rule.not (a.guardForm pins)).normalize
  | d => (d.mapTerms (Term.guardPin pins)).normalize

def Rule.disclosing (sch : Schema) : Rule → Bool
  | .allow => true
  | .eq a b | .ne a b => [a, b].all fun t => match t with
    | .viewer | .param _ | .lit _ | .col .self _ => true
    | _ => false
  | .and a b => a.disclosing sch && b.disclosing sch
  | .probe t _ key => match sch.table? t with
    | some td =>
      let known := key.filterMap fun p => match p.2 with
        | .col .self _ => none
        | term => some (p.1, term.asKnown)
      match known.mapM (fun p => p.2.map (p.1, ·)) with
      | some pins => td.read.byForm pins || td.read.disjuncts.any fun d => match d with
          | .probe t' _ key' => t' == t && key'.all (fun k => key.any fun k2 => k.1 == k2.1 && k.2 == k2.2)
          | _ => false
      | none => false
    | none => false
  | _ => false

/-- A negated static probe can certify absence only at a total readable
point without a lifetime. Negative row-source discovery stays excluded. -/
def Rule.negativePoint (sch : Schema) (r : Rule) : Bool :=
  match r with
  | .probe t point key => match sch.table? t with
    | some td => td.notBefore.isNone && r.disclosing sch
        && key.all (fun p => p.2.fixedExpr.isSome)
        && (point == ["id"] || td.uniques.any fun unique => unique == point
          && unique.all fun c => td.cols.any (fun col => col.name == c && !col.nullable))
    | none => false
  | _ => false

/-- A Boolean test whose only unknown is a row field. `usableGuard` separately
requires that field to be a page pin; a literal pin is folded before this test.
Keeping this shape narrow avoids admitting arbitrary negated expressions. -/
def Rule.pinnedBoolTest (td : TableDecl) : Rule → Bool
  | .eq (.col .self c) (.lit (.bool _)) | .eq (.lit (.bool _)) (.col .self c)
  | .ne (.col .self c) (.lit (.bool _)) | .ne (.lit (.bool _)) (.col .self c) =>
      td.cols.any fun col => col.name == c && !col.nullable
  | .not a => a.pinnedBoolTest td
  | _ => false

/-- Positivity for a planned page guard. A negated required-Boolean test may
depend on the runtime value of its page pin, but never on a probe. Runtime
`granted` still uses the stricter `Rule.positive` after substituting the actual
scalar pins. -/
def Rule.guardPositive (td : TableDecl) : Rule → Bool
  | .not a => a.pinnedBoolTest td || match a with | .probe .. => true | _ => false
  | .and a b | .or a b => a.guardPositive td && b.guardPositive td
  | .allow | .deny | .eq .. | .ne .. | .probe .. => true

/-- Disclosure for a planned guard treats a negated pinned-Boolean test as a
local condition on the page prefix. Negated probes remain inadmissible. -/
def Rule.guardDisclosing (sch : Schema) (td : TableDecl) : Rule → Bool
  | .not a => a.pinnedBoolTest td || a.negativePoint sch
  | .and a b => a.guardDisclosing sch td && b.guardDisclosing sch td
  | r => r.disclosing sch

/-- A page guard the engine evaluates once per caller (LLP 3000.036 §12.1,
§16.3; `rules::covering_grant`): no `not`, every row column it reads pinned by
the page (none, for a grant), and disclosing. -/
def Rule.usableGuard (sch : Schema) (td : TableDecl) (pins : List (String × Expr)) (d : Rule) : Bool :=
  let d' := d.guardForm pins
  d'.selfCols.all (fun c => pins.any (·.1 == c)) && d'.guardPositive td && d'.guardDisclosing sch td

/-- A readable fixed total point in a predicate has a Boolean result. Its
physical read may cut; native continuation excludes the interrupted row. -/
def Expr.readablePredicate (sch : Schema) (e : Expr) : Bool :=
  if e.total then true else match e with
  | .and a b | .or a b => a.readablePredicate sch && b.readablePredicate sch
  | .bin .ne (.point t keys) (.lit (.s .null)) =>
      match sch.table? t with
      | none => false
      | some td =>
        let terms := keys.mapM fun p => match p.2 with
          | .viewer => some (p.1, Term.viewer)
          | .lit (.s v) => some (p.1, Term.lit v)
          | _ => none
        terms.any fun key =>
          let total := td.uniques.any fun unique => unique.all fun c =>
            keys.any (·.1 == c) && td.cols.any (fun col => col.name == c && !col.nullable)
          td.notBefore.isNone && total && (Rule.probe t (keys.map (·.1)) key).disclosing sch
  | _ => false

def Rule.party? : Rule → Option String
  | .eq (.col .self c) .viewer | .eq .viewer (.col .self c) => some c
  | _ => none

/-- Case 2's parties: a read rule of at least two disjuncts, each a party
(`.col = viewer`) or a usable page guard, with at least one party. -/
def Rule.branchParties (sch : Schema) (td : TableDecl) (pins : List (String × Expr)) (guards : Bool) (r : Rule) : Option (List String) :=
  let ds := r.disjuncts
  let ps := (ds.filterMap Rule.party?).eraseDups
  if 2 ≤ ds.length && !ps.isEmpty && ds.all (fun d => d.party?.isSome || (guards && d.usableGuard sch td pins)) then some ps else none

/-- PAGE3's positive alternatives, bounded before distributing conjunctions.
Enums remain outside the surface emitter's independently named fragment. -/
def Rule.positiveRanges : Rule → Option (List (List Rule))
  | .or a b => do
      let out := (← a.positiveRanges) ++ (← b.positiveRanges)
      if out.length < 8 then some out else none
  | .and a b => do
      let as ← a.positiveRanges
      let bs ← b.positiveRanges
      if as.length * bs.length < 8 then
        some (as.flatMap fun a => bs.map fun b => a ++ b)
      else none
  | r@(.eq ..) | r@(.probe ..) | r@(.not (.probe ..)) => some [[r]]
  | _ => none

def Rule.rangePin : Rule → Option (String × Expr)
  | .eq (.col .self c) t | .eq t (.col .self c) => t.fixedExpr.map (c, ·)
  | _ => none

def Rule.hasCompound : Rule → Bool
  | .and .. => true
  | .or .. => true
  | _ => false

/-- A page guard (LLP 3000.036 §12.1, §16.3): a disjunct whose expression
pins make it an eligible readable guard and whose evaluated scalar pins make
it true for this caller. Keeping both forms matters: an argument's current
Boolean value cannot authorize a compound negation the native planner could
not prove from the argument expression. The guard is evaluated over the
caller's view; `granted_readable` proves that a true normalized positive guard
also holds over the store and implies the original rule. -/
def granted (sch : Schema) (vw : View) (v : List Nat) (t : String)
    (ps : List (String × Scalar)) (pins : List (String × Expr)) : Bool :=
  match sch.table? t with
  | some td => td.read.disjuncts.any fun d =>
      let d' := (d.pin ps).normalize
      d.usableGuard sch td pins && d'.positive && d'.selfCols.isEmpty && d'.eval vw v {}
  | none => false

/-- A scan whose read rule is decided for this caller: by its pins
(`uniform`) or by an expression-eligible page guard (`granted`). Only a
decided scan can prove absence: a page is complete, and an `exists` may answer
`false`. -/
def decided (cx : Ctx) (vw : View) (t : String) (ps : List (String × Scalar))
    (pins : List (String × Expr)) : Bool :=
  uniform cx.schema t ps || granted cx.schema vw cx.viewer t ps pins

/-- An alternative's eligible pin: not `id`, and on a nullable column only
`viewer` (a branch never seeks a null the filter would reject). -/
def eligiblePin (td : TableDecl) (e : Expr) : Bool :=
  match e.eqPin with
  | some (c, v) => c != "id" && (td.cols.any fun d => d.name == c && (!d.nullable || v.isViewer))
  | none => false

def eligiblePinned (td : TableDecl) (p : String × Expr) : Bool :=
  p.1 != "id" && (td.cols.any fun d => d.name == p.1 && (!d.nullable || p.2.isViewer))

/-- A branch's prefix: its own equalities first, then the page's pins, each
column once, never `id` or an order column (a merge lane keeps those as
seeks), within an index's 8 components. -/
def laneFits (order : List String) (eqs pins : List (String × Expr)) : Bool :=
  let lane := (eqs ++ pins).filter fun p => p.1 != "id" && !order.contains p.1
  (lane.map (·.1)).eraseDups.length + order.length + 1 ≤ 8

def laneDecided (td : TableDecl) (order : List String) (eqs pins : List (String × Expr)) : Bool :=
  laneFits order eqs pins && decidedPins td ((eqs ++ pins).filter fun p => p.1 != "id" && !order.contains p.1)

/-- PAGE5's fixed half of a fixed-plus-varying grant: after substituting the
page pins, this is one timeless, required exact point whose ordinary read
rule discloses the same answer to the caller. -/
def fixedPointGuard (sch : Schema) (outer : TableDecl)
    (pins : List (String × Expr)) : Rule → Bool
  | r@(.probe t point key) => match sch.table? t with
    | some source =>
      let columns := key.map (·.1)
      key.length == point.length
        && point.eraseDups.length == point.length
        && point.all columns.contains
        && (point == ["id"] || source.uniques.contains point)
        && point.all (fun name => name == "id" || source.cols.any (fun col => col.name == name && !col.nullable))
        && source.notBefore.isNone && source.expire.isNone
        && r.usableGuard sch outer pins
    | none => false
  | _ => false

/-- PAGE5's varying half has exactly one outer-row key component and otherwise
uses PAGE's existing readable, total membership witness. -/
def varyingPointGrant (sch : Schema) (pins : List (String × Expr))
    (order : List String) : Rule → Bool
  | r@(.probe ..) => match r.guardForm pins with
    | .probe t point key => membershipEligible sch t point key
        && (membershipColumns key).any fun pair =>
          !pins.any (·.1 == pair.2)
            && (!order.contains pair.2 || pair.2 == "id" && order == ["id"])
            && laneFits order [(pair.2, .viewer)] pins
    | _ => false
  | _ => false

/-- Each positive alternative either has a prefix-decided rule, its own
readable guard, or one exact membership witness with every remaining
conjunct true by its pins. -/
def compoundDecided (sch : Schema) (td : TableDecl) (pins : List (String × Expr)) (order : List String) : Bool :=
  -- @ref LLP 3000.036.001#17 — a declined candidate retains its authored scan.
  -- The system lane pins the first order column, changing its physical order;
  -- party lanes keep it in their shared position, so their orders cannot merge.
  td.read.hasCompound
    && !(order.head?.any fun o => o != "id" && pins.any (·.1 == o))
    && td.read.positiveRanges.any fun ranges =>
    ranges.length + 1 ≤ 8 && ranges.all fun atoms =>
      let extra := atoms.filterMap Rule.rangePin
      let ps := extra ++ pins
      let own := atoms.filter fun r => !(r.rangePin.isSome)
      extra.all (fun p => p.1 != "id" && !order.contains p.1
        && (td.cols.any fun c => c.name == p.1 && (!c.nullable || p.2.isViewer)))
        && laneFits order extra pins
        && (own.isEmpty || own.all (fun r => r.usableGuard sch td ps)
          || match own with
            | [r@(.probe ..)] => match r.guardForm ps with
              | .probe t point key => membershipEligible sch t point key
                && (membershipColumns key).any fun pair =>
                  !ps.any (·.1 == pair.2) && (!order.contains pair.2 || pair.2 == "id" && order == ["id"])
                  && laneFits order ((pair.2, .viewer) :: extra) pins
              | _ => false
            | _ =>
                own.length >= 2
                  && (own.filter (varyingPointGrant sch ps order)).length == 1
                  && own.all (fun r => varyingPointGrant sch ps order r
                    || fixedPointGuard sch td ps r))


/-- The exact positive where witness of PAGE4. Other audiences cannot
contribute to W; its readable source may certify the narrower page. -/
def Expr.isWhereWitness (r : Rule) (e : Expr) : Bool :=
  match r, e with
  | .probe rt _ rkeys, .bin .ne (.point et ekeys) (.lit (.s .null)) =>
      rt == et && rkeys.length == ekeys.length && rkeys.all fun rk =>
        ekeys.any fun ek => rk.1 == ek.1 && match rk.2, ek.2 with
          | .col .self c, .dot d => c == d
          | .viewer, .viewer => true
          | .lit a, .lit (.s b) => a == b
          | _, _ => false
  | _, _ => false

def scopedWitnessDecided (sch : Schema) (td : TableDecl)
    (pins : List (String × Expr)) (fs : List Expr) (order : List String) : Bool :=
  td.read.disjuncts.any fun r => match r with
    | .probe t point key =>
        fs.any (Expr.isWhereWitness r) && (fs.filter (!·.isWhereWitness r)).all Expr.total
          && membershipEligible sch t point key
          && (membershipColumns key).any fun pair =>
            !pins.any (·.1 == pair.2)
              && (!order.contains pair.2 || pair.2 == "id" && order == ["id"])
              && laneFits order [(pair.2, .viewer)] pins
    | _ => false

/-- PAGE5's explicit vacancy: a top-level negated probe of one required
exact point by the focal row's intrinsic id. The native lane still checks the
whole read rule per row; this predicate governs only its exhaustion verdict. -/
def vacancyDecided (sch : Schema) (td : TableDecl) : Bool :=
  td.onlineOnly && td.read.disjuncts.any fun r => match r with
    | .not (.probe t point key) =>
        (sch.table? t).any fun source =>
          let varying := key.filter fun p => match p.2 with | .col .self _ => true | _ => false
          (varying.map (·.2)).eraseDups.length == 1
            && (varying.filter fun p => point.contains p.1).length == 1
            && key.all (fun p => p.2.fixedExpr.isSome || varying.contains p)
            && point.all (fun c => key.any (·.1 == c))
            && (point == ["id"] || source.uniques.contains point)
            && point.all (fun c => c == "id" || source.cols.any (fun col => col.name == c && !col.nullable))
    | _ => false

/-- LANG2's prepaid finite-group walk keeps every row rule and filter. The
model classifies exactness; native tests cover the separate physical allowance. -/
def Rule.exhaustionSafe (sch : Schema) : Rule → Bool
  | .probe t _ _ => (sch.table? t).any fun target => target.notBefore.isNone && target.expire.isNone
  | .and a b | .or a b => a.exhaustionSafe sch && b.exhaustionSafe sch
  | .not a => a.exhaustionSafe sch
  | _ => true

def finiteExhaustion (sch : Schema) (td : TableDecl) (pins : List (String × Expr)) : Bool :=
  td.onlineOnly && td.notBefore.isNone && td.expire.isNone && td.read.exhaustionSafe sch
    && td.caps.any fun cap => cap.columns.all fun c => pins.any (·.1 == c)
      && !(td.cols.any fun col => col.name == c && col.onDelete == some .setNull)

/-- The pins the single-index planner keeps: the page's equalities and bare
boolean conjuncts, except `id` and an order column other than the first,
which stay seeks (`Requests::read`; GPT round 3, finding 3). -/
def plannedPins (pins : List (String × Expr)) (filter : Option Expr) (order : List String) : List (String × Expr) :=
  let fs := (filter.map Expr.conjuncts).getD []
  (pins ++ (fs.filter (!·.isOr)).filterMap Expr.eqPin).filter fun p =>
    p.1 != "id" && (order.head? == some p.1 || !order.contains p.1)

/-- The native membership planner's bounded Cartesian product of positive
query alternatives. Every resulting branch needs an eligible equality pin;
the later case-specific descriptor check keeps the system lane plus all
membership/party lanes within eight. -/
def filterAlternatives (td : TableDecl) (pins : List (String × Expr))
    (fs : List Expr) : Option (List (List Expr)) :=
  let common := fs.filter (!·.isOr)
  let factors := (fs.filter Expr.isOr).map fun e => e.disjuncts.map Expr.conjuncts
  if factors.isEmpty then none else
    let branches := factors.foldl (fun product factor =>
      product.flatMap fun prior => factor.map fun alternative => prior ++ alternative) [[]]
    if 2 ≤ branches.length && branches.length ≤ 8
      && branches.all (fun branch => pins.any (eligiblePinned td)
        || (common ++ branch).any (eligiblePin td))
    then some branches else none

/-- The branch rule of LLP 3000.036.001 §2 (cases 1 and 2; a grant branch is
complete for its holders as `granted` is, and empty for everyone else). -/
def branchDecided (sch : Schema) (t : String) (pins : List (String × Expr))
    (filter : Option Expr) (order : List String) (guards : Bool := true) : Bool :=
  match sch.table? t with
  | none => false
  | some td =>
    let fs := (filter.map Expr.conjuncts).getD []
    let total := pins.all (fun p => p.2.total) && fs.all (Expr.readablePredicate sch)
    let readFree := pins.all (fun p => p.2.total) && fs.all Expr.total
    let filterPins := pins ++ (fs.filter (!·.isOr)).filterMap Expr.eqPin
    let alts := filterAlternatives td filterPins fs
    let filterAlternativesSupported := alts.isSome || !(fs.any Expr.isOr)
    -- The planner pins a bare boolean conjunct too (`where .flag`); the
    -- emitter leaves it in the filter.
    let pins := filterPins
    let reservedMembership := td.read.ownerMembershipReserved sch
    let case1Candidate := alts.any fun as => as.all fun a => laneDecided td order (a.filterMap Expr.eqPin) pins
    -- The grant lane is the read as written, planned as the single-index page
    -- is: its prefix is the page's pins off the order (an equality on the
    -- first order column would become a pin there and change its order, so
    -- such a page is not merged), and it counts toward the 8 lanes.
    let guardPins := pins.filter fun p => p.1 != "id" && !order.contains p.1
    let membershipRule := td.read.ownerMembership? sch
    -- When an exact membership target is already pinned the Rust planner
    -- keeps the original scan. That PAGE fallback governs every older branch
    -- case as well; otherwise case 1 could still classify the same read.
    let pinnedMembership := membershipRule.any fun leaves =>
      leaves.any (fun leaf => match leaf with | .party _ => true | _ => false) && leaves.any fun leaf => match leaf with
      | .membership _ point key => if point == ["id"] then false else
          (membershipColumns key).any fun pair =>
            pins.any (·.1 == pair.2)
              || alts.any fun bases => bases.any fun a => (a.filterMap Expr.eqPin).any (·.1 == pair.2)
      | .party _ => false
    let case1 := if reservedMembership || pinnedMembership then false else case1Candidate
    let fixedMembership := td.read.accessLeaves.any fun leaves =>
      let members := leaves.filter fun leaf => match leaf with | .membership .. => true | _ => false
      !members.isEmpty && members.all fun leaf => match leaf with
        | .membership source _ key => (membershipColumns key).any (fun pair => guardPins.any (·.1 == pair.2))
            && (sch.table? source).any (fun source => source.notBefore.isNone)
        | _ => false
    let case2 := if !guards || !filterAlternativesSupported || ((reservedMembership || pinnedMembership) && !fixedMembership) then false else match td.read.branchParties sch td guardPins true with
      | some ps =>
        let bases := alts.getD [[]]
        -- The grant lane is always planned (the system reads it whole).
        ps.all (fun c => c != "id" && !order.contains c)
          && bases.length * ps.length + 1 ≤ 8
          && !(order.head?.any fun o => o != "id" && pins.any (·.1 == o))
          && (guardPins.map (·.1)).eraseDups.length + order.length + 1 ≤ 8
          && bases.all fun a => ps.all fun c => laneDecided td order ((c, .viewer) :: a.filterMap Expr.eqPin) pins
      | none => false
    -- PAGE: one system descriptor, party descriptors and eligible exact
    -- membership descriptors. Dynamic discovery does not count against
    -- eight; its static membership descriptor does.
    let case3 := if !guards || !filterAlternativesSupported then false else match membershipRule with
      | some leaves =>
        let bases := alts.getD [[]]
        let parties := leaves.filterMap fun leaf => match leaf with | .party c => some c | _ => none
        let memberships := leaves.filter fun leaf => match leaf with | .membership _ _ _ => true | _ => false
        bases.length * (parties.eraseDups.length + memberships.length) + 1 ≤ 8
          && !(order.head?.any fun o => o != "id" && pins.any (·.1 == o))
          && bases.all fun a => leaves.all fun leaf => match leaf with
            | .party c => c != "id" && !order.contains c
                && laneFits order ((c, .viewer) :: a.filterMap Expr.eqPin) pins
            | .membership _ _ key => (membershipColumns key).any fun pair =>
                (!order.contains pair.2 || pair.2 == "id" && order == ["id"])
                  && !pins.any (·.1 == pair.2)
                  && !(a.filterMap Expr.eqPin).any (·.1 == pair.2)
                  && laneFits order ((pair.2, .viewer) :: a.filterMap Expr.eqPin) pins
      | none => false
    let case4 := guards && !reservedMembership && !pinnedMembership && alts.isNone && compoundDecided sch td pins order
    let witnessScope := guards && pins.all (fun p => p.2.total) && scopedWitnessDecided sch td pins fs order
    let vacancy := guards && readFree && (pins.all (fun p => p.1 != "id" && !order.contains p.1))
      && vacancyDecided sch td
    let finite := guards && readFree && (pins.all (fun p => !order.contains p.1))
      && finiteExhaustion sch td guardPins
    (total && (case1 || case2)) || (readFree && (case3 || case4)) || witnessScope || vacancy || finite

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

/-- Whether any of `rs` passes the filter. -/
def anyMatch (f : Row → EM Bool) : List Row → EM Bool
  | [] => pure false
  | r :: rs => do if ← f r then pure true else anyMatch f rs

/-- After a full page, whether `next` is kept: always, except that a merged
page keeps it only when a matching row follows. -/
def lookahead (filt : Row → EM Bool) (order : List String) (desc : Bool) (merged : Bool) (w : Walk)
    (cs : List Row) : EM Bool :=
  if merged && w.stop = .filled then anyMatch filt (afterCursor order desc (w.last.map (rowKey order)) cs)
  else pure true

/-- A page: walk the candidates; a cut page is incomplete (and refuses
`E_BOUND` in a mutation); a page whose read rule is not decided (by its pins,
a readable grant, the pins' form or its branches) is never complete; `next`
follows the last examined row unless the walk exhausted the candidates (reads
card; LLP 3000.007 §5.6). A `merged` page (the merge of its branches) carries
`next` after a full page only when another *matching* row follows: the merge
knows each branch's next matching row (LLP 3000.036.001 §5). -/
def pageRead (cx : Ctx) (vw : View) (t : String) (ps : List (String × Scalar))
    (pins : List (String × Expr))
    (filt : Row → EM Bool) (order : List String) (desc : Bool) (take : Nat) (cur : Option Key)
    (formed : Bool) (merged : Bool) :
    EM (Value × Option Value) := do
  let cs := candidates vw t ps order desc cur
  let w ← walk filt cx.budget take [] none cs
  if w.stop = .cut && cx.mutation then refuse "E_BOUND"
  else do
    let more ← lookahead filt order desc merged w cs
    markIf (w.stop = .cut || !(decided cx vw t ps pins || formed))
    pure (pageAnswer order (if more then w else { w with stop := .exhausted }))

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
    (pins : List (String × Expr))
    (filt : Row → EM Bool) (fm : Bool := false) : EM (Value × Option Value) := do
  let w ← walk filt cx.budget 1 [] none (candidates vw t ps [] false none)
  if w.stop = .cut then cutScalar cx
  else if w.rows.isEmpty then
    if decided cx vw t ps pins || fm then return (.ofBool false, none) else undecidedScalar cx
  else do
    markIf !(decided cx vw t ps pins || fm)
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
          let (v, _) ← evalExpr fuel { cx with inHelper := true } vw (h.params.zip (vs.map fun v => (v, none))) none h.body
          pure (v, none)
        else typeErr
    | .cal f a => do
      let (v, _) ← ev a
      match v, calApply f with
      -- `monthStart` and `yearStart` leave i53 only at the extreme ordinals:
      -- `E_OVERFLOW`, never a wrong instant (LLP 3000.040 §2.2).
      | .s (.int n), g => match g n with
        | some r => return (← checkI53 r, none)
        | none => typeErr
      | _, _ => typeErr
    | .roundDiv rounding scale a b => do
      let (x, _) ← ev a
      let (y, _) ← ev b
      match x, y with
      | .s (.int x), .s (.int y) => return (← roundedDiv rounding scale x y, none)
      | _, _ => typeErr
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
      let formed := match cx.schema.table? t with
        | some td => decidedPins td (plannedPins pins f order)
        | none => false
      let merged := !formed && !cx.mutation && !cx.inHelper && branchDecided cx.schema t pins f order
      let (v, nx) ← pageRead cx vw t ps pins (filt f) order desc take cur (formed || merged) merged
      -- A cursorless page (no `after`) has no continuation: "A cursorless
      -- top-N answer has no `next`" (LLP 3000.027 §1; OPEN C9).
      pure (v, if after.isSome then nx else some .null)
    | .count t pins f => do
      let ps ← evPins pins
      countRead cx vw t ps (filt f)
    | .exists_ t pins f => do
      let ps ← evPins pins
      -- `exists` over branches is an `or` of decided existence reads, for
      -- parties only (LLP 3000.036.001 §8); its pins' form decides it too.
      let formed := match cx.schema.table? t with
        | some td => decidedPins td (plannedPins pins f [])
        | none => false
      let merged := !formed && !cx.mutation && !cx.inHelper && branchDecided cx.schema t pins f [] false
      existsRead cx vw t ps pins (filt f) (formed || merged)

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
