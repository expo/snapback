import Quarry.Eval

/-!
# Writes: rule checks and refusals

From the rules card, `why E_RULE`, `why NOT_FOUND`, `why E_CONFLICT` and the
writes card:

* **insert** — the insert rule judges the new image (`E_RULE`); a clash on
  `id` or a declared unique key with a hidden row is `E_RULE`; with a visible
  row, `if absent` returns null and an ordinary insert refuses `E_CONSTRAINT`
  or the key's `else CODE`.
* **update** — "readable" means the read rule admits the old row before the
  write; the update rule judges old and next. Denial is `E_RULE` on a readable
  target and `NOT_FOUND` on an unreadable one; a missing target is
  `NOT_FOUND`; an `if` condition on an unreadable target is `NOT_FOUND`, and a
  false one on a readable target `E_CONFLICT`; a secondary unique clash is
  `NOT_FOUND` (unreadable target), `E_RULE` (hidden colliding row) or
  `E_CONSTRAINT`. An admitted update may change a hidden row; the result is
  the row if it is readable afterwards, else null.
* **upsert** — patches an existing target as an update; inserts an absent
  one, where an incomplete image or insert-rule denial is `NOT_FOUND`.
* **delete** — `NOT_FOUND` for a missing or unreadable refused target,
  `E_RULE` for a readable one whose delete rule refuses. A row that
  `restrict`, `cascade` or `set null` references name also needs read
  authority (`NOT_FOUND`); then its delete closes over `cascade` references,
  refuses `E_REFERENCED` while a `restrict` reference names a closure row
  from outside the closure, clears `set null` references outside it, and
  removes the closure (LLP 3000.038 §3).

The order in which checks run when several fail is not documented; the
model's order is OPEN W1–W6.
-/

namespace Quarry

def notFound : Stop := .refuse "NOT_FOUND"
def eRule : Stop := .refuse "E_RULE"
def eInput : Stop := .refuse "E_INPUT"

def toScalarE : Value → Except Stop Scalar
  | .s x => pure x
  | _ => throw eInput

def scalarsE (fs : List (String × Value)) : Except Stop (List (String × Scalar)) :=
  fs.mapM fun p => do return (p.1, ← toScalarE p.2)

/-- A column value fits its declaration: only a nullable column takes null. -/
def fits (c : ColDecl) (x : Scalar) : Bool := c.nullable || x != .null

/-- The new image of an insert. An absent nullable column is null; an absent
required column refuses with `missing`. Unknown fields refuse `E_INPUT`. -/
def buildImage (td : TableDecl) (rid : List Nat) (fields : List (String × Scalar))
    (missing : Stop) : Except Stop Row := do
  if fields.any fun p => p.1 != "id" && !(td.cols.any (·.name == p.1)) then throw eInput
  let cols ← td.cols.mapM fun c => match fields.lookup c.name with
    | some x => if fits c x then pure (c.name, x) else throw eInput
    | none => if c.nullable then pure (c.name, Scalar.null) else throw missing
  return { id := rid, cols }

/-- The next image of an update: the patch replaces named columns. -/
def patchImage (td : TableDecl) (old : Row) (patch : List (String × Scalar)) : Except Stop Row := do
  if patch.any fun p => !(td.cols.any (·.name == p.1)) then throw eInput
  let cols ← old.cols.mapM fun p => match patch.lookup p.1 with
    | some x =>
      match td.cols.find? (·.name == p.1) with
      | some c => if fits c x then pure (p.1, x) else throw eInput
      | none => throw eInput
    | none => pure p
  return { old with cols }

def keyOf (cols : List String) (r : Row) : List (String × Scalar) := cols.map fun c => (c, r.get c)

/-- The first unique key (in order) on which another row (not `except`)
collides with `img`. Keys with a null component never collide (a nullable
unique key permits tied nulls; indexes card). -/
def findClash (rows : List Row) (keys : List (List String)) (img : Row) (except : Option (List Nat)) :
    Option (Nat × Row) :=
  let rec go (i : Nat) : List (List String) → Option (Nat × Row)
    | [] => none
    | k :: ks =>
      let kv := keyOf k img
      if kv.any (·.2 == .null) then go (i + 1) ks
      else match rows.find? (fun r => keyMatch kv r && except != some r.id) with
        | some r => some (i, r)
        | none => go (i + 1) ks
  go 0 keys

