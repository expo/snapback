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

/-- Evaluate every component of a key probe. -/
def probeTerms (v : List Nat) (im : Imgs) (key : List (String × Term)) :
    Option (List (String × Scalar)) :=
  key.mapM fun p => Option.map (fun x => (p.1, x)) (p.2.eval v im)

/-- Null returns no row only when it occurs in the selected unique point key.
Nullable equalities outside that key are residual predicates and may match
null. An empty `point` keeps the older all-components convention for the
hand-written core model. -/
def probeKey (v : List Nat) (im : Imgs) (point : List String)
    (key : List (String × Term)) :
    Option (List (String × Scalar)) :=
  match probeTerms v im key with
  | none => none
  | some ks =>
    let selected := if point.isEmpty then ks else ks.filter fun p => point.contains p.1
    if selected.length == (if point.isEmpty then ks.length else point.eraseDups.length)
        && !(selected.any fun p => p.2 == .null)
    then some ks else none

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
  | .probe t point key => match probeKey v im point key with
    | some ks => (s t).any (keyMatch ks)
    | none => false
  | .and a b => a.eval s v im && b.eval s v im
  | .or a b => a.eval s v im || b.eval s v im
  | .not a => !(a.eval s v im)

/-- The tables a rule probes. -/
def Rule.probes : Rule → List String
  | .probe t _ _ => [t]
  | .and a b | .or a b => a.probes ++ b.probes
  | .not a => a.probes
  | _ => []

/-- The row columns (of the `self` image) a rule reads. -/
def Term.selfCols : Term → List String
  | .col .self c => [c]
  | _ => []

/-- Every term a rule compares or probes with, left to right. -/
def Rule.terms : Rule → List Term
  | .eq a b | .ne a b => [a, b]
  | .probe _ _ key => key.map (·.2)
  | .and a b | .or a b => a.terms ++ b.terms
  | .not a => a.terms
  | .allow | .deny => []

def Rule.selfCols (r : Rule) : List String := r.terms.flatMap Term.selfCols

/-- The rule with each term replaced by `f` of it. -/
def Rule.mapTerms (f : Term → Term) : Rule → Rule
  | .eq a b => .eq (f a) (f b)
  | .ne a b => .ne (f a) (f b)
  | .probe t point key => .probe t point (key.map fun p => (p.1, f p.2))
  | .and a b => .and (a.mapTerms f) (b.mapTerms f)
  | .or a b => .or (a.mapTerms f) (b.mapTerms f)
  | .not a => .not (a.mapTerms f)
  | .allow => .allow
  | .deny => .deny

/-- The disjuncts of a rule's top-level `or` (a rule that is not an `or` is
its own single disjunct). -/
def Rule.disjuncts : Rule → List Rule
  | .or a b => a.disjuncts ++ b.disjuncts
  | .allow => [.allow]
  | .deny => [.deny]
  | .eq a b => [.eq a b]
  | .ne a b => [.ne a b]
  | .probe t point key => [.probe t point key]
  | .and a b => [.and a b]
  | .not a => [.not a]

/-- A rule without `not`. Over fewer rows a positive rule can only lose
probe witnesses, so one true over the caller's view is true over the store
(`Rule.eval_mono`); the engine likewise never takes a negated probe as a
grant (LLP 3000.036 §12.1). -/
def Rule.positive : Rule → Bool
  | .not _ => false
  | .and a b | .or a b => a.positive && b.positive
  | .allow | .deny | .eq .. | .ne .. | .probe .. => true

/-- Fold only rule truth values that remain known after pin substitution.
Boolean literal comparisons match the engine's required-boolean pin proof;
in particular, a nullable `null` pin is not treated as boolean `false`.
Probes are never folded, so normalization cannot turn a negated probe into a
page grant (LLP 3000.036 §14). -/
-- @ref LLP 3000.036.001#9 — the formal classifier and executable model share prefix-normalized guards.
def Rule.normalize : Rule → Rule
  | .eq (.lit (.bool a)) (.lit (.bool b)) => if a == b then .allow else .deny
  | .eq (.lit a) (.lit b) => if a == b then .allow else .eq (.lit a) (.lit b)
  | .eq .viewer .viewer => .allow
  | .eq a b => .eq a b
  | .ne (.lit (.bool a)) (.lit (.bool b)) => if a != b then .allow else .deny
  | .ne (.lit a) (.lit b) => if a != b then .ne (.lit a) (.lit b) else .deny
  | .ne .viewer .viewer => .deny
  | .ne a b => .ne a b
  | .and a b =>
      match a.normalize, b.normalize with
      | .allow, b' => b'
      | a', .allow => a'
      | .deny, _ | _, .deny => .deny
      | a', b' => .and a' b'
  | .or a b =>
      match a.normalize, b.normalize with
      | .allow, _ | _, .allow => .allow
      | .deny, b' => b'
      | a', .deny => a'
      | a', b' => .or a' b'
  | .not a => match a.normalize with
      | .allow => .deny
      | .deny => .allow
      | a' => .not a'
  | .allow => .allow
  | .deny => .deny
  | .probe t point key => .probe t point key

/-- A term with each pinned row column replaced by its pinned value. -/
def Term.pin (ps : List (String × Scalar)) : Term → Term
  | .col .self c => match ps.lookup c with
    | some x => .lit x
    | none => .col .self c
  | t => t

/-- A rule with each pinned row column replaced by its pinned value: the
verdict the rule gives every row the pins select (`Rule.eval_pin`). -/
def Rule.pin (ps : List (String × Scalar)) (r : Rule) : Rule := r.mapTerms (Term.pin ps)

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
