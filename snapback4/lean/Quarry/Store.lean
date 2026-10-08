import Quarry.Syntax

/-!
# Rows, stores, rules and visibility

A store maps each table name to its rows. Rules are evaluated against the
whole store: an `exists t[..]` probe is an exact-key existence test that does
not consult `t`'s own read rule (OPEN R1). A row is *visible* to a viewer
when its table's read rule holds for it; every read the evaluator performs
goes through `visibleRows`, so the read semantics in `Eval.lean` never sees
a hidden row (`Disclosure.lean`).
-/

namespace Quarry

structure Row where
  id : List Nat
  cols : List (String × Scalar)
  deriving Repr, DecidableEq, Inhabited

def Row.get (r : Row) (c : String) : Scalar :=
  if c = "id" then .id r.id else (r.cols.lookup c).getD .null

def Row.toValue (r : Row) : Value :=
  .row (("id", .s (.id r.id)) :: r.cols.map fun p => (p.1, .s p.2))

/-- The store: the rows of each table. -/
abbrev Store := String → List Row

def Store.empty : Store := fun _ => []

def Store.set (s : Store) (t : String) (rs : List Row) : Store :=
  fun t' => if t' = t then rs else s t'

def Store.insertRow (s : Store) (t : String) (r : Row) : Store := s.set t (s t ++ [r])
def Store.replaceRow (s : Store) (t : String) (old nw : Row) : Store :=
  s.set t ((s t).map fun r => if r.id = old.id then nw else r)
def Store.removeRow (s : Store) (t : String) (old : Row) : Store :=
  s.set t ((s t).filter fun r => r.id ≠ old.id)

/-- The images a rule may name. -/
structure Imgs where
  self : Option Row := none
  old : Option Row := none
  next : Option Row := none

def Imgs.get (im : Imgs) : Img → Option Row
  | .self => im.self
  | .old => im.old
  | .next => im.next

def Term.eval (v : List Nat) (im : Imgs) : Term → Option Scalar
  | .col i c => (im.get i).map (·.get c)
  | .viewer => some (.id v)
  | .lit x => some x

/-- A key probe's components; a null or undefined component never matches
(indexes card: "Null for a unique key argument returns no row"). -/
def probeKey (v : List Nat) (im : Imgs) (key : List (String × Term)) :
    Option (List (String × Scalar)) :=
  key.mapM fun p => match p.2.eval v im with
    | some .null => none
    | some x => some (p.1, x)
    | none => none

def keyMatch (ks : List (String × Scalar)) (r : Row) : Bool :=
  ks.all fun p => decide (r.get p.1 = p.2)

/-- Rule evaluation against the whole store `s`, for viewer `v`. -/
def Rule.eval (s : Store) (v : List Nat) (im : Imgs) : Rule → Bool
  | .allow => true
  | .deny => false
  | .eq a b => match a.eval v im, b.eval v im with
    | some x, some y => decide (x = y)
    | _, _ => false
  | .ne a b => match a.eval v im, b.eval v im with
    | some x, some y => decide (x ≠ y)
    | _, _ => false
  | .probe t key => match probeKey v im key with
    | some ks => (s t).any (keyMatch ks)
    | none => false
  | .and a b => a.eval s v im && b.eval s v im
  | .or a b => a.eval s v im || b.eval s v im
  | .not a => !(a.eval s v im)

/-- The tables a rule probes. -/
def Rule.probes : Rule → List String
  | .probe t _ => [t]
  | .and a b | .or a b => a.probes ++ b.probes
  | .not a => a.probes
  | _ => []

/-- The row columns (of the `self` image) a rule reads. -/
def Term.selfCols : Term → List String
  | .col .self c => [c]
  | _ => []

def Rule.selfCols : Rule → List String
  | .eq a b | .ne a b => a.selfCols ++ b.selfCols
  | .probe _ key => key.flatMap fun p => p.2.selfCols
  | .and a b | .or a b => a.selfCols ++ b.selfCols
  | .not a => a.selfCols
  | _ => []

def readable (sch : Schema) (s : Store) (v : List Nat) (t : String) (r : Row) : Bool :=
  match sch.table? t with
  | some td => td.read.eval s v { self := some r }
  | none => false

/-- The rows of `t` the viewer may read. Every read goes through this. -/
def visibleRows (sch : Schema) (s : Store) (v : List Nat) (t : String) : List Row :=
  (s t).filter (readable sch s v t)

/-- What a read can observe: the visible rows of each table. -/
abbrev View := String → List Row

end Quarry
