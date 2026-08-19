//! Persistent authorization-invalidation protocol core.
//!
//! The live registry is intentionally level-triggered: delivery merely wakes a
//! consumer, while these records remain authoritative until an exact
//! acknowledgement follows the client-side disposition/snapshot commit.
//!
//! @ref LLP 0053#invalidation-is-an-obligation-not-a-message — authenticated
//! scope identity, monotone obligation merge, and exact ACK are the security
//! boundary rather than the lossy realtime outbox.
//! @ref LLP 0053#negative-deltas-are-obligations-positive-deltas-are-best-effort —
//! potentially shrinking auth-scoped results remain pending until resolution.

use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::storage::AuthorizationVersion;
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use hmac::{Hmac, Mac};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, RwLock};

pub use snapback_types::auth::invalidation::*;

pub(crate) fn invalidation_error(code: &'static str, message: impl Into<String>) -> SnapbackError {
    snapback_types::auth::invalidation::invalidation_error(code, message).into()
}

pub(crate) fn corrupt(message: impl Into<String>) -> SnapbackError {
    snapback_types::auth::invalidation::corrupt(message).into()
}

pub(crate) fn validate_counter(value: u64, field: &str, positive: bool) -> SnapbackResult<()> {
    snapback_types::auth::invalidation::validate_counter(value, field, positive).map_err(Into::into)
}

pub(crate) fn validate_uuid_v7(value: &str, field: &str) -> SnapbackResult<()> {
    snapback_types::auth::invalidation::validate_uuid_v7(value, field).map_err(Into::into)
}

pub(crate) fn validate_opaque(value: &str, field: &str) -> SnapbackResult<()> {
    snapback_types::auth::invalidation::validate_opaque(value, field).map_err(Into::into)
}

fn merge_witness(
    current: &CompositeWitness,
    incoming: &CompositeWitness,
) -> SnapbackResult<CompositeWitness> {
    if current.authorization != incoming.authorization {
        return Err(corrupt(
            "one live scope cannot merge obligations from different authorization pairs",
        ));
    }
    let data = merge_data_witness(current.data.as_ref(), incoming.data.as_ref())?;
    Ok(CompositeWitness {
        authorization: incoming.authorization.clone(),
        data,
    })
}

fn merge_data_witness(
    current: Option<&DataWitness>,
    incoming: Option<&DataWitness>,
) -> SnapbackResult<Option<DataWitness>> {
    match (current, incoming) {
        (Some(current), Some(incoming)) => {
            if current.version_stream != incoming.version_stream {
                return Err(corrupt(
                    "one live scope cannot merge obligations from different version streams",
                ));
            }
            Ok(Some(DataWitness {
                version_stream: current.version_stream.clone(),
                min_commit_version: current.min_commit_version.max(incoming.min_commit_version),
            }))
        }
        (Some(current), None) => Ok(Some(current.clone())),
        (None, Some(incoming)) => Ok(Some(incoming.clone())),
        (None, None) => Ok(None),
    }
}

pub const AUTH_INVALIDATION_REFIRE_MAX_MS: u64 = 5_000;

type HmacSha256 = Hmac<Sha256>;

fn put_string(mac: &mut HmacSha256, value: &str) {
    mac.update(&(value.len() as u64).to_be_bytes());
    mac.update(value.as_bytes());
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthenticatedBootIssuer {
    pub issuer_id: IssuerId,
    pub key_id: String,
    pub mac: String,
}

/// The connection-visible negotiated expectation. The authenticated
/// descriptor remains server-held; once startup has verified it, the client
/// receives the exact issuer id over the authenticated connection bootstrap.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorizationInvalidationConnection {
    pub protocol_version: u32,
    pub issuer_id: IssuerId,
    #[schemars(range(min = 1, max = MAX_PROTOCOL_COUNTER))]
    pub connection_generation: u64,
    /// Closed initial client expectation. A clean subscription with no
    /// pending projection must never invent epoch zero.
    pub authorization: AuthorizationVersion,
    pub version_stream: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub issuer_retirement: Option<IssuerRetirement>,
}

/// Server-authenticated proof that one current-issuer namespace has no live or
/// unresolved scope at or below a contiguous scope-sequence prefix. The proof
/// is a cleanup/fencing fact only; accepting it never stands in for a result
/// snapshot, a resolution ACK, or a release proof.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScopeRetirement {
    pub issuer_id: IssuerId,
    pub namespace: QueryNamespace,
    #[schemars(range(min = 1, max = MAX_PROTOCOL_COUNTER))]
    pub retire_through_scope_sequence: u64,
    pub authorization_expectation: AuthorizationVersion,
    pub mac: String,
}

/// Server-authenticated proof that every live scope issued by an older boot in
/// the same authorization incarnation is extinct. It cannot release retained
/// bytes by itself; a current fresh snapshot must still satisfy their witness.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IssuerRetirement {
    pub current_issuer: AuthenticatedBootIssuer,
    #[schemars(range(min = 1, max = MAX_PROTOCOL_COUNTER))]
    pub retire_through_boot_sequence: u64,
    pub authorization_expectation: AuthorizationVersion,
    pub mac: String,
}

/// One process's authenticated live-scope identity and non-wrapping local
/// reservations. The durable boot sequence makes restarting these atomics at
/// one safe; every published full ScopeId still differs across boots.
#[derive(Clone)]
pub struct LiveInvalidationIssuer {
    authenticated: AuthenticatedBootIssuer,
    retirement_signer: Option<Arc<RetirementSigner>>,
    authorization_expectation: Arc<RwLock<Option<AuthorizationVersion>>>,
    version_stream: Arc<RwLock<Option<String>>>,
    next_connection_generation: Arc<AtomicU64>,
    next_scope_sequence: Arc<AtomicU64>,
}

struct RetirementSigner {
    authenticator: IssuerAuthenticator,
    target_profile_id: String,
    app_id: String,
}

impl std::fmt::Debug for LiveInvalidationIssuer {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("LiveInvalidationIssuer")
            .field("issuer_id", &self.authenticated.issuer_id)
            .field("key_id", &"[REDACTED]")
            .finish_non_exhaustive()
    }
}

impl LiveInvalidationIssuer {
    pub fn new(authenticated: AuthenticatedBootIssuer) -> SnapbackResult<Self> {
        authenticated.issuer_id.validate()?;
        validate_opaque(&authenticated.key_id, "authenticatedIssuer.keyId")?;
        let mac = URL_SAFE_NO_PAD
            .decode(&authenticated.mac)
            .map_err(|_| corrupt("authenticated issuer MAC is not canonical base64url"))?;
        if mac.len() != 32 || URL_SAFE_NO_PAD.encode(mac) != authenticated.mac {
            return Err(corrupt(
                "authenticated issuer MAC is not a canonical SHA-256 value",
            ));
        }
        Ok(Self {
            authenticated,
            retirement_signer: None,
            authorization_expectation: Arc::new(RwLock::new(None)),
            version_stream: Arc::new(RwLock::new(None)),
            next_connection_generation: Arc::new(AtomicU64::new(1)),
            next_scope_sequence: Arc::new(AtomicU64::new(1)),
        })
    }

    /// Construct a production issuer that can authenticate retirement
    /// frontiers with the exact key/target/app tuple that authenticated its
    /// boot descriptor. Keeping the signer process-local makes ordinary
    /// request input incapable of manufacturing cleanup authority.
    pub fn with_authenticator(
        authenticated: AuthenticatedBootIssuer,
        authenticator: IssuerAuthenticator,
        target_profile_id: impl Into<String>,
        app_id: impl Into<String>,
    ) -> SnapbackResult<Self> {
        let target_profile_id = target_profile_id.into();
        let app_id = app_id.into();
        authenticator.verify(&authenticated, &target_profile_id, &app_id)?;
        let mut issuer = Self::new(authenticated)?;
        issuer.retirement_signer = Some(Arc::new(RetirementSigner {
            authenticator,
            target_profile_id,
            app_id,
        }));
        Ok(issuer)
    }

    pub fn authenticated(&self) -> &AuthenticatedBootIssuer {
        &self.authenticated
    }

    pub fn install_authorization_expectation(
        &self,
        authorization: AuthorizationVersion,
    ) -> SnapbackResult<()> {
        validate_retirement_authorization(&authorization, &self.authenticated.issuer_id)?;
        let mut current = self
            .authorization_expectation
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if current.as_ref().is_some_and(|current| {
            current.incarnation != authorization.incarnation || current.epoch > authorization.epoch
        }) {
            return Err(invalidation_error(
                "SNAPBACK_AUTH_INVALIDATION_EXPECTATION_STALE",
                "issuer authorization expectation cannot move backward or cross incarnation",
            ));
        }
        *current = Some(authorization);
        Ok(())
    }

    pub fn authorization_expectation(&self) -> SnapbackResult<AuthorizationVersion> {
        self.authorization_expectation
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
            .ok_or_else(|| {
                invalidation_error(
                    "SNAPBACK_AUTH_INVALIDATION_ISSUER_UNAVAILABLE",
                    "invalidation issuer has no installed authorization expectation",
                )
            })
    }

