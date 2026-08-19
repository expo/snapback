//! Process-bound authority for explicit local impersonation effects.
//!
//! The request side retains only a digest and the process startup nonce. The
//! raw bearer exists in the non-cloneable operator half long enough to publish
//! the owner-only ready-file sibling, then the server drops it. Ordinary admin,
//! console, secret-read, session, and keyring material are never accepted here.
//!
//! @ref LLP 0057#impersonationcapability-carrier — one independent per-boot
//!   `sbic_` gates every impersonation effect and is never a browser credential.
//! @ref LLP 0031#independent-policy-axes — the effect capability composes with,
//!   but cannot replace, the operation's ordinary AdminWrite path credential.
//! @ref LLP 0030#readiness-and-port-discovery — owner-only capability siblings
//!   are mechanically derived from one trusted, startup-bound descriptor.

use crate::auth::crypto::{CryptoError, ImpersonationBearer, RandomSource};
use crate::diagnostic::{SnapbackError, SnapbackResult};
use anyhow::Context as _;
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use subtle::ConstantTimeEq as _;
use zeroize::{Zeroize, Zeroizing};

/// The sole HTTP carrier for the independent impersonation effect axis.
pub const IMPERSONATION_CAPABILITY_HEADER: &str = "x-snapback-impersonation-capability";

/// The sidecar contains one canonical bearer and no framing or metadata.
pub const MAX_IMPERSONATION_CAPABILITY_FILE_BYTES: usize = 128;

/// Cloneable request-side proof registry. It contains no raw bearer and cannot
/// mint or publish one.
#[derive(Clone)]
pub struct ImpersonationCapabilityRegistry {
    state: Arc<ImpersonationRegistryState>,
}

struct ImpersonationRegistryState {
    expected_hash: [u8; 32],
    startup_nonce: String,
}

/// Non-cloneable operator-plane half. It is intentionally neither serializable
/// nor displayable; only the controlled sidecar publisher can expose it.
pub struct ImpersonationOperator {
    bearer: ImpersonationBearer,
}

/// Proof installed by middleware after a successful constant-time comparison.
/// The zero-sized witness cannot be constructed outside this module.
#[derive(Clone, Copy)]
pub struct VerifiedImpersonationCapability {
    _private: (),
}

impl ImpersonationCapabilityRegistry {
    /// Generate the independent 256-bit process bearer through the shared auth
    /// CSPRNG boundary, then retain only its hash on the request side.
    pub fn generate(
        startup_nonce: String,
        random: &dyn RandomSource,
    ) -> Result<(Self, ImpersonationOperator), CryptoError> {
        let bearer = ImpersonationBearer::generate(random)?;
        Ok(Self::from_generated(startup_nonce, bearer))
    }

    /// Split a freshly generated crypto bearer into a digest-only request
    /// registry and a raw operator publication capability.
    pub(crate) fn from_generated(
        startup_nonce: String,
        bearer: ImpersonationBearer,
    ) -> (Self, ImpersonationOperator) {
        let expected_hash = *bearer.token_hash().as_bytes();
        (
            Self {
                state: Arc::new(ImpersonationRegistryState {
                    expected_hash,
                    startup_nonce,
                }),
            },
            ImpersonationOperator { bearer },
        )
    }

    pub fn startup_nonce(&self) -> &str {
        &self.state.startup_nonce
    }

    /// Verify the exact independent header. Missing, malformed, stale-process,
    /// and unrelated credentials intentionally collapse to one 403 diagnostic.
    pub fn authorize(
        &self,
        presented: Option<&str>,
    ) -> SnapbackResult<VerifiedImpersonationCapability> {
        let parsed = presented.and_then(|value| ImpersonationBearer::parse(value).ok());
        let mut candidate_hash = parsed
            .as_ref()
            .map(|bearer| *bearer.token_hash().as_bytes())
            .unwrap_or([0_u8; 32]);
        let matches = bool::from(self.state.expected_hash.ct_eq(&candidate_hash));
        candidate_hash.zeroize();
        if parsed.is_none() || !matches {
            return Err(impersonation_required());
        }
        Ok(VerifiedImpersonationCapability { _private: () })
    }
}

impl fmt::Debug for ImpersonationCapabilityRegistry {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ImpersonationCapabilityRegistry")
            .field("startup_nonce", &self.state.startup_nonce)
            .field("capability", &"[REDACTED]")
            .finish()
    }
}

impl Drop for ImpersonationRegistryState {
    fn drop(&mut self) {
        self.expected_hash.zeroize();
    }
}

