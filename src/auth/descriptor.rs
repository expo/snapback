//! Server-issued authority descriptor for queued mutation consistency.
//!
//! The descriptor is deliberately opaque and is never credential material.
//! Credential resolution has already produced [`PreparedAuthority`] before
//! this module compares a queued request with the current authority.

use crate::auth::invocation::{PreparedAuthority, ResolvedAppAuthority};
use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::manifest::{AUTHORITY_DESCRIPTOR_MAX_SESSION_GENERATION, AuthorityDescriptor};
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
    canonical_uuid_v7(authorization_stream_incarnation).map_err(|()| {
        SnapbackError::error(
            "SNAPBACK_AUTH_STREAM_INCARNATION_CORRUPT",
            "auth",
            "authorization-stream incarnation is not a canonical UUIDv7",
        )
    })?;
    let (authority_instance_id, session_generation) = match authority.resolved() {
        ResolvedAppAuthority::Session {
            authority_instance_id,
            generation,
            ..
        } => (authority_instance_id.clone(), *generation),
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

    #[test]
    fn session_descriptor_uses_opaque_session_instance_and_generation() {
        let authority = prepared(
            ResolvedAppAuthority::Session {
                user_id: "018f0d90-7b23-7a22-8c33-445566778899".to_owned(),
                session_id: "018f0d90-7b22-7a22-8c33-445566778899".to_owned(),
                provider: "email-code".to_owned(),
                generation: 7,
                authority_instance_id: SESSION_AUTHORITY.to_owned(),
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
