//! Reusable, bounded outbound webhook delivery.
//!
//! This module owns target validation, DNS pinning, signing, and transport
//! classification. Durable state and retry scheduling deliberately live in
//! the storage ledger and LLP 0070 jobs machinery respectively.

use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::outbound_policy::{
    HttpTargetPolicy, PrepareTargetError, PrepareTargetErrorKind, PreparedHttpTarget,
    pinned_http_agent, prepare_http_target_with,
};
use hmac::{Hmac, Mac as _};
use sha2::{Digest, Sha256};
use std::io;
use std::net::{SocketAddr, ToSocketAddrs};
use std::time::Duration;

pub(crate) const MAX_TARGET_BYTES: usize = 2_048;
pub(crate) const MAX_IDEMPOTENCY_KEY_BYTES: usize = 256;
pub(crate) const MAX_PAYLOAD_BYTES: usize = 256 * 1_024;
pub(crate) const DELIVERY_TIMEOUT: Duration = Duration::from_secs(15);
pub(crate) const SIGNATURE_HEADER: &str = "X-Snapback-Signature";
pub(crate) const DELIVERY_HEADER: &str = "X-Snapback-Delivery-Id";

pub(crate) type PreparedTarget = PreparedHttpTarget;

#[derive(Clone, Eq, PartialEq)]
pub(crate) struct DeliveryRequest {
    pub(crate) delivery_id: String,
    pub(crate) idempotency_key: String,
    pub(crate) target: PreparedTarget,
    pub(crate) canonical_payload: String,
    pub(crate) signing_secret: String,
}

impl std::fmt::Debug for DeliveryRequest {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("DeliveryRequest")
            .field("delivery_id", &self.delivery_id)
            .field("idempotency_key", &self.idempotency_key)
            .field("target", &self.target)
            .field("canonical_payload", &self.canonical_payload)
            .field("signing_secret", &"[REDACTED]")
            .finish()
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum DeliveryOutcome {
    Succeeded { http_status: u16 },
    Retryable { code: &'static str, http_status: Option<u16> },
    Permanent { code: &'static str, http_status: Option<u16> },
}

impl DeliveryOutcome {
    pub(crate) fn into_error(self) -> SnapbackError {
        let code = match self {
            Self::Succeeded { .. } => "SNAPBACK_WEBHOOK_DELIVERY_INVALID",
            Self::Retryable { code, .. } | Self::Permanent { code, .. } => code,
        };
        SnapbackError::error(code, "webhooks", "webhook delivery was refused")
    }
}

/// Resolve once, reject every non-public answer, and return the exact address
/// set the transport must use. The custom ureq resolver below prevents a
/// second DNS lookup from creating a validation/connect TOCTOU.
///
/// @ref LLP 0070#webhook-work — HTTPS, public-address resolution,
/// redirect refusal, stable idempotency, and bounded transport are one host
/// primitive rather than conventions left to consumers.
pub(crate) fn prepare_target(url: &str) -> SnapbackResult<PreparedTarget> {
    prepare_target_with(url, false, |netloc| {
        netloc.to_socket_addrs().map(Iterator::collect)
    })
}

fn prepare_target_with<F>(
    url: &str,
    allow_test_loopback_http: bool,
    resolve: F,
) -> SnapbackResult<PreparedTarget>
where
    F: FnOnce(&str) -> io::Result<Vec<SocketAddr>>,
{
    let policy = if allow_test_loopback_http {
        HttpTargetPolicy::LocalDevLoopbackHttp
    } else {
        HttpTargetPolicy::PublicHttpsOnly
    };
    prepare_http_target_with(url, policy, MAX_TARGET_BYTES, resolve)
        .map_err(webhook_target_error)
}

pub(crate) fn signature(secret: &str, canonical_payload: &str) -> String {
    let mut mac = <Hmac<Sha256> as hmac::Mac>::new_from_slice(secret.as_bytes())
        .expect("HMAC accepts every key length");
    mac.update(canonical_payload.as_bytes());
    format!("sha256={:x}", mac.finalize().into_bytes())
}

pub(crate) fn payload_digest(canonical_payload: &str) -> String {
    format!("sha256:{:x}", Sha256::digest(canonical_payload.as_bytes()))
}

pub(crate) fn deliver(request: DeliveryRequest) -> DeliveryOutcome {
    if request.idempotency_key.is_empty()
        || request.idempotency_key.len() > MAX_IDEMPOTENCY_KEY_BYTES
        || request.idempotency_key.contains(['\r', '\n'])
        || request.canonical_payload.len() > MAX_PAYLOAD_BYTES
    {
        return DeliveryOutcome::Permanent {
            code: "SNAPBACK_WEBHOOK_DELIVERY_INVALID",
            http_status: None,
        };
    }
    let agent = match pinned_http_agent(&request.target, DELIVERY_TIMEOUT) {
        Ok(agent) => agent,
        Err(_) => {
            return DeliveryOutcome::Permanent {
                code: "SNAPBACK_WEBHOOK_SSRF_REFUSED",
                http_status: None,
            };
        }
    };
    let signature = signature(&request.signing_secret, &request.canonical_payload);
    let response = agent
        .post(request.target.authored_url())
        .set("Content-Type", "application/json")
        .set("Idempotency-Key", &request.idempotency_key)
        .set(DELIVERY_HEADER, &request.delivery_id)
        .set(SIGNATURE_HEADER, &signature)
        .send_string(&request.canonical_payload);
    let status = match response {
        Ok(response) => response.status(),
        Err(ureq::Error::Status(status, _)) => status,
        Err(ureq::Error::Transport(_)) => {
            return DeliveryOutcome::Retryable {
                code: "SNAPBACK_WEBHOOK_DELIVERY_RETRYABLE",
                http_status: None,
            };
        }
    };
    match status {
        200..=299 => DeliveryOutcome::Succeeded { http_status: status },
        408 | 425 | 429 | 500..=599 => DeliveryOutcome::Retryable {
            code: "SNAPBACK_WEBHOOK_DELIVERY_RETRYABLE",
            http_status: Some(status),
        },
        _ => DeliveryOutcome::Permanent {
            code: "SNAPBACK_WEBHOOK_DELIVERY_REJECTED",
            http_status: Some(status),
        },
    }
}

fn target_invalid() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_WEBHOOK_TARGET_INVALID",
        "webhooks",
        "webhook targets must be bounded credential-free HTTPS URLs",
    )
}

fn ssrf_refused() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_WEBHOOK_SSRF_REFUSED",
        "webhooks",
        "webhook target resolution includes a non-public address",
    )
}

