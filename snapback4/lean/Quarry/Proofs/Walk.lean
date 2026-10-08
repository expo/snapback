import Quarry.Proofs.Authority

/-!
# Facts about the candidate walk

`walk_sub`: everything a walk returns or positions after is a candidate.
`walk_complete`: a walk that was not cut returned exactly the first `n`
candidates its filter keeps.
-/

namespace Quarry

/-- The filter `f` computes the pure predicate `p` whenever it succeeds
(whatever it does to the meter). True of every filter without nested reads. -/
def FiltIs (f : Row → EM Bool) (p : Row → Bool) : Prop :=
  ∀ r rs b rs', (f r).run rs = .ok (b, rs') → b = p r

theorem pure_ok {α : Type} {a b : α} {rs rs' : RS} (h : (pure a : EM α).run rs = .ok (b, rs')) :
    b = a ∧ rs' = rs := by
  simp [StateT.run, pure, StateT.pure, Except.pure] at h
  exact ⟨h.1.symm, h.2.symm⟩

theorem walk_sub (f : Row → EM Bool) (b : Option Nat) (n : Nat) :
    ∀ cs acc last rs w rs', (walk f b n acc last cs).run rs = .ok (w, rs') →
      (∀ r ∈ w.rows, r ∈ acc ∨ r ∈ cs) ∧ (∀ r, w.last = some r → last = some r ∨ r ∈ cs) := by
  intro cs
  induction cs with
  | nil =>
    intro acc last rs w rs' h
    simp only [walk] at h
    obtain ⟨rfl, -⟩ := pure_ok h
    simp
  | cons c cs ih =>
    intro acc last rs w rs' h
    simp only [walk] at h
    split at h
    · obtain ⟨rfl, -⟩ := pure_ok h
      exact ⟨fun r h => .inl (List.mem_reverse.1 h), fun r h => .inl h⟩
    · obtain ⟨rs0, rs1, -, h⟩ := sbind_ok h
      split at h
      · obtain ⟨rfl, -⟩ := pure_ok h
        exact ⟨fun r h => .inl (List.mem_reverse.1 h), fun r h => .inl h⟩
      · obtain ⟨_, rs2, -, h⟩ := sbind_ok h
        obtain ⟨keep, rs3, -, h⟩ := sbind_ok h
        obtain ⟨h1, h2⟩ := ih _ _ _ _ _ h
        constructor
        · intro r hr
          rcases h1 r hr with h | h
          · split at h
            · rcases List.mem_cons.1 h with h | h
              · subst h; exact .inr List.mem_cons_self
              · exact .inl h
            · exact .inl h
          · exact .inr (List.mem_cons_of_mem _ h)
        · intro r hr
          rcases h2 r hr with h | h
          · cases h; exact .inr List.mem_cons_self
          · exact .inr (List.mem_cons_of_mem _ h)

theorem walk_complete (f : Row → EM Bool) (p : Row → Bool) (hf : FiltIs f p) (b : Option Nat) (n : Nat) :
    ∀ cs acc last rs w rs', acc.length ≤ n → (walk f b n acc last cs).run rs = .ok (w, rs') →
      w.stop ≠ .cut → w.rows = acc.reverse ++ (cs.filter p).take (n - acc.length) := by
  intro cs
  induction cs with
  | nil =>
    intro acc last rs w rs' _ h _
    simp only [walk] at h
    obtain ⟨rfl, -⟩ := pure_ok h
    simp
  | cons c cs ih =>
    intro acc last rs w rs' hlen h hcut
    simp only [walk] at h
    split at h
    · rename_i hle
      obtain ⟨rfl, -⟩ := pure_ok h
      have : n - acc.length = 0 := by omega
      simp [this]
    · rename_i hlt
      obtain ⟨rs0, rs1, -, h⟩ := sbind_ok h
      split at h
      · obtain ⟨rfl, -⟩ := pure_ok h
        exact absurd rfl hcut
      · obtain ⟨_, rs2, -, h⟩ := sbind_ok h
        obtain ⟨keep, rs3, hk, h⟩ := sbind_ok h
        have hkeep := hf _ _ _ _ hk
        subst hkeep
        have hsucc : n - acc.length = (n - (acc.length + 1)) + 1 := by omega
        split at h
        · rename_i hp
          have := ih _ _ _ _ _ (by simp; omega) h hcut
          rw [this]
          simp [hp, hsucc, List.take_succ_cons]
        · rename_i hp
          have := ih _ _ _ _ _ (by omega) h hcut
          rw [this]
          simp [hp]

end Quarry
