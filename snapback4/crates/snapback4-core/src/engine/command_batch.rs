//! FIFO collection and latency control for the program-only batch lane.
use super::{Engine, SubmitError, Ticket, Work};
use crate::Refusal;
use crate::engine::{MutationAcknowledgement, program::Invocation};
use std::{
    collections::VecDeque,
    sync::{Arc, Mutex, mpsc},
    time::{Duration, Instant},
};
type Outcome = Result<MutationAcknowledgement, Refusal>;

/// Hosts prepare owned intent against the worker generation, then publish the
/// durable result. Neither callback receives a transaction or a reply sender.
pub struct ProgramCommand<T> {
    prepare: Box<dyn FnOnce(&mut Engine) -> Result<Invocation, Refusal> + Send>,
    finish: Box<dyn FnOnce(&mut Engine, Outcome) -> T + Send>,
    admitted: Instant,
    #[cfg(any(test, feature = "test-support"))]
    attribution: Option<crate::round_trips::Handle>,
}
impl<T> ProgramCommand<T> {
    /// Preserve the host's original intake clock through body and worker waits.
    // @ref LLP 3000.009.001.000.002#3.1 — fallback uses the remaining end-to-end deadline.
    pub fn accepted_at(mut self, accepted: Instant) -> Self {
        self.admitted = self.admitted.min(accepted);
        self
    }
    pub fn new(
        invocation: Invocation,
        finish: impl FnOnce(&mut Engine, Outcome) -> T + Send + 'static,
    ) -> Self {
        Self::prepare(move |_| Ok(invocation), finish)
    }
    pub fn prepare(
        prepare: impl FnOnce(&mut Engine) -> Result<Invocation, Refusal> + Send + 'static,
        finish: impl FnOnce(&mut Engine, Outcome) -> T + Send + 'static,
    ) -> Self {
        Self {
            prepare: Box::new(prepare),
            finish: Box::new(finish),
            admitted: Instant::now(),
            #[cfg(any(test, feature = "test-support"))]
            attribution: crate::round_trips::current(),
        }
    }
}

pub(super) enum Queued {
    Solo(Work),
    Program(Box<dyn Task>),
}
pub(super) enum Prepared {
    Ready(Invocation),
    Failed(Refusal),
    Gone,
}
pub(super) trait Task: Send {
    fn build_intent(&mut self, engine: &mut Engine) -> Prepared;
    fn finish(self: Box<Self>, engine: &mut Engine, outcome: Outcome);
    fn unknown(self: Box<Self>);
}
pub(super) struct ProgramTask<T> {
    command: ProgramCommand<T>,
    sent: mpsc::SyncSender<Result<std::thread::Result<T>, SubmitError>>,
    ticket: Ticket,
}
impl<T: Send + 'static> ProgramTask<T> {
    pub(super) fn new(
        command: ProgramCommand<T>,
        sent: mpsc::SyncSender<Result<std::thread::Result<T>, SubmitError>>,
        ticket: Ticket,
    ) -> Self {
        Self {
            command,
            sent,
            ticket,
        }
    }
}
impl<T: Send + 'static> Task for ProgramTask<T> {
    fn build_intent(&mut self, engine: &mut Engine) -> Prepared {
        if !self.ticket.start_execution(engine) {
            return Prepared::Gone;
        }
        #[cfg(any(test, feature = "test-support"))]
        let _guard = self
            .command
            .attribution
            .clone()
            .map(crate::round_trips::Handle::enter);
        let prepare = std::mem::replace(&mut self.command.prepare, Box::new(|_| unreachable!()));
        match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| prepare(engine))) {
            Ok(Ok(mut invocation)) => {
                invocation.admitted = self.command.admitted;
                invocation.deadline = invocation.admitted + Duration::from_millis(100);
                #[cfg(any(test, feature = "test-support"))]
                {
                    invocation.attribution = self.command.attribution.clone();
                }
                Prepared::Ready(invocation)
            }
            Ok(Err(why)) => Prepared::Failed(why),
            Err(panic) => {
                let _ = self.sent.send(Ok(Err(panic)));
                Prepared::Gone
            }
        }
    }
    fn finish(self: Box<Self>, engine: &mut Engine, outcome: Outcome) {
        let Self {
            command,
            sent,
            ticket: _ticket,
            ..
        } = *self;
        #[cfg(any(test, feature = "test-support"))]
        let _guard = command
            .attribution
            .clone()
            .map(crate::round_trips::Handle::enter);
        let value = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            (command.finish)(engine, outcome)
        }));
        let _ = sent.send(Ok(value));
    }
    fn unknown(self: Box<Self>) {
        let _ = self.sent.send(Err(SubmitError::OutcomeUnknown));
    }
}

