//! Private inputs observed by one attempt. Reruns record fresh observations.
use super::{Context, Presence};
use std::sync::{Arc, Mutex};

#[derive(Default)]
pub(super) struct Attempt {
    pub at: Option<i64>,
    pub minted: Vec<String>,
    presence: Option<Arc<Mutex<Vec<Observation>>>>,
}
struct Observation {
    _principal: String,
    _at: Option<i64>,
    _connections: u64,
    _deadline: Option<i64>,
}
struct Recorded {
    source: Arc<dyn Presence>,
    values: Arc<Mutex<Vec<Observation>>>,
}
impl std::fmt::Debug for Recorded {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("RecordedPresence")
    }
}
impl Recorded {
    fn record(
        &self,
        principal: &str,
        at: Option<i64>,
        value: (u64, Option<i64>),
    ) -> (u64, Option<i64>) {
        self.values.lock().unwrap().push(Observation {
            _principal: principal.into(),
            _at: at,
            _connections: value.0,
            _deadline: value.1,
        });
        value
    }
}
impl Presence for Recorded {
    fn connections(&self, principal: &str) -> u64 {
        self.record(principal, None, (self.source.connections(principal), None))
            .0
    }
    fn effect_presence(&self, principal: &str) -> (u64, Option<i64>) {
        self.record(principal, None, self.source.effect_presence(principal))
    }
    fn effect_presence_at(&self, principal: &str, at: i64) -> (u64, Option<i64>) {
        self.record(
            principal,
            Some(at),
            self.source.effect_presence_at(principal, at),
        )
    }
}
impl Attempt {
    pub fn observe(&mut self, context: &mut Context) {
        self.at = context.now;
        if let Some(source) = context.presence.take() {
            let values = Arc::new(Mutex::new(Vec::new()));
            self.presence = Some(values.clone());
            context.presence = Some(Arc::new(Recorded { source, values }));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    #[derive(Debug)]
    struct Live(AtomicU64);
    impl Presence for Live {
        fn connections(&self, _: &str) -> u64 {
            self.0.load(Ordering::Acquire)
        }
    }
    #[test]
    fn another_attempt_observes_fresh_time_and_presence() {
        let source = Arc::new(Live(AtomicU64::new(0)));
        let input = Context::new("alice", Default::default()).with_presence(Some(source.clone()));
        let mut first = Attempt::default();
        let mut context = input.clone().at(1000);
        first.observe(&mut context);
        assert_eq!(context.presence.as_ref().unwrap().connections("alice"), 0);
        source.0.store(1, Ordering::Release);
        let mut next = Attempt::default();
        let mut context = input.at(2000);
        next.observe(&mut context);
        assert_eq!(context.presence.as_ref().unwrap().connections("alice"), 1);
        assert_eq!((first.at, next.at), (Some(1000), Some(2000)));
        assert_eq!(first.presence.unwrap().lock().unwrap()[0]._connections, 0);
        assert_eq!(next.presence.unwrap().lock().unwrap()[0]._connections, 1);
    }
}
