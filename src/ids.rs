//! Prefixed identifiers: `usr_3n5k7q2wx8mf4b9jd6thzcvr1p`,
//! `posts_01k9m4x7p2q8we5rt3yu6ai0sd`.
//!
//! One registry owns the prefix vocabulary and one helper mints, so adding an
//! id kind is a registry row rather than another `format!` at a call site.
//!
//! **The prefix is for humans and for fail-fast shape checks. Nothing branches
//! on it for a trust, routing, or table-selection decision.** That constraint
//! is what makes stale prefixes (a renamed app table), colliding prefixes (two
//! app tables truncating alike), and absent prefixes (rows written before this
//! landed) all harmless. Resolution consults the same storage and the same
//! digests it did before.
//!
//! @ref LLP 0148#d1-grammar — prefix `_` 26-character Crockford base32 body
//! @ref LLP 0148#d4-the-prefix-is-never-load-bearing — advisory, never a gate

use crate::diagnostic::{SnapbackError, SnapbackResult};

/// Crockford base32, lowercase. Excludes `i`, `l`, `o`, and `u` so the
/// `1`/`l`/`I` and `0`/`O` transcription failures cannot occur, and contains no
/// `-` or `_` so the only underscore in an id is the separator and a
/// double-click selects the whole id.
///
/// The alphabet is in ASCII order, which is what makes a fixed-width body sort
/// lexically in the same order as the bytes it encodes (§D2).
const ALPHABET: &[u8; 32] = b"0123456789abcdefghjkmnpqrstvwxyz";

/// 128 bits in base32. Matches ULID's canonical width.
pub const BODY_LEN: usize = 26;

/// The wire pattern for a Snapback-minted identifier: an LLP 0148 id, or the
/// canonical UUIDv7 every id carried before LLP 0148 landed.
///
/// **Both arms are permanent.** There is no backfill and no rewrite, so a
/// database written before this decision keeps serving hyphenated ids forever
/// and its rows must keep validating (§D4). A schema that accepted only the
/// new arm would refuse to read data Snapback itself wrote.
///
/// The base32 arm's character class is the Crockford alphabet with `i`, `l`,
/// `o`, and `u` excluded — the same set `ALPHABET` encodes with.
pub const ID_WIRE_PATTERN: &str = concat!(
    r"^(?:[a-z][a-z0-9]{0,11}_[0-9a-hjkmnp-tv-z]{26}",
    r"|[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$"
);

/// §D6's truncation bound for a prefix derived from an app table name.
pub const MAX_PREFIX_LEN: usize = 12;

/// How an id kind's 16 body bytes are chosen.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Body {
    /// UUIDv7 bytes: time-ordered, so ids sort chronologically and inserts stay
    /// local in B-tree pages.
    TimeOrdered,
    /// 16 CSPRNG bytes. Used only where a creation-time leak is a real fact
    /// about a person rather than about a row — see `Kind::User`.
    Random,
}

/// The registry. Adding an id kind is a row here plus its arm in `spec`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    // --- auth catalog -----------------------------------------------------
    User,
    Identity,
    Session,
    AuthorityInstance,
    AgentIdentity,
    AgentCredential,
    AgentInvitation,
    PairingRequest,
    GrantRequest,
    Grant,
    /// One app-visible integration registration. The principal itself remains
    /// a random `usr_` id; this row id is chronological operational metadata.
    Integration,
    /// One durable shareable capability-link record. The bearer secret has a
    /// separate credential spelling and is never stored in this identifier.
    CapabilityLink,
    /// One durable approval-gated effect intent. The record is protected
    /// storage; the id is the observable management handle.
    PendingEffect,
    /// One durable standing-query watch. Creation time is ordinary owner
    /// operational metadata, so the body remains time ordered.
    Watch,
    // --- runtime and protocol --------------------------------------------
    Mutation,
    Connection,
    Subscription,
    Invocation,
    HostOperation,
    Lease,
    Receipt,
    Declaration,
    Job,
    Asset,
    AssetGrant,
    Migration,
    Stage,
    Projection,
    AckToken,
    RetryEpisode,
    DryRun,
    OwnerContinuity,
    Stream,
    Startup,
    AgentToken,
    Observation,
    Generation,
    /// One durable error-tracking issue group. Issue creation order is useful
    /// in operator surfaces and reveals no app-user creation fact.
    Issue,
    /// One platform-custodied Expo push-token registry row.
    PushToken,
    /// One app installation, persisted by the client independently of a user
    /// session so account switches can transfer token ownership atomically.
    Installation,
    /// One durable Expo push intent chain, batch handoff, or per-token message
    /// evidence row (LLP 0143 D3's normalized ledger).
    PushIntent,
    PushBatch,
    PushMessage,
    /// An id minted inside a field expression, where no target table is in
    /// scope. Deliberately generic: guessing a table here would produce a
    /// prefix that lies, which §D6 forbids more strongly than it requires a
    /// specific one.
    Opaque,
}

