import Quarry.Eval

/-!
# What decides a scan: pins and readable grants

A scan's read rule is *decided* for a caller (`decided`) when its pins fix
every row column the rule reads (`uniform`), or when a positive disjunct
that reads no row column holds over the caller's view (`granted`, LLP
3000.036 §12.1). These are the facts that make a decided page's
`complete` sound (`Disclosure.lean`, `decided_store`):

* `uniform_readable_eq`: under a uniform scan, every row the pins select has
  the same verdict, so the caller reads all of them or none;
* `granted_readable`: a grant that holds over the caller's view makes every
  row of the table readable to them in the store.

The rule-level lemmas are about evaluation alone: a rule's disjunct implies
the rule (`Rule.eval_of_mem_disjuncts`), a positive rule true over fewer
rows is true over more (`Rule.eval_mono`), and a rule's value depends on its
terms' values only (`Rule.eval_mapTerms`).
-/

namespace Quarry

theorem Rule.eval_of_mem_disjuncts {s : Store} {v : List Nat} {im : Imgs} :
    ∀ (r d : Rule), d ∈ r.disjuncts → d.eval s v im = true → r.eval s v im = true := by
  intro r
  induction r with
  | or a b iha ihb =>
    intro d hd he
    simp only [Rule.disjuncts, List.mem_append] at hd
    simp only [Rule.eval, Bool.or_eq_true]
    rcases hd with h | h
    · exact .inl (iha d h he)
    · exact .inr (ihb d h he)
  | allow | deny | eq | ne | probe | and | not =>
    intro d hd he
    simp only [Rule.disjuncts, List.mem_singleton] at hd
    subst hd; exact he

/-- Normalization folds only semantic Boolean identities, so it preserves a
rule's verdict for every store, caller and row image. -/
theorem Rule.eval_normalize {s : Store} {v : List Nat} {im : Imgs} :
    ∀ r : Rule, r.normalize.eval s v im = r.eval s v im := by
  intro r
  induction r with
  | eq a b =>
    cases a <;> cases b <;> simp [Rule.normalize, Rule.eval, Term.eval]
    case lit.lit a b =>
      by_cases h : a = b
      · subst b; cases a <;> simp [Rule.normalize, Rule.eval]
      · cases a <;> cases b <;> simp_all [Rule.normalize, Rule.eval, Term.eval]
  | ne a b =>
    cases a <;> cases b <;> simp [Rule.normalize, Rule.eval, Term.eval]
    case lit.lit a b =>
      by_cases h : a = b
      · subst b; cases a <;> simp [Rule.normalize, Rule.eval]
      · cases a <;> cases b <;> simp_all [Rule.normalize, Rule.eval, Term.eval]
  | and a b iha ihb =>
    generalize ha : a.normalize = an
    generalize hb : b.normalize = bn
    cases an <;> cases bn <;> simp_all [Rule.normalize, Rule.eval]
  | or a b iha ihb =>
    generalize ha : a.normalize = an
    generalize hb : b.normalize = bn
    cases an <;> cases bn <;> simp_all [Rule.normalize, Rule.eval]
  | not a ih =>
    generalize ha : a.normalize = an
    cases an <;> simp_all [Rule.normalize, Rule.eval]
  | allow | deny | probe => rfl

/-- A positive rule true over a sub-store is true over the store. -/
theorem Rule.eval_mono {s1 s2 : Store} (hsub : ∀ t r, r ∈ s1 t → r ∈ s2 t) {v : List Nat} {im : Imgs} :
    ∀ r : Rule, r.positive = true → r.eval s1 v im = true → r.eval s2 v im = true := by
  intro r
  induction r with
  | probe t point key =>
    intro _ h
    cases hk : probeKey v im point key with
    | none => simp [Rule.eval, hk] at h
    | some ks =>
      simp only [Rule.eval, hk, List.any_eq_true] at h ⊢
      obtain ⟨x, hx, hm⟩ := h
      exact ⟨x, hsub _ _ hx, hm⟩
  | and a b iha ihb =>
    intro hp h
    simp only [Rule.positive, Bool.and_eq_true] at hp
    simp only [Rule.eval, Bool.and_eq_true] at h ⊢
    exact ⟨iha hp.1 h.1, ihb hp.2 h.2⟩
  | or a b iha ihb =>
    intro hp h
    simp only [Rule.positive, Bool.and_eq_true] at hp
    simp only [Rule.eval, Bool.or_eq_true] at h ⊢
    rcases h with h | h
    · exact .inl (iha hp.1 h)
    · exact .inr (ihb hp.2 h)
  | not a _ => intro hp; simp [Rule.positive] at hp
  | allow => intro _ h; exact h
  | deny => intro _ h; exact h
  | eq a b => intro _ h; simpa [Rule.eval] using h
  | ne a b => intro _ h; simpa [Rule.eval] using h

