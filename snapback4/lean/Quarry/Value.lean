import Quarry.Order

/-!
# The value model

`Scalar` is what a column holds and what an index key is made of: null,
bool, an i53 integer (`int`, `time`, `money`, `decimal` are all integers),
text (as Unicode code points, so order is by code point), a nominal id
(`id`, a table reference or a principal; `viewer` is one) and bytes.

`Value` adds the composite values expressions build: arrays and rows.

Sources: the language card (`snapback4 guide language`), the types card
(ints within ±(2^53 − 1), no floats), LLP 3000.035 §2 (one total order,
text by code point), LLP 3000.003 (the reproduced UTF-16 ordering bug) and
the closed ticket `20260913-snapback4-rule-equality-id-string-divergence`
(an id never equals a text with the same characters). Points the documents
leave open are in `OPEN.md` (V1–V4).
-/

namespace Quarry

/-- The largest magnitude an integer may have: 2^53 − 1. -/
def i53Max : Int := 9007199254740991

def inI53 (n : Int) : Bool := -i53Max ≤ n && n ≤ i53Max

inductive Scalar where
  | null
  | bool (b : Bool)
  | int (n : Int)
  | text (cps : List Nat)
  | id (cps : List Nat)
  | bytes (bs : List Nat)
  deriving DecidableEq, Repr, Inhabited

namespace Scalar

/-- Cross-kind order (OPEN V2): null, bool, int, text, id, bytes. -/
def rank : Scalar → Nat
  | null => 0 | bool _ => 1 | int _ => 2 | text _ => 3 | id _ => 4 | bytes _ => 5

def boolNat (b : Bool) : Nat := if b then 1 else 0

/-- The one total order over scalars: by kind, then false < true, integers
numerically, text and ids by code point, bytes lexicographically (a prefix
first). -/
def cmp : Scalar → Scalar → Ordering
  | null, null => .eq
  | bool a, bool b => cmpNat (boolNat a) (boolNat b)
  | int a, int b => cmpInt a b
  | text a, text b => lex cmpNat a b
  | id a, id b => lex cmpNat a b
  | bytes a, bytes b => lex cmpNat a b
  | a, b => cmpNat a.rank b.rank

/-! ## A self-delimiting order-preserving encoding

Index keys are "one order-preserving byte encoding of the value model's
order" (LLP 3000 §7). The model does not copy the engine's encoding
(`key.rs` is off limits by the independence rule); it states the property
with its own encoding into integer symbols and proves it. A byte-level
radix refinement of the symbols is not modelled. -/

def encText (xs : List Nat) : List Int := xs.map (fun x : Nat => (x : Int) + 1) ++ [0]

def enc : Scalar → List Int
  | null => [0]
  | bool b => [1, (boolNat b : Int)]
  | int n => [2, n]
  | text s => 3 :: encText s
  | id s => 4 :: encText s
  | bytes s => 5 :: encText s

end Scalar

theorem encText_append (xs ys : List Nat) (r1 r2 : List Int) :
    lex cmpInt (Scalar.encText xs ++ r1) (Scalar.encText ys ++ r2)
      = (lex cmpNat xs ys).then (lex cmpInt r1 r2) := by
  induction xs generalizing ys with
  | nil =>
    cases ys with
    | nil => simp [Scalar.encText, cmpInt]
    | cons y ys =>
      have h1 : (0 : Int) < (y : Int) + 1 := by omega
      simp [Scalar.encText, Ordering.then, cmpInt, h1]
  | cons x xs ih =>
    cases ys with
    | nil =>
      have h1 : ¬ ((x : Int) + 1 < 0) := by omega
      have h2 : ¬ ((x : Int) + 1 = 0) := by omega
      simp [Scalar.encText, cmpInt, h1, h2]
    | cons y ys =>
      have := ih ys
      simp only [Scalar.encText, List.map_cons, List.cons_append, List.append_assoc,
        lex_cons_cons] at this ⊢
      rw [this, cmpInt_succ, then_assoc]

/-- The encoding is self-delimiting and order-preserving: comparing two
encodings followed by anything compares the scalars first. -/
theorem enc_append (a b : Scalar) (r1 r2 : List Int) :
    lex cmpInt (a.enc ++ r1) (b.enc ++ r2) = (a.cmp b).then (lex cmpInt r1 r2) := by
  cases a <;> cases b <;>
    simp [Scalar.enc, Scalar.cmp, Scalar.rank, cmpInt, cmpNat, Ordering.then,
      encText_append, -lex_cons_cons, lex] <;>
    (try simp [Scalar.boolNat]) <;>
    (try (split <;> simp_all)) <;>
    (try (rename_i a b; cases a <;> cases b <;> rfl))

theorem enc_agrees (a b : Scalar) : lex cmpInt a.enc b.enc = a.cmp b := by
  have := enc_append a b [] []
  simp only [List.append_nil, lex_nil_nil, then_eq_right] at this
  exact this

theorem encText_inj {xs ys : List Nat} (h : Scalar.encText xs = Scalar.encText ys) : xs = ys := by
  have h2 := (lex_lawful cmpInt_lawful).eq_iff (Scalar.encText xs) (Scalar.encText ys)
  have h3 := encText_append xs ys [] []
  simp only [List.append_nil, lex_nil_nil, then_eq_right] at h3
  rw [h3] at h2
  exact ((lex_lawful cmpNat_lawful).eq_iff xs ys).1 (h2.2 h)

