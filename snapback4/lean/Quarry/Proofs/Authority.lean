import Quarry.Run

/-!
# Write authority

**No write succeeds unless the corresponding rule holds.** A successful write
either leaves the store unchanged (`insert … if absent` on a visible clash)
or is one authorized `Step`: an insert whose insert rule admits the new
image, an update whose update rule admits (old, next) for a row that exists,
or a delete whose delete rule admits the row. Rules are evaluated in the
opened projection of the store as it stood immediately before that write
(`applyWrite_authorized`).

A whole mutation's store transition is a chain of such steps
(`mutation_authorized`).
-/

namespace Quarry

inductive Step (sch : Schema) (v : List Nat) (now : Int) : Store → Store → Prop
  | insert {s : Store} {t : String} {td : TableDecl} {r : Row} :
      sch.table? t = some td → td.insert.eval (openedStore sch s now) v { self := some r } = true →
      Step sch v now s (s.insertRow t r)
  | update {s : Store} {t : String} {td : TableDecl} {old nw : Row} :
      sch.table? t = some td → old ∈ s t →
      td.update.eval (openedStore sch s now) v { old := some old, next := some nw } = true →
      Step sch v now s (s.replaceRow t old nw)
  /-- A delete whose delete rule admits the row, with the referential
  actions the schema declares on the rows naming it (LLP 3000.039 §4.1: the
  parent's delete authorizes a declared cascade or set null). -/
  | delete {s s' : Store} {t : String} {td : TableDecl} {old : Row} :
      sch.table? t = some td → old ∈ s t →
      td.delete.eval (openedStore sch s now) v { self := some old } = true →
      refDeleteFrom sch (unexpiredStore sch s now) s t old = .ok s' →
      Step sch v now s s'
  /-- An expired same-id row is retired inside an insert transaction before
  the replacement image's remaining constraints are checked. -/
  | retire {s s' : Store} {t : String} {td : TableDecl} {old : Row} :
      sch.table? t = some td → old ∈ s t → expired td now old = true →
      refDeleteFrom sch (unexpiredStore sch s now) s t old = .ok s' →
      Step sch v now s s'
  /-- A same-id replacement is one authorized transition: its insert rule is
  checked against the pre-retirement store, then the expired predecessor's
  actions run, then the new image is inserted. -/
  | replaceExpired {s retired : Store} {t : String} {td : TableDecl} {old img : Row} :
      sch.table? t = some td → old ∈ s t → expired td now old = true →
      td.insert.eval (openedStore sch s now) v { self := some img } = true →
      refDeleteFrom sch (unexpiredStore sch s now) s t old = .ok retired →
      Step sch v now s (retired.insertRow t img)

inductive Steps (sch : Schema) (v : List Nat) (now : Int) : Store → Store → Prop
  | refl (s : Store) : Steps sch v now s s
  | step {s s' s'' : Store} : Step sch v now s s' → Steps sch v now s' s'' → Steps sch v now s s''

theorem Steps.trans {sch v now} {a b d : Store} (h1 : Steps sch v now a b) (h2 : Steps sch v now b d) :
    Steps sch v now a d := by
  induction h1 with
  | refl => exact h2
  | step h _ ih => exact .step h (ih h2)

theorem Steps.of_step_or_eq {sch v now} {a b : Store} (h : b = a ∨ Step sch v now a b) : Steps sch v now a b := by
  rcases h with h | h
  · subst h; exact .refl _
  · exact .step h (.refl _)

theorem bind_ok {ε α β : Type} {x : Except ε α} {f : α → Except ε β} {b : β}
    (h : (x >>= f) = .ok b) : ∃ a, x = .ok a ∧ f a = .ok b := by
  cases x with
  | error e => cases h
  | ok a => exact ⟨a, rfl, h⟩

theorem guardE_ok {b : Bool} {e : Stop} {u : Unit} (h : guardE b e = .ok u) : b = true := by
  unfold guardE at h; split at h <;> simp_all

theorem findRow_mem {rows : List Row} {ks} {r : Row} (h : findRow rows ks = some r) : r ∈ rows := by
  unfold findRow at h
  split at h
  · cases h
  · exact List.mem_of_find?_eq_some h

theorem doInsertImage_ok {sch : Schema} {s : Store} {v : List Nat} {now : Int}
    {t : String} {td : TableDecl} {img : Row} {clashHidden : Stop}
    {val : Value} {s' : Store}
    (h : doInsertImage sch s v now t td img clashHidden = .ok (val, s')) :
    s' = s.insertRow t img := by
  unfold doInsertImage at h
  split at h
  · obtain ⟨_, -, h⟩ := bind_ok h
    cases h
  · cases h; rfl

theorem doUpdateRow_ok {sch s v now t td old patch cond val s'}
    (h : doUpdateRow sch s v now t td old patch cond = .ok (val, s')) :
    ∃ nw, td.update.eval (openedStore sch s now) v { old := some old, next := some nw } = true ∧
      s' = s.replaceRow t old nw := by
  unfold doUpdateRow at h
  obtain ⟨nw, -, h⟩ := bind_ok h
  obtain ⟨_, hg, h⟩ := bind_ok h
  obtain ⟨_, -, h⟩ := bind_ok h
  obtain ⟨_, -, h⟩ := bind_ok h
  cases h
  exact ⟨nw, guardE_ok hg, rfl⟩

theorem retireExpiredSameId_result {sch : Schema} {s s' : Store} {now : Int}
    {t : String} {td : TableDecl} {rid : List Nat}
    (h : retireExpiredSameId sch s now t td rid = .ok s') :
    s' = s ∨ ∃ old, old ∈ s t ∧ expired td now old = true ∧
      refDeleteFrom sch (unexpiredStore sch s now) s t old = .ok s' := by
  unfold retireExpiredSameId at h
  split at h
  · rename_i old hold
    split at h
    · rename_i hexp
      exact .inr ⟨old, findRow_mem hold, hexp, h⟩
    · cases h
      exact .inl rfl
  · cases h
    exact .inl rfl

theorem retireExpiredSameId_steps {sch s s' v now t td rid}
    (ht : sch.table? t = some td)
    (h : retireExpiredSameId sch s now t td rid = .ok s') :
    Steps sch v now s s' := by
  rcases retireExpiredSameId_result h with h | ⟨old, hold, hexp, href⟩
  · subst h; exact .refl _
  · exact .step (.retire ht hold hexp href) (.refl _)

theorem retireThenInsert_authorized {sch : Schema} {s s0 s' : Store} {v : List Nat}
    {now : Int} {t : String} {td : TableDecl} {rid : List Nat} {img : Row}
    {clashHidden : Stop} {val : Value}
    (ht : sch.table? t = some td)
    (ha : td.insert.eval (openedStore sch s now) v { self := some img } = true)
    (hr : retireExpiredSameId sch s now t td rid = .ok s0)
    (hi : doInsertImage sch s0 v now t td img clashHidden = .ok (val, s')) :
    Steps sch v now s s' := by
  have hi := doInsertImage_ok hi
  subst hi
  rcases retireExpiredSameId_result hr with hs | ⟨old, hold, hexp, href⟩
  · subst hs
    exact .step (.insert ht ha) (.refl _)
  · exact .step (.replaceExpired ht hold hexp ha href) (.refl _)

/-- **Referential actions change nothing a schema does not declare**
(LLP 3000.039 §1): a delete from a table no action-carrying reference names
removes exactly that row, as every delete did before. -/
theorem refDelete_without_actions {sch : Schema} {s : Store} {t : String} {old : Row}
    (h : referencing sch t = []) : refDelete sch s t old = .ok (s.removeRow t old) := by
  have hk : cascadeKids sch s t old = [] := by simp [cascadeKids, h]
  have hc : ∀ f, closure sch s (f + 1) [(t, old)] [(t, old)] = [(t, old)] := by
    intro f; cases f <;> simp [closure, hk]
  simp only [refDelete, hc, restricted, setNulls, List.any_cons, List.any_nil, List.foldl_cons, List.foldl_nil]
  simp [h, pure, Except.pure]

/-- **Write authority, one write.** -/
theorem applyWrite_authorized {cx : Ctx} {s s' : Store} {rw : RWrite} {val : Value}
    (h : applyWrite cx s rw = .ok (val, s')) : Steps cx.schema cx.viewer cx.now s s' := by
  cases rw with
  | insert t fields ifAbsent =>
    simp only [applyWrite] at h
    split at h
    · cases h
    · rename_i td htd
      obtain ⟨_, -, h⟩ := bind_ok h
      obtain ⟨_, -, h⟩ := bind_ok h
      obtain ⟨img, -, h⟩ := bind_ok h
      obtain ⟨_, hg, h⟩ := bind_ok h
      cases ifAbsent with
      | false =>
        simp only [Bool.false_eq_true, ite_false] at h
        obtain ⟨s0, hr, h⟩ := bind_ok h
        exact retireThenInsert_authorized htd (guardE_ok hg) hr h
      | true =>
        simp only [ite_true] at h
        obtain ⟨clashes, -, h⟩ := bind_ok h
        cases clashes with
        | false =>
          simp only [Bool.false_eq_true, ite_false] at h
          obtain ⟨s0, hr, h⟩ := bind_ok h
          exact retireThenInsert_authorized htd (guardE_ok hg) hr h
        | true =>
          simp only [ite_true] at h
          cases h
          exact .refl _
  | update t key patch cond =>
    simp only [applyWrite] at h
    split at h
    · cases h
    · rename_i td htd
      obtain ⟨_, -, h⟩ := bind_ok h
      obtain ⟨_, -, h⟩ := bind_ok h
      split at h
      · cases h
      · rename_i old hold
        obtain ⟨_, -, h⟩ := bind_ok h
        obtain ⟨nw, hr, h⟩ := doUpdateRow_ok h
        subst h; exact .step (.update htd (findRow_mem hold) hr) (.refl _)
  | upsert t key patch =>
    simp only [applyWrite] at h
    split at h
    · cases h
    · rename_i td htd
      obtain ⟨_, -, h⟩ := bind_ok h
      obtain ⟨_, -, h⟩ := bind_ok h
      split at h
      · rename_i old hold
        obtain ⟨nw, hr, h⟩ := doUpdateRow_ok h
        subst h
        exact .step (.update htd (List.mem_filter.1 (findRow_mem hold)).1 hr) (.refl _)
      · obtain ⟨_, -, h⟩ := bind_ok h
        obtain ⟨img, -, h⟩ := bind_ok h
        obtain ⟨_, hg, h⟩ := bind_ok h
        obtain ⟨s0, hrs, h⟩ := bind_ok h
        exact retireThenInsert_authorized htd (guardE_ok hg) hrs h
  | delete t key =>
    simp only [applyWrite] at h
    split at h
    · cases h
    · rename_i td htd
      obtain ⟨_, -, h⟩ := bind_ok h
      split at h
      · cases h
      · rename_i old hold
        obtain ⟨_, -, h⟩ := bind_ok h
        obtain ⟨_, hg, h⟩ := bind_ok h
        obtain ⟨_, -, h⟩ := bind_ok h
        obtain ⟨s2, hd, h⟩ := bind_ok h
        cases h
        exact .step (.delete htd (findRow_mem hold) (guardE_ok hg) hd) (.refl _)

end Quarry

namespace Quarry

theorem sbind_ok {α β : Type} {x : EM α} {f : α → EM β} {rs : RS} {r : β × RS}
    (h : (x >>= f).run rs = .ok r) : ∃ a rs1, x.run rs = .ok (a, rs1) ∧ (f a).run rs1 = .ok r := by
  simp only [StateT.run_bind] at h
  obtain ⟨⟨a, rs1⟩, h1, h2⟩ := bind_ok h
  exact ⟨a, rs1, h1, h2⟩

theorem liftE_ok {α : Type} {x : Except Stop α} {rs : RS} {a : α} {rs' : RS}
    (h : (liftE x).run rs = .ok (a, rs')) : x = .ok a := by
  unfold liftE at h
  cases x with
  | error e => cases h
  | ok b => simp [StateT.run, Except.map] at h; rw [h.1]

/-- Statement execution changes the world only through `Hooks.apply`: any
relation on worlds that is reflexive, transitive and contains every applied
write contains the whole execution. -/
theorem execStmts_inv {W : Type} (H : Hooks W) (cx : Ctx) (R : W → W → Prop) (hrefl : ∀ w, R w w)
    (htrans : ∀ a b d, R a b → R b d → R a d)
    (happ : ∀ w rw val w', H.apply cx w rw = .ok (val, w') → R w w') :
    ∀ fuel w env ss rs fl w' env' rs',
      (execStmts H fuel cx w env ss).run rs = .ok ((fl, w', env'), rs') → R w w' := by
  intro fuel
  induction fuel with
  | zero =>
    intro w env ss rs fl w' env' rs' h
    simp [execStmts, refuse, StateT.run, throw, throwThe, MonadExceptOf.throw, StateT.lift] at h
    cases h
  | succ fuel ih =>
    intro w env ss rs fl w' env' rs' h
    cases ss with
    | nil =>
      simp only [execStmts, StateT.run, pure, StateT.pure, Except.pure] at h
      cases h; exact hrefl w
    | cons s ss =>
      cases s with
      | assign x e =>
        simp only [execStmts] at h
        obtain ⟨p, rs1, -, h⟩ := sbind_ok h
        exact ih _ _ _ _ _ _ _ _ h
      | require c code =>
        simp only [execStmts] at h
        obtain ⟨⟨v, _⟩, rs1, -, h⟩ := sbind_ok h
        obtain ⟨b, rs2, -, h⟩ := sbind_ok h
        split at h
        · exact ih _ _ _ _ _ _ _ _ h
        · simp [refuse, StateT.run, throw, throwThe, MonadExceptOf.throw, StateT.lift] at h; cases h
      | ret e =>
        simp only [execStmts] at h
        obtain ⟨⟨v, nx⟩, rs1, -, h⟩ := sbind_ok h
        simp only [StateT.run, pure, StateT.pure, Except.pure] at h
        cases h; exact hrefl w
      | ite c th el =>
        simp only [execStmts] at h
        obtain ⟨⟨v, _⟩, rs1, -, h⟩ := sbind_ok h
        obtain ⟨b, rs2, -, h⟩ := sbind_ok h
        obtain ⟨⟨fl1, w1, env1⟩, rs3, h1, h⟩ := sbind_ok h
        have r1 := ih _ _ _ _ _ _ _ _ h1
        split at h
        · simp only [StateT.run, pure, StateT.pure, Except.pure] at h
          cases h; exact r1
        · exact htrans _ _ _ r1 (ih _ _ _ _ _ _ _ _ h)
      | write bind op =>
        simp only [execStmts] at h
        obtain ⟨rs0, rs1, -, h⟩ := sbind_ok h
        obtain ⟨rw, rs2, -, h⟩ := sbind_ok h
        obtain ⟨⟨val, w1⟩, rs3, h1, h⟩ := sbind_ok h
        exact htrans _ _ _ (happ _ _ _ _ (liftE_ok h1)) (ih _ _ _ _ _ _ _ _ h)

theorem mutationHooks_apply_authorized {cx : Ctx} {w w' : MutationWorld}
    {rw : RWrite} {val : Value}
    (h : mutationHooks.apply cx w rw = .ok (val, w')) :
    Steps cx.schema cx.viewer cx.now w.store w'.store := by
  change (match applyWrite cx w.store rw with
    | Except.error e => Except.error e
    | Except.ok (value, store) =>
      let changed := w.changed ++ changedFinalRows cx.schema w.store store
      let changed := match rw.changedExplicitId? cx w.store with
        | some address => changed ++ [address]
        | none => changed
      Except.ok (value, { store, changed := changed.eraseDups })) = Except.ok (val, w') at h
  split at h
  · cases h
  · rename_i result store happ
    cases h
    exact applyWrite_authorized happ

/-- Commit-end expiry retirement is a chain of referential-action retirement
steps. Rows absent from the final store and rows whose final image is live are
identity transitions. -/
theorem retireExpiredChanged_steps {sch : Schema} {v : List Nat} {now : Int}
    (changed : ChangedRows) : ∀ s s',
    retireExpiredChanged sch now s changed = .ok s' → Steps sch v now s s' := by
  induction changed with
  | nil =>
    intro s s' h
    simp only [retireExpiredChanged, pure, Except.pure] at h
    cases h
    exact .refl _
  | cons address rest ih =>
    rcases address with ⟨t, rid⟩
    intro s s' h
    simp only [retireExpiredChanged] at h
    split at h
    · exact ih _ _ h
    · rename_i td htd
      split at h
      · exact ih _ _ h
      · rename_i row hrow
        split at h
        · rename_i hexp
          obtain ⟨s1, href, hrest⟩ := bind_ok h
          exact .step (.retire htd (findRow_mem hrow) hexp href) (ih _ _ hrest)
        · exact ih _ _ h

/-- **Write authority, whole mutation.** Every committed mutation's store is
reached from the original by a chain of authorized writes followed by the
transactional retirement of final images that were born or updated expired. -/
theorem mutation_authorized {c : Case} {res : Value} {s' : Store}
    (hk : c.program.kind = .mutation) (hs : c.sweepOnly = false)
    (h : run c = .committed res s') :
    Steps c.schema c.viewer c.now c.store s' := by
  simp [run, hs, hk, runMutation] at h
  split at h
  · cases h
  · cases h
  · split at h
    · rename_i fl w env1 rs1 hx
      split at h
      · rename_i hret
        cases h
        have hbody : Steps c.schema c.viewer c.now c.store w.store :=
          execStmts_inv mutationHooks c.ctx
            (fun a b => Steps c.schema c.viewer c.now a.store b.store)
            (fun _ => Steps.refl _) (fun _ _ _ => Steps.trans)
            (fun _ _ _ _ happ => mutationHooks_apply_authorized happ)
            _ _ _ _ _ _ _ _ _ hx
        exact hbody.trans (retireExpiredChanged_steps w.changed w.store s' hret)
      · cases h
      · cases h
    · cases h
    · cases h

end Quarry
