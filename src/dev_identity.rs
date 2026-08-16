//! Per-boot custody for client-asserted developer identity.
//!
//! The request-side registry retains only a digest and startup nonce. The raw
//! bearer exists in a non-cloneable operator half until it is written to the
//! admin-token anchor ladder or disclosed once on the controlling terminal.
//!
//! @ref LLP 0262#d1-the-dev-identity-capability — one `sbdev_` capability is
//!   minted per non-production served boot, advertised by path when file
//!   custodied, rotated on every boot, and removed with that boot.

use crate::auth::crypto::{CryptoError, DevIdentityBearer, RandomSource};
use crate::diagnostic::{SnapbackError, SnapbackResult};
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use subtle::ConstantTimeEq as _;
use zeroize::{Zeroize as _, Zeroizing};

pub const DEV_IDENTITY_CAPABILITY_HEADER: &str = "x-snapback-dev-identity";
pub const MAX_DEV_IDENTITY_CAPABILITY_FILE_BYTES: usize = 128;
pub const DEV_IDENTITY_CONFIG_FORBIDDEN_CODE: &str = "SNAPBACK_DEV_IDENTITY_CONFIG_FORBIDDEN";

#[derive(Clone)]
pub struct DevIdentityCapabilityRegistry {
    state: Arc<DevIdentityRegistryState>,
}

struct DevIdentityRegistryState {
    expected_hash: [u8; 32],
    startup_nonce: String,
    capability_file: Option<PathBuf>,
    unwitnessed_warning_emitted: AtomicBool,
}

pub struct DevIdentityOperator {
    bearer: DevIdentityBearer,
}

/// Identity-guarded custody for a database-anchored capability. Ready-file
/// anchors use `ReadyFileTarget`'s pinned-directory guard instead.
pub struct PublishedDevIdentitySidecar {
    path: PathBuf,
    identity: Option<(u64, u64)>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct VerifiedDevIdentityCapability {
    _private: (),
}

impl DevIdentityCapabilityRegistry {
    pub fn generate(
        startup_nonce: String,
        capability_file: Option<PathBuf>,
        random: &dyn RandomSource,
    ) -> Result<(Self, DevIdentityOperator), CryptoError> {
        let bearer = DevIdentityBearer::generate(random)?;
        Ok(Self::from_generated(startup_nonce, capability_file, bearer))
    }

    pub(crate) fn from_generated(
        startup_nonce: String,
        capability_file: Option<PathBuf>,
        bearer: DevIdentityBearer,
    ) -> (Self, DevIdentityOperator) {
        let expected_hash = *bearer.token_hash().as_bytes();
        (
            Self {
                state: Arc::new(DevIdentityRegistryState {
                    expected_hash,
                    startup_nonce,
                    capability_file,
                    unwitnessed_warning_emitted: AtomicBool::new(false),
                }),
            },
            DevIdentityOperator { bearer },
        )
    }

    pub fn startup_nonce(&self) -> &str {
        &self.state.startup_nonce
    }

    pub fn capability_file(&self) -> Option<&Path> {
        self.state.capability_file.as_deref()
    }

    pub fn authorize(
        &self,
        presented: Option<&str>,
    ) -> SnapbackResult<VerifiedDevIdentityCapability> {
        let parsed = presented.and_then(|value| DevIdentityBearer::parse(value).ok());
        let mut candidate_hash = parsed
            .as_ref()
            .map(|bearer| *bearer.token_hash().as_bytes())
            .unwrap_or([0_u8; 32]);
        let matches = bool::from(self.state.expected_hash.ct_eq(&candidate_hash));
        candidate_hash.zeroize();
        if parsed.is_none() || !matches {
            return Err(dev_identity_refused());
        }
        Ok(VerifiedDevIdentityCapability { _private: () })
    }

    /// Stage 1 compatibility posture: accept an identity-bearing assertion
    /// without the capability, but make the migration debt visible exactly
    /// once for this boot. No asserted identity or bearer material is logged.
    ///
    /// @ref LLP 0262#d5-staged-rollout-sequencing — stage 1 warns once per
    ///   boot for absent capability instead of refusing the request.
    pub fn warn_unwitnessed_assertion_once(&self) -> bool {
        if self
            .state
            .unwitnessed_warning_emitted
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return false;
        }
        match self.capability_file() {
            Some(path) => eprintln!(
                "SNAPBACK_DEV_IDENTITY_CAPABILITY_MISSING: accepted one legacy developer identity assertion without {}; configure the client to read {}",
                DEV_IDENTITY_CAPABILITY_HEADER,
                path.display()
            ),
            None => eprintln!(
                "SNAPBACK_DEV_IDENTITY_CAPABILITY_MISSING: accepted one legacy developer identity assertion without {}; use the capability disclosed once on the operator terminal",
                DEV_IDENTITY_CAPABILITY_HEADER
            ),
        }
        true
    }