    pub fn install_version_stream(&self, version_stream: impl Into<String>) -> SnapbackResult<()> {
        let version_stream = version_stream.into();
        validate_opaque(&version_stream, "versionStream")?;
        let mut current = self
            .version_stream
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if current
            .as_ref()
            .is_some_and(|current| current != &version_stream)
        {
            return Err(invalidation_error(
                "SNAPBACK_AUTH_INVALIDATION_EXPECTATION_STALE",
                "issuer data version stream cannot change within one boot",
            ));
        }
        *current = Some(version_stream);
        Ok(())
    }

    pub fn version_stream(&self) -> SnapbackResult<String> {
        self.version_stream
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
            .ok_or_else(|| {
                invalidation_error(
                    "SNAPBACK_AUTH_INVALIDATION_ISSUER_UNAVAILABLE",
                    "invalidation issuer has no installed data version stream",
                )
            })
    }

    pub fn reserve_connection_generation(&self) -> SnapbackResult<u64> {
        reserve_atomic_counter(
            &self.next_connection_generation,
            "SNAPBACK_AUTH_INVALIDATION_CONNECTION_GENERATION_EXHAUSTED",
            "authorization invalidation connection generation exhausted",
        )
    }

    pub fn reserve_scope_sequence(&self) -> SnapbackResult<u64> {
        reserve_atomic_counter(
            &self.next_scope_sequence,
            "SNAPBACK_AUTH_INVALIDATION_SCOPE_SEQUENCE_EXHAUSTED",
            "authorization invalidation scope sequence exhausted",
        )
    }

    pub fn authenticate_scope_retirement(
        &self,
        namespace: QueryNamespace,
        retire_through_scope_sequence: u64,
    ) -> SnapbackResult<ScopeRetirement> {
        let authorization_expectation = self.authorization_expectation()?;
        let signer = self.retirement_signer.as_ref().ok_or_else(|| {
            invalidation_error(
                "SNAPBACK_AUTH_INVALIDATION_ISSUER_UNAVAILABLE",
                "invalidation issuer has no retirement signer",
            )
        })?;
        signer.authenticator.authenticate_scope_retirement(
            self.authenticated(),
            namespace,
            retire_through_scope_sequence,
            authorization_expectation,
            &signer.target_profile_id,
            &signer.app_id,
        )
    }

    pub fn authenticate_prior_issuer_retirement(&self) -> SnapbackResult<Option<IssuerRetirement>> {
        let authorization_expectation = self.authorization_expectation()?;
        let Some(retire_through_boot_sequence) =
            self.authenticated.issuer_id.boot_sequence.checked_sub(1)
        else {
            return Ok(None);
        };
        if retire_through_boot_sequence == 0 {
            return Ok(None);
        }
        let signer = self.retirement_signer.as_ref().ok_or_else(|| {
            invalidation_error(
                "SNAPBACK_AUTH_INVALIDATION_ISSUER_UNAVAILABLE",
                "invalidation issuer has no retirement signer",
            )
        })?;
        signer
            .authenticator
            .authenticate_issuer_retirement(
                self.authenticated(),
                retire_through_boot_sequence,
                authorization_expectation,
                &signer.target_profile_id,
                &signer.app_id,
            )
            .map(Some)
    }
}

fn reserve_atomic_counter(
    counter: &AtomicU64,
    code: &'static str,
    message: &'static str,
) -> SnapbackResult<u64> {
    counter
        .fetch_update(Ordering::AcqRel, Ordering::Acquire, |current| {
            (current <= MAX_PROTOCOL_COUNTER).then(|| current.saturating_add(1))
        })
        .map_err(|_| invalidation_error(code, message))
}

/// Stable protocol-key signer for bootstrap issuer expectations.
pub struct IssuerAuthenticator {
    key_id: String,
    key: [u8; 32],
}

impl Drop for IssuerAuthenticator {
    fn drop(&mut self) {
        use zeroize::Zeroize;
        self.key.zeroize();
    }
}

impl IssuerAuthenticator {
    pub fn new(key_id: impl Into<String>, key: [u8; 32]) -> SnapbackResult<Self> {
        let key_id = key_id.into();
        validate_opaque(&key_id, "keyId")?;
        Ok(Self { key_id, key })
    }

    pub fn authenticate(
        &self,
        issuer_id: IssuerId,
        target_profile_id: &str,
        app_id: &str,
    ) -> SnapbackResult<AuthenticatedBootIssuer> {
        issuer_id.validate()?;
        let mac = self.mac(&issuer_id, target_profile_id, app_id)?;
        Ok(AuthenticatedBootIssuer {
            issuer_id,
            key_id: self.key_id.clone(),
            mac,
        })
    }

    pub fn verify(
        &self,
        authenticated: &AuthenticatedBootIssuer,
        target_profile_id: &str,
        app_id: &str,
    ) -> SnapbackResult<()> {
        if authenticated.key_id != self.key_id {
            return Err(invalidation_error(
                "SNAPBACK_AUTH_INVALIDATION_ISSUER_INVALID",
                "invalidation issuer key id does not match the active protocol key",
            ));
        }
        authenticated.issuer_id.validate()?;
        let provided = URL_SAFE_NO_PAD.decode(&authenticated.mac).map_err(|_| {
            invalidation_error(
                "SNAPBACK_AUTH_INVALIDATION_ISSUER_INVALID",
                "invalidation issuer MAC is not canonical base64url",
            )
        })?;
        let mac = self.base_mac(&authenticated.issuer_id, target_profile_id, app_id)?;
        mac.verify_slice(&provided).map_err(|_| {
            invalidation_error(
                "SNAPBACK_AUTH_INVALIDATION_ISSUER_INVALID",
                "invalidation issuer authentication failed",
            )
        })
    }

    pub fn authenticate_scope_retirement(
        &self,
        authenticated: &AuthenticatedBootIssuer,
        namespace: QueryNamespace,
        retire_through_scope_sequence: u64,
        authorization_expectation: AuthorizationVersion,
        target_profile_id: &str,
        app_id: &str,
    ) -> SnapbackResult<ScopeRetirement> {
        self.verify(authenticated, target_profile_id, app_id)?;
        namespace.validate()?;
        validate_counter(
            retire_through_scope_sequence,
            "scopeRetirement.retireThroughScopeSequence",
            true,
        )?;
        validate_retirement_authorization(&authorization_expectation, &authenticated.issuer_id)?;
        let mac = self.scope_retirement_mac(
            authenticated,
            &namespace,
            retire_through_scope_sequence,
            &authorization_expectation,
            target_profile_id,
            app_id,
        )?;
        Ok(ScopeRetirement {
            issuer_id: authenticated.issuer_id.clone(),
            namespace,
            retire_through_scope_sequence,
            authorization_expectation,
            mac,
        })
    }

    pub fn verify_scope_retirement(
        &self,
        retirement: &ScopeRetirement,
        authenticated: &AuthenticatedBootIssuer,
        target_profile_id: &str,
        app_id: &str,
    ) -> SnapbackResult<()> {
        self.verify(authenticated, target_profile_id, app_id)?;
        retirement.namespace.validate()?;
        validate_counter(
            retirement.retire_through_scope_sequence,
            "scopeRetirement.retireThroughScopeSequence",
            true,
        )?;
        validate_retirement_authorization(
            &retirement.authorization_expectation,
            &retirement.issuer_id,
        )?;
        if retirement.issuer_id != authenticated.issuer_id {
            return Err(retirement_invalid(
                "scope retirement was not issued by the authenticated current issuer",
            ));
        }
        let expected = self.scope_retirement_base_mac(
            authenticated,
            &retirement.namespace,
            retirement.retire_through_scope_sequence,
            &retirement.authorization_expectation,
            target_profile_id,
            app_id,
        )?;
        verify_retirement_mac(expected, &retirement.mac)
    }

    pub fn authenticate_issuer_retirement(
        &self,
        current_issuer: &AuthenticatedBootIssuer,
        retire_through_boot_sequence: u64,
        authorization_expectation: AuthorizationVersion,
        target_profile_id: &str,
        app_id: &str,
    ) -> SnapbackResult<IssuerRetirement> {
        self.verify(current_issuer, target_profile_id, app_id)?;
        validate_counter(
            retire_through_boot_sequence,
            "issuerRetirement.retireThroughBootSequence",
            true,
        )?;
        if retire_through_boot_sequence >= current_issuer.issuer_id.boot_sequence {
            return Err(retirement_invalid(
                "issuer retirement must end strictly before the authenticated current boot",
            ));
        }
        validate_retirement_authorization(&authorization_expectation, &current_issuer.issuer_id)?;
        let mac = self.issuer_retirement_mac(
            current_issuer,
            retire_through_boot_sequence,
            &authorization_expectation,
            target_profile_id,
            app_id,
        )?;
        Ok(IssuerRetirement {
            current_issuer: current_issuer.clone(),
            retire_through_boot_sequence,
            authorization_expectation,
            mac,
        })
    }