/-- The refusal for a visible clash on unique key `i` of `["id"] ++ uniques`
(`withId`) or of `uniques`. -/
def clashCode (td : TableDecl) (withId : Bool) (i : Nat) : Stop :=
  let j := if withId then i - 1 else i
  if withId && i = 0 then .refuse "E_CONSTRAINT"
  else match td.uniqueCodes[j]? with
    | some (some code) => .refuse code
    | _ => .refuse "E_CONSTRAINT"

def findRow (rows : List Row) (ks : List (String × Scalar)) : Option Row :=
  if ks.any (·.2 == .null) then none else rows.find? (keyMatch ks)

/-- The result of a write: the row if the viewer can read it afterwards,
else null (`why E_CONFLICT`: results are read-rule gets; OPEN W4 for insert). -/
def resultOf (sch : Schema) (s : Store) (v : List Nat) (t : String) (r : Row) : Value :=
  if readable sch s v t r then r.toValue else .null

/-- `guardE b e` continues when `b` holds and refuses `e` otherwise. -/
def guardE (b : Bool) (e : Stop) : Except Stop Unit := if b then .ok () else .error e

def doInsertImage (sch : Schema) (s : Store) (v : List Nat) (t : String) (td : TableDecl)
    (img : Row) (ifAbsent : Bool) (deny clashHidden : Stop) :
    Except Stop (Value × Store) := do
  guardE (td.insert.eval s v { self := some img }) deny
  match findClash (s t) (["id"] :: td.uniques) img none with
  | some (i, r) => do
    guardE (readable sch s v t r) clashHidden
    if ifAbsent then pure (.null, s) else throw (clashCode td true i)
  | none =>
    let s' := s.insertRow t img
    pure (resultOf sch s' v t img, s')

/-- An update's `if` condition: `NOT_FOUND` on an unreadable target,
`E_CONFLICT` when false. -/
def condCheck (rd : Bool) (cond : Option (Row → Except Stop Bool)) (old : Row) : Except Stop Unit :=
  match cond with
  | some f => do
    guardE rd notFound
    let b ← f old
    guardE b (.refuse "E_CONFLICT")
  | none => pure ()

/-- A secondary unique clash of an update's next image with another row. -/
def clashCheck (sch : Schema) (s : Store) (v : List Nat) (t : String) (td : TableDecl)
    (rd : Bool) (old nw : Row) : Except Stop Unit :=
  match findClash (s t) td.uniques nw (some old.id) with
  | some (i, r) =>
    throw (if !rd then notFound else if !(readable sch s v t r) then eRule else clashCode td false i)
  | none => pure ()

def doUpdateRow (sch : Schema) (s : Store) (v : List Nat) (t : String) (td : TableDecl)
    (old : Row) (patch : List (String × Scalar)) (cond : Option (Row → Except Stop Bool)) :
    Except Stop (Value × Store) := do
  let nw ← patchImage td old patch
  guardE (td.update.eval s v { old := some old, next := some nw })
    (if readable sch s v t old then eRule else notFound)
  condCheck (readable sch s v t old) cond old
  clashCheck sch s v t td (readable sch s v t old) old nw
  pure (resultOf sch (s.replaceRow t old nw) v t nw, s.replaceRow t old nw)

/-- The id of an absent upsert's new row: from the key, else the patch. -/
def upsertId (ks ps : List (String × Scalar)) : Except Stop (List Nat) :=
  match ks.lookup "id" with
  | some (.id x) => pure x
  | _ => match ps.lookup "id" with
    | some (.id x) => pure x
    | _ => throw eInput

def insertId (fs : List (String × Scalar)) : Except Stop (List Nat) :=
  match fs.lookup "id" with
  | some (.id x) => pure x
  | _ => throw eInput

/-! ## Referential actions (LLP 3000.038 §3) -/

/-- Every reference that names table `t` and carries an action:
`(child table, column, action)`. -/
def referencing (sch : Schema) (t : String) : List (String × String × OnDelete) :=
  sch.tables.flatMap fun td => td.cols.filterMap fun c =>
    match c.ref, c.onDelete with
    | some p, some a => if p == t then some (td.name, c.name, a) else none
    | _, _ => none

/-- Row `k` names the row with id `i` through column `c`. -/
def names (k : Row) (c : String) (i : List Nat) : Bool := k.get c == .id i

def inClosure (cl : List (String × Row)) (t : String) (r : Row) : Bool :=
  cl.any fun p => p.1 == t && p.2.id == r.id

