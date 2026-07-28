//! Canonical effective-source derivation for the hosted-edge adapter.
//!
//! @ref LLP 0098#6-effective-source-under-this-topology — under loopback
//! termination the immediate peer is *always* the terminator, so deriving the
//! source from the peer address would collapse LLP 0060 D3's five-bucket set
//! into a single global bucket and make per-source limiting a fiction. This
//! derivation is therefore load-bearing, not polish.
//!
//! The rule is deliberately narrow: one trusted peer class (loopback), one
//! header family (`X-Forwarded-For`), strict syntax, a bounded hop count, and
//! selection walking from the trusted edge toward the client. Everything else
//! fails closed.

use std::net::IpAddr;

use crate::diagnostic::{SnapbackError, SnapbackResult};

/// The single consulted header family. `Forwarded`, `X-Real-IP`, and every
/// provider-native variant are ignored entirely, so a terminator that emits
/// several cannot manufacture a conflict the origin resolves in the attacker's
/// favour.
pub const FORWARDED_HEADER: &str = "x-forwarded-for";

/// LLP 0060 D2 requires a bounded hop count. Eight is far above any conforming
/// single-terminator deployment and still bounds the parse.
const MAX_FORWARDED_HOPS: usize = 8;

fn untrusted(message: &'static str) -> SnapbackError {
    SnapbackError::error("SNAPBACK_AUTH_SOURCE_UNTRUSTED", "auth", message)
}

