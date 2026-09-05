use super::*;
use crate::timers::TimerOutcome;

impl Runtime {
    pub fn fire_due(&mut self, limit: usize) -> Result<Vec<TimerOutcome>, RuntimeError> {
        self.fire_due_at(limit, unix_millis())
    }
    pub fn fire_due_at(
        &mut self,
        limit: usize,
        now: i64,
    ) -> Result<Vec<TimerOutcome>, RuntimeError> {
        let due = self.store().due_timers(now, limit)?;
        let mut outcomes = vec![];
        for timer in due {
            // Earlier targets in this same turn may cancel or replace later timers.
            if self.store().timer(&timer.id)?.as_ref() != Some(&timer) {
                continue;
            }
            let schedule = self
                .generation
                .schema
                .schedules
                .iter()
                .find(|s| s.name == timer.schedule)
                .cloned()
                .ok_or_else(|| RuntimeError::Input("timer has no schedule".into()))?;
            let (target, _) = self.generation.programs[&schedule.target].clone();
            let certificates = self.generation.timer_bindings[&schedule.name].clone();
            let ids = self.reserve_new_ids()?;
            outcomes.push(self.engine.fire_timer(
                timer,
                &schedule,
                &certificates.binding,
                &certificates.binding_certificate,
                &target,
                &certificates.target,
                now,
                ids,
            )?);
        }
        Ok(outcomes)
    }
}