    pub fn verify_issuer_retirement(
        &self,
        retirement: &IssuerRetirement,
        target_profile_id: &str,
        app_id: &str,
    ) -> SnapbackResult<()> {
        self.verify(&retirement.current_issuer, target_profile_id, app_id)?;
        validate_counter(
            retirement.retire_through_boot_sequence,
            "issuerRetirement.retireThroughBootSequence",
            true,
        )?;
        if retirement.retire_through_boot_sequence
            >= retirement.current_issuer.issuer_id.boot_sequence
        {
            return Err(retirement_invalid(
                "issuer retirement must end strictly before the authenticated current boot",
            ));
        }
        validate_retirement_authorization(
            &retirement.authorization_expectation,
            &retirement.current_issuer.issuer_id,
        )?;
        let expected = self.issuer_retirement_base_mac(
            &retirement.current_issuer,
            retirement.retire_through_boot_sequence,
            &retirement.authorization_expectation,
            target_profile_id,
            app_id,
        )?;
        verify_retirement_mac(expected, &retirement.mac)
    }

    fn mac(
        &self,
        issuer_id: &IssuerId,
        target_profile_id: &str,
        app_id: &str,
    ) -> SnapbackResult<String> {
        let mac = self.base_mac(issuer_id, target_profile_id, app_id)?;
        Ok(URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes()))
    }

    fn base_mac(
        &self,
        issuer_id: &IssuerId,
        target_profile_id: &str,
        app_id: &str,
    ) -> SnapbackResult<HmacSha256> {
        let mut mac = HmacSha256::new_from_slice(&self.key)
            .map_err(|_| corrupt("protocol key has an invalid HMAC length"))?;
        put_string(&mut mac, "snapback.auth-invalidation.issuer.v1");
        put_string(&mut mac, target_profile_id);
        put_string(&mut mac, app_id);
        put_string(&mut mac, &issuer_id.authorization_incarnation);
        mac.update(&issuer_id.boot_sequence.to_be_bytes());
        put_string(&mut mac, &issuer_id.boot_nonce);
        Ok(mac)
    }

    fn scope_retirement_mac(
        &self,
        authenticated: &AuthenticatedBootIssuer,
        namespace: &QueryNamespace,
        retire_through_scope_sequence: u64,
        authorization_expectation: &AuthorizationVersion,
        target_profile_id: &str,
        app_id: &str,
    ) -> SnapbackResult<String> {
        let mac = self.scope_retirement_base_mac(
            authenticated,
            namespace,
            retire_through_scope_sequence,
            authorization_expectation,
            target_profile_id,
            app_id,
        )?;
        Ok(URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes()))
    }

    fn scope_retirement_base_mac(
        &self,
        authenticated: &AuthenticatedBootIssuer,
        namespace: &QueryNamespace,
        retire_through_scope_sequence: u64,
        authorization_expectation: &AuthorizationVersion,
        target_profile_id: &str,
        app_id: &str,
    ) -> SnapbackResult<HmacSha256> {
        let mut mac = HmacSha256::new_from_slice(&self.key)
            .map_err(|_| corrupt("protocol key has an invalid HMAC length"))?;
        put_string(&mut mac, "snapback.auth-invalidation.scope-retirement.v1");
        put_string(&mut mac, target_profile_id);
        put_string(&mut mac, app_id);
        put_authenticated_issuer(&mut mac, authenticated);
        put_namespace(&mut mac, namespace);
        mac.update(&retire_through_scope_sequence.to_be_bytes());
        put_authorization(&mut mac, authorization_expectation);
        Ok(mac)
    }

    fn issuer_retirement_mac(
        &self,
        current_issuer: &AuthenticatedBootIssuer,
        retire_through_boot_sequence: u64,
        authorization_expectation: &AuthorizationVersion,
        target_profile_id: &str,
        app_id: &str,
    ) -> SnapbackResult<String> {
        let mac = self.issuer_retirement_base_mac(
            current_issuer,
            retire_through_boot_sequence,
            authorization_expectation,
            target_profile_id,
            app_id,
        )?;
        Ok(URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes()))
    }

    fn issuer_retirement_base_mac(
        &self,
        current_issuer: &AuthenticatedBootIssuer,
        retire_through_boot_sequence: u64,
        authorization_expectation: &AuthorizationVersion,
        target_profile_id: &str,
        app_id: &str,
    ) -> SnapbackResult<HmacSha256> {
        let mut mac = HmacSha256::new_from_slice(&self.key)
            .map_err(|_| corrupt("protocol key has an invalid HMAC length"))?;
        put_string(&mut mac, "snapback.auth-invalidation.issuer-retirement.v1");
        put_string(&mut mac, target_profile_id);
        put_string(&mut mac, app_id);
        put_authenticated_issuer(&mut mac, current_issuer);
        mac.update(&retire_through_boot_sequence.to_be_bytes());
        put_authorization(&mut mac, authorization_expectation);
        Ok(mac)
    }
}

fn retirement_invalid(message: impl Into<String>) -> SnapbackError {
    invalidation_error("SNAPBACK_AUTH_INVALIDATION_RETIREMENT_INVALID", message)
}

fn validate_retirement_authorization(
    authorization: &AuthorizationVersion,
    issuer: &IssuerId,
) -> SnapbackResult<()> {
    validate_uuid_v7(
        &authorization.incarnation,
        "retirement.authorizationExpectation.incarnation",
    )?;
    validate_counter(
        authorization.epoch,
        "retirement.authorizationExpectation.epoch",
        false,
    )?;
    if authorization.incarnation != issuer.authorization_incarnation {
        return Err(retirement_invalid(
            "retirement authorization expectation crosses issuer incarnation",
        ));
    }
    Ok(())
}

fn verify_retirement_mac(mac: HmacSha256, encoded: &str) -> SnapbackResult<()> {
    let provided = URL_SAFE_NO_PAD.decode(encoded).map_err(|_| {
        retirement_invalid("authorization retirement MAC is not canonical base64url")
    })?;
    if provided.len() != 32 || URL_SAFE_NO_PAD.encode(&provided) != encoded {
        return Err(retirement_invalid(
            "authorization retirement MAC is not a canonical SHA-256 value",
        ));
    }
    mac.verify_slice(&provided)
        .map_err(|_| retirement_invalid("authorization retirement authentication failed"))
}

fn put_authenticated_issuer(mac: &mut HmacSha256, authenticated: &AuthenticatedBootIssuer) {
    put_string(mac, &authenticated.issuer_id.authorization_incarnation);
    mac.update(&authenticated.issuer_id.boot_sequence.to_be_bytes());
    put_string(mac, &authenticated.issuer_id.boot_nonce);
    put_string(mac, &authenticated.key_id);
    put_string(mac, &authenticated.mac);
}

fn put_namespace(mac: &mut HmacSha256, namespace: &QueryNamespace) {
    put_string(mac, &namespace.client_store_id);
    put_string(mac, &namespace.query_key);
    mac.update(&namespace.query_instance_id.to_be_bytes());
}