theorem probeTerms_mapTerms {v : List Nat} {im1 im2 : Imgs} {f : Term → Term} :
    ∀ key : List (String × Term), (∀ p ∈ key, p.2.eval v im1 = (f p.2).eval v im2) →
      probeTerms v im1 key = probeTerms v im2 (key.map fun p => (p.1, f p.2))
  | [], _ => rfl
  | p :: ps, h => by
    have h1 := h p List.mem_cons_self
    have h2 := probeTerms_mapTerms ps (fun q hq => h q (List.mem_cons_of_mem _ hq))
    unfold probeTerms at h2 ⊢
    simp only [List.mapM_cons, List.map_cons, h1, h2]

theorem probeKey_mapTerms {v : List Nat} {im1 im2 : Imgs} {f : Term → Term}
    (point : List String) (key : List (String × Term))
    (h : ∀ p ∈ key, p.2.eval v im1 = (f p.2).eval v im2) :
    probeKey v im1 point key = probeKey v im2 point (key.map fun p => (p.1, f p.2)) := by
  unfold probeKey
  rw [probeTerms_mapTerms key h]

/-- A rule's value depends on its terms' values only: replacing each term by
one with the same value (under other images) keeps the verdict. -/
theorem Rule.eval_mapTerms {s : Store} {v : List Nat} {im1 im2 : Imgs} {f : Term → Term} :
    ∀ r : Rule, (∀ t ∈ r.terms, t.eval v im1 = (f t).eval v im2) →
      r.eval s v im1 = (r.mapTerms f).eval s v im2 := by
  intro r
  induction r with
  | eq a b =>
    intro h
    simp only [Rule.terms, List.mem_cons, List.mem_nil_iff, or_false, forall_eq_or_imp, forall_eq] at h
    simp only [Rule.eval, Rule.mapTerms, h.1, h.2]
  | ne a b =>
    intro h
    simp only [Rule.terms, List.mem_cons, List.mem_nil_iff, or_false, forall_eq_or_imp, forall_eq] at h
    simp only [Rule.eval, Rule.mapTerms, h.1, h.2]
  | probe t point key =>
    intro h
    have hk := probeKey_mapTerms (f := f) point key (fun p hp => h p.2 (by simp only [Rule.terms, List.mem_map]; exact ⟨p, hp, rfl⟩))
    simp only [Rule.eval, Rule.mapTerms, hk]
  | and a b iha ihb =>
    intro h
    simp only [Rule.terms, List.mem_append] at h
    simp only [Rule.eval, Rule.mapTerms, iha (fun t ht => h t (.inl ht)), ihb (fun t ht => h t (.inr ht))]
  | or a b iha ihb =>
    intro h
    simp only [Rule.terms, List.mem_append] at h
    simp only [Rule.eval, Rule.mapTerms, iha (fun t ht => h t (.inl ht)), ihb (fun t ht => h t (.inr ht))]
  | not a ih =>
    intro h
    simp only [Rule.eval, Rule.mapTerms, ih h]
  | allow => intro _; rfl
  | deny => intro _; rfl

theorem Rule.mapTerms_id : ∀ r : Rule, r.mapTerms id = r := by
  intro r
  induction r with
  | probe t point key => simp [Rule.mapTerms]
  | and a b iha ihb => simp [Rule.mapTerms, iha, ihb]
  | or a b iha ihb => simp [Rule.mapTerms, iha, ihb]
  | not a ih => simp [Rule.mapTerms, ih]
  | _ => rfl

/-- Images that agree on every term give the same verdict. -/
theorem Rule.eval_congr {s : Store} {v : List Nat} {im1 im2 : Imgs} (r : Rule)
    (h : ∀ t ∈ r.terms, t.eval v im1 = t.eval v im2) : r.eval s v im1 = r.eval s v im2 := by
  have := Rule.eval_mapTerms (s := s) (f := id) r h
  rwa [Rule.mapTerms_id] at this

