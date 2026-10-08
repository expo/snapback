/-!
# Three-way comparisons and their laws

A comparison `c : α → α → Ordering` is *lawful* when it decides equality,
is antisymmetric (`c b a` is `c a b` swapped) and `lt` is transitive. From
these the derived `≤` (`c a b ≠ .gt`) is a total order: reflexive,
antisymmetric, transitive and total (`Lawful.le_*` below).

`lex c` lifts a comparison to lists lexicographically, with a proper prefix
ordered first. `lex_lawful` proves the lift preserves the laws; text, ids,
bytes and index keys are all ordered this way.
-/

namespace Quarry

/-- The laws a three-way comparison must satisfy to be a total order. -/
structure Lawful {α : Type} (c : α → α → Ordering) : Prop where
  eq_iff : ∀ a b, c a b = .eq ↔ a = b
  swap : ∀ a b, c b a = (c a b).swap
  lt_trans : ∀ a b d, c a b = .lt → c b d = .lt → c a d = .lt

/-- The `≤` a comparison induces. -/
def Le {α : Type} (c : α → α → Ordering) (a b : α) : Prop := c a b ≠ .gt

namespace Lawful
variable {α : Type} {c : α → α → Ordering}

theorem refl (h : Lawful c) (a : α) : c a a = .eq := (h.eq_iff a a).2 rfl

theorem le_refl (h : Lawful c) (a : α) : Le c a a := by
  simp [Le, h.refl a]

theorem le_antisymm (h : Lawful c) {a b : α} (hab : Le c a b) (hba : Le c b a) : a = b := by
  unfold Le at *
  rw [h.swap a b] at hba
  cases hc : c a b with
  | lt => rw [hc] at hba; exact absurd rfl hba
  | eq => exact (h.eq_iff a b).1 hc
  | gt => exact absurd hc hab

theorem le_trans (h : Lawful c) {a b d : α} (hab : Le c a b) (hbd : Le c b d) : Le c a d := by
  unfold Le at *
  cases h1 : c a b with
  | gt => exact absurd h1 hab
  | eq =>
    have := (h.eq_iff a b).1 h1; subst this; exact hbd
  | lt =>
    cases h2 : c b d with
    | gt => exact absurd h2 hbd
    | eq =>
      have := (h.eq_iff b d).1 h2; subst this; rw [h1]; simp
    | lt => rw [h.lt_trans a b d h1 h2]; simp

theorem le_total (h : Lawful c) (a b : α) : Le c a b ∨ Le c b a := by
  unfold Le
  rw [h.swap a b]
  cases c a b <;> simp

theorem gt_iff_lt (h : Lawful c) (a b : α) : c a b = .gt ↔ c b a = .lt := by
  rw [h.swap a b]; cases c a b <;> simp

end Lawful

/-! ## Numbers -/

def cmpInt (a b : Int) : Ordering := if a < b then .lt else if a = b then .eq else .gt
def cmpNat (a b : Nat) : Ordering := if a < b then .lt else if a = b then .eq else .gt

theorem cmpInt_lawful : Lawful cmpInt where
  eq_iff a b := by
    unfold cmpInt; constructor
    · intro h; split at h <;> (try split at h) <;> simp_all
    · intro h; subst h; simp
  swap a b := by
    unfold cmpInt
    by_cases h1 : a < b
    · have : ¬ b < a := by omega
      have : ¬ b = a := by omega
      simp [*]
    · by_cases h2 : a = b
      · subst h2; simp
      · have : b < a := by omega
        simp [*]
  lt_trans a b d := by
    unfold cmpInt; intro h1 h2
    split at h1 <;> (try split at h1) <;> simp at h1
    split at h2 <;> (try split at h2) <;> simp at h2
    have : a < d := by omega
    simp [this]

theorem cmpNat_lawful : Lawful cmpNat where
  eq_iff a b := by
    unfold cmpNat; constructor
    · intro h; split at h <;> (try split at h) <;> simp_all
    · intro h; subst h; simp
  swap a b := by
    unfold cmpNat
    by_cases h1 : a < b
    · have : ¬ b < a := by omega
      have : ¬ b = a := by omega
      simp [*]
    · by_cases h2 : a = b
      · subst h2; simp
      · have : b < a := by omega
        simp [*]
  lt_trans a b d := by
    unfold cmpNat; intro h1 h2
    split at h1 <;> (try split at h1) <;> simp at h1
    split at h2 <;> (try split at h2) <;> simp at h2
    have : a < d := by omega
    simp [this]

