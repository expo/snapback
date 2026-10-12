import Quarry.Run

/-!
# Short-circuit evaluation and independent helper calls (LLP 3000.003)

The two binder defects LLP 3000.003 reproduced, stated as theorems of the
model: `true or e` is `true` without evaluating `e` (so a null assertion,
an overflow or a read in `e` never runs, and the meter is untouched), and
`identity(1) + identity(2)` is `3`, because each helper call evaluates its
body in a fresh scope holding only its own parameters.
-/

namespace Quarry

/-- **`true or e` is `true` without evaluating `e`**, whatever `e` is: the
state (meter, completeness) is unchanged. -/
theorem or_true_skips (fuel : Nat) (cx : Ctx) (vw : View) (env : Env) (dot : Option Value)
    (e : Expr) (rs : RS) :
    (evalExpr (fuel + 2) cx vw env dot (.or (.lit (.ofBool true)) e)).run rs
      = .ok ((.ofBool true, none), rs) := by
  rfl

/-- `false and e` is `false` without evaluating `e`. -/
theorem and_false_skips (fuel : Nat) (cx : Ctx) (vw : View) (env : Env) (dot : Option Value)
    (e : Expr) (rs : RS) :
    (evalExpr (fuel + 2) cx vw env dot (.and (.lit (.ofBool false)) e)).run rs
      = .ok ((.ofBool false, none), rs) := by
  rfl

/-- The LLP 3000.003 shape: a null assertion in the skipped right side does
not run. -/
theorem or_true_skips_null_assertion (fuel : Nat) (cx : Ctx) (vw : View) (env : Env)
    (dot : Option Value) (code : String) (rs : RS) :
    (evalExpr (fuel + 2) cx vw env dot (.or (.lit (.ofBool true)) (.assert (.lit .null) code))).run rs
      = .ok ((.ofBool true, none), rs) :=
  or_true_skips fuel cx vw env dot _ rs

/-- `a if c else b` evaluates only the chosen arm. -/
theorem cond_true_skips (fuel : Nat) (cx : Ctx) (vw : View) (env : Env) (dot : Option Value)
    (a b : Expr) (rs : RS) :
    (evalExpr (fuel + 2) cx vw env dot (.cond (.lit (.ofBool true)) a b)).run rs
      = (evalExpr (fuel + 1) cx vw env dot a).run rs := by
  simp only [evalExpr]
  rfl

def identityHelper : Helper := { name := "identity", params := ["x"], body := .var "x" }

/-- **`identity(1) + identity(2)` is 3**, in any context whose `identity` is
the identity helper. -/
theorem identity_sum (fuel : Nat) (cx : Ctx) (vw : View) (env : Env) (dot : Option Value) (rs : RS)
    (hid : cx.helpers.find? (·.name == "identity") = some identityHelper) :
    (evalExpr (fuel + 3) cx vw env dot
      (.bin .add (.call "identity" [.lit (.ofInt 1)]) (.call "identity" [.lit (.ofInt 2)]))).run rs
      = .ok ((.ofInt 3, none), rs) := by
  simp only [evalExpr, hid]
  rfl

theorem evalExpr_call (n : Nat) (cx : Ctx) (vw : View) (env : Env) (dot : Option Value)
    (f : String) (args : List Expr) :
    evalExpr (n + 1) cx vw env dot (.call f args) =
      (do
        let vs ← args.mapM fun x => do return (← evalExpr n cx vw env dot x).1
        match cx.helpers.find? (·.name == f) with
        | none => typeErr
        | some h =>
          if h.params.length = vs.length then
            let (v, _) ← evalExpr n { cx with inHelper := true } vw (h.params.zip (vs.map fun v => (v, none))) none h.body
            pure (v, none)
          else typeErr) := rfl

/-- A helper call does not see the caller's locals or row: its result is the
same in any two calling scopes. -/
theorem call_scope_independent (fuel : Nat) (cx : Ctx) (vw : View) (env1 env2 : Env)
    (dot1 dot2 : Option Value) (f : String) (vs : List Value) (rs : RS) :
    (evalExpr (fuel + 2) cx vw env1 dot1 (.call f (vs.map .lit))).run rs
      = (evalExpr (fuel + 2) cx vw env2 dot2 (.call f (vs.map .lit))).run rs := by
  have hlits : ∀ (env : Env) (dot : Option Value),
      ((vs.map Expr.lit).mapM fun x => do return (← evalExpr (fuel + 1) cx vw env dot x).1 : EM (List Value))
        = pure vs := by
    intro env dot
    induction vs with
    | nil => rfl
    | cons v vs ih =>
      simp only [List.map_cons, List.mapM_cons] at ih ⊢
      rw [show (do return (← evalExpr (fuel + 1) cx vw env dot (Expr.lit v)).1 : EM Value) = pure v from rfl]
      rw [ih]
      rfl
  rw [evalExpr_call, evalExpr_call, hlits env1 dot1, hlits env2 dot2]

end Quarry
