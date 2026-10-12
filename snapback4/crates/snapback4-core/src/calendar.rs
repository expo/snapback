//! Civil (proleptic Gregorian, UTC) months and years over i53 millisecond
//! times: `month(t)`, `year(t)`, `monthStart(m)`, `yearStart(y)`, the
//! `month`/`year` index keys and calendar schedules. One implementation for
//! the server, both device stores and the scheduler.
// @ref LLP 3000.040#22-builtins — a month is the ordinal since 1970-01, so arithmetic on it is continuous.
use crate::value::{I53_MAX, I53_MIN, ValueError};
use serde::{Deserialize, Serialize};

pub const DAY_MS: i64 = 86_400_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Civil {
    /// `month(t)`: months since 1970-01.
    Month,
    /// `year(t)`: the calendar year.
    Year,
    /// `monthStart(m)`: the first instant of month ordinal `m`.
    MonthStart,
    /// `yearStart(y)`: the first instant of year `y`.
    YearStart,
}

impl Civil {
    pub fn name(self) -> &'static str {
        match self { Self::Month => "month", Self::Year => "year", Self::MonthStart => "monthStart", Self::YearStart => "yearStart" }
    }

    pub fn from_name(name: &str) -> Option<Self> {
        Some(match name { "month" => Self::Month, "year" => Self::Year, "monthStart" => Self::MonthStart, "yearStart" => Self::YearStart, _ => return None })
    }

    /// The builtin over one i53 int. `month` and `year` are total on times;
    /// the starts refuse E_OVERFLOW when the instant leaves the i53 range.
    pub fn apply(self, value: i64) -> Result<i64, ValueError> {
        match self {
            Self::Month => Ok(month_of(value)),
            Self::Year => Ok(year_of(value)),
            Self::MonthStart => month_start(value),
            Self::YearStart => year_start(value),
        }
    }
}

/// Days since 1970-01-01 of a proleptic Gregorian date (H. Hinnant's
/// days_from_civil). `month` is 1..=12.
pub fn days_from_civil(year: i128, month: i128, day: i128) -> i128 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// The (year, month 1..=12, day 1..=31) of a day number (civil_from_days).
pub fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

pub fn month_of(at: i64) -> i64 {
    let (year, month, _) = civil_from_days(at.div_euclid(DAY_MS));
    (year - 1970) * 12 + (month - 1)
}

pub fn year_of(at: i64) -> i64 {
    civil_from_days(at.div_euclid(DAY_MS)).0
}

fn instant(days: i128) -> Result<i64, ValueError> {
    let at = days * i128::from(DAY_MS);
    if at < i128::from(I53_MIN) || at > i128::from(I53_MAX) { return Err(ValueError::Overflow(at)); }
    Ok(at as i64)
}

pub fn month_start(month: i64) -> Result<i64, ValueError> {
    let month = i128::from(month);
    instant(days_from_civil(1970 + month.div_euclid(12), month.rem_euclid(12) + 1, 1))
}

pub fn year_start(year: i64) -> Result<i64, ValueError> {
    instant(days_from_civil(i128::from(year), 1, 1))
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY: i64 = DAY_MS;

    /// Shared vectors: the same table is in the Lean model's examples
    /// (`lean/Quarry/Examples.lean`, calendar section).
    pub const VECTORS: &[(i64, i64, i64)] = &[
        // (time, month(time), year(time))
        (0, 0, 1970),
        (-1, -1, 1969),                                  // 1969-12-31T23:59:59.999Z
        (-31 * DAY, -1, 1969),                           // 1969-12-01T00:00Z
        (-31 * DAY - 1, -2, 1969),                       // 1969-11-30T23:59:59.999Z
        (951_782_400_000, 361, 2000),                    // 2000-02-29T00:00Z, a leap day
        (951_868_800_000, 362, 2000),                    // 2000-03-01T00:00Z
        (1_791_676_800_000, 681, 2026),                  // 2026-10-11T00:00Z
        (1_798_761_599_999, 683, 2026),                  // 2026-12-31T23:59:59.999Z
        (1_798_761_600_000, 684, 2027),                  // 2027-01-01T00:00Z
        (-2_203_891_200_000, -838, 1900),                // 1900-03-01T00:00Z (1900 is not a leap year)
        (-2_203_891_200_001, -839, 1900),                // 1900-02-28T23:59:59.999Z
        (I53_MAX, 3_425_121, 287_396),                   // the latest time
        (I53_MIN, -3_425_122, -283_457),                 // the earliest time
    ];

    #[test]
    fn vectors() {
        for &(at, month, year) in VECTORS {
            assert_eq!((month_of(at), year_of(at)), (month, year), "{at}");
            assert_eq!(month.div_euclid(12) + 1970, year, "{at}");
        }
    }

    #[test]
    fn starts_bracket_every_time() {
        let mut at = I53_MIN + 40 * DAY;
        let step = (I53_MAX / 1_000) - 7;
        while at < I53_MAX - step {
            let m = month_of(at);
            let start = month_start(m).unwrap();
            assert!(start <= at, "{at}");
            if let Ok(next) = month_start(m + 1) { assert!(at < next, "{at}"); }
            let y = year_of(at);
            if let Ok(start) = year_start(y) { assert!(start <= at); } else { assert_eq!(y, -283_457); }
            if let Ok(next) = year_start(y + 1) { assert!(at < next); }
            at += step;
        }
        for edge in [-1, 0, 1, I53_MAX - 1, I53_MAX] {
            assert!(month_start(month_of(edge)).is_ok_and(|start| start <= edge), "{edge}");
        }
        // The earliest month starts before the earliest time: E_OVERFLOW, never a wrong instant.
        assert!(month_start(month_of(I53_MIN)).is_err());
    }

    #[test]
    fn starts_round_trip_and_refuse_outside_i53() {
        assert_eq!(month_start(681).unwrap(), 1_790_812_800_000); // 2026-10-01T00:00Z
        assert_eq!(month_start(0).unwrap(), 0);
        assert_eq!(month_start(-1).unwrap(), -31 * DAY);
        assert_eq!(month_start(361).unwrap(), 949_363_200_000); // 2000-02-01
        assert_eq!(year_start(2026).unwrap(), 1_767_225_600_000);
        assert_eq!(year_start(1970).unwrap(), 0);
        for m in -40_000..40_000 { assert_eq!(month_of(month_start(m).unwrap()), m); }
        for y in -3_000..3_000 { assert_eq!(year_of(year_start(y).unwrap()), y); }
        assert!(month_start(3_425_121).is_ok());
        assert!(month_start(3_425_122).is_err());
        assert!(month_start(i64::MAX).is_err());
        assert!(month_start(i64::MIN).is_err());
        assert!(year_start(287_397).is_err());
        assert!(year_start(-283_458).is_err());
        assert!(year_start(-283_457).is_err(), "the earliest year starts before the earliest time");
    }
}
