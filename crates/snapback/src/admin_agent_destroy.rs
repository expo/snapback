//! Independent process-bound capability for production integration retirement.

use crate::auth::crypto::{CryptoError, ImpersonationBearer, RandomSource};
use crate::diagnostic::{SnapbackError, SnapbackResult};
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use subtle::ConstantTimeEq as _;
use zeroize::{Zeroize, Zeroizing};

/// Domain-separated, non-browser carrier for the AgentDestroyCapability.
pub const AGENT_DESTROY_CAPABILITY_HEADER: &str = "x-snapback-agent-destroy-capability";
pub const MAX_AGENT_DESTROY_CAPABILITY_FILE_BYTES: usize = 128;

#[derive(Clone)]
pub struct AgentDestroyCapabilityRegistry {
    state: Arc<AgentDestroyCapabilityState>,
}

struct AgentDestroyCapabilityState {
    expected_hash: [u8; 32],
    startup_nonce: String,
}

pub struct AgentDestroyCapabilityOperator {
    bearer: ImpersonationBearer,
}

#[derive(Clone, Copy)]
pub struct VerifiedAgentDestroyCapability {
    _private: (),
}

impl AgentDestroyCapabilityRegistry {
    /// Generate an independent bearer. Reusing the proven `sbic_` encoding is
    /// only a wire-format choice: a separately sampled secret, digest registry,
    /// header, and verifier make the authority domains disjoint.
    ///
    /// @ref LLP 0055#dated-amendment-llp-0204-integration-registrations-and-watch-anchors-2026-08-08 — production operator retirement requires AgentDestroyCapability in addition to AdminWrite.
    pub fn generate(
        startup_nonce: String,
        random: &dyn RandomSource,
    ) -> Result<(Self, AgentDestroyCapabilityOperator), CryptoError> {
        let bearer = ImpersonationBearer::generate(random)?;
        let expected_hash = *bearer.token_hash().as_bytes();
        Ok((
            Self {
                state: Arc::new(AgentDestroyCapabilityState {
                    expected_hash,
                    startup_nonce,
                }),
            },
            AgentDestroyCapabilityOperator { bearer },
        ))
    }

    pub fn startup_nonce(&self) -> &str {
        &self.state.startup_nonce
    }

    pub fn authorize(
        &self,
        presented: Option<&str>,
    ) -> SnapbackResult<VerifiedAgentDestroyCapability> {
        let parsed = presented.and_then(|value| ImpersonationBearer::parse(value).ok());
        let mut candidate_hash = parsed
            .as_ref()
            .map(|bearer| *bearer.token_hash().as_bytes())
            .unwrap_or([0_u8; 32]);
        let matches = bool::from(self.state.expected_hash.ct_eq(&candidate_hash));
        candidate_hash.zeroize();
        if parsed.is_none() || !matches {
            return Err(agent_destroy_capability_required());
        }
        Ok(VerifiedAgentDestroyCapability { _private: () })
    }
}

impl AgentDestroyCapabilityOperator {
    /// Test/embedding seam.
    #[cfg(test)]
    pub(crate) fn expose_secret(&self) -> &str {
        self.bearer.expose_secret()
    }

    pub fn publish_with(
        self,
        ready_file: &Path,
        publish_owner_only_atomic: impl FnOnce(&Path, &[u8]) -> std::io::Result<()>,
    ) -> std::io::Result<PathBuf> {
        let path = agent_destroy_capability_sibling(ready_file)?;
        let payload = Zeroizing::new(self.bearer.expose_secret().as_bytes().to_vec());
        if payload.len() > MAX_AGENT_DESTROY_CAPABILITY_FILE_BYTES {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "agent destroy capability exceeds its sidecar size limit",
            ));
        }
        publish_owner_only_atomic(&path, payload.as_slice())?;
        Ok(path)
    }

    pub fn emit_once_to_terminal(
        self,
        emit: impl FnOnce(&str) -> std::io::Result<()>,
    ) -> std::io::Result<()> {
        emit(self.bearer.expose_secret())
    }
}

pub fn agent_destroy_capability_sibling(ready_file: &Path) -> std::io::Result<PathBuf> {
    let file_name = ready_file.file_name().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "ready-file path must contain a file name",
        )
    })?;
    let mut sibling_name = file_name.to_os_string();
    sibling_name.push(".agent-destroy");
    Ok(ready_file.with_file_name(sibling_name))
}

pub fn parse_agent_destroy_capability_file(
    mut bytes: Zeroizing<Vec<u8>>,
) -> SnapbackResult<ImpersonationBearer> {
    if bytes.is_empty() || bytes.len() > MAX_AGENT_DESTROY_CAPABILITY_FILE_BYTES {
        return Err(agent_destroy_capability_required());
    }
    let value =
        std::str::from_utf8(bytes.as_slice()).map_err(|_| agent_destroy_capability_required())?;
    let parsed = ImpersonationBearer::parse(value).map_err(|_| agent_destroy_capability_required());
    bytes.zeroize();
    parsed
}

impl fmt::Debug for AgentDestroyCapabilityRegistry {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("AgentDestroyCapabilityRegistry")
            .field("startup_nonce", &self.state.startup_nonce)
            .field("capability", &"[REDACTED]")
            .finish()
    }
}

impl fmt::Debug for AgentDestroyCapabilityOperator {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("AgentDestroyCapabilityOperator([REDACTED])")
    }
}

impl fmt::Debug for VerifiedAgentDestroyCapability {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("VerifiedAgentDestroyCapability")
    }
}

impl Drop for AgentDestroyCapabilityState {
    fn drop(&mut self) {
        self.expected_hash.zeroize();
    }
}

pub fn agent_destroy_capability_required() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_AGENT_DESTROY_CAPABILITY_REQUIRED",
        "auth",
        "production integration retirement requires the process-bound AgentDestroyCapability on its non-browser header",
    )
    .with_details(serde_json::json!({
        "header": AGENT_DESTROY_CAPABILITY_HEADER,
        "capabilityFile": "<ready-file>.agent-destroy",
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    struct FixedRandom(u8);

    impl RandomSource for FixedRandom {
        fn fill(&self, destination: &mut [u8]) -> Result<(), CryptoError> {
            destination.fill(self.0);
            Ok(())
        }
    }

    #[test]
    fn separately_generated_capabilities_are_domain_separated() {
        let (destroy, destroy_operator) =
            AgentDestroyCapabilityRegistry::generate("boot-a".to_owned(), &FixedRandom(1)).unwrap();
        let (_, unrelated_operator) =
            AgentDestroyCapabilityRegistry::generate("boot-a".to_owned(), &FixedRandom(2)).unwrap();
        destroy
            .authorize(Some(destroy_operator.expose_secret()))
            .unwrap();
        assert_eq!(
            destroy
                .authorize(Some(unrelated_operator.expose_secret()))
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_AGENT_DESTROY_CAPABILITY_REQUIRED"
        );
    }
}
