/-!
# Wave 12 device-queue contract witnesses

This module is an independent, abstract contract witness for the device queue
boundary. It is deliberately not part of `Quarry.Eval`, and it does not claim
that the Lean row oracle models device prediction, sync, maintained-column
projection, or the production meter.

The first witness gives two server worlds with the same public rows and the
same confirmed maintained total. Their withheld maintained predicates differ,
so retiring the same parent produces different authoritative totals. No
point-valued function of the public observation can be right in both worlds;
queueing preserves the confirmed image until server catch-up.

The second witness models only the law of the separate device physical-work
allowance: nested work consumes the remainder from earlier work. Resetting the
allowance between nested proofs would accept costs 2 and 3 under a limit of 4,
while sequential consumption queues the second proof.
-/

namespace Quarry.Wave12DeviceQueue

-- @ref LLP 3000.039#64-devices-and-prediction — private maintains and nested proof work queue when public device state cannot decide them within one allowance.

inductive Kind where
  | a
  | b
  deriving DecidableEq

structure SourceRow where
  id : Nat
  parent : Nat
  kind : Kind
  deriving DecidableEq

structure PublicRow where
  id : Nat
  parent : Nat
  deriving DecidableEq

structure PrivateWorld where
  rows : List SourceRow
  counted : Kind

def publicProjection (rows : List SourceRow) : List PublicRow :=
  rows.map fun row => ⟨row.id, row.parent⟩

def total (world : PrivateWorld) : Nat :=
  (world.rows.filter fun row => row.kind == world.counted).length

def retireParent (parent : Nat) (world : PrivateWorld) : PrivateWorld :=
  { world with rows := world.rows.filter fun row => row.parent != parent }

def rows : List SourceRow := [
  { id := 10, parent := 1, kind := .a },
  { id := 20, parent := 2, kind := .b }
]

def countsA : PrivateWorld := ⟨rows, .a⟩
def countsB : PrivateWorld := ⟨rows, .b⟩

def confirmedTotal : Nat := 1

def publicObservation (world : PrivateWorld) : List PublicRow × Nat :=
  (publicProjection world.rows, confirmedTotal)

example : publicObservation countsA = publicObservation countsB := rfl
example : total countsA = confirmedTotal := rfl
example : total countsB = confirmedTotal := rfl
example : total (retireParent 1 countsA) = 0 := rfl
example : total (retireParent 1 countsB) = 1 := rfl

/-- A device point-predictor sees only public rows and the confirmed total. -/
abbrev PointPredictor := List PublicRow → Nat → Nat

/-- The indistinguishable worlds require different post-retirement totals, so
one public point prediction cannot be authoritative in both. -/
theorem projection_queues
    (predict : PointPredictor) :
    predict (publicProjection rows) confirmedTotal ≠ total (retireParent 1 countsA) ∨
      predict (publicProjection rows) confirmedTotal ≠ total (retireParent 1 countsB) := by
  have hA : total (retireParent 1 countsA) = 0 := rfl
  have hB : total (retireParent 1 countsB) = 1 := rfl
  rw [hA, hB]
  omega

inductive Decision where
  | point (value : Nat)
  | queue
  deriving DecidableEq

def soundFor (decision : Decision) (world : PrivateWorld) : Prop :=
  match decision with
  | .point value => value = total (retireParent 1 world)
  | .queue => True

theorem queue_is_sound_for_both_worlds :
    soundFor .queue countsA ∧ soundFor .queue countsB := by
  simp [soundFor]

theorem no_point_is_sound_for_both_worlds (value : Nat) :
    ¬ (soundFor (.point value) countsA ∧ soundFor (.point value) countsB) := by
  simp [soundFor, countsA, countsB, rows, total, retireParent]
  omega

/-- Queueing publishes no speculative replacement for the confirmed image. -/
def presentedTotal (confirmed : Nat) : Decision → Nat
  | .point value => value
  | .queue => confirmed

example : presentedTotal confirmedTotal .queue = 1 := rfl

/-- Spend `cost` from the remaining physical-work allowance. -/
def spend (remaining cost : Nat) : Option Nat :=
  if cost ≤ remaining then some (remaining - cost) else none

theorem nested_spends_fit
    {initial first second afterFirst afterSecond : Nat}
    (hFirst : spend initial first = some afterFirst)
    (hSecond : spend afterFirst second = some afterSecond) :
    first + second ≤ initial := by
  simp [spend] at hFirst hSecond
  omega

def nestedDecision (initial first second : Nat) : Decision :=
  match spend initial first with
  | none => .queue
  | some remaining =>
      match spend remaining second with
      | none => .queue
      | some _ => .point confirmedTotal

/-- Resetting to the initial allowance between nested proofs would accept both
individual costs even though their sum exceeds the request allowance. -/
def resetWouldAccept (initial first second : Nat) : Bool :=
  first ≤ initial && second ≤ initial

example : resetWouldAccept 4 2 3 = true := rfl
example : 4 < 2 + 3 := by decide
example : nestedDecision 4 2 3 = .queue := rfl
example : nestedDecision 5 2 3 = .point confirmedTotal := rfl

end Quarry.Wave12DeviceQueue