theorem mem_selfCols {r : Rule} {t : Term} {c : String} (ht : t ∈ r.terms) (hc : c ∈ t.selfCols) :
    c ∈ r.selfCols := by
  unfold Rule.selfCols
  exact List.mem_flatMap.2 ⟨t, ht, hc⟩

/-- A term that reads no row column has the same value whatever the row. -/
theorem Term.eval_self_free {v : List Nat} {x y : Option Row} :
    ∀ t : Term, t.selfCols = [] → t.eval v { self := x } = t.eval v { self := y }
  | .col .self c, h => by simp [Term.selfCols] at h
  | .col .old _, _ => rfl
  | .col .next _, _ => rfl
  | .viewer, _ => rfl
  | .param _, _ => rfl
  | .lit _, _ => rfl

/-- A rule that reads no row column has the same verdict for every row. -/
theorem Rule.eval_self_free {s : Store} {v : List Nat} {x y : Option Row} (r : Rule)
    (h : r.selfCols = []) : r.eval s v { self := x } = r.eval s v { self := y } := by
  refine Rule.eval_congr r fun t ht => Term.eval_self_free t ?_
  rcases hts : t.selfCols with _ | ⟨c, cs⟩
  · rfl
  · have : c ∈ r.selfCols := mem_selfCols ht (by rw [hts]; exact List.mem_cons_self)
    rw [h] at this; cases this

/-- Two rows that agree on every row column a rule reads get one verdict. -/
theorem Rule.eval_self_congr {s : Store} {v : List Nat} {r1 r2 : Row} (r : Rule)
    (h : ∀ c ∈ r.selfCols, r1.get c = r2.get c) :
    r.eval s v { self := some r1 } = r.eval s v { self := some r2 } := by
  refine Rule.eval_congr r fun t ht => ?_
  match t, ht with
  | .col .self c, ht =>
    have := h c (mem_selfCols ht (by simp [Term.selfCols]))
    simp [Term.eval, Imgs.get, this]
  | .col .old _, _ => rfl
  | .col .next _, _ => rfl
  | .viewer, _ => rfl
  | .param _, _ => rfl
  | .lit _, _ => rfl

theorem keyMatch_get {ps : List (String × Scalar)} {r : Row} (h : keyMatch ps r = true)
    {p : String × Scalar} (hp : p ∈ ps) : r.get p.1 = p.2 := by
  unfold keyMatch at h
  simpa using List.all_eq_true.1 h p hp

/-- **A uniform scan has one verdict**: every row its pins select is
readable, or none is. -/
theorem uniform_readable_eq {sch : Schema} {s : Store} {v : List Nat} {t : String}
    {ps : List (String × Scalar)} {r1 r2 : Row} (hu : uniform sch t ps = true)
    (h1 : keyMatch ps r1 = true) (h2 : keyMatch ps r2 = true) :
    readable sch s v t r1 = readable sch s v t r2 := by
  unfold uniform at hu
  unfold readable
  split at hu
  · rename_i td htd
    rw [htd]
    refine Rule.eval_self_congr td.read fun c hc => ?_
    obtain ⟨p, hp, hpc⟩ := List.any_eq_true.1 (List.all_eq_true.1 hu c hc)
    have hpc : p.1 = c := by simpa using hpc
    subst hpc
    rw [keyMatch_get h1 hp, keyMatch_get h2 hp]
  · cases hu

theorem mem_visibleRows {sch : Schema} {s : Store} {v : List Nat} {t : String} {r : Row}
    (h : r ∈ visibleRows sch s v t) : r ∈ s t :=
  (List.mem_filter.1 h).1

theorem List.mem_of_lookup {ps : List (String × Scalar)} {c : String} {x : Scalar} :
    ps.lookup c = some x → (c, x) ∈ ps := by
  induction ps with
  | nil => simp [List.lookup]
  | cons p ps ih =>
    obtain ⟨a, b⟩ := p
    simp only [List.lookup]
    split
    · rename_i h; intro hx; cases hx
      have : c = a := by simpa using h
      subst this; exact List.mem_cons_self
    · intro hx; exact List.mem_cons_of_mem _ (ih hx)

