/-!
# The UTC civil calendar: `day`, `hour`, `bucket`, `month`, `year`,
# `monthStart`, `yearStart`

Written from LLP 3000.040 §2.2 and the time card, not from the engine's
`calendar.rs`: a `time` is Unix milliseconds in UTC; `day(t)` is
`floor(t / 1d)`, `hour` and `bucket(t, P, O)` count fixed periods shifted by
a non-negative offset smaller than the period; `month(t)` is the month
ordinal since 1970-01 in the proleptic Gregorian calendar (astronomical
years: year 0 exists); `year(t)` is the calendar year, `month(t) / 12 +
1970`; `monthStart(m)` and `yearStart(y)` are the first instants.

The engine uses Hinnant's civil-from-days; the model decomposes a day number
into 400-, 100-, 4- and 1-year cycles of March-based years, so the two are
independent implementations of one documented calendar. The functions here
are over unbounded `Int`; the evaluator refuses `E_OVERFLOW` when a start
leaves the i53 range (§2.2 "Representability").

Proved: each month and year start brackets every time (`monthStart_le`,
`lt_monthStart_succ`, `yearStart_le`, `lt_yearStart_succ`), and month starts
are strictly increasing by at least 28 days (`marchDays_succ`).
-/

namespace Quarry

namespace Calendar

def dayMs : Int := 86400000

/-- Days since 1970-01-01 of the first day of March-based month `k` (months
since March of year 0): proleptic Gregorian days-from-civil. -/
def marchDays (k : Int) : Int :=
  let y := k / 12
  let mp := k % 12
  let era := y / 400
  let yoe := y - era * 400
  era * 146097 + yoe * 365 + yoe / 4 - yoe / 100 + (153 * mp + 2) / 5 - 719468

theorem marchDays_parts (n400 n100 n4 n1 mp : Int)
    (h100 : 0 ≤ n100 ∧ n100 ≤ 3) (h4 : 0 ≤ n4 ∧ n4 ≤ 24) (h1 : 0 ≤ n1 ∧ n1 ≤ 3) (hm : 0 ≤ mp ∧ mp ≤ 11) :
    marchDays ((n400 * 400 + n100 * 100 + n4 * 4 + n1) * 12 + mp)
      = n400 * 146097 + n100 * 36524 + n4 * 1461 + n1 * 365 + (153 * mp + 2) / 5 - 719468 := by
  simp only [marchDays]
  have hy : ((n400 * 400 + n100 * 100 + n4 * 4 + n1) * 12 + mp) / 12 = n400 * 400 + n100 * 100 + n4 * 4 + n1 := by omega
  have hmp : ((n400 * 400 + n100 * 100 + n4 * 4 + n1) * 12 + mp) % 12 = mp := by omega
  rw [hy, hmp]
  have he : (n400 * 400 + n100 * 100 + n4 * 4 + n1) / 400 = n400 := by omega
  rw [he]
  have hyoe : n400 * 400 + n100 * 100 + n4 * 4 + n1 - n400 * 400 = n100 * 100 + n4 * 4 + n1 := by omega
  rw [hyoe]
  have h4' : (n100 * 100 + n4 * 4 + n1) / 4 = n100 * 25 + n4 := by omega
  have h100' : (n100 * 100 + n4 * 4 + n1) / 100 = n100 := by omega
  rw [h4', h100']
  omega

/-- The decomposition of a day number into 400-, 100-, 4- and 1-year
March-based cycles, a day of the year and its March-based month. -/
structure Parts where
  n400 : Int
  n100 : Int
  n4 : Int
  n1 : Int
  doy : Int

def parts (d : Int) : Parts :=
  let z := d + 719468
  let r400 := z % 146097
  let n100 := min (r400 / 36524) 3
  let r100 := r400 - n100 * 36524
  let r4 := r100 % 1461
  let n1 := min (r4 / 365) 3
  { n400 := z / 146097, n100, n4 := r100 / 1461, n1, doy := r4 - n1 * 365 }

def Parts.mp (p : Parts) : Int := (5 * p.doy + 2) / 153

