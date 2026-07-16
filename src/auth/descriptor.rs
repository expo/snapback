//! Server-issued authority descriptor for queued mutation consistency.
//!
//! The descriptor is deliberately opaque and is never credential material.
//! Credential resolution has already produced [`PreparedAuthority`] before
//! this module compares a queued request with the current authority.

use crate::auth::invocation::{PreparedAuthority, ResolvedAppAuthority};
use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::manifest::{AUTHORITY_DESCRIPTOR_MAX_SESSION_GENERATION, AuthorityDescriptor};
use sha2::{Digest, Sha256};
use uuid::Uuid;

pub const AUTHORITY_DESCRIPTOR_VERSION: u32 = 1;

/// Build the one descriptor the server is willing to accept for a prepared
/// invocation. Sessions use the durable per-session opaque id; dev and
/// anonymous authority use the durable authorization-stream incarnation so an
/// ordinary restart does not strand queued work.
///
/// @ref LLP 0039#replay-parity-and-the-authority-instance-id — session ids are
///   stable across refresh; dev authority is keyed to the durable incarnation.
pub fn descriptor_for_authority(
    authority: &PreparedAuthority,
    authorization_stream_incarnation: &str,
) -> SnapbackResult<AuthorityDescriptor> {
    descriptor_for_resolved_authority(authority.resolved(), authorization_stream_incarnation)
}

/// Construct the same descriptor for discovery paths that have already
/// resolved a credential but intentionally do not hold an admission lease
/// (notably the diagnostic handshake while ordinary admission is closed).
pub fn descriptor_for_resolved_authority(
    authority: &ResolvedAppAuthority,
    authorization_stream_incarnation: &str,
) -> SnapbackResult<AuthorityDescriptor> {
    canonical_uuid_v7(authorization_stream_incarnation).map_err(|()| {
        SnapbackError::error(
            "SNAPBACK_AUTH_STREAM_INCARNATION_CORRUPT",
            "auth",
            "authorization-stream incarnation is not a canonical UUIDv7",
        )
    })?;
    let (authority_instance_id, session_generation) = match authority {
        ResolvedAppAuthority::Session {
            authority_instance_id,
            generation,
            ..
        } => (authority_instance_id.clone(), *generation),
        ResolvedAppAuthority::ServicePrincipal {
            actor_user_id,
            credential_id,
            credential_generation,
            grant_id,
            ..
        } => (
            service_authority_instance_id(
                actor_user_id,
                credential_id,
                *credential_generation,
                grant_id,
            ),
            0,
        ),
        ResolvedAppAuthority::Anonymous
        | ResolvedAppAuthority::DevImpersonation { .. }
        | ResolvedAppAuthority::AdminBypass { .. }
        | ResolvedAppAuthority::System => (authorization_stream_incarnation.to_owned(), 0),
    };
    validate_descriptor_values(
        AUTHORITY_DESCRIPTOR_VERSION,
        &authority_instance_id,
        session_generation,
    )?;
    Ok(AuthorityDescriptor {
        descriptor_version: AUTHORITY_DESCRIPTOR_VERSION,
        authority_instance_id,
        session_generation,
    })
}

