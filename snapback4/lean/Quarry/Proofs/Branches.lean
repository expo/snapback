import Quarry.Proofs.Disclosure

/-!
# Branch-decided pages (LLP 3000.036.001)

The engine reads a page over `read <- .owner = viewer or .helper = viewer`
as the merge of the ranges `.owner = viewer` and `.helper = viewer`. That plan
is exhaustive because a rule of parties admits a row only through one of
them: every visible row carries the viewer in some party column
(`parties_cover_view`). Each range is decided by its own pin, so the merged
page is complete; the model's page (`pageRead`) walks the same visible rows
in the same order, so its rows and `complete` are the merged page's.
-/

namespace Quarry

/-- A rule of parties is true of a row only through one of its parties. -/
theorem partyLeaves_cover (r : Rule) : ∀ {ps : List String}, r.partyLeaves = some ps →
    ∀ {s v im}, r.eval s v im = true → ∃ c ∈ ps, (im.get .self).map (·.get c) = some (.id v) := by
  induction r with
  | eq a b =>
    intro ps hp s v im he
    cases a with
    | col i c =>
      cases i <;> cases b <;> simp [Rule.partyLeaves] at hp
      subst hp
      simp only [Rule.eval, Term.eval] at he
      refine ⟨c, List.mem_singleton_self _, ?_⟩
      revert he
      cases (Imgs.get im .self).map (·.get c) <;> simp
    | viewer =>
      cases b with
      | col i c =>
        cases i <;> simp [Rule.partyLeaves] at hp
        subst hp
        simp only [Rule.eval, Term.eval] at he
        refine ⟨c, List.mem_singleton_self _, ?_⟩
        revert he
        cases (Imgs.get im .self).map (·.get c) <;> simp [eq_comm]
      | _ => simp [Rule.partyLeaves] at hp
    | lit _ => simp [Rule.partyLeaves] at hp
  | or a b iha ihb =>
    intro ps hp s v im he
    simp only [Rule.partyLeaves] at hp
    cases ha : a.partyLeaves with
    | none => simp [ha] at hp
    | some pa =>
      cases hb : b.partyLeaves with
      | none => simp [ha, hb] at hp
      | some pb =>
        simp [ha, hb] at hp
        subst hp
        simp only [Rule.eval, Bool.or_eq_true] at he
        rcases he with he | he
        · obtain ⟨c, hc, h⟩ := iha ha he
          exact ⟨c, List.mem_append_left _ hc, h⟩
        · obtain ⟨c, hc, h⟩ := ihb hb he
          exact ⟨c, List.mem_append_right _ hc, h⟩
  | allow => intro ps hp; simp [Rule.partyLeaves] at hp
  | deny => intro ps hp; simp [Rule.partyLeaves] at hp
  | ne _ _ => intro ps hp; simp [Rule.partyLeaves] at hp
  | probe _ _ => intro ps hp; simp [Rule.partyLeaves] at hp
  | and _ _ _ _ => intro ps hp; simp [Rule.partyLeaves] at hp
  | not _ _ => intro ps hp; simp [Rule.partyLeaves] at hp

/-- **The party branches cover the view.** Under a read rule of parties,
every row the viewer may read carries the viewer in one of the party
columns, so the merge of the party ranges misses no readable row. -/
theorem parties_cover_view {sch : Schema} {s : Store} {v : List Nat} {t : String} {td : TableDecl}
    {ps : List String} {r : Row} (ht : sch.table? t = some td) (hp : td.read.parties = some ps)
    (hr : r ∈ visibleRows sch s v t) : ∃ c ∈ ps, r.get c = .id v := by
  have hread : td.read.eval s v { self := some r } = true := by
    have := (List.mem_filter.1 hr).2
    simpa [readable, ht] using this
  unfold Rule.parties at hp
  split at hp
  · simp only [Option.map_eq_some_iff] at hp
    obtain ⟨ls, hl, rfl⟩ := hp
    obtain ⟨c, hc, h⟩ := partyLeaves_cover _ hl hread
    exact ⟨c, List.mem_eraseDups.2 hc, by simpa [Imgs.get] using h⟩
  · simp at hp

end Quarry
