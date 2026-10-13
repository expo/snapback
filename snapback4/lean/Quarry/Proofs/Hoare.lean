import Quarry.Proofs.Authority

/-!
# Axiomatic rules for statements

Hoare-style rules, each proved sound against `execStmts`. A triple
`Triple H cx P ss Q` is partial correctness with refusals as aborts: if `P`
holds of the world, locals and request state, and executing `ss` finishes
(normally or by `return`), then `Q` holds of the flow, world, locals and
request state. A refusal, unavailability or fuel exhaustion establishes
nothing.

The rules are in continuation form (`{P} s; ss {Q}` from `{R} ss {Q}`),
which suits a language whose `return` leaves the block. `Ev` is "this
expression evaluates to this value" at some fuel.
-/

namespace Quarry

def Triple {W : Type} (H : Hooks W) (cx : Ctx) (P : W → Env → RS → Prop) (ss : List Stmt)
    (Q : Flow → W → Env → RS → Prop) : Prop :=
  ∀ fuel w env rs fl w' env' rs', P w env rs →
    (execStmts H fuel cx w env ss).run rs = .ok ((fl, w', env'), rs') → Q fl w' env' rs'

def Ev {W : Type} (H : Hooks W) (cx : Ctx) (w : W) (env : Env) (rs : RS) (e : Expr)
    (v : Value) (nx : Option Value) (rs' : RS) : Prop :=
  ∃ n, (evalExpr n cx (H.view cx w) env none e).run rs = .ok ((v, nx), rs')

def bindEnv (bind : Option String) (v : Value) (env : Env) : Env :=
  match bind with
  | some x => (x, (v, none)) :: env
  | none => env

section
variable {W : Type} (H : Hooks W) (cx : Ctx)

theorem refuse_run {α : Type} {code : String} {rs : RS} :
    (refuse code : EM α).run rs = .error (.refuse code) := rfl

theorem exec_zero {w env ss rs r} (h : (execStmts H 0 cx w env ss).run rs = .ok r) : False := by
  have : execStmts H 0 cx w env ss = refuse "E_MODEL_FUEL" := by simp [execStmts]
  rw [this, refuse_run] at h; cases h

theorem asBool_ok {v : Value} {rs b rs'} (h : (asBool v).run rs = .ok (b, rs')) :
    v = .ofBool b ∧ rs' = rs := by
  unfold asBool at h
  split at h
  · simp [StateT.run, pure, StateT.pure, Except.pure] at h
    exact ⟨by rw [h.1]; rfl, h.2.symm⟩
  · rw [typeErr, refuse_run] at h; cases h

theorem triple_conseq {P P' : W → Env → RS → Prop} {Q Q' : Flow → W → Env → RS → Prop} {ss}
    (hp : ∀ w env rs, P w env rs → P' w env rs) (ht : Triple H cx P' ss Q')
    (hq : ∀ fl w env rs, Q' fl w env rs → Q fl w env rs) : Triple H cx P ss Q :=
  fun fuel w env rs fl w' env' rs' hP h => hq _ _ _ _ (ht fuel w env rs fl w' env' rs' (hp _ _ _ hP) h)

theorem triple_nil {P : W → Env → RS → Prop} :
    Triple H cx P [] (fun fl w env rs => (match fl with | .normal => True | .ret .. => False) ∧ P w env rs) := by
  intro fuel w env rs fl w' env' rs' hP h
  cases fuel with
  | zero => exact (exec_zero H cx h).elim
  | succ n =>
    simp only [execStmts, StateT.run, pure, StateT.pure, Except.pure, Except.ok.injEq,
      Prod.mk.injEq] at h
    obtain ⟨⟨rfl, rfl, rfl⟩, rfl⟩ := h
    exact ⟨trivial, hP⟩

theorem triple_assign {R : W → Env → RS → Prop} {Q} {x : String} {e : Expr} {ss}
    (ht : Triple H cx R ss Q) :
    Triple H cx (fun w env rs => ∀ v nx rs', Ev H cx w env rs e v nx rs' → R w ((x, (v, nx)) :: env) rs')
      (.assign x e :: ss) Q := by
  intro fuel w env rs fl w' env' rs' hP h
  cases fuel with
  | zero => exact (exec_zero H cx h).elim
  | succ n =>
    simp only [execStmts] at h
    obtain ⟨⟨v, nx⟩, rs1, he, h⟩ := sbind_ok h
    exact ht _ _ _ _ _ _ _ _ (hP v nx rs1 ⟨n, he⟩) h

theorem triple_require {R : W → Env → RS → Prop} {Q} {c : Expr} {code : String} {ss}
    (ht : Triple H cx R ss Q) :
    Triple H cx (fun w env rs => ∀ nx rs', Ev H cx w env rs c (.ofBool true) nx rs' → R w env rs')
      (.require c code :: ss) Q := by
  intro fuel w env rs fl w' env' rs' hP h
  cases fuel with
  | zero => exact (exec_zero H cx h).elim
  | succ n =>
    simp only [execStmts] at h
    obtain ⟨⟨v, nx⟩, rs1, he, h⟩ := sbind_ok h
    obtain ⟨b, rs2, hb, h⟩ := sbind_ok h
    have hv := (asBool_ok hb).1
    simp only at hv
    have hr := (asBool_ok hb).2
    split at h
    · rename_i hbt
      rw [hbt] at hv; rw [hv] at he; rw [hr] at h
      exact ht _ _ _ _ _ _ _ _ (hP nx rs1 ⟨n, he⟩) h
    · rw [refuse_run] at h; cases h

theorem triple_ret {Q : Flow → W → Env → RS → Prop} {e : Expr} {ss}  :
    Triple H cx (fun w env rs => ∀ v nx rs', Ev H cx w env rs e v nx rs' → Q (.ret v nx) w env rs')
      (.ret e :: ss) Q := by
  intro fuel w env rs fl w' env' rs' hP h
  cases fuel with
  | zero => exact (exec_zero H cx h).elim
  | succ n =>
    simp only [execStmts] at h
    obtain ⟨⟨v, nx⟩, rs1, he, h⟩ := sbind_ok h
    simp only [StateT.run, pure, StateT.pure, Except.pure, Except.ok.injEq, Prod.mk.injEq] at h
    obtain ⟨⟨rfl, rfl, rfl⟩, rfl⟩ := h
    exact hP v nx rs1 ⟨n, he⟩

theorem triple_ite {Pt Pe Rn : W → Env → RS → Prop} {R Q : Flow → W → Env → RS → Prop}
    {c : Expr} {th el ss}
    (hth : Triple H cx Pt th R) (hel : Triple H cx Pe el R) (hss : Triple H cx Rn ss Q)
    (hret : ∀ v nx w env rs, R (.ret v nx) w env rs → Q (.ret v nx) w env rs)
    (hnorm : ∀ w env rs, R .normal w env rs → Rn w env rs) :
    Triple H cx (fun w env rs => ∀ b nx rs', Ev H cx w env rs c (.ofBool b) nx rs' →
        (b = true → Pt w env rs') ∧ (b = false → Pe w env rs'))
      (.ite c th el :: ss) Q := by
  intro fuel w env rs fl w' env' rs' hP h
  cases fuel with
  | zero => exact (exec_zero H cx h).elim
  | succ n =>
    simp only [execStmts] at h
    obtain ⟨⟨v, nx⟩, rs1, he, h⟩ := sbind_ok h
    obtain ⟨b, rs2, hb, h⟩ := sbind_ok h
    have hv := (asBool_ok hb).1
    simp only at hv
    have hr := (asBool_ok hb).2
    rw [hv] at he
    rw [hr] at h
    obtain ⟨⟨fl1, w1, env1⟩, rs3, h1, h⟩ := sbind_ok h
    have hpre := hP b nx rs1 ⟨n, he⟩
    have hR : R fl1 w1 env1 rs3 := by
      cases b with
      | true => exact hth _ _ _ _ _ _ _ _ (hpre.1 rfl) h1
      | false => exact hel _ _ _ _ _ _ _ _ (hpre.2 rfl) h1
    cases fl1 with
    | ret v' nx' =>
      simp only [StateT.run, pure, StateT.pure, Except.pure, Except.ok.injEq, Prod.mk.injEq] at h
      obtain ⟨⟨rfl, rfl, rfl⟩, rfl⟩ := h
      exact hret _ _ _ _ _ hR
    | normal => exact hss _ _ _ _ _ _ _ _ (hnorm _ _ _ hR) h

theorem triple_write {R : W → Env → RS → Prop} {Q} {bind : Option String} {op : WriteOp} {ss}
    (ht : Triple H cx R ss Q) :
    Triple H cx (fun w env rs => ∀ rw rs1 val w',
        (∃ n, (resolve n cx (H.view cx w) env rs op).run rs = .ok (rw, rs1)) →
        H.apply cx w rw = .ok (val, w') → R w' (bindEnv bind val env) rs1)
      (.write bind op :: ss) Q := by
  intro fuel w env rs fl w' env' rs' hP h
  cases fuel with
  | zero => exact (exec_zero H cx h).elim
  | succ n =>
    simp only [execStmts] at h
    obtain ⟨rs0, rs1, hg, h⟩ := sbind_ok h
    simp only [StateT.run, get, getThe, MonadStateOf.get, StateT.get, pure, Except.pure,
      Except.ok.injEq, Prod.mk.injEq] at hg
    obtain ⟨rfl, rfl⟩ := hg
    obtain ⟨rw, rs2, hr, h⟩ := sbind_ok h
    obtain ⟨⟨val, w1⟩, rs3, ha, h3⟩ := sbind_ok h
    have happ := liftE_ok ha
    have hrs : rs3 = rs2 := by
      unfold liftE at ha; rw [happ] at ha
      simp [StateT.run, Except.map] at ha; exact ha.symm
    subst hrs
    exact ht n w1 (bindEnv bind val env) rs3 fl w' env' rs' (hP rw rs3 val w1 ⟨n, hr⟩ happ) h3

end

/-- The write rule specialised to mutations, with write authority folded in:
the precondition need only cover the stores an *authorized* write can
produce. -/
theorem triple_write_authorized {cx : Ctx} {R : Store → Env → RS → Prop} {Q} {bind : Option String}
    {op : WriteOp} {ss} (ht : Triple storeHooks cx R ss Q) :
    Triple storeHooks cx (fun s env _ => ∀ val s' rs1,
        (s' = s ∨ Step cx.schema cx.viewer cx.now s s') → R s' (bindEnv bind val env) rs1)
      (.write bind op :: ss) Q :=
  triple_conseq storeHooks cx
    (fun _ _ _ hP _ rs1 val s' _ happ => hP val s' rs1 (applyWrite_authorized happ))
    (triple_write storeHooks cx ht) (fun _ _ _ _ h => h)

end Quarry