/// Derive one opaque, stable descriptor from the durable service-principal
/// axis. The token id is deliberately absent: queued work survives routine
/// scoped-token churn, while rotation, recredentialing, actor replacement,
/// and grant replacement all produce another descriptor.
///
/// The UUIDv7 layout is retained for wire-schema compatibility. Its bits are
/// an opaque SHA-256 digest, not a timestamp-bearing identifier.
fn service_authority_instance_id(
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
    bytes[6] = (bytes[6] & 0x0f) | 0x70;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    Uuid::from_bytes(bytes).to_string()
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

fn validate_descriptor_values(
    version: u32,
    authority_instance_id: &str,
    session_generation: u64,
) -> SnapbackResult<()> {
    if version != AUTHORITY_DESCRIPTOR_VERSION
        || canonical_uuid_v7(authority_instance_id).is_err()
        || session_generation > AUTHORITY_DESCRIPTOR_MAX_SESSION_GENERATION
    {
        return Err(stale_descriptor("invalid"));
    }
    Ok(())
}

fn canonical_uuid_v7(value: &str) -> Result<(), ()> {
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
    use crate::admin::ServerProfile;
    use crate::auth::invocation::{InvocationGate, InvocationSource, WireAuthorityFields};
    use crate::manifest::AuthMode;

    const INCARNATION: &str = "018f0d90-7b21-7a22-8c33-445566778899";
    const SESSION_AUTHORITY: &str = "018f0d90-7b24-7a22-8c33-445566778899";

    fn prepared(resolved: ResolvedAppAuthority, mode: AuthMode) -> PreparedAuthority {
        InvocationGate::prepare_authority(
            InvocationSource::HttpMutation,
            mode,
            ServerProfile::Dev,
            1,
            1,
            &WireAuthorityFields::default(),
            resolved,
        )
        .unwrap()
    }

    fn service(token_id: &str, generation: u64, grant_id: &str) -> ResolvedAppAuthority {
        ResolvedAppAuthority::ServicePrincipal {
            actor_user_id: "agent-a".to_owned(),
            credential_id: "credential-a".to_owned(),
            credential_generation: generation,
            grant_id: grant_id.to_owned(),
            token_id: token_id.to_owned(),
            effective_user_id: Some("user-a".to_owned()),
            scopes: Vec::new(),
            token_expires_at_ms: 10_000,
        }
    }

    #[test]
    fn session_descriptor_uses_opaque_session_instance_and_generation() {
        let authority = prepared(
            ResolvedAppAuthority::Session {
                user_id: "018f0d90-7b23-7a22-8c33-445566778899".to_owned(),
                session_id: "018f0d90-7b22-7a22-8c33-445566778899".to_owned(),
                provider: "email-code".to_owned(),
                generation: 7,
                authority_instance_id: SESSION_AUTHORITY.to_owned(),
                session_not_after_ms: 10_000,
                provider_not_after_ms: None,
            },
            AuthMode::Sessions,
        );
        let descriptor = descriptor_for_authority(&authority, INCARNATION).unwrap();
        assert_eq!(descriptor.descriptor_version, 1);
        assert_eq!(descriptor.authority_instance_id, SESSION_AUTHORITY);
        assert_eq!(descriptor.session_generation, 7);
    }

    #[test]
    fn dev_descriptor_is_incarnation_stable_and_closed() {
        let authority = prepared(
            ResolvedAppAuthority::DevImpersonation {
                user_id: "dev-user".to_owned(),
                roles: Vec::new(),
                local_dev_only: true,
            },
            AuthMode::Dev,
        );
        let descriptor = descriptor_for_authority(&authority, INCARNATION).unwrap();
        assert_eq!(descriptor.authority_instance_id, INCARNATION);
        assert_eq!(descriptor.session_generation, 0);
    }

    #[test]
    fn service_descriptor_survives_token_churn_but_not_durable_axis_changes() {
        let first = descriptor_for_resolved_authority(&service("token-a", 3, "grant-a"), INCARNATION)
            .unwrap();
        let replacement_token =
            descriptor_for_resolved_authority(&service("token-b", 3, "grant-a"), INCARNATION)
                .unwrap();
        let rotated =
            descriptor_for_resolved_authority(&service("token-c", 4, "grant-a"), INCARNATION)
                .unwrap();
        let replaced_grant =
            descriptor_for_resolved_authority(&service("token-d", 3, "grant-b"), INCARNATION)
                .unwrap();

        assert_eq!(first, replacement_token);
        assert_ne!(first.authority_instance_id, rotated.authority_instance_id);
        assert_ne!(first.authority_instance_id, replaced_grant.authority_instance_id);
        assert!(canonical_uuid_v7(&first.authority_instance_id).is_ok());
        assert_eq!(first.session_generation, 0);
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
