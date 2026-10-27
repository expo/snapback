//! FIFO collection and latency diagnostics for the program-only batch lane.
use super::{Completion, Engine, SubmitError, Ticket, Work};
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
    Solo(Work, Box<dyn FnOnce() + Send>),
    Program(Box<dyn Task>),
}
pub(super) enum Prepared {
    Ready(Invocation),
    Failed(Refusal),
    Gone,
}
pub(super) trait Task: Send {
    fn arrived(&self) -> Instant;
    fn build_intent(&mut self, engine: &mut Engine) -> Prepared;
    fn finish(self: Box<Self>, engine: &mut Engine, outcome: Outcome);
    fn unknown(self: Box<Self>);
}
pub(super) struct ProgramTask<T> {
    command: ProgramCommand<T>,
    sent: Completion<T>,
    ticket: Ticket,
    arrived: Instant,
}
impl<T: Send + 'static> ProgramTask<T> {
    pub(super) fn new(
        command: ProgramCommand<T>,
        sent: Completion<T>,
        ticket: Ticket,
    ) -> Self {
        Self {
            command,
            sent,
            ticket,
            arrived: Instant::now(),
        }
    }
}
impl<T: Send + 'static> Task for ProgramTask<T> {
    fn arrived(&self) -> Instant { self.arrived }
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
                let admission=self.ticket.admission.clone();
                invocation.final_dispatch=Some(Arc::new(move|dispatch| {
                    super::latch_expired(&admission);
                    let state=admission.lock().unwrap();
                    if state.lost || super::admission_uncertain(&state) {Err(crate::RuntimeError::StoreOwnership("ownership lost before final dispatch".into()))}
                    else {dispatch();Ok(())}
                }));
                let admission=self.ticket.admission.clone();
                invocation.final_check=Some(Box::new(move|| {
                    super::latch_expired(&admission);
                    let state=admission.lock().unwrap();
                    if state.lost || super::admission_uncertain(&state) {Err(crate::RuntimeError::StoreOwnership("ownership lost before final dispatch".into()))} else {Ok(())}
                }));
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
                self.sent.complete(Ok(Err(panic)));
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
        sent.complete(Ok(value));
        #[cfg(test)]
        crate::engine::wf_profile::reply();
    }
    fn unknown(self: Box<Self>) {
        self.sent.complete(Err(SubmitError::OutcomeUnknown));
    }
}

#[derive(Clone, Copy, Debug)]
pub enum BatchPolicy {
    /// Coalesce available traffic up to 32; latency never reduces drain capacity.
    Adaptive,
    Fixed(usize),
}
#[derive(Clone, Debug, serde::Serialize)]
pub struct BatchStats {
    #[cfg(any(test,feature="test-support"))]
    pub result_polls: u64,
    pub fills: Vec<u64>,
    /// Dispatch samples by number of outstanding batches, including this one.
    pub in_flight_at_dispatch: [u64; 3],
    pub members: u64,
    pub target: usize,
    pub p99_micros: u64,
    pub commit_attempts: u64,
    pub commit_nanos: u64,
    #[serde(skip)]
    pipeline_fill: bool,
    #[serde(skip)]
    samples: VecDeque<u64>,
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
            #[cfg(any(test,feature="test-support"))]
            result_polls: 0,
            fills: vec![0; 33],
            in_flight_at_dispatch: [0; 3],
            members: 0,
            target,
            p99_micros: 0,
            commit_attempts: 0,
            commit_nanos: 0,
            pipeline_fill: false,
            samples: VecDeque::new(),
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
        // @ref LLP 3000.009.001.000.002#3.4 — queue age diagnoses overload; it must not reduce the capacity needed to drain it.
        // The cap bounds work, not collection delay. A latency-driven reduction
        // can strand a batched-capable store at serial throughput, including
        // after a transient service spike. Keep all 32 slots available on both
        // stores; Arrivals independently bounds waiting (none at depth two).
    }
}

