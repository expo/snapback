//! Shared admission and transport construction for host-mediated HTTP egress.
//!
//! Consumers retain their own request-shape and diagnostic envelopes. This
//! module owns the destination floor: URL credentials/fragments, metadata
//! names, public-address classification, DNS pinning, redirect refusal, and
//! inherited-proxy refusal.

use std::ffi::OsStr;
use std::io;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, ToSocketAddrs};
use std::time::Duration;

/// The closed destination profiles currently admitted by the Rust host.
// @ref LLP 0251#canonical-admission-algorithm — all Rust HTTP egress consumers share this
// public-address floor and the same pinned, no-redirect, no-env-proxy agent.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum HttpTargetPolicy {
    PublicHttpsOnly,
    LocalDevLoopbackHttp,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum PrepareTargetErrorKind {
    Invalid,
    SsrfRefused,
    Unavailable,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct PrepareTargetError {
    kind: PrepareTargetErrorKind,
}

impl PrepareTargetError {
    pub(crate) fn kind(self) -> PrepareTargetErrorKind {
        self.kind
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct PreparedHttpTarget {
    url: String,
    addresses: Vec<SocketAddr>,
    loopback_http: bool,
}

impl PreparedHttpTarget {
    pub(crate) fn authored_url(&self) -> &str {
        &self.url
    }
}

pub(crate) fn action_http_target_policy() -> HttpTargetPolicy {
    action_http_target_policy_for(
        std::env::var_os("SNAPBACK_OUTBOUND_LOOPBACK").as_deref(),
        cfg!(test),
    )
}

fn action_http_target_policy_for(
    configured: Option<&OsStr>,
    test_harness: bool,
) -> HttpTargetPolicy {
    if test_harness || configured == Some(OsStr::new("1")) {
        HttpTargetPolicy::LocalDevLoopbackHttp
    } else {
        HttpTargetPolicy::PublicHttpsOnly
    }
}

pub(crate) fn prepare_http_target(
    url: &str,
    policy: HttpTargetPolicy,
    max_target_bytes: usize,
) -> Result<PreparedHttpTarget, PrepareTargetError> {
    prepare_http_target_with(url, policy, max_target_bytes, |netloc| {
        netloc.to_socket_addrs().map(Iterator::collect)
    })
}

pub(crate) fn prepare_http_target_with<F>(
    url: &str,
    policy: HttpTargetPolicy,
    max_target_bytes: usize,
    resolve: F,
) -> Result<PreparedHttpTarget, PrepareTargetError>
where
    F: FnOnce(&str) -> io::Result<Vec<SocketAddr>>,
{
    if url.is_empty() || url.len() > max_target_bytes || url.chars().any(char::is_control) {
        return Err(invalid());
    }
    let parsed = ureq::get(url).request_url().map_err(|_| invalid())?;
    if parsed.as_url().username() != ""
        || parsed.as_url().password().is_some()
        || parsed.as_url().fragment().is_some()
    {
        return Err(invalid());
    }
    if !matches!(parsed.scheme(), "https" | "http") {
        return Err(invalid());
    }
    // `url::Url::host_str` retains brackets for IPv6 literals in the ureq 2
    // version pinned here. Normalize once so DNS netloc construction cannot
    // produce `[[::1]]:443` and bypass the IP classifier as a DNS failure.
    let host = parsed.host().trim_start_matches('[').trim_end_matches(']');
    // A DNS root suffix does not change hostname identity. Strip it before
    // the reserved-name check so `localhost.` and metadata FQDN spellings
    // cannot escape a name-level refusal (the IP floor remains independent).
    let normalized_host = host.to_ascii_lowercase();
    let normalized_host = normalized_host
        .strip_suffix('.')
        .unwrap_or(&normalized_host);
    if normalized_host == "localhost"
        || normalized_host.ends_with(".localhost")
        || matches!(normalized_host, "metadata" | "metadata.google.internal")
    {
        return Err(ssrf_refused());
    }
    let port = parsed
        .port()
        .unwrap_or(if parsed.scheme() == "https" { 443 } else { 80 });
    let netloc = if host.contains(':') {
        format!("[{host}]:{port}")
    } else {
        format!("{host}:{port}")
    };
    let mut addresses = resolve(&netloc).map_err(|_| unavailable())?;
    addresses.sort_unstable();
    addresses.dedup();
    if addresses.is_empty() {
        return Err(unavailable());
    }

    let all_public = addresses.iter().all(|address| is_public_ip(address.ip()));
    let all_loopback = addresses.iter().all(|address| address.ip().is_loopback());
    let loopback_http = policy == HttpTargetPolicy::LocalDevLoopbackHttp
        && parsed.scheme() == "http"
        && all_loopback;
    if !all_public && !loopback_http {
        return Err(ssrf_refused());
    }
    if parsed.scheme() != "https" && !loopback_http {
        return Err(invalid());
    }

    Ok(PreparedHttpTarget {
        url: url.to_owned(),
        addresses,
        loopback_http,
    })
}

/// Build the only ureq transport admitted for a prepared destination.
///
/// The address set is revalidated immediately before it is captured by the
/// resolver, so even an incorrectly constructed in-crate value fails closed.
pub(crate) fn pinned_http_agent(
    target: &PreparedHttpTarget,
    timeout: Duration,
) -> Result<ureq::Agent, PrepareTargetError> {
    let admitted = if target.loopback_http {
        target.url.starts_with("http://")
            && target
                .addresses
                .iter()
                .all(|address| address.ip().is_loopback())
    } else {
        target
            .addresses
            .iter()
            .all(|address| is_public_ip(address.ip()))
    };
    if target.addresses.is_empty() || !admitted {
        return Err(ssrf_refused());
    }
    let pinned = target.addresses.clone();
    Ok(ureq::AgentBuilder::new()
        .try_proxy_from_env(false)
        .redirects(0)
        .timeout_connect(timeout)
        .timeout_read(timeout)
        .timeout_write(timeout)
        .resolver(move |_: &str| Ok(pinned.clone()))
        .build())
}

pub(crate) fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => is_public_v4(ip),
        IpAddr::V6(ip) => is_public_v6(ip),
    }
}

fn is_public_v4(ip: Ipv4Addr) -> bool {
    let octets = ip.octets();
    !(ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_multicast()
        || ip.is_unspecified()
        || ip == Ipv4Addr::BROADCAST
        || octets[0] == 0
        || (octets[0] == 100 && (64..=127).contains(&octets[1]))
        || (octets[0] == 192 && octets[1] == 0 && octets[2] == 0)
        || (octets[0] == 192 && octets[1] == 0 && octets[2] == 2)
        || (octets[0] == 198 && (octets[1] == 18 || octets[1] == 19))
        || (octets[0] == 198 && octets[1] == 51 && octets[2] == 100)
        || (octets[0] == 203 && octets[1] == 0 && octets[2] == 113)
        || octets[0] >= 224)
}

fn is_public_v6(ip: Ipv6Addr) -> bool {
    if let Some(mapped) = ip.to_ipv4_mapped() {
        return is_public_v4(mapped);
    }
    let segments = ip.segments();
    !ip.is_loopback()
        && !ip.is_unspecified()
        && !ip.is_multicast()
        && (segments[0] & 0xe000) == 0x2000
        && (segments[0] & 0xfe00) != 0xfc00
        && (segments[0] & 0xffc0) != 0xfe80
        && !(segments[0] == 0x2001 && segments[1] == 0x0db8)
}

const fn invalid() -> PrepareTargetError {
    PrepareTargetError {
        kind: PrepareTargetErrorKind::Invalid,
    }
}

const fn ssrf_refused() -> PrepareTargetError {
    PrepareTargetError {
        kind: PrepareTargetErrorKind::SsrfRefused,
    }
}

const fn unavailable() -> PrepareTargetError {
    PrepareTargetError {
        kind: PrepareTargetErrorKind::Unavailable,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    const MAX_TEST_URL_BYTES: usize = 4_096;

    fn prepared_with(
        url: &str,
        policy: HttpTargetPolicy,
        addresses: &[&str],
    ) -> Result<PreparedHttpTarget, PrepareTargetError> {
        prepare_http_target_with(url, policy, MAX_TEST_URL_BYTES, |_| {
            Ok(addresses
                .iter()
                .map(|address| address.parse().expect("test socket address"))
                .collect())
        })
    }

    #[test]
    fn policy_refuses_metadata_localhost_private_mixed_and_ipv6_destinations() {
        for url in [
            "https://localhost/resource",
            "https://localhost./resource",
            "https://service.localhost/resource",
            "https://service.localhost./resource",
            "https://metadata/resource",
            "https://metadata./resource",
            "https://metadata.google.internal/resource",
            "https://metadata.google.internal./resource",
        ] {
            let error = prepare_http_target_with(
                url,
                HttpTargetPolicy::LocalDevLoopbackHttp,
                MAX_TEST_URL_BYTES,
                |_| panic!("reserved names must be refused before DNS"),
            )
            .unwrap_err();
            assert_eq!(error.kind(), PrepareTargetErrorKind::SsrfRefused);
        }

        for address in [
            "0.0.0.0:443",
            "10.1.2.3:443",
            "169.254.169.254:443",
            "[::]:443",
            "[::1]:443",
            "[fe80::a9fe:a9fe]:443",
            "[fd00:ec2::254]:443",
            "[::ffff:169.254.169.254]:443",
        ] {
            let error = prepared_with(
                "https://example.test/resource",
                HttpTargetPolicy::PublicHttpsOnly,
                &[address],
            )
            .unwrap_err();
            assert_eq!(error.kind(), PrepareTargetErrorKind::SsrfRefused);
        }

        let mixed = prepared_with(
            "https://example.test/resource",
            HttpTargetPolicy::LocalDevLoopbackHttp,
            &["93.184.216.34:443", "127.0.0.1:443"],
        )
        .unwrap_err();
        assert_eq!(mixed.kind(), PrepareTargetErrorKind::SsrfRefused);

        let literal = prepare_http_target_with(
            "https://[fe80::a9fe:a9fe]/latest/meta-data",
            HttpTargetPolicy::PublicHttpsOnly,
            MAX_TEST_URL_BYTES,
            |netloc| {
                assert_eq!(netloc, "[fe80::a9fe:a9fe]:443");
                Ok(vec!["[fe80::a9fe:a9fe]:443".parse().unwrap()])
            },
        )
        .unwrap_err();
        assert_eq!(literal.kind(), PrepareTargetErrorKind::SsrfRefused);
    }

    #[test]
    fn public_https_is_allowed_and_plaintext_public_http_is_not() {
        let target = prepared_with(
            "https://example.test/resource",
            HttpTargetPolicy::PublicHttpsOnly,
            &[
                "93.184.216.34:443",
                "[2606:2800:220:1:248:1893:25c8:1946]:443",
            ],
        )
        .expect("public HTTPS target");
        assert_eq!(target.authored_url(), "https://example.test/resource");

        let error = prepared_with(
            "http://example.test/resource",
            HttpTargetPolicy::LocalDevLoopbackHttp,
            &["93.184.216.34:80"],
        )
        .unwrap_err();
        assert_eq!(error.kind(), PrepareTargetErrorKind::Invalid);
    }

    #[test]
    fn loopback_http_requires_the_explicit_local_dev_or_test_policy() {
        let denied = prepared_with(
            "http://loopback.test/resource",
            HttpTargetPolicy::PublicHttpsOnly,
            &["127.0.0.1:80", "[::1]:80"],
        )
        .unwrap_err();
        assert_eq!(denied.kind(), PrepareTargetErrorKind::SsrfRefused);

        prepared_with(
            "http://loopback.test/resource",
            HttpTargetPolicy::LocalDevLoopbackHttp,
            &["127.0.0.1:80", "[::1]:80"],
        )
        .expect("explicit local-dev policy admits all-loopback HTTP");

        assert_eq!(
            action_http_target_policy_for(None, false),
            HttpTargetPolicy::PublicHttpsOnly,
            "ordinary local development is deny-by-default"
        );
        assert_eq!(
            action_http_target_policy_for(Some(OsStr::new("1")), false),
            HttpTargetPolicy::LocalDevLoopbackHttp
        );
        assert_eq!(
            action_http_target_policy_for(None, true),
            HttpTargetPolicy::LocalDevLoopbackHttp
        );
    }

    #[test]
    fn pinned_agent_refuses_redirects_and_ignores_environment_proxies() {
        const CHILD_MARKER: &str = "OUTBOUND_POLICY_PROXY_CHILD";
        if std::env::var_os(CHILD_MARKER).is_some() {
            let target = prepared_with(
                "https://example.test/resource",
                HttpTargetPolicy::PublicHttpsOnly,
                &["93.184.216.34:443"],
            )
            .expect("prepare child target");
            let agent = pinned_http_agent(&target, Duration::from_secs(1))
                .expect("build pinned child agent");
            let debug = format!("{agent:?}");
            assert!(debug.contains("proxy: None"), "env proxy leaked: {debug}");
            assert!(debug.contains("redirects: 0"), "redirects enabled: {debug}");
            return;
        }

        let output = Command::new(std::env::current_exe().expect("current test executable"))
            .args([
                "--exact",
                "outbound_policy::tests::pinned_agent_refuses_redirects_and_ignores_environment_proxies",
                "--nocapture",
            ])
            .env(CHILD_MARKER, "1")
            .env("HTTP_PROXY", "http://127.0.0.1:9")
            .env("HTTPS_PROXY", "http://127.0.0.1:9")
            .env("ALL_PROXY", "http://127.0.0.1:9")
            .env("NO_PROXY", "")
            .env("no_proxy", "")
            .output()
            .expect("run isolated proxy-policy child");
        assert!(
            output.status.success(),
            "proxy-policy child failed\nstdout:\n{}\nstderr:\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn pinned_agent_returns_the_authored_redirect_response_without_following() {
        use std::io::{Read as _, Write as _};

        let listener =
            std::net::TcpListener::bind("127.0.0.1:0").expect("bind redirect-refusal fixture");
        let address = listener.local_addr().expect("redirect fixture address");
        let upstream = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().expect("accept authored request");
            let mut request = [0_u8; 2_048];
            let _ = socket.read(&mut request).expect("read authored request");
            socket
                .write_all(
                    b"HTTP/1.1 302 Found\r\nLocation: http://169.254.169.254/latest/meta-data\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )
                .expect("write redirect response");
        });
        let authored_url = format!("http://public-name.test:{}/authored", address.port());
        let target = prepare_http_target_with(
            &authored_url,
            HttpTargetPolicy::LocalDevLoopbackHttp,
            MAX_TEST_URL_BYTES,
            |_| Ok(vec![address]),
        )
        .expect("prepare loopback redirect fixture");
        let agent = pinned_http_agent(&target, Duration::from_secs(2))
            .expect("build redirect-refusing agent");
        let response = agent
            .get(target.authored_url())
            .call()
            .expect("3xx response is returned without following");
        assert_eq!(response.status(), 302);
        assert_eq!(response.get_url(), authored_url);
        upstream.join().expect("redirect fixture joins");
    }

    #[test]
    fn transport_revalidates_the_complete_pinned_address_set() {
        let target = PreparedHttpTarget {
            url: "https://example.test/resource".to_owned(),
            addresses: vec![
                "93.184.216.34:443".parse().unwrap(),
                "127.0.0.1:443".parse().unwrap(),
            ],
            loopback_http: false,
        };
        let error = pinned_http_agent(&target, Duration::from_secs(1)).unwrap_err();
        assert_eq!(error.kind(), PrepareTargetErrorKind::SsrfRefused);
    }
}