impl ImpersonationOperator {
    /// Borrow the raw bearer only while an owner-only publisher writes the
    /// mechanically derived sidecar. The zeroizing buffer prevents the copied
    /// publication bytes from surviving its scope.
    pub fn publish_with(
        self,
        ready_file: &Path,
        publish_owner_only_atomic: impl FnOnce(&Path, &[u8]) -> std::io::Result<()>,
    ) -> std::io::Result<PathBuf> {
        let path = impersonation_capability_sibling(ready_file)?;
        let payload = Zeroizing::new(self.bearer.expose_secret().as_bytes().to_vec());
        if payload.len() > MAX_IMPERSONATION_CAPABILITY_FILE_BYTES {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "impersonation capability exceeds its sidecar size limit",
            ));
        }
        publish_owner_only_atomic(&path, payload.as_slice())?;
        Ok(path)
    }

    /// No-ready-file fallback: lend the bearer once to a trusted controlling-
    /// terminal writer, then consume and zeroize the operator capability.
    pub fn emit_once_to_terminal(
        self,
        emit: impl FnOnce(&str) -> std::io::Result<()>,
    ) -> std::io::Result<()> {
        emit(self.bearer.expose_secret())
    }
}

impl fmt::Debug for ImpersonationOperator {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("ImpersonationOperator([REDACTED])")
    }
}

impl fmt::Debug for VerifiedImpersonationCapability {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("VerifiedImpersonationCapability")
    }
}

/// Derive the only permissible sidecar path. Descriptor consumers must compare
/// an advertised path to this result and never follow an arbitrary path from a
/// network peer.
pub fn impersonation_capability_sibling(ready_file: &Path) -> std::io::Result<PathBuf> {
    let file_name = ready_file.file_name().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "ready-file path must contain a file name",
        )
    })?;
    let mut sibling_name = file_name.to_os_string();
    sibling_name.push(".impersonation");
    Ok(ready_file.with_file_name(sibling_name))
}

/// Accept a descriptor path only when it is the exact mechanical sibling of
/// the already-trusted ready file.
pub fn validate_impersonation_capability_path(
    ready_file: &Path,
    advertised_path: &Path,
) -> std::io::Result<PathBuf> {
    let expected = impersonation_capability_sibling(ready_file)?;
    if advertised_path != expected {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "readiness descriptor names a non-mechanical impersonation capability path",
        ));
    }
    Ok(expected)
}

/// Discover a capability only from the exact trusted ready-file sibling and
/// only after the caller has proved that the descriptor's startup nonce still
/// belongs to the live `/health` responder.
pub fn discover_impersonation_capability(
    ready_file: &Path,
    advertised_path: &Path,
    verify_live_startup_nonce: impl FnOnce() -> anyhow::Result<()>,
) -> anyhow::Result<ImpersonationBearer> {
    let path = validate_impersonation_capability_path(ready_file, advertised_path)?;
    verify_live_startup_nonce()?;
    let bytes =
        crate::secure_file::read_strict_owner_only(&path, MAX_IMPERSONATION_CAPABILITY_FILE_BYTES)
            .with_context(|| {
                format!(
                    "failed to read owner-only impersonation capability {}",
                    path.display()
                )
            })?;
    parse_impersonation_capability_file(Zeroizing::new(bytes)).map_err(anyhow::Error::new)
}

/// Parse exact bounded sidecar bytes after the owner-only file helper has
/// validated the opened inode. No trimming or alternate framing is accepted.
pub fn parse_impersonation_capability_file(
    mut bytes: Zeroizing<Vec<u8>>,
) -> SnapbackResult<ImpersonationBearer> {
    if bytes.is_empty() || bytes.len() > MAX_IMPERSONATION_CAPABILITY_FILE_BYTES {
        return Err(impersonation_file_invalid());
    }
    let value = std::str::from_utf8(bytes.as_slice()).map_err(|_| impersonation_file_invalid())?;
    let parsed = ImpersonationBearer::parse(value).map_err(|_| impersonation_file_invalid());
    bytes.zeroize();
    parsed
}

pub(crate) fn impersonation_required() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_IMPERSONATION_REQUIRED",
        "auth-impersonation",
        "a valid independent impersonation capability is required in x-snapback-impersonation-capability; CLI callers acquire it from the owner-only <ready-file>.impersonation sidecar",
    )
    .with_details(serde_json::json!({
        "header": "x-snapback-impersonation-capability",
        "capabilityFile": "<ready-file>.impersonation",
    }))
}