/-- The rows one step of cascades reaches from `(t, r)`. -/
def cascadeKids (sch : Schema) (s : Store) (t : String) (r : Row) : List (String × Row) :=
  (referencing sch t).flatMap fun (c, col, a) =>
    if a == .cascade then ((s c).filter fun k => names k col r.id).map fun k => (c, k) else []

/-- Breadth-first closure over `cascade` references, each row once; `fuel`
bounds the walk (the store's row count suffices). -/
def closure (sch : Schema) (s : Store) : Nat → List (String × Row) → List (String × Row) → List (String × Row)
  | 0, _, acc => acc
  | _ + 1, [], acc => acc
  | f + 1, (t, r) :: rest, acc =>
    let new := (cascadeKids sch s t r).foldl (fun n p => if inClosure (acc ++ n) p.1 p.2 then n else n ++ [p]) []
    closure sch s f (rest ++ new) (acc ++ new)

/-- Some `restrict` reference names a closure row from outside the closure. -/
def restricted (sch : Schema) (s : Store) (cl : List (String × Row)) : Bool :=
  cl.any fun (t, r) => (referencing sch t).any fun (c, col, a) =>
    a == .restrict && (s c).any fun k => names k col r.id && !inClosure cl c k

def clearCol (r : Row) (c : String) : Row :=
  { r with cols := r.cols.map fun p => if p.1 == c then (p.1, Scalar.null) else p }

/-- Clear every `set null` reference that names a closure row from outside it. -/
def setNulls (sch : Schema) (cl : List (String × Row)) (s : Store) : Store :=
  cl.foldl (fun s (t, r) => (referencing sch t).foldl (fun s (c, col, a) =>
    if a == .setNull then
      ((s c).filter fun k => names k col r.id && !inClosure cl c k).foldl
        (fun s k => s.replaceRow c k (clearCol k col)) s
    else s) s) s

def storeSize (sch : Schema) (s : Store) : Nat := sch.tables.foldl (fun n td => n + (s td.name).length) 0

/-- The store after deleting `old` from `t` with its referential actions, or
`E_REFERENCED`. With no action-carrying reference into `t`, exactly
`removeRow` (LLP 3000.038 §1). -/
def refDelete (sch : Schema) (s : Store) (t : String) (old : Row) : Except Stop Store :=
  let cl := closure sch s (storeSize sch s + 1) [(t, old)] [(t, old)]
  if restricted sch s cl then throw (.refuse "E_REFERENCED")
  else pure (cl.foldl (fun s p => s.removeRow p.1 p.2) (setNulls sch cl s))

/-- Apply one write to the store. -/
def applyWrite (cx : Ctx) (s : Store) : RWrite → Except Stop (Value × Store)
  | .insert t fields ifAbsent =>
    match cx.schema.table? t with
    | none => throw eInput
    | some td => do
      let fs ← scalarsE fields
      let rid ← insertId fs
      let img ← buildImage td rid fs eInput
      doInsertImage cx.schema s cx.viewer t td img ifAbsent eRule eRule
  | .update t key patch cond =>
    match cx.schema.table? t with
    | none => throw eInput
    | some td => do
      let ks ← scalarsE key
      let ps ← scalarsE patch
      match findRow (s t) ks with
      | none => throw notFound
      | some old => doUpdateRow cx.schema s cx.viewer t td old ps cond
  | .upsert t key patch =>
    match cx.schema.table? t with
    | none => throw eInput
    | some td => do
      let ks ← scalarsE key
      let ps ← scalarsE patch
      match findRow (s t) ks with
      | some old => doUpdateRow cx.schema s cx.viewer t td old ps none
      | none => do
        let rid ← upsertId ks ps
        let img ← buildImage td rid (ks ++ ps) notFound
        doInsertImage cx.schema s cx.viewer t td img false notFound notFound
  | .delete t key =>
    match cx.schema.table? t with
    | none => throw eInput
    | some td => do
      let ks ← scalarsE key
      match findRow (s t) ks with
      | none => throw notFound
      | some old => do
        guardE (td.delete.eval s cx.viewer { self := some old })
          (if readable cx.schema s cx.viewer t old then eRule else notFound)
        guardE ((referencing cx.schema t).isEmpty || readable cx.schema s cx.viewer t old) notFound
        pure (.null, ← refDelete cx.schema s t old)

end Quarry
