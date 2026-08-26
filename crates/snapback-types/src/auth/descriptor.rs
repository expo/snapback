//! Server-issued authority descriptor for queued mutation consistency.
//!
//! The descriptor is deliberately opaque and is never credential material.
//! Credential resolution has already produced a prepared authority before
//! anything compares a queued request with the current authority; the
//! the engine-bound authority cohort owns trusted derivation, while this leaf
//! keeps wire comparison and pure validation shapes.

use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::manifest::{AUTHORITY_DESCRIPTOR_MAX_SESSION_GENERATION, AuthorityDescriptor};
use sha2::{Digest, Sha256};
use uuid::Uuid;

pub const AUTHORITY_DESCRIPTOR_VERSION: u32 = 1;

/// Derive one opaque, stable descriptor from the durable service-principal
/// axis. The token id is deliberately absent: queued work survives routine
/// scoped-token churn, while rotation, recredentialing, actor replacement,
/// and grant replacement all produce another descriptor.
///
/// The UUIDv7 layout is retained for wire-schema compatibility. Its bits are
/// an opaque SHA-256 digest, not a timestamp-bearing identifier.
pub fn service_authority_instance_id(
    actor_user_id: &str,
    credential_id: &str,
    credential_generation: u64,
    grant_id: &str,
) -> String {
    let mut digest = Sha256::new();
    digest.update(b"snapback.service-authority.v1");
    for value in [actor_user_id, credential_id, grant_id] {
        digest.update((value.len() as u64).to_be_bytes());
        digest.update(value.as_bytes());
    }
    digest.update(credential_generation.to_be_bytes());
    let hash = digest.finalize();
    let mut bytes = [0_u8; 16];
    bytes.copy_from_slice(&hash[..16]);
    // Derived, not minted: the bytes are the digest prefix as-is. The UUID
    // version/variant bits this used to stamp described a shape it no longer
    // produces, so they are gone rather than decorative.
    crate::ids::format_id(crate::ids::Kind::AuthorityInstance, &bytes)
}

/// Validate a descriptor before any settlement lookup or application effect.
/// The prepared authority proves credential validity already, so every error
/// here is the intentionally narrower stale-result class.
///
/// Compared identity is the opaque authority instance only. Generation is an
/// observability fact: a revoked generation cannot reach this point because
/// credential resolution precedes descriptor comparison.
///
/// @ref LLP 0039#replay-parity-and-the-authority-instance-id — absent,
///   unknown-version, malformed, and mismatched descriptors are refused on
///   first delivery as well as duplicate settlement.
pub fn require_current_descriptor(
    supplied: Option<&AuthorityDescriptor>,
    expected: &AuthorityDescriptor,
) -> SnapbackResult<()> {
    let Some(supplied) = supplied else {
        return Err(stale_descriptor("absent"));
    };
    if supplied.descriptor_version != AUTHORITY_DESCRIPTOR_VERSION {
        return Err(stale_descriptor("unsupported_version"));
    }
    if validate_descriptor_values(
        supplied.descriptor_version,
        &supplied.authority_instance_id,
        supplied.session_generation,
    )
    .is_err()
    {
        return Err(stale_descriptor("invalid"));
    }
    if supplied.authority_instance_id != expected.authority_instance_id {
        return Err(stale_descriptor("authority_instance_mismatch"));
    }
    Ok(())
}

pub fn validate_descriptor_values(
    version: u32,
    authority_instance_id: &str,
    session_generation: u64,
) -> SnapbackResult<()> {
    // Both spellings: sessions mint `aut_` ids under LLP 0148, while a
    // mutation queued before it carries a hyphenated UUIDv7. Refusing the
    // older spelling here would strand queued work rather than protect it.
    //
    // @ref LLP 0148#d4-the-prefix-is-never-load-bearing — this is a shape
    // check; the authority comparison below is still exact string equality.
    if version != AUTHORITY_DESCRIPTOR_VERSION
        || !crate::ids::is_minted_identifier(authority_instance_id)
        || session_generation > AUTHORITY_DESCRIPTOR_MAX_SESSION_GENERATION
    {
        return Err(stale_descriptor("invalid"));
    }
    Ok(())
}

pub fn canonical_uuid_v7(value: &str) -> Result<(), ()> {
    let parsed = Uuid::parse_str(value).map_err(|_| ())?;
    if parsed.get_version_num() != 7 || parsed.to_string() != value {
        return Err(());
    }
    Ok(())
}

fn stale_descriptor(reason: &'static str) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_STALE_RESULT",
        "auth",
        "queued mutation belongs to another authority instance; discard it or explicitly re-record it under the current authority",
    )
    .with_details(serde_json::json!({
        "reason": reason,
        "guidance": "discard_or_rerecord",
        "automaticRetry": false,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    const INCARNATION: &str = "018f0d90-7b21-7a22-8c33-445566778899";
    const SESSION_AUTHORITY: &str = "018f0d90-7b24-7a22-8c33-445566778899";

    #[test]
    fn service_descriptor_has_a_cross_language_fixed_vector() {
        assert_eq!(
            service_authority_instance_id(
                "018f0d90-7b01-7a22-8c33-445566778899",
                "018f0d90-7b02-7a22-8c33-445566778899",
                4,
                "018f0d90-7b03-7a22-8c33-445566778899",
            ),
            "aut_2910pt20v2xhyqpg8zdt95pt4f"
        );
    }

    #[test]
    fn absent_unknown_and_mismatched_descriptors_have_exact_stale_reasons() {
        let expected = AuthorityDescriptor {
            descriptor_version: 1,
            authority_instance_id: SESSION_AUTHORITY.to_owned(),
            session_generation: 2,
        };
        for (supplied, reason) in [
            (None, "absent"),
            (
                Some(AuthorityDescriptor {
                    descriptor_version: 2,
                    ..expected.clone()
                }),
                "unsupported_version",
            ),
            (
                Some(AuthorityDescriptor {
                    authority_instance_id: INCARNATION.to_owned(),
                    ..expected.clone()
                }),
                "authority_instance_mismatch",
            ),
        ] {
            let error = require_current_descriptor(supplied.as_ref(), &expected).unwrap_err();
            assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_STALE_RESULT");
            assert_eq!(error.diagnostic.details["reason"], reason);
            assert_eq!(error.diagnostic.details["automaticRetry"], false);
        }
    }

    #[test]
    fn generation_is_not_an_equality_axis_after_credentials_resolve() {
        let expected = AuthorityDescriptor {
            descriptor_version: 1,
            authority_instance_id: SESSION_AUTHORITY.to_owned(),
            session_generation: 9,
        };
        let observed = AuthorityDescriptor {
            session_generation: 1,
            ..expected.clone()
        };
        require_current_descriptor(Some(&observed), &expected).unwrap();
    }
}
