import Quarry.Value

/-!
# The core fragment's abstract syntax

This is the *checked surface program* (LLP 3000.035 §2): what the parser and
type checker accept, after positional keys have been resolved to named
columns and sugar expanded, but before the binder lowers it to IR. The later
emitter (`snapback4-lang`, beside `emit/rust.rs`) produces these terms; it
reports anything outside the fragment as unsupported.

Expansions the emitter performs (each is a documented equivalence, not a
model choice, unless `OPEN.md` says otherwise):

* `public` / `public 'why'` on a table is `read <- allow`; a missing effect
  rule is `deny` (rules card).
* An unnamed `update <- R` becomes the two-image rule `R[old] and R[next]`
  (OPEN R2).
* `t[k]` with positional keys becomes named equalities on the declared unique
  key (indexes card); `t[x]` with `x : id` or `x : t` names `id`.
* `t where p first N by .a, .b after c` becomes a `page` whose equality
  conjuncts on columns (`.col = e`) are `pins` and whose remaining conjuncts
  are the `filter`; repeated `where` clauses are joined with `and` (reads
  card).
* `return insert …` becomes a bound write followed by `return` of the
  binding.
-/

namespace Quarry

/-! ## Schema -/

/-- What deleting a referenced row does to the rows naming it (LLP 3000.038
§2). A reference with no action keeps its rows (`on delete keep`). -/
inductive OnDelete where
  | restrict | cascade | setNull
  deriving Repr, DecidableEq

structure ColDecl where
  name : String
  nullable : Bool
  /-- The table a reference column names, when it is one. -/
  ref : Option String := none
  /-- The reference's delete action; `none` keeps the rows (LLP 3000.038 §2). -/
  onDelete : Option OnDelete := none
  deriving Repr, DecidableEq

/-- Which image of a row a rule term reads: the row itself (read, insert,
delete), or the old or next image of an update. -/
inductive Img where
  | self | old | next
  deriving Repr, DecidableEq

inductive Term where
  | col (i : Img) (c : String)
  | viewer
  | lit (v : Scalar)
  deriving Repr, DecidableEq

/-- The rule language of the rules card: `allow | deny | public | .col = viewer
| .col != 'x' | exists t[..] | and | or | not`. `created t[..]` and parent hops
are outside the core fragment. -/
inductive Rule where
  | allow
  | deny
  | eq (a b : Term)
  | ne (a b : Term)
  /-- `exists t[c1 = term1, …]`: an exact-key probe of another (or the same) table. -/
  | probe (t : String) (key : List (String × Term))
  | and (a b : Rule)
  | or (a b : Rule)
  | not (a : Rule)
  deriving Repr

structure TableDecl where
  name : String
  /-- Declared columns, excluding the implicit `id`. -/
  cols : List ColDecl
  /-- Declared unique keys (column lists), excluding the implicit unique `id`. -/
  uniques : List (List String) := []
  /-- The application refusal code for a visible clash on each unique key,
  when declared with `else CODE` (indexed like `uniques`). -/
  uniqueCodes : List (Option String) := []
  read : Rule := .deny
  insert : Rule := .deny
  update : Rule := .deny
  delete : Rule := .deny
  deriving Repr

structure Schema where
  tables : List TableDecl
  deriving Repr

def Schema.table? (sch : Schema) (t : String) : Option TableDecl :=
  sch.tables.find? (·.name == t)

/-! ## Expressions -/

inductive BinOp where
  | add | sub | mul | div | mod
  | eq | ne | lt | le | gt | ge
  deriving Repr, DecidableEq

inductive Expr where
  | lit (v : Value)
  | var (x : String)
  | viewer
  /-- `.col`: a column of the row under consideration in a `where` filter or
  an update condition. -/
  | dot (c : String)
  /-- `e.col` -/
  | field (e : Expr) (c : String)
  | neg (e : Expr)
  | bin (op : BinOp) (a b : Expr)
  | and (a b : Expr)
  | or (a b : Expr)
  | not (a : Expr)
  /-- `e ! else CODE` -/
  | assert (e : Expr) (code : String)
  /-- `a ?? b` -/
  | coalesce (a b : Expr)
  /-- `a if c else b` -/
  | cond (c a b : Expr)
  /-- A pure helper call `f(args)`. -/
  | call (f : String) (args : List Expr)
  | arr (xs : List Expr)
  | record (fs : List (String × Expr))
  /-- `t[c = e, …]`: a point read by id or a unique key. -/
  | point (t : String) (key : List (String × Expr))
  /-- `t where pins and filter first|last N by .order after c`. -/
  | page (t : String) (pins : List (String × Expr)) (filter : Option Expr)
      (order : List String) (desc : Bool) (take : Nat) (after : Option Expr)
  /-- `count(t where pins and filter)` -/
  | count (t : String) (pins : List (String × Expr)) (filter : Option Expr)
  /-- `exists t where pins and filter` (and `exists t[key]`). -/
  | exists_ (t : String) (pins : List (String × Expr)) (filter : Option Expr)
  deriving Repr, Inhabited

/-! ## Statements and programs -/

inductive WriteOp where
  /-- `insert t { fields } [if absent]` -/
  | insert (t : String) (fields : List (String × Expr)) (ifAbsent : Bool)
  /-- `upsert t[key] { patch }` -/
  | upsert (t : String) (key : List (String × Expr)) (patch : List (String × Expr))
  /-- `update t[key] { patch } [if cond]`; `cond` reads the old row as `.col`. -/
  | update (t : String) (key : List (String × Expr)) (patch : List (String × Expr))
      (cond : Option Expr)
  /-- `delete t[key]` -/
  | delete (t : String) (key : List (String × Expr))
  deriving Repr

inductive Stmt where
  /-- `x = e` (a local may be rebound). -/
  | assign (x : String) (e : Expr)
  /-- `require c else CODE` -/
  | require (c : Expr) (code : String)
  | ite (c : Expr) (th el : List Stmt)
  | ret (e : Expr)
  /-- A write, optionally binding its result. -/
  | write (bind : Option String) (w : WriteOp)
  deriving Repr

inductive Kind where
  | query | mutation
  deriving Repr, DecidableEq

structure Helper where
  name : String
  params : List String
  body : Expr
  deriving Repr

structure Param where
  name : String
  optional : Bool
  deriving Repr

structure Program where
  name : String
  kind : Kind
  params : List Param
  body : List Stmt
  deriving Repr

end Quarry