def marchMonth (d : Int) : Int :=
  let p := parts d
  (p.n400 * 400 + p.n100 * 100 + p.n4 * 4 + p.n1) * 12 + p.mp

theorem parts_spec (d : Int) :
    let p := parts d
    d + 719468 = p.n400 * 146097 + p.n100 * 36524 + p.n4 * 1461 + p.n1 * 365 + p.doy ∧
    0 ≤ p.n100 ∧ p.n100 ≤ 3 ∧ 0 ≤ p.n4 ∧ p.n4 ≤ 24 ∧ 0 ≤ p.n1 ∧ p.n1 ≤ 3 ∧ 0 ≤ p.doy ∧ p.doy ≤ 365 ∧
    (p.n1 < 3 → p.doy < 365) ∧ (p.n4 = 24 ∧ p.n100 < 3 → p.doy < 365) := by
  simp only [parts]
  omega

theorem mp_spec (p : Parts) (h0 : 0 ≤ p.doy) (h1 : p.doy ≤ 365) :
    0 ≤ p.mp ∧ p.mp ≤ 11 ∧ (153 * p.mp + 2) / 5 ≤ p.doy ∧ (p.mp < 11 → p.doy < (153 * (p.mp + 1) + 2) / 5) ∧
    (p.mp = 11 → 337 ≤ p.doy) := by
  simp only [Parts.mp]
  omega

theorem marchDays_marchMonth_le (d : Int) : marchDays (marchMonth d) ≤ d := by
  have hs := parts_spec d
  simp only at hs
  obtain ⟨hd, a1, a2, b1, b2, c1, c2, e1, e2, -, -⟩ := hs
  have hm := mp_spec (parts d) e1 e2
  obtain ⟨m1, m2, m3, -, -⟩ := hm
  simp only [marchMonth]
  rw [marchDays_parts _ _ _ _ _ ⟨a1, a2⟩ ⟨b1, b2⟩ ⟨c1, c2⟩ ⟨m1, m2⟩]
  omega

theorem lt_marchDays_marchMonth_succ (d : Int) : d < marchDays (marchMonth d + 1) := by
  have hs := parts_spec d
  simp only at hs
  obtain ⟨hd, a1, a2, b1, b2, c1, c2, e1, e2, f1, f2⟩ := hs
  have hm := mp_spec (parts d) e1 e2
  obtain ⟨m1, m2, m3, m4, m5⟩ := hm
  simp only [marchMonth]
  generalize (parts d).n400 = n400 at *
  generalize (parts d).n100 = n100 at *
  generalize (parts d).n4 = n4 at *
  generalize (parts d).n1 = n1 at *
  generalize (parts d).doy = doy at *
  generalize (parts d).mp = mp at *
  by_cases hlt : mp < 11
  · have : (n400 * 400 + n100 * 100 + n4 * 4 + n1) * 12 + mp + 1 = (n400 * 400 + n100 * 100 + n4 * 4 + n1) * 12 + (mp + 1) := by omega
    rw [this, marchDays_parts _ _ _ _ _ ⟨a1, a2⟩ ⟨b1, b2⟩ ⟨c1, c2⟩ ⟨by omega, by omega⟩]
    have := m4 hlt
    omega
  · have h11 : mp = 11 := by omega
    have := m5 h11
    by_cases hn1 : n1 < 3
    · have : (n400 * 400 + n100 * 100 + n4 * 4 + n1) * 12 + mp + 1 = (n400 * 400 + n100 * 100 + n4 * 4 + (n1 + 1)) * 12 + 0 := by omega
      rw [this, marchDays_parts _ _ _ _ _ ⟨a1, a2⟩ ⟨b1, b2⟩ ⟨by omega, by omega⟩ ⟨by omega, by omega⟩]
      have := f1 hn1
      omega
    · by_cases hn4 : n4 < 24
      · have : (n400 * 400 + n100 * 100 + n4 * 4 + n1) * 12 + mp + 1 = (n400 * 400 + n100 * 100 + (n4 + 1) * 4 + 0) * 12 + 0 := by omega
        rw [this, marchDays_parts _ _ _ _ _ ⟨a1, a2⟩ ⟨by omega, by omega⟩ ⟨by omega, by omega⟩ ⟨by omega, by omega⟩]
        omega
      · by_cases hn100 : n100 < 3
        · have : (n400 * 400 + n100 * 100 + n4 * 4 + n1) * 12 + mp + 1 = (n400 * 400 + (n100 + 1) * 100 + 0 * 4 + 0) * 12 + 0 := by omega
          rw [this, marchDays_parts _ _ _ _ _ ⟨by omega, by omega⟩ ⟨by omega, by omega⟩ ⟨by omega, by omega⟩ ⟨by omega, by omega⟩]
          have := f2 ⟨by omega, hn100⟩
          omega
        · have : (n400 * 400 + n100 * 100 + n4 * 4 + n1) * 12 + mp + 1 = ((n400 + 1) * 400 + 0 * 100 + 0 * 4 + 0) * 12 + 0 := by omega
          rw [this, marchDays_parts _ _ _ _ _ ⟨by omega, by omega⟩ ⟨by omega, by omega⟩ ⟨by omega, by omega⟩ ⟨by omega, by omega⟩]
          omega