/-- Substituting the values of pins that match a row preserves the rule's
verdict on that row; columns outside the prefix remain row reads. -/
theorem Rule.eval_pin_row {s : Store} {v : List Nat} {ps : List (String × Scalar)} {r : Row}
    (hk : keyMatch ps r = true) (d : Rule) :
    d.eval s v { self := some r } = (d.pin ps).eval s v { self := some r } := by
  refine Rule.eval_mapTerms d fun t _ => ?_
  match t with
  | .col .self c =>
    cases hl : ps.lookup c with
    | none => simp [Term.pin, hl]
    | some x =>
      have hx := keyMatch_get hk (List.mem_of_lookup hl)
      simp [Term.pin, hl, Term.eval, Imgs.get, hx]
  | .col .old _ => rfl
  | .col .next _ => rfl
  | .viewer => rfl
  | .param _ => rfl
  | .lit _ => rfl

theorem List.lookup_none {ps : List (String × Scalar)} {c : String} :
    ps.lookup c = none → ∀ p ∈ ps, p.1 ≠ c := by
  induction ps with
  | nil => simp
  | cons p ps ih =>
    obtain ⟨a, b⟩ := p
    simp only [List.lookup]
    split
    · intro h; cases h
    · rename_i h
      intro hn q hq
      rcases List.mem_cons.1 hq with rfl | hq
      · intro hac; subst hac; simp at h
      · exact ih hn q hq

theorem Rule.positive_mapTerms {f : Term → Term} : ∀ r : Rule, (r.mapTerms f).positive = r.positive := by
  intro r
  induction r with
  | and a b iha ihb => simp [Rule.mapTerms, Rule.positive, iha, ihb]
  | or a b iha ihb => simp [Rule.mapTerms, Rule.positive, iha, ihb]
  | not a _ => rfl
  | _ => rfl

/-- **Pinning keeps the verdict**: for a row the pins select, a rule whose row
columns are all pinned gives the verdict of the rule with the pinned values
substituted, whatever row it is asked about. -/
theorem Rule.eval_pin {s : Store} {v : List Nat} {ps : List (String × Scalar)} {r : Row}
    (hk : keyMatch ps r = true) (d : Rule) (hp : ∀ c ∈ d.selfCols, ps.any (·.1 == c) = true) :
    d.eval s v { self := some r } = (d.pin ps).eval s v {} := by
  refine Rule.eval_mapTerms d fun t ht => ?_
  match t, ht with
  | .col .self c, ht =>
    have hc := hp c (mem_selfCols ht (by simp [Term.selfCols]))
    cases hl : ps.lookup c with
    | some x =>
      have := keyMatch_get hk (List.mem_of_lookup hl)
      simp [Term.pin, hl, Term.eval, Imgs.get, this]
    | none =>
      obtain ⟨p, hmem, hpc⟩ := List.any_eq_true.1 hc
      exact absurd (by simpa using hpc) (List.lookup_none hl p hmem)
  | .col .old _, _ => rfl
  | .col .next _, _ => rfl
  | .viewer, _ => rfl
  | .param _, _ => rfl
  | .lit _, _ => rfl

/-- **A page guard decides every row it selects**: a guard that holds over
the caller's view makes every row the pins select readable to them. -/
theorem granted_readable {sch : Schema} {s : Store} {v : List Nat} {t : String}
    {ps : List (String × Scalar)} {pins : List (String × Expr)}
    (hg : granted sch (visibleRows sch s v) v t ps pins = true) (r : Row)
    (hk : keyMatch ps r = true) : readable sch s v t r = true := by
  unfold granted at hg
  unfold readable
  split at hg
  · rename_i td htd
    rw [htd]
    obtain ⟨d, hd, hdg⟩ := List.any_eq_true.1 hg
    simp only [Bool.and_eq_true] at hdg
    obtain ⟨⟨⟨-, hpos⟩, hempty⟩, hev⟩ := hdg
    let d' := (d.pin ps).normalize
    have hfree : d'.selfCols = [] := by
      cases hcols : d'.selfCols with
      | nil => rfl
      | cons c cs => simp [d', hcols] at hempty
    have hs : d'.eval s v {} = true :=
      Rule.eval_mono (fun _ _ hx => mem_visibleRows hx) d' hpos hev
    have hsr : d'.eval s v { self := some r } = true := by
      rw [Rule.eval_self_free d' hfree]
      exact hs
    have hp : (d.pin ps).eval s v { self := some r } = true := by
      rw [← Rule.eval_normalize]
      exact hsr
    have hr : d.eval s v { self := some r } = true := by
      rw [Rule.eval_pin_row hk d]
      exact hp
    exact Rule.eval_of_mem_disjuncts td.read d hd hr
  · cases hg

end Quarry
