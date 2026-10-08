import Quarry.Proofs.Determinism

/-!
# A cut page continues to the uncut answer

Stage 1's oracle 2 says a read cut by the meter must report the cut, and
continuing from its cursor must reach the uncut answer. In the model: if a
page walk is cut after examining up to row `x`, then its rows followed by
the leading qualifying rows of the page that continues after `x`'s key are
exactly the uncut page (`cut_continuation`). The proof needs ids to be
unique, which makes the scan order strict.
-/

namespace Quarry

/-- The scan direction's strict order on rows. -/
def dirLt (order : List String) (desc : Bool) (a b : Row) : Prop :=
  keyCmp (rowKey order a) (rowKey order b) = (if desc then .gt else .lt)

theorem getLast?_or_cons {α : Type} (c : α) (l : List α) :
    (c :: l).getLast? = l.getLast?.or (some c) := by
  induction l generalizing c with
  | nil => rfl
  | cons d l ih =>
    rw [List.getLast?_cons_cons, ih]
    cases l <;> simp

/-- Whatever a walk does, it examined a prefix `ex` of the candidates,
returned exactly the rows of `ex` its filter keeps, and its `last` is the
last examined row; a cut walk did not fill its page. -/
theorem walk_shape (f : Row → EM Bool) (p : Row → Bool) (hf : FiltIs f p) (b : Option Nat) (n : Nat) :
    ∀ cs acc last rs w rs', acc.length ≤ n → (walk f b n acc last cs).run rs = .ok (w, rs') →
      ∃ ex post, cs = ex ++ post ∧ w.rows = acc.reverse ++ ex.filter p ∧
        w.last = ex.getLast?.or last ∧ (w.stop = .cut → w.rows.length < n) := by
  intro cs
  induction cs with
  | nil =>
    intro acc last rs w rs' _ h
    simp only [walk] at h
    obtain ⟨rfl, -⟩ := pure_ok h
    exact ⟨[], [], rfl, by simp, by simp, by simp⟩
  | cons c cs ih =>
    intro acc last rs w rs' hlen h
    simp only [walk] at h
    split at h
    · obtain ⟨rfl, -⟩ := pure_ok h
      exact ⟨[], c :: cs, rfl, by simp, by simp, by simp⟩
    · rename_i hlt
      obtain ⟨rs0, rs1, -, h⟩ := sbind_ok h
      split at h
      · obtain ⟨rfl, -⟩ := pure_ok h
        exact ⟨[], c :: cs, rfl, by simp, by simp, fun _ => by simp; omega⟩
      · obtain ⟨_, rs2, -, h⟩ := sbind_ok h
        obtain ⟨keep, rs3, hk, h⟩ := sbind_ok h
        have hkeep := hf _ _ _ _ hk
        subst hkeep
        have hlen' : (if p c = true then c :: acc else acc).length ≤ n := by
          split <;> (try simp only [List.length_cons]) <;> omega
        obtain ⟨ex, post, hcs, hrows, hlast, hcut⟩ := ih _ _ _ _ _ hlen' h
        refine ⟨c :: ex, post, by rw [hcs]; rfl, ?_, ?_, hcut⟩
        · rw [hrows]
          by_cases hp : p c = true
          · simp [hp]
          · simp [hp]
        · rw [hlast, getLast?_or_cons]
          cases ex.getLast? <;> rfl

/-- After the cursor of an element of a strictly ordered list come exactly
the elements after it. -/
theorem afterCursor_elem {order : List String} {desc : Bool} {pre post : List Row} {x : Row}
    (hs : (pre ++ x :: post).Pairwise (dirLt order desc)) :
    afterCursor order desc (some (rowKey order x)) (pre ++ x :: post) = post := by
  simp only [afterCursor]
  rw [List.filter_append, List.filter_cons]
  have hpre : pre.filter (fun r => keyCmp (rowKey order r) (rowKey order x) == (if desc then .lt else .gt)) = [] := by
    rw [List.filter_eq_nil_iff]
    intro r hr
    have := (List.pairwise_append.1 hs).2.2 r hr x List.mem_cons_self
    unfold dirLt at this
    cases desc <;> simp_all
  have hx : (keyCmp (rowKey order x) (rowKey order x) == (if desc then .lt else .gt)) = false := by
    rw [keyCmp_lawful.refl]; cases desc <;> rfl
  have hpost : post.filter (fun r => keyCmp (rowKey order r) (rowKey order x) == (if desc then .lt else .gt)) = post := by
    rw [List.filter_eq_self]
    intro r hr
    have := List.pairwise_cons.1 (List.pairwise_append.1 hs).2.1 |>.1 r hr
    unfold dirLt at this
    have hsw := keyCmp_lawful.swap (rowKey order x) (rowKey order r)
    rw [this] at hsw
    cases desc <;> simp_all
  rw [hpre, hx, hpost]
  simp

