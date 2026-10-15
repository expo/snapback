import Quarry.Store

/-!
# Maintained aggregate identity

The executable engine uses SHA-256 over a domain-separated canonical group
tuple. This independent model deliberately does not reproduce that
cryptographic implementation. It models the properties the language and
store protocols rely on: versioned domain separation, a 64-character
lowercase-hex identity for every logical group (including the empty tuple),
and adoption as one state transition that replaces every legacy physical
identity while publishing the new version.
-/

namespace Quarry

/-- The protocol domain whose change requires another store capability and
migration. -/
def maintainedIdDomainV1 : List Nat := cps "snapback4-maintained-id/sha256-v1"

/-- A small independent digest abstraction. Its contents are intentionally
not the engine's SHA-256; only its versioned input and fixed hex shape belong
to this logical model. -/
def maintainedIdV1 (key : Key) : List Nat :=
  (List.range 64).map fun i =>
    let nibble := (maintainedIdDomainV1.length + (encKey key).length + i) % 16
    if nibble < 10 then 48 + nibble else 87 + nibble

theorem maintainedIdV1_length (key : Key) : (maintainedIdV1 key).length = 64 := by
  simp [maintainedIdV1]

/-- The canonical tagged-id overhead is nine bytes and lowercase ASCII is one
byte per character, so every maintained identity fits the 144-byte id bound. -/
theorem maintainedIdV1_fits (key : Key) : 9 + (maintainedIdV1 key).length ≤ 144 := by
  rw [maintainedIdV1_length]
  omega

def maintainedRowV1 (key : Key) (cols : List (String × Scalar)) : Row :=
  { id := maintainedIdV1 key, cols }

structure MaintainedState where
  version : Nat
  rows : List Row

/-- Adoption rebuilds all reconstructible aggregate rows and publishes the
identity version in the same pure state result. `old` is an input so the model
states explicitly that legacy physical ids are never retained. -/
def adoptMaintainedV1 (_old : MaintainedState)
    (groups : List (Key × List (String × Scalar))) : MaintainedState :=
  { version := 1, rows := groups.map fun group => maintainedRowV1 group.1 group.2 }

theorem adoptMaintainedV1_version (old : MaintainedState) (groups) :
    (adoptMaintainedV1 old groups).version = 1 := rfl

theorem adoptMaintainedV1_ids (old : MaintainedState) (groups) :
    (adoptMaintainedV1 old groups).rows.map Row.id = groups.map fun group => maintainedIdV1 group.1 := by
  simp [adoptMaintainedV1, maintainedRowV1]

theorem adoptMaintainedV1_values (old : MaintainedState) (groups) :
    (adoptMaintainedV1 old groups).rows.map Row.cols = groups.map Prod.snd := by
  simp [adoptMaintainedV1, maintainedRowV1]

/-! Persisted `sequence by` counters are server custody keyed by the parent
table and physical parent id. They outlive allocating rows. This small model
does not model SQL or the device protocol; it states the adoption invariant
for one target-specific legacy-to-digest key. -/

def sequenceHighWater (id : List Nat) (counters : List (List Nat × Nat)) : Nat :=
  counters.foldl (fun high counter =>
    if counter.1 = id then max high counter.2 else high) 0

/-- If a partially upgraded store already has both keys, adoption merges them
at their maximum. No child-row population participates in this value. -/
def adoptedSequenceHighWater (legacy digest : List Nat)
    (counters : List (List Nat × Nat)) : Nat :=
  max (sequenceHighWater legacy counters) (sequenceHighWater digest counters)

theorem adoptedSequence_preserves_legacy (legacy digest counters) :
    sequenceHighWater legacy counters ≤ adoptedSequenceHighWater legacy digest counters :=
  Nat.le_max_left _ _

theorem adoptedSequence_preserves_digest (legacy digest counters) :
    sequenceHighWater digest counters ≤ adoptedSequenceHighWater legacy digest counters :=
  Nat.le_max_right _ _

/-- A surviving aggregate row fixes the physical parent that rebuilt rows and
typed references address. Counter-only inference applies only without that
row evidence. This abstracts map precedence, not SQL tuple decoding. -/
def adoptedSequenceParent (rowParent? : Option (List Nat))
    (counterOnlyParent : List Nat) : List Nat :=
  rowParent?.getD counterOnlyParent

theorem adoptedSequenceParent_row_wins (rowParent counterOnlyParent) :
    adoptedSequenceParent (some rowParent) counterOnlyParent = rowParent := by
  rfl

example : adoptedSequenceHighWater [91, 55, 93] (maintainedIdV1 [.int 7])
    [([91, 55, 93], 9), (maintainedIdV1 [.int 7], 4)] = 9 := by decide

example : (maintainedIdV1 []).length = 64 := maintainedIdV1_length []
example : (maintainedIdV1 [.id (List.replicate 64 97), .text (List.replicate 64 120)]).length = 64 :=
  maintainedIdV1_length _

end Quarry
