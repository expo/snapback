//! Wire-version negotiation classification (LLP 0094 §0B).
//!
//! Pure computation in the `auth::handshake` style: HTTP handlers, socket
//! upgrades, and tests share one executable predicate so the open-time offer
//! matrix (§0B.3) and the socket classification-before-equality rule (§0B.4)
//! cannot drift between call sites. The module holds no connection state —
//! callers supply the bound version and the supported-token set.
//!
//! @ref LLP 0094#0b1-version-identity — `snapback.v1` names the whole
//!   connection-scoped surface; negotiation is exact-token (LLP 0064), so
//!   classification never parses or ranges over version strings.

/// The only wire-version token this binary understands (LLP 0094 §0B.1). It is
/// byte-identical to the kit-stream WebSocket subprotocol token.
pub const WIRE_VERSION_V1: &str = "snapback.v1";

/// Every wire version this binary can bind, in no particular order. Exactly
/// one today; classification is written against the set so a future token
/// lands as data, not new control flow.
pub const SUPPORTED_WIRE_VERSIONS: &[&str] = &[WIRE_VERSION_V1];

/// A subprotocol entry starting with this prefix is a version *candidate*
/// (LLP 0094 §0B.4 step 2): either known (exactly a supported token) or
/// unknown — malformed suffixes never fall through to ignored or absent.
const WIRE_VERSION_CANDIDATE_PREFIX: &str = "snapback.v";

/// The bearer carrier is excluded before any version classification
/// (LLP 0094 §0B.4 step 1).
const BEARER_CARRIER_PREFIX: &str = "snapback.connection-token.";

/// The `/connection/open` `wireVersion` member, classified per the §0B.3 offer
/// matrix. The open-body field is declared to be a wire version, so unlike the
/// socket offer set there is no "ignored" class: any present value that is not
/// a supported token is unknown.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OpenWireVersionOffer<'a> {
    /// No member: a legacy open, implicitly v1-bound for the equality rules.
    Absent,
    /// Exactly a supported token: binds the connection to it.
    Known(&'a str),
    /// Present but not a supported token: refuse
    /// `SNAPBACK_WIRE_VERSION_UNSUPPORTED` — a v2 client must never be
    /// interpreted under v1.
    Unknown,
}

/// Classify the open-time offer against a supported-token set.
pub fn classify_open_offer<'a>(
    offer: Option<&'a str>,
    supported: &[&str],
) -> OpenWireVersionOffer<'a> {
    match offer {
        None => OpenWireVersionOffer::Absent,
        Some(token) if supported.contains(&token) => OpenWireVersionOffer::Known(token),
        Some(_) => OpenWireVersionOffer::Unknown,
    }
}

/// The kit-stream upgrade's subprotocol offer set, classified per §0B.4 and
/// reduced to the first matching row of its precedence table ("bound version
/// present wins"; classification precedes equality).
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SocketWireVersionOffer {
    /// The offer set contains the connection's bound version (however many
    /// other candidates ride along): accept, select and echo the bound token.
    Bound,
    /// At least one known candidate, none equal to the bound version:
    /// refuse `SNAPBACK_WIRE_VERSION_MISMATCH`.
    KnownMismatch,
    /// At least one version candidate, none known: refuse
    /// `SNAPBACK_WIRE_VERSION_UNSUPPORTED`. An uninterpretable token can
    /// never be a mismatch.
    Unknown,
    /// No version candidate at all. Refused
    /// `SNAPBACK_WIRE_VERSION_REQUIRED` from stage B3.
    Absent,
}