theorem enc_inj {a b : Scalar} (h : a.enc = b.enc) : a = b := by
  cases a <;> cases b <;> simp [Scalar.enc] at h <;> (try simp [Scalar.boolNat] at h) <;>
    (try (subst_vars; rfl)) <;> (try (simp [encText_inj h])) <;>
    (try (rename_i a b; cases a <;> cases b <;> simp_all))

/-- **The value order is a total order** (on every scalar, the values an index
key is made of): it decides equality, swaps, and `lt` is transitive; so the
induced `≤` is reflexive, antisymmetric, transitive and total
(`Lawful.le_refl`, `le_antisymm`, `le_trans`, `le_total`). -/
theorem Scalar.cmp_lawful : Lawful Scalar.cmp where
  eq_iff a b := by
    rw [← enc_agrees, (lex_lawful cmpInt_lawful).eq_iff]
    exact ⟨enc_inj, fun h => h ▸ rfl⟩
  swap a b := by
    rw [← enc_agrees, ← enc_agrees]; exact (lex_lawful cmpInt_lawful).swap _ _
  lt_trans a b d h1 h2 := by
    rw [← enc_agrees] at *; exact (lex_lawful cmpInt_lawful).lt_trans _ _ _ h1 h2

theorem Scalar.le_refl (a : Scalar) : Le Scalar.cmp a a := Scalar.cmp_lawful.le_refl a
theorem Scalar.le_antisymm {a b : Scalar} : Le Scalar.cmp a b → Le Scalar.cmp b a → a = b :=
  Scalar.cmp_lawful.le_antisymm
theorem Scalar.le_trans {a b d : Scalar} : Le Scalar.cmp a b → Le Scalar.cmp b d → Le Scalar.cmp a d :=
  Scalar.cmp_lawful.le_trans
theorem Scalar.le_total (a b : Scalar) : Le Scalar.cmp a b ∨ Le Scalar.cmp b a :=
  Scalar.cmp_lawful.le_total a b

/-! ## Keys -/

/-- An index key: the indexed column values in index order, ending in `id`. -/
abbrev Key := List Scalar

def keyCmp : Key → Key → Ordering := lex Scalar.cmp

theorem keyCmp_lawful : Lawful keyCmp := lex_lawful Scalar.cmp_lawful

def encKey (k : Key) : List Int := k.flatMap Scalar.enc

theorem enc_ne_nil (a : Scalar) : a.enc ≠ [] := by cases a <;> simp [Scalar.enc]

/-- **The value order agrees with key order on keys**: comparing the encoded
keys symbol by symbol is exactly the lexicographic value order on the key's
components. -/
theorem encKey_agrees (k1 k2 : Key) : lex cmpInt (encKey k1) (encKey k2) = keyCmp k1 k2 := by
  induction k1 generalizing k2 with
  | nil =>
    cases k2 with
    | nil => rfl
    | cons b bs =>
      simp only [encKey, List.flatMap_nil, List.flatMap_cons, keyCmp, lex_nil_cons]
      cases h : b.enc with
      | nil => exact absurd h (enc_ne_nil b)
      | cons _ _ => simp
  | cons a as ih =>
    cases k2 with
    | nil =>
      simp only [encKey, List.flatMap_nil, List.flatMap_cons, keyCmp, lex_cons_nil]
      cases h : a.enc with
      | nil => exact absurd h (enc_ne_nil a)
      | cons _ _ => simp
    | cons b bs =>
      have := ih bs
      simp only [encKey, List.flatMap_cons, keyCmp, lex_cons_cons] at this ⊢
      rw [enc_append, this]

/-! ## Values -/

inductive Value where
  | s (x : Scalar)
  | arr (xs : List Value)
  | row (fs : List (String × Value))
  deriving Repr, Inhabited

mutual
/-- Structural equality of values (`=` in Quarry). Kinds never coincide:
an id is not a text. -/
def Value.beq : Value → Value → Bool
  | .s a, .s b => decide (a = b)
  | .arr xs, .arr ys => Value.beqList xs ys
  | .row fs, .row gs => Value.beqFields fs gs
  | _, _ => false
def Value.beqList : List Value → List Value → Bool
  | [], [] => true
  | x :: xs, y :: ys => Value.beq x y && Value.beqList xs ys
  | _, _ => false
def Value.beqFields : List (String × Value) → List (String × Value) → Bool
  | [], [] => true
  | (k, x) :: xs, (j, y) :: ys => decide (k = j) && Value.beq x y && Value.beqFields xs ys
  | _, _ => false
end

instance : BEq Value := ⟨Value.beq⟩

namespace Value
def null : Value := .s .null
def ofBool (b : Bool) : Value := .s (.bool b)
def ofInt (n : Int) : Value := .s (.int n)
def ofText (t : String) : Value := .s (.text (t.toList.map Char.toNat))
def ofId (t : String) : Value := .s (.id (t.toList.map Char.toNat))
def isNull : Value → Bool
  | .s .null => true
  | _ => false
def field? : Value → String → Option Value
  | .row fs, c => fs.lookup c
  | _, _ => none
end Value

def cps (t : String) : List Nat := t.toList.map Char.toNat

/-- **Equality: an id never equals a text with the same characters.** -/
theorem id_ne_text (x : List Nat) : (Value.s (.id x) == Value.s (.text x)) = false := by
  simp [BEq.beq, Value.beq]

/-- U+E000 orders before U+10000 (by code point; UTF-16 units would reverse
them, the LLP 3000.003 bug). -/
theorem codepoint_order : Scalar.cmp (.text [0xE000]) (.text [0x10000]) = .lt := by decide

end Quarry
