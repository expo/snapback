/-!
# Monotonic mint contexts (LLP 3000.000.001 §2)

The row interpreter takes IDs as opaque inputs. This supplemental model covers
host allocation numerically: fresh entropy is an explicit, bounded input, and
one context retains its logical timestamp through clock rollback. It proves
local successor order; it asserts no relation between independent contexts.
-/
namespace Quarry.Mint

def suffixLimit : Nat := 2 ^ 80
def timeLimit : Nat := 2 ^ 48

def next (previous now entropy : Nat) : Option Nat :=
  if now ≥ timeLimit ∨ entropy ≥ suffixLimit then none
  else if now ≤ previous / suffixLimit then
    if previous % suffixLimit + 1 < suffixLimit then some (previous + 1) else none
  else some (now * suffixLimit + entropy)

/-- A successful same-time or rollback allocation is the strict successor. -/
theorem same_or_rollback_order {previous now entropy value : Nat}
    (clock : now ≤ previous / suffixLimit)
    (allocated : next previous now entropy = some value) : previous < value := by
  simp only [next, clock, ite_true] at allocated
  split at allocated
  · contradiction
  · split at allocated
    · cases allocated
      exact Nat.lt_succ_self previous
    · contradiction

/-- A greater valid timestamp dominates every suffix in the earlier one. -/
theorem advanced_clock_order {previous now entropy value : Nat}
    (clock : previous / suffixLimit < now)
    (allocated : next previous now entropy = some value) : previous < value := by
  have before : previous < now * suffixLimit :=
    (Nat.div_lt_iff_lt_mul (by decide : 0 < suffixLimit)).mp clock
  have clock' : ¬now ≤ previous / suffixLimit := Nat.not_le_of_lt clock
  simp only [next, clock', ite_false] at allocated
  split at allocated
  · contradiction
  · cases allocated
    exact Nat.lt_add_right entropy before

/-- The Rust interpreter keeps its signed host-clock compatibility. The public
JavaScript mint API separately rejects negative values before host allocation. -/
def normalizeHostTime (now : Int) : Nat := now.toNat

def nextHost (previous : Nat) (now : Int) (entropy : Nat) : Option Nat :=
  next previous (normalizeHostTime now) entropy

/-- Backdated samples take the epoch-zero branch before monotonic allocation. -/
theorem nonpositive_host_clock_normalizes {now : Int} (h : now ≤ 0) :
    normalizeHostTime now = 0 := Int.toNat_eq_zero.mpr h

example : normalizeHostTime (-9223372036854775808) = 0 := by decide
example : nextHost 7 (-100) 42 = some 8 := by decide
example : nextHost (1000 * suffixLimit + 7) (-100) 42 = some (1000 * suffixLimit + 8) := by decide
example : nextHost (suffixLimit - 1) (-100) 42 = none := by decide

-- The second independent mutation in the same millisecond.
example : next (1000 * suffixLimit + 7) 1000 42 = some (1000 * suffixLimit + 8) := by decide
-- Carry propagates within the 80-bit field, without advancing logical time.
example : next (1000 * suffixLimit + 255) 1000 42 = some (1000 * suffixLimit + 256) := by decide
-- Clock rollback retains the high-water mark.
example : next (1000 * suffixLimit + 7) 999 42 = some (1000 * suffixLimit + 8) := by decide
-- Exhaustion refuses; a subsequent valid greater millisecond resumes.
example : next (1001 * suffixLimit - 1) 1000 42 = none := by decide
example : next (1001 * suffixLimit - 1) 999 42 = none := by decide
example : next (1001 * suffixLimit - 1) 1001 0 = some (1001 * suffixLimit) := by decide
example : next 0 timeLimit 0 = none := by decide
end Quarry.Mint