/// Classify a subprotocol offer set (already split into entries) against the
/// connection's bound version. Duplicates are harmless; unrelated
/// subprotocols (auth offers, the sender-proof carrier) are ignored for
/// versioning; the bearer carrier is excluded before candidate matching.
pub fn classify_socket_offer<'a>(
    entries: impl IntoIterator<Item = &'a str>,
    bound: &str,
    supported: &[&str],
) -> SocketWireVersionOffer {
    let mut seen_candidate = false;
    let mut seen_known = false;
    for entry in entries {
        if entry.starts_with(BEARER_CARRIER_PREFIX) {
            continue;
        }
        if !entry.starts_with(WIRE_VERSION_CANDIDATE_PREFIX) {
            continue;
        }
        seen_candidate = true;
        if entry == bound {
            return SocketWireVersionOffer::Bound;
        }
        if supported.contains(&entry) {
            seen_known = true;
        }
    }
    if seen_known {
        SocketWireVersionOffer::KnownMismatch
    } else if seen_candidate {
        SocketWireVersionOffer::Unknown
    } else {
        SocketWireVersionOffer::Absent
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_offer_matrix_is_known_binds_unknown_refuses_absent_legacy() {
        assert_eq!(
            classify_open_offer(None, SUPPORTED_WIRE_VERSIONS),
            OpenWireVersionOffer::Absent
        );
        assert_eq!(
            classify_open_offer(Some("snapback.v1"), SUPPORTED_WIRE_VERSIONS),
            OpenWireVersionOffer::Known("snapback.v1")
        );
        for unknown in [
            "snapback.v2",
            "snapback.v1.0",
            "snapback.vx",
            "",
            "v1",
            "SNAPBACK.V1",
        ] {
            assert_eq!(
                classify_open_offer(Some(unknown), SUPPORTED_WIRE_VERSIONS),
                OpenWireVersionOffer::Unknown,
                "{unknown:?} must classify unknown, never silently degrade",
            );
        }
    }

    #[test]
    fn socket_bearer_carrier_and_unrelated_entries_never_classify_as_versions() {
        // The bearer carrier is excluded even though a hypothetical future
        // token grammar could collide; unrelated subprotocols are ignored.
        assert_eq!(
            classify_socket_offer(
                [
                    "snapback.connection-token.sct_abc",
                    "snapback.auth-client.1",
                    "snapback.sender-proof.xyz",
                    "chat.v2",
                ],
                WIRE_VERSION_V1,
                SUPPORTED_WIRE_VERSIONS,
            ),
            SocketWireVersionOffer::Absent
        );
    }

    #[test]
    fn socket_bound_version_present_wins_over_every_other_candidate() {
        // Multi-token offer sets and duplicates: the bound version present
        // row has precedence, whatever else rides along.
        assert_eq!(
            classify_socket_offer(
                ["snapback.v2", "snapback.v1", "snapback.v1", "snapback.vx"],
                WIRE_VERSION_V1,
                SUPPORTED_WIRE_VERSIONS,
            ),
            SocketWireVersionOffer::Bound
        );
    }

    #[test]
    fn socket_unknown_candidates_refuse_unsupported_never_mismatch() {
        // Classification precedes equality: no known candidate → UNSUPPORTED.
        assert_eq!(
            classify_socket_offer(
                ["snapback.v2", "snapback.v1.0", "snapback.v"],
                WIRE_VERSION_V1,
                SUPPORTED_WIRE_VERSIONS,
            ),
            SocketWireVersionOffer::Unknown
        );
    }

    #[test]
    fn socket_known_candidate_unequal_to_bound_is_a_mismatch() {
        // Reachable only with a multi-token supported set (this binary ships
        // one), so the equality row is proven against a hypothetical v2.
        let supported = ["snapback.v1", "snapback.v2"];
        assert_eq!(
            classify_socket_offer(["snapback.v2"], WIRE_VERSION_V1, &supported),
            SocketWireVersionOffer::KnownMismatch
        );
        // An unknown candidate alongside the known-unequal one stays a
        // mismatch (the known row precedes the unknown row).
        assert_eq!(
            classify_socket_offer(["snapback.vx", "snapback.v2"], WIRE_VERSION_V1, &supported),
            SocketWireVersionOffer::KnownMismatch
        );
        // And the bound version present still wins.
        assert_eq!(
            classify_socket_offer(["snapback.v2", "snapback.v1"], WIRE_VERSION_V1, &supported),
            SocketWireVersionOffer::Bound
        );
    }

    #[test]
    fn socket_absent_offer_set_classifies_absent() {
        assert_eq!(
            classify_socket_offer([], WIRE_VERSION_V1, SUPPORTED_WIRE_VERSIONS),
            SocketWireVersionOffer::Absent
        );
    }
}
