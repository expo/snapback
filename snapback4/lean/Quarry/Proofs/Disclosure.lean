import Quarry.Proofs.Walk
import Quarry.Proofs.Grant

/-!
# No disclosure, and completeness soundness

**No disclosure.** A query's outcome — data, `complete`, `next`, refusal or
unavailability — is a function of the viewer's *visible* rows alone
(`query_noninterference`). Two stores that show the viewer the same rows
give the same outcome, so no outcome reveals a hidden row, whether through
a page, a point read, an `exists`, a count, a cursor or a cut. Concretely:

* every row a page returns, and the row its cursor follows, passes its
  table's read rule (`pageRead_visible`, `page_rows_readable`);
* `count(domain)` is exactly the number of *visible* rows in the domain
  that match (`countRead_eq`): that number is all it reveals, and it is
  unchanged by any hidden row;
* `exists domain` is true exactly when a visible row matches
  (`existsRead_eq`); an `exists` witness *inside a read rule* grants
  visibility but is never itself returned;
* inserting a row the viewer cannot read, into a table no read rule probes,
  changes no query outcome (`query_ignores_hidden_insert`).

**Completeness soundness.** A page that leaves `complete` true returned
exactly the first `N` qualifying visible rows after its cursor, in key
order, and its read rule was decided by the pins (`pageRead_complete`).
-/

namespace Quarry

/-- **Noninterference.** -/
theorem query_noninterference {c : Case} (hk : c.program.kind = .query) {s1 s2 : Store}
    (h : visibleRows c.schema s1 c.viewer = visibleRows c.schema s2 c.viewer) :
    run { c with store := s1 } = run { c with store := s2 } := by
  simp only [run, hk, runQuery, Case.ctx, h]