fn target_unavailable() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_WEBHOOK_TARGET_UNAVAILABLE",
        "webhooks",
        "webhook target DNS resolution is temporarily unavailable",
    )
}

fn webhook_target_error(error: PrepareTargetError) -> SnapbackError {
    match error.kind() {
        PrepareTargetErrorKind::Invalid => target_invalid(),
        PrepareTargetErrorKind::SsrfRefused => ssrf_refused(),
        PrepareTargetErrorKind::Unavailable => target_unavailable(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

    #[test]
    fn ssrf_policy_revalidates_every_dns_answer() {
        for ip in [
            IpAddr::V4(Ipv4Addr::LOCALHOST),
            IpAddr::V4(Ipv4Addr::new(10, 1, 2, 3)),
            IpAddr::V4(Ipv4Addr::new(169, 254, 169, 254)),
            IpAddr::V6(Ipv6Addr::LOCALHOST),
            "fe80::1".parse().unwrap(),
        ] {
            let error = prepare_target_with("https://example.test/hook", false, |_| {
                Ok(vec![SocketAddr::new(ip, 443)])
            })
            .unwrap_err();
            assert_eq!(error.diagnostic.code, "SNAPBACK_WEBHOOK_SSRF_REFUSED");
        }
        let error = prepare_target_with("https://example.test/hook", false, |_| {
            Ok(vec![
                "93.184.216.34:443".parse().unwrap(),
                "127.0.0.1:443".parse().unwrap(),
            ])
        })
        .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_WEBHOOK_SSRF_REFUSED");
    }

    #[test]
    fn http_is_test_loopback_only_and_signature_verifies() {
        assert!(prepare_target_with("http://example.test/hook", false, |_| {
            Ok(vec!["127.0.0.1:80".parse().unwrap()])
        }).is_err());
        assert!(prepare_target_with("http://example.test/hook", true, |_| {
            Ok(vec!["127.0.0.1:80".parse().unwrap()])
        }).is_ok());
        let payload = r#"{"event":"watch.fired","ordinal":1}"#;
        let actual = signature("receiver-secret", payload);
        let mut verifier = <Hmac<Sha256> as hmac::Mac>::new_from_slice(b"receiver-secret").unwrap();
        verifier.update(payload.as_bytes());
        let expected = format!("sha256={:x}", verifier.finalize().into_bytes());
        assert_eq!(actual, expected);
        assert!(!actual.contains("receiver-secret"));

        let request = DeliveryRequest {
            delivery_id: "delivery-1".to_owned(),
            idempotency_key: "logical-event-1".to_owned(),
            target: prepare_target_with("http://example.test/hook", true, |_| {
                Ok(vec!["127.0.0.1:80".parse().unwrap()])
            })
            .unwrap(),
            canonical_payload: payload.to_owned(),
            signing_secret: "receiver-secret".to_owned(),
        };
        let retained_debug = format!("{request:?}");
        assert!(retained_debug.contains("[REDACTED]"), "{retained_debug}");
        assert!(!retained_debug.contains("receiver-secret"), "{retained_debug}");
    }
}