/// A registry row.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Spec {
    pub prefix: &'static str,
    pub body: Body,
}

impl Kind {
    pub const fn spec(self) -> Spec {
        use Body::{Random, TimeOrdered};
        let (prefix, body) = match self {
            // `usr_` is the one random body in the registry. `_auth_users`
            // already carries `created_at_ms`, so a time-ordered body buys the
            // server nothing it does not have; users is the lowest-volume
            // insert table, so the B-tree locality argument does not apply;
            // and `ctx.auth.userId` is the intended join key for app-owned
            // profile tables, so it is the most-exposed id in the system.
            // A time-ordered user id would tell any other user when an account
            // was created, to the millisecond, on every app built on Snapback.
            //
            // @ref LLP 0148#d3-body-bytes-uuidv7-everywhere-random-for-usr_
            Kind::User => ("usr", Random),

            Kind::Identity => ("idn", TimeOrdered),
            Kind::Session => ("ses", TimeOrdered),
            Kind::AuthorityInstance => ("aut", TimeOrdered),
            Kind::AgentIdentity => ("agi", TimeOrdered),
            Kind::AgentCredential => ("agc", TimeOrdered),
            Kind::AgentInvitation => ("agin", TimeOrdered),
            Kind::PairingRequest => ("pair", TimeOrdered),
            Kind::GrantRequest => ("greq", TimeOrdered),
            Kind::Grant => ("grt", TimeOrdered),
            Kind::Integration => ("intg", TimeOrdered),
            // @ref LLP 0204#d94--shareable-capability-links — the observable
            // link id is safe attribution; the raw URL token remains secret.
            Kind::CapabilityLink => ("cplk", TimeOrdered),
            // @ref LLP 0204#d95--approval-gated-effects — pending-effect ids
            // are ordinary time-ordered management handles, never bearers.
            Kind::PendingEffect => ("pfx", TimeOrdered),
            // @ref LLP 0204#d93--durable-watches-end-user-automations — watch ids are observable
            // management handles; no standing authority is encoded in them.
            Kind::Watch => ("wtch", TimeOrdered),

            // These five keep the spellings they already had in the tree, so
            // only the body encoding changes for them.
            Kind::Mutation => ("mut", TimeOrdered),
            Kind::Connection => ("conn", TimeOrdered),
            Kind::Subscription => ("sub", TimeOrdered),
            Kind::Invocation => ("inv", TimeOrdered),
            Kind::HostOperation => ("hop", TimeOrdered),

            Kind::Lease => ("lse", TimeOrdered),
            Kind::Receipt => ("rct", TimeOrdered),
            Kind::Declaration => ("dcl", TimeOrdered),
            Kind::Job => ("job", TimeOrdered),
            Kind::Asset => ("ast", TimeOrdered),
            // @ref LLP 0210#d5--recipient-scoped-authority-recipe-now-grant-ops-as-the-paved-spelling —
            // grant identity is durable and revoke-by-id is the public spelling.
            Kind::AssetGrant => ("agr", TimeOrdered),
            Kind::Migration => ("mig", TimeOrdered),
            Kind::Stage => ("stg", TimeOrdered),
            Kind::Projection => ("proj", TimeOrdered),
            Kind::AckToken => ("ack", TimeOrdered),
            Kind::RetryEpisode => ("ep", TimeOrdered),
            Kind::DryRun => ("dry", TimeOrdered),
            Kind::OwnerContinuity => ("own", TimeOrdered),
            Kind::Stream => ("stm", TimeOrdered),
            Kind::Startup => ("srt", TimeOrdered),
            Kind::AgentToken => ("agtk", TimeOrdered),
            // @ref LLP 0154#d2--the-observation-span-classification-registry-and-phase-1-kinds —
            // observation correlation roots and telemetry generations are
            // unconditional LLP 0148 registry members.
            Kind::Observation => ("obs", Random),
            Kind::Generation => ("gen", Random),
            // @ref LLP 0156#e11--fingerprint-at-the-seam-group-in-the-flush-transaction —
            // durable issue groups have a dedicated, time-ordered registry id.
            Kind::Issue => ("iss", TimeOrdered),
            Kind::PushToken => ("ptok", TimeOrdered),
            Kind::Installation => ("inst", Random),
            Kind::PushIntent => ("pint", TimeOrdered),
            Kind::PushBatch => ("pbat", TimeOrdered),
            Kind::PushMessage => ("pmsg", TimeOrdered),
            Kind::Opaque => ("id", TimeOrdered),
        };
        Spec { prefix, body }
    }