theorem cmpInt_succ (x y : Nat) : cmpInt ((x : Int) + 1) ((y : Int) + 1) = cmpNat x y := by
  unfold cmpInt cmpNat
  by_cases h1 : x < y
  · have : (x : Int) + 1 < (y : Int) + 1 := by omega
    simp [h1, this]
  · by_cases h2 : x = y
    · subst h2; simp
    · have : ¬ (x : Int) + 1 < (y : Int) + 1 := by omega
      have : ¬ (x : Int) + 1 = (y : Int) + 1 := by omega
      simp [*]

/-! ## `Ordering.then` -/

theorem then_eq_left (o : Ordering) : Ordering.eq.then o = o := rfl
theorem then_ne_left {o : Ordering} (p : Ordering) (h : o ≠ .eq) : o.then p = o := by
  cases o <;> simp_all [Ordering.then]
theorem then_eq_right (o : Ordering) : o.then .eq = o := by cases o <;> rfl
theorem then_assoc (a b d : Ordering) : (a.then b).then d = a.then (b.then d) := by
  cases a <;> rfl
theorem then_swap (a b : Ordering) : (a.then b).swap = a.swap.then b.swap := by
  cases a <;> rfl

/-! ## Lexicographic order -/

/-- Lexicographic comparison; a proper prefix is smaller. -/
def lex {α : Type} (c : α → α → Ordering) : List α → List α → Ordering
  | [], [] => .eq
  | [], _ :: _ => .lt
  | _ :: _, [] => .gt
  | a :: as, b :: bs => (c a b).then (lex c as bs)

section
variable {α : Type} {c : α → α → Ordering}

@[simp] theorem lex_nil_nil : lex c [] [] = .eq := rfl
@[simp] theorem lex_nil_cons (b : α) (bs) : lex c [] (b :: bs) = .lt := rfl
@[simp] theorem lex_cons_nil (a : α) (as) : lex c (a :: as) [] = .gt := rfl
@[simp] theorem lex_cons_cons (a b : α) (as bs) :
    lex c (a :: as) (b :: bs) = (c a b).then (lex c as bs) := rfl

theorem lex_lawful (h : Lawful c) : Lawful (lex c) where
  eq_iff := by
    intro as
    induction as with
    | nil => intro bs; cases bs <;> simp
    | cons a as ih =>
      intro bs
      cases bs with
      | nil => simp
      | cons b bs =>
        simp only [lex_cons_cons, List.cons.injEq]
        cases hc : c a b with
        | eq => simp [ih, (h.eq_iff a b).1 hc]
        | lt =>
          have : a ≠ b := fun e => by subst e; rw [h.refl] at hc; cases hc
          simp [Ordering.then, this]
        | gt =>
          have : a ≠ b := fun e => by subst e; rw [h.refl] at hc; cases hc
          simp [Ordering.then, this]
  swap := by
    intro as
    induction as with
    | nil => intro bs; cases bs <;> rfl
    | cons a as ih =>
      intro bs
      cases bs with
      | nil => rfl
      | cons b bs =>
        simp only [lex_cons_cons, then_swap, ← ih, ← h.swap]
  lt_trans := by
    intro as
    induction as with
    | nil =>
      intro bs ds h1 h2
      cases bs <;> cases ds <;> simp_all
    | cons a as ih =>
      intro bs ds h1 h2
      cases bs with
      | nil => simp at h1
      | cons b bs =>
        cases ds with
        | nil => simp at h2
        | cons d ds =>
          simp only [lex_cons_cons] at *
          cases hab : c a b with
          | gt => rw [hab] at h1; simp [Ordering.then] at h1
          | eq =>
            have := (h.eq_iff a b).1 hab; subst this
            rw [hab, then_eq_left] at h1
            cases hbd : c a d with
            | gt => rw [hbd] at h2; simp [Ordering.then] at h2
            | eq =>
              rw [hbd, then_eq_left] at h2
              exact ih bs ds h1 h2
            | lt => simp [Ordering.then]
          | lt =>
            cases hbd : c b d with
            | gt => rw [hbd] at h2; simp [Ordering.then] at h2
            | eq =>
              have := (h.eq_iff b d).1 hbd; subst this
              rw [hab]; simp [Ordering.then]
            | lt =>
              rw [h.lt_trans a b d hab hbd]; simp [Ordering.then]

/-- Two lists that compare equal have equal last elements (used for the id tiebreak). -/
theorem lex_eq_iff (h : Lawful c) (as bs : List α) : lex c as bs = .eq ↔ as = bs :=
  (lex_lawful h).eq_iff as bs

end

end Quarry