const COLLECTION: Duration = Duration::from_millis(1);
// A burst queued during a write cycle is still recent. This is history age,
// not a fill budget: collection always ends at started + COLLECTION.
const RECENT: Duration = Duration::from_millis(20);
/// An exponentially smoothed interarrival interval from actual mailbox intake,
/// never response rate. A gap beyond the history horizon starts idle again.
#[derive(Default)]
struct Arrivals {
    last: Option<Instant>,
    interval: Option<Duration>,
}
impl Arrivals {
    fn observe(&mut self, at: Instant) {
        if let Some(last) = self.last {
            let gap = at.saturating_duration_since(last);
            self.interval = if gap > RECENT { None } else {
                Some(self.interval.map_or(gap, |old| (old * 3 + gap) / 4))
            };
        }
        self.last = Some(at);
    }
    // @ref LLP 3000.009.001.000.002#3.4 — non-idle predicted arrivals may fill within one fixed window; never wait for the cap.
    fn wait(&self, started: Instant, now: Instant) -> Option<Duration> {
        let until = started + COLLECTION;
        let remaining = until.checked_duration_since(now).filter(|r| !r.is_zero())?;
        let last = self.last?;
        let interval = self.interval?;
        if now.saturating_duration_since(last) >= RECENT || last + interval > until { return None; }
        // An absent predicted arrival ends collection after one estimated
        // interval, rather than spending the whole window on a stale burst.
        Some(remaining.min(interval.max(Duration::from_micros(1))))
    }
    // @ref LLP 3000.009.001.000.000.002#8.1 — depth two starts available work rather than waiting for clients held by its predecessor.
    fn collection_wait(&self, started: Instant, now: Instant, depth: usize) -> Option<Duration> {
        if depth == 2 { None } else { self.wait(started, now) }
    }
}

