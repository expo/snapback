//! Bounded continuation parking. The two validators share the existing PG pool.
// @ref LLP 3000.009.001.000.002#g5-read-index-validation — no execution worker, reader loan, release lease or transport permit while parked.
use super::*;

pub(super) struct Resume {
    pub shared: Arc<Shared>, pub admission: Arc<RequestAdmission>, pub _permit: RequestPermit, pub deadline: Option<Instant>,
}
#[cfg(feature="postgres")]
mod enabled {
    use super::*;
    use snapback4_core::engine::revision_cache::{ReadIndexCandidate,ReadIndexProof,ReadIndexValidation};
    type Ready = Box<dyn FnOnce(Request, ReadIndexProof) + Send>;
    type Validate = Arc<dyn Fn() -> Option<ReadIndexValidation> + Send + Sync>;
    struct Waiter { request: Request, candidate: ReadIndexCandidate, ready: Ready, resume: Arc<Resume>, until: Instant }
    struct Batch { waiters: Vec<Waiter>, opened: Instant }
    struct State { pending: Batch, running: Vec<Arc<Mutex<Batch>>>, stopped: bool }
    struct Schedule { state: Mutex<State>, changed: Condvar }
    pub(in crate::serve) struct Queue { schedule: Arc<Schedule>, #[cfg(test)] ticks: AtomicUsize, validators: request_workers::Workers, validate: Validate }
    const COLLECT: Duration = Duration::from_micros(200);
    const WAIT: Duration = Duration::from_millis(8);
    impl Default for Batch { fn default()->Self { Self {waiters:Vec::new(),opened:Instant::now()} } }
    impl Queue {
        #[cfg(test)]
        pub(in crate::serve) fn parked(&self)->usize {let state=lock(&self.schedule.state);state.pending.waiters.len()+state.running.iter().map(|b|lock(&**b).waiters.len()).sum::<usize>()}

        #[cfg(test)]
        pub(in crate::serve) fn timer_ticks(&self)->usize {self.ticks.load(Ordering::Relaxed)}

