//! Control-plane admission signer for the LLP 0098 hosted-edge adapter.
//!
//! This tool is the **control plane**, and it runs off the deployment. It holds
//! the Ed25519 private half that never enters a served machine; the deployment
//! carries only the public half, bound into its release artifact.
//!
//! Two operations:
//!   keygen                        — mint a control-plane keypair
//!   mint --seed … --config … …    — sign one admission snapshot (or a chain)
//!
//! @ref LLP 0098#2-producing-an-admission-the-control-plane-contract

use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use ring::signature::{Ed25519KeyPair, KeyPair};
use snapback::auth::deployment::{
    AuthenticationThrottle, BrowserCredentialPosture, BrowserDirectBearerSeam, EffectiveSource,
    ExternalTls, HostedAdmission, HostedAuthCapabilities, HostedOperatorSurface,
    SessionInvalidation,
};
use snapback::auth::hosted_edge::{
    AdmissionRenewal, AuthenticationBucketPolicy, HOSTED_EDGE_PROFILE, HostedAdmissionEnvelope,
    HostedEdgeConfig, SharedAuthenticationThrottleConfig, admission_signing_input,
    configuration_digest,
};

fn argument(name: &str) -> Option<String> {
    let mut args = std::env::args();
    while let Some(arg) = args.next() {
        if arg == name {
            return args.next();
        }
    }
    None
}

fn require(name: &str) -> String {
    argument(name).unwrap_or_else(|| {
        eprintln!("missing required argument {name}");
        std::process::exit(2);
    })
}

fn bucket(burst: u64) -> AuthenticationBucketPolicy {
    AuthenticationBucketPolicy {
        interval_ms: 1_000,
        burst,
        maximum_denial_debt_attempts: 64,
    }
}

fn main() {
    let mode = std::env::args().nth(1).unwrap_or_default();
    match mode.as_str() {
        "keygen" => keygen(),
        "mint" => mint(),
        _ => {
            eprintln!("usage: snapback-hosted-admission <keygen|mint> [...]");
            std::process::exit(2);
        }
    }
}

fn keygen() {
    let mut seed = [0u8; 32];
    getrandom::fill(&mut seed).expect("system entropy");
    let key = Ed25519KeyPair::from_seed_unchecked(&seed).expect("valid seed");
    // The seed is the control plane's private half. It is printed once, for the
    // operator to place in their own credential store, and must never be
    // copied into the deployment, a receipt, a log, or a commit.
    println!(
        "{}",
        serde_json::json!({
            "privateSeed": URL_SAFE_NO_PAD.encode(seed),
            "admissionPublicKey": URL_SAFE_NO_PAD.encode(key.public_key().as_ref()),
        })
    );
}

fn mint() {
    let seed = URL_SAFE_NO_PAD
        .decode(require("--seed"))
        .expect("seed is canonical base64url");
    let key = Ed25519KeyPair::from_seed_unchecked(&seed).expect("valid seed");

    let config_bytes = std::fs::read(require("--config")).expect("adapter configuration");
    let config = HostedEdgeConfig::parse(&config_bytes).expect("valid adapter configuration");
    let public_key = config
        .admission_public_key_bytes()
        .expect("configured admission key");
    assert_eq!(
        public_key,
        key.public_key().as_ref(),
        "the adapter configuration names a different verification key than this seed"
    );

    let admission_epoch: u64 = require("--admission-epoch").parse().expect("integer epoch");
    let sender_replay_epoch_floor: u64 = argument("--sender-replay-epoch-floor")
        .unwrap_or_else(|| "1".to_string())
        .parse()
        .expect("integer floor");
    // Number of consecutive snapshots to pre-sign. Online renewal is owned
    // by the provider-authenticated supervisor because it must also carry a
    // fresh HostedAdmissionV2; this offline tool always emits presigned
    // windows, including a one-element window.
    let chain: u64 = argument("--chain")
        .unwrap_or_else(|| "1".to_string())
        .parse()
        .expect("integer chain length");
    let lifetime_ms: u64 = argument("--lifetime-ms")
        .unwrap_or_else(|| (5 * 60 * 1_000).to_string())
        .parse()
        .expect("integer lifetime");
    let renewal = AdmissionRenewal::PresignedWindow;

    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis() as u64;
    let start_ms: u64 = argument("--issued-at-ms")
        .map(|value| value.parse().expect("integer issuedAt"))
        .unwrap_or(now_ms);

    let configuration_sha256 = configuration_digest(
        HOSTED_EDGE_PROFILE,
        &config.public_origin,
        config.first_contact_transport,
        true,
        true,
        &public_key,
    );

    let capabilities = HostedAuthCapabilities {
        external_tls: ExternalTls::Enforced,
        effective_source: EffectiveSource::Trusted,
        authentication_throttle: AuthenticationThrottle::SharedEnforced,
        session_invalidation: SessionInvalidation::GloballyFenced,
        client_credential_posture: BrowserCredentialPosture::SenderConstrainedV2,
    };

    let throttle = SharedAuthenticationThrottleConfig {
        retention_ms: 600_000,
        maximum_key_count: 100_000,
        global: bucket(2_000),
        source: bucket(600),
        subject: bucket(300),
        source_subject: bucket(200),
        family: bucket(300),
    };

    let mut envelopes = Vec::new();
    for index in 0..chain {
        let issued_at_ms = start_ms + index * lifetime_ms;
        let admission = HostedAdmission {
            version: 1,
            deployment_id: config.deployment_id.clone(),
            configuration_sha256: configuration_sha256.clone(),
            support_sha256: config.support_sha256.clone(),
            admission_epoch,
            issued_at_ms,
            expires_at_ms: issued_at_ms + lifetime_ms,
            limiter_epoch: admission_epoch,
            authentication_throttle_config: throttle.clone(),
            invalidation_epoch: admission_epoch,
            sender_replay_epoch_floor,
            handler_protocol_version: 1,
            handler_incarnation: format!("incarnation-{admission_epoch}"),
            operator_surface: HostedOperatorSurface::Disabled,
            browser_direct_bearer_seam: BrowserDirectBearerSeam::Excluded,
            hosted_auth: capabilities,
        };
        let input = admission_signing_input(
            HOSTED_EDGE_PROFILE,
            &config.public_origin,
            config.first_contact_transport,
            renewal,
            &admission,
        )
        .expect("signing input");
        envelopes.push(HostedAdmissionEnvelope {
            profile: HOSTED_EDGE_PROFILE.to_string(),
            public_origin: config.public_origin.clone(),
            first_contact_transport: config.first_contact_transport,
            renewal,
            admission,
            hosted_target_admission: None,
            signature: URL_SAFE_NO_PAD.encode(key.sign(&input).as_ref()),
        });
    }

    if chain == 1 {
        println!(
            "{}",
            serde_json::to_string_pretty(&envelopes[0]).expect("envelope")
        );
    } else {
        println!(
            "{}",
            serde_json::to_string_pretty(&envelopes).expect("envelope chain")
        );
    }
}