    pub const fn prefix(self) -> &'static str {
        self.spec().prefix
    }
}

/// Every registered kind. Drives §D6's reservation check and the generated
/// TypeScript half.
pub const ALL: &[Kind] = &[
    Kind::User,
    Kind::Identity,
    Kind::Session,
    Kind::AuthorityInstance,
    Kind::AgentIdentity,
    Kind::AgentCredential,
    Kind::AgentInvitation,
    Kind::PairingRequest,
    Kind::GrantRequest,
    Kind::Grant,
    Kind::Integration,
    Kind::CapabilityLink,
    Kind::PendingEffect,
    Kind::Watch,
    Kind::Mutation,
    Kind::Connection,
    Kind::Subscription,
    Kind::Invocation,
    Kind::HostOperation,
    Kind::Lease,
    Kind::Receipt,
    Kind::Declaration,
    Kind::Job,
    Kind::Asset,
    Kind::AssetGrant,
    Kind::Migration,
    Kind::Stage,
    Kind::Projection,
    Kind::AckToken,
    Kind::RetryEpisode,
    Kind::DryRun,
    Kind::OwnerContinuity,
    Kind::Stream,
    Kind::Startup,
    Kind::AgentToken,
    Kind::Observation,
    Kind::Generation,
    Kind::Issue,
    Kind::PushToken,
    Kind::Installation,
    Kind::PushIntent,
    Kind::PushBatch,
    Kind::PushMessage,
    Kind::Opaque,
];

// --- encoding -------------------------------------------------------------

/// 16 bytes to 26 lowercase Crockford base32 characters, most significant
/// first. Order-preserving: for fixed-width inputs, byte order equals string
/// order.
pub fn encode_body(bytes: &[u8; 16]) -> String {
    let mut value = u128::from_be_bytes(*bytes);
    let mut out = [0u8; BODY_LEN];
    // 26 * 5 = 130 bits over a 128-bit value, so the leading character carries
    // only the top 3 bits and lands in `0..=7`.
    for slot in out.iter_mut().rev() {
        *slot = ALPHABET[(value & 0x1f) as usize];
        value >>= 5;
    }
    String::from_utf8(out.to_vec()).expect("alphabet is ASCII")
}

/// The exact inverse of `encode_body`, and strict about it: only the canonical
/// lowercase spelling decodes.
///
/// Crockford's decoder conventionally folds case and maps `i`/`l` to `1` and
/// `o` to `0`. This one does not, because ids are `TEXT` primary keys compared
/// by exact string equality — accepting aliases here would mean two distinct
/// strings decoding alike while still resolving to different rows, which is a
/// worse failure than rejecting a mistyped id. The alphabet's
/// ambiguity-resistance is about what a human reads and writes down; it does
/// not require the decoder to guess.
pub fn decode_body(body: &str) -> Option<[u8; 16]> {
    if body.len() != BODY_LEN {
        return None;
    }
    let mut value: u128 = 0;
    for (index, byte) in body.bytes().enumerate() {
        let digit = ALPHABET.iter().position(|candidate| *candidate == byte)? as u128;
        // The leading character encodes only 3 significant bits; anything
        // larger would not round-trip through 128 bits.
        if index == 0 && digit > 7 {
            return None;
        }
        value = (value << 5) | digit;
    }
    Some(value.to_be_bytes())
}