pub(super) fn run(
    receiver: mpsc::Receiver<Queued>,
    mut host_execute: impl FnMut(Work),
    stats: Arc<Mutex<BatchStats>>,
    depth:usize,
    admission: Arc<Mutex<super::Admission>>,
    notice: Arc<super::notice::Notice>,
    ready: mpsc::SyncSender<Result<(), String>>,
) {
    #[cfg(not(feature="postgres"))]
    let _=(depth, &admission);
    let timing_stats=stats.clone();
    let mut execute=move|work:Work| {
        let stats=timing_stats.clone();
        host_execute(Box::new(move|engine|{
            #[cfg(any(test,feature="test-support"))]
            let before=crate::round_trips::commit_timing();
            work(engine);
            #[cfg(any(test,feature="test-support"))]
            {let after=crate::round_trips::commit_timing();let mut stats=stats.lock().unwrap();stats.commit_attempts+=after.attempts-before.attempts;stats.commit_nanos+=after.nanos-before.nanos;}
            #[cfg(not(any(test,feature="test-support")))]
            let _=stats;
        }));
    };
    #[cfg(feature="postgres")]
    let lane={
        let mut lane=super::super::program_pipeline::Lane::new();
        let completion=notice.clone();
        lane.set_completion_notify(Arc::new(move ||completion.notify()));
        lane.set_recovery_guard(Arc::new(move || {
            super::latch_expired(&admission);
            !admission.lock().unwrap().lost
        }));
        Arc::new(Mutex::new(lane))
    };
    #[cfg(feature="postgres")]
    let recovery_gate={
        let slot=Arc::new(Mutex::new(None));let capture=slot.clone();
        execute(Box::new(move|engine|*capture.lock().unwrap()=engine.store.durability()));
        let gate=slot.lock().unwrap().clone();gate
    };
    #[cfg(feature="postgres")]
    let preparation = {
        let result = Arc::new(Mutex::new(Ok(())));
        let prepared = result.clone();
        let state = lane.clone();
        execute(Box::new(move |engine| {
            if depth == 2 { *prepared.lock().unwrap() = state.lock().unwrap().prepare_for_ingress(engine).map_err(|e| e.to_string()); }
        }));
        let result = result.lock().unwrap().clone();
        result
    };
    #[cfg(not(feature="postgres"))]
    let preparation = Ok(());
    let failed = preparation.is_err();
    let _ = ready.send(preparation);
    if failed { return; }
    let mut pending = None;
    let mut arrivals = Arrivals::default();
    loop {
        #[cfg(feature="postgres")]
        let observed=notice.version();
        #[cfg(feature="postgres")]
        while !lane.lock().unwrap().empty() {
            let state=lane.clone();
            let before=lane.lock().unwrap().len();
            #[cfg(any(test,feature="test-support"))]
            { stats.lock().unwrap().result_polls+=1; }
            // A third wave stays in the mailbox until an oldest-slot notification
            // frees capacity. With one slot active, release without polling timers.
            execute(Box::new(move |engine|{state.lock().unwrap().poll(engine,before==2);}));
            if lane.lock().unwrap().len()==before {break;}
        }
        let received = if let Some(work)=pending.take() { Ok(work) } else {
            #[cfg(feature="postgres")]
            if !lane.lock().unwrap().empty() {
                // @ref LLP 3000.009.001.000.000.002#3.6 — completions wake the sole release owner; every ready prefix releases before collecting more work.
                match receiver.try_recv() {
                    Ok(work)=>Ok(work),
                    Err(mpsc::TryRecvError::Empty)=>{notice.wait(observed);continue;}
                    Err(_)=>Err(mpsc::RecvError),
                }
            } else if let Some(gate)=&recovery_gate {
                match receiver.recv_timeout(Duration::from_millis(10)) {
                    Ok(work)=>Ok(work),
                    Err(mpsc::RecvTimeoutError::Timeout)=>{
                        if gate.broken() {let state=lane.clone();execute(Box::new(move|engine|state.lock().unwrap().drain(engine)));}
                        continue;
                    }
                    Err(_)=>Err(mpsc::RecvError),
                }
            } else {receiver.recv()}
            #[cfg(not(feature="postgres"))]
            receiver.recv()
        };
        let work = match received {
            Ok(work) => work,
            Err(_) => {
                #[cfg(feature="postgres")]
                { let state=lane.clone(); execute(Box::new(move|engine|state.lock().unwrap().drain(engine))); }
                break;
            }
        };
        let Queued::Program(first) = work else {
            if let Queued::Solo(work, unknown) = work {
                #[cfg(feature="postgres")]
                { let state=lane.clone(); execute(Box::new(move|engine| {let mut lane=state.lock().unwrap();lane.drain(engine);if lane.paused {unknown();} else {work(engine);}})); }
                #[cfg(not(feature="postgres"))]
                { let _=unknown; execute(work); }
            }
            continue;
        };
        let started = Instant::now();
        arrivals.observe(first.arrived());
        let (target, fill_depth) = {
            let stats = stats.lock().unwrap();
            (stats.target, if depth == 2 && stats.pipeline_fill { 2 } else { 1 })
        };
        let mut tasks = vec![first];
        while tasks.len() < target && started.elapsed() < COLLECTION {
            let next = match receiver.try_recv() {
                Ok(work) => Ok(work),
                Err(mpsc::TryRecvError::Empty) => match arrivals.collection_wait(started, Instant::now(), fill_depth) {
                    Some(wait) => receiver.recv_timeout(wait).map_err(|_| ()),
                    None => Err(()),
                },
                Err(mpsc::TryRecvError::Disconnected) => Err(()),
            };
            match next {
                Ok(Queued::Program(task)) => { arrivals.observe(task.arrived()); tasks.push(task); },
                Ok(solo) => {
                    pending = Some(solo);
                    break;
                }
                Err(_) => break,
            }
        }
        #[cfg(test)]
        let collected=Instant::now();
        #[cfg(test)]
        for task in &tasks {
            crate::engine::wf_profile::record("queue", started.saturating_duration_since(task.arrived()), 0, 1);
            crate::engine::wf_profile::record("fill", collected.duration_since(started.max(task.arrived())), 0, 1);
        }
        let stats = stats.clone();
        #[cfg(feature="postgres")]
        let state=lane.clone();
        execute(Box::new(move |engine| {
            #[cfg(test)]
            let _profile = crate::engine::wf_profile::Scope::new("preparation", tasks.len());
            #[cfg(feature="postgres")]
            {
                let mut lane=state.lock().unwrap();
                if lane.paused {
                    lane.drain(engine);
                    if lane.paused {for task in tasks {task.unknown();} return;}
                }
            }
            #[cfg(feature="postgres")]
            { stats.lock().unwrap().pipeline_fill = matches!(engine.store, crate::store_port::AnyStore::Postgres(_)); }
            let dispatched = Instant::now();
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
            let admitted=invocations.iter().map(|i|i.admitted).collect::<Vec<_>>();
            let dispatch_stats = stats.clone();
            let finish = move |engine:&mut Engine, outcomes:Option<Vec<Outcome>>| {
                let latencies:Vec<_>=admitted.iter().map(|i|i.elapsed().as_micros().min(u64::MAX as u128) as u64).collect();
                let service_us = dispatched.elapsed().as_micros() as u64;
                let admitted_us = latencies.iter().copied().max().unwrap_or(0);
                let mut stats = stats.lock().unwrap();
                stats.observe(latencies,count);
                // Numeric, opt-in diagnostic over the existing BatchStats surface.
                static TRACE: std::sync::OnceLock<Option<Mutex<std::fs::File>>> = std::sync::OnceLock::new();
                // A bad path disables the trace; it must never take down the committer.
                if let Some(file) = TRACE.get_or_init(|| std::env::var_os("SNAPBACK4_BATCH_TRACE").and_then(|path| {
                    match std::fs::OpenOptions::new().create_new(true).write(true).open(&path) {
                        Ok(file) => Some(Mutex::new(file)),
                        Err(error) => { eprintln!("snapback4: SNAPBACK4_BATCH_TRACE disabled ({}): {error}", std::path::Path::new(&path).display()); None }
                    }
                })) {
                    use std::io::Write;
                    let _ = writeln!(file.lock().unwrap(), "{}", serde_json::json!({
                        "n":count,"members":stats.members,"target":stats.target,
                        "p99_us":stats.p99_micros,"admitted_us":admitted_us,"service_us":service_us
                    }));
                }
                drop(stats);
                let mut outcomes=outcomes.map(|outcomes|outcomes.into_iter().map(Some).collect::<Vec<_>>());
                for (task,slot) in slots {
                    if let Some(outcomes)=&mut outcomes {task.finish(engine,match slot {Ok(i)=>outcomes[i].take().expect("one callback per invocation"),Err(why)=>Err(why)});}
                    else {task.unknown();}
                }
            };
            let mut plans = (0..count).map(|_|None).collect();
            #[cfg(feature="postgres")]
            {
                let mut lane=state.lock().unwrap();
                if depth==2 && super::super::program_pipeline::Lane::eligible(engine,&invocations,!lane.empty(),&mut plans) {
                    let before = lane.len();
                    let result=std::panic::catch_unwind(std::panic::AssertUnwindSafe(||lane.start_planned(engine,invocations,plans,Box::new(move|e,o|finish(e,Some(o))))));
                    if lane.len() == before + 1 {
                        dispatch_stats.lock().unwrap().in_flight_at_dispatch[lane.len()] += 1;
                    }
                    if result.is_err(){lane.paused=true;lane.close_uncertain(engine);lane.drain(engine);}
                    return;
                }
                // A continuation released by the drain may adopt a different
                // immutable host. Plans cannot carry proof across that epoch.
                let binding = (engine.store_id.clone(), engine.generation, engine.code_native_digest.clone());
                lane.drain(engine);
                if lane.paused {finish(engine,None);return;}
                if binding != (engine.store_id.clone(), engine.generation, engine.code_native_digest.clone()) {
                    plans.iter_mut().for_each(|p| *p=None);
                }
            }
            if count > 0 { dispatch_stats.lock().unwrap().in_flight_at_dispatch[1] += 1; }
            let outcomes=std::panic::catch_unwind(std::panic::AssertUnwindSafe(||engine.invoke_program_batch_planned(&mut invocations,&mut plans)));
            finish(engine,outcomes.ok());
        }));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pipeline_fill_starts_available_work_without_waiting_for_the_cap() {
        let now = Instant::now();
        let mut arrivals = Arrivals::default();
        arrivals.observe(now - Duration::from_micros(100));
        arrivals.observe(now);
        assert!(arrivals.collection_wait(now, now, 1).is_some());
        assert!(arrivals.collection_wait(now, now, 2).is_none(),
            "a free pipeline slot must start the available FIFO members");
    }
    #[test]
    fn queue_dominated_trace_collapses_legacy_control_but_keeps_drain_capacity() {
        let mut old = BatchStats::new(BatchPolicy::Adaptive);
        let mut current = BatchStats::new(BatchPolicy::Adaptive);
        let mut old_targets = Vec::new();
        // Replay the old 32-batch decision windows exactly. Each member has
        // 12 ms service plus queue age above the SLO, regardless of batch cap.
        for window in 0..6 {
            for _ in 0..32 {
                let latency = 120_000 + window * 10_000;
                old.observe([latency], 1);
                current.observe([latency], 1);
            }
            let next = if old.p99_micros > 100_000 { (old.target / 2).max(1) }
                else if old.p99_micros < 80_000 { (old.target + 1).min(32) }
                else { old.target };
            if next != old.target { old.target = next; old.samples.clear(); }
            old_targets.push(old.target);
            assert_eq!(current.target, 32);
        }
        assert_eq!(old_targets, [16, 8, 4, 2, 1, 1]);
        assert!(current.p99_micros > 100_000, "queue pressure remains observable");
    }
    #[test]
    fn transient_service_spike_ages_out_without_reducing_available_fill() {
        let mut stats = BatchStats::new(BatchPolicy::Adaptive);
        stats.observe([400_000; 32], 32);
        for _ in 0..256 {
            stats.observe([12_000], 1);
            assert_eq!(stats.target, 32);
        }
        assert_eq!(stats.p99_micros, 12_000);
        assert_eq!(stats.members, 288);
        assert_eq!(stats.fills[32], 1);
        let mut fixed = BatchStats::new(BatchPolicy::Fixed(4));
        for _ in 0..64 { fixed.observe([1_000_000; 4], 4); }
        assert_eq!(fixed.target, 4);
    }
    fn queued_age_does_not_poison_next_burst(pg: bool) {
        use crate::engine::command::{Command, ProgramCommand, Queue};
        let engine = crate::engine::program_batch::tests::fixture(pg);
        let queue = Queue::start(engine, 128).unwrap();
        let invocation = || Invocation::new("increment", None, crate::Context::new("alice", [
            ("key".into(), crate::Value::Id("a".into())),
            ("delta".into(), crate::Value::Int(1)),
            ("reject".into(), crate::Value::Bool(false)),
        ].into()).at(1001));
        // Deterministic admission age avoids a wall-clock sleep. Whether an
        // overdue member refuses or commits, its completion cannot poison N.
        for _ in 0..192 {
            queue.submit_program(ProgramCommand::new(invocation(), |_, _| ())
                .accepted_at(Instant::now() - Duration::from_millis(200)))
                .unwrap().wait().unwrap();
        }
        let before = queue.batch_stats();
        assert_eq!(before.target, 32);
        assert!(before.p99_micros > 100_000);
        let (entered, started) = mpsc::channel();
        let (release, resume) = mpsc::channel();
        let held = queue.submit(Command::new(move |_| {
            entered.send(()).unwrap();
            resume.recv_timeout(Duration::from_secs(10)).unwrap();
        })).unwrap();
        started.recv_timeout(Duration::from_secs(5)).unwrap();
        let replies: Vec<_> = (0..32).map(|_| queue.submit_program(
            ProgramCommand::new(invocation(), |_, result| result)).unwrap()).collect();
        release.send(()).unwrap();
        held.wait().unwrap();
        for reply in replies { assert!(reply.wait().unwrap().is_ok()); }
        let after = queue.batch_stats();
        assert_eq!(after.members - before.members, 32);
        assert!(after.fills.iter().enumerate().skip(2).any(|(n, count)| *count > before.fills[n]),
            "fresh queued members must coalesce after old admission-age spikes");
    }
    #[test]
    fn sqlite_queue_age_does_not_poison_next_burst() { queued_age_does_not_poison_next_burst(false); }
    #[cfg(feature = "postgres")]
    #[test]
    #[ignore = "private Postgres"]
    fn postgres_queue_age_does_not_poison_next_burst() { queued_age_does_not_poison_next_burst(true); }
    #[test]
    fn idle_and_low_rate_never_wait() {
        let start = Instant::now();
        let mut arrivals = Arrivals::default();
        arrivals.observe(start);
        assert_eq!(arrivals.wait(start, start), None);
        arrivals.observe(start + Duration::from_millis(2));
        assert_eq!(arrivals.wait(start + Duration::from_millis(2), start + Duration::from_millis(2)), None);
        arrivals.observe(start + Duration::from_millis(30));
        assert_eq!(arrivals.wait(start + Duration::from_millis(30), start + Duration::from_millis(30)), None);
    }
    #[test]
    fn queued_non_idle_arrivals_remain_recent_across_a_write_cycle() {
        let start = Instant::now();
        let mut arrivals = Arrivals::default();
        arrivals.observe(start - Duration::from_millis(4));
        arrivals.observe(start - Duration::from_micros(3900));
        assert_eq!(arrivals.wait(start, start), Some(Duration::from_micros(100)), "a busy writer's queued burst is not an idle mailbox");
    }
    #[test]
    fn non_idle_predicts_fill_but_cannot_extend_the_original_window() {
        let start = Instant::now();
        let mut arrivals = Arrivals::default();
        arrivals.observe(start - Duration::from_micros(250));
        arrivals.observe(start);
        assert_eq!(arrivals.wait(start, start), Some(Duration::from_micros(250)));
        arrivals.observe(start + Duration::from_micros(800));
        assert_eq!(arrivals.wait(start, start + Duration::from_micros(900)), None, "predicted arrival lies beyond the window");
        assert_eq!(arrivals.wait(start, start + COLLECTION), None);
        assert_eq!(arrivals.wait(start + Duration::from_millis(30), start + Duration::from_millis(30)), None, "old traffic cannot create an idle delay");
    }
}