fn put_authorization(mac: &mut HmacSha256, authorization: &AuthorizationVersion) {
    put_string(mac, &authorization.incarnation);
    mac.update(&authorization.epoch.to_be_bytes());
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ObligationExpectation {
    pub authorization: AuthorizationVersion,
    pub version_stream: Option<String>,
    pub issuer_id: Option<IssuerId>,
}

impl ObligationExpectation {
    fn validate(&self) -> SnapbackResult<()> {
        CompositeWitness {
            authorization: self.authorization.clone(),
            data: self
                .version_stream
                .as_ref()
                .map(|version_stream| DataWitness {
                    version_stream: version_stream.clone(),
                    min_commit_version: 0,
                }),
        }
        .validate()?;
        if let Some(issuer) = &self.issuer_id {
            issuer.validate()?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug)]
struct ObligationEntry {
    obligation: ResyncObligation,
    cause_sequence: u64,
    cause_id: String,
}
#[derive(Clone, Debug)]
struct IssuedResolution {
    ticket: ResolutionTicket,
    /// Digest of the exact serialized value passed to the client's
    /// resolution-frame identity as `snapshot`. This is server-held only: it
    /// prevents a fresh snapshot from reusing the prior scope revision merely
    /// because both snapshots satisfy the same obligation witness, without
    /// retaining another copy of a potentially large result window.
    snapshot_identity_sha256: [u8; 32],
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AcknowledgeOutcome {
    Discharged,
    Duplicate,
    Stale,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ScopeRetirementCandidate {
    pub namespace: QueryNamespace,
    pub retire_through_scope_sequence: u64,
}

/// Process-local persistent-until-discharge obligations. Process death ends
/// every live scope; reconnect must allocate a new issuer and fresh snapshot.
pub struct ObligationRegistry {
    expectation: ObligationExpectation,
    obligations: BTreeMap<ScopeId, ObligationEntry>,
    revision_high_water: BTreeMap<ScopeId, u64>,
    resolution_by_scope: BTreeMap<ScopeId, IssuedResolution>,
    last_discharged: BTreeMap<ScopeId, (u64, String)>,
    connection_children: BTreeMap<ScopeId, BTreeSet<ScopeId>>,
    active_subscription_scopes: BTreeSet<ScopeId>,
    issued_scope_high_water: BTreeMap<(IssuerId, QueryNamespace), u64>,
    scope_retirement_frontier: BTreeMap<(IssuerId, QueryNamespace), u64>,
    owner_continuity_by_scope: BTreeMap<ScopeId, String>,
}

impl ObligationRegistry {
    pub fn new(expectation: ObligationExpectation) -> SnapbackResult<Self> {
        expectation.validate()?;
        Ok(Self {
            expectation,
            obligations: BTreeMap::new(),
            revision_high_water: BTreeMap::new(),
            resolution_by_scope: BTreeMap::new(),
            last_discharged: BTreeMap::new(),
            connection_children: BTreeMap::new(),
            active_subscription_scopes: BTreeSet::new(),
            issued_scope_high_water: BTreeMap::new(),
            scope_retirement_frontier: BTreeMap::new(),
            owner_continuity_by_scope: BTreeMap::new(),
        })
    }

    pub fn expectation(&self) -> &ObligationExpectation {
        &self.expectation
    }

    /// Move the trusted expectation forward within the current durable
    /// incarnation. Existing live scopes are retained; their next cause must
    /// replace old-pair proof with this newly authenticated pair.
    pub fn advance_authenticated_authorization(
        &mut self,
        authorization: AuthorizationVersion,
    ) -> SnapbackResult<()> {
        validate_uuid_v7(
            &authorization.incarnation,
            "expectation.authorization.incarnation",
        )?;
        validate_counter(
            authorization.epoch,
            "expectation.authorization.epoch",
            false,
        )?;
        if authorization.incarnation != self.expectation.authorization.incarnation
            || authorization.epoch < self.expectation.authorization.epoch
        {
            return Err(invalidation_error(
                "SNAPBACK_AUTH_INVALIDATION_EXPECTATION_STALE",
                "authorization expectation must advance monotonically within one incarnation",
            ));
        }
        self.expectation.authorization = authorization;
        Ok(())
    }

    /// Moving to a new authenticated expectation terminates old live scopes;
    /// no arrival-ordered frame can perform this operation.
    pub fn replace_authenticated_expectation(
        &mut self,
        expectation: ObligationExpectation,
    ) -> SnapbackResult<Vec<ResyncObligation>> {
        expectation.validate()?;
        let prior = self
            .obligations
            .values()
            .map(|entry| entry.obligation.clone())
            .collect();
        self.expectation = expectation;
        self.obligations.clear();
        self.resolution_by_scope.clear();
        self.connection_children.clear();
        self.active_subscription_scopes.clear();
        self.issued_scope_high_water.clear();
        self.scope_retirement_frontier.clear();
        self.owner_continuity_by_scope.clear();
        Ok(prior)
    }

    /// Register a published subscription scope before it can enter retained
    /// live state. The per-namespace scalar is kept only while that namespace
    /// has live scopes, so churn is bounded by current live state rather than
    /// process lifetime.
    pub fn register_live_scope(
        &mut self,
        scope_id: ScopeId,
        owner_continuity_id: impl Into<String>,
    ) -> SnapbackResult<()> {
        scope_id.validate()?;
        let owner_continuity_id = owner_continuity_id.into();
        validate_opaque(&owner_continuity_id, "ownerContinuityId")?;
        let ScopeId::Subscription {
            issuer_id,
            namespace,
            scope_sequence,
            ..
        } = &scope_id
        else {
            return Err(corrupt(
                "only subscription scopes can enter the live scope registry",
            ));
        };
        if Some(issuer_id) != self.expectation.issuer_id.as_ref() {
            return Err(invalidation_error(
                "SNAPBACK_AUTH_INVALIDATION_ISSUER_INVALID",
                "live scope issuer is not the authenticated current boot issuer",
            ));
        }
        let high_water = self
            .issued_scope_high_water
            .entry((issuer_id.clone(), namespace.clone()))
            .or_default();
        if *scope_sequence <= *high_water && !self.active_subscription_scopes.contains(&scope_id) {
            return Err(corrupt(
                "live scope sequence was published out of order or reused within its namespace",
            ));
        }
        *high_water = (*high_water).max(*scope_sequence);
        if let Some(existing) = self.owner_continuity_by_scope.get(&scope_id)
            && existing != &owner_continuity_id
        {
            return Err(corrupt(
                "one live scope was rebound to a different owner continuity",
            ));
        }
        self.owner_continuity_by_scope
            .insert(scope_id.clone(), owner_continuity_id);
        self.active_subscription_scopes.insert(scope_id);
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn raise(
        &mut self,
        scope_id: ScopeId,
        cause_sequence: u64,
        cause_id: impl Into<String>,
        max_disposition: InvalidationDisposition,
        witness: CompositeWitness,
        retry_episode_id: Option<String>,
    ) -> SnapbackResult<ResyncObligation> {
        scope_id.validate()?;
        validate_counter(cause_sequence, "causeSequence", true)?;
        let cause_id = cause_id.into();
        validate_opaque(&cause_id, "causeId")?;
        witness.validate()?;
        if let Some(id) = &retry_episode_id {
            validate_opaque(id, "retryEpisodeId")?;
        }
        self.require_expected(&scope_id, &witness)?;
        if matches!(scope_id, ScopeId::Subscription { .. })
            && !self.owner_continuity_by_scope.contains_key(&scope_id)
        {
            return Err(corrupt(
                "subscription obligation has no recorded owner continuity",
            ));
        }

        if let Some(current) = self.obligations.get(&scope_id) {
            if cause_sequence < current.cause_sequence {
                return Ok(current.obligation.clone());
            }
            if cause_sequence == current.cause_sequence {
                if cause_id != current.cause_id
                    || max_disposition != current.obligation.max_disposition
                    || witness != current.obligation.witness
                    || retry_episode_id != current.obligation.retry_episode_id
                {
                    return Err(corrupt(
                        "one semantic cause sequence was reused for different obligation bytes",
                    ));
                }
                return Ok(current.obligation.clone());
            }
        }

        let revision = self
            .revision_high_water
            .get(&scope_id)
            .copied()
            .unwrap_or(0)
            .checked_add(1)
            .filter(|value| *value <= MAX_PROTOCOL_COUNTER)
            .ok_or_else(|| {
                invalidation_error(
                    "SNAPBACK_AUTH_INVALIDATION_REVISION_EXHAUSTED",
                    "obligation revision exhausted the JavaScript-safe range",
                )
            })?;
        let (max_disposition, witness) = self
            .obligations
            .get(&scope_id)
            .map(|entry| {
                Ok::<_, SnapbackError>((
                    entry.obligation.max_disposition.max(max_disposition),
                    if entry.obligation.witness.authorization == witness.authorization {
                        merge_witness(&entry.obligation.witness, &witness)?
                    } else {
                        CompositeWitness {
                            authorization: witness.authorization.clone(),
                            data: merge_data_witness(
                                entry.obligation.witness.data.as_ref(),
                                witness.data.as_ref(),
                            )?,
                        }
                    },
                ))
            })
            .transpose()?
            .unwrap_or((max_disposition, witness));
        let obligation = ResyncObligation {
            protocol_version: AUTH_INVALIDATION_PROTOCOL_VERSION,
            scope_id: scope_id.clone(),
            revision,
            max_disposition,
            witness,
            retry_episode_id,
            owner_continuity_id: self.owner_continuity_by_scope.get(&scope_id).cloned(),
        };
        self.revision_high_water.insert(scope_id.clone(), revision);
        self.obligations.insert(
            scope_id.clone(),
            ObligationEntry {
                obligation: obligation.clone(),
                cause_sequence,
                cause_id,
            },
        );
        self.resolution_by_scope.remove(&scope_id);
        Ok(obligation)
    }

    /// Raise an obligation and report whether this call moved one retained
    /// subscription scope from no quarantine-or-worse obligation to an active
    /// one. Revisions that merge into an already-quarantined scope are not a
    /// second entry; delivery/re-fire remains level-triggered independently.
    #[allow(clippy::too_many_arguments)]
    pub fn raise_with_quarantine_lifecycle(
        &mut self,
        scope_id: ScopeId,
        cause_sequence: u64,
        cause_id: impl Into<String>,
        max_disposition: InvalidationDisposition,
        witness: CompositeWitness,
        retry_episode_id: Option<String>,
    ) -> SnapbackResult<(ResyncObligation, bool)> {
        let was_quarantined = matches!(&scope_id, ScopeId::Subscription { .. })
            && self.obligations.get(&scope_id).is_some_and(|entry| {
                entry.obligation.max_disposition >= InvalidationDisposition::Quarantine
            });
        let obligation = self.raise(
            scope_id,
            cause_sequence,
            cause_id,
            max_disposition,
            witness,
            retry_episode_id,
        )?;
        let entered = matches!(&obligation.scope_id, ScopeId::Subscription { .. })
            && !was_quarantined
            && obligation.max_disposition >= InvalidationDisposition::Quarantine;
        Ok((obligation, entered))
    }

    pub fn pending(&self, scope_id: &ScopeId) -> Option<&ResyncObligation> {
        self.obligations
            .get(scope_id)
            .map(|entry| &entry.obligation)
    }

    pub fn pending_all(&self) -> Vec<ResyncObligation> {
        self.obligations
            .values()
            .map(|entry| entry.obligation.clone())
            .collect()
    }

    /// True when some pending obligation is capable of quarantining or
    /// deleting the exact lease-target query instance. Query-scoped
    /// obligations (`Subscription`/`ClientQuery`) match on the complete
    /// namespace; a `Connection` root reaches a query only through its
    /// registered query-sized children, which are checked directly so a
    /// root cannot be bypassed even if a child entry were discharged out of
    /// band. Obligations for an unrelated user, client store, query key, or
    /// query instance never fence this target.
    ///
    /// @ref LLP 0053#the-lease-the-only-mechanism-for-the-unreachable-client —
    /// issuance proof item 4 blocks only obligations capable of
    /// quarantining/deleting this query, not the global pending set
    /// (ENG-24989).
    pub fn blocks_lease_target(&self, target: &QueryNamespace) -> bool {
        self.obligations.keys().any(|scope| match scope {
            ScopeId::Subscription { namespace, .. } | ScopeId::ClientQuery { namespace } => {
                namespace == target
            }
            ScopeId::Connection { .. } => {
                self.connection_children.get(scope).is_some_and(|children| {
                    children.iter().any(|child| {
                        matches!(
                            child,
                            ScopeId::Subscription { namespace, .. } if namespace == target
                        )
                    })
                })
            }
        })
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn active_subscription_scopes_for_test(&self) -> Vec<ScopeId> {
        self.active_subscription_scopes.iter().cloned().collect()
    }

    pub fn projection(&self, scope_id: &ScopeId) -> Option<AuthorizationInvalidationProjection> {
        Some(AuthorizationInvalidationProjection {
            obligation: self.pending(scope_id)?.clone(),
            resolution: self
                .resolution_by_scope
                .get(scope_id)
                .map(|issued| issued.ticket.clone()),
        })
    }

    pub fn register_connection_child(
        &mut self,
        connection_scope: &ScopeId,
        subscription_scope: ScopeId,
    ) -> SnapbackResult<Option<ResyncObligation>> {
        let Some(root) = self.obligations.get(connection_scope).cloned() else {
            return Ok(None);
        };
        if !matches!(connection_scope, ScopeId::Connection { .. })
            || !matches!(subscription_scope, ScopeId::Subscription { .. })
        {
            return Err(corrupt(
                "connection obligation children require connection and subscription scopes",
            ));
        }
        self.connection_children
            .entry(connection_scope.clone())
            .or_default()
            .insert(subscription_scope.clone());
        let child = self.raise(
            subscription_scope,
            root.cause_sequence,
            format!("root:{}.{}", root.cause_id, root.obligation.revision),
            root.obligation.max_disposition,
            root.obligation.witness,
            root.obligation.retry_episode_id,
        )?;
        Ok(Some(child))
    }

    pub fn register_connection_child_with_quarantine_lifecycle(
        &mut self,
        connection_scope: &ScopeId,
        subscription_scope: ScopeId,
    ) -> SnapbackResult<(Option<ResyncObligation>, bool)> {
        let was_quarantined = self.pending(&subscription_scope).is_some_and(|obligation| {
            obligation.max_disposition >= InvalidationDisposition::Quarantine
        });
        let child = self.register_connection_child(connection_scope, subscription_scope)?;
        let entered = !was_quarantined
            && child.as_ref().is_some_and(|obligation| {
                obligation.max_disposition >= InvalidationDisposition::Quarantine
            });
        Ok((child, entered))
    }

    pub fn issue_resolution(
        &mut self,
        scope_id: &ScopeId,
        kind: ResolutionKind,
        witness: CompositeWitness,
        snapshot_identity: &[u8],
    ) -> SnapbackResult<ResolutionTicket> {
        witness.validate()?;
        if snapshot_identity.is_empty() {
            return Err(corrupt(
                "resolution snapshot identity must contain the exact serialized client value",
            ));
        }
        let snapshot_identity_sha256: [u8; 32] = {
            use sha2::Digest as _;
            Sha256::digest(snapshot_identity).into()
        };
        let current = self.obligations.get(scope_id).ok_or_else(|| {
            invalidation_error(
                "SNAPBACK_AUTH_INVALIDATION_RESOLUTION_STALE",
                "no current obligation exists for the proposed resolution",
            )
        })?;
        if !witness.covers(&current.obligation.witness) {
            return Err(invalidation_error(
                "SNAPBACK_AUTH_INVALIDATION_RESOLUTION_STALE",
                "resolution witness does not cover the current obligation",
            ));
        }
        if let Some(existing) = self.resolution_by_scope.get(scope_id)
            && existing.ticket.revision == current.obligation.revision
            && existing.ticket.kind == kind
            && existing.ticket.witness == witness
            && existing.snapshot_identity_sha256 == snapshot_identity_sha256
        {
            return Ok(existing.ticket.clone());
        }

        // A resolution may be re-evaluated while its predecessor is already
        // queued or applied but not yet ACKed. A different witness or exact
        // snapshot value is a different client-visible frame, so it must not
        // reuse that predecessor's per-scope revision. Advancing here makes
        // the old ACK stale and preserves byte-identical retransmission for an
        // exact retry of the current resolution.
        //
        // @ref LLP 0053#invalidation-is-an-obligation-not-a-message — scope
        // revisions are monotone and never reused; an exact ACK discharges
        // only the resolution frame it names.
        if self.resolution_by_scope.contains_key(scope_id) {
            let revision = self
                .revision_high_water
                .get(scope_id)
                .copied()
                .unwrap_or(current.obligation.revision)
                .checked_add(1)
                .filter(|value| *value <= MAX_PROTOCOL_COUNTER)
                .ok_or_else(|| {
                    invalidation_error(
                        "SNAPBACK_AUTH_INVALIDATION_REVISION_EXHAUSTED",
                        "obligation revision exhausted the JavaScript-safe range",
                    )
                })?;
            self.revision_high_water.insert(scope_id.clone(), revision);
            self.obligations
                .get_mut(scope_id)
                .expect("resolution scope remained pending")
                .obligation
                .revision = revision;
        }
        let current = self
            .obligations
            .get(scope_id)
            .expect("resolution scope remained pending");
        let ticket = ResolutionTicket {
            protocol_version: AUTH_INVALIDATION_PROTOCOL_VERSION,
            kind,
            scope_id: scope_id.clone(),
            revision: current.obligation.revision,
            witness,
            max_disposition: current.obligation.max_disposition,
            ack_token: crate::ids::mint_time_ordered(crate::ids::Kind::AckToken),
            owner_continuity_id: current.obligation.owner_continuity_id.clone(),
        };
        self.resolution_by_scope.insert(
            scope_id.clone(),
            IssuedResolution {
                ticket: ticket.clone(),
                snapshot_identity_sha256,
            },
        );
        Ok(ticket)
    }

    /// Compare-and-discharge after the caller proves its local/render commit
    /// applied. Merely sending or draining the resolution cannot call this.
    pub fn acknowledge(
        &mut self,
        ack_token: &str,
        client_commit_applied: bool,
    ) -> SnapbackResult<AcknowledgeOutcome> {
        validate_opaque(ack_token, "ackToken")?;
        if !client_commit_applied {
            return Err(invalidation_error(
                "SNAPBACK_AUTH_INVALIDATION_ACK_BEFORE_COMMIT",
                "authorization invalidation acknowledgement requires a committed client transition",
            ));
        }
        if self
            .last_discharged
            .values()
            .any(|(_, previous)| previous == ack_token)
        {
            return Ok(AcknowledgeOutcome::Duplicate);
        }
        let Some((scope_id, ticket)) = self
            .resolution_by_scope
            .iter()
            .find(|(_, issued)| issued.ticket.ack_token == ack_token)
            .map(|(scope, issued)| (scope.clone(), issued.ticket.clone()))
        else {
            return Ok(AcknowledgeOutcome::Stale);
        };
        let Some(current) = self.obligations.get(&scope_id) else {
            return Ok(AcknowledgeOutcome::Stale);
        };
        if current.obligation.revision != ticket.revision
            || !ticket.witness.covers(&current.obligation.witness)
            || current.obligation.max_disposition != ticket.max_disposition
        {
            return Ok(AcknowledgeOutcome::Stale);
        }
        self.obligations.remove(&scope_id);
        self.resolution_by_scope.remove(&scope_id);
        self.last_discharged
            .insert(scope_id.clone(), (ticket.revision, ticket.ack_token));
        self.discharge_connection_child(&scope_id);
        Ok(AcknowledgeOutcome::Discharged)
    }

    pub fn acknowledge_subscription(
        &mut self,
        issuer_id: &IssuerId,
        connection_generation: u64,
        ack_token: &str,
    ) -> SnapbackResult<AcknowledgeOutcome> {
        validate_opaque(ack_token, "ackToken")?;
        let belongs = self
            .resolution_by_scope
            .iter()
            .find(|(_, issued)| issued.ticket.ack_token == ack_token)
            .map(|(scope, _)| scope)
            .or_else(|| {
                self.last_discharged
                    .iter()
                    .find(|(_, (_, token))| token == ack_token)
                    .map(|(scope, _)| scope)
            })
            .is_some_and(|scope| {
                matches!(
                    scope,
                    ScopeId::Subscription {
                        issuer_id: scope_issuer,
                        connection_generation: scope_generation,
                        ..
                    } if scope_issuer == issuer_id && *scope_generation == connection_generation
                )
            });
        if !belongs {
            return Ok(AcknowledgeOutcome::Stale);
        }
        self.acknowledge(ack_token, true)
    }

    pub fn resolution_for_ack_token(&self, ack_token: &str) -> Option<&ResolutionTicket> {
        self.resolution_by_scope
            .values()
            .find(|issued| issued.ticket.ack_token == ack_token)
            .map(|issued| &issued.ticket)
    }

    pub fn retire_scope(&mut self, scope_id: &ScopeId) -> Option<ScopeRetirementCandidate> {
        self.remove_live_scope_state(scope_id);
        self.scope_retirement_candidate(scope_id)
    }

    /// Roll back a successor scope that never became a retained producer.
    /// Unlike ordinary retirement, removing its provisional connection-child
    /// edge may not discharge a pre-existing empty connection-root obligation:
    /// the predecessor remains authoritative and a later transfer must still
    /// inherit that root. Scope sequences remain spent, so no unpublished
    /// identity can be reused.
    pub fn rollback_unpublished_live_scope(
        &mut self,
        scope_id: &ScopeId,
        connection_scope: &ScopeId,
    ) {
        self.remove_live_scope_records(scope_id);
        let completed_root = self
            .connection_children
            .get_mut(connection_scope)
            .is_some_and(|children| {
                children.remove(scope_id);
                children.is_empty()
            });
        if completed_root {
            // The root predated this private stage. Remove only the provisional
            // child edge; ordinary retirement owns eventual root discharge.
            self.connection_children.remove(connection_scope);
        }
    }

    fn remove_live_scope_state(&mut self, scope_id: &ScopeId) {
        self.remove_live_scope_records(scope_id);
        self.discharge_connection_child(scope_id);
    }

    fn remove_live_scope_records(&mut self, scope_id: &ScopeId) {
        self.obligations.remove(scope_id);
        self.resolution_by_scope.remove(scope_id);
        // Live ScopeIds are never reused within an issuer, so continuity loss
        // may fold their high-water into the allocator itself and discard the
        // per-scope history without an ABA opening.
        self.revision_high_water.remove(scope_id);
        self.last_discharged.remove(scope_id);
        self.owner_continuity_by_scope.remove(scope_id);
        self.active_subscription_scopes.remove(scope_id);
    }

    /// Compute and record the contiguous retirement frontier after `scope_id`
    /// has left the live/obligation indexes. Callers that need an authenticated
    /// proof before committing retirement use `preview_scope_retirement`
    /// first; with one exclusive registry owner the resulting candidate is
    /// identical.
    fn scope_retirement_candidate(
        &mut self,
        scope_id: &ScopeId,
    ) -> Option<ScopeRetirementCandidate> {
        let ScopeId::Subscription {
            issuer_id,
            namespace,
            ..
        } = scope_id
        else {
            return None;
        };
        let key = (issuer_id.clone(), namespace.clone());
        let issued = self.issued_scope_high_water.get(&key).copied()?;
        let first_blocker = self
            .active_subscription_scopes
            .iter()
            .chain(self.obligations.keys())
            .filter_map(|candidate| match candidate {
                ScopeId::Subscription {
                    issuer_id: candidate_issuer,
                    namespace: candidate_namespace,
                    scope_sequence,
                    ..
                } if candidate_issuer == issuer_id && candidate_namespace == namespace => {
                    Some(*scope_sequence)
                }
                _ => None,
            })
            .min();
        let candidate = first_blocker
            .and_then(|sequence| sequence.checked_sub(1))
            .unwrap_or(issued)
            .min(issued);
        let previous = self
            .scope_retirement_frontier
            .get(&key)
            .copied()
            .unwrap_or(0);
        if candidate == 0 || candidate <= previous {
            return None;
        }
        self.scope_retirement_frontier
            .insert(key.clone(), candidate);
        if first_blocker.is_none() {
            self.issued_scope_high_water.remove(&key);
            self.scope_retirement_frontier.remove(&key);
        }
        Some(ScopeRetirementCandidate {
            namespace: namespace.clone(),
            retire_through_scope_sequence: candidate,
        })
    }

    /// Preview the retirement frontier that removing `scope_id` would make
    /// available, without changing any registry state. This lets the caller
    /// authenticate the proof before the predecessor is irreversibly removed.
    pub fn preview_scope_retirement(&self, scope_id: &ScopeId) -> Option<ScopeRetirementCandidate> {
        let ScopeId::Subscription {
            issuer_id,
            namespace,
            ..
        } = scope_id
        else {
            return None;
        };
        let key = (issuer_id.clone(), namespace.clone());
        let issued = self.issued_scope_high_water.get(&key).copied()?;
        let first_blocker = self
            .active_subscription_scopes
            .iter()
            .chain(self.obligations.keys())
            .filter(|candidate| *candidate != scope_id)
            .filter_map(|candidate| match candidate {
                ScopeId::Subscription {
                    issuer_id: candidate_issuer,
                    namespace: candidate_namespace,
                    scope_sequence,
                    ..
                } if candidate_issuer == issuer_id && candidate_namespace == namespace => {
                    Some(*scope_sequence)
                }
                _ => None,
            })
            .min();
        let candidate = first_blocker
            .and_then(|sequence| sequence.checked_sub(1))
            .unwrap_or(issued)
            .min(issued);
        let previous = self
            .scope_retirement_frontier
            .get(&key)
            .copied()
            .unwrap_or(0);
        (candidate != 0 && candidate > previous).then(|| ScopeRetirementCandidate {
            namespace: namespace.clone(),
            retire_through_scope_sequence: candidate,
        })
    }

    pub fn require_scope_retirement_preview(
        &self,
        scope_id: &ScopeId,
        expected: &Option<ScopeRetirementCandidate>,
    ) -> SnapbackResult<()> {
        if &self.preview_scope_retirement(scope_id) != expected {
            return Err(corrupt(
                "live scope retirement frontier changed before transfer commit",
            ));
        }
        Ok(())
    }

    pub fn retire_connection(&mut self, issuer_id: &IssuerId, connection_generation: u64) {
        let connection = ScopeId::Connection {
            issuer_id: issuer_id.clone(),
            connection_generation,
        };
        let scopes = self
            .obligations
            .keys()
            .chain(self.active_subscription_scopes.iter())
            .filter(|scope| match scope {
                ScopeId::Connection {
                    issuer_id: scope_issuer,
                    connection_generation: scope_generation,
                }
                | ScopeId::Subscription {
                    issuer_id: scope_issuer,
                    connection_generation: scope_generation,
                    ..
                } => scope_issuer == issuer_id && *scope_generation == connection_generation,
                ScopeId::ClientQuery { .. } => false,
            })
            .cloned()
            .collect::<Vec<_>>();
        for scope in scopes {
            let _ = self.retire_scope(&scope);
        }
        self.connection_children.remove(&connection);
        self.obligations.remove(&connection);
        self.resolution_by_scope.remove(&connection);
    }

    fn discharge_connection_child(&mut self, child: &ScopeId) {
        let mut completed_roots = Vec::new();
        for (root, children) in &mut self.connection_children {
            children.remove(child);
            if children.is_empty() {
                completed_roots.push(root.clone());
            }
        }
        for root in completed_roots {
            self.connection_children.remove(&root);
            self.obligations.remove(&root);
            self.resolution_by_scope.remove(&root);
            self.revision_high_water.remove(&root);
            self.last_discharged.remove(&root);
        }
    }

    fn require_expected(
        &self,
        scope_id: &ScopeId,
        witness: &CompositeWitness,
    ) -> SnapbackResult<()> {
        if witness.authorization != self.expectation.authorization {
            return Err(invalidation_error(
                "SNAPBACK_AUTH_INVALIDATION_EXPECTATION_STALE",
                "obligation authorization pair is not the authenticated current expectation",
            ));
        }
        if let Some(data) = &witness.data
            && let Some(expected_stream) = &self.expectation.version_stream
            && &data.version_stream != expected_stream
        {
            return Err(invalidation_error(
                "SNAPBACK_AUTH_INVALIDATION_EXPECTATION_STALE",
                "obligation version stream is not the authenticated current expectation",
            ));
        }
        if let Some(issuer) = scope_id.issuer()
            && Some(issuer) != self.expectation.issuer_id.as_ref()
        {
            return Err(invalidation_error(
                "SNAPBACK_AUTH_INVALIDATION_ISSUER_INVALID",
                "obligation issuer is not the authenticated current boot issuer",
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const INCARNATION: &str = "018f0d90-7b11-7a22-8c33-445566778899";

    fn issuer() -> IssuerId {
        IssuerId {
            authorization_incarnation: INCARNATION.to_owned(),
            boot_sequence: 7,
            boot_nonce: URL_SAFE_NO_PAD.encode([3_u8; 16]),
        }
    }

    fn namespace(instance: u64) -> QueryNamespace {
        QueryNamespace {
            client_store_id: "store-A".to_owned(),
            query_key: "todos:{}".to_owned(),
            query_instance_id: instance,
        }
    }

    fn scope(instance: u64) -> ScopeId {
        scope_with_sequence(instance, 3)
    }

    fn scope_with_sequence(instance: u64, scope_sequence: u64) -> ScopeId {
        ScopeId::Subscription {
            issuer_id: issuer(),
            namespace: namespace(instance),
            scope_sequence,
            connection_generation: 5,
            subscription_id: format!("sub-{instance}-{scope_sequence}"),
        }
    }

    #[test]
    fn scope_id_wire_shape_uses_camel_case_variant_fields() {
        let value = serde_json::to_value(scope_with_sequence(9, 3)).unwrap();
        assert_eq!(
            value,
            serde_json::json!({
                "kind": "subscription",
                "issuerId": {
                    "authorizationIncarnation": INCARNATION,
                    "bootSequence": 7,
                    "bootNonce": "AwMDAwMDAwMDAwMDAwMDAw",
                },
                "namespace": {
                    "clientStoreId": "store-A",
                    "queryKey": "todos:{}",
                    "queryInstanceId": 9,
                },
                "scopeSequence": 3,
                "connectionGeneration": 5,
                "subscriptionId": "sub-9-3",
            })
        );
        assert_eq!(
            serde_json::from_value::<ScopeId>(value).unwrap(),
            scope_with_sequence(9, 3)
        );
    }

    fn witness(version: u64) -> CompositeWitness {
        CompositeWitness {
            authorization: AuthorizationVersion {
                incarnation: INCARNATION.to_owned(),
                epoch: 4,
            },
            data: Some(DataWitness {
                version_stream: "stream-A".to_owned(),
                min_commit_version: version,
            }),
        }
    }

    fn registry() -> ObligationRegistry {
        ObligationRegistry::new(ObligationExpectation {
            authorization: witness(0).authorization,
            version_stream: Some("stream-A".to_owned()),
            issuer_id: Some(issuer()),
        })
        .unwrap()
    }

    fn register_scope(registry: &mut ObligationRegistry, instance: u64) {
        registry
            .register_live_scope(scope(instance), format!("owner-{instance}"))
            .unwrap();
    }

    /// ENG-24989: lease issuance consults only obligations capable of
    /// quarantining/deleting the exact target query instance (LLP 0053
    /// issuance proof item 4), never the global pending set.
    #[test]
    fn lease_target_blocking_matches_only_scopes_that_can_reach_the_exact_query() {
        let mut registry = registry();
        assert!(!registry.blocks_lease_target(&namespace(1)));

        register_scope(&mut registry, 1);
        registry
            .raise(
                scope(1),
                1,
                "cause-1",
                InvalidationDisposition::Quarantine,
                witness(1),
                None,
            )
            .unwrap();
        assert!(registry.blocks_lease_target(&namespace(1)));
        // Any differing namespace axis is out of the obligation's reach.
        assert!(!registry.blocks_lease_target(&namespace(2)));
        let mut other_store = namespace(1);
        other_store.client_store_id = "store-B".to_owned();
        assert!(!registry.blocks_lease_target(&other_store));
        let mut other_query = namespace(1);
        other_query.query_key = "other:{}".to_owned();
        assert!(!registry.blocks_lease_target(&other_query));

        // A client-query tombstone obligation blocks exactly its instance.
        registry
            .raise(
                ScopeId::ClientQuery {
                    namespace: namespace(3),
                },
                2,
                "cause-2",
                InvalidationDisposition::Quarantine,
                witness(1),
                None,
            )
            .unwrap();
        assert!(registry.blocks_lease_target(&namespace(3)));

        // A connection root reaches a target only through its registered
        // query-sized children.
        let connection = ScopeId::Connection {
            issuer_id: issuer(),
            connection_generation: 5,
        };
        registry
            .raise(
                connection.clone(),
                3,
                "cause-3",
                InvalidationDisposition::Quarantine,
                witness(1),
                None,
            )
            .unwrap();
        assert!(!registry.blocks_lease_target(&namespace(4)));
        register_scope(&mut registry, 4);
        registry
            .register_connection_child(&connection, scope(4))
            .unwrap();
        assert!(registry.blocks_lease_target(&namespace(4)));
        // The now three-scope pending set still cannot fence an untouched
        // namespace.
        assert!(!registry.blocks_lease_target(&namespace(9)));
    }

    #[test]
    fn issuer_mac_binds_target_app_and_every_issuer_field() {
        let signer = IssuerAuthenticator::new("protocol-key", [7_u8; 32]).unwrap();
        let authenticated = signer.authenticate(issuer(), "local-dev", "app-A").unwrap();
        signer.verify(&authenticated, "local-dev", "app-A").unwrap();
        assert!(signer.verify(&authenticated, "hosted", "app-A").is_err());
        let mut forged = authenticated.clone();
        forged.issuer_id.boot_sequence += 1;
        assert!(signer.verify(&forged, "local-dev", "app-A").is_err());
    }

    #[test]
    fn retirement_macs_bind_frontier_namespace_expectation_and_current_boot() {
        let signer = IssuerAuthenticator::new("protocol-key", [7_u8; 32]).unwrap();
        let authenticated = signer.authenticate(issuer(), "local-dev", "app-A").unwrap();
        let scope_retirement = signer
            .authenticate_scope_retirement(
                &authenticated,
                namespace(1),
                9,
                witness(0).authorization,
                "local-dev",
                "app-A",
            )
            .unwrap();
        signer
            .verify_scope_retirement(&scope_retirement, &authenticated, "local-dev", "app-A")
            .unwrap();
        let mut forged_scope = scope_retirement.clone();
        forged_scope.retire_through_scope_sequence += 1;
        assert!(
            signer
                .verify_scope_retirement(&forged_scope, &authenticated, "local-dev", "app-A")
                .is_err()
        );

        let issuer_retirement = signer
            .authenticate_issuer_retirement(
                &authenticated,
                authenticated.issuer_id.boot_sequence - 1,
                witness(0).authorization,
                "local-dev",
                "app-A",
            )
            .unwrap();
        signer
            .verify_issuer_retirement(&issuer_retirement, "local-dev", "app-A")
            .unwrap();
        let mut forged_issuer = issuer_retirement;
        forged_issuer.retire_through_boot_sequence -= 1;
        assert!(
            signer
                .verify_issuer_retirement(&forged_issuer, "local-dev", "app-A")
                .is_err()
        );
    }

    #[test]
    fn scope_retirement_advances_only_below_live_or_unresolved_scopes() {
        let mut registry = registry();
        let first = scope_with_sequence(1, 3);
        let second = scope_with_sequence(1, 5);
        registry
            .register_live_scope(first.clone(), "owner-first")
            .unwrap();
        registry
            .register_live_scope(second.clone(), "owner-second")
            .unwrap();
        registry
            .raise(
                second.clone(),
                1,
                "second-pending",
                InvalidationDisposition::Quarantine,
                witness(1),
                None,
            )
            .unwrap();

        let preview = registry.preview_scope_retirement(&first).unwrap();
        let first_retirement = registry.retire_scope(&first).unwrap();
        assert_eq!(preview, first_retirement);
        assert_eq!(first_retirement.retire_through_scope_sequence, 4);
        assert!(registry.retire_scope(&second).is_some());
        assert!(registry.pending(&second).is_none());
    }

    #[test]
    fn unpublished_scope_rollback_preserves_preexisting_connection_root() {
        let mut registry = registry();
        let connection = ScopeId::Connection {
            issuer_id: issuer(),
            connection_generation: 6,
        };
        registry
            .raise(
                connection.clone(),
                1,
                "connection-root",
                InvalidationDisposition::Quarantine,
                witness(1),
                None,
            )
            .unwrap();
        let replacement = ScopeId::Subscription {
            issuer_id: issuer(),
            namespace: namespace(1),
            scope_sequence: 4,
            connection_generation: 6,
            subscription_id: "sub-replacement".to_owned(),
        };
        registry
            .register_live_scope(replacement.clone(), "replacement-owner")
            .unwrap();
        registry
            .register_connection_child(&connection, replacement.clone())
            .unwrap();
        assert!(registry.pending(&replacement).is_some());

        registry.rollback_unpublished_live_scope(&replacement, &connection);

        assert!(registry.pending(&replacement).is_none());
        assert!(registry.pending(&connection).is_some());
        assert!(registry.active_subscription_scopes_for_test().is_empty());
    }

    #[test]
    fn resolution_carries_exact_recorded_owner_continuity() {
        let mut registry = registry();
        let scope = scope(1);
        registry
            .register_live_scope(scope.clone(), "tab-continuity-1")
            .unwrap();
        let obligation = registry
            .raise(
                scope.clone(),
                1,
                "cause-1",
                InvalidationDisposition::Quarantine,
                witness(1),
                None,
            )
            .unwrap();
        assert_eq!(
            obligation.owner_continuity_id.as_deref(),
            Some("tab-continuity-1")
        );
        let resolution = registry
            .issue_resolution(&scope, ResolutionKind::Snapshot, witness(1), b"snapshot-1")
            .unwrap();
        assert_eq!(
            resolution.owner_continuity_id.as_deref(),
            Some("tab-continuity-1")
        );
        assert!(
            registry
                .register_live_scope(scope, "different-continuity")
                .is_err()
        );
    }

    #[test]
    fn semantic_causes_are_idempotent_and_revisions_merge_monotonically() {
        let mut registry = registry();
        register_scope(&mut registry, 1);
        let first = registry
            .raise(
                scope(1),
                100,
                "commit-100",
                InvalidationDisposition::Quarantine,
                witness(100),
                None,
            )
            .unwrap();
        assert_eq!(first.revision, 1);
        let duplicate = registry
            .raise(
                scope(1),
                100,
                "commit-100",
                InvalidationDisposition::Quarantine,
                witness(100),
                None,
            )
            .unwrap();
        assert_eq!(duplicate.revision, 1);
        let second = registry
            .raise(
                scope(1),
                105,
                "commit-105",
                InvalidationDisposition::Delete,
                witness(105),
                None,
            )
            .unwrap();
        assert_eq!(second.revision, 2);
        assert_eq!(second.max_disposition, InvalidationDisposition::Delete);
        assert_eq!(second.witness.data.unwrap().min_commit_version, 105);
    }

    #[test]
    fn acknowledgement_is_exact_revision_and_after_commit_only() {
        let mut registry = registry();
        register_scope(&mut registry, 1);
        let pending = registry
            .raise(
                scope(1),
                100,
                "commit-100",
                InvalidationDisposition::Quarantine,
                witness(100),
                None,
            )
            .unwrap();
        assert!(
            registry
                .issue_resolution(
                    &pending.scope_id,
                    ResolutionKind::Snapshot,
                    witness(99),
                    b"snapshot-99",
                )
                .is_err()
        );
        let ticket = registry
            .issue_resolution(
                &pending.scope_id,
                ResolutionKind::Snapshot,
                witness(100),
                b"snapshot-100",
            )
            .unwrap();
        assert!(registry.acknowledge(&ticket.ack_token, false).is_err());

        registry
            .raise(
                scope(1),
                105,
                "commit-105",
                InvalidationDisposition::Quarantine,
                witness(105),
                None,
            )
            .unwrap();
        assert_eq!(
            registry.acknowledge(&ticket.ack_token, true).unwrap(),
            AcknowledgeOutcome::Stale
        );
        let ticket = registry
            .issue_resolution(
                &scope(1),
                ResolutionKind::Snapshot,
                witness(105),
                b"snapshot-105",
            )
            .unwrap();
        assert_eq!(
            registry.acknowledge(&ticket.ack_token, true).unwrap(),
            AcknowledgeOutcome::Discharged
        );
        assert_eq!(
            registry.acknowledge(&ticket.ack_token, true).unwrap(),
            AcknowledgeOutcome::Duplicate
        );
    }

    #[test]
    fn superseding_unacknowledged_resolution_advances_scope_revision() {
        let mut registry = registry();
        register_scope(&mut registry, 1);
        let pending = registry
            .raise(
                scope(1),
                100,
                "commit-100",
                InvalidationDisposition::Quarantine,
                witness(100),
                None,
            )
            .unwrap();

        let first = registry
            .issue_resolution(
                &pending.scope_id,
                ResolutionKind::Snapshot,
                witness(100),
                br#"{"version":100,"rows":["first"]}"#,
            )
            .unwrap();
        let duplicate = registry
            .issue_resolution(
                &pending.scope_id,
                ResolutionKind::Snapshot,
                witness(100),
                br#"{"version":100,"rows":["first"]}"#,
            )
            .unwrap();
        assert_eq!(duplicate, first, "an exact re-fire stays byte-identical");

        // A later drain can satisfy the still-pending obligation with a newer
        // store snapshot before the first ticket is ACKed. That is a distinct
        // client-visible frame even though no new invalidation cause was
        // raised for this scope.
        let second = registry
            .issue_resolution(
                &pending.scope_id,
                ResolutionKind::Snapshot,
                witness(101),
                br#"{"version":101,"rows":["first"]}"#,
            )
            .unwrap();
        assert_ne!(second.ack_token, first.ack_token);
        assert_eq!(second.revision, first.revision + 1);
        let projection = registry.projection(&pending.scope_id).unwrap();
        assert_eq!(projection.obligation.revision, second.revision);
        assert_eq!(projection.resolution.as_ref(), Some(&second));
        assert_eq!(
            registry.acknowledge(&first.ack_token, true).unwrap(),
            AcknowledgeOutcome::Stale,
        );
        assert_eq!(
            registry.acknowledge(&second.ack_token, true).unwrap(),
            AcknowledgeOutcome::Discharged,
        );
    }

    #[test]
    fn distinct_scope_revision_domains_coexist() {
        let mut registry = registry();
        register_scope(&mut registry, 1);
        register_scope(&mut registry, 2);
        for sequence in 1..=5 {
            registry
                .raise(
                    scope(1),
                    sequence,
                    format!("cause-{sequence}"),
                    InvalidationDisposition::Quarantine,
                    witness(sequence),
                    None,
                )
                .unwrap();
        }
        let other = registry
            .raise(
                scope(2),
                1,
                "other-1",
                InvalidationDisposition::Quarantine,
                witness(1),
                None,
            )
            .unwrap();
        assert_eq!(registry.pending(&scope(1)).unwrap().revision, 5);
        assert_eq!(other.revision, 1);
    }

    fn retry_key(name: &str) -> RetryEpisodeKey {
        RetryEpisodeKey {
            authority_subject: "user-A".to_owned(),
            client_store_id: "store-A".to_owned(),
            query_key: name.to_owned(),
        }
    }

    #[test]
    fn retry_episode_budget_does_not_reset_on_refire_or_new_revision() {
        let mut retries = RetryEpisodeRegistry::default();
        let key = retry_key("todos:{}");
        let first = retries
            .reserve(
                key.clone(),
                witness(100),
                1_000,
                RetryReservationKind::Initial,
            )
            .unwrap();
        assert!(matches!(first, RetryReservation::Reserved(_)));
        retries.record_failure(&key, 1_100).unwrap();
        let attached = retries
            .reserve(
                key.clone(),
                witness(105),
                1_200,
                RetryReservationKind::Initial,
            )
            .unwrap();
        assert!(matches!(attached, RetryReservation::Attached(_)));
        for now in [1_300, 1_400] {
            assert!(matches!(
                retries
                    .reserve(
                        key.clone(),
                        witness(105),
                        now,
                        RetryReservationKind::Automatic,
                    )
                    .unwrap(),
                RetryReservation::Reserved(_)
            ));
            retries.record_failure(&key, now).unwrap();
        }
        assert!(matches!(
            retries
                .reserve(
                    key.clone(),
                    witness(105),
                    1_500,
                    RetryReservationKind::Automatic,
                )
                .unwrap(),
            RetryReservation::Exhausted(_)
        ));
        assert!(!retries.resolve(&key, &witness(104)));
        assert!(retries.resolve(&key, &witness(105)));
    }

    #[test]
    fn manual_retry_is_idempotent_and_replaces_without_double_counting() {
        let mut retries = RetryEpisodeRegistry::default();
        let key = retry_key("todos:{}");
        retries
            .reserve(key.clone(), witness(1), 1, RetryReservationKind::Initial)
            .unwrap();
        retries.record_failure(&key, 2).unwrap();
        for now in [3, 4] {
            retries
                .reserve(
                    key.clone(),
                    witness(1),
                    now,
                    RetryReservationKind::Automatic,
                )
                .unwrap();
            retries.record_failure(&key, now).unwrap();
        }
        let first = retries.manual_retry(&key, "manual-1", 5).unwrap();
        let duplicate = retries.manual_retry(&key, "manual-1", 6).unwrap();
        let RetryReservation::Reserved(first) = first else {
            panic!("manual retry must reserve")
        };
        let RetryReservation::Attached(duplicate) = duplicate else {
            panic!("duplicate manual retry must attach")
        };
        assert_eq!(first.episode_id, duplicate.episode_id);
        assert_eq!(retries.episodes().len(), 1);
    }

    #[test]
    fn manual_retry_cannot_reset_an_episode_before_exhaustion() {
        let mut retries = RetryEpisodeRegistry::default();
        let key = retry_key("todos:{}");
        retries
            .reserve(key.clone(), witness(1), 1, RetryReservationKind::Initial)
            .unwrap();
        retries.record_failure(&key, 2).unwrap();

        let error = retries.manual_retry(&key, "manual-1", 3).unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_RETRY_NOT_EXHAUSTED");
        assert_eq!(retries.episodes()[&key].attempts_reserved, 1);
        assert!(retries.episodes()[&key].manual_retry_id.is_none());
    }
}