fn impersonation_file_invalid() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_IMPERSONATION_FILE_INVALID",
        "auth-impersonation",
        "the owner-only <ready-file>.impersonation capability file is invalid; restart the server to mint a fresh process-bound sidecar",
    )
    .with_details(serde_json::json!({
        "header": "x-snapback-impersonation-capability",
        "capabilityFile": "<ready-file>.impersonation",
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::crypto::VerificationCode;
    use std::sync::Mutex;

    struct FixedRandom {
        bytes: Mutex<Vec<u8>>,
    }

    impl FixedRandom {
        fn repeated(byte: u8, count: usize) -> Self {
            Self {
                bytes: Mutex::new(vec![byte; count]),
            }
        }
    }

    impl RandomSource for FixedRandom {
        fn fill(&self, output: &mut [u8]) -> Result<(), CryptoError> {
            let mut bytes = self.bytes.lock().unwrap();
            if bytes.len() < output.len() {
                return Err(CryptoError::RandomUnavailable);
            }
            output.copy_from_slice(&bytes[..output.len()]);
            bytes.drain(..output.len());
            Ok(())
        }
    }

    fn bearer(byte: u8) -> ImpersonationBearer {
        ImpersonationBearer::generate(&FixedRandom::repeated(byte, 64)).unwrap()
    }

    #[test]
    fn registry_retains_only_hash_and_rejects_every_other_credential_class() {
        let live = bearer(7);
        let live_text = live.expose_secret().to_owned();
        let (registry, operator) =
            ImpersonationCapabilityRegistry::from_generated("startup-a".to_owned(), live);
        assert_eq!(registry.startup_nonce(), "startup-a");
        assert!(registry.authorize(Some(&live_text)).is_ok());
        for unrelated in [
            None,
            Some("ordinary-admin-token"),
            Some("console-derived-credential"),
            Some("sbrl_secret-read-lease"),
            Some("sbs_session-bearer"),
            Some("sbrk_secret-read-root"),
            Some("sbic_malformed"),
        ] {
            let error = registry.authorize(unrelated).unwrap_err();
            assert_eq!(
                error.diagnostic.code,
                "SNAPBACK_AUTH_IMPERSONATION_REQUIRED"
            );
            assert_eq!(
                error.diagnostic.details["header"],
                "x-snapback-impersonation-capability"
            );
            assert_eq!(
                error.diagnostic.details["capabilityFile"],
                "<ready-file>.impersonation"
            );
        }
        assert_eq!(format!("{operator:?}"), "ImpersonationOperator([REDACTED])");
        let debug = format!("{registry:?}");
        assert!(!debug.contains(&live_text));
        assert!(debug.contains("[REDACTED]"));
    }

    #[test]
    fn restart_invalidates_the_old_process_bearer() {
        let first = bearer(1);
        let first_text = first.expose_secret().to_owned();
        let (first_registry, _first_operator) =
            ImpersonationCapabilityRegistry::from_generated("startup-a".to_owned(), first);
        let second = bearer(2);
        let second_text = second.expose_secret().to_owned();
        let (second_registry, _second_operator) =
            ImpersonationCapabilityRegistry::from_generated("startup-b".to_owned(), second);
        assert!(first_registry.authorize(Some(&first_text)).is_ok());
        assert!(second_registry.authorize(Some(&second_text)).is_ok());
        assert!(second_registry.authorize(Some(&first_text)).is_err());
    }

    #[test]
    fn sidecar_path_is_mechanical_and_publisher_receives_only_exact_payload() {
        let ready = Path::new("/private/run/snapback-ready.json");
        let live = bearer(9);
        let live_text = live.expose_secret().to_owned();
        let (_registry, operator) =
            ImpersonationCapabilityRegistry::from_generated("startup".to_owned(), live);
        let captured = Arc::new(Mutex::new(None));
        let publisher_capture = captured.clone();
        let path = operator
            .publish_with(ready, move |path, bytes| {
                *publisher_capture.lock().unwrap() = Some((path.to_path_buf(), bytes.to_vec()));
                Ok(())
            })
            .unwrap();
        assert_eq!(
            path,
            PathBuf::from("/private/run/snapback-ready.json.impersonation")
        );
        let (published_path, published_bytes) = captured.lock().unwrap().take().unwrap();
        assert_eq!(published_path, path);
        assert_eq!(published_bytes, live_text.as_bytes());
        assert_eq!(
            validate_impersonation_capability_path(ready, &path).unwrap(),
            path
        );
        assert!(validate_impersonation_capability_path(ready, Path::new("/tmp/attacker")).is_err());
    }

    #[test]
    fn terminal_emission_is_one_shot_by_consuming_the_operator() {
        let live = bearer(10);
        let live_text = live.expose_secret().to_owned();
        let (_registry, operator) =
            ImpersonationCapabilityRegistry::from_generated("startup".to_owned(), live);
        let emissions = Arc::new(Mutex::new(Vec::new()));
        let capture = emissions.clone();
        operator
            .emit_once_to_terminal(move |value| {
                capture.lock().unwrap().push(value.to_owned());
                Ok(())
            })
            .unwrap();
        assert_eq!(emissions.lock().unwrap().as_slice(), &[live_text]);
        // A second call is unrepresentable: `operator` was moved into the first.
    }

    #[test]
    fn exact_sidecar_parse_round_trips_and_rejects_framing_or_oversize() {
        let live = bearer(3);
        let live_text = live.expose_secret().to_owned();
        let parsed =
            parse_impersonation_capability_file(Zeroizing::new(live_text.as_bytes().to_vec()))
                .unwrap();
        assert_eq!(parsed.expose_secret(), live_text);

        let mut newline = live_text.as_bytes().to_vec();
        newline.push(b'\n');
        let invalid = parse_impersonation_capability_file(Zeroizing::new(newline)).unwrap_err();
        assert_eq!(
            invalid.diagnostic.code,
            "SNAPBACK_AUTH_IMPERSONATION_FILE_INVALID"
        );
        let oversized = parse_impersonation_capability_file(Zeroizing::new(vec![
            b'x';
            MAX_IMPERSONATION_CAPABILITY_FILE_BYTES
                + 1
        ]))
        .unwrap_err();
        assert_eq!(
            oversized.diagnostic.code,
            "SNAPBACK_AUTH_IMPERSONATION_FILE_INVALID"
        );
    }

    #[cfg(unix)]
    #[test]
    fn discovery_verifies_live_nonce_before_strict_owner_only_read() {
        use std::sync::atomic::{AtomicBool, Ordering};

        let directory = tempfile::tempdir().unwrap();
        let ready = directory.path().join("ready.json");
        let sidecar = impersonation_capability_sibling(&ready).unwrap();
        let live = bearer(11);
        let live_text = live.expose_secret().to_owned();
        crate::secure_file::write_new_owner_only(&sidecar, live_text.as_bytes()).unwrap();

        let verified = Arc::new(AtomicBool::new(false));
        let verified_for_call = verified.clone();
        let discovered = discover_impersonation_capability(&ready, &sidecar, move || {
            verified_for_call.store(true, Ordering::Release);
            Ok(())
        })
        .unwrap();
        assert!(verified.load(Ordering::Acquire));
        assert_eq!(discovered.expose_secret(), live_text);

        let callback_reached = Arc::new(AtomicBool::new(false));
        let callback_for_call = callback_reached.clone();
        assert!(
            discover_impersonation_capability(
                &ready,
                &directory.path().join("attacker-selected"),
                move || {
                    callback_for_call.store(true, Ordering::Release);
                    Ok(())
                },
            )
            .is_err()
        );
        assert!(!callback_reached.load(Ordering::Acquire));

        std::fs::remove_file(&sidecar).unwrap();
        let error = discover_impersonation_capability(&ready, &sidecar, || {
            anyhow::bail!("startup nonce mismatch")
        })
        .unwrap_err();
        assert!(error.to_string().contains("startup nonce mismatch"));
    }

    #[cfg(unix)]
    #[test]
    fn discovery_refuses_permissive_or_hardlinked_sidecars() {
        use std::os::unix::fs::PermissionsExt as _;

        let directory = tempfile::tempdir().unwrap();
        let ready = directory.path().join("ready.json");
        let sidecar = impersonation_capability_sibling(&ready).unwrap();
        let live = bearer(12);
        crate::secure_file::write_new_owner_only(&sidecar, live.expose_secret().as_bytes())
            .unwrap();
        std::fs::set_permissions(&sidecar, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert!(discover_impersonation_capability(&ready, &sidecar, || Ok(())).is_err());

        std::fs::set_permissions(&sidecar, std::fs::Permissions::from_mode(0o600)).unwrap();
        let alias = directory.path().join("capability-alias");
        std::fs::hard_link(&sidecar, alias).unwrap();
        assert!(discover_impersonation_capability(&ready, &sidecar, || Ok(())).is_err());
    }

    #[test]
    fn bearer_type_is_not_accidentally_interchangeable_with_code_type() {
        let code = VerificationCode::parse("012345").unwrap();
        let (registry, _operator) =
            ImpersonationCapabilityRegistry::from_generated("startup".to_owned(), bearer(4));
        assert!(registry.authorize(Some(code.expose_secret())).is_err());
    }
}