        fn new(validate: Validate, fail_spawn: bool) -> std::io::Result<Arc<Self>> {
            let schedule=Arc::new(Schedule {state:Mutex::new(State {pending:Batch::default(),running:Vec::new(),stopped:false}),changed:Condvar::new()});
            let queue=Arc::new(Self {schedule:schedule.clone(),#[cfg(test)] ticks:AtomicUsize::new(0),validators:Default::default(),validate});
            let weak=Arc::downgrade(&queue);
            // Failure caches an ordinary-G5 fallback for this admission owner.
            if fail_spawn { return Err(std::io::Error::other("injected read-index timer spawn failure")); }
            std::thread::Builder::new().name("read-index-timer".into()).spawn(move || {
                loop {
                    let Some(queue)=weak.upgrade() else {break};
                    queue.tick();
                    // Waiting retains only the schedule, so Queue::drop can
                    // wake and stop an idle timer when its owner disappears.
                    drop(queue);
                    let mut state=lock(&schedule.state);
                    if state.stopped { break; }
                    let mut wake=state.pending.waiters.iter().map(|w|w.until).min();
                    for batch in &state.running {
                        for w in &lock(&**batch).waiters {wake=Some(wake.map_or(w.until,|at|at.min(w.until)));}
                    }
                    if !state.pending.waiters.is_empty() && state.running.len()<2 {
                        let collect=state.pending.opened+COLLECT;
                        wake=Some(wake.map_or(collect,|at|at.min(collect)));
                    }
                    if let Some(wake)=wake {
                        state=schedule.changed.wait_timeout(state,wake.saturating_duration_since(Instant::now())).unwrap_or_else(|p|p.into_inner()).0;
                    } else {
                        state=schedule.changed.wait(state).unwrap_or_else(|p|p.into_inner());
                    }
                    if state.stopped { break; }
                }
            })?;
            Ok(queue)
        }
        fn tick(self: &Arc<Self>) {
            #[cfg(test)] self.ticks.fetch_add(1,Ordering::Relaxed);
            let mut state=lock(&self.schedule.state);
            let now=Instant::now();
            let mut expired=Vec::new();
            let mut sweep=|batch: &mut Batch| {
                let (old,live)=std::mem::take(&mut batch.waiters).into_iter().partition(|w:&Waiter|now>=w.until || w.request.is_aborted());
                batch.waiters=live; expired.extend(old);
            };
            sweep(&mut state.pending);
            for batch in &state.running {sweep(&mut lock(&**batch));}
            let launch=if !state.pending.waiters.is_empty() && state.running.len()<2 && now>=state.pending.opened+COLLECT {
                // Detach enrollment before any validator can submit its SQL.
                let batch=Arc::new(Mutex::new(std::mem::take(&mut state.pending)));
                state.running.push(batch.clone());Some(batch)
            } else {None};
            drop(state);
            for waiter in expired { Self::complete(waiter,None); }
            if let Some(batch)=launch {
                let queue=self.clone();
                let failed_batch=batch.clone();
                if self.validators.submit_until(2,std::thread::Builder::new().name("read-index-flight".into()),None,Box::new(move|| {
                    let validation=std::panic::catch_unwind(std::panic::AssertUnwindSafe(||(queue.validate)())).ok().flatten();
                    let waiters=std::mem::take(&mut lock(&*batch).waiters);
                    { let mut state=lock(&queue.schedule.state);state.running.retain(|b|!Arc::ptr_eq(b,&batch)); }
                    queue.schedule.changed.notify_one();
                    for waiter in waiters {Self::complete(waiter,validation.clone());}
                })).is_err() {
                    let waiters=std::mem::take(&mut lock(&*failed_batch).waiters);
                    lock(&self.schedule.state).running.retain(|b|!Arc::ptr_eq(b,&failed_batch));
                    for waiter in waiters {Self::complete(waiter,None);}
                }
            }
        }
        fn complete(waiter: Waiter, validation: Option<ReadIndexValidation>) {
            let Waiter {request,candidate,ready,resume,until}=waiter;
            if request.is_aborted() {request.abort();return;}
            let deadline=resume.deadline.unwrap_or_else(||request_workers::deadline(&request,SHORT_REQUEST_DEADLINE));
            if Instant::now()>=deadline {resume.admission.refuse(request,RequestClass::Short);return;}
            let proof=candidate.complete(if Instant::now()<until {validation} else {None});
            let admission=resume.admission.clone();
            let pending=PendingRequest {request:Some(request),admission:admission.clone(),class:RequestClass::Short};
            let _=admission.workers[RequestClass::Short as usize].submit_until(REQUEST_WORKERS,std::thread::Builder::new().name("request".into()),Some(deadline),Box::new(move|| {
                let _resume=resume;ready(pending.take(),proof);
            }));
        }
    }
    impl Drop for Queue {
        fn drop(&mut self) {
            lock(&self.schedule.state).stopped=true;
            self.schedule.changed.notify_one();
        }
    }
    impl Resume {
        pub(in crate::serve) fn park(self: &Arc<Self>, candidate: ReadIndexCandidate, request: Request, ready: Ready) {
            crate::release_requests::executed();
            let queue=self.admission.ri.get_or_init(|| {
                let shared=Arc::downgrade(&self.shared);
                #[cfg(test)] test_work(&self.admission.ri_timer_spawn);
                #[cfg(test)] let fail_spawn=self.admission.ri_fail_timer.load(Ordering::Relaxed);
                #[cfg(not(test))] let fail_spawn=false;
                Queue::new(Arc::new(move|| {
                    let shared=shared.upgrade()?;
                    #[cfg(test)] test_work(&shared.read_index_validation);
                    let (epoch,mut reader)=shared.reader().ok()?;
                    let proof=reader.validate_read_index();
                    lock(&shared.readers).put(&epoch,reader.into_inner());
                    proof
                }),fail_spawn).map_err(|_| ())
            });
            #[cfg(not(test))]
            let budget=WAIT;
            #[cfg(test)] let budget=Duration::from_micros(self.admission.ri_wait_micros.load(Ordering::Relaxed));
            let until=(Instant::now()+budget).min(self.deadline.unwrap_or_else(||request_workers::deadline(&request,SHORT_REQUEST_DEADLINE)));
            let waiter=Waiter {request,candidate,ready,resume:self.clone(),until};
            let Ok(queue)=queue else {
                Queue::complete(waiter,None);
                return;
            };
            let mut state=lock(&queue.schedule.state);
            if state.pending.waiters.is_empty() {state.pending.opened=Instant::now();}
            state.pending.waiters.push(waiter);
            drop(state);queue.schedule.changed.notify_one();
        }
    }
}
#[cfg(feature="postgres")]
pub(super) use enabled::Queue;
#[cfg(not(feature="postgres"))]
pub(super) struct Queue;
