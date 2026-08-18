//! Commit-interlock port for higher-layer finite service authority.

use crate::auth::service_authority_contract::ServiceAuthorityDisposition;
use crate::diagnostic::{SnapbackError, SnapbackResult};

pub trait PreparedServiceAuthorityTerminal: Send {
    fn committed(self: Box<Self>) -> SnapbackResult<()>;
    fn rolled_back(self: Box<Self>);
    fn mark_ambiguous(&mut self);
}

pub trait ServiceAuthorityCommitInterlock: Send + Sync {
    fn prepare_terminal(
        &self,
        token_ids: &[String],
        disposition: ServiceAuthorityDisposition,
    ) -> SnapbackResult<Box<dyn PreparedServiceAuthorityTerminal>>;
}

#[derive(Debug, Default)]
struct UnavailableServiceAuthorityCommitInterlock;

impl ServiceAuthorityCommitInterlock for UnavailableServiceAuthorityCommitInterlock {
    fn prepare_terminal(
        &self,
        _token_ids: &[String],
        _disposition: ServiceAuthorityDisposition,
    ) -> SnapbackResult<Box<dyn PreparedServiceAuthorityTerminal>> {
        Err(SnapbackError::error(
            "SNAPBACK_SERVICE_AUTHORITY_UNAVAILABLE",
            "auth",
            "service-authority commit interlock is not installed",
        ))
    }
}

pub fn unavailable_service_authority_commit_interlock(
) -> std::sync::Arc<dyn ServiceAuthorityCommitInterlock> {
    std::sync::Arc::new(UnavailableServiceAuthorityCommitInterlock)
}

pub fn default_service_authority_commit_interlock(
) -> std::sync::Arc<dyn ServiceAuthorityCommitInterlock> {
    #[cfg(any(test, feature = "test-support"))]
    {
        return std::sync::Arc::new(RecordingServiceAuthorityCommitInterlock::default());
    }
    #[cfg(not(any(test, feature = "test-support")))]
    {
        unavailable_service_authority_commit_interlock()
    }
}

#[cfg(any(test, feature = "test-support"))]
#[derive(Clone, Default)]
pub struct RecordingServiceAuthorityCommitInterlock {
    state: std::sync::Arc<RecordingState>,
}

#[cfg(any(test, feature = "test-support"))]
#[derive(Default)]
struct RecordingState {
    plans: std::sync::Mutex<Vec<(Vec<String>, ServiceAuthorityDisposition)>>,
    committed: std::sync::atomic::AtomicUsize,
    rolled_back: std::sync::atomic::AtomicUsize,
    ambiguous: std::sync::atomic::AtomicUsize,
}

#[cfg(any(test, feature = "test-support"))]
impl RecordingServiceAuthorityCommitInterlock {
    pub fn plans(&self) -> Vec<(Vec<String>, ServiceAuthorityDisposition)> {
        self.state.plans.lock().expect("recording interlock").clone()
    }

    pub fn committed(&self) -> usize {
        self.state
            .committed
            .load(std::sync::atomic::Ordering::SeqCst)
    }

    pub fn rolled_back(&self) -> usize {
        self.state
            .rolled_back
            .load(std::sync::atomic::Ordering::SeqCst)
    }

    pub fn ambiguous(&self) -> usize {
        self.state
            .ambiguous
            .load(std::sync::atomic::Ordering::SeqCst)
    }
}

#[cfg(any(test, feature = "test-support"))]
struct RecordingPreparedServiceAuthorityTerminal {
    state: std::sync::Arc<RecordingState>,
}

#[cfg(any(test, feature = "test-support"))]
impl PreparedServiceAuthorityTerminal for RecordingPreparedServiceAuthorityTerminal {
    fn committed(self: Box<Self>) -> SnapbackResult<()> {
        self.state
            .committed
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Ok(())
    }

    fn rolled_back(self: Box<Self>) {
        self.state
            .rolled_back
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    }

    fn mark_ambiguous(&mut self) {
        self.state
            .ambiguous
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    }
}

#[cfg(any(test, feature = "test-support"))]
impl ServiceAuthorityCommitInterlock for RecordingServiceAuthorityCommitInterlock {
    fn prepare_terminal(
        &self,
        token_ids: &[String],
        disposition: ServiceAuthorityDisposition,
    ) -> SnapbackResult<Box<dyn PreparedServiceAuthorityTerminal>> {
        self.state
            .plans
            .lock()
            .expect("recording interlock")
            .push((token_ids.to_vec(), disposition));
        Ok(Box::new(RecordingPreparedServiceAuthorityTerminal {
            state: self.state.clone(),
        }))
    }
}
