/-! Independent exhaustive three-valued implication kernel.
@ref LLP 3000.036.004#3-sound-proof-boundary — this theorem does not assume a database model or certify a translator.
-/
namespace Quarry.Security
inductive Truth where
  | yes | no | unknown
  deriving DecidableEq, Repr
open Truth
def neg : Truth → Truth
  | yes => no | no => yes | unknown => unknown
def conj : Truth → Truth → Truth
  | no, _ => no | _, no => no | unknown, _ => unknown | _, unknown => unknown | yes, yes => yes
def disj : Truth → Truth → Truth
  | yes, _ => yes | _, yes => yes | unknown, _ => unknown | _, unknown => unknown | no, no => no
inductive Formula where
  | constant : Truth → Formula
  | atom : Nat → Formula
  | not : Formula → Formula
  | and : Formula → Formula → Formula
  | or : Formula → Formula → Formula
  deriving Repr
def eval (v : List Truth) : Formula → Truth
  | .constant t => t
  | .atom n => v[n]?.getD unknown
  | .not p => neg (eval v p)
  | .and p q => conj (eval v p) (eval v q)
  | .or p q => disj (eval v p) (eval v q)
def valuations : Nat → List (List Truth)
  | 0 => [[]]
  | n+1 => (valuations n).flatMap fun v => [yes :: v, no :: v, unknown :: v]
def check (n : Nat) (admission policy : Formula) : Bool :=
  (valuations n).all fun v => eval v admission != yes || eval v policy == yes

theorem complete (v : List Truth) : v ∈ valuations v.length := by
  induction v with
  | nil => simp [valuations]
  | cons x xs ih =>
    simp only [List.length_cons, valuations, List.mem_flatMap]
    refine ⟨xs, ih, ?_⟩
    cases x <;> simp

theorem sound {n : Nat} {a p : Formula} (h : check n a p = true)
    (v : List Truth) (len : v.length = n) (admitted : eval v a = yes) : eval v p = yes := by
  have mem : v ∈ valuations n := by rw [← len]; exact complete v
  have holds := List.all_eq_true.mp h v mem
  simpa [admitted] using holds

theorem unknown_never_admits : unknown ≠ yes := by decide
theorem neg_unknown : neg unknown = unknown := rfl
example : check 1 (.atom 0) (.atom 0) = true := by decide
example : check 1 (.constant yes) (.or (.atom 0) (.not (.atom 0))) = false := by decide
end Quarry.Security