/-- A query never changes anything: its world is the view, and every write
refuses. -/
theorem query_writes_nothing {cx : Ctx} {fuel : Nat} {vw : View} {env : Env} {ss : List Stmt}
    {rs : RS} {fl : Flow} {vw' : View} {env' : Env} {rs' : RS}
    (h : (execStmts queryHooks fuel cx vw env ss).run rs = .ok ((fl, vw', env'), rs')) : vw' = vw := by
  have := execStmts_inv queryHooks cx (fun a b => b = a) (fun _ => rfl)
    (fun _ _ _ h1 h2 => h2.trans h1)
    (fun _ _ _ _ happ => by simp [queryHooks, throw, throwThe, MonadExceptOf.throw] at happ)
    _ _ _ _ _ _ _ _ _ h
  exact this

theorem mem_sortRows {order desc rs r} (h : r ∈ sortRows order desc rs) : r ∈ rs := by
  unfold sortRows at h
  have hp := List.mergeSort_perm rs (keyLe order)
  split at h
  · exact hp.mem_iff.1 (List.mem_reverse.1 h)
  · exact hp.mem_iff.1 h

theorem mem_candidates {vw t ps order desc cur r} (h : r ∈ candidates vw t ps order desc cur) :
    r ∈ vw t := by
  unfold candidates afterCursor at h
  split at h
  · exact (List.mem_filter.1 (mem_sortRows h)).1
  · exact (List.mem_filter.1 (mem_sortRows (List.mem_filter.1 h).1)).1

theorem markIf_run {b : Bool} {rs u rs'} (h : (markIf b).run rs = .ok (u, rs')) :
    (b = true → rs'.complete = false) ∧ (b = false → rs' = rs) := by
  unfold markIf at h
  split at h
  · rename_i hb
    simp only [markIncomplete, StateT.run, Except.ok.injEq] at h
    cases h; simp [hb]
  · rename_i hb; obtain ⟨-, h⟩ := pure_ok h; simp_all

/-- Every row a page returns is visible, and its `next` follows a visible row. -/
theorem pageRead_visible {cx vw t ps filt order desc take cur rs d nx rs'}
    (h : (pageRead cx vw t ps filt order desc take cur).run rs = .ok ((d, nx), rs')) :
    ∃ rows : List Row, d = .arr (rows.map Row.toValue) ∧ (∀ r ∈ rows, r ∈ vw t) ∧
      (nx = some .null ∨ ∃ r ∈ vw t, nx = some (keyValue (rowKey order r))) := by
  unfold pageRead at h
  obtain ⟨w, rs1, hw, h⟩ := sbind_ok h
  obtain ⟨hrows, hlast⟩ := walk_sub _ _ _ _ _ _ _ _ _ hw
  split at h
  · simp [refuse, StateT.run, throw, throwThe, MonadExceptOf.throw, StateT.lift] at h; cases h
  · obtain ⟨_, rs2, -, h⟩ := sbind_ok h
    obtain ⟨hv, -⟩ := pure_ok h
    simp only [pageAnswer, Prod.mk.injEq] at hv
    obtain ⟨rfl, rfl⟩ := hv
    refine ⟨w.rows, rfl, fun r hr => ?_, ?_⟩
    · rcases hrows r hr with h | h
      · cases h
      · exact mem_candidates h
    · split
      · exact .inl rfl
      · cases hl : w.last with
        | none => exact .inl rfl
        | some r =>
          rcases hlast r hl with h | h
          · cases h
          · exact .inr ⟨r, mem_candidates h, rfl⟩

/-- **No disclosure through pages**: over the store's view, every returned
row passes its table's read rule. -/
theorem page_rows_readable {cx sch s v t ps filt order desc take cur rs d nx rs'}
    (h : (pageRead cx (visibleRows sch s v) t ps filt order desc take cur).run rs = .ok ((d, nx), rs')) :
    ∃ rows : List Row, d = .arr (rows.map Row.toValue) ∧ ∀ r ∈ rows, r ∈ s t ∧ readable sch s v t r = true := by
  obtain ⟨rows, hd, hr, -⟩ := pageRead_visible h
  exact ⟨rows, hd, fun r hm => List.mem_filter.1 (hr r hm)⟩

/-- **Completeness soundness.** A page that leaves `complete` true returned
the first `take` qualifying visible candidates, and its scan was decided
(by its pins or a readable grant); `decided_store` says what that means
for the store's rows. -/
theorem pageRead_complete {cx vw t ps filt order desc take cur rs d nx rs'} (p : Row → Bool)
    (hf : FiltIs filt p)
    (h : (pageRead cx vw t ps filt order desc take cur).run rs = .ok ((d, nx), rs'))
    (hc : rs'.complete = true) :
    d = .arr ((((candidates vw t ps order desc cur).filter p).take take).map Row.toValue) ∧
      decided cx vw t ps = true := by
  unfold pageRead at h
  obtain ⟨w, rs1, hw, h⟩ := sbind_ok h
  split at h
  · simp [refuse, StateT.run, throw, throwThe, MonadExceptOf.throw, StateT.lift] at h; cases h
  · obtain ⟨_, rs2, hm, h⟩ := sbind_ok h
    obtain ⟨hv, hrs⟩ := pure_ok h
    simp only [pageAnswer, Prod.mk.injEq] at hv
    obtain ⟨rfl, rfl⟩ := hv
    subst hrs
    obtain ⟨hmark, -⟩ := markIf_run hm
    have hnot : ¬ ((w.stop = .cut || !(decided cx vw t ps)) = true) := by
      intro hb; rw [hmark hb] at hc; cases hc
    simp only [Bool.or_eq_true, decide_eq_true_eq, Bool.not_eq_true', not_or] at hnot
    have hrows := walk_complete _ p hf _ _ _ _ _ _ _ _ (by simp) hw hnot.1
    simp only [List.reverse_nil, List.nil_append, List.length_nil, Nat.sub_zero] at hrows
    refine ⟨by rw [hrows], ?_⟩
    cases hu : decided cx vw t ps
    · exact absurd hu hnot.2
    · rfl

/-- **A decided scan sees all of its rows or none.** Over the store's view,
when the scan is decided for the caller, either every row of the store its
pins select is readable to them (so the visible candidates are all the
candidates), or none is (the empty answer is the true one). Either way a
complete page hides nothing it claims to have covered. -/
theorem decided_store {cx : Ctx} {s : Store} {t : String} {ps : List (String × Scalar)}
    (hd : decided cx (visibleRows cx.schema s cx.viewer) t ps = true) :
    (∀ r ∈ s t, keyMatch ps r = true → readable cx.schema s cx.viewer t r = true) ∨
      (∀ r ∈ s t, keyMatch ps r = true → readable cx.schema s cx.viewer t r = false) := by
  unfold decided at hd
  rcases Bool.or_eq_true _ _ ▸ hd with hu | hg
  · by_cases hany : ∃ r ∈ s t, keyMatch ps r = true ∧ readable cx.schema s cx.viewer t r = true
    · obtain ⟨r0, -, hk0, hr0⟩ := hany
      exact .inl fun r _ hk => (uniform_readable_eq hu hk hk0).trans hr0
    · refine .inr fun r hr hk => ?_
      cases hrd : readable cx.schema s cx.viewer t r
      · rfl
      · exact absurd ⟨r, hr, hk, hrd⟩ hany
  · exact .inl fun r _ _ => granted_readable hg r

/-- **A complete page covers the store**: the combination of
`pageRead_complete` and `decided_store`. -/
theorem pageRead_complete_store {cx s t ps filt order desc take cur rs d nx rs'} (p : Row → Bool)
    (hf : FiltIs filt p)
    (h : (pageRead cx (visibleRows cx.schema s cx.viewer) t ps filt order desc take cur).run rs = .ok ((d, nx), rs'))
    (hc : rs'.complete = true) :
    d = .arr ((((candidates (visibleRows cx.schema s cx.viewer) t ps order desc cur).filter p).take take).map Row.toValue) ∧
      ((∀ r ∈ s t, keyMatch ps r = true → readable cx.schema s cx.viewer t r = true) ∨
        (∀ r ∈ s t, keyMatch ps r = true → readable cx.schema s cx.viewer t r = false)) :=
  let ⟨hd, hdec⟩ := pageRead_complete p hf h hc
  ⟨hd, decided_store hdec⟩

/-- **What a count reveals**: exactly the number of visible rows of the
domain that match its filter. -/
theorem countRead_eq {cx vw t ps filt rs d nx rs'} (p : Row → Bool) (hf : FiltIs filt p)
    (h : (countRead cx vw t ps filt).run rs = .ok ((d, nx), rs')) :
    d = .ofInt ((candidates vw t ps [] false none).filter p).length := by
  unfold countRead at h
  obtain ⟨w, rs1, hw, h⟩ := sbind_ok h
  split at h
  · unfold cutScalar at h
    split at h <;>
      simp [refuse, StateT.run, throw, throwThe, MonadExceptOf.throw, StateT.lift] at h <;> cases h
  · rename_i hcut
    obtain ⟨hv, -⟩ := pure_ok h
    simp only [Prod.mk.injEq] at hv
    obtain ⟨rfl, -⟩ := hv
    have hrows := walk_complete _ p hf _ _ _ _ _ _ _ _ (by simp) hw (by simpa using hcut)
    simp only [List.reverse_nil, List.nil_append, List.length_nil, Nat.sub_zero] at hrows
    rw [hrows, List.take_of_length_le]
    exact Nat.le_succ_of_le (List.length_filter_le _ _)

theorem take_one_filter_isEmpty (p : Row → Bool) :
    ∀ l : List Row, ((l.filter p).take 1).isEmpty = !(l.any p) := by
  intro l
  induction l with
  | nil => rfl
  | cons a l ih =>
    by_cases hp : p a = true
    · simp [hp]
    · simp only [Bool.not_eq_true] at hp
      simp [hp, ih]

theorem undecidedScalar_not_ok {α : Type} {cx : Ctx} {rs : RS} {r : α × RS}
    (h : (undecidedScalar cx : EM α).run rs = .ok r) : False := by
  unfold undecidedScalar at h
  split at h <;>
    simp [refuse, StateT.run, throw, throwThe, MonadExceptOf.throw, StateT.lift] at h <;> cases h

theorem cutScalar_not_ok {α : Type} {cx : Ctx} {rs : RS} {r : α × RS}
    (h : (cutScalar cx : EM α).run rs = .ok r) : False := by
  unfold cutScalar at h
  split at h <;>
    simp [refuse, StateT.run, throw, throwThe, MonadExceptOf.throw, StateT.lift] at h <;> cases h

/-- `exists domain` is true exactly when a visible row of the domain
matches, whenever it answers (an undecided absence has no answer). -/
theorem existsRead_eq {cx vw t ps filt rs d nx rs'} (p : Row → Bool) (hf : FiltIs filt p)
    (h : (existsRead cx vw t ps filt).run rs = .ok ((d, nx), rs')) :
    d = .ofBool ((candidates vw t ps [] false none).any p) := by
  unfold existsRead at h
  obtain ⟨w, rs1, hw, h⟩ := sbind_ok h
  split at h
  · exact (cutScalar_not_ok h).elim
  · rename_i hcut
    have hrows := walk_complete _ p hf _ _ _ _ _ _ _ _ (by simp) hw (by simpa using hcut)
    simp only [List.reverse_nil, List.nil_append, List.length_nil, Nat.sub_zero] at hrows
    have hany : (candidates vw t ps [] false none).any p = !w.rows.isEmpty := by
      rw [hrows, take_one_filter_isEmpty, Bool.not_not]
    split at h
    · rename_i hempty
      split at h
      · obtain ⟨hv, -⟩ := pure_ok h
        simp only [Prod.mk.injEq] at hv
        rw [hv.1, hany, hempty]; rfl
      · exact (undecidedScalar_not_ok h).elim
    · rename_i hne
      obtain ⟨_, rs2, -, h⟩ := sbind_ok h
      obtain ⟨hv, -⟩ := pure_ok h
      simp only [Prod.mk.injEq] at hv
      rw [hv.1, hany]
      simp [hne]

/-- **An `exists` never answers `false` from an undecided scan** (LLP
3000.036 §15.12), and a complete one was decided: either the scan was
decided for the caller, or the answer is `true` (a visible witness) and
the request is incomplete. -/
theorem existsRead_decided {cx vw t ps filt rs d nx rs'}
    (h : (existsRead cx vw t ps filt).run rs = .ok ((d, nx), rs')) :
    decided cx vw t ps = true ∨ (d = .ofBool true ∧ rs'.complete = false) := by
  unfold existsRead at h
  obtain ⟨w, rs1, hw, h⟩ := sbind_ok h
  split at h
  · exact (cutScalar_not_ok h).elim
  · split at h
    · split at h
      · rename_i hdec; exact .inl hdec
      · exact (undecidedScalar_not_ok h).elim
    · cases hdec : decided cx vw t ps
      · obtain ⟨_, rs2, hm, h⟩ := sbind_ok h
        obtain ⟨hv, hrs⟩ := pure_ok h
        simp only [Prod.mk.injEq] at hv
        obtain ⟨hmark, -⟩ := markIf_run hm
        subst hrs
        exact .inr ⟨hv.1, hmark (by simp [hdec])⟩
      · exact .inl rfl

/-! ## Hidden rows -/

theorem Rule.eval_set {s : Store} {t : String} {x : List Row} {v : List Nat} {im : Imgs} :
    ∀ (r : Rule), t ∉ r.probes → r.eval (s.set t x) v im = r.eval s v im := by
  intro r
  induction r with
  | probe t' key =>
    intro hn
    simp only [Rule.probes, List.mem_singleton] at hn
    simp only [Rule.eval, Store.set, Ne.symm hn, ite_false]
  | and a b iha ihb =>
    intro hn; simp only [Rule.probes, List.mem_append, not_or] at hn
    simp only [Rule.eval, iha hn.1, ihb hn.2]
  | or a b iha ihb =>
    intro hn; simp only [Rule.probes, List.mem_append, not_or] at hn
    simp only [Rule.eval, iha hn.1, ihb hn.2]
  | not a ih =>
    intro hn; simp only [Rule.probes] at hn
    simp only [Rule.eval, ih hn]
  | _ => intro _; rfl

theorem readable_set {sch : Schema} {s : Store} {t : String} {x : List Row} {v : List Nat}
    (hnp : ∀ td ∈ sch.tables, t ∉ td.read.probes) (t' : String) (r : Row) :
    readable sch (s.set t x) v t' r = readable sch s v t' r := by
  unfold readable
  split
  · rename_i td htd
    exact Rule.eval_set _ (hnp td (List.mem_of_find?_eq_some htd))
  · rfl

/-- Inserting a row the viewer cannot read, into a table no read rule probes,
leaves every table's visible rows unchanged. -/
theorem visibleRows_insert_hidden {sch : Schema} {s : Store} {v : List Nat} {t : String} {r : Row}
    (hnp : ∀ td ∈ sch.tables, t ∉ td.read.probes)
    (hr : readable sch (s.insertRow t r) v t r = false) :
    visibleRows sch (s.insertRow t r) v = visibleRows sch s v := by
  funext t'
  unfold visibleRows
  have hf : readable sch (s.insertRow t r) v t' = readable sch s v t' :=
    funext (readable_set (x := s t ++ [r]) hnp t')
  have hr' : readable sch s v t r = false := by
    rw [← (readable_set (x := s t ++ [r]) hnp t r)]; exact hr
  rw [hf]
  by_cases ht : t' = t
  · subst ht
    simp only [Store.insertRow, Store.set, ite_true, List.filter_append]
    simp [hr']
  · simp only [Store.insertRow, Store.set, ht, ite_false]

/-- **A hidden row changes no query outcome.** -/
theorem query_ignores_hidden_insert {c : Case} (hk : c.program.kind = .query) {t : String} {r : Row}
    (hnp : ∀ td ∈ c.schema.tables, t ∉ td.read.probes)
    (hr : readable c.schema (c.store.insertRow t r) c.viewer t r = false) :
    run { c with store := c.store.insertRow t r } = run c :=
  query_noninterference (s2 := c.store) hk (visibleRows_insert_hidden hnp hr)

end Quarry
