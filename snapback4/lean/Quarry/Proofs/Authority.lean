import Quarry.Run

/-!
# Write authority

**No write succeeds unless the corresponding rule holds.** A successful write
either leaves the store unchanged (`insert … if absent` on a visible clash)
or is one authorized `Step`: an insert whose insert rule admits the new
image, an update whose update rule admits (old, next) for a row that exists,
or a delete whose delete rule admits the row. Rules are evaluated in the
store as it stood immediately before that write (`applyWrite_authorized`).

A whole mutation's store transition is a chain of such steps
(`mutation_authorized`).
-/

namespace Quarry

inductive Step (sch : Schema) (v : List Nat) : Store → Store → Prop
  | insert {s : Store} {t : String} {td : TableDecl} {r : Row} :
      sch.table? t = some td → td.insert.eval s v { self := some r } = true →
      Step sch v s (s.insertRow t r)
  | update {s : Store} {t : String} {td : TableDecl} {old nw : Row} :
      sch.table? t = some td → old ∈ s t →
      td.update.eval s v { old := some old, next := some nw } = true →
      Step sch v s (s.replaceRow t old nw)
  /-- A delete whose delete rule admits the row, with the referential
  actions the schema declares on the rows naming it (LLP 3000.038 §4.1: the
  parent's delete authorizes a declared cascade or set null). -/
  | delete {s s' : Store} {t : String} {td : TableDecl} {old : Row} :
      sch.table? t = some td → old ∈ s t → td.delete.eval s v { self := some old } = true →
      refDelete sch s t old = .ok s' →
      Step sch v s s'

inductive Steps (sch : Schema) (v : List Nat) : Store → Store → Prop
  | refl (s : Store) : Steps sch v s s
  | step {s s' s'' : Store} : Step sch v s s' → Steps sch v s' s'' → Steps sch v s s''

theorem Steps.trans {sch v} {a b d : Store} (h1 : Steps sch v a b) (h2 : Steps sch v b d) :
    Steps sch v a d := by
  induction h1 with
  | refl => exact h2
  | step h _ ih => exact .step h (ih h2)

theorem Steps.of_step_or_eq {sch v} {a b : Store} (h : b = a ∨ Step sch v a b) : Steps sch v a b := by
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

theorem doInsertImage_ok {sch s v t td img ifAbsent d c val s'}
    (h : doInsertImage sch s v t td img ifAbsent d c = .ok (val, s')) :
    s' = s ∨ (td.insert.eval s v { self := some img } = true ∧ s' = s.insertRow t img) := by
  unfold doInsertImage at h
  obtain ⟨_, hg, h⟩ := bind_ok h
  split at h
  · obtain ⟨_, -, h⟩ := bind_ok h
    split at h
    · cases h; exact .inl rfl
    · cases h
  · cases h; exact .inr ⟨guardE_ok hg, rfl⟩

theorem doUpdateRow_ok {sch s v t td old patch cond val s'}
    (h : doUpdateRow sch s v t td old patch cond = .ok (val, s')) :
    ∃ nw, td.update.eval s v { old := some old, next := some nw } = true ∧
      s' = s.replaceRow t old nw := by
  unfold doUpdateRow at h
  obtain ⟨nw, -, h⟩ := bind_ok h
  obtain ⟨_, hg, h⟩ := bind_ok h
  obtain ⟨_, -, h⟩ := bind_ok h
  obtain ⟨_, -, h⟩ := bind_ok h
  cases h
  exact ⟨nw, guardE_ok hg, rfl⟩

/-- **Referential actions change nothing a schema does not declare**
(LLP 3000.038 §1): a delete from a table no action-carrying reference names
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
    (h : applyWrite cx s rw = .ok (val, s')) : s' = s ∨ Step cx.schema cx.viewer s s' := by
  cases rw with
  | insert t fields ifAbsent =>
    simp only [applyWrite] at h
    split at h
    · cases h
    · rename_i td htd
      obtain ⟨_, -, h⟩ := bind_ok h
      obtain ⟨_, -, h⟩ := bind_ok h
      obtain ⟨img, -, h⟩ := bind_ok h
      rcases doInsertImage_ok h with h | ⟨hr, h⟩
      · exact .inl h
      · subst h; exact .inr (.insert htd hr)
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
        obtain ⟨nw, hr, h⟩ := doUpdateRow_ok h
        subst h; exact .inr (.update htd (findRow_mem hold) hr)
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
        subst h; exact .inr (.update htd (findRow_mem hold) hr)
      · obtain ⟨_, -, h⟩ := bind_ok h
        obtain ⟨img, -, h⟩ := bind_ok h
        rcases doInsertImage_ok h with h | ⟨hr, h⟩
        · exact .inl h
        · subst h; exact .inr (.insert htd hr)
  | delete t key =>
    simp only [applyWrite] at h
    split at h
    · cases h
    · rename_i td htd
      obtain ⟨_, -, h⟩ := bind_ok h
      split at h
      · cases h
      · rename_i old hold
        obtain ⟨_, hg, h⟩ := bind_ok h
        obtain ⟨_, -, h⟩ := bind_ok h
        obtain ⟨s2, hd, h⟩ := bind_ok h
        cases h
        exact .inr (.delete htd (findRow_mem hold) (guardE_ok hg) hd)

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

/-- **Write authority, whole mutation.** Every committed mutation's store is
reached from the original by a chain of authorized steps. -/
theorem mutation_authorized {c : Case} {res : Value} {s' : Store}
    (hk : c.program.kind = .mutation) (h : run c = .committed res s') :
    Steps c.schema c.viewer c.store s' := by
  simp only [run, hk, runMutation] at h
  split at h
  · cases h
  · cases h
  · split at h
    · rename_i fl s1 env1 rs1 hx
      cases h
      exact execStmts_inv storeHooks c.ctx (Steps c.schema c.viewer) Steps.refl
        (fun _ _ _ => Steps.trans)
        (fun w rw val w' happ => Steps.of_step_or_eq (applyWrite_authorized (cx := c.ctx) happ))
        _ _ _ _ _ _ _ _ _ hx
    · cases h
    · cases h

end Quarry
