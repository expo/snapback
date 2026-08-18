//! The hosted-edge adapter: the concrete owner of LLP 0060's hosted
//! attestation facts for the `loopback-terminated-single-instance.v1` profile.
//!
//! @ref LLP 0098#2-producing-an-admission-the-control-plane-contract — the
//! admission envelope is authenticated by a control-plane key bound into the
//! immutable release; the private half never enters the deployment.
//!
//! Nothing here believes an operator flag. The envelope is data; its authority
//! is an Ed25519 signature verifiable only against the release-bound key, and
//! every fact the origin can re-derive for itself (topology, configuration
//! digest, epoch monotonicity) is re-derived rather than read.

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use ring::signature::{ED25519, UnparsedPublicKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::deployment::{
    HOSTED_ADMISSION_MAX_SAFE_INTEGER, HostedAdmission, HostedServingAuthority,
};
/// Re-exported so the off-machine control-plane signer can build the exact
/// throttle configuration the deployment will validate.
pub use super::throttle::{AuthenticationBucketPolicy, SharedAuthenticationThrottleConfig};
use crate::deploy::{HostedAdmissionV2, HostedAdmissionV2Version};
use crate::diagnostic::{SnapbackError, SnapbackResult};

/// The only adapter profile this build implements.
pub const HOSTED_EDGE_PROFILE: &str = "loopback-terminated-single-instance.v1";

/// Domain separator for the admission signing input. A signature that could be
/// reinterpreted under another protocol is not a signature over this one.
const ADMISSION_SIGNING_DOMAIN: &[u8] = b"snapback.hosted-admission.v1";
const TARGET_ADMISSION_SIGNING_DOMAIN: &[u8] = b"snapback.hosted-admission.v2";

/// Durable high-water marks live in their own table so an admission rollback is
/// refused even across a process restart.
const ADMISSION_WATERMARK_TABLE: &str = "_snapback_hosted_admission_watermark";

/// A pre-signed chain may not authorize an unbounded serving window.
///
/// @ref LLP 0098#24-renewal-and-the-honest-cost-of-pre-signing — a
/// `presignedWindow` deployment cannot be withdrawn by its control plane
/// inside the window, so the window itself is capped.
pub const MAX_PRESIGNED_WINDOW_MS: u64 = 24 * 60 * 60 * 1_000;

/// How the deployment guarantees the public leg is HTTPS *before* first
/// contact. LLP 0060 D2 admits exactly these three mechanisms and no
/// dynamically learned policy.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum FirstContactTransport {
    /// The exact public hostname is in the browser preload list.
    HstsPreloadedHost,
    /// A parent suffix covering the hostname is preloaded with
    /// `include_subdomains`, so the name is HTTPS-only before first contact.
    HstsPreloadedSuffix,
    /// A pinned non-browser client population. Makes no browser-facing claim.
    InstallTimeHttpsOnlyBinding,
}

impl FirstContactTransport {
    /// LLP 0098 §7: an install-time binding narrows the claim to its pinned
    /// client population and may not be described as browser-facing.
    pub fn permits_browser_facing_claim(self) -> bool {
        !matches!(self, Self::InstallTimeHttpsOnlyBinding)
    }

    fn wire_value(self) -> &'static str {
        match self {
            Self::HstsPreloadedHost => "hstsPreloadedHost",
            Self::HstsPreloadedSuffix => "hstsPreloadedSuffix",
            Self::InstallTimeHttpsOnlyBinding => "installTimeHttpsOnlyBinding",
        }
    }
}

/// Which delivery mode is in force, and therefore what withdrawal the
/// deployment may honestly claim.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum AdmissionRenewal {
    /// The control plane delivers each successor before its predecessor
    /// expires; withdrawal latency is bounded by the remaining lifetime.
    Online,
    /// A bounded chain was pre-signed once. Health withdrawal still applies;
    /// control-plane withdrawal does not.
    PresignedWindow,
}

/// The signed envelope carrying one admission snapshot.
///
/// @ref LLP 0098#22-the-signed-envelope — closed at every level; the signature
/// covers a length-prefixed canonical input so no field boundary can shift.
#[derive(Clone, Debug, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct HostedAdmissionEnvelope {
    pub profile: String,
    pub public_origin: String,
    pub first_contact_transport: FirstContactTransport,
    pub renewal: AdmissionRenewal,
    pub admission: HostedAdmission,
    /// LLP 0111's routed-Machine authority. Mandatory for online renewal and
    /// independently signed by the same release-bound key.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hosted_target_admission: Option<HostedAdmissionV2>,
    /// Unpadded base64url Ed25519 signature over the canonical signing input.
    pub signature: String,
}

fn prefixed_sha256(value: &str) -> bool {
    value.strip_prefix("sha256:").is_some_and(|digest| {
        digest.len() == 64
            && digest
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    })
}

pub fn target_admission_signing_input(admission: &HostedAdmissionV2) -> Vec<u8> {
    let version = match admission.schema_version {
        HostedAdmissionV2Version::V2 => "snapback.hosted-admission.v2",
    };
    let parts = [
        TARGET_ADMISSION_SIGNING_DOMAIN.to_vec(),
        version.as_bytes().to_vec(),
        admission.target_id.as_bytes().to_vec(),
        admission.deployment_id.as_bytes().to_vec(),
        admission.binding_generation.to_string().into_bytes(),
        admission.target_binding_sha256.as_bytes().to_vec(),
        admission.control_head_sha256.as_bytes().to_vec(),
        admission.supervisor_incarnation.as_bytes().to_vec(),
        admission.exact_roster_sha256.as_bytes().to_vec(),
        admission.routed_machine_id.as_bytes().to_vec(),
        admission.hosted_auth_expires_at_ms.to_string().into_bytes(),
        admission
            .routed_machine_expires_at_ms
            .to_string()
            .into_bytes(),
        admission.replay_floor.to_string().into_bytes(),
        admission.admission_generation.to_string().into_bytes(),
        admission.issued_at_ms.to_string().into_bytes(),
    ];
    let mut input = Vec::new();
    for part in parts {
        input.extend_from_slice(&(part.len() as u64).to_be_bytes());
        input.extend_from_slice(&part);
    }
    input
}