    pub fn log_presented_refusal(&self) {
        match self.capability_file() {
            Some(path) => eprintln!(
                "SNAPBACK_DEV_IDENTITY_REFUSED: presented developer identity capability did not verify; read the current capability from {}",
                path.display()
            ),
            None => eprintln!(
                "SNAPBACK_DEV_IDENTITY_REFUSED: presented developer identity capability did not verify; use the current capability disclosed on the operator terminal"
            ),
        }
    }
}

impl fmt::Debug for DevIdentityCapabilityRegistry {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("DevIdentityCapabilityRegistry")
            .field("startup_nonce", &self.state.startup_nonce)
            .field("capability_file", &self.state.capability_file)
            .field("capability", &"[REDACTED]")
            .finish()
    }
}

impl Drop for DevIdentityRegistryState {
    fn drop(&mut self) {
        self.expected_hash.zeroize();
    }
}

impl DevIdentityOperator {
    pub fn publish_with(
        self,
        anchor: &Path,
        publish_owner_only: impl FnOnce(&Path, &[u8]) -> std::io::Result<()>,
    ) -> std::io::Result<PathBuf> {
        let path = dev_identity_capability_sibling(anchor)?;
        let payload = Zeroizing::new(self.bearer.expose_secret().as_bytes().to_vec());
        if payload.len() > MAX_DEV_IDENTITY_CAPABILITY_FILE_BYTES {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "dev identity capability exceeds its sidecar size limit",
            ));
        }
        publish_owner_only(&path, payload.as_slice())?;
        Ok(path)
    }

    pub fn emit_once_to_terminal(
        self,
        emit: impl FnOnce(&str) -> std::io::Result<()>,
    ) -> std::io::Result<()> {
        emit(self.bearer.expose_secret())
    }

    pub fn publish_database_sidecar(
        self,
        database: &Path,
    ) -> std::io::Result<PublishedDevIdentitySidecar> {
        let path = self.publish_with(database, crate::owner_only_file::replace_owner_only)?;
        PublishedDevIdentitySidecar::adopt(path)
    }
}

impl fmt::Debug for DevIdentityOperator {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("DevIdentityOperator([REDACTED])")
    }
}

impl PublishedDevIdentitySidecar {
    fn adopt(path: PathBuf) -> std::io::Result<Self> {
        #[cfg(unix)]
        let identity = {
            use std::os::unix::fs::{MetadataExt as _, PermissionsExt as _};

            let metadata = std::fs::symlink_metadata(&path)?;
            // SAFETY: geteuid has no preconditions and reads process identity.
            let effective_uid = unsafe { libc::geteuid() };
            if !metadata.file_type().is_file()
                || metadata.uid() != effective_uid
                || metadata.permissions().mode() & 0o777 != 0o600
                || metadata.nlink() != 1
            {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    "published dev identity sidecar is not a strict owner-only regular file",
                ));
            }
            Some((metadata.dev(), metadata.ino()))
        };
        #[cfg(not(unix))]
        let identity = None;
        Ok(Self { path, identity })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn remove_if_current(&mut self) -> std::io::Result<()> {
        let Some(expected) = self.identity.take() else {
            return Ok(());
        };
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt as _;

            match std::fs::symlink_metadata(&self.path) {
                Ok(metadata) if (metadata.dev(), metadata.ino()) == expected => {
                    std::fs::remove_file(&self.path)
                }
                Ok(_) => Ok(()),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
                Err(error) => Err(error),
            }
        }
        #[cfg(not(unix))]
        {
            let _ = expected;
            Ok(())
        }
    }
}

impl Drop for PublishedDevIdentitySidecar {
    fn drop(&mut self) {
        let _ = self.remove_if_current();
    }
}

pub fn dev_identity_capability_sibling(anchor: &Path) -> std::io::Result<PathBuf> {
    let mut name = anchor
        .file_name()
        .ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "developer identity anchor must contain a file name",
            )
        })?
        .to_os_string();
    name.push(".dev-identity");
    Ok(anchor.with_file_name(name))
}

pub fn parse_dev_identity_capability_file(
    mut bytes: Zeroizing<Vec<u8>>,
) -> SnapbackResult<DevIdentityBearer> {
    if bytes.is_empty() || bytes.len() > MAX_DEV_IDENTITY_CAPABILITY_FILE_BYTES {
        return Err(dev_identity_file_invalid());
    }
    let value = std::str::from_utf8(bytes.as_slice()).map_err(|_| dev_identity_file_invalid())?;
    let parsed = DevIdentityBearer::parse(value).map_err(|_| dev_identity_file_invalid());
    bytes.zeroize();
    parsed
}

pub fn dev_identity_refused() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_DEV_IDENTITY_REFUSED",
        "auth",
        "developer identity capability refused",
    )
}

fn dev_identity_file_invalid() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_DEV_IDENTITY_FILE_INVALID",
        "auth",
        "the owner-only developer identity capability file is invalid",
    )
}