theorem sorted_strict {order : List String} {desc : Bool} {l : List Row} (hn : (l.map Row.id).Nodup) :
    (sortRows order desc l).Pairwise (dirLt order desc) := by
  have s1 := List.pairwise_mergeSort (keyLe_trans order) (keyLe_total order) l
  have p1 := List.mergeSort_perm l (keyLe order)
  have hn' : ((l.mergeSort (keyLe order)).map Row.id).Nodup := (p1.map Row.id).nodup_iff.2 hn
  have hne : (l.mergeSort (keyLe order)).Pairwise (fun a b => a.id ≠ b.id) :=
    List.pairwise_map.1 hn'
  have hlt : (l.mergeSort (keyLe order)).Pairwise (dirLt order false) := by
    refine (s1.and hne).imp ?_
    intro a b ⟨hab, hid⟩
    unfold dirLt
    simp only [Bool.false_eq_true, ↓reduceIte]
    have hle := keyLe_iff.1 hab
    unfold Le at hle
    cases hc : keyCmp (rowKey order a) (rowKey order b) with
    | lt => rfl
    | gt => exact absurd hc hle
    | eq => exact absurd (rowKey_id ((keyCmp_lawful.eq_iff _ _).1 hc)) hid
  unfold sortRows
  cases desc with
  | false => exact hlt
  | true =>
    simp only [↓reduceIte]
    rw [List.pairwise_reverse]
    refine hlt.imp ?_
    intro a b h
    unfold dirLt at *
    simp only [Bool.false_eq_true, ↓reduceIte] at h
    simp only [↓reduceIte]
    rw [keyCmp_lawful.swap, h]; rfl

/-- The direction's "strictly after" is transitive. -/
theorem after_trans {desc : Bool} {a b d : Key}
    (h1 : keyCmp a b = (if desc then .lt else .gt)) (h2 : keyCmp b d = (if desc then .lt else .gt)) :
    keyCmp a d = (if desc then .lt else .gt) := by
  cases desc with
  | true => simp only [↓reduceIte] at *; exact keyCmp_lawful.lt_trans _ _ _ h1 h2
  | false =>
    simp only [Bool.false_eq_true, ↓reduceIte] at *
    rw [keyCmp_lawful.gt_iff_lt] at *
    exact keyCmp_lawful.lt_trans _ _ _ h2 h1

theorem afterCursor_nested {order : List String} {desc : Bool} {k : Key} {x : Row} {S : List Row}
    (hxk : keyCmp (rowKey order x) k = (if desc then .lt else .gt)) :
    afterCursor order desc (some (rowKey order x)) S
      = afterCursor order desc (some (rowKey order x)) (afterCursor order desc (some k) S) := by
  simp only [afterCursor]
  rw [List.filter_filter]
  apply List.filter_congr
  intro r _
  by_cases hr : (keyCmp (rowKey order r) (rowKey order x) == (if desc then .lt else .gt)) = true
  · have := after_trans (beq_iff_eq.1 hr) hxk
    simp [hr, this]
  · simp only [Bool.not_eq_true] at hr
    simp [hr]

/-- **A cut page continues to the uncut answer.** -/
theorem cut_continuation {vw : View} {t : String} {ps order desc cur} {f : Row → EM Bool}
    {p : Row → Bool} (hf : FiltIs f p) {b : Option Nat} {n : Nat} {rs w rs'} {x : Row}
    (hn : ((vw t).map Row.id).Nodup)
    (h : (walk f b n [] none (candidates vw t ps order desc cur)).run rs = .ok (w, rs'))
    (hcut : w.stop = .cut) (hx : w.last = some x) :
    w.rows ++ ((candidates vw t ps order desc (some (rowKey order x))).filter p).take (n - w.rows.length)
      = ((candidates vw t ps order desc cur).filter p).take n := by
  obtain ⟨ex, post, hcs, hrows, hlast, hc⟩ := walk_shape f p hf b n _ [] none rs w rs' (by simp) h
  simp only [List.reverse_nil, List.nil_append] at hrows
  have hlt := hc hcut
  rw [hx] at hlast
  have hex : ex.getLast? = some x := by
    cases hg : ex.getLast? with
    | none => rw [hg] at hlast; cases hlast
    | some y => rw [hg] at hlast; cases hlast; rfl
  obtain ⟨ex0, rfl⟩ := List.getLast?_eq_some_iff.1 hex
  -- the base list, strictly ordered
  let S := sortRows order desc ((vw t).filter (keyMatch ps))
  have hS : S.Pairwise (dirLt order desc) :=
    sorted_strict ((List.filter_sublist).map Row.id |>.nodup hn)
  have hcsS : candidates vw t ps order desc cur = afterCursor order desc cur S := rfl
  have hcsP : (candidates vw t ps order desc cur).Pairwise (dirLt order desc) := by
    rw [hcsS]
    cases cur with
    | none => exact hS
    | some k => exact hS.sublist List.filter_sublist
  rw [hcs] at hcsP
  have hcsP' : (ex0 ++ x :: post).Pairwise (dirLt order desc) := by simpa using hcsP
  -- the continuation's candidates are what followed x
  have hcont : candidates vw t ps order desc (some (rowKey order x)) = post := by
    have hxin : x ∈ candidates vw t ps order desc cur := by rw [hcs]; simp
    have : candidates vw t ps order desc (some (rowKey order x))
        = afterCursor order desc (some (rowKey order x)) (candidates vw t ps order desc cur) := by
      rw [hcsS]
      cases cur with
      | none => rfl
      | some k =>
        have hxk : keyCmp (rowKey order x) k = (if desc then .lt else .gt) := by
          rw [hcsS] at hxin; simp only [afterCursor] at hxin
          exact beq_iff_eq.1 (List.mem_filter.1 hxin).2
        exact afterCursor_nested hxk
    rw [this, hcs]
    simpa using afterCursor_elem hcsP'
  rw [hrows] at hlt
  rw [hcont, hcs, hrows, List.filter_append (ex0 ++ [x]) post, List.take_append,
    List.take_of_length_le (Nat.le_of_lt hlt)]

end Quarry