fn verify_target_admission(
    target: &HostedAdmissionV2,
    edge: &HostedAdmission,
    admission_public_key: &[u8],
    now_ms: u64,
) -> SnapbackResult<()> {
    let signature = URL_SAFE_NO_PAD.decode(&target.signature).map_err(|_| {
        refuse(
            "SNAPBACK_HOSTED_ADMISSION_V2_UNAUTHENTICATED",
            "hosted target admission signature is not canonical base64url",
        )
    })?;
    if signature.len() != 64 || URL_SAFE_NO_PAD.encode(&signature) != target.signature {
        return Err(refuse(
            "SNAPBACK_HOSTED_ADMISSION_V2_UNAUTHENTICATED",
            "hosted target admission signature is not a canonical Ed25519 signature",
        ));
    }
    UnparsedPublicKey::new(&ED25519, admission_public_key)
        .verify(&target_admission_signing_input(target), &signature)
        .map_err(|_| {
            refuse(
                "SNAPBACK_HOSTED_ADMISSION_V2_UNAUTHENTICATED",
                "hosted target admission is not signed by the release-bound control-plane key",
            )
        })?;
    if target.target_id.is_empty()
        || target.deployment_id != edge.deployment_id
        || target.binding_generation < 1
        || target.binding_generation > HOSTED_ADMISSION_MAX_SAFE_INTEGER
        || !prefixed_sha256(&target.target_binding_sha256)
        || !prefixed_sha256(&target.control_head_sha256)
        || target.supervisor_incarnation.is_empty()
        || !prefixed_sha256(&target.exact_roster_sha256)
        || target.routed_machine_id.is_empty()
        || target.hosted_auth_expires_at_ms > HOSTED_ADMISSION_MAX_SAFE_INTEGER
        || target.routed_machine_expires_at_ms > HOSTED_ADMISSION_MAX_SAFE_INTEGER
        || target.replay_floor > HOSTED_ADMISSION_MAX_SAFE_INTEGER
        || target.admission_generation > HOSTED_ADMISSION_MAX_SAFE_INTEGER
        || target.issued_at_ms > HOSTED_ADMISSION_MAX_SAFE_INTEGER
        || target.hosted_auth_expires_at_ms != edge.expires_at_ms
        || target.routed_machine_expires_at_ms < target.hosted_auth_expires_at_ms
        || target.replay_floor != edge.sender_replay_epoch_floor
        || target.admission_generation != edge.admission_epoch
        || target.issued_at_ms != edge.issued_at_ms
    {
        return Err(refuse(
            "SNAPBACK_HOSTED_ADMISSION_V2_INVALID",
            "hosted target admission does not match the edge admission and exact target binding",
        ));
    }
    if now_ms < target.issued_at_ms
        || now_ms > target.hosted_auth_expires_at_ms
        || now_ms > target.routed_machine_expires_at_ms
    {
        return Err(refuse(
            "SNAPBACK_HOSTED_ADMISSION_V2_STALE",
            "hosted target admission is outside its routed-Machine authority window",
        ));
    }
    Ok(())
}

/// The adapter's local configuration.
///
/// **Nothing here carries authority.** Every member is an operator-supplied
/// input that the signed envelope must independently agree with: the deployment
/// identity is compared, the origin and first-contact mechanism are folded into
/// `configurationSha256`, and the verification key is folded into that same
/// digest so substituting it invalidates every snapshot signed against the
/// original. The file's job is to tell the origin what to *check*, never what to
/// believe.
///
/// @ref LLP 0098#23-what-the-control-plane-must-bind — the key is inside its own
/// configuration digest, so key rotation is a configuration change.
#[derive(Clone, Debug, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct HostedEdgeConfig {
    pub format_version: u32,
    pub deployment_id: String,
    pub public_origin: String,
    pub first_contact_transport: FirstContactTransport,
    /// Unpadded base64url Ed25519 public key. Ships inside the release
    /// artifact; the private half never enters the deployment.
    pub admission_public_key: String,
    /// Digest over the served support artifact set, including the browser
    /// artifact whose direct-bearer seam exclusion the admission asserts.
    pub support_sha256: String,
}

impl HostedEdgeConfig {
    pub fn parse(bytes: &[u8]) -> SnapbackResult<Self> {
        let config: Self = serde_json::from_slice(bytes).map_err(|_| {
            refuse(
                "SNAPBACK_AUTH_HOSTED_ADMISSION_INVALID",
                "hosted-edge adapter configuration is not a closed valid document",
            )
        })?;
        if config.format_version != 1 {
            return Err(refuse(
                "SNAPBACK_AUTH_HOSTED_ADMISSION_INVALID",
                "hosted-edge adapter configuration has an unknown format version",
            ));
        }
        if config.deployment_id.is_empty() {
            return Err(refuse(
                "SNAPBACK_AUTH_HOSTED_ADMISSION_INVALID",
                "hosted-edge adapter configuration has an empty deployment identity",
            ));
        }
        Ok(config)
    }

    pub fn admission_public_key_bytes(&self) -> SnapbackResult<Vec<u8>> {
        let key = URL_SAFE_NO_PAD
            .decode(&self.admission_public_key)
            .map_err(|_| {
                refuse(
                    "SNAPBACK_AUTH_HOSTED_ADMISSION_INVALID",
                    "hosted-edge admission key is not canonical base64url",
                )
            })?;
        if key.len() != 32 {
            return Err(refuse(
                "SNAPBACK_AUTH_HOSTED_ADMISSION_INVALID",
                "hosted-edge admission key is not a 32-byte Ed25519 public key",
            ));
        }
        Ok(key)
    }

    /// Derive the facts the origin will compare against the envelope, from the
    /// configuration plus the one thing only the origin knows: whether the
    /// address it is about to bind is loopback.
    ///
    /// The digest is computed over the profile's *required* posture, not the
    /// observed one. The observed posture rides in `listener_loopback` and is
    /// judged by H1. Folding the observed value into the digest instead would
    /// make a non-loopback bind fail as a stale configuration, hiding the real
    /// topology violation behind a misleading diagnostic.
    pub fn self_facts(&self, bind_is_loopback: bool) -> SnapbackResult<HostedEdgeSelfFacts> {
        let key = self.admission_public_key_bytes()?;
        Ok(HostedEdgeSelfFacts {
            deployment_id: self.deployment_id.clone(),
            configuration_sha256: configuration_digest(
                HOSTED_EDGE_PROFILE,
                &self.public_origin,
                self.first_contact_transport,
                true,
                // The first hosted profile is `operatorSurface: disabled`; the
                // adapter does not offer an exposed-operator configuration, so
                // the digest is computed over the only admissible value.
                true,
                &key,
            ),
            support_sha256: self.support_sha256.clone(),
            listener_loopback: Some(bind_is_loopback),
        })
    }
}

/// How often the renewal loop looks for a successor.
///
/// Comfortably shorter than the five-minute maximum lifetime so a successor is
/// installed well before the incumbent lapses, without polling hotly.
pub const ADMISSION_RENEWAL_INTERVAL_MS: u64 = 30_000;

/// Everything the renewal loop needs to verify a successor exactly as the
/// pre-bind path did. Carrying the same inputs is the point: a renewed
/// admission is not trusted more cheaply than the first one.
#[derive(Clone, Debug)]
pub struct AdmissionRenewalInputs {
    pub document_path: std::path::PathBuf,
    pub admission_public_key: Vec<u8>,
    pub facts: HostedEdgeSelfFacts,
}