/// Derive the one canonical effective source for security decisions.
///
/// `peer` is the immediate transport peer; `forwarded` is the raw
/// `X-Forwarded-For` value if exactly one was present. A duplicated header must
/// be passed as `None` by the caller — two values are a conflict, and a
/// conflict fails closed.
pub fn derive_effective_source(
    peer: Option<IpAddr>,
    forwarded: Option<&str>,
) -> SnapbackResult<IpAddr> {
    // 1. The immediate peer must belong to the trusted proxy set. Under this
    //    topology that set has exactly one member — the in-namespace
    //    terminator on loopback — and it is not configurable: a non-loopback
    //    peer cannot exist here, so if one appears the derivation fails closed
    //    rather than inventing a policy for it.
    let peer = peer.ok_or_else(|| untrusted("no immediate transport peer is available"))?;
    if !peer.is_loopback() {
        return Err(untrusted(
            "hosted effective source requires a loopback terminator as the immediate peer",
        ));
    }

    let forwarded = forwarded.ok_or_else(|| {
        untrusted("hosted effective source requires exactly one forwarded header")
    })?;

    // 3. Strict syntax. Any malformed entry fails the whole header rather than
    //    being skipped: skipping is how a parser is talked into selecting a
    //    different entry than the terminator meant.
    let mut hops: Vec<IpAddr> = Vec::new();
    for entry in forwarded.split(',') {
        let entry = entry.trim();
        if entry.is_empty() {
            return Err(untrusted("forwarded chain contains an empty entry"));
        }
        if hops.len() == MAX_FORWARDED_HOPS {
            return Err(untrusted("forwarded chain exceeds the bounded hop count"));
        }
        // Reject ports, bracketed authorities, obsolete forms, and hostnames by
        // accepting only a bare IP literal.
        let address: IpAddr = entry
            .parse()
            .map_err(|_| untrusted("forwarded chain contains a malformed entry"))?;
        hops.push(address);
    }
    if hops.is_empty() {
        return Err(untrusted("forwarded chain is empty"));
    }

    // 4. Walk from the trusted edge toward the client. The rightmost entry is
    //    the one the trusted terminator itself appended; with exactly one
    //    trusted hop that is the effective source. The leftmost entry is fully
    //    client-controlled and is never selected merely because it is present.
    let source = *hops.last().expect("non-empty chain");
    Ok(source)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn loopback() -> Option<IpAddr> {
        Some("127.0.0.1".parse().unwrap())
    }

    fn code(error: SnapbackError) -> String {
        error.diagnostic.code.clone()
    }

    // E1
    #[test]
    fn e1_a_missing_forwarded_header_is_untrusted() {
        assert_eq!(
            code(derive_effective_source(loopback(), None).unwrap_err()),
            "SNAPBACK_AUTH_SOURCE_UNTRUSTED"
        );
    }

    // E2
    #[test]
    fn e2_a_chain_over_the_hop_bound_is_untrusted() {
        let chain = (0..9)
            .map(|index| format!("203.0.113.{index}"))
            .collect::<Vec<_>>()
            .join(", ");
        assert_eq!(
            code(derive_effective_source(loopback(), Some(&chain)).unwrap_err()),
            "SNAPBACK_AUTH_SOURCE_UNTRUSTED"
        );
    }

    // E3 — every malformed shape fails the whole header.
    #[test]
    fn e3_malformed_entries_fail_the_whole_header() {
        for malformed in [
            "example.test",
            "203.0.113.7:443",
            "[2001:db8::1]:443",
            "203.0.113.7, ",
            "",
            "unknown",
            "_hidden",
            "203.0.113.7, example.test",
        ] {
            assert_eq!(
                code(derive_effective_source(loopback(), Some(malformed)).unwrap_err()),
                "SNAPBACK_AUTH_SOURCE_UNTRUSTED",
                "{malformed} must fail closed"
            );
        }
    }

    // E5 — the client-controlled leftmost entry never wins.
    #[test]
    fn e5_a_spoofed_leftmost_entry_is_never_selected() {
        let source =
            derive_effective_source(loopback(), Some("198.51.100.9, 203.0.113.7")).unwrap();
        assert_eq!(source, "203.0.113.7".parse::<IpAddr>().unwrap());
    }

    // E6 — no fallback to the peer address, because under this topology the
    // peer is the terminator and using it restores the collapsed bucket.
    #[test]
    fn e6_a_non_loopback_peer_is_untrusted_with_no_fallback() {
        let peer: Option<IpAddr> = Some("203.0.113.1".parse().unwrap());
        assert_eq!(
            code(derive_effective_source(peer, Some("198.51.100.9")).unwrap_err()),
            "SNAPBACK_AUTH_SOURCE_UNTRUSTED"
        );
    }

    #[test]
    fn an_absent_peer_is_untrusted() {
        assert_eq!(
            code(derive_effective_source(None, Some("198.51.100.9")).unwrap_err()),
            "SNAPBACK_AUTH_SOURCE_UNTRUSTED"
        );
    }

    // E7 — the whole point: two clients behind one terminator must land in
    // different source buckets.
    #[test]
    fn e7_two_clients_behind_the_terminator_get_distinct_sources() {
        let first = derive_effective_source(loopback(), Some("198.51.100.9")).unwrap();
        let second = derive_effective_source(loopback(), Some("198.51.100.10")).unwrap();
        assert_ne!(
            first, second,
            "distinct clients must not share one throttle bucket"
        );
    }

    #[test]
    fn ipv6_sources_are_accepted_in_canonical_literal_form() {
        let source = derive_effective_source(loopback(), Some("2001:db8::1")).unwrap();
        assert_eq!(source, "2001:db8::1".parse::<IpAddr>().unwrap());
    }

    #[test]
    fn an_ipv6_loopback_terminator_is_trusted() {
        let peer: Option<IpAddr> = Some("::1".parse().unwrap());
        let source = derive_effective_source(peer, Some("198.51.100.9")).unwrap();
        assert_eq!(source, "198.51.100.9".parse::<IpAddr>().unwrap());
    }

    #[test]
    fn exactly_the_bound_is_admitted() {
        let chain = (0..MAX_FORWARDED_HOPS)
            .map(|index| format!("203.0.113.{index}"))
            .collect::<Vec<_>>()
            .join(", ");
        let source = derive_effective_source(loopback(), Some(&chain)).unwrap();
        assert_eq!(source, "203.0.113.7".parse::<IpAddr>().unwrap());
    }
}