theorem marchDays_succ (k : Int) : marchDays k + 28 ≤ marchDays (k + 1) := by
  have hk : k = ((k / 12 / 400) * 400 + (k / 12 % 400 / 100) * 100 + (k / 12 % 100 / 4) * 4 + k / 12 % 4) * 12 + k % 12 := by omega
  generalize k / 12 / 400 = n400 at hk
  have b100 : 0 ≤ k / 12 % 400 / 100 ∧ k / 12 % 400 / 100 ≤ 3 := by omega
  have b4 : 0 ≤ k / 12 % 100 / 4 ∧ k / 12 % 100 / 4 ≤ 24 := by omega
  have b1 : 0 ≤ k / 12 % 4 ∧ k / 12 % 4 ≤ 3 := by omega
  have bm : 0 ≤ k % 12 ∧ k % 12 ≤ 11 := by omega
  generalize k / 12 % 400 / 100 = n100 at *
  generalize k / 12 % 100 / 4 = n4 at *
  generalize k / 12 % 4 = n1 at *
  generalize k % 12 = mp at *
  subst hk
  rw [marchDays_parts _ _ _ _ _ b100 b4 b1 bm]
  by_cases hlt : mp < 11
  · have : (n400 * 400 + n100 * 100 + n4 * 4 + n1) * 12 + mp + 1 = (n400 * 400 + n100 * 100 + n4 * 4 + n1) * 12 + (mp + 1) := by omega
    rw [this, marchDays_parts _ _ _ _ _ b100 b4 b1 ⟨by omega, by omega⟩]
    omega
  · by_cases hn1 : n1 < 3
    · have : (n400 * 400 + n100 * 100 + n4 * 4 + n1) * 12 + mp + 1 = (n400 * 400 + n100 * 100 + n4 * 4 + (n1 + 1)) * 12 + 0 := by omega
      rw [this, marchDays_parts _ _ _ _ _ b100 b4 ⟨by omega, by omega⟩ ⟨by omega, by omega⟩]
      omega
    · by_cases hn4 : n4 < 24
      · have : (n400 * 400 + n100 * 100 + n4 * 4 + n1) * 12 + mp + 1 = (n400 * 400 + n100 * 100 + (n4 + 1) * 4 + 0) * 12 + 0 := by omega
        rw [this, marchDays_parts _ _ _ _ _ b100 ⟨by omega, by omega⟩ ⟨by omega, by omega⟩ ⟨by omega, by omega⟩]
        omega
      · by_cases hn100 : n100 < 3
        · have : (n400 * 400 + n100 * 100 + n4 * 4 + n1) * 12 + mp + 1 = (n400 * 400 + (n100 + 1) * 100 + 0 * 4 + 0) * 12 + 0 := by omega
          rw [this, marchDays_parts _ _ _ _ _ ⟨by omega, by omega⟩ ⟨by omega, by omega⟩ ⟨by omega, by omega⟩ ⟨by omega, by omega⟩]
          omega
        · have : (n400 * 400 + n100 * 100 + n4 * 4 + n1) * 12 + mp + 1 = ((n400 + 1) * 400 + 0 * 100 + 0 * 4 + 0) * 12 + 0 := by omega
          rw [this, marchDays_parts _ _ _ _ _ ⟨by omega, by omega⟩ ⟨by omega, by omega⟩ ⟨by omega, by omega⟩ ⟨by omega, by omega⟩]
          omega

