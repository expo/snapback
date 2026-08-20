//! Opaque commit carriers for finite service authority.

use crate::auth::service_authority_contract::ServiceAuthorityDisposition;
use crate::diagnostic::{SnapbackError, SnapbackResult};
use std::sync::Arc;

/// Kernel-owned settlement state. Higher crates can receive this value from a
/// kernel factory, but cannot implement or construct an alternative terminal.
pub struct PreparedServiceAuthorityTerminal {
    identity: Arc<()>,
    committed: Option<Box<dyn FnOnce() -> SnapbackResult<()> + Send>>,
    rolled_back: Option<Box<dyn FnOnce() + Send>>,
    ambiguous: Box<dyn FnMut() + Send>,
}

impl PreparedServiceAuthorityTerminal {
    pub(crate) fn committed(mut self) -> SnapbackResult<()> {
        self.rolled_back = None;
        self.committed
            .take()
            .expect("service terminal settles once")()
    }

    pub(crate) fn rolled_back(mut self) {
        self.committed = None;
        if let Some(rolled_back) = self.rolled_back.take() {
            rolled_back();
        }
    }

    pub(crate) fn mark_ambiguous(&mut self) {
        (self.ambiguous)();
    }
}

pub struct ServiceAuthorityTerminalFactory {
    identity: Arc<()>,
}

impl ServiceAuthorityTerminalFactory {
    pub fn prepared(
        &self,
        committed: impl FnOnce() -> SnapbackResult<()> + Send + 'static,
        rolled_back: impl FnOnce() + Send + 'static,
        ambiguous: impl FnMut() + Send + 'static,
    ) -> PreparedServiceAuthorityTerminal {
        PreparedServiceAuthorityTerminal {
            identity: self.identity.clone(),
            committed: Some(Box::new(committed)),
            rolled_back: Some(Box::new(rolled_back)),
            ambiguous: Box::new(ambiguous),
        }
    }
}

type PrepareTerminal = dyn Fn(&[String], ServiceAuthorityDisposition) -> SnapbackResult<PreparedServiceAuthorityTerminal>
    + Send
    + Sync;

/// Database-bound service terminal operation. There is no public capability
/// trait and no public raw installer.
pub struct ServiceAuthorityCommitInterlock {
    identity: Arc<()>,
    prepare: Arc<PrepareTerminal>,
}

impl ServiceAuthorityCommitInterlock {
    pub(crate) fn is_for(&self, identity: &Arc<()>) -> bool {
        Arc::ptr_eq(&self.identity, identity)
    }

    pub(crate) fn prepare_terminal(
        &self,
        token_ids: &[String],
        disposition: ServiceAuthorityDisposition,
    ) -> SnapbackResult<PreparedServiceAuthorityTerminal> {
        let prepared = (self.prepare)(token_ids, disposition)?;
        if !Arc::ptr_eq(&prepared.identity, &self.identity) {
            return Err(SnapbackError::error(
                "SNAPBACK_SERVICE_AUTHORITY_UNAVAILABLE",
                "auth",
                "service terminal belongs to a different database",
            ));
        }
        Ok(prepared)
    }
}

// @ref LLP 0285#51-defect-1--the-publicly-claimable-authority-root — closure
// backed terminal construction is a fact-assertion job, not database identity.
impl crate::storage::KernelCommitAuthority {
    pub(crate) fn service_authority_terminal_factory(&self) -> ServiceAuthorityTerminalFactory {
        ServiceAuthorityTerminalFactory {
            identity: self.identity().clone(),
        }
    }

    pub(crate) fn service_authority_commit_interlock(
        &self,
        prepare: impl Fn(
            &[String],
            ServiceAuthorityDisposition,
        ) -> SnapbackResult<PreparedServiceAuthorityTerminal>
        + Send
        + Sync
        + 'static,
    ) -> ServiceAuthorityCommitInterlock {
        ServiceAuthorityCommitInterlock {
            identity: self.identity().clone(),
            prepare: Arc::new(prepare),
        }
    }
}

/// Kernel-unit-test default that exercises the concrete opaque terminal
/// carrier without requiring a higher auth crate to install its registry.
/// This is crate-private and absent from dependency builds, so it cannot
/// become a production commit-authority fallback.
#[cfg(test)]
pub(crate) fn kernel_test_commit_interlock(identity: &Arc<()>) -> ServiceAuthorityCommitInterlock {
    let factory = ServiceAuthorityTerminalFactory {
        identity: identity.clone(),
    };
    ServiceAuthorityCommitInterlock {
        identity: identity.clone(),
        prepare: Arc::new(move |_, _| Ok(factory.prepared(|| Ok(()), || {}, || {}))),
    }
}

#[cfg(any(test, feature = "test-support"))]
#[derive(Clone, Default)]
pub struct RecordingServiceAuthorityCommitInterlock {
    state: Arc<RecordingState>,
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
        self.state
            .plans
            .lock()
            .expect("recording interlock")
            .clone()
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

    pub(crate) fn bind(
        &self,
        authority: &crate::storage::KernelCommitAuthority,
    ) -> ServiceAuthorityCommitInterlock {
        let state = self.state.clone();
        let factory = authority.service_authority_terminal_factory();
        authority.service_authority_commit_interlock(move |token_ids, disposition| {
            state
                .plans
                .lock()
                .expect("recording interlock")
                .push((token_ids.to_vec(), disposition));
            let committed = state.clone();
            let rolled_back = state.clone();
            let ambiguous = state.clone();
            Ok(factory.prepared(
                move || {
                    committed
                        .committed
                        .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    Ok(())
                },
                move || {
                    rolled_back
                        .rolled_back
                        .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                },
                move || {
                    ambiguous
                        .ambiguous
                        .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                },
            ))
        })
    }
}