/// Verify the successor covering `now`, if there is one.
///
/// Returns `Ok(None)` when the incumbent is still the current snapshot, so the
/// caller does no work. Every error is the ordinary coded refusal — a chain
/// that stops covering the clock simply yields nothing, and the incumbent
/// expires on its own terms.
///
/// @ref LLP 0098#24-renewal-and-the-honest-cost-of-pre-signing
pub(crate) fn verify_renewal_candidate(
    inputs: &AdmissionRenewalInputs,
    installed_issued_at_ms: u64,
    now_ms: u64,
) -> SnapbackResult<Option<VerifiedHostedAdmission>> {
    let document = std::fs::read(&inputs.document_path).map_err(|_| {
        refuse(
            "SNAPBACK_AUTH_HOSTED_ADMISSION_INVALID",
            "hosted admission document could not be re-read for renewal",
        )
    })?;
    let candidate = select_admission_for_now(&document, now_ms)?;
    if candidate.admission.issued_at_ms == installed_issued_at_ms {
        return Ok(None);
    }
    // The successor runs the identical conjunction, including the topology and
    // binding clauses. Renewal is not a trust shortcut.
    verify_admission_envelope_prebind(
        &candidate,
        &inputs.admission_public_key,
        &inputs.facts,
        now_ms,
    )
    .map(Some)
}

/// Select the snapshot covering `now` from a single envelope or a pre-signed
/// chain.
///
/// A five-minute maximum admission lifetime means a deployment that boots on
/// demand cannot be handed one snapshot in advance — the control plane does not
/// know when the machine will wake. A `presignedWindow` chain covers a declared
/// window and the origin picks the member covering its actual boot instant.
///
/// Selection is *not* authorization: the chosen member still runs the entire
/// §3.1 conjunction, so a chain cannot smuggle in an envelope that would fail
/// on its own.
///
/// @ref LLP 0098#24-renewal-and-the-honest-cost-of-pre-signing
pub fn select_admission_for_now(
    document: &[u8],
    now_ms: u64,
) -> SnapbackResult<HostedAdmissionEnvelope> {
    let value: serde_json::Value = serde_json::from_slice(document).map_err(|_| {
        refuse(
            "SNAPBACK_AUTH_HOSTED_ADMISSION_INVALID",
            "hosted admission document is not valid JSON",
        )
    })?;
    let envelopes: Vec<HostedAdmissionEnvelope> = if value.is_array() {
        serde_json::from_value(value)
    } else {
        serde_json::from_value(value).map(|one: HostedAdmissionEnvelope| vec![one])
    }
    .map_err(|_| {
        refuse(
            "SNAPBACK_AUTH_HOSTED_ADMISSION_INVALID",
            "hosted admission document is not a closed envelope or envelope chain",
        )
    })?;

    // The chain's total span is capped, so a pre-signed window cannot become an
    // unbounded grant of un-withdrawable serving.
    if let (Some(first), Some(last)) = (envelopes.first(), envelopes.last())
        && last
            .admission
            .expires_at_ms
            .saturating_sub(first.admission.issued_at_ms)
            > MAX_PRESIGNED_WINDOW_MS
    {
        return Err(refuse(
            "SNAPBACK_AUTH_HOSTED_ADMISSION_INVALID",
            "hosted admission chain exceeds the maximum pre-signed window",
        ));
    }

    envelopes
        .into_iter()
        .find(|envelope| {
            now_ms >= envelope.admission.issued_at_ms && now_ms <= envelope.admission.expires_at_ms
        })
        .ok_or_else(|| {
            refuse(
                "SNAPBACK_AUTH_HOSTED_ADMISSION_EXPIRED",
                "no hosted admission in the supplied document covers the current instant",
            )
        })
}

/// Facts the origin derives about itself and compares against the envelope.
/// Every member is observed locally; none is read from the envelope.
#[derive(Clone, Debug)]
pub struct HostedEdgeSelfFacts {
    /// The deployment identity this origin was configured with.
    pub deployment_id: String,
    /// Digest over the effective serving configuration, including the
    /// admission verification key itself.
    pub configuration_sha256: String,
    /// Digest over the served support artifact set.
    pub support_sha256: String,
    /// The origin's own observed listener posture. `Some(true)` means the
    /// actual bound socket is loopback.
    pub listener_loopback: Option<bool>,
}

/// Coded refusals. Each names one clause of the LLP 0098 §3.1 conjunction so a
/// failure is reproducible from its code alone.
fn refuse(code: &'static str, message: &'static str) -> SnapbackError {
    SnapbackError::error(code, "auth-deployment", message)
}

/// Compute the configuration digest over the exact fields LLP 0098 §2.3 binds.
///
/// The verification key is inside its own configuration digest, so rotating the
/// key is a configuration change rather than a silent substitution.
pub fn configuration_digest(
    profile: &str,
    public_origin: &str,
    first_contact_transport: FirstContactTransport,
    bind_is_loopback: bool,
    operator_surface_disabled: bool,
    admission_public_key: &[u8],
) -> String {
    let mut hasher = Sha256::new();
    for part in [
        b"snapback.hosted-configuration.v1".as_slice(),
        profile.as_bytes(),
        public_origin.as_bytes(),
        first_contact_transport.wire_value().as_bytes(),
        if bind_is_loopback {
            b"loopback"
        } else {
            b"routable"
        }
        .as_slice(),
        if operator_surface_disabled {
            b"operator-disabled".as_slice()
        } else {
            b"operator-exposed".as_slice()
        },
        admission_public_key,
    ] {
        hasher.update((part.len() as u64).to_be_bytes());
        hasher.update(part);
    }
    hex_lower(&hasher.finalize())
}

