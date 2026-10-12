import Quarry.Proofs.Disclosure

/-!
# Determinism

The evaluator is a function, so every case has exactly one outcome
(`run_deterministic`). The non-trivial part is that the *order* of a scan
is determined by the key order alone: however a store happens to hold a
table's rows (any permutation), a page sees the same candidates in the same
order (`sortRows_perm`, `candidates_perm`) and returns the same answer
(`pageRead_perm`), provided ids are unique, because every key ends in `id`.
-/

namespace Quarry

theorem run_deterministic (c : Case) {o1 o2 : Outcome} (h1 : run c = o1) (h2 : run c = o2) :
    o1 = o2 := h1 ▸ h2

theorem eq_of_perm_of_pairwise {α : Type} {R : α → α → Prop} :
    ∀ {l1 l2 : List α}, (∀ a ∈ l1, ∀ b ∈ l1, R a b → R b a → a = b) →
      l1.Perm l2 → l1.Pairwise R → l2.Pairwise R → l1 = l2 := by
  intro l1
  induction l1 with
  | nil => intro l2 _ hp _ _; exact (List.nil_perm.1 hp).symm
  | cons a l1 ih =>
    intro l2 hanti hp h1 h2
    cases l2 with
    | nil => exact absurd hp.length_eq (by simp)
    | cons b l2 =>
      by_cases hab : a = b
      · subst hab
        have := ih (fun x hx y hy => hanti x (List.mem_cons_of_mem _ hx) y (List.mem_cons_of_mem _ hy))
          (List.perm_cons a |>.1 hp) (List.pairwise_cons.1 h1).2 (List.pairwise_cons.1 h2).2
        rw [this]
      · have ha : a ∈ l2 := by
          have := hp.mem_iff.1 List.mem_cons_self
          rcases List.mem_cons.1 this with h | h
          · exact absurd h hab
          · exact h
        have hb : b ∈ l1 := by
          have := hp.mem_iff.2 List.mem_cons_self
          rcases List.mem_cons.1 this with h | h
          · exact absurd h.symm hab
          · exact h
        have rba := (List.pairwise_cons.1 h2).1 a ha
        have rab := (List.pairwise_cons.1 h1).1 b hb
        exact absurd (hanti a List.mem_cons_self b (List.mem_cons_of_mem _ hb) rab rba) hab

theorem keyLe_iff {order : List String} {a b : Row} :
    keyLe order a b = true ↔ Le keyCmp (rowKey order a) (rowKey order b) := by
  simp [keyLe, Le]

theorem keyLe_trans (order : List String) :
    ∀ a b d, keyLe order a b = true → keyLe order b d = true → keyLe order a d = true := by
  intro a b d h1 h2
  rw [keyLe_iff] at *
  exact keyCmp_lawful.le_trans h1 h2

theorem keyLe_total (order : List String) : ∀ a b, (keyLe order a b || keyLe order b a) = true := by
  intro a b
  rcases keyCmp_lawful.le_total (rowKey order a) (rowKey order b) with h | h
  · simp [keyLe_iff.2 h]
  · simp [keyLe_iff.2 h]

theorem rowKey_id {order : List String} {a b : Row} (h : rowKey order a = rowKey order b) :
    a.id = b.id := by
  unfold rowKey at h
  have hl : (order.map a.get).length = (order.map b.get).length := by simp
  have := (List.append_inj h hl).2
  simp at this
  exact this

theorem nodup_id_inj {l : List Row} (hn : (l.map Row.id).Nodup) {a b : Row}
    (ha : a ∈ l) (hb : b ∈ l) (h : a.id = b.id) : a = b := by
  induction l with
  | nil => cases ha
  | cons x l ih =>
    simp only [List.map_cons, List.nodup_cons, List.mem_map] at hn
    rcases List.mem_cons.1 ha with rfl | ha' <;> rcases List.mem_cons.1 hb with rfl | hb'
    · rfl
    · exact absurd ⟨b, hb', h.symm⟩ hn.1
    · exact absurd ⟨a, ha', h⟩ hn.1
    · exact ih hn.2 ha' hb'

theorem sortRows_perm {order : List String} {desc : Bool} {l1 l2 : List Row}
    (hp : l1.Perm l2) (hn : (l1.map Row.id).Nodup) : sortRows order desc l1 = sortRows order desc l2 := by
  have s1 := List.pairwise_mergeSort (keyLe_trans order) (keyLe_total order) l1
  have s2 := List.pairwise_mergeSort (keyLe_trans order) (keyLe_total order) l2
  have p1 := List.mergeSort_perm l1 (keyLe order)
  have p2 := List.mergeSort_perm l2 (keyLe order)
  have hperm : (l1.mergeSort (keyLe order)).Perm (l2.mergeSort (keyLe order)) :=
    p1.trans (hp.trans p2.symm)
  have heq : l1.mergeSort (keyLe order) = l2.mergeSort (keyLe order) := by
    refine eq_of_perm_of_pairwise ?_ hperm s1 s2
    intro a ha b hb hab hba
    have ka := keyCmp_lawful.le_antisymm (keyLe_iff.1 hab) (keyLe_iff.1 hba)
    exact nodup_id_inj hn (p1.mem_iff.1 ha) (p1.mem_iff.1 hb) (rowKey_id ka)
  unfold sortRows
  rw [heq]

theorem candidates_perm {vw1 vw2 : View} {t : String} {ps order desc cur}
    (hp : (vw1 t).Perm (vw2 t)) (hn : ((vw1 t).map Row.id).Nodup) :
    candidates vw1 t ps order desc cur = candidates vw2 t ps order desc cur := by
  unfold candidates
  rw [sortRows_perm (hp.filter _) ((List.filter_sublist).map Row.id |>.nodup hn)]

/-- **Scan order is determined by key order**: a page over two views that hold
the same rows of its table, in any order, gives the same answer. -/
theorem pageRead_perm {cx : Ctx} {vw1 vw2 : View} {t : String} {ps filt order desc take cur dec mg}
    (hp : (vw1 t).Perm (vw2 t)) (hn : ((vw1 t).map Row.id).Nodup) :
    pageRead cx vw1 t ps filt order desc take cur dec mg = pageRead cx vw2 t ps filt order desc take cur dec mg := by
  unfold pageRead
  rw [candidates_perm hp hn]

end Quarry
