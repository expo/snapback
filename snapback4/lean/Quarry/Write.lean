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
  `E_RULE` for a readable one whose delete rule refuses.

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

def doInsertImage (sch : Schema) (s : Store) (v : List Nat) (t : String) (td : TableDecl)
    (img : Row) (ifAbsent : Bool) (deny clashHidden : Stop) :
    Except Stop (Value × Store) := do
  if !(td.insert.eval s v { self := some img }) then throw deny
  match findClash (s t) (["id"] :: td.uniques) img none with
  | some (i, r) =>
    if !(readable sch s v t r) then throw clashHidden
    else if ifAbsent then pure (.null, s)
    else throw (clashCode td true i)
  | none =>
    let s' := s.insertRow t img
    pure (resultOf sch s' v t img, s')

def doUpdateRow (sch : Schema) (s : Store) (v : List Nat) (t : String) (td : TableDecl)
    (old : Row) (patch : List (String × Scalar)) (cond : Option (Row → Except Stop Bool)) :
    Except Stop (Value × Store) := do
  let rd := readable sch s v t old
  let nw ← patchImage td old patch
  if !(td.update.eval s v { old := some old, next := some nw }) then
    throw (if rd then eRule else notFound)
  match cond with
  | some f =>
    if !rd then throw notFound
    if !(← f old) then throw (.refuse "E_CONFLICT")
  | none => pure ()
  match findClash (s t) td.uniques nw (some old.id) with
  | some (i, r) =>
    throw (if !rd then notFound else if !(readable sch s v t r) then eRule else clashCode td false i)
  | none =>
    let s' := s.replaceRow t old nw
    pure (resultOf sch s' v t nw, s')

/-- Apply one write to the store. -/
def applyWrite (cx : Ctx) (s : Store) : RWrite → Except Stop (Value × Store)
  | .insert t fields ifAbsent => do
    let some td := cx.schema.table? t | throw eInput
    let fs ← scalarsE fields
    let rid ← match fs.lookup "id" with
      | some (.id x) => pure x
      | _ => throw eInput
    let img ← buildImage td rid fs eInput
    doInsertImage cx.schema s cx.viewer t td img ifAbsent eRule eRule
  | .update t key patch cond => do
    let some td := cx.schema.table? t | throw eInput
    let ks ← scalarsE key
    let ps ← scalarsE patch
    let some old := findRow (s t) ks | throw notFound
    doUpdateRow cx.schema s cx.viewer t td old ps cond
  | .upsert t key patch => do
    let some td := cx.schema.table? t | throw eInput
    let ks ← scalarsE key
    let ps ← scalarsE patch
    match findRow (s t) ks with
    | some old => doUpdateRow cx.schema s cx.viewer t td old ps none
    | none =>
      let rid ← match ks.lookup "id" with
        | some (.id x) => pure x
        | _ => match ps.lookup "id" with
          | some (.id x) => pure x
          | _ => throw eInput
      let img ← buildImage td rid (ks ++ ps) notFound
      doInsertImage cx.schema s cx.viewer t td img false notFound notFound
  | .delete t key => do
    let some td := cx.schema.table? t | throw eInput
    let ks ← scalarsE key
    let some old := findRow (s t) ks | throw notFound
    if !(td.delete.eval s cx.viewer { self := some old }) then
      throw (if readable cx.schema s cx.viewer t old then eRule else notFound)
    pure (.null, s.removeRow t old)

end Quarry