theorem marchDays_mono_nat (a : Int) (n : Nat) : marchDays a ≤ marchDays (a + n) := by
  induction n with
  | zero => simp
  | succ n ih =>
    have := marchDays_succ (a + n)
    have e : a + ((n + 1 : Nat) : Int) = a + n + 1 := by omega
    rw [e]
    omega

theorem marchDays_mono (a b : Int) (h : a ≤ b) : marchDays a ≤ marchDays b := by
  have := marchDays_mono_nat a (b - a).toNat
  have e : a + ((b - a).toNat : Int) = b := by omega
  rw [e] at this
  exact this

/-! ## The builtins -/

/-- `month(t)`: months since 1970-01 (March-based month 23638 is 1970-01). -/
def monthOf (t : Int) : Int := marchMonth (t / dayMs) - 23638

/-- `year(t)`. -/
def yearOf (t : Int) : Int := monthOf t / 12 + 1970

/-- `monthStart(m)`, over unbounded integers. -/
def monthStart (m : Int) : Int := marchDays (m + 23638) * dayMs

/-- `yearStart(y)`, over unbounded integers. -/
def yearStart (y : Int) : Int := monthStart ((y - 1970) * 12)

/-- `day`, `hour` and `bucket`: the period ordinal `floor((t - offset) / period)`. -/
def periodOrdinal (t period offset : Int) : Int := (t - offset) / period

theorem monthStart_le (t : Int) : monthStart (monthOf t) ≤ t := by
  have h := marchDays_marchMonth_le (t / dayMs)
  simp only [monthStart, monthOf, dayMs] at *
  have e : marchMonth (t / 86400000) - 23638 + 23638 = marchMonth (t / 86400000) := by omega
  rw [e]
  have : t / 86400000 * 86400000 ≤ t := Int.ediv_mul_le t (by decide)
  have : marchDays (marchMonth (t / 86400000)) * 86400000 ≤ t / 86400000 * 86400000 := Int.mul_le_mul_of_nonneg_right h (by decide)
  omega

theorem lt_monthStart_succ (t : Int) : t < monthStart (monthOf t + 1) := by
  have h := lt_marchDays_marchMonth_succ (t / dayMs)
  simp only [monthStart, monthOf, dayMs] at *
  have e : marchMonth (t / 86400000) - 23638 + 1 + 23638 = marchMonth (t / 86400000) + 1 := by omega
  rw [e]
  have : (t / 86400000 + 1) * 86400000 ≤ marchDays (marchMonth (t / 86400000) + 1) * 86400000 := Int.mul_le_mul_of_nonneg_right (by omega) (by decide)
  omega

theorem monthStart_mono (a b : Int) (h : a ≤ b) : monthStart a ≤ monthStart b := by
  simp only [monthStart]
  exact Int.mul_le_mul_of_nonneg_right (marchDays_mono _ _ (by omega)) (by decide)

theorem yearStart_le (t : Int) : yearStart (yearOf t) ≤ t := by
  have := monthStart_mono ((yearOf t - 1970) * 12) (monthOf t) (by simp only [yearOf]; omega)
  have := monthStart_le t
  simp only [yearStart]
  omega

theorem lt_yearStart_succ (t : Int) : t < yearStart (yearOf t + 1) := by
  have := monthStart_mono (monthOf t + 1) ((yearOf t + 1 - 1970) * 12) (by simp only [yearOf]; omega)
  have := lt_monthStart_succ t
  simp only [yearStart]
  omega

end Calendar

end Quarry