#[derive(Clone, Copy, Debug)]
pub enum BatchPolicy {
    Adaptive,
    Fixed(usize),
}
#[derive(Clone, Debug, serde::Serialize)]
pub struct BatchStats {
    pub fills: Vec<u64>,
    pub members: u64,
    pub target: usize,
    pub p99_micros: u64,
    pub commit_attempts: u64,
    pub commit_nanos: u64,
    #[serde(skip)]
    fixed: bool,
    #[serde(skip)]
    samples: VecDeque<u64>,
    #[serde(skip)]
    since_resize: usize,
}
impl BatchStats {
    pub(super) fn new(policy: BatchPolicy) -> Self {
        let target = match policy {
            BatchPolicy::Adaptive => 32,
            BatchPolicy::Fixed(n) => {
                assert!((1..=32).contains(&n));
                n
            }
        };
        Self {
            fills: vec![0; 33],
            members: 0,
            target,
            p99_micros: 0,
            commit_attempts: 0,
            commit_nanos: 0,
            fixed: matches!(policy, BatchPolicy::Fixed(_)),
            samples: VecDeque::new(),
            since_resize: 0,
        }
    }
    fn observe(&mut self, latencies: impl IntoIterator<Item = u64>, fill: usize) {
        if fill == 0 {
            return;
        }
        self.fills[fill] += 1;
        self.members += fill as u64;
        for latency in latencies {
            self.samples.push_back(latency);
            if self.samples.len() > 256 {
                self.samples.pop_front();
            }
        }
        let mut sorted: Vec<_> = self.samples.iter().copied().collect();
        sorted.sort_unstable();
        self.p99_micros = sorted[(sorted.len() * 99).div_ceil(100).saturating_sub(1)];
        self.since_resize += 1;
        // @ref LLP 3000.009.001.000.000#7 — queue through COMMIT latency governs the largest admitted N; idle never waits to fill.
        if !self.fixed && self.since_resize >= 32 {
            let next = if self.p99_micros > 100_000 {
                (self.target / 2).max(1)
            } else if self.p99_micros < 80_000 {
                (self.target + 1).min(32)
            } else {
                self.target
            };
            if next != self.target {
                self.target = next;
                self.samples.clear();
            }
            self.since_resize = 0;
        }
    }
}

pub(super) fn run(
    receiver: mpsc::Receiver<Queued>,
    mut execute: impl FnMut(Work),
    stats: Arc<Mutex<BatchStats>>,
) {
    let mut pending = None;
    loop {
        let work = match pending.take().map(Ok).unwrap_or_else(|| receiver.recv()) {
            Ok(work) => work,
            Err(_) => break,
        };
        let Queued::Program(first) = work else {
            if let Queued::Solo(work) = work {
                execute(work);
            }
            continue;
        };
        let started = Instant::now();
        let target = stats.lock().unwrap().target;
        let mut tasks = vec![first];
        // Only drain work already present. Empty means immediate COMMIT; the
        // collection cap bounds even a continuously replenished mailbox.
        while tasks.len() < target && started.elapsed() < Duration::from_millis(1) {
            match receiver.try_recv() {
                Ok(Queued::Program(task)) => tasks.push(task),
                Ok(solo) => {
                    pending = Some(solo);
                    break;
                }
                Err(_) => break,
            }
        }
        let stats = stats.clone();
        execute(Box::new(move |engine| {
            let mut invocations = Vec::new();
            let mut slots = Vec::new();
            for mut task in tasks {
                match task.build_intent(engine) {
                    Prepared::Ready(invocation) => {
                        let i = invocations.len();
                        invocations.push(invocation);
                        slots.push((task, Ok(i)));
                    }
                    Prepared::Failed(why) => slots.push((task, Err(why))),
                    Prepared::Gone => {}
                }
            }
            let count = invocations.len();
            #[cfg(any(test, feature = "test-support"))]
            let before = crate::round_trips::commit_timing();
            let outcomes = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                engine.invoke_program_batch(&mut invocations)
            }));
            #[cfg(any(test, feature = "test-support"))]
            {
                let after = crate::round_trips::commit_timing();
                let mut stats = stats.lock().unwrap();
                stats.commit_attempts += after.attempts - before.attempts;
                stats.commit_nanos += after.nanos - before.nanos;
            }
            let latencies: Vec<_> = invocations
                .iter()
                .map(|i| i.admitted.elapsed().as_micros().min(u64::MAX as u128) as u64)
                .collect();
            stats.lock().unwrap().observe(latencies, count);
            match outcomes {
                Ok(outcomes) => {
                    for (task, slot) in slots {
                        task.finish(
                            engine,
                            match slot {
                                Ok(i) => outcomes[i].clone(),
                                Err(why) => Err(why),
                            },
                        );
                    }
                }
                Err(_) => {
                    for (task, _) in slots {
                        task.unknown();
                    }
                }
            }
        }));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn p99_control_backs_off_and_recovers_inside_32() {
        let mut stats = BatchStats::new(BatchPolicy::Adaptive);
        for _ in 0..32 {
            stats.observe([101_000], 1);
        }
        assert_eq!(stats.target, 16);
        for _ in 0..32 {
            stats.observe([1_000], 1);
        }
        assert_eq!(stats.target, 17);
        let mut fixed = BatchStats::new(BatchPolicy::Fixed(4));
        for _ in 0..64 {
            fixed.observe([1_000_000], 4);
        }
        assert_eq!(fixed.target, 4);
    }
}