fn hex_lower(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

/// The canonical signing input.
///
/// Every part is length-prefixed with its 8-byte big-endian length. Without the
/// prefixes a signature over a concatenation of attacker-influenced strings
/// admits the ordinary boundary-shifting forgery, and `publicOrigin` is exactly
/// the field an adversarial control plane would try to shift into.
pub fn admission_signing_input(
    profile: &str,
    public_origin: &str,
    first_contact_transport: FirstContactTransport,
    renewal: AdmissionRenewal,
    admission: &HostedAdmission,
) -> SnapbackResult<Vec<u8>> {
    let canonical_admission = serde_json::to_vec(admission).map_err(|_| {
        refuse(
            "SNAPBACK_AUTH_HOSTED_ADMISSION_INVALID",
            "hosted admission could not be canonicalized for signing",
        )
    })?;
    let renewal_value = match renewal {
        AdmissionRenewal::Online => "online",
        AdmissionRenewal::PresignedWindow => "presignedWindow",
    };
    let mut input = Vec::new();
    for part in [
        ADMISSION_SIGNING_DOMAIN,
        profile.as_bytes(),
        public_origin.as_bytes(),
        first_contact_transport.wire_value().as_bytes(),
        renewal_value.as_bytes(),
        canonical_admission.as_slice(),
    ] {
        input.extend_from_slice(&(part.len() as u64).to_be_bytes());
        input.extend_from_slice(part);
    }
    Ok(input)
}

impl HostedAdmissionEnvelope {
    /// Verify the signature before any field is interpreted, so a
    /// malformed-but-unsigned envelope cannot steer a later check.
    fn verify_signature(&self, admission_public_key: &[u8]) -> SnapbackResult<()> {
        let signature = URL_SAFE_NO_PAD.decode(&self.signature).map_err(|_| {
            refuse(
                "SNAPBACK_AUTH_HOSTED_ADMISSION_UNAUTHENTICATED",
                "hosted admission signature is not canonical base64url",
            )
        })?;
        let input = admission_signing_input(
            &self.profile,
            &self.public_origin,
            self.first_contact_transport,
            self.renewal,
            &self.admission,
        )?;
        UnparsedPublicKey::new(&ED25519, admission_public_key)
            .verify(&input, &signature)
            .map_err(|_| {
                refuse(
                    "SNAPBACK_AUTH_HOSTED_ADMISSION_UNAUTHENTICATED",
                    "hosted admission is not signed by the release-bound control-plane key",
                )
            })
    }
}

/// Create the durable admission high-water table.
pub use snapback_kernel::auth::hosted_edge::initialize_hosted_admission_watermark;


/// An envelope that passed every check not requiring durable state.
///
/// Held between the pre-bind phase and installation so the durable
/// monotonicity check is the only thing deferred to database availability.
#[derive(Clone, Debug)]
pub struct VerifiedHostedAdmission {
    envelope: HostedAdmissionEnvelope,
    throttle_key: [u8; 32],
}

impl VerifiedHostedAdmission {
    fn durable_commit(&self) -> snapback_kernel::auth::hosted_edge::HostedAdmissionCommit {
        snapback_kernel::auth::hosted_edge::HostedAdmissionCommit {
            admission_epoch: self.envelope.admission.admission_epoch,
            sender_replay_epoch_floor: self.envelope.admission.sender_replay_epoch_floor,
        }
    }

    pub(crate) fn public_origin(&self) -> &str {
        &self.envelope.public_origin
    }

    pub(crate) fn first_contact_transport(&self) -> FirstContactTransport {
        self.envelope.first_contact_transport
    }

    pub(crate) fn renewal(&self) -> AdmissionRenewal {
        self.envelope.renewal
    }

    pub fn capabilities(&self) -> crate::auth::deployment::HostedAuthCapabilities {
        self.envelope.admission.hosted_auth
    }

    pub fn issued_at_ms(&self) -> u64 {
        self.envelope.admission.issued_at_ms
    }

    pub(crate) fn hosted_target_admission(&self) -> Option<&HostedAdmissionV2> {
        self.envelope.hosted_target_admission.as_ref()
    }
}

/// Run every LLP 0098 §3.1 clause that does not require durable state.
///
/// This runs **before the database path is created**, preserving LLP 0060 D1's
/// property that an unsupported hosted request leaves the target byte-for-byte
/// unchanged. The checks are ordered so that authentication precedes
/// interpretation and every locally derivable fact is re-derived.
///
/// @ref LLP 0098#31-the-ordered-checks — each failure carries its own code so a
/// refusal is reproducible from the code alone.
pub fn verify_admission_envelope_prebind(
    envelope: &HostedAdmissionEnvelope,
    admission_public_key: &[u8],
    facts: &HostedEdgeSelfFacts,
    now_ms: u64,
) -> SnapbackResult<VerifiedHostedAdmission> {
    // 1. Envelope shape: a profile this build does not implement is refused
    //    before its contents mean anything.
    if envelope.profile != HOSTED_EDGE_PROFILE {
        return Err(refuse(
            "SNAPBACK_AUTH_HOSTED_ADMISSION_INVALID",
            "hosted admission names a profile this build does not implement",
        ));
    }

    // 2. Signature, before any field is interpreted.
    envelope.verify_signature(admission_public_key)?;
    match (envelope.renewal, envelope.hosted_target_admission.as_ref()) {
        (AdmissionRenewal::Online, Some(target)) => {
            verify_target_admission(target, &envelope.admission, admission_public_key, now_ms)?;
        }
        (AdmissionRenewal::Online, None) => {
            return Err(refuse(
                "SNAPBACK_HOSTED_ADMISSION_V2_MISSING",
                "online hosted serving requires a signed routed-Machine admission",
            ));
        }
        (AdmissionRenewal::PresignedWindow, Some(_)) => {
            return Err(refuse(
                "SNAPBACK_HOSTED_ADMISSION_V2_INVALID",
                "a routed-Machine admission cannot be attached to a pre-signed edge window",
            ));
        }
        (AdmissionRenewal::PresignedWindow, None) => {}
    }

    // 3. Closed facts (LLP 0060 D5's conjunction, already shipped).
    if !envelope.admission.closed_admission_facts_hold() {
        return Err(refuse(
            "SNAPBACK_AUTH_HOSTED_ADMISSION_INVALID",
            "hosted admission does not satisfy the closed admission facts",
        ));
    }

    // 4. Identity binding: a snapshot signed for a sibling deployment of the
    //    same release is refused.
    if envelope.admission.deployment_id != facts.deployment_id {
        return Err(refuse(
            "SNAPBACK_AUTH_HOSTED_ADMISSION_FOREIGN",
            "hosted admission is bound to a different deployment identity",
        ));
    }

    // 5. Configuration binding: this is the clause that makes a stale snapshot
    //    after a configuration change refuse rather than serve.
    if envelope.admission.configuration_sha256 != facts.configuration_sha256 {
        return Err(refuse(
            "SNAPBACK_AUTH_HOSTED_ADMISSION_STALE_CONFIGURATION",
            "hosted admission is bound to a different serving configuration",
        ));
    }

    // 6. Support binding, including the browser artifact whose direct-bearer
    //    seam exclusion the admission asserts.
    if envelope.admission.support_sha256 != facts.support_sha256 {
        return Err(refuse(
            "SNAPBACK_AUTH_HOSTED_ADMISSION_STALE_SUPPORT",
            "hosted admission is bound to a different support artifact set",
        ));
    }

    // 7. Topology (H1). The one structural fact the origin proves for itself.
    //    Unknown fails closed exactly as a non-loopback bind does.
    if facts.listener_loopback != Some(true) {
        return Err(refuse(
            "SNAPBACK_AUTH_HOSTED_TOPOLOGY_INVALID",
            "hosted serving requires a loopback-bound origin behind an in-namespace terminator",
        ));
    }

    // 8 + 10. Origin canonicality and currency are the shipped
    // `from_authenticated_target` checks. Run them here so a non-canonical or
    // dead envelope is refused pre-bind, and construct the real authority again
    // at install so the two paths cannot drift.
    HostedServingAuthority::from_authenticated_target(
        envelope.public_origin.clone(),
        envelope.admission.clone(),
        now_ms,
        [0u8; 32],
    )?;

    Ok(VerifiedHostedAdmission {
        envelope: envelope.clone(),
        throttle_key: derive_throttle_key(admission_public_key, &envelope.admission),
    })
}

/// Install a pre-bind-verified admission, applying the one clause that needs
/// durable state: monotonicity across restart.
///
/// @ref LLP 0098#31-the-ordered-checks — clause 9. A correctly signed,
/// unexpired, replayed *older* snapshot is refused here, which is the only
/// place it can be refused, because the high-water mark is durable.
pub fn install_verified_admission(
    verified: &VerifiedHostedAdmission,
    now_ms: u64,
    database: &mut crate::storage::LocalDatabase,
) -> SnapbackResult<HostedServingAuthority> {
    let admission = &verified.envelope.admission;
    let mut authority = HostedServingAuthority::from_authenticated_target(
        verified.envelope.public_origin.clone(),
        admission.clone(),
        now_ms,
        verified.throttle_key,
    )?;
    authority.install_hosted_target_admission(verified.envelope.hosted_target_admission.clone());
    database.install_hosted_admission(verified.durable_commit())?;
    Ok(authority)
}

pub fn renew_hosted_admission(
    database: &mut crate::storage::LocalDatabase,
    inputs: &AdmissionRenewalInputs,
    installed_issued_at_ms: u64,
    now_ms: u64,
) -> SnapbackResult<Option<(HostedServingAuthority, u64)>> {
    let Some(verified) = verify_renewal_candidate(inputs, installed_issued_at_ms, now_ms)? else {
        return Ok(None);
    };
    let issued_at_ms = verified.issued_at_ms();
    let authority = install_verified_admission(&verified, now_ms, database)?;
    Ok(Some((authority, issued_at_ms)))
}

/// Derive the shared-throttle bucket key from the release-bound verification
/// key and the admission's limiter epoch.
///
/// The key must rotate with the limiter epoch (so a limiter epoch change cannot
/// let old bucket ids survive) and must not be derivable from anything a
/// request can carry.
fn derive_throttle_key(admission_public_key: &[u8], admission: &HostedAdmission) -> [u8; 32] {
    let mut hasher = Sha256::new();
    for part in [
        b"snapback.hosted-throttle-key.v1".as_slice(),
        admission_public_key,
        admission.deployment_id.as_bytes(),
        &admission.limiter_epoch.to_be_bytes(),
        admission.configuration_sha256.as_bytes(),
    ] {
        hasher.update((part.len() as u64).to_be_bytes());
        hasher.update(part);
    }
    hasher.finalize().into()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::deployment::{
        AuthenticationThrottle, BrowserCredentialPosture, BrowserDirectBearerSeam, EffectiveSource,
        ExternalTls, HostedAuthCapabilities, HostedOperatorSurface, SessionInvalidation,
    };
    use crate::auth::throttle::{AuthenticationBucketPolicy, SharedAuthenticationThrottleConfig};
    use ring::signature::{Ed25519KeyPair, KeyPair};

    const NOW_MS: u64 = 1_750_000_000_000;

    fn control_plane_key() -> Ed25519KeyPair {
        // A fixed seed keeps the fixtures deterministic; this is test material
        // and never a deployment key.
        Ed25519KeyPair::from_seed_unchecked(&[7u8; 32]).expect("test key")
    }

    fn hosted_capabilities() -> HostedAuthCapabilities {
        HostedAuthCapabilities {
            external_tls: ExternalTls::Enforced,
            effective_source: EffectiveSource::Trusted,
            authentication_throttle: AuthenticationThrottle::SharedEnforced,
            session_invalidation: SessionInvalidation::GloballyFenced,
            client_credential_posture: BrowserCredentialPosture::SenderConstrainedV2,
        }
    }

    fn bucket(burst: u64) -> AuthenticationBucketPolicy {
        AuthenticationBucketPolicy {
            interval_ms: 1_000,
            burst,
            maximum_denial_debt_attempts: 32,
        }
    }

    fn throttle_config() -> SharedAuthenticationThrottleConfig {
        SharedAuthenticationThrottleConfig {
            retention_ms: 600_000,
            maximum_key_count: 100_000,
            global: bucket(100),
            source: bucket(20),
            subject: bucket(10),
            source_subject: bucket(5),
            family: bucket(5),
        }
    }

    fn admission(public_key: &[u8]) -> HostedAdmission {
        HostedAdmission {
            version: 1,
            deployment_id: "deployment-alpha".to_string(),
            configuration_sha256: configuration_digest(
                HOSTED_EDGE_PROFILE,
                "https://app.example.test",
                FirstContactTransport::HstsPreloadedSuffix,
                true,
                true,
                public_key,
            ),
            support_sha256: "b".repeat(64),
            admission_epoch: 4,
            issued_at_ms: NOW_MS,
            expires_at_ms: NOW_MS + 60_000,
            limiter_epoch: 2,
            authentication_throttle_config: throttle_config(),
            invalidation_epoch: 3,
            sender_replay_epoch_floor: 9,
            handler_protocol_version: 1,
            handler_incarnation: "incarnation-1".to_string(),
            operator_surface: HostedOperatorSurface::Disabled,
            browser_direct_bearer_seam: BrowserDirectBearerSeam::Excluded,
            hosted_auth: hosted_capabilities(),
        }
    }

    fn sign(key: &Ed25519KeyPair, envelope: &mut HostedAdmissionEnvelope) {
        let input = admission_signing_input(
            &envelope.profile,
            &envelope.public_origin,
            envelope.first_contact_transport,
            envelope.renewal,
            &envelope.admission,
        )
        .expect("signing input");
        envelope.signature = URL_SAFE_NO_PAD.encode(key.sign(&input).as_ref());
    }

    fn sign_target(key: &Ed25519KeyPair, target: &mut HostedAdmissionV2) {
        target.signature =
            URL_SAFE_NO_PAD.encode(key.sign(&target_admission_signing_input(target)).as_ref());
    }

    fn envelope(key: &Ed25519KeyPair) -> HostedAdmissionEnvelope {
        let public_key = key.public_key().as_ref().to_vec();
        let mut envelope = HostedAdmissionEnvelope {
            profile: HOSTED_EDGE_PROFILE.to_string(),
            public_origin: "https://app.example.test".to_string(),
            first_contact_transport: FirstContactTransport::HstsPreloadedSuffix,
            renewal: AdmissionRenewal::PresignedWindow,
            admission: admission(&public_key),
            hosted_target_admission: None,
            signature: String::new(),
        };
        sign(key, &mut envelope);
        envelope
    }

    fn online_envelope(key: &Ed25519KeyPair) -> HostedAdmissionEnvelope {
        let mut envelope = envelope(key);
        envelope.renewal = AdmissionRenewal::Online;
        let mut target = HostedAdmissionV2 {
            schema_version: HostedAdmissionV2Version::V2,
            target_id: "target-1".to_string(),
            deployment_id: envelope.admission.deployment_id.clone(),
            binding_generation: 3,
            target_binding_sha256: format!("sha256:{}", "c".repeat(64)),
            control_head_sha256: format!("sha256:{}", "d".repeat(64)),
            supervisor_incarnation: "supervisor-1".to_string(),
            exact_roster_sha256: format!("sha256:{}", "e".repeat(64)),
            routed_machine_id: "machine-1".to_string(),
            hosted_auth_expires_at_ms: envelope.admission.expires_at_ms,
            routed_machine_expires_at_ms: envelope.admission.expires_at_ms,
            replay_floor: envelope.admission.sender_replay_epoch_floor,
            admission_generation: envelope.admission.admission_epoch,
            issued_at_ms: envelope.admission.issued_at_ms,
            signature: String::new(),
        };
        sign_target(key, &mut target);
        envelope.hosted_target_admission = Some(target);
        sign(key, &mut envelope);
        envelope
    }

    fn self_facts(key: &Ed25519KeyPair) -> HostedEdgeSelfFacts {
        let public_key = key.public_key().as_ref().to_vec();
        HostedEdgeSelfFacts {
            deployment_id: "deployment-alpha".to_string(),
            configuration_sha256: configuration_digest(
                HOSTED_EDGE_PROFILE,
                "https://app.example.test",
                FirstContactTransport::HstsPreloadedSuffix,
                true,
                true,
                &public_key,
            ),
            support_sha256: "b".repeat(64),
            listener_loopback: Some(true),
        }
    }

    fn connection() -> crate::storage::LocalDatabase {
        crate::storage::LocalDatabase::memory().expect("memory database")
    }

    fn verify(
        envelope: &HostedAdmissionEnvelope,
        key: &Ed25519KeyPair,
        facts: &HostedEdgeSelfFacts,
        connection: &mut crate::storage::LocalDatabase,
    ) -> SnapbackResult<HostedServingAuthority> {
        let verified = verify_admission_envelope_prebind(
            envelope,
            key.public_key().as_ref(),
            facts,
            NOW_MS + 1_000,
        )?;
        install_verified_admission(&verified, NOW_MS + 1_000, connection)
    }

    fn code(error: SnapbackError) -> String {
        error.diagnostic.code.clone()
    }

    // A1
    #[test]
    fn a1_valid_envelope_installs() {
        let key = control_plane_key();
        let mut connection = connection();
        verify(&envelope(&key), &key, &self_facts(&key), &mut connection)
            .expect("valid envelope installs");
    }

    #[test]
    fn online_admission_requires_and_verifies_v2_target_authority() {
        let key = control_plane_key();
        let facts = self_facts(&key);
        let candidate = online_envelope(&key);
        verify_admission_envelope_prebind(
            &candidate,
            key.public_key().as_ref(),
            &facts,
            NOW_MS + 1_000,
        )
        .expect("signed V2 target authority passes");

        let mut missing = candidate.clone();
        missing.hosted_target_admission = None;
        sign(&key, &mut missing);
        assert_eq!(
            code(
                verify_admission_envelope_prebind(
                    &missing,
                    key.public_key().as_ref(),
                    &facts,
                    NOW_MS + 1_000,
                )
                .unwrap_err(),
            ),
            "SNAPBACK_HOSTED_ADMISSION_V2_MISSING",
        );

        let mut tampered = candidate.clone();
        tampered
            .hosted_target_admission
            .as_mut()
            .expect("target")
            .routed_machine_id = "machine-other".to_string();
        assert_eq!(
            code(
                verify_admission_envelope_prebind(
                    &tampered,
                    key.public_key().as_ref(),
                    &facts,
                    NOW_MS + 1_000,
                )
                .unwrap_err(),
            ),
            "SNAPBACK_HOSTED_ADMISSION_V2_UNAUTHENTICATED",
        );

        let mut stale = candidate.clone();
        stale.admission.expires_at_ms = NOW_MS;
        stale
            .hosted_target_admission
            .as_mut()
            .expect("target")
            .hosted_auth_expires_at_ms = NOW_MS;
        stale
            .hosted_target_admission
            .as_mut()
            .expect("target")
            .routed_machine_expires_at_ms = NOW_MS;
        sign_target(
            &key,
            stale.hosted_target_admission.as_mut().expect("target"),
        );
        sign(&key, &mut stale);
        assert_eq!(
            code(
                verify_admission_envelope_prebind(
                    &stale,
                    key.public_key().as_ref(),
                    &facts,
                    NOW_MS + 1_000,
                )
                .unwrap_err(),
            ),
            "SNAPBACK_HOSTED_ADMISSION_V2_STALE",
        );

        let mut oversized = candidate;
        oversized
            .hosted_target_admission
            .as_mut()
            .expect("target")
            .binding_generation = HOSTED_ADMISSION_MAX_SAFE_INTEGER + 1;
        sign_target(
            &key,
            oversized.hosted_target_admission.as_mut().expect("target"),
        );
        assert_eq!(
            code(
                verify_admission_envelope_prebind(
                    &oversized,
                    key.public_key().as_ref(),
                    &facts,
                    NOW_MS + 1_000,
                )
                .unwrap_err(),
            ),
            "SNAPBACK_HOSTED_ADMISSION_V2_INVALID",
        );
    }

    // A2
    #[test]
    fn a2_signature_by_a_non_release_key_is_unauthenticated() {
        let key = control_plane_key();
        let foreign = Ed25519KeyPair::from_seed_unchecked(&[9u8; 32]).expect("foreign key");
        let mut candidate = envelope(&key);
        // Sign with the foreign key while the deployment still verifies against
        // the release-bound one.
        sign(&foreign, &mut candidate);
        let mut connection = connection();
        assert_eq!(
            code(verify(&candidate, &key, &self_facts(&key), &mut connection).unwrap_err()),
            "SNAPBACK_AUTH_HOSTED_ADMISSION_UNAUTHENTICATED"
        );
    }

    // A3
    #[test]
    fn a3_one_flipped_byte_after_signing_is_unauthenticated() {
        let key = control_plane_key();
        let mut candidate = envelope(&key);
        candidate.admission.admission_epoch += 1;
        let mut connection = connection();
        assert_eq!(
            code(verify(&candidate, &key, &self_facts(&key), &mut connection).unwrap_err()),
            "SNAPBACK_AUTH_HOSTED_ADMISSION_UNAUTHENTICATED"
        );
    }

    // A4 — the boundary-shift the length prefixes exist to stop.
    #[test]
    fn a4_boundary_shift_between_adjacent_fields_is_unauthenticated() {
        let key = control_plane_key();
        let public_key = key.public_key().as_ref().to_vec();
        let mut candidate = envelope(&key);
        // Move one character across the origin/first-contact boundary. Without
        // length prefixing the concatenations would be identical and the
        // signature would still verify over a different origin.
        candidate.public_origin = "https://app.example.tes".to_string();
        let mut facts = self_facts(&key);
        facts.configuration_sha256 = configuration_digest(
            HOSTED_EDGE_PROFILE,
            "https://app.example.tes",
            FirstContactTransport::HstsPreloadedSuffix,
            true,
            true,
            &public_key,
        );
        let mut connection = connection();
        assert_eq!(
            code(verify(&candidate, &key, &facts, &mut connection).unwrap_err()),
            "SNAPBACK_AUTH_HOSTED_ADMISSION_UNAUTHENTICATED"
        );
    }

    // A5
    #[test]
    fn a5_unknown_member_anywhere_is_rejected_by_the_closed_schema() {
        let value = serde_json::json!({
            "profile": HOSTED_EDGE_PROFILE,
            "publicOrigin": "https://app.example.test",
            "firstContactTransport": "hstsPreloadedSuffix",
            "renewal": "presignedWindow",
            "admission": {},
            "signature": "AAAA",
            "extra": true,
        });
        assert!(serde_json::from_value::<HostedAdmissionEnvelope>(value).is_err());
    }

    // A6
    #[test]
    fn a6_a_sibling_deployment_identity_is_foreign() {
        let key = control_plane_key();
        let mut candidate = envelope(&key);
        candidate.admission.deployment_id = "deployment-beta".to_string();
        sign(&key, &mut candidate);
        let mut connection = connection();
        assert_eq!(
            code(verify(&candidate, &key, &self_facts(&key), &mut connection).unwrap_err()),
            "SNAPBACK_AUTH_HOSTED_ADMISSION_FOREIGN"
        );
    }

    // A7
    #[test]
    fn a7_a_previous_configuration_digest_is_stale() {
        let key = control_plane_key();
        let mut candidate = envelope(&key);
        candidate.admission.configuration_sha256 = "c".repeat(64);
        sign(&key, &mut candidate);
        let mut connection = connection();
        assert_eq!(
            code(verify(&candidate, &key, &self_facts(&key), &mut connection).unwrap_err()),
            "SNAPBACK_AUTH_HOSTED_ADMISSION_STALE_CONFIGURATION"
        );
    }

    // A8
    #[test]
    fn a8_a_different_support_artifact_set_is_stale() {
        let key = control_plane_key();
        let mut candidate = envelope(&key);
        candidate.admission.support_sha256 = "d".repeat(64);
        sign(&key, &mut candidate);
        let mut connection = connection();
        assert_eq!(
            code(verify(&candidate, &key, &self_facts(&key), &mut connection).unwrap_err()),
            "SNAPBACK_AUTH_HOSTED_ADMISSION_STALE_SUPPORT"
        );
    }

    // A9 — a correctly signed, unexpired, older snapshot is still refused.
    #[test]
    fn a9_an_epoch_below_the_durable_watermark_is_rolled_back() {
        let key = control_plane_key();
        let facts = self_facts(&key);
        let mut connection = connection();
        verify(&envelope(&key), &key, &facts, &mut connection).expect("first install");

        let mut older = envelope(&key);
        older.admission.admission_epoch = 3;
        sign(&key, &mut older);
        assert_eq!(
            code(verify(&older, &key, &facts, &mut connection).unwrap_err()),
            "SNAPBACK_AUTH_HOSTED_ADMISSION_ROLLED_BACK"
        );
    }

    // A10 — the LLP 0077 decision-1 anti-rollback floor never decreases.
    #[test]
    fn a10_a_lowered_sender_replay_epoch_floor_is_rolled_back() {
        let key = control_plane_key();
        let facts = self_facts(&key);
        let mut connection = connection();
        verify(&envelope(&key), &key, &facts, &mut connection).expect("first install");

        let mut lowered = envelope(&key);
        lowered.admission.admission_epoch = 5;
        lowered.admission.sender_replay_epoch_floor = 8;
        sign(&key, &mut lowered);
        assert_eq!(
            code(verify(&lowered, &key, &facts, &mut connection).unwrap_err()),
            "SNAPBACK_AUTH_HOSTED_ADMISSION_ROLLED_BACK"
        );
    }

    // A11
    #[test]
    fn a11_a_lifetime_over_five_minutes_is_invalid() {
        let key = control_plane_key();
        let mut candidate = envelope(&key);
        candidate.admission.expires_at_ms = candidate.admission.issued_at_ms + 5 * 60 * 1_000 + 1;
        sign(&key, &mut candidate);
        let mut connection = connection();
        assert_eq!(
            code(verify(&candidate, &key, &self_facts(&key), &mut connection).unwrap_err()),
            "SNAPBACK_AUTH_HOSTED_ADMISSION_INVALID"
        );
    }

    // A12
    #[test]
    fn a12_one_millisecond_past_expiry_is_expired() {
        let key = control_plane_key();
        let candidate = envelope(&key);
        let mut connection = connection();
        let _ = &mut connection;
        let expired = verify_admission_envelope_prebind(
            &candidate,
            key.public_key().as_ref(),
            &self_facts(&key),
            candidate.admission.expires_at_ms + 1,
        )
        .unwrap_err();
        assert_eq!(code(expired), "SNAPBACK_AUTH_HOSTED_ADMISSION_INVALID");
    }

    // A13
    #[test]
    fn a13_an_epoch_above_the_javascript_ceiling_is_invalid() {
        let key = control_plane_key();
        let mut candidate = envelope(&key);
        candidate.admission.admission_epoch = 9_007_199_254_740_992;
        sign(&key, &mut candidate);
        let mut connection = connection();
        assert_eq!(
            code(verify(&candidate, &key, &self_facts(&key), &mut connection).unwrap_err()),
            "SNAPBACK_AUTH_HOSTED_ADMISSION_INVALID"
        );
    }

    // A14 — the first hosted profile is `disabled`; an exposed operator
    // surface on the application origin is refused (LLP 0060 C2).
    #[test]
    fn a14_an_enabled_operator_surface_is_invalid() {
        let key = control_plane_key();
        let mut candidate = envelope(&key);
        candidate.admission.operator_surface = HostedOperatorSurface::Enabled;
        sign(&key, &mut candidate);
        let mut connection = connection();
        assert_eq!(
            code(verify(&candidate, &key, &self_facts(&key), &mut connection).unwrap_err()),
            "SNAPBACK_AUTH_HOSTED_ADMISSION_INVALID"
        );
    }

    // A16
    #[test]
    fn a16_a_tuple_one_axis_short_is_invalid() {
        let key = control_plane_key();
        let mut candidate = envelope(&key);
        candidate.admission.hosted_auth.client_credential_posture =
            BrowserCredentialPosture::BearerV1XssExposed;
        sign(&key, &mut candidate);
        let mut connection = connection();
        assert_eq!(
            code(verify(&candidate, &key, &self_facts(&key), &mut connection).unwrap_err()),
            "SNAPBACK_AUTH_HOSTED_ADMISSION_INVALID"
        );
    }

    // A18 — a refusal must not hand back the value the caller failed to guess.
    #[test]
    fn a18_refusals_never_disclose_the_expected_digests() {
        let key = control_plane_key();
        let facts = self_facts(&key);
        let mut candidate = envelope(&key);
        candidate.admission.configuration_sha256 = "c".repeat(64);
        sign(&key, &mut candidate);
        let mut connection = connection();
        let error = verify(&candidate, &key, &facts, &mut connection).unwrap_err();
        let rendered = format!("{error:?}");
        assert!(!rendered.contains(&facts.configuration_sha256));
        assert!(!rendered.contains(&facts.support_sha256));
        assert!(!rendered.contains(&facts.deployment_id));
    }

    // T1
    #[test]
    fn t1_a_non_loopback_origin_refuses_hosted_topology() {
        let key = control_plane_key();
        let mut facts = self_facts(&key);
        facts.listener_loopback = Some(false);
        let mut connection = connection();
        assert_eq!(
            code(verify(&envelope(&key), &key, &facts, &mut connection).unwrap_err()),
            "SNAPBACK_AUTH_HOSTED_TOPOLOGY_INVALID"
        );
    }

    // T2 — an unknown posture fails closed exactly as a routable bind does.
    #[test]
    fn t2_an_unknown_listener_posture_refuses_hosted_topology() {
        let key = control_plane_key();
        let mut facts = self_facts(&key);
        facts.listener_loopback = None;
        let mut connection = connection();
        assert_eq!(
            code(verify(&envelope(&key), &key, &facts, &mut connection).unwrap_err()),
            "SNAPBACK_AUTH_HOSTED_TOPOLOGY_INVALID"
        );
    }

    #[test]
    fn an_unimplemented_profile_is_refused_before_its_contents_matter() {
        let key = control_plane_key();
        let mut candidate = envelope(&key);
        candidate.profile = "replicated-edge.v9".to_string();
        sign(&key, &mut candidate);
        let mut connection = connection();
        assert_eq!(
            code(verify(&candidate, &key, &self_facts(&key), &mut connection).unwrap_err()),
            "SNAPBACK_AUTH_HOSTED_ADMISSION_INVALID"
        );
    }

    #[test]
    fn the_configuration_digest_binds_the_verification_key() {
        let key = control_plane_key();
        let other = Ed25519KeyPair::from_seed_unchecked(&[3u8; 32]).expect("other key");
        let base = configuration_digest(
            HOSTED_EDGE_PROFILE,
            "https://app.example.test",
            FirstContactTransport::HstsPreloadedSuffix,
            true,
            true,
            key.public_key().as_ref(),
        );
        let rotated = configuration_digest(
            HOSTED_EDGE_PROFILE,
            "https://app.example.test",
            FirstContactTransport::HstsPreloadedSuffix,
            true,
            true,
            other.public_key().as_ref(),
        );
        assert_ne!(base, rotated, "rotating the key must change the digest");
    }

    /// Renewal must compose with withdrawal, never suppress it. When the
    /// document stops covering the clock the loop installs nothing, so the
    /// incumbent expires on its own terms.
    ///
    /// @ref LLP 0098#24-renewal-and-the-honest-cost-of-pre-signing
    #[test]
    fn renewal_installs_nothing_once_the_chain_stops_covering_the_clock() {
        let key = control_plane_key();
        let facts = self_facts(&key);
        let first = envelope(&key);
        let chain = serde_json::to_vec(&vec![first.clone()]).expect("chain");
        let directory = tempfile::tempdir().expect("tempdir");
        let path = directory.path().join("admission.json");
        std::fs::write(&path, &chain).expect("write chain");

        let inputs = AdmissionRenewalInputs {
            document_path: path,
            admission_public_key: key.public_key().as_ref().to_vec(),
            facts,
        };

        // Inside the window, the incumbent is still current: nothing to do.
        let inside = verify_renewal_candidate(
            &inputs,
            first.admission.issued_at_ms,
            first.admission.issued_at_ms + 1_000,
        )
        .expect("in-window renewal check");
        assert!(inside.is_none(), "the incumbent must not be reinstalled");

        // Past the end of the chain there is no successor, so the loop installs
        // nothing and the incumbent is left to expire. Renewal cannot extend a
        // snapshot, only replace it with another verified one.
        let exhausted = verify_renewal_candidate(
            &inputs,
            first.admission.issued_at_ms,
            first.admission.expires_at_ms + 1,
        )
        .expect_err("an exhausted chain yields no successor");
        assert_eq!(
            code(exhausted),
            "SNAPBACK_AUTH_HOSTED_ADMISSION_EXPIRED",
            "an exhausted chain must not silently keep serving"
        );
    }

    /// A successor is verified through the identical conjunction: renewal is
    /// not a cheaper trust path than the first install.
    #[test]
    fn a_renewal_successor_runs_the_full_conjunction() {
        let key = control_plane_key();
        let foreign = Ed25519KeyPair::from_seed_unchecked(&[11u8; 32]).expect("foreign key");
        let first = envelope(&key);

        // A successor signed by the wrong key, otherwise perfectly formed.
        let mut successor = envelope(&key);
        successor.admission.issued_at_ms = first.admission.expires_at_ms;
        successor.admission.expires_at_ms = first.admission.expires_at_ms + 60_000;
        sign(&foreign, &mut successor);

        let chain = serde_json::to_vec(&vec![first.clone(), successor.clone()]).expect("chain");
        let directory = tempfile::tempdir().expect("tempdir");
        let path = directory.path().join("admission.json");
        std::fs::write(&path, &chain).expect("write chain");

        let inputs = AdmissionRenewalInputs {
            document_path: path,
            admission_public_key: key.public_key().as_ref().to_vec(),
            facts: self_facts(&key),
        };

        let refused = verify_renewal_candidate(
            &inputs,
            first.admission.issued_at_ms,
            successor.admission.issued_at_ms + 1_000,
        )
        .expect_err("a forged successor must be refused");
        assert_eq!(
            code(refused),
            "SNAPBACK_AUTH_HOSTED_ADMISSION_UNAUTHENTICATED"
        );
    }

    #[test]
    fn an_install_time_binding_makes_no_browser_facing_claim() {
        assert!(!FirstContactTransport::InstallTimeHttpsOnlyBinding.permits_browser_facing_claim());
        assert!(FirstContactTransport::HstsPreloadedHost.permits_browser_facing_claim());
        assert!(FirstContactTransport::HstsPreloadedSuffix.permits_browser_facing_claim());
    }
}