pub fn production_sidecar_forbidden(path: &Path) -> SnapbackError {
    SnapbackError::error(
        DEV_IDENTITY_CONFIG_FORBIDDEN_CODE,
        "startup",
        format!(
            "production startup refuses the developer identity capability sidecar {}; remove it only after confirming no non-production server owns it",
            path.display()
        ),
    )
    .with_details(serde_json::json!({
        "devIdentityCapabilityFile": path,
    }))
}

pub fn ensure_production_sidecar_absent(path: &Path) -> SnapbackResult<()> {
    match std::fs::symlink_metadata(path) {
        Ok(_) => Err(production_sidecar_forbidden(path)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(SnapbackError::error(
            DEV_IDENTITY_CONFIG_FORBIDDEN_CODE,
            "startup",
            format!(
                "production startup could not inspect developer identity capability sidecar {}: {error}",
                path.display()
            ),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::crypto::OsRandom;

    #[test]
    fn capability_is_startup_bound_redacted_and_constant_time_verified() {
        let sidecar = PathBuf::from("/tmp/app.sqlite3.dev-identity");
        let (registry, operator) = DevIdentityCapabilityRegistry::generate(
            "startup-a".to_owned(),
            Some(sidecar.clone()),
            &OsRandom,
        )
        .unwrap();
        let mut bearer = None;
        operator
            .emit_once_to_terminal(|value| {
                bearer = Some(value.to_owned());
                Ok(())
            })
            .unwrap();
        let bearer = bearer.unwrap();
        assert!(bearer.starts_with("sbdev_"));
        assert!(registry.authorize(Some(&bearer)).is_ok());
        for invalid in [None, Some("sbdev_malformed"), Some("sbic_wrong-class")] {
            assert_eq!(
                registry.authorize(invalid).unwrap_err().diagnostic.code,
                "SNAPBACK_DEV_IDENTITY_REFUSED"
            );
        }
        assert_eq!(registry.startup_nonce(), "startup-a");
        assert_eq!(registry.capability_file(), Some(sidecar.as_path()));
        assert!(!format!("{registry:?}").contains(&bearer));
    }

    #[test]
    fn anchor_ladder_suffix_is_identical_for_database_and_ready_anchors() {
        assert_eq!(
            dev_identity_capability_sibling(Path::new("/data/app.sqlite3")).unwrap(),
            PathBuf::from("/data/app.sqlite3.dev-identity")
        );
        assert_eq!(
            dev_identity_capability_sibling(Path::new("/run/server.ready.json")).unwrap(),
            PathBuf::from("/run/server.ready.json.dev-identity")
        );
    }

    #[cfg(unix)]
    #[test]
    fn database_sidecar_overwrites_each_boot_is_owner_only_and_unlinks_on_drop() {
        use std::os::unix::fs::PermissionsExt as _;

        let dir = tempfile::tempdir().unwrap();
        let database = dir.path().join("app.sqlite3");
        std::fs::write(&database, b"database").unwrap();
        let sidecar = dev_identity_capability_sibling(&database).unwrap();
        crate::owner_only_file::write_new_owner_only(&sidecar, b"stale").unwrap();

        let (registry, operator) = DevIdentityCapabilityRegistry::generate(
            "startup-database".to_owned(),
            Some(sidecar.clone()),
            &OsRandom,
        )
        .unwrap();
        let custody = operator.publish_database_sidecar(&database).unwrap();
        let bytes = Zeroizing::new(std::fs::read(&sidecar).unwrap());
        let bearer = parse_dev_identity_capability_file(bytes).unwrap();
        assert!(registry.authorize(Some(bearer.expose_secret())).is_ok());
        assert_eq!(
            std::fs::metadata(&sidecar).unwrap().permissions().mode() & 0o777,
            0o600
        );
        drop(custody);
        assert!(!sidecar.exists());
    }

    #[test]
    fn production_refuses_any_present_sidecar_and_names_it_locally() {
        let dir = tempfile::tempdir().unwrap();
        let sidecar = dir.path().join("app.sqlite3.dev-identity");
        assert!(ensure_production_sidecar_absent(&sidecar).is_ok());
        std::fs::write(&sidecar, b"stale").unwrap();
        let error = ensure_production_sidecar_absent(&sidecar).unwrap_err();
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_DEV_IDENTITY_CONFIG_FORBIDDEN"
        );
        assert!(error.diagnostic.message.contains(&sidecar.display().to_string()));
    }

    #[test]
    fn unwitnessed_assertion_warning_is_once_per_registry_boot() {
        let (registry, _operator) = DevIdentityCapabilityRegistry::generate(
            "startup-warning".to_owned(),
            Some(PathBuf::from("/tmp/app.sqlite3.dev-identity")),
            &OsRandom,
        )
        .unwrap();
        assert!(registry.warn_unwitnessed_assertion_once());
        assert!(!registry.warn_unwitnessed_assertion_once());
        assert!(!registry.clone().warn_unwitnessed_assertion_once());
    }
}
