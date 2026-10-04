//! @ref LLP 3000.030#15 — bounded cleanup rewards observed exits, never polling.
use super::*;

pub(super) struct Deadline {
    idle: Duration,
    stalled_at: Instant,
    hard_at: Instant,
    previous: Option<usize>,
}
impl Deadline {
    pub(super) fn new(now: Instant) -> Self {
        Self::with_limits(now, Duration::from_secs(5), Duration::from_secs(60))
    }
    pub(super) fn with_limits(now: Instant, idle: Duration, hard: Duration) -> Self {
        Self { idle, stalled_at: now + idle, hard_at: now + hard, previous: None }
    }
    pub(super) fn observe(&mut self, now: Instant, members: usize) {
        // Growth, churn at the same size, repeated empty snapshots and a live
        // but stuck supervisor are not progress. The first sample is a baseline.
        if self.previous.is_some_and(|previous| members < previous) {
            self.stalled_at = now + self.idle;
        }
        self.previous = Some(members);
    }
    pub(super) fn expired(&self, now: Instant) -> bool { now >= self.stalled_at || now >= self.hard_at }
    pub(super) fn lock(&self, file: &File) -> Result<()> {
        loop {
            match file.try_lock() {
                Ok(()) => return Ok(()),
                Err(std::fs::TryLockError::WouldBlock) => {},
                Err(e) => return Err(error("E_WITNESS_PROCESS", e)),
            }
            if self.expired(Instant::now()) { return Err(error("E_WITNESS_PROCESS", "process group reaping lock stalled; recovery required")); }
            sleep(Duration::from_millis(20));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exits_extend_cleanup_but_growth_churn_and_empty_polls_do_not() {
        let start = Instant::now();
        let mut deadline = Deadline::new(start);
        deadline.observe(start, 3);
        deadline.observe(start + Duration::from_secs(4), 2);
        assert!(!deadline.expired(start + Duration::from_secs(6)));
        deadline.observe(start + Duration::from_secs(8), 2);
        deadline.observe(start + Duration::from_secs(8), 3);
        assert!(deadline.expired(start + Duration::from_secs(9)));
        let mut deadline = Deadline::new(start);
        deadline.observe(start, 1);
        deadline.observe(start + Duration::from_secs(4), 0);
        deadline.observe(start + Duration::from_secs(8), 0);
        assert!(deadline.expired(start + Duration::from_secs(9)));
    }
    #[test]
    fn late_joiners_can_shrink_without_reaching_the_original_low_water_mark() {
        let start = Instant::now();
        let mut deadline = Deadline::new(start);
        deadline.observe(start, 1);
        deadline.observe(start + Duration::from_secs(3), 10);
        deadline.observe(start + Duration::from_secs(4), 8);
        assert!(!deadline.expired(start + Duration::from_secs(6)));
        assert!(deadline.expired(start + Duration::from_secs(9)));
    }
    #[test]
    fn continuous_progress_cannot_move_the_hard_cap() {
        let start = Instant::now();
        let mut deadline = Deadline::new(start);
        for seconds in 0..=60 {
            deadline.observe(start + Duration::from_secs(seconds), 100 - seconds as usize);
            assert_eq!(deadline.expired(start + Duration::from_secs(seconds)), seconds == 60);
        }
    }
    #[test]
    fn absent_or_first_observation_does_not_renew_a_stall() {
        let start = Instant::now();
        let mut deadline = Deadline::new(start);
        assert!(deadline.expired(start + Duration::from_secs(5)));
        deadline.observe(start + Duration::from_secs(6), 0);
        assert!(deadline.expired(start + Duration::from_secs(6)));
    }
}
