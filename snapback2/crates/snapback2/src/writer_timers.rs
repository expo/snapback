use super::*;

impl State {
    pub(super) fn timer_poll_timeout(&self) -> Result<Duration, Refusal> {
        Ok(self
            .runtime()
            .store()
            .next_timer_at()
            .map_err(|e| Refusal::from_runtime(&e))?
            .map(|at| Duration::from_millis(at.saturating_sub(self.now()).max(0) as u64))
            .unwrap_or(Duration::from_secs(60)))
    }
    // @ref LLP 1016#d3--the-driver — up to 64 oldest-due firings precede one chunk, each including its live reruns.
    pub(super) fn fire_due_timers_background_turn(&mut self) -> Result<(), Refusal> {
        for _ in 0..64 {
            let now = self.now();
            let outcomes = self
                .runtime_mut()
                .fire_due_at(1, now)
                .map_err(|e| Refusal::from_runtime(&e))?;
            let Some(outcome) = outcomes.first() else {
                break;
            };
            self.after_commit(outcome.seq)?;
            crate::watch::log(
                &self.root,
                json!({"kind":"schedule","seq":outcome.seq,"firing":outcome.firing}),
            );
        }
        Ok(())
    }
    // @ref LLP 1016#d5--schedules-row-timers-and-periods-on-the-owners-clock — summaries begin
    // with the declarations so a schedule with no materialized timer row is still listed at zero.
    pub(super) fn timers(&self) -> Result<Json, Refusal> {
        let runtime = self.runtime();
        runtime
            .store()
            .timers_summary(self.now(), &runtime.generation().schema().schedules)
            .map_err(|e| Refusal::from_runtime(&e))
    }
    // @ref LLP 1016#d5--schedules-row-timers-and-periods-on-the-owners-clock — a schedule target
    // is a system program: the timer runs it as the owner and `/api/*` refuses it like a job;
    // the operator seat (`run <target> --as system`) never comes through here.
    pub(super) fn refuse_schedule_target(&self, op: &str) -> Result<(), Refusal> {
        let schedules = &self.runtime().generation().schema().schedules;
        match schedules.iter().find(|schedule| schedule.target == op) {
            Some(schedule) => Err(Refusal::schedule_target(op, &schedule.name)),
            None => Ok(()),
        }
    }
    pub(super) fn timer_trace(&self, id: &str) -> Result<Json, Refusal> {
        let trace = self
            .runtime()
            .store()
            .timer_trace(id)
            .map_err(|e| Refusal::from_runtime(&e))?;
        if trace["timer"].is_null() && trace["firings"].as_array().is_none_or(|a| a.is_empty()) {
            return Err(Refusal::new(
                "E_INPUT_TRACE_UNKNOWN",
                "input",
                format!("unknown timer {id}"),
                "use a timer id from /control/timers or logs",
                "schedule",
            )
            .with_site(format!("timer:{id}")));
        }
        Ok(trace)
    }
}