// --- minting --------------------------------------------------------------

fn time_ordered_bytes() -> [u8; 16] {
    *uuid::Uuid::now_v7().as_bytes()
}

fn random_bytes() -> SnapbackResult<[u8; 16]> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| {
        SnapbackError::error(
            "SNAPBACK_RANDOM_UNAVAILABLE",
            "ids",
            "the operating system CSPRNG did not produce the requested bytes",
        )
    })?;
    Ok(bytes)
}

/// Compose an id for `kind` from body bytes the caller already holds.
///
/// For subsystems that own their randomness rather than reaching for the OS
/// directly: LLP 0057's provider keeps an injected `RandomSource` so its
/// fail-closed contract stays testable, and zeroizes its buffers. This lets
/// such a caller keep its RNG and still spell the id through the registry
/// instead of formatting a prefix by hand.
pub fn format_id(kind: Kind, bytes: &[u8; 16]) -> String {
    format!("{}_{}", kind.prefix(), encode_body(bytes))
}

/// Mint an id for a registered kind.
///
/// Fallible only for `Body::Random` kinds, and then only when the OS CSPRNG is
/// unavailable — there is no weak or deterministic fallback, matching LLP 0057
/// §Randomness and identifiers.
pub fn mint(kind: Kind) -> SnapbackResult<String> {
    let spec = kind.spec();
    let bytes = match spec.body {
        Body::TimeOrdered => time_ordered_bytes(),
        Body::Random => random_bytes()?,
    };
    Ok(format!("{}_{}", spec.prefix, encode_body(&bytes)))
}

/// Mint an id for a kind whose body is time-ordered, which cannot fail.
///
/// Panics on a `Body::Random` kind; that is a programming error at the call
/// site, not a runtime condition.
pub fn mint_time_ordered(kind: Kind) -> String {
    debug_assert_eq!(
        kind.spec().body,
        Body::TimeOrdered,
        "mint_time_ordered called for a random-body kind"
    );
    format!("{}_{}", kind.prefix(), encode_body(&time_ordered_bytes()))
}

// --- app document ids -----------------------------------------------------

/// §D6: an app document's prefix is its declared table name, ASCII-lowercased,
/// with non-alphanumerics removed, truncated to `MAX_PREFIX_LEN`.
///
/// No inflection. Deriving a singular from a table name needs locale-dependent
/// rules that surprise people more often than they help; an author who wants
/// `post_` names the table `post`.
///
/// A name that reduces to nothing (or that would not start with a letter)
/// falls back to `Kind::Opaque`'s prefix, so this is total.
pub fn table_prefix(table: &str) -> String {
    let reduced: String = table
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_lowercase())
        .take(MAX_PREFIX_LEN)
        .collect();
    match reduced.chars().next() {
        Some(first) if first.is_ascii_alphabetic() => reduced,
        _ => Kind::Opaque.prefix().to_owned(),
    }
}

/// Mint an app document id carrying its table's derived prefix.
pub fn mint_document(table: &str) -> String {
    format!(
        "{}_{}",
        table_prefix(table),
        encode_body(&time_ordered_bytes())
    )
}

/// Whether an app table's derived prefix would shadow a registered system
/// prefix.
///
/// A table named `usr` would mint `usr_…` documents, which is the one failure
/// this design must not ship: it makes the human-recognition property actively
/// misleading rather than merely imprecise. Refused at codegen and manifest
/// validation alongside the existing `_auth_*`/`_snapback*` reservation.
pub fn table_prefix_is_reserved(table: &str) -> bool {
    let prefix = table_prefix(table);
    ALL.iter().any(|kind| kind.prefix() == prefix)
}

// --- shape checks (advisory) ----------------------------------------------

