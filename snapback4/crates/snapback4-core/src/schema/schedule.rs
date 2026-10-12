//! Schedule boundaries: fixed periods (`every 2m`, `every 1d at 08:00`) and
//! UTC calendar months (`every 1 month at day 1 09:00`, `every 1 year`).
//! The scheduler, the dev clock and `doctor` use only these methods.
use super::Schedule;

pub(super) fn is_zero_months(months: &u32) -> bool { *months == 0 }

/// The latest offset a calendar schedule may name: the end of day 28.
pub const CALENDAR_OFFSET_LIMIT_MS: u64 = 28 * 86_400_000;
/// At most once a century.
pub const CALENDAR_MONTHS_LIMIT: u32 = 1_200;

impl Schedule {
    /// The most recent period boundary at or before `now`.
    pub fn boundary(&self, now: i64) -> i64 {
        if self.months > 0 {
            let n = i64::from(self.months);
            let mut month = crate::calendar::month_of(now).div_euclid(n) * n;
            if self.month_boundary(month) > now { month -= n; }
            return self.month_boundary(month);
        }
        let every = self.every_ms as i64;
        let offset = self.offset_ms as i64;
        (now - offset).div_euclid(every) * every + offset
    }

    /// The boundary one period before `boundary`: the `periodStart` of the
    /// period that ends there.
    pub fn previous(&self, boundary: i64) -> i64 {
        if self.months > 0 { return self.month_boundary(crate::calendar::month_of(boundary) - i64::from(self.months)); }
        boundary.saturating_sub(self.every_ms as i64)
    }

    /// The boundary one period after `boundary`.
    pub fn next(&self, boundary: i64) -> i64 {
        if self.months > 0 { return self.month_boundary(crate::calendar::month_of(boundary) + i64::from(self.months)); }
        boundary.saturating_add(self.every_ms as i64)
    }

    /// How many boundaries lie in `(from, to]`, for two boundaries of this schedule.
    pub fn periods_between(&self, from: i64, to: i64) -> i64 {
        if self.months > 0 { return (crate::calendar::month_of(to) - crate::calendar::month_of(from)).div_euclid(i64::from(self.months)); }
        (to - from) / (self.every_ms as i64).max(1)
    }

    // @ref LLP 3000.040#24-monthly-and-yearly-schedules — exact: the month start plus the offset in i128,
    // never an endpoint substituted at the i53 edges (only ±285,000 years out).
    fn month_boundary(&self, month: i64) -> i64 {
        let days = crate::calendar::days_from_civil(1970 + i128::from(month).div_euclid(12), i128::from(month).rem_euclid(12) + 1, 1);
        let at = days * i128::from(crate::calendar::DAY_MS) + i128::from(self.offset_ms);
        at.clamp(i128::from(i64::MIN), i128::from(i64::MAX)) as i64
    }

    /// `every 1 month at day 1 09:00 UTC`, `every 1d at 03:00 UTC`, `every 2m`.
    pub fn describe(&self) -> String {
        let clock = |ms: u64| format!("{:02}:{:02}", ms / 3_600_000, ms % 3_600_000 / 60_000);
        if self.months > 0 {
            let (n, unit) = if self.months % 12 == 0 { (self.months / 12, "year") } else { (self.months, "month") };
            let day = self.offset_ms / 86_400_000 + 1;
            return format!("every {n} {unit}{} at day {day} {} UTC", if n == 1 { "" } else { "s" }, clock(self.offset_ms % 86_400_000));
        }
        let every = self.every_ms;
        let unit = [(86_400_000, "d"), (3_600_000, "h"), (60_000, "m"), (1_000, "s"), (1, "ms")].into_iter().find(|(n, _)| every % n == 0).unwrap_or((1, "ms"));
        let at = if self.offset_ms > 0 { format!(" at {} UTC", clock(self.offset_ms)) } else { String::new() };
        format!("every {}{}{at}", every / unit.0, unit.1)
    }

    /// The period and offset fit one of the two shapes.
    pub fn valid(&self) -> bool {
        if self.months > 0 {
            return self.every_ms == 0 && self.months <= CALENDAR_MONTHS_LIMIT && self.offset_ms < CALENDAR_OFFSET_LIMIT_MS;
        }
        self.every_ms != 0 && self.every_ms <= i64::MAX as u64 && self.offset_ms < self.every_ms
    }
}
