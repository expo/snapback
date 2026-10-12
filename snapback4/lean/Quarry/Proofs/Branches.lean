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

/-! ## Capped owner-or-membership branches (PAGE, §14) -/

/-- The evidence carried by one opened branch for one target row. -/
def AccessBranch.holds (s : Store) (v : List Nat) (r : Row) : AccessBranch → Bool
  | .party c => decide (r.get c = .id v)
  | .membership t key => (Rule.probe t key).eval s v { self := some r }

/-- **Branch soundness.** A row emitted by a classified party or membership
lane is admitted by the original rule. Membership eligibility strengthens
how the engine obtains the witness; the logical implication follows from the
exact probe leaf itself. -/
theorem accessLeaves_sound (rule : Rule) : ∀ {leaves branch s v r},
    rule.accessLeaves = some leaves → branch ∈ leaves → branch.holds s v r = true →
    rule.eval s v { self := some r } = true := by
  induction rule with
  | eq a b =>
    intro leaves branch s v r hl hb hh
    cases a with
    | col i c =>
      cases i <;> cases b <;> simp [Rule.accessLeaves] at hl
      subst hl; simp at hb; subst branch
      simpa [AccessBranch.holds, Rule.eval, Term.eval, Imgs.get] using hh
    | viewer =>
      cases b with
      | col i c =>
        cases i <;> simp [Rule.accessLeaves] at hl
        subst hl; simp at hb; subst branch
        have hrow : r.get c = .id v := by simpa [AccessBranch.holds] using hh
        simpa [Rule.eval, Term.eval, Imgs.get] using hrow.symm
      | _ => simp [Rule.accessLeaves] at hl
    | lit _ => simp [Rule.accessLeaves] at hl
  | probe t key =>
    intro leaves branch s v r hl hb hh
    simp [Rule.accessLeaves] at hl
    subst hl; simp at hb; subst branch
    simpa [AccessBranch.holds] using hh
  | or a b iha ihb =>
    intro leaves branch s v r hl hb hh
    simp only [Rule.accessLeaves] at hl
    cases ha : a.accessLeaves with
    | none => simp [ha] at hl
    | some la =>
      cases hb' : b.accessLeaves with
      | none => simp [ha, hb'] at hl
      | some lb =>
        simp [ha, hb'] at hl
        subst hl
        simp only [List.mem_append] at hb
        simp only [Rule.eval, Bool.or_eq_true]
        rcases hb with h | h
        · exact Or.inl (iha ha h hh)
        · exact Or.inr (ihb hb' h hh)
  | allow => intro leaves; simp [Rule.accessLeaves]
  | deny => intro leaves; simp [Rule.accessLeaves]
  | ne _ _ => intro leaves; simp [Rule.accessLeaves]
  | and _ _ _ _ => intro leaves; simp [Rule.accessLeaves]
  | not _ _ => intro leaves; simp [Rule.accessLeaves]

/-- **Branch coverage.** Every row admitted by a classified rule has either
a party witness or an exact membership witness, so the static party lanes
and dynamic parent lanes cover the readable view. -/
theorem accessLeaves_cover (rule : Rule) : ∀ {leaves s v r},
    rule.accessLeaves = some leaves → rule.eval s v { self := some r } = true →
    ∃ branch ∈ leaves, branch.holds s v r = true := by
  induction rule with
  | eq a b =>
    intro leaves s v r hl he
    cases a with
    | col i c =>
      cases i <;> cases b <;> simp [Rule.accessLeaves] at hl
      subst hl
      exact ⟨.party c, List.mem_singleton_self _, by simpa [AccessBranch.holds, Rule.eval, Term.eval, Imgs.get] using he⟩
    | viewer =>
      cases b with
      | col i c =>
        cases i <;> simp [Rule.accessLeaves] at hl
        subst hl
        have hrow : Scalar.id v = r.get c := by simpa [Rule.eval, Term.eval, Imgs.get] using he
        exact ⟨.party c, List.mem_singleton_self _, by simpa [AccessBranch.holds] using hrow.symm⟩
      | _ => simp [Rule.accessLeaves] at hl
    | lit _ => simp [Rule.accessLeaves] at hl
  | probe t key =>
    intro leaves s v r hl he
    simp [Rule.accessLeaves] at hl
    subst hl
    exact ⟨.membership t key, List.mem_singleton_self _, by simpa [AccessBranch.holds] using he⟩
  | or a b iha ihb =>
    intro leaves s v r hl he
    simp only [Rule.accessLeaves] at hl
    cases ha : a.accessLeaves with
    | none => simp [ha] at hl
    | some la =>
      cases hb : b.accessLeaves with
      | none => simp [ha, hb] at hl
      | some lb =>
        simp [ha, hb] at hl
        subst hl
        simp only [Rule.eval, Bool.or_eq_true] at he
        rcases he with he | he
        · obtain ⟨branch, hm, hh⟩ := iha ha he
          exact ⟨branch, List.mem_append_left _ hm, hh⟩
        · obtain ⟨branch, hm, hh⟩ := ihb hb he
          exact ⟨branch, List.mem_append_right _ hm, hh⟩
  | allow => intro leaves; simp [Rule.accessLeaves]
  | deny => intro leaves; simp [Rule.accessLeaves]
  | ne _ _ => intro leaves; simp [Rule.accessLeaves]
  | and _ _ _ _ => intro leaves; simp [Rule.accessLeaves]
  | not _ _ => intro leaves; simp [Rule.accessLeaves]

/-- A successful PAGE classification returns exactly the syntactic leaves. -/
theorem ownerMembership_leaves {sch : Schema} {rule : Rule} {leaves : List AccessBranch}
    (hc : rule.ownerMembership? sch = some leaves) : rule.accessLeaves = some leaves := by
  unfold Rule.ownerMembership? at hc
  cases h : rule.accessLeaves with
  | none => simp [h] at hc
  | some found =>
    simp [h] at hc
    exact congrArg some hc.2

/-- The checked PAGE classifier inherits soundness from its accepted leaves. -/
theorem ownerMembership_sound {sch : Schema} {rule : Rule} {leaves : List AccessBranch}
    (hc : rule.ownerMembership? sch = some leaves) {branch s v r}
    (hm : branch ∈ leaves) (hh : branch.holds s v r = true) :
    rule.eval s v { self := some r } = true := by
  exact accessLeaves_sound rule (ownerMembership_leaves hc) hm hh

/-- The checked PAGE classifier covers every row admitted by its rule. -/
theorem ownerMembership_cover {sch : Schema} {rule : Rule} {leaves : List AccessBranch}
    (hc : rule.ownerMembership? sch = some leaves) {s v r}
    (hr : rule.eval s v { self := some r } = true) :
    ∃ branch ∈ leaves, branch.holds s v r = true := by
  exact accessLeaves_cover rule (ownerMembership_leaves hc) hr

end Quarry