/// Split a well-formed id into its prefix and body.
///
/// `None` means "not in this format", which includes every id written before
/// LLP 0148 landed. Callers must treat that as ordinary, not as an error —
/// there is no backfill and readers accept both spellings (§D4).
pub fn split(id: &str) -> Option<(&str, &str)> {
    let (prefix, body) = id.rsplit_once('_')?;
    if prefix.is_empty() || prefix.len() > MAX_PREFIX_LEN {
        return None;
    }
    let mut chars = prefix.chars();
    let first_is_letter = chars.next().is_some_and(|c| c.is_ascii_lowercase());
    let rest_ok = chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit());
    if !first_is_letter || !rest_ok || body.len() != BODY_LEN {
        return None;
    }
    Some((prefix, body))
}

/// Whether `id` is a canonically spelled LLP 0148 identifier.
pub fn is_well_formed(id: &str) -> bool {
    match split(id) {
        Some((_, body)) => decode_body(body).is_some(),
        None => false,
    }
}

/// Whether `value` is the canonical hyphenated UUIDv7 that every Snapback id
/// carried before LLP 0148.
pub fn is_canonical_uuid_v7(value: &str) -> bool {
    match uuid::Uuid::parse_str(value) {
        Ok(parsed) => parsed.get_version_num() == 7 && parsed.hyphenated().to_string() == value,
        Err(_) => false,
    }
}

/// Whether `value` is a Snapback-minted identifier in **either** spelling.
///
/// This is the predicate every stored-state validator wants. There is no
/// backfill: a database written before LLP 0148 keeps serving hyphenated ids
/// forever, so a validator that accepted only the new spelling would report
/// data Snapback itself wrote as corrupt (§D4).
pub fn is_minted_identifier(value: &str) -> bool {
    is_well_formed(value) || is_canonical_uuid_v7(value)
}

/// Whether `id` carries `kind`'s prefix and a decodable body.
///
/// **Advisory.** A `false` may produce a shape refusal at an input boundary and
/// nothing else; it may never stand in for a resolution, authorization, or
/// fencing decision (§D4).
pub fn looks_like(kind: Kind, id: &str) -> bool {
    match split(id) {
        Some((prefix, body)) => prefix == kind.prefix() && decode_body(body).is_some(),
        None => false,
    }
}

/// The registry as a committed JSON artifact, so codegen and the client
/// packages read the same prefix vocabulary the Rust runtime mints from
/// instead of keeping a hand-maintained copy that can drift.
///
/// Written by the `snapback-schemagen` bin and compared by the artifact drift
/// gate, so a registry change that skips regeneration is a test failure.
///
/// @ref LLP 0037#decision-ratified-2026-07-02 — the Rust type is the source of
/// truth; the committed JSON is generated from it
pub fn id_registry_artifact() -> serde_json::Value {
    serde_json::json!({
        "artifactVersion": 1,
        "bodyLength": BODY_LEN,
        "maxPrefixLength": MAX_PREFIX_LEN,
        "alphabet": std::str::from_utf8(ALPHABET).expect("alphabet is ASCII"),
        "kinds": ALL
            .iter()
            .map(|kind| {
                let spec = kind.spec();
                serde_json::json!({
                    "kind": format!("{kind:?}"),
                    "prefix": spec.prefix,
                    "body": match spec.body {
                        Body::TimeOrdered => "timeOrdered",
                        Body::Random => "random",
                    },
                })
            })
            .collect::<Vec<_>>(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    #[test]
    fn body_round_trips_and_is_canonical_width() {
        for seed in [[0u8; 16], [0xff; 16], *uuid::Uuid::now_v7().as_bytes()] {
            let encoded = encode_body(&seed);
            assert_eq!(encoded.len(), BODY_LEN);
            assert!(encoded.bytes().all(|b| ALPHABET.contains(&b)));
            assert_eq!(decode_body(&encoded), Some(seed));
        }
    }

    #[test]
    fn encoding_matches_the_javascript_half() {
        // The same three vectors are asserted in
        // `packages/snapback-contract/ids.test.mjs`. Pinning them on both
        // sides means a change to either encoder fails rather than the two
        // drifting together into a wire mismatch on client-minted ids.
        assert_eq!(encode_body(&[0u8; 16]), "0".repeat(26));
        assert_eq!(encode_body(&[0xff; 16]), format!("7{}", "z".repeat(25)));
        let sequential: [u8; 16] = core::array::from_fn(|i| i as u8);
        assert_eq!(encode_body(&sequential), "00041061050r3gg28a1c60t3gf");
    }

    #[test]
    fn encoding_preserves_byte_order() {
        // The property the whole time-ordered story rests on: sorting the
        // strings equals sorting the bytes, so a SQLite index and a JavaScript
        // `.sort()` agree with creation order.
        let mut bytes: Vec<[u8; 16]> = (0..64u8)
            .map(|i| {
                let mut b = [0u8; 16];
                b[7] = i;
                b[15] = 255 - i;
                b
            })
            .collect();
        bytes.sort();
        let encoded: Vec<String> = bytes.iter().map(encode_body).collect();
        let mut sorted = encoded.clone();
        sorted.sort();
        assert_eq!(encoded, sorted);
    }

    #[test]
    fn decode_is_strict_about_spelling() {
        let canonical = encode_body(&[7u8; 16]);
        assert!(decode_body(&canonical).is_some());
        assert_eq!(decode_body(&canonical.to_uppercase()), None);
        assert_eq!(decode_body(&canonical[1..]), None);
        assert_eq!(decode_body(&format!("{canonical}0")), None);
        // Excluded letters never decode, so a transcribed `l`-for-1 fails
        // loudly instead of resolving to a different row.
        for excluded in ['i', 'l', 'o', 'u'] {
            let mut spoiled: Vec<char> = canonical.chars().collect();
            spoiled[10] = excluded;
            assert_eq!(decode_body(&spoiled.into_iter().collect::<String>()), None);
        }
        // 26 base32 digits span 130 bits; a leading digit above 7 does not
        // round-trip through 128 and must not be accepted.
        let overflowing: String = std::iter::once('8')
            .chain(canonical.chars().skip(1))
            .collect();
        assert_eq!(decode_body(&overflowing), None);
    }

    #[test]
    fn every_registered_prefix_is_unique_and_well_shaped() {
        let mut seen = BTreeSet::new();
        for kind in ALL {
            let prefix = kind.prefix();
            assert!(
                seen.insert(prefix),
                "duplicate registry prefix {prefix:?} — prefixes are advisory, but a \
                 duplicate would make the human-recognition property useless"
            );
            assert!(!prefix.is_empty() && prefix.len() <= MAX_PREFIX_LEN);
            assert!(prefix.starts_with(|c: char| c.is_ascii_lowercase()));
            assert!(
                prefix
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
            );
        }
    }

    #[test]
    fn minted_ids_are_well_formed_and_carry_their_kind() {
        for kind in ALL {
            let id = mint(*kind).expect("CSPRNG available under test");
            assert!(is_well_formed(&id), "{kind:?} minted {id:?}");
            assert!(looks_like(*kind, &id));
            assert!(id.starts_with(&format!("{}_", kind.prefix())));
        }
    }

    #[test]
    fn privacy_and_telemetry_ids_are_random_and_everything_else_is_time_ordered() {
        assert_eq!(Kind::Issue.prefix(), "iss");
        assert_eq!(Kind::Issue.spec().body, Body::TimeOrdered);
        for kind in [
            Kind::User,
            Kind::Observation,
            Kind::Generation,
            Kind::Installation,
        ] {
            assert_eq!(kind.spec().body, Body::Random);
        }
        for kind in ALL.iter().filter(|kind| {
            !matches!(
                kind,
                Kind::User | Kind::Observation | Kind::Generation | Kind::Installation
            )
        }) {
            assert_eq!(
                kind.spec().body,
                Body::TimeOrdered,
                "{kind:?} — random-body kinds are explicit registry exceptions"
            );
        }
        // Time-ordered ids mint in nondecreasing string order.
        let first = mint_time_ordered(Kind::Session);
        let second = mint_time_ordered(Kind::Session);
        assert!(first <= second, "{first} !<= {second}");

        // User ids do not encode a timestamp, so successive mints do not
        // reveal their ordering. Two v7 bodies minted back to back share a
        // long leading run; random ones essentially never do.
        let a = mint(Kind::User).expect("csprng");
        let b = mint(Kind::User).expect("csprng");
        assert_ne!(a, b);
        let shared = a
            .bytes()
            .zip(b.bytes())
            .skip("usr_".len())
            .take_while(|(x, y)| x == y)
            .count();
        assert!(shared < 8, "user ids shared a {shared}-character prefix");

        for kind in [Kind::Observation, Kind::Generation] {
            let first = mint(kind).expect("csprng");
            let second = mint(kind).expect("csprng");
            assert_ne!(first, second);
            assert!(looks_like(kind, &first));
            assert_eq!(first.len(), kind.prefix().len() + 1 + BODY_LEN);
        }
    }

    #[test]
    fn table_prefixes_follow_the_declared_name() {
        assert_eq!(table_prefix("posts"), "posts");
        assert_eq!(table_prefix("blogPosts"), "blogposts");
        assert_eq!(table_prefix("blog_posts"), "blogposts");
        // Truncation at 12, and the documented collision it admits.
        assert_eq!(table_prefix("blogPostsArchive"), "blogpostsarc");
        assert_eq!(
            table_prefix("blogPostsArchive"),
            table_prefix("blogPostsArchived"),
            "truncation may collide; §D6 accepts this as a loss of visual \
             distinguishability and nothing more"
        );
        // Total on names that reduce to nothing or start with a digit.
        assert_eq!(table_prefix("____"), Kind::Opaque.prefix());
        assert_eq!(table_prefix("9lives"), Kind::Opaque.prefix());
        assert!(is_well_formed(&mint_document("posts")));
        assert!(mint_document("blogPosts").starts_with("blogposts_"));
    }

    #[test]
    fn app_tables_may_not_shadow_a_registered_prefix() {
        assert!(table_prefix_is_reserved("usr"));
        assert!(table_prefix_is_reserved("Session".trim_end_matches("sion")));
        assert!(table_prefix_is_reserved("job"));
        assert!(!table_prefix_is_reserved("posts"));
        assert!(!table_prefix_is_reserved("users"));
    }

    #[test]
    fn split_rejects_pre_0148_ids_without_erroring() {
        // A bare UUIDv7 is exactly what rows written before this landed carry.
        let legacy = uuid::Uuid::now_v7().to_string();
        assert_eq!(split(&legacy), None);
        assert!(!is_well_formed(&legacy));
        assert!(!looks_like(Kind::Session, &legacy));
        // The prefixed-UUID shape this design rejected (option B) is also not
        // mistaken for canonical.
        assert!(!is_well_formed(&format!("ses_{legacy}")));
    }

    #[test]
    fn looks_like_discriminates_adjacent_auth_ids() {
        // The concrete defect §Context names: `user_id`, `identity_id`, and
        // `authority_instance_id` sit adjacently in `_auth_sessions` and were
        // byte-shape identical as bare UUIDv7 strings.
        let user = mint(Kind::User).expect("csprng");
        let identity = mint_time_ordered(Kind::Identity);
        let authority = mint_time_ordered(Kind::AuthorityInstance);
        assert!(looks_like(Kind::User, &user) && !looks_like(Kind::Identity, &user));
        assert!(looks_like(Kind::Identity, &identity) && !looks_like(Kind::User, &identity));
        assert!(looks_like(Kind::AuthorityInstance, &authority));
        assert!(!looks_like(Kind::Session, &authority));
    }

    #[test]
    fn ids_survive_the_replay_opaque_id_grammar() {
        // Client-minted ids ride the mutation replay ledger, so every spelling
        // this module produces must pass the wire validator unchanged.
        for kind in ALL {
            let id = mint(*kind).expect("csprng");
            assert!(crate::manifest::replay_opaque_id_is_valid(&id), "{id}");
        }
        assert!(crate::manifest::replay_opaque_id_is_valid(&mint_document(
            "blogPosts"
        )));
    }
}
