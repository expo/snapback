//! Target capability construction, publication verification, and auth facts.
//!
//! Target constructors intentionally remain whole even where they assemble
//! push, asset, vector, and auth facts: splitting a constructor body would
//! change the evidence gate rather than merely relocate it.

use super::push_assets::ExpoPushSeamFactsLocalExt as _;
use super::*;
use crate::assets::AssetFactsLocalExt as _;

trait FullTextSearchFactsLocalExt {
    fn local_v1() -> Self;
}

impl FullTextSearchFactsLocalExt for FullTextSearchFactsV1 {
    fn local_v1() -> Self {
        Self {
            capability_id: crate::search::SEARCH_CAPABILITY.to_owned(),
            maturity: "stable".to_owned(),
            analyzer: crate::search::SEARCH_ANALYZER.to_owned(),
            unicode_version: crate::search::unicode17_generated::UNICODE_VERSION.to_owned(),
            analyzer_tables_digest: crate::search::unicode17_generated::ANALYZER_TABLES_DIGEST
                .to_owned(),
            parser: crate::search::SEARCH_PARSER.to_owned(),
            scorer: crate::search::SEARCH_SCORER.to_owned(),
            score_max: 22_937_600,
            maintenance: "synchronous".to_owned(),
            pagination: "current-keyset-v1".to_owned(),
            cursor_ttl_ms: crate::search::SEARCH_CURSOR_TTL_MS,
            accelerator: "none".to_owned(),
            authorization_filters: vec![
                "public-read".to_owned(),
                "owner.v1".to_owned(),
                "membership.v1".to_owned(),
            ],
            highlights: true,
            counts: false,
            facets: false,
            suggestions: false,
            offline: false,
            storage_engines: vec!["sqlite".to_owned()],
            nonclaims: vec![
                "live-search".to_owned(),
                "offline-search".to_owned(),
                "postgres".to_owned(),
                "relational-visibility".to_owned(),
                "native-fts-acceleration".to_owned(),
                "sensitive-fields".to_owned(),
            ],
        }
    }
}

pub(super) fn bounded_batch_read_runtime_facts() -> Value {
    serde_json::json!({
        "maxItems": BATCH_READ_MAX_ITEMS,
        "maxCanonicalInputBytes": BATCH_READ_MAX_INPUT_BYTES,
        "maxResponseBytes": BATCH_READ_MAX_RESPONSE_BYTES,
        "maxPolicyProbesPerItem": BATCH_READ_MAX_POLICY_PROBES_PER_ITEM,
        "logicalBatchesPerHostCall": 1,
        "sqliteVariableFloor": 999,
    })
}
pub(super) const LOCAL_RELATION_ACTIVITY_PUBLICATION_BYTES: &[u8] =
    include_bytes!("../local-relation-activity-publication.v1.json");
pub(super) const LOCAL_RELATION_ACTIVITY_PUBLICATION_SHA256: &str =
    "sha256:901b8dbc111547b15739d1339198c062460b2af7babf3034c6ce46b9c49211c4";
pub(super) const LOCAL_RELATION_ACTIVITY_QUALIFICATION_RECEIPT_BYTES: &[u8] =
    include_bytes!("../../../../tests/conformance/relation-activity-publication-v1.receipt.json");
pub(super) const LOCAL_SEQUENCE_ALLOCATION_PUBLICATION_BYTES: &[u8] =
    include_bytes!("../local-sequence-allocation-publication.v1.json");
pub(super) const LOCAL_SEQUENCE_ALLOCATION_PUBLICATION_SHA256: &str =
    "sha256:c04817194dbd5e1991627d109be7b8f300c0d1cb79e79d6cb4352611f79438b2";
pub(super) const LOCAL_SEQUENCE_ALLOCATION_QUALIFICATION_RECEIPT_BYTES: &[u8] =
    include_bytes!("../../../../tests/conformance/sequence-allocation-publication-v1.receipt.json");
pub(super) const LOCAL_PERSISTENT_STORE_PUBLICATION_BYTES: &[u8] =
    include_bytes!("../local-persistent-store-publication.v1.json");
pub(super) const LOCAL_PERSISTENT_STORE_PUBLICATION_ANCHOR_BYTES: &[u8] =
    include_bytes!("../local-persistent-store-publication.anchor.v1.json");
pub(super) const LOCAL_PERSISTENT_STORE_CARRIER_EXIT_RECEIPT_BYTES: &[u8] = include_bytes!(
    "../../../../tests/acceptance/fixtures/local-persistent-store/carrier-exit.2026-08-06.v1.json"
);
pub(super) const LOCAL_PERSISTENT_STORE_TRIAGE_MOVE1_RECEIPT_BYTES: &[u8] = include_bytes!(
    "../../../../tests/acceptance/fixtures/triage-graph/move1-exit.2026-08-06.v1.json"
);
pub(super) const LOCAL_PERSISTENT_STORE_TRIAGE_BUDGET_RECEIPT_BYTES: &[u8] = include_bytes!(
    "../../../../tests/acceptance/fixtures/triage-graph/budget-freeze.2026-08-06.v1.json"
);

#[derive(Debug, Deserialize, Eq, PartialEq)]
#[serde(deny_unknown_fields)]
struct LocalRelationActivityPublicationV1 {
    #[serde(rename = "schemaVersion")]
    schema_version: String,
    #[serde(rename = "targetProfileId")]
    target_profile_id: String,
    #[serde(rename = "capabilityIds")]
    capability_ids: Vec<String>,
    #[serde(rename = "qualificationReceiptSha256")]
    qualification_receipt_sha256: String,
    #[serde(rename = "executorSourceSha256")]
    executor_source_sha256: BTreeMap<String, String>,
    #[serde(rename = "schemaSourceSha256")]
    schema_source_sha256: BTreeMap<String, String>,
    #[serde(rename = "packageClosureSha256")]
    package_closure_sha256: Option<String>,
    #[serde(rename = "buildProvenanceRequirement")]
    build_provenance_requirement: String,
}

#[derive(Debug, Deserialize, Eq, PartialEq)]
#[serde(deny_unknown_fields)]
struct LocalSequenceAllocationPublicationV1 {
    #[serde(rename = "schemaVersion")]
    schema_version: String,
    #[serde(rename = "targetProfileId")]
    target_profile_id: String,
    #[serde(rename = "capabilityIds")]
    capability_ids: Vec<String>,
    maturity: String,
    #[serde(rename = "qualificationReceiptSha256")]
    qualification_receipt_sha256: String,
    #[serde(rename = "executorSourceSha256")]
    executor_source_sha256: BTreeMap<String, String>,
    #[serde(rename = "schemaSourceSha256")]
    schema_source_sha256: BTreeMap<String, String>,
    #[serde(rename = "clientSourceSha256")]
    client_source_sha256: BTreeMap<String, String>,
    #[serde(rename = "packageClosureSha256")]
    package_closure_sha256: Option<String>,
    #[serde(rename = "buildProvenanceRequirement")]
    build_provenance_requirement: String,
}

#[derive(Debug, Deserialize, Eq, PartialEq)]
#[serde(deny_unknown_fields)]
struct LocalPersistentStorePublicationV1 {
    #[serde(rename = "schemaVersion")]
    schema_version: String,
    #[serde(rename = "targetProfileId")]
    target_profile_id: String,
    #[serde(rename = "capabilityIds")]
    capability_ids: Vec<String>,
    maturity: String,
    #[serde(rename = "qualificationReceiptSha256")]
    qualification_receipt_sha256: String,
    #[serde(rename = "supportingReceiptSha256")]
    supporting_receipt_sha256: BTreeMap<String, String>,
    #[serde(rename = "executorSourceSha256")]
    executor_source_sha256: BTreeMap<String, String>,
    #[serde(rename = "schemaSourceSha256")]
    schema_source_sha256: BTreeMap<String, String>,
    #[serde(rename = "clientSourceSha256")]
    client_source_sha256: BTreeMap<String, String>,
    #[serde(rename = "packageClosureSha256")]
    package_closure_sha256: Option<String>,
    #[serde(rename = "buildProvenanceRequirement")]
    build_provenance_requirement: String,
}

#[derive(Debug, Deserialize, Eq, PartialEq)]
#[serde(deny_unknown_fields)]
struct LocalPersistentStorePublicationAnchorV1 {
    #[serde(rename = "schemaVersion")]
    schema_version: String,
    #[serde(rename = "capabilityId")]
    capability_id: String,
    state: String,
    #[serde(rename = "carrierSha256")]
    carrier_sha256: String,
}

pub(crate) const PACKAGED_STORE_QUALIFICATION_SCHEMA_VERSION: &str =
    "snapback.packaged-store-qualification.v1";
pub(crate) const PACKAGED_STORE_QUALIFICATION_SUITE_ID: &str = "packaged-store-qualification-v1";
pub(super) const PACKAGED_STORE_QUALIFICATION_RECEIPT_ENV: &str =
    "SNAPBACK_PACKAGED_STORE_QUALIFICATION_RECEIPT";
pub(super) const PACKAGED_STORE_QUALIFICATION_MODE_ENV: &str =
    "SNAPBACK_PACKAGED_STORE_QUALIFICATION_MODE";
pub(super) const PACKAGED_STORE_QUALIFICATION_RECEIPT_MAX_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PackagedStoreClosureEntryV1 {
    pub(crate) name: String,
    pub(crate) version: String,
    pub(crate) sha256: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PackagedStoreQualificationSuiteV1 {
    pub(crate) id: String,
    pub(crate) pass: u64,
    pub(crate) fail: u64,
    pub(crate) skipped: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PackagedStoreBinaryIdentityV1 {
    pub(crate) crate_version: String,
    pub(crate) git_commit: String,
    pub(crate) git_dirty: bool,
    pub(crate) build_profile: String,
    pub(crate) build_distribution: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PackagedStoreQualificationReceiptV1 {
    pub(crate) schema_version: String,
    pub(crate) capability_id: String,
    pub(crate) date: String,
    pub(crate) binary_identity: PackagedStoreBinaryIdentityV1,
    pub(crate) embedded_carrier_sha256: String,
    pub(crate) package_closure: Vec<PackagedStoreClosureEntryV1>,
    pub(crate) package_closure_sha256: String,
    pub(crate) suite: PackagedStoreQualificationSuiteV1,
}

pub(super) fn packaged_store_date_is_well_formed(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 10
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes
            .iter()
            .enumerate()
            .any(|(index, byte)| index != 4 && index != 7 && !byte.is_ascii_digit())
    {
        return false;
    }
    let Ok(year) = value[0..4].parse::<u32>() else {
        return false;
    };
    let Ok(month) = value[5..7].parse::<u32>() else {
        return false;
    };
    let Ok(day) = value[8..10].parse::<u32>() else {
        return false;
    };
    let leap = year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400));
    let max_day = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    (1..=max_day).contains(&day)
}

pub(super) fn packaged_store_closure_canonical_text(
    package_closure: &[PackagedStoreClosureEntryV1],
) -> Option<String> {
    if package_closure.is_empty() {
        return None;
    }
    let mut entries = package_closure.iter().collect::<Vec<_>>();
    entries.sort_by(|left, right| left.name.cmp(&right.name));
    let mut previous_name: Option<&str> = None;
    let mut canonical = String::new();
    for entry in entries {
        if entry.name.is_empty()
            || entry.version.is_empty()
            || entry.name.chars().any(char::is_whitespace)
            || entry.version.chars().any(char::is_whitespace)
            || !sha256_is_well_formed_nonzero(&entry.sha256)
            || previous_name == Some(entry.name.as_str())
        {
            return None;
        }
        previous_name = Some(&entry.name);
        canonical.push_str(&entry.name);
        canonical.push('@');
        canonical.push_str(&entry.version);
        canonical.push(' ');
        canonical.push_str(&entry.sha256);
        canonical.push('\n');
    }
    Some(canonical)
}

pub(crate) fn packaged_store_closure_sha256(
    package_closure: &[PackagedStoreClosureEntryV1],
) -> Option<String> {
    packaged_store_closure_canonical_text(package_closure)
        .map(|canonical| sha256_prefixed(canonical.as_bytes()))
}

pub(crate) fn packaged_store_qualification_suite_is_qualified(
    suite: &PackagedStoreQualificationSuiteV1,
) -> bool {
    suite.id == PACKAGED_STORE_QUALIFICATION_SUITE_ID
        && suite.pass > 0
        && suite.fail == 0
        && suite.skipped == 0
}

pub(super) fn packaged_store_identity_facts_are_qualified(
    crate_version: &str,
    git_commit: &str,
    git_dirty: bool,
    build_profile: &str,
    build_distribution: &str,
) -> bool {
    crate_version == env!("CARGO_PKG_VERSION")
        && git_commit.len() == 40
        && git_commit.bytes().all(|byte| byte.is_ascii_hexdigit())
        && !git_dirty
        && build_profile == "release"
        && build_distribution == crate::identity::BUILD_DISTRIBUTION_PUBLIC_PACKAGE
}

pub(crate) fn packaged_store_runtime_identity_is_qualified(
    identity: &crate::identity::BinaryIdentity,
    build_distribution: &str,
) -> bool {
    packaged_store_identity_facts_are_qualified(
        &identity.crate_version,
        &identity.git_commit,
        identity.git_dirty,
        &identity.build_profile,
        build_distribution,
    )
}

pub(crate) fn stamp_packaged_store_qualification_receipt(
    date: &str,
    identity: &crate::identity::BinaryIdentity,
    build_distribution: &str,
    package_closure: Vec<PackagedStoreClosureEntryV1>,
    suite: PackagedStoreQualificationSuiteV1,
) -> Option<PackagedStoreQualificationReceiptV1> {
    if !packaged_store_date_is_well_formed(date)
        || !packaged_store_runtime_identity_is_qualified(identity, build_distribution)
        || !packaged_store_qualification_suite_is_qualified(&suite)
    {
        return None;
    }
    let package_closure_sha256 = packaged_store_closure_sha256(&package_closure)?;
    Some(PackagedStoreQualificationReceiptV1 {
        schema_version: PACKAGED_STORE_QUALIFICATION_SCHEMA_VERSION.to_owned(),
        capability_id: "single_table_v1".to_owned(),
        date: date.to_owned(),
        binary_identity: PackagedStoreBinaryIdentityV1 {
            crate_version: identity.crate_version.clone(),
            git_commit: identity.git_commit.clone(),
            git_dirty: identity.git_dirty,
            build_profile: identity.build_profile.clone(),
            build_distribution: build_distribution.to_owned(),
        },
        embedded_carrier_sha256: sha256_prefixed(LOCAL_PERSISTENT_STORE_PUBLICATION_BYTES),
        package_closure,
        package_closure_sha256,
        suite,
    })
}

pub(super) fn packaged_store_qualification_receipt_is_qualified(
    receipt_bytes: &[u8],
    git_commit: &str,
    git_dirty: bool,
    build_profile: &str,
    build_distribution: &str,
) -> bool {
    if !packaged_store_identity_facts_are_qualified(
        env!("CARGO_PKG_VERSION"),
        git_commit,
        git_dirty,
        build_profile,
        build_distribution,
    ) {
        return false;
    }
    let Ok(receipt) = serde_json::from_slice::<PackagedStoreQualificationReceiptV1>(receipt_bytes)
    else {
        return false;
    };
    receipt.schema_version == PACKAGED_STORE_QUALIFICATION_SCHEMA_VERSION
        && receipt.capability_id == "single_table_v1"
        && packaged_store_date_is_well_formed(&receipt.date)
        && receipt.binary_identity.crate_version == env!("CARGO_PKG_VERSION")
        && receipt.binary_identity.git_commit == git_commit
        && receipt.binary_identity.git_dirty == git_dirty
        && receipt.binary_identity.build_profile == build_profile
        && receipt.binary_identity.build_distribution == build_distribution
        && receipt.embedded_carrier_sha256
            == sha256_prefixed(LOCAL_PERSISTENT_STORE_PUBLICATION_BYTES)
        && packaged_store_closure_sha256(&receipt.package_closure)
            .is_some_and(|digest| digest == receipt.package_closure_sha256)
        && packaged_store_qualification_suite_is_qualified(&receipt.suite)
}

pub(super) fn packaged_store_qualification_mode_from_value(value: Option<&OsStr>) -> bool {
    value.is_some_and(|value| !value.is_empty())
}

pub(super) fn packaged_store_qualification_mode() -> bool {
    static MODE: OnceLock<bool> = OnceLock::new();
    *MODE.get_or_init(|| {
        let value = std::env::var_os(PACKAGED_STORE_QUALIFICATION_MODE_ENV);
        packaged_store_qualification_mode_from_value(value.as_deref())
    })
}

pub(super) fn packaged_store_qualification_receipt_bytes() -> Option<&'static [u8]> {
    static RECEIPT: OnceLock<Option<Vec<u8>>> = OnceLock::new();
    RECEIPT
        .get_or_init(|| {
            let path = std::env::var_os(PACKAGED_STORE_QUALIFICATION_RECEIPT_ENV)?;
            let metadata = std::fs::metadata(&path).ok()?;
            if !metadata.is_file()
                || metadata.len() > PACKAGED_STORE_QUALIFICATION_RECEIPT_MAX_BYTES
            {
                return None;
            }
            std::fs::read(path).ok()
        })
        .as_deref()
}

/// Validate the private, source-embedded publication carrier before deriving
/// either relation/activity support fact. Failure is intentionally a boolean
/// GAP at the target manifest boundary: an unreviewed carrier edit cannot
/// become target authority through a generated application artifact.
///
/// @ref LLP 0110#local-and-packaged-publication-authority — source builds
/// bind the exact local profile, both atomic capability ids, the executable
/// evidence receipt, and the implementation/schema source bytes.
/// @ref LLP 0113#6-acceptance — carrier and registry tampering must withhold
/// runtime support while leaving the static maturity assignment intact.
pub(super) fn local_relation_activity_publication_verified_for(
    build_distribution: &str,
    carrier_bytes: &[u8],
    expected_carrier_sha256: &str,
    qualification_receipt_bytes: &[u8],
) -> bool {
    // Public packages cannot inherit the contributor trust root. Until the
    // loader embeds and verifies PackageCapabilityAttestationV1, one
    // distribution predicate closes every substitution/tamper path as a GAP.
    //
    // @ref LLP 0110#local-and-packaged-publication-authority — package support
    // requires the release-key-signed binary/triple/ledger/source/carrier
    // binding; absence or mismatch withholds the atomic pair.
    if build_distribution != crate::identity::BUILD_DISTRIBUTION_CONTRIBUTOR_SOURCE {
        return false;
    }
    if sha256_prefixed(carrier_bytes) != expected_carrier_sha256 {
        return false;
    }
    let Ok(carrier) = serde_json::from_slice::<LocalRelationActivityPublicationV1>(carrier_bytes)
    else {
        return false;
    };
    carrier.schema_version == "snapback.local-capability-publication.v1"
        && carrier.target_profile_id == TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX
        && carrier.capability_ids == ["bounded_children_v1", "write_activity_v1"].map(str::to_owned)
        && carrier.qualification_receipt_sha256 == sha256_prefixed(qualification_receipt_bytes)
        && carrier.executor_source_sha256
            == BTreeMap::from([
                (
                    "src/local.rs".to_owned(),
                    "sha256:6e78847ef78138bedb11d407f0b93c1595136e04690abebd991e3bfed2016711"
                        .to_owned(),
                ),
                (
                    "src/local/auth_room_kick_acceptance.rs".to_owned(),
                    "sha256:e06a2b8454fca1d59a7f73b3bdf9a7e5ba8349becc477aaebafe091ead744b90"
                        .to_owned(),
                ),
                (
                    "src/local/authorization_acceptance.rs".to_owned(),
                    "sha256:57cdfcc6f7990f22fbc6044999d36fc4b91ef97b5f77de35d00a3f5a711af99e"
                        .to_owned(),
                ),
                (
                    "src/local/config_types.rs".to_owned(),
                    "sha256:ccae542de561b1e394053f482f21b88118c74d028017f72307691b806f2b0e85"
                        .to_owned(),
                ),
                (
                    "src/local/inspection.rs".to_owned(),
                    "sha256:93c424b9923c7872a0dea804fd50352b5020712994f09f1ecb881193fc44f679"
                        .to_owned(),
                ),
                (
                    "src/local/live_protocol.rs".to_owned(),
                    "sha256:5e4e2faff869916551efa4165c6259a9788bc7f796e3b27925561bf45d6c9090"
                        .to_owned(),
                ),
                (
                    "src/local/receipt_log.rs".to_owned(),
                    "sha256:04320e18e96a0788885e44a37e05c33b673430a7a01bbcae98601eab96a45add"
                        .to_owned(),
                ),
                (
                    "src/local/tests.rs".to_owned(),
                    "sha256:b732fbe3b431316cc91ca2797544c1f8c3fa1acbdef11244c8718524f94fb543"
                        .to_owned(),
                ),
                (
                    "src/storage.rs".to_owned(),
                    "sha256:9d9469e4bd24ffdf717330b41975229159a1e4a1e7d1e599d19b4d8969d0d10d"
                        .to_owned(),
                ),
                (
                    "src/storage/auth.rs".to_owned(),
                    "sha256:3f6e71b3b32d7beda075b336b98aeb618a1fe0eaf54e8049540119b3dea16820"
                        .to_owned(),
                ),
                (
                    "src/storage/auth_agent_credentials.rs".to_owned(),
                    "sha256:d2c5f512a26fd2afca8df6202743b51077d15cde9e0fbd1aed48c555f34dbf3e"
                        .to_owned(),
                ),
                (
                    "src/storage/auth_agents.rs".to_owned(),
                    "sha256:221bff2b8468479f3b5fa601d677133f7be22e117ee8b81a90e28e88cd90051f"
                        .to_owned(),
                ),
                (
                    "src/storage/auth_asset_callbacks.rs".to_owned(),
                    "sha256:7dd1bae86f73207f2695566ab302f33fceebffe248bd6bab1b0c0866ae8a7ca9"
                        .to_owned(),
                ),
                (
                    "src/storage/auth_grants.rs".to_owned(),
                    "sha256:9ccc7da5ba2877b1b31f0b55b81acae602a35229abd6feccd686a584f2e96cb7"
                        .to_owned(),
                ),
                (
                    "src/storage/auth_invalidation.rs".to_owned(),
                    "sha256:575782a9d656905c0a127ab6b2c0fd83d7951cc3452f0944b3c04e3df17a9099"
                        .to_owned(),
                ),
                (
                    "src/storage/auth_mode.rs".to_owned(),
                    "sha256:b35dd330712309a868c728cd5e18ab149cd8bda67254652cedc3ffe7d5d05134"
                        .to_owned(),
                ),
                (
                    "src/storage/auth_rescue.rs".to_owned(),
                    "sha256:42425bad49410ad0ad0d950d335b8cebe35d461904dc48697388236c3fe41bab"
                        .to_owned(),
                ),
                (
                    "src/storage/auth_scope_bases.rs".to_owned(),
                    "sha256:3ee8e5dca5fd0c2553ed03db02abba84a9dfcacc6eaeadbd953b11f8079b69ae"
                        .to_owned(),
                ),
                (
                    "src/storage/auth_sender.rs".to_owned(),
                    "sha256:98a4c79ecb113792a4d9c4898a0a2f476fd0d79d76f8dcb087186b017e114c80"
                        .to_owned(),
                ),
                (
                    "src/storage/auth_stream.rs".to_owned(),
                    "sha256:fd1a226b37d71dd4116ecdea283aad2b35852802cc2acd8a0155bd4f60113332"
                        .to_owned(),
                ),
                (
                    "src/storage/auth_throttle.rs".to_owned(),
                    "sha256:3b7c3af31d633222985e257a12b58dd26a8390b74d0d26b811eea2b908264d77"
                        .to_owned(),
                ),
                (
                    "src/storage/authorization.rs".to_owned(),
                    "sha256:1c26338d9cb79206135a594e48346e091aaca2a0d9ac07d102481249a10a1552"
                        .to_owned(),
                ),
                (
                    "src/storage/authorized_lease.rs".to_owned(),
                    "sha256:58fe02cd52bafbb03b1a0da1351df94705a71633dd6927fa0657597c65045a50"
                        .to_owned(),
                ),
                (
                    "src/storage/connections.rs".to_owned(),
                    "sha256:802f027db805e802487a51d16491e224430825aa5eb799669feba4785d605fdd"
                        .to_owned(),
                ),
                (
                    "src/storage/hosted_admission.rs".to_owned(),
                    "sha256:ee1a0b496f36b80949dbab122c2be72f91a4942d44365d509149b6cb38f385ac"
                        .to_owned(),
                ),
                (
                    "src/storage/migration_executor.rs".to_owned(),
                    "sha256:311cc20187790f82af6b6ce54899b2f50143098e9916d43413838f3c8e72635f"
                        .to_owned(),
                ),
                (
                    "src/storage/migration_scan.rs".to_owned(),
                    "sha256:43bfda997ab189b4ecdfa3d6fb8442487f26c57d86c6f21cd9ba1b8fa36a412c"
                        .to_owned(),
                ),
                (
                    "src/storage/projection_rebuild.rs".to_owned(),
                    "sha256:cdc288f51d056d284eac37337fa533f06e9c80e93085719ada2afa81b07ef0c5"
                        .to_owned(),
                ),
                (
                    "src/storage/schema_transition.rs".to_owned(),
                    "sha256:c91c85ef764082865c95059dc2ba755f23ea3eabc88b6260a2f08f8705957952"
                        .to_owned(),
                ),
                (
                    "src/storage/tests.rs".to_owned(),
                    "sha256:18aaaef5fcd5e3666964a5a97a5aa62612ad3286ecee55b75727ad9392960b02"
                        .to_owned(),
                ),
                (
                    "src/storage/write_authority.rs".to_owned(),
                    "sha256:d4f13836da07680ed8c359f20be5865ef1c131c23138bb73c151679ead7ac615"
                        .to_owned(),
                ),
            ])
        && carrier.schema_source_sha256
            == BTreeMap::from([(
                "packages/snapback-codegen/define.mjs".to_owned(),
                "sha256:b15e4153117eb9f1be217da46ef69477a594fe8cd6d8e808ddd9a18037d3b790"
                    .to_owned(),
            )])
        && carrier.package_closure_sha256.is_none()
        && carrier.build_provenance_requirement == "source-commit-and-embedded-carrier-sha256"
}

#[cfg(test)]
pub(super) fn local_relation_activity_publication_verified() -> bool {
    local_relation_activity_publication_verified_for(
        crate::identity::build_distribution(),
        LOCAL_RELATION_ACTIVITY_PUBLICATION_BYTES,
        LOCAL_RELATION_ACTIVITY_PUBLICATION_SHA256,
        LOCAL_RELATION_ACTIVITY_QUALIFICATION_RECEIPT_BYTES,
    )
}

/// Validate the dedicated sequence qualification carrier. This is local
/// contributor-source authority only: public packages require the signed
/// package attestation, and hosted profiles require their own LLP 0113 family
/// plus exact target corpus.
///
/// @ref LLP 0135#18-ceilings-receipts-and-capability — support follows the
/// complete §5.1 receipt; a carrier/source/target mismatch remains a GAP.
/// @ref LLP 0113#6-acceptance — support publication and static maturity are
/// distinct, fail-closed dimensions.
pub(super) fn local_sequence_allocation_publication_verified_for(
    build_distribution: &str,
    carrier_bytes: &[u8],
    expected_carrier_sha256: &str,
    qualification_receipt_bytes: &[u8],
) -> bool {
    if build_distribution != crate::identity::BUILD_DISTRIBUTION_CONTRIBUTOR_SOURCE {
        return false;
    }
    if sha256_prefixed(carrier_bytes) != expected_carrier_sha256 {
        return false;
    }
    let Ok(carrier) = serde_json::from_slice::<LocalSequenceAllocationPublicationV1>(carrier_bytes)
    else {
        return false;
    };
    carrier.schema_version == "snapback.local-capability-publication.v1"
        && carrier.target_profile_id == TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX
        && carrier.capability_ids == ["sequence_allocation_v1".to_owned()]
        && carrier.maturity == "experimental"
        && carrier.qualification_receipt_sha256 == sha256_prefixed(qualification_receipt_bytes)
        && carrier.executor_source_sha256
            == BTreeMap::from([
                (
                    "src/local/auth_room_kick_acceptance.rs".to_owned(),
                    "sha256:e06a2b8454fca1d59a7f73b3bdf9a7e5ba8349becc477aaebafe091ead744b90"
                        .to_owned(),
                ),
                (
                    "src/local/authorization_acceptance.rs".to_owned(),
                    "sha256:57cdfcc6f7990f22fbc6044999d36fc4b91ef97b5f77de35d00a3f5a711af99e"
                        .to_owned(),
                ),
                (
                    "src/local/config_types.rs".to_owned(),
                    "sha256:ccae542de561b1e394053f482f21b88118c74d028017f72307691b806f2b0e85"
                        .to_owned(),
                ),
                (
                    "src/local/inspection.rs".to_owned(),
                    "sha256:93c424b9923c7872a0dea804fd50352b5020712994f09f1ecb881193fc44f679"
                        .to_owned(),
                ),
                (
                    "src/local/live_protocol.rs".to_owned(),
                    "sha256:5e4e2faff869916551efa4165c6259a9788bc7f796e3b27925561bf45d6c9090"
                        .to_owned(),
                ),
                (
                    "src/local/receipt_log.rs".to_owned(),
                    "sha256:04320e18e96a0788885e44a37e05c33b673430a7a01bbcae98601eab96a45add"
                        .to_owned(),
                ),
                (
                    "src/local/tests.rs".to_owned(),
                    "sha256:b732fbe3b431316cc91ca2797544c1f8c3fa1acbdef11244c8718524f94fb543"
                        .to_owned(),
                ),
                (
                    "src/runtime.rs".to_owned(),
                    "sha256:6320da10271fca2e8b1fad23155a64a36554a6b8dce4bf5af2e6470b58030ec8"
                        .to_owned(),
                ),
                (
                    "src/storage.rs".to_owned(),
                    "sha256:9d9469e4bd24ffdf717330b41975229159a1e4a1e7d1e599d19b4d8969d0d10d"
                        .to_owned(),
                ),
                (
                    "src/storage/auth.rs".to_owned(),
                    "sha256:3f6e71b3b32d7beda075b336b98aeb618a1fe0eaf54e8049540119b3dea16820"
                        .to_owned(),
                ),
                (
                    "src/storage/auth_agent_credentials.rs".to_owned(),
                    "sha256:d2c5f512a26fd2afca8df6202743b51077d15cde9e0fbd1aed48c555f34dbf3e"
                        .to_owned(),
                ),
                (
                    "src/storage/auth_agents.rs".to_owned(),
                    "sha256:221bff2b8468479f3b5fa601d677133f7be22e117ee8b81a90e28e88cd90051f"
                        .to_owned(),
                ),
                (
                    "src/storage/auth_asset_callbacks.rs".to_owned(),
                    "sha256:7dd1bae86f73207f2695566ab302f33fceebffe248bd6bab1b0c0866ae8a7ca9"
                        .to_owned(),
                ),
                (
                    "src/storage/auth_grants.rs".to_owned(),
                    "sha256:9ccc7da5ba2877b1b31f0b55b81acae602a35229abd6feccd686a584f2e96cb7"
                        .to_owned(),
                ),
                (
                    "src/storage/auth_invalidation.rs".to_owned(),
                    "sha256:575782a9d656905c0a127ab6b2c0fd83d7951cc3452f0944b3c04e3df17a9099"
                        .to_owned(),
                ),
                (
                    "src/storage/auth_mode.rs".to_owned(),
                    "sha256:b35dd330712309a868c728cd5e18ab149cd8bda67254652cedc3ffe7d5d05134"
                        .to_owned(),
                ),
                (
                    "src/storage/auth_rescue.rs".to_owned(),
                    "sha256:42425bad49410ad0ad0d950d335b8cebe35d461904dc48697388236c3fe41bab"
                        .to_owned(),
                ),
                (
                    "src/storage/auth_scope_bases.rs".to_owned(),
                    "sha256:3ee8e5dca5fd0c2553ed03db02abba84a9dfcacc6eaeadbd953b11f8079b69ae"
                        .to_owned(),
                ),
                (
                    "src/storage/auth_sender.rs".to_owned(),
                    "sha256:98a4c79ecb113792a4d9c4898a0a2f476fd0d79d76f8dcb087186b017e114c80"
                        .to_owned(),
                ),
                (
                    "src/storage/auth_stream.rs".to_owned(),
                    "sha256:fd1a226b37d71dd4116ecdea283aad2b35852802cc2acd8a0155bd4f60113332"
                        .to_owned(),
                ),
                (
                    "src/storage/auth_throttle.rs".to_owned(),
                    "sha256:3b7c3af31d633222985e257a12b58dd26a8390b74d0d26b811eea2b908264d77"
                        .to_owned(),
                ),
                (
                    "src/storage/authorization.rs".to_owned(),
                    "sha256:1c26338d9cb79206135a594e48346e091aaca2a0d9ac07d102481249a10a1552"
                        .to_owned(),
                ),
                (
                    "src/storage/authorized_lease.rs".to_owned(),
                    "sha256:58fe02cd52bafbb03b1a0da1351df94705a71633dd6927fa0657597c65045a50"
                        .to_owned(),
                ),
                (
                    "src/storage/connections.rs".to_owned(),
                    "sha256:802f027db805e802487a51d16491e224430825aa5eb799669feba4785d605fdd"
                        .to_owned(),
                ),
                (
                    "src/storage/hosted_admission.rs".to_owned(),
                    "sha256:ee1a0b496f36b80949dbab122c2be72f91a4942d44365d509149b6cb38f385ac"
                        .to_owned(),
                ),
                (
                    "src/storage/migration_executor.rs".to_owned(),
                    "sha256:311cc20187790f82af6b6ce54899b2f50143098e9916d43413838f3c8e72635f"
                        .to_owned(),
                ),
                (
                    "src/storage/migration_scan.rs".to_owned(),
                    "sha256:43bfda997ab189b4ecdfa3d6fb8442487f26c57d86c6f21cd9ba1b8fa36a412c"
                        .to_owned(),
                ),
                (
                    "src/storage/projection_rebuild.rs".to_owned(),
                    "sha256:cdc288f51d056d284eac37337fa533f06e9c80e93085719ada2afa81b07ef0c5"
                        .to_owned(),
                ),
                (
                    "src/storage/schema_transition.rs".to_owned(),
                    "sha256:c91c85ef764082865c95059dc2ba755f23ea3eabc88b6260a2f08f8705957952"
                        .to_owned(),
                ),
                (
                    "src/storage/tests.rs".to_owned(),
                    "sha256:18aaaef5fcd5e3666964a5a97a5aa62612ad3286ecee55b75727ad9392960b02"
                        .to_owned(),
                ),
                (
                    "src/storage/write_authority.rs".to_owned(),
                    "sha256:d4f13836da07680ed8c359f20be5865ef1c131c23138bb73c151679ead7ac615"
                        .to_owned(),
                ),
            ])
        && carrier.schema_source_sha256
            == BTreeMap::from([(
                "packages/snapback-codegen/define.mjs".to_owned(),
                "sha256:b15e4153117eb9f1be217da46ef69477a594fe8cd6d8e808ddd9a18037d3b790"
                    .to_owned(),
            )])
        && carrier.client_source_sha256
            == BTreeMap::from([
                (
                    "packages/snapback-contract/derived-overlay.mjs".to_owned(),
                    "sha256:8b5324a45a8beaaa7db4eaf93361f8faf1008e152a74f9903844335d0f8e0a32"
                        .to_owned(),
                ),
                (
                    "packages/snapback-contract/index.mjs".to_owned(),
                    "sha256:8cc0878870ad63e5187039c24a832108f3c43d0cd8f9e0442fd329268b97d412"
                        .to_owned(),
                ),
            ])
        && carrier.package_closure_sha256.is_none()
        && carrier.build_provenance_requirement == "source-commit-and-embedded-carrier-sha256"
}

#[cfg(test)]
pub(super) fn local_sequence_allocation_publication_verified() -> bool {
    local_sequence_allocation_publication_verified_for(
        crate::identity::build_distribution(),
        LOCAL_SEQUENCE_ALLOCATION_PUBLICATION_BYTES,
        LOCAL_SEQUENCE_ALLOCATION_PUBLICATION_SHA256,
        LOCAL_SEQUENCE_ALLOCATION_QUALIFICATION_RECEIPT_BYTES,
    )
}

/// Validate the exact local store/class publication carrier. The carrier
/// composes the retained carrier-exit receipt with the separately qualified
/// Triage successor receipts. The carrier exit in turn digest-binds the
/// qualified Fleet successor. Public packages require the dated
/// qualification conjunction; other targets require their own authority.
///
/// @ref LLP 0110#local-persistent-store-publication-authority-amendment--2026-08-04
/// — support follows the source-owned carrier and exact evidence/source
/// bindings, never an application-authored capability string.
/// @ref LLP 0166#local-publication-carrier-amendment--2026-08-04 — Arm A and
/// connected prove-or-fresh store semantics remain part of the bound class.
#[allow(
    clippy::too_many_arguments,
    reason = "the verifier mirrors the closed publication carrier tuple; named axes keep drift reviewable"
)]
pub(super) fn local_persistent_store_publication_verified_for(
    build_distribution: &str,
    git_commit: &str,
    git_dirty: bool,
    build_profile: &str,
    qualification_receipt_bytes: Option<&[u8]>,
    carrier_bytes: &[u8],
    anchor_bytes: &[u8],
    carrier_exit_receipt_bytes: &[u8],
    triage_move1_receipt_bytes: &[u8],
    triage_budget_receipt_bytes: &[u8],
) -> bool {
    if !local_persistent_store_contributor_chain_verified(
        carrier_bytes,
        anchor_bytes,
        carrier_exit_receipt_bytes,
        triage_move1_receipt_bytes,
        triage_budget_receipt_bytes,
    ) {
        return false;
    }
    match build_distribution {
        crate::identity::BUILD_DISTRIBUTION_CONTRIBUTOR_SOURCE => true,
        // @ref LLP 0110#single-table-public-package-advertisement-amendment--2026-08-06
        // — public-package support is the unchanged contributor carrier chain
        // plus clean release identity and an exact packaged-closure receipt.
        crate::identity::BUILD_DISTRIBUTION_PUBLIC_PACKAGE => qualification_receipt_bytes
            .is_some_and(|receipt| {
                packaged_store_qualification_receipt_is_qualified(
                    receipt,
                    git_commit,
                    git_dirty,
                    build_profile,
                    build_distribution,
                )
            }),
        _ => false,
    }
}

pub(super) fn local_persistent_store_contributor_chain_verified(
    carrier_bytes: &[u8],
    anchor_bytes: &[u8],
    carrier_exit_receipt_bytes: &[u8],
    triage_move1_receipt_bytes: &[u8],
    triage_budget_receipt_bytes: &[u8],
) -> bool {
    let Ok(anchor) =
        serde_json::from_slice::<LocalPersistentStorePublicationAnchorV1>(anchor_bytes)
    else {
        return false;
    };
    if anchor.schema_version != "snapback.local-capability-publication-anchor.v1"
        || anchor.capability_id != "single_table_v1"
        || anchor.state != "published"
        || sha256_prefixed(carrier_bytes) != anchor.carrier_sha256
    {
        return false;
    }
    let Ok(carrier) = serde_json::from_slice::<LocalPersistentStorePublicationV1>(carrier_bytes)
    else {
        return false;
    };
    local_persistent_store_receipts_qualified(
        carrier_exit_receipt_bytes,
        triage_move1_receipt_bytes,
        triage_budget_receipt_bytes,
    ) && carrier.schema_version == "snapback.local-capability-publication.v1"
        && carrier.target_profile_id == TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX
        && carrier.capability_ids == ["single_table_v1".to_owned()]
        && carrier.maturity == "experimental"
        && carrier.qualification_receipt_sha256 == sha256_prefixed(carrier_exit_receipt_bytes)
        && carrier.supporting_receipt_sha256
            == BTreeMap::from([
                (
                    "triageBudgetFreeze".to_owned(),
                    sha256_prefixed(triage_budget_receipt_bytes),
                ),
                (
                    "triageMove1Exit".to_owned(),
                    sha256_prefixed(triage_move1_receipt_bytes),
                ),
            ])
        && carrier.executor_source_sha256
            == BTreeMap::from([
                (
                    "src/local.rs".to_owned(),
                    "sha256:6e78847ef78138bedb11d407f0b93c1595136e04690abebd991e3bfed2016711"
                        .to_owned(),
                ),
                (
                    "src/local/auth_room_kick_acceptance.rs".to_owned(),
                    "sha256:e06a2b8454fca1d59a7f73b3bdf9a7e5ba8349becc477aaebafe091ead744b90"
                        .to_owned(),
                ),
                (
                    "src/local/authorization_acceptance.rs".to_owned(),
                    "sha256:57cdfcc6f7990f22fbc6044999d36fc4b91ef97b5f77de35d00a3f5a711af99e"
                        .to_owned(),
                ),
                (
                    "src/local/config_types.rs".to_owned(),
                    "sha256:ccae542de561b1e394053f482f21b88118c74d028017f72307691b806f2b0e85"
                        .to_owned(),
                ),
                (
                    "src/local/inspection.rs".to_owned(),
                    "sha256:93c424b9923c7872a0dea804fd50352b5020712994f09f1ecb881193fc44f679"
                        .to_owned(),
                ),
                (
                    "src/local/live_protocol.rs".to_owned(),
                    "sha256:5e4e2faff869916551efa4165c6259a9788bc7f796e3b27925561bf45d6c9090"
                        .to_owned(),
                ),
                (
                    "src/local/receipt_log.rs".to_owned(),
                    "sha256:04320e18e96a0788885e44a37e05c33b673430a7a01bbcae98601eab96a45add"
                        .to_owned(),
                ),
                (
                    "src/local/tests.rs".to_owned(),
                    "sha256:b732fbe3b431316cc91ca2797544c1f8c3fa1acbdef11244c8718524f94fb543"
                        .to_owned(),
                ),
                (
                    "src/storage.rs".to_owned(),
                    "sha256:9d9469e4bd24ffdf717330b41975229159a1e4a1e7d1e599d19b4d8969d0d10d"
                        .to_owned(),
                ),
                (
                    "src/storage/auth.rs".to_owned(),
                    "sha256:3f6e71b3b32d7beda075b336b98aeb618a1fe0eaf54e8049540119b3dea16820"
                        .to_owned(),
                ),
                (
                    "src/storage/auth_agent_credentials.rs".to_owned(),
                    "sha256:d2c5f512a26fd2afca8df6202743b51077d15cde9e0fbd1aed48c555f34dbf3e"
                        .to_owned(),
                ),
                (
                    "src/storage/auth_agents.rs".to_owned(),
                    "sha256:221bff2b8468479f3b5fa601d677133f7be22e117ee8b81a90e28e88cd90051f"
                        .to_owned(),
                ),
                (
                    "src/storage/auth_asset_callbacks.rs".to_owned(),
                    "sha256:7dd1bae86f73207f2695566ab302f33fceebffe248bd6bab1b0c0866ae8a7ca9"
                        .to_owned(),
                ),
                (
                    "src/storage/auth_grants.rs".to_owned(),
                    "sha256:9ccc7da5ba2877b1b31f0b55b81acae602a35229abd6feccd686a584f2e96cb7"
                        .to_owned(),
                ),
                (
                    "src/storage/auth_invalidation.rs".to_owned(),
                    "sha256:575782a9d656905c0a127ab6b2c0fd83d7951cc3452f0944b3c04e3df17a9099"
                        .to_owned(),
                ),
                (
                    "src/storage/auth_mode.rs".to_owned(),
                    "sha256:b35dd330712309a868c728cd5e18ab149cd8bda67254652cedc3ffe7d5d05134"
                        .to_owned(),
                ),
                (
                    "src/storage/auth_rescue.rs".to_owned(),
                    "sha256:42425bad49410ad0ad0d950d335b8cebe35d461904dc48697388236c3fe41bab"
                        .to_owned(),
                ),
                (
                    "src/storage/auth_scope_bases.rs".to_owned(),
                    "sha256:3ee8e5dca5fd0c2553ed03db02abba84a9dfcacc6eaeadbd953b11f8079b69ae"
                        .to_owned(),
                ),
                (
                    "src/storage/auth_sender.rs".to_owned(),
                    "sha256:98a4c79ecb113792a4d9c4898a0a2f476fd0d79d76f8dcb087186b017e114c80"
                        .to_owned(),
                ),
                (
                    "src/storage/auth_stream.rs".to_owned(),
                    "sha256:fd1a226b37d71dd4116ecdea283aad2b35852802cc2acd8a0155bd4f60113332"
                        .to_owned(),
                ),
                (
                    "src/storage/auth_throttle.rs".to_owned(),
                    "sha256:3b7c3af31d633222985e257a12b58dd26a8390b74d0d26b811eea2b908264d77"
                        .to_owned(),
                ),
                (
                    "src/storage/authorization.rs".to_owned(),
                    "sha256:1c26338d9cb79206135a594e48346e091aaca2a0d9ac07d102481249a10a1552"
                        .to_owned(),
                ),
                (
                    "src/storage/authorized_lease.rs".to_owned(),
                    "sha256:58fe02cd52bafbb03b1a0da1351df94705a71633dd6927fa0657597c65045a50"
                        .to_owned(),
                ),
                (
                    "src/storage/connections.rs".to_owned(),
                    "sha256:802f027db805e802487a51d16491e224430825aa5eb799669feba4785d605fdd"
                        .to_owned(),
                ),
                (
                    "src/storage/hosted_admission.rs".to_owned(),
                    "sha256:ee1a0b496f36b80949dbab122c2be72f91a4942d44365d509149b6cb38f385ac"
                        .to_owned(),
                ),
                (
                    "src/storage/migration_executor.rs".to_owned(),
                    "sha256:311cc20187790f82af6b6ce54899b2f50143098e9916d43413838f3c8e72635f"
                        .to_owned(),
                ),
                (
                    "src/storage/migration_scan.rs".to_owned(),
                    "sha256:43bfda997ab189b4ecdfa3d6fb8442487f26c57d86c6f21cd9ba1b8fa36a412c"
                        .to_owned(),
                ),
                (
                    "src/storage/projection_rebuild.rs".to_owned(),
                    "sha256:cdc288f51d056d284eac37337fa533f06e9c80e93085719ada2afa81b07ef0c5"
                        .to_owned(),
                ),
                (
                    "src/storage/schema_transition.rs".to_owned(),
                    "sha256:c91c85ef764082865c95059dc2ba755f23ea3eabc88b6260a2f08f8705957952"
                        .to_owned(),
                ),
                (
                    "src/storage/tests.rs".to_owned(),
                    "sha256:18aaaef5fcd5e3666964a5a97a5aa62612ad3286ecee55b75727ad9392960b02"
                        .to_owned(),
                ),
                (
                    "src/storage/write_authority.rs".to_owned(),
                    "sha256:d4f13836da07680ed8c359f20be5865ef1c131c23138bb73c151679ead7ac615"
                        .to_owned(),
                ),
            ])
        && carrier.schema_source_sha256
            == BTreeMap::from([(
                "packages/snapback-codegen/index.mjs".to_owned(),
                "sha256:fa836f52fd26aa1d4c3c30b97ebeb862e09b34a44dfb2c983c58e645b043fde3"
                    .to_owned(),
            )])
        && carrier.client_source_sha256
            == BTreeMap::from([
                (
                    "packages/snapback-client/local-read-admission.mjs".to_owned(),
                    "sha256:703f293078782ab3d595d518925be5b299ed7e26e19edc8ecef8c29627cc7900"
                        .to_owned(),
                ),
                (
                    "packages/snapback-client/materialization-bridge.mjs".to_owned(),
                    "sha256:e462be652f46faa365f329a9c238cc64da8e86c708af11631fb1348711615083"
                        .to_owned(),
                ),
                (
                    "packages/snapback-client/materialization-store.mjs".to_owned(),
                    "sha256:2891b4a20355862fbad7ac0bad90020a4ff5a7baea1fc7418bc69b2ac27d856d"
                        .to_owned(),
                ),
                (
                    "packages/snapback-client/materialization-store-runtime.mjs".to_owned(),
                    "sha256:46b280a00feb856b0fc44b2ce586cd51e65ed69d1890949793c91a7e84c75aa9"
                        .to_owned(),
                ),
                (
                    "packages/snapback-client/rqs-preload-core.mjs".to_owned(),
                    "sha256:6635964dd97069c68e42f88ff7d0ac74431b88204855afce30aa3def5b4d5286"
                        .to_owned(),
                ),
                (
                    "packages/snapback-client/store-runtime.mjs".to_owned(),
                    "sha256:bb205c7426d2627307b7412e9bf51f6ff4b428ece8960473995c2fbb283fa2bb"
                        .to_owned(),
                ),
            ])
        && carrier.package_closure_sha256.is_none()
        && carrier.build_provenance_requirement == "source-commit-and-embedded-carrier-sha256"
}

pub(super) fn local_persistent_store_receipts_qualified(
    carrier_exit_receipt_bytes: &[u8],
    triage_move1_receipt_bytes: &[u8],
    triage_budget_receipt_bytes: &[u8],
) -> bool {
    let (Ok(carrier_exit), Ok(triage_move1), Ok(triage_budget)) = (
        serde_json::from_slice::<Value>(carrier_exit_receipt_bytes),
        serde_json::from_slice::<Value>(triage_move1_receipt_bytes),
        serde_json::from_slice::<Value>(triage_budget_receipt_bytes),
    ) else {
        return false;
    };
    let leg_status = |name: &str| {
        carrier_exit["legs"]
            .as_array()
            .and_then(|legs| legs.iter().find(|leg| leg["leg"] == name))
            .and_then(|leg| leg["status"].as_str())
    };
    carrier_exit["schemaVersion"] == "snapback.local-persistent-store.carrier-exit.v1"
        && carrier_exit["partial"] == false
        && carrier_exit["summary"]["pass"].as_u64() == Some(17)
        && carrier_exit["summary"]["gap"].as_u64() == Some(0)
        && carrier_exit["summary"]["skipped"].as_u64() == Some(0)
        && leg_status("footprint-hydration-triage") == Some("PASS")
        && leg_status("footprint-hydration-fleet") == Some("PASS")
        && triage_move1["schemaVersion"] == "snapback.triage-graph.move1-exit.v1"
        && triage_move1["controlledRun"]["status"] == "PASS"
        && triage_move1["summary"]["blocked"].as_u64() == Some(0)
        && triage_move1["summary"]["pass"] == triage_move1["summary"]["total"]
        && triage_budget["schemaVersion"] == "snapback.triage-graph.budget-freeze.v1"
        && triage_move1["date"] == triage_budget["date"]
        && triage_move1["budgetFreeze"] == triage_budget
}

#[cfg(test)]
pub(super) fn local_persistent_store_publication_verified() -> bool {
    local_persistent_store_publication_verified_for(
        crate::identity::build_distribution(),
        "unknown",
        true,
        "debug",
        None,
        LOCAL_PERSISTENT_STORE_PUBLICATION_BYTES,
        LOCAL_PERSISTENT_STORE_PUBLICATION_ANCHOR_BYTES,
        LOCAL_PERSISTENT_STORE_CARRIER_EXIT_RECEIPT_BYTES,
        LOCAL_PERSISTENT_STORE_TRIAGE_MOVE1_RECEIPT_BYTES,
        LOCAL_PERSISTENT_STORE_TRIAGE_BUDGET_RECEIPT_BYTES,
    )
}

pub trait TargetCapabilityFactsExt: Sized {
    fn local_auth_aware() -> Self;
    #[cfg(test)]
    fn local_auth_aware_for_distribution(build_distribution: &str) -> Self;
    fn local_auth_aware_with_packaged_store_evidence(
        build_distribution: &str,
        git_commit: &str,
        git_dirty: bool,
        build_profile: &str,
        qualification_receipt_bytes: Option<&[u8]>,
        qualification_mode: bool,
    ) -> Self;
    fn conformance_auth_aware() -> Self;
    fn with_relation_activity_publication_withheld(self) -> Self;
    fn with_local_persistent_store_publication_withheld(self) -> Self;
    fn with_agent_safe_publication_withheld(self) -> Self;
    #[cfg(test)]
    fn with_sequence_allocation_publication_withheld(self) -> Self;
}

impl TargetCapabilityFactsExt for TargetCapabilityFacts {
    fn local_auth_aware() -> Self {
        let build_distribution = crate::identity::build_distribution();
        let identity = crate::identity::binary_identity();
        let (qualification_receipt_bytes, qualification_mode) =
            if build_distribution == crate::identity::BUILD_DISTRIBUTION_PUBLIC_PACKAGE {
                (
                    packaged_store_qualification_receipt_bytes(),
                    packaged_store_qualification_mode(),
                )
            } else {
                (None, false)
            };
        Self::local_auth_aware_with_packaged_store_evidence(
            build_distribution,
            &identity.git_commit,
            identity.git_dirty,
            &identity.build_profile,
            qualification_receipt_bytes,
            qualification_mode,
        )
    }

    #[cfg(test)]
    fn local_auth_aware_for_distribution(build_distribution: &str) -> Self {
        Self::local_auth_aware_with_packaged_store_evidence(
            build_distribution,
            "unknown",
            true,
            "debug",
            None,
            false,
        )
    }

    fn local_auth_aware_with_packaged_store_evidence(
        build_distribution: &str,
        git_commit: &str,
        git_dirty: bool,
        build_profile: &str,
        qualification_receipt_bytes: Option<&[u8]>,
        qualification_mode: bool,
    ) -> Self {
        let local_relation_activity_publication_v1_verified =
            local_relation_activity_publication_verified_for(
                build_distribution,
                LOCAL_RELATION_ACTIVITY_PUBLICATION_BYTES,
                LOCAL_RELATION_ACTIVITY_PUBLICATION_SHA256,
                LOCAL_RELATION_ACTIVITY_QUALIFICATION_RECEIPT_BYTES,
            );
        let local_sequence_allocation_publication_v1_verified =
            local_sequence_allocation_publication_verified_for(
                build_distribution,
                LOCAL_SEQUENCE_ALLOCATION_PUBLICATION_BYTES,
                LOCAL_SEQUENCE_ALLOCATION_PUBLICATION_SHA256,
                LOCAL_SEQUENCE_ALLOCATION_QUALIFICATION_RECEIPT_BYTES,
            );
        let local_agent_safe_storage_publication_v1_verified =
            crate::agent_safe_publication::storage_publication_verified_for_distribution(
                build_distribution,
            );
        let local_agent_safe_derived_fork_publication_v1_verified =
            crate::agent_safe_publication::derived_fork_publication_verified_for_distribution(
                build_distribution,
            );
        let receipt_verified = local_persistent_store_publication_verified_for(
            build_distribution,
            git_commit,
            git_dirty,
            build_profile,
            qualification_receipt_bytes,
            LOCAL_PERSISTENT_STORE_PUBLICATION_BYTES,
            LOCAL_PERSISTENT_STORE_PUBLICATION_ANCHOR_BYTES,
            LOCAL_PERSISTENT_STORE_CARRIER_EXIT_RECEIPT_BYTES,
            LOCAL_PERSISTENT_STORE_TRIAGE_MOVE1_RECEIPT_BYTES,
            LOCAL_PERSISTENT_STORE_TRIAGE_BUDGET_RECEIPT_BYTES,
        );
        // @ref LLP 0110#single-table-public-package-advertisement-amendment--2026-08-06
        // — the marked bootstrap exception exists only for an intact public-
        // package store carrier and cannot widen any other capability gate.
        let packaged_store_qualification_mode = qualification_mode
            && build_distribution == crate::identity::BUILD_DISTRIBUTION_PUBLIC_PACKAGE
            && packaged_store_identity_facts_are_qualified(
                env!("CARGO_PKG_VERSION"),
                git_commit,
                git_dirty,
                build_profile,
                build_distribution,
            )
            && local_persistent_store_contributor_chain_verified(
                LOCAL_PERSISTENT_STORE_PUBLICATION_BYTES,
                LOCAL_PERSISTENT_STORE_PUBLICATION_ANCHOR_BYTES,
                LOCAL_PERSISTENT_STORE_CARRIER_EXIT_RECEIPT_BYTES,
                LOCAL_PERSISTENT_STORE_TRIAGE_MOVE1_RECEIPT_BYTES,
                LOCAL_PERSISTENT_STORE_TRIAGE_BUDGET_RECEIPT_BYTES,
            );
        let local_persistent_store_publication_v1_verified =
            receipt_verified || packaged_store_qualification_mode;
        // @ref LLP 0109#166-the-manifest-is-an-executable-advertisement-gate — both local capability ids
        // are advertised only after the closed executable suite passes every
        // mandatory local row; LLP 0109 remains Review, so registry maturity
        // stays experimental until the author accepts the contract.
        Self {
            asset_lifecycle_local_fs_registered: true,
            media_ref_projection_v1_registered: true,
            media_collection_v1_registered: true,
            media_command_v1_registered: true,
            asset_image_finalization_registered: true,
            asset_reference_gc_registered: true,
            asset_video_finalization_registered: true,
            bounded_children_v1_registered: true,
            bounded_batch_reads_v1_registered: true,
            // @ref LLP 0135#26-maturity-and-the-experimental-dependency-acknowledgment
            //   — exact tuple execution, `sbsb1` custody, and first-page live
            //   replacement are registered together on the local target.
            snapshot_batch_v1_registered: true,
            // @ref LLP 0157#sbsb2-plaintext-and-budget — the mixed executor,
            // coordinated cursor family, and fixed first-page live posture
            // are one local registration; maturity remains experimental.
            snapshot_batch_v2_registered: true,
            // @ref LLP 0157#d1--the-node-algebra — registration enables
            // only the host-derived, single-node class; the publication
            // carrier below remains the independent support gate.
            single_table_v1_registered: true,
            bounded_response_stream_v1_registered: true,
            relational_query_v1_registered: true,
            // @ref LLP 0135#18-ceilings-receipts-and-capability — handler and
            // generated execution are registered independently from the
            // compiled §5.1 publication receipt checked below.
            sequence_allocation_v1_registered: true,
            migration_keyset_scan_v1_registered: true,
            full_text_search_v1_registered: true,
            // Authoring and closed carriers exist, but no wire/runtime/live
            // acceptance or publication receipt exists in this checkpoint.
            live_full_text_search_v1_registered: false,
            // @ref LLP 0132#capabilities-targets-and-staging — the local
            // exact SQLite adapter, synchronous maintenance, resumable
            // rebuild, runtime lane, and complete acceptance corpus are one
            // registered implementation. Facts below still have to match
            // exactly before the id can enter supportedCapabilities.
            vector_search_v1_registered: true,
            inline_handler_v1_registered: true,
            // @ref LLP 0070#non-goals-and-claim-boundary — registered means
            // the local enqueue/drain implementation exists; the id's
            // experimental maturity carries the Draft-status honesty.
            jobs_one_off_v1_registered: true,
            expo_push_seam_v1_registered: true,
            connected_client_predicate_registered: true,
            // @ref LLP 0043#target-settlement-ledger-capability-gate-2026-08-12 —
            // local SQLite owns `_snapback_client_mutations` in the same
            // transaction as the application write and can safely redeliver.
            client_mutation_settlement_ledger_registered: true,
            result_contract_v1_registered: true,
            // @ref LLP 0211#capability-and-maturity-the-llp-0134-publication-contract
            //   — the support flip is the separate reviewed act the Spec
            //   requires: performed 2026-08-10 on the author's acceptance of
            //   LLP 0211, with the Phase A acceptance corpus green at the
            //   landed 979f3aab5.
            structured_stored_value_v1_registered: true,
            settlement_bounded_skew_registered: true,
            args_contract_v1_registered: true,
            versioned_seed_install_v1_registered: true,
            versioned_seed_reset_v1_registered: true,
            paired_v1_parser_registered: true,
            shared_invocation_gate_registered: true,
            staged_mode_registered: true,
            host_plan_runtime: true,
            ibex_ctx_db_host_bridge_available: true,
            mutation_read_set_validator_registered: true,
            permission_epoch_resync_registered: true,
            // @ref LLP 0112#evidence-and-acceptance — the closed bundle DTO,
            // sender-bound mint/replay, socket-preflight handoff, expiry,
            // and generated-client adoption/cleanup suites jointly prove the
            // local/auth-aware target implementation behind this positive
            // experimental capability fact.
            registered_bundle_boot_v1_registered: true,
            // @ref LLP 0090#mixed-route-v2-implementation-amendment-2026-08-03
            // — one pinned multi-child snapshot, identity-derived liveness,
            // and live-only pending ownership are registered together.
            mixed_bundle_boot_v2_registered: true,
            write_activity_v1_registered: true,
            local_relation_activity_publication_v1_verified,
            local_sequence_allocation_publication_v1_verified,
            local_agent_safe_storage_publication_v1_verified,
            local_agent_safe_derived_fork_publication_v1_verified,
            local_persistent_store_publication_v1_verified,
            packaged_store_qualification_mode,
        }
    }

    fn conformance_auth_aware() -> Self {
        Self {
            bounded_children_v1_registered: false,
            snapshot_batch_v1_registered: false,
            snapshot_batch_v2_registered: false,
            single_table_v1_registered: false,
            mixed_bundle_boot_v2_registered: false,
            sequence_allocation_v1_registered: false,
            vector_search_v1_registered: false,
            ibex_ctx_db_host_bridge_available: false,
            // The conformance profile has no jobs worker/drain instance;
            // fail closed like the other local-only registrations.
            jobs_one_off_v1_registered: false,
            expo_push_seam_v1_registered: false,
            connected_client_predicate_registered: false,
            write_activity_v1_registered: false,
            local_relation_activity_publication_v1_verified: false,
            local_sequence_allocation_publication_v1_verified: false,
            local_agent_safe_storage_publication_v1_verified: false,
            local_agent_safe_derived_fork_publication_v1_verified: false,
            local_persistent_store_publication_v1_verified: false,
            packaged_store_qualification_mode: false,
            ..Self::local_auth_aware()
        }
    }

    fn with_relation_activity_publication_withheld(mut self) -> Self {
        self.bounded_children_v1_registered = false;
        self.snapshot_batch_v1_registered = false;
        self.write_activity_v1_registered = false;
        self.local_relation_activity_publication_v1_verified = false;
        self
    }

    fn with_local_persistent_store_publication_withheld(mut self) -> Self {
        self.single_table_v1_registered = false;
        self.local_persistent_store_publication_v1_verified = false;
        self.packaged_store_qualification_mode = false;
        self
    }

    fn with_agent_safe_publication_withheld(mut self) -> Self {
        self.local_agent_safe_storage_publication_v1_verified = false;
        self.local_agent_safe_derived_fork_publication_v1_verified = false;
        self
    }

    #[cfg(test)]
    fn with_sequence_allocation_publication_withheld(mut self) -> Self {
        self.sequence_allocation_v1_registered = false;
        self.local_sequence_allocation_publication_v1_verified = false;
        self
    }
}
trait ConnectedClientPredicateFactsExt {
    fn single_authority_v2() -> Self;
}

impl ConnectedClientPredicateFactsExt for ConnectedClientPredicateFactsV2 {
    fn single_authority_v2() -> Self {
        Self {
            capability_id: "realtime.connected-client-predicate".to_owned(),
            semantics_version: 2,
            freshness_budget_ms: 15_000,
            transport: ["managed-websocket", "authenticated-poll"]
                .into_iter()
                .map(str::to_owned)
                .collect(),
            authority_scope: "app-instance-process".to_owned(),
            aggregation_mode: "single-authority-routing".to_owned(),
        }
    }
}
trait AppCliTargetFactsExt {
    fn local_v1() -> Self;
}

impl AppCliTargetFactsExt for AppCliTargetFactsV1 {
    /// The local target's static support, both rows of §4's matrix at once.
    ///
    /// This is deliberately *static support*, which LLP 0012 keeps distinct
    /// from the target's *current* auth posture: the local target admits the
    /// dev-asserted lane on its dev tuple and human sessions on its sessions
    /// tuple, and the active tuple — reported by `/inspect` and by
    /// `/app-api/current` — says which applies right now. Advertising the
    /// union here and the posture there is what lets the engine refuse a
    /// mismatched lane as a target capability rather than a bug.
    ///
    /// The local target now advertises `agent` together with the exact live
    /// token cap because 0062-05 supplies the credentialed engine lane and
    /// exact-token release primitive. Transport locality remains an
    /// independent engine-side condition.
    fn local_v1() -> Self {
        Self {
            capability_id: "app-cli.target".to_owned(),
            principal_classes: vec![
                "anonymous".to_owned(),
                "dev".to_owned(),
                "session".to_owned(),
                "agent".to_owned(),
            ],
            serves_envelopes: true,
            accepts_generation_assertions: true,
            per_grant_token_cap: Some(
                crate::storage::auth_agent_credentials::SCOPED_TOKEN_LIVE_CAP as u32,
            ),
        }
    }
}
// Canonical capability-manifest rows for each LLP 0047 invocation-scoped
// limit. Query and mutation share the emitted `wall_clock_timeout` row;
// rows-read and rows-written remain separate counters. Platform rows such as
// `maximum_row_bytes` and `maximum_storage_bytes` describe different limits
// and therefore cannot stand in for either counter or the JavaScript heap.
//
// @ref LLP 0047#limits — every listed limit remains independently required.
// @ref LLP 0216#3-the-gap-list — G0 fixes the vocabulary while G4 remains the
//   follow-on that emits computed rows on a qualifying V8 target.
pub(super) const LLP_0047_UNTRUSTED_CODE_LIMIT_ROWS: [(&str, &[&str]); 8] = [
    ("query wall-clock timeout", &["wall_clock_timeout"]),
    ("mutation wall-clock timeout", &["wall_clock_timeout"]),
    ("action wall-clock timeout", &["action_wall_clock_timeout"]),
    ("CPU/instruction budget where available", &["cpu_budget"]),
    ("maximum response size", &["maximum_result_size"]),
    (
        "maximum rows read/written per invocation",
        &["maximum_rows_read", "maximum_rows_written"],
    ),
    ("maximum host-call count", &["maximum_host_call_count"]),
    (
        "maximum memory or heap size where available",
        &["maximum_heap_size"],
    ),
];

pub(super) const UNTRUSTED_CODE_REQUIRED_LIMITS: [&str; 8] = [
    LLP_0047_UNTRUSTED_CODE_LIMIT_ROWS[0].1[0],
    LLP_0047_UNTRUSTED_CODE_LIMIT_ROWS[2].1[0],
    LLP_0047_UNTRUSTED_CODE_LIMIT_ROWS[3].1[0],
    LLP_0047_UNTRUSTED_CODE_LIMIT_ROWS[4].1[0],
    LLP_0047_UNTRUSTED_CODE_LIMIT_ROWS[5].1[0],
    LLP_0047_UNTRUSTED_CODE_LIMIT_ROWS[5].1[1],
    LLP_0047_UNTRUSTED_CODE_LIMIT_ROWS[6].1[0],
    LLP_0047_UNTRUSTED_CODE_LIMIT_ROWS[7].1[0],
];

/// Decide only whether a target manifest carries the evidence profile required
/// to admit adversary-authored code. This is not an executor-availability
/// check: removing the composite gap and enforcing every LLP 0047 row are both
/// necessary, and owner-code runtime qualification supplies neither fact.
///
/// @ref LLP 0204#d6--code-mode-unified — untrusted code is a separate,
///   per-target evidenced capability; owner-code qualification never counts.
/// @ref LLP 0047#limits — every untrusted-execution resource limit must be
///   enforced, never advisory or missing.
pub(crate) fn untrusted_code_profile_evidenced(
    manifest: &CapabilityManifest,
) -> SnapbackResult<()> {
    let gap_declared = manifest
        .capability_gaps
        .iter()
        .any(|gap| gap == "hosted_untrusted_code");
    let unevidenced_limits = UNTRUSTED_CODE_REQUIRED_LIMITS
        .into_iter()
        .filter(|required| {
            let mut rows = manifest
                .resource_limits
                .iter()
                .filter(|limit| limit.name == *required);
            !matches!(
                (rows.next(), rows.next()),
                (
                    Some(ResourceLimit {
                        status: ResourceLimitStatus::Enforced,
                        ..
                    }),
                    None
                )
            )
        })
        .collect::<Vec<_>>();
    if !gap_declared && unevidenced_limits.is_empty() {
        return Ok(());
    }
    Err(SnapbackError::error(
        "SNAPBACK_API_RUN_UNTRUSTED_CODE_UNSUPPORTED",
        "api",
        "this target does not carry the evidenced untrusted-code execution profile",
    )
    .with_details(serde_json::json!({
        "targetProfileId": manifest.target_profile_id,
        "capabilityGap": "hosted_untrusted_code",
        "gapDeclared": gap_declared,
        "unevidencedLimits": unevidenced_limits,
    })))
}

#[cfg(test)]
mod untrusted_code_profile_tests {
    use super::*;

    #[test]
    fn required_limit_vocabulary_covers_llp_0047_limits_one_to_one() {
        // @ref LLP 0047#limits — the manifest vocabulary must keep every
        // invocation-scoped limit, including both row counters.
        assert_eq!(
            LLP_0047_UNTRUSTED_CODE_LIMIT_ROWS.map(|(limit, _)| limit),
            [
                "query wall-clock timeout",
                "mutation wall-clock timeout",
                "action wall-clock timeout",
                "CPU/instruction budget where available",
                "maximum response size",
                "maximum rows read/written per invocation",
                "maximum host-call count",
                "maximum memory or heap size where available",
            ]
        );

        let mut mapped_counts = BTreeMap::new();
        for (_, rows) in LLP_0047_UNTRUSTED_CODE_LIMIT_ROWS {
            assert!(!rows.is_empty(), "every LLP 0047 limit needs a row");
            for &row in rows {
                *mapped_counts.entry(row).or_insert(0_usize) += 1;
            }
        }
        let required = UNTRUSTED_CODE_REQUIRED_LIMITS
            .into_iter()
            .collect::<BTreeSet<_>>();
        assert_eq!(
            mapped_counts.keys().copied().collect::<BTreeSet<_>>(),
            required
        );
        assert_eq!(required.len(), UNTRUSTED_CODE_REQUIRED_LIMITS.len());
        assert_eq!(mapped_counts["wall_clock_timeout"], 2);
        for required in required {
            if required != "wall_clock_timeout" {
                assert_eq!(mapped_counts[required], 1);
            }
        }
    }

    #[test]
    fn local_manifest_refuses_untrusted_code_profile() {
        let error = untrusted_code_profile_evidenced(&CapabilityManifest::local_v0_declared())
            .expect_err("the local owner-code runtime is not an untrusted-code profile");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_API_RUN_UNTRUSTED_CODE_UNSUPPORTED"
        );
        assert_eq!(error.diagnostic.details["gapDeclared"], true);
        assert!(
            error.diagnostic.details["unevidencedLimits"]
                .as_array()
                .unwrap()
                .iter()
                .any(|limit| limit == "cpu_budget")
        );
    }

    #[test]
    fn every_committed_target_manifest_refuses_untrusted_code_profile() {
        let committed_manifests: [(&str, &[u8]); 5] = [
            (
                "local",
                include_bytes!(
                    "../../../../schemas/capability.manifest.local-dev-sqlite-ibex.json"
                ),
            ),
            (
                "local-outbound-actions",
                include_bytes!(
                    "../../../../schemas/capability.manifest.local-dev-sqlite-ibex.outbound-actions.json"
                ),
            ),
            (
                "remote-service",
                include_bytes!(
                    "../../../../schemas/capability.manifest.remote-service-sqlite-ibex.json"
                ),
            ),
            (
                "cloudflare",
                include_bytes!(
                    "../../../../cloudflare/generated/capability.manifest.cloudflare-do-sqlite-v8.json"
                ),
            ),
            (
                "cloudflare-all-aboard",
                include_bytes!(
                    "../../../../cloudflare/generated/capability.manifest.cloudflare-do-sqlite-v8.all-aboard.json"
                ),
            ),
        ];
        for (name, bytes) in committed_manifests {
            let manifest: CapabilityManifest = serde_json::from_slice(bytes)
                .unwrap_or_else(|error| panic!("{name} manifest must parse: {error}"));
            let error = match untrusted_code_profile_evidenced(&manifest) {
                Ok(()) => panic!("{name} must keep refusing untrusted code"),
                Err(error) => error,
            };
            assert_eq!(
                error.diagnostic.code, "SNAPBACK_API_RUN_UNTRUSTED_CODE_UNSUPPORTED",
                "{name}"
            );
        }
    }

    #[test]
    fn synthetic_exact_canonical_manifest_passes_with_gap_absent() {
        let mut manifest = CapabilityManifest::local_v0_declared();
        manifest
            .capability_gaps
            .retain(|gap| gap != "hosted_untrusted_code");
        manifest.resource_limits = UNTRUSTED_CODE_REQUIRED_LIMITS
            .into_iter()
            .map(|required| ResourceLimit {
                name: required.to_owned(),
                status: ResourceLimitStatus::Enforced,
            })
            .collect();
        untrusted_code_profile_evidenced(&manifest)
            .expect("the synthetic complete profile is accepted only as a gate fixture");
    }
}
/// The declared (instance-independent) capability gaps of the local v0
/// target. Instance-live adjustments — today only the `ibex_cli` gap when the
/// CLI is unavailable — are applied by `LocalSnapback::capability_gaps`.
///
/// @ref LLP 0037#decision-ratified-2026-07-02 — the Rust core is the single
/// source of truth for the capability manifest; the committed
/// `schemas/capability.manifest.local-dev-sqlite-ibex.json` is generated from
/// this declaration and embedded by codegen (LLP 0032 P2).
pub fn local_v0_default_capability_gaps() -> Vec<String> {
    vec![
        "postgres".to_owned(),
        "cloudflare".to_owned(),
        "hosted_untrusted_code".to_owned(),
        "external_auth".to_owned(),
        "outbound_actions".to_owned(),
        "bounded_response_stream_v1".to_owned(),
        "bounded_children_v1".to_owned(),
        "bounded_batch_reads_v1".to_owned(),
        "snapshot_batch_v1".to_owned(),
        "snapshot_batch_v2".to_owned(),
        "single_table_v1".to_owned(),
        "mixed_bundle_boot_v2".to_owned(),
        "notifications".to_owned(),
        "ephemeral_hosted_adapter".to_owned(),
        "ephemeral_multi_instance_sticky_routing".to_owned(),
        "write_activity_v1".to_owned(),
        "sequence_allocation_v1".to_owned(),
        "agent_safe_storage_v1".to_owned(),
        "agent_safe_derived_deployment_fork_v1".to_owned(),
    ]
}

pub(super) fn ensure_relation_activity_capability_gaps(gaps: &mut Vec<String>) {
    if !gaps.iter().any(|gap| gap == "bounded_children_v1") {
        let insertion = gaps
            .iter()
            .position(|gap| gap == "notifications")
            .unwrap_or(gaps.len());
        gaps.insert(insertion, "bounded_children_v1".to_owned());
    }
    if !gaps.iter().any(|gap| gap == "write_activity_v1") {
        gaps.push("write_activity_v1".to_owned());
    }
}

pub(super) fn ensure_bounded_batch_reads_capability_gap(gaps: &mut Vec<String>) {
    // @ref LLP 0248#d3-one-host-operation-one-authoritative-snapshot — only
    // the local Rust host implements the batch ops in this rollout; the
    // Cloudflare host-ops twin remains an explicit target gap.
    if !gaps.iter().any(|gap| gap == "bounded_batch_reads_v1") {
        let insertion = gaps
            .iter()
            .position(|gap| gap == "bounded_children_v1")
            .unwrap_or(gaps.len());
        gaps.insert(insertion, "bounded_batch_reads_v1".to_owned());
    }
}

pub(super) fn ensure_snapshot_batch_capability_gap(gaps: &mut Vec<String>) {
    if !gaps.iter().any(|gap| gap == "snapshot_batch_v1") {
        gaps.push("snapshot_batch_v1".to_owned());
    }
}

pub(super) fn ensure_snapshot_batch_v2_capability_gap(gaps: &mut Vec<String>) {
    if !gaps.iter().any(|gap| gap == "snapshot_batch_v2") {
        gaps.push("snapshot_batch_v2".to_owned());
    }
}

pub(super) fn ensure_single_table_capability_gap(gaps: &mut Vec<String>) {
    if !gaps.iter().any(|gap| gap == "single_table_v1") {
        gaps.push("single_table_v1".to_owned());
    }
}

pub(super) fn ensure_mixed_bundle_capability_gap(gaps: &mut Vec<String>) {
    if !gaps.iter().any(|gap| gap == "mixed_bundle_boot_v2") {
        gaps.push("mixed_bundle_boot_v2".to_owned());
    }
}

pub(super) fn ensure_agent_safe_capability_gaps(gaps: &mut Vec<String>) {
    let insertion_index = gaps
        .iter()
        .position(|gap| {
            gap == "agent_safe_storage_v1" || gap == "agent_safe_derived_deployment_fork_v1"
        })
        .unwrap_or(gaps.len());
    gaps.retain(|gap| {
        gap != "agent_safe_storage_v1" && gap != "agent_safe_derived_deployment_fork_v1"
    });
    gaps.splice(
        insertion_index..insertion_index,
        [
            "agent_safe_storage_v1".to_owned(),
            "agent_safe_derived_deployment_fork_v1".to_owned(),
        ],
    );
}

pub trait CapabilityManifestLocalExt: Sized {
    fn local_v0_declared() -> Self;
    fn local_v0(capability_gaps: Vec<String>) -> Self;
    fn local_v0_with_facts(
        capability_gaps: Vec<String>,
        capability_facts: TargetCapabilityFacts,
    ) -> Self;
    fn local_v0_outbound_actions_declared() -> Self;
    fn local_v0_instance(capability_gaps: Vec<String>, outbound_actions: bool) -> Self;
    fn remote_service_sqlite_ibex_declared() -> Self;
    fn conformance_workerd_v8(runtime_facts: Value) -> Self;
    fn cloudflare_do_sqlite_v8_declared() -> Self;
    fn cloudflare_do_sqlite_v8(runtime_facts: Value) -> Self;
    fn refresh_supported_capabilities(&mut self, facts: TargetCapabilityFacts);
    fn require_capability(&self, required: &str) -> SnapbackResult<TargetCapabilityId>;
    fn require_capability_acknowledging(
        &self,
        required: &str,
        acknowledged: &BTreeSet<TargetCapabilityId>,
    ) -> SnapbackResult<TargetCapabilityId>;
    fn require_capabilities<'a>(
        &self,
        required: impl IntoIterator<Item = &'a str>,
        acknowledged: &BTreeSet<TargetCapabilityId>,
    ) -> SnapbackResult<()>;
}

impl CapabilityManifestLocalExt for CapabilityManifest {
    /// The declared capability manifest of the local v0 target: what an agent
    /// may assume from the committed artifact alone. Instance-live facts
    /// (`vmLifecycle`, the `ibex_cli` gap) are reported by `/inspect`.
    fn local_v0_declared() -> Self {
        Self::local_v0(local_v0_default_capability_gaps())
    }

    fn local_v0(capability_gaps: Vec<String>) -> Self {
        Self::local_v0_with_facts(capability_gaps, TargetCapabilityFacts::local_auth_aware())
    }

    fn local_v0_with_facts(
        mut capability_gaps: Vec<String>,
        capability_facts: TargetCapabilityFacts,
    ) -> Self {
        ensure_agent_safe_capability_gaps(&mut capability_gaps);
        if capability_facts.local_relation_activity_publication_v1_verified {
            capability_gaps
                .retain(|gap| gap != "bounded_children_v1" && gap != "write_activity_v1");
        } else {
            ensure_relation_activity_capability_gaps(&mut capability_gaps);
        }
        if capability_facts.local_persistent_store_publication_v1_verified {
            capability_gaps.retain(|gap| gap != "single_table_v1");
        } else {
            ensure_single_table_capability_gap(&mut capability_gaps);
        }
        let mut manifest = Self {
            artifact_kind: capability_manifest_kind(),
            schema_version: snapback_schema_version(),
            target_profile_id: TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX.to_owned(),
            supported_artifact_versions: vec![ArtifactVersion::V0, ArtifactVersion::V1],
            supported_auth_modes: vec![AuthMode::Dev, AuthMode::Sessions],
            supported_artifact_auth_pairs: vec![
                SupportedArtifactAuthPair {
                    schema_version: ArtifactVersion::V0,
                    auth_mode: AuthMode::Dev,
                },
                SupportedArtifactAuthPair {
                    schema_version: ArtifactVersion::V1,
                    auth_mode: AuthMode::Sessions,
                },
            ],
            supported_capabilities: Vec::new(),
            capability_maturity: BTreeMap::new(),
            agent_safe: AgentSafeCapabilityExtensionV1::missing(),
            packaged_store_qualification_mode: capability_facts.packaged_store_qualification_mode,
            auth_protocols: Some(AuthProtocols::V1),
            hosted_auth: crate::auth::deployment::HostedAuthCapabilities::local_target(),
            storage_engine: "sqlite".to_owned(),
            runtime_engine: "ibex".to_owned(),
            local_server_lifecycle: true,
            live_subscriptions: true,
            syncable_live_queries: true,
            online_only_queries: true,
            replace_only_queries: true,
            ephemeral_realtime: true,
            ephemeral_websocket_publish: true,
            ephemeral_local_room_authority: true,
            ephemeral_hosted_adapter: false,
            offline_retention: true,
            optimistic_replay: true,
            mutation_isolation_mode: "handler-captured-read-set-validation".to_owned(),
            auth_impersonation: true,
            permission_diagnostics: false,
            asset_upload: true,
            outbound_actions: false,
            cron: true,
            notifications: false,
            expo_push_seam: Some(ExpoPushSeamFactsV1::local_v1()),
            connected_client_predicate: Some(ConnectedClientPredicateFactsV2::single_authority_v2()),
            migration: Some(MigrationTargetFacts::local_v1()),
            relational_queries: Some(RelationalQueryFacts::local_v1()),
            standard_patterns: Some(StandardPatternFacts::local_v1()),
            full_text_search: Some(FullTextSearchFactsV1::local_v1()),
            live_full_text_search: None,
            vector_search: capability_facts
                .vector_search_v1_registered
                .then(VectorSearchFactsV1::local_v1),
            assets: Some(crate::assets::AssetTargetFactsV1::local_v1()),
            app_cli_target: Some(AppCliTargetFactsV1::local_v1()),
            supported_query_forms: vec![
                "host-plan-single-table-eq".to_owned(),
                "host-plan-single-table-in".to_owned(),
                "host-plan-single-table-range".to_owned(),
                "host-plan-live-replace".to_owned(),
                "ibex-ctx-db-single-table-eq".to_owned(),
                "ibex-ctx-db-single-table-in".to_owned(),
                "ibex-ctx-db-single-table-range".to_owned(),
                "ibex-live-eq-replace".to_owned(),
                "ibex-live-in-replace".to_owned(),
                "ibex-live-range-replace".to_owned(),
                "ibex-live-limited-boundary-replace".to_owned(),
                "websocket-live-replace".to_owned(),
                "ephemeral-latest-state-local".to_owned(),
                "websocket-ephemeral-publish".to_owned(),
                "cron-fixed-interval-local".to_owned(),
                "cron-calendar-local".to_owned(),
                "cron-action-run-mutation".to_owned(),
            ],
            portability_opt_outs: Vec::new(),
            resource_limits: vec![
                ResourceLimit {
                    name: "wall_clock_timeout".to_owned(),
                    status: ResourceLimitStatus::Missing,
                },
                // ENG-23324: actions (the only egress-capable class) run
                // detached under a coarse wall-clock watchdog — the caller is
                // guaranteed an answer within the budget even when the VM
                // thread is stuck in a hung fetch. Queries/mutations still
                // have no timeout, so `wall_clock_timeout` above stays
                // honestly Missing.
                ResourceLimit {
                    name: "action_wall_clock_timeout".to_owned(),
                    status: ResourceLimitStatus::Enforced,
                },
                // @ref LLP 0076#surface — the v1 bounded response-stream
                // profile limits the local host actually checks. The 64 KiB
                // buffered-bytes bound is enforced structurally (one
                // in-flight 16 KiB pull per cursor x the 4-cursor cap) and
                // witnessed by a real per-invocation materialized-byte
                // counter with a slow-consumer high-water-mark test; the
                // wall row is the absolute mid-read ceiling.
                ResourceLimit {
                    name: "bounded_response_stream_total_bytes".to_owned(),
                    status: ResourceLimitStatus::Enforced,
                },
                ResourceLimit {
                    name: "bounded_response_stream_buffered_bytes".to_owned(),
                    status: ResourceLimitStatus::Enforced,
                },
                ResourceLimit {
                    name: "bounded_response_stream_read_bytes".to_owned(),
                    status: ResourceLimitStatus::Enforced,
                },
                ResourceLimit {
                    name: "bounded_response_stream_open_cursors".to_owned(),
                    status: ResourceLimitStatus::Enforced,
                },
                ResourceLimit {
                    name: "bounded_response_stream_wall_clock".to_owned(),
                    status: ResourceLimitStatus::Enforced,
                },
                ResourceLimit {
                    name: "bounded_response_stream_idle_timeout".to_owned(),
                    status: ResourceLimitStatus::Enforced,
                },
                ResourceLimit {
                    name: "bounded_response_stream_progress_rate".to_owned(),
                    status: ResourceLimitStatus::Enforced,
                },
                ResourceLimit {
                    name: "cpu_budget".to_owned(),
                    status: ResourceLimitStatus::Missing,
                },
                ResourceLimit {
                    name: "maximum_result_size".to_owned(),
                    // @ref LLP 0108#result-contract-vocabulary — every
                    // handler result now crosses the shared 4 MiB
                    // post-JSON-image validator before publication/commit.
                    status: ResourceLimitStatus::Enforced,
                },
                ResourceLimit {
                    name: "maximum_subscription_count".to_owned(),
                    // The local registry enforces the same 2,048-global /
                    // 64-per-connection ceilings as the hosted coordinator.
                    status: ResourceLimitStatus::Enforced,
                },
                ResourceLimit {
                    name: "ephemeral_value_size".to_owned(),
                    status: ResourceLimitStatus::Enforced,
                },
                ResourceLimit {
                    name: "ephemeral_publish_rate".to_owned(),
                    status: ResourceLimitStatus::Enforced,
                },
                ResourceLimit {
                    name: "ephemeral_durable_lane_priority".to_owned(),
                    status: ResourceLimitStatus::Enforced,
                },
            ],
            capability_gaps,
            // Current Ibex is owner-thread-affine, so every target uses the
            // conservative fresh-per-invocation lifecycle.
            vm_lifecycle: vm_lifecycle_fresh(),
            // @ref LLP 0248#d4-dependency-and-cost-evidence-remain-conservative
            // — codegen embeds these public profile ceilings from the Rust
            // target authority. Match cardinality and hidden-row outcomes can
            // never alter them.
            runtime_facts: Some(serde_json::json!({
                "boundedBatchReadsV1": bounded_batch_read_runtime_facts(),
            })),
        };
        // @ref LLP 0162#8-capability-honesty — target component facts are
        // reconstructed by exact Rust builders only after their independent
        // source-owned chains verify. App-effective remains Missing until the
        // exact loaded app and active writer manifest are intersected in Local.
        if capability_facts.local_agent_safe_storage_publication_v1_verified {
            manifest.agent_safe.target = crate::agent_safe_publication::storage_target_candidate();
        }
        if capability_facts.local_agent_safe_derived_fork_publication_v1_verified {
            manifest.agent_safe.target.forks.derived_deployment =
                crate::agent_safe_publication::derived_fork_target_candidate()
                    .forks
                    .derived_deployment;
        }
        manifest.refresh_supported_capabilities(capability_facts);
        manifest
    }

    /// The code-owned declaration for a local process configured with the
    /// outbound-action gate enabled. Codegen embeds this exact variant when
    /// its matching authoring switch is on, while `/inspect` remains the
    /// authority for the process that actually serves the artifact.
    fn local_v0_outbound_actions_declared() -> Self {
        Self::local_v0_instance(local_v0_default_capability_gaps(), true)
    }

    /// Apply the process-live outbound-action gate to the local declaration.
    /// The committed target artifact remains conservative; `/inspect` is the
    /// authority for whether this exact process enabled egress and therefore
    /// the bounded response-stream profile.
    // @ref LLP 0076#target-contract — capability truth is instance-live, not
    // a static declaration: the served manifest reflects this process.
    fn local_v0_instance(mut capability_gaps: Vec<String>, outbound_actions: bool) -> Self {
        if outbound_actions {
            capability_gaps
                .retain(|gap| gap != "outbound_actions" && gap != "bounded_response_stream_v1");
        }
        let mut manifest = Self::local_v0(capability_gaps);
        manifest.outbound_actions = outbound_actions;
        manifest.refresh_supported_capabilities(TargetCapabilityFacts::local_auth_aware());
        manifest
    }

    /// The declared capability manifest for an independently managed
    /// SQLite + Ibex service. This is deliberately derived from the standard
    /// server declaration: moving the same server behind an HTTPS authority
    /// does not change its data semantics. It changes exactly one capability
    /// fact — the consuming host must never start or stop the service.
    ///
    /// Endpoint and credential values are runtime-private host inputs and do
    /// not belong in this manifest or any generated application artifact.
    fn remote_service_sqlite_ibex_declared() -> Self {
        let mut manifest = Self::local_v0_declared();
        manifest.target_profile_id = TARGET_PROFILE_REMOTE_SERVICE_SQLITE_IBEX.to_owned();
        // Target support never inherits across projections. A future local
        // publication must not silently widen this independently managed arm.
        manifest.agent_safe = AgentSafeCapabilityExtensionV1::missing();
        manifest.local_server_lifecycle = false;
        manifest.full_text_search = None;
        manifest.vector_search = None;
        // The asset subsystem's evidence is local-target only (LLP 0044:
        // "local support does not imply hosted support"); the served-origin
        // profile withholds the claim until its own suite runs.
        manifest.assets = None;
        manifest.asset_upload = false;
        manifest.capability_gaps.push("assets".to_owned());
        // LLP 0062 §4: the remote-service row is admissible "once it
        // advertises `app-cli.target`" — until that qualification runs the
        // engine must treat it as capability-absent, so the descriptor is
        // withheld rather than inherited from the local declaration.
        manifest.app_cli_target = None;
        manifest.expo_push_seam = None;
        manifest.connected_client_predicate = None;
        manifest
            .capability_gaps
            .push("notifications.expoPushSeam".to_owned());
        manifest
            .capability_gaps
            .push("realtime.connected-client-predicate".to_owned());
        ensure_relation_activity_capability_gaps(&mut manifest.capability_gaps);
        let mut facts = TargetCapabilityFacts::local_auth_aware()
            .with_relation_activity_publication_withheld()
            .with_local_persistent_store_publication_withheld()
            // @ref LLP 0162#8-capability-honesty — a local publication may
            // not become evidence for this independently qualified target.
            .with_agent_safe_publication_withheld();
        facts.full_text_search_v1_registered = false;
        facts.vector_search_v1_registered = false;
        facts.asset_lifecycle_local_fs_registered = false;
        facts.asset_image_finalization_registered = false;
        facts.asset_reference_gc_registered = false;
        facts.asset_video_finalization_registered = false;
        manifest.refresh_supported_capabilities(facts);
        manifest
    }

    /// The LLP 0048 conformance twin's internal manifest: the local target's
    /// declaration with the executor swapped and the limits the workerd leg
    /// actually enforces. `runtime_facts` carries the computed values —
    /// workerd version, compat pins, kill domain, measured wall-clock budget
    /// — per DK-5's computed-not-asserted rule. Deliberately NOT a public
    /// target profile (LLP 0048 §Non-goals).
    fn conformance_workerd_v8(runtime_facts: Value) -> Self {
        let mut manifest = Self::local_v0(local_v0_default_capability_gaps());
        manifest.target_profile_id = TARGET_PROFILE_LOCAL_CONFORMANCE_SQLITE_WORKERD_V8.to_owned();
        manifest.agent_safe = AgentSafeCapabilityExtensionV1::missing();
        manifest.runtime_engine = "workerd-v8".to_owned();
        manifest.full_text_search = None;
        manifest.vector_search = None;
        // Ephemeral, cron, and actions stay on the canonical server; the twin
        // swaps only query/mutation handler execution.
        manifest
            .capability_gaps
            .push("v8_action_execution".to_owned());
        // Same asset withholding as the served-origin profile: the twin
        // proves handler execution, not the asset subsystem.
        manifest.assets = None;
        manifest.asset_upload = false;
        manifest.capability_gaps.push("assets".to_owned());
        // The conformance twin proves handler execution, not the app-CLI
        // surface: it serves no envelopes and has no row in §4's matrix.
        manifest.app_cli_target = None;
        manifest.expo_push_seam = None;
        manifest.connected_client_predicate = None;
        manifest
            .capability_gaps
            .push("notifications.expoPushSeam".to_owned());
        manifest
            .capability_gaps
            .push("realtime.connected-client-predicate".to_owned());
        for withheld in [
            TargetCapabilityId::AssetLifecycleV1,
            TargetCapabilityId::AssetImageFinalizationV1,
            TargetCapabilityId::AssetImagePipelineV1,
        ] {
            manifest
                .supported_capabilities
                .retain(|capability| *capability != withheld);
            manifest.capability_maturity.remove(&withheld);
        }
        ensure_relation_activity_capability_gaps(&mut manifest.capability_gaps);
        manifest.vm_lifecycle = "fresh-process-per-invocation".to_owned();
        for limit in &mut manifest.resource_limits {
            // The service boundary makes wall-clock enforcement real on this
            // leg (LLP 0047 via LLP 0048 §Limits testbed): the host owns the
            // workerd process and kills it. cpu_budget stays honestly
            // Missing — workerd offers no per-worker CPU budget locally.
            if limit.name == "wall_clock_timeout" {
                limit.status = ResourceLimitStatus::Enforced;
            }
        }
        manifest.runtime_facts = Some(runtime_facts);
        manifest.refresh_supported_capabilities(TargetCapabilityFacts::conformance_auth_aware());
        manifest
    }

    /// The LLP 0040 Cloudflare narrow-proof capability manifest
    /// (`cloudflare-do-sqlite-v8`). Distinct from `local-dev-sqlite-ibex`; its
    /// missing features are product facts, not TODO comments (LLP 0040
    /// §Capability report). Storage is the coordinator Durable Object's
    /// embedded SQLite; the runtime is V8; the live transport is
    /// Durable-Object-owned hibernating WebSockets. Runtime facts are
    /// declared platform/deployment facts here; decisive measurements live in
    /// the generated benchmark/acceptance reports, not in this static
    /// manifest.
    fn cloudflare_do_sqlite_v8_declared() -> Self {
        Self::cloudflare_do_sqlite_v8(serde_json::json!({
            "platform": "cloudflare-workers",
            "storage": "durable-object-sqlite",
            "liveTransport": "durable-object-websocket-hibernation",
            "versionAuthority": "coordinator-durable-object",
            "commit": "single-transactionSync (version + rows + journal)",
            "maxRowBytes": 2_000_000,
            "maxObjectStorageBytes": 10_000_000_000_i64,
            "maxSubscriptionsGlobal": 2_048,
            "maxSubscriptionsPerConnection": 64,
            "maxSubscriptionArgsBytes": 32_768,
            "maxLegacyProofSockets": 128,
            "maxAcceptedSockets": 256,
            "maxSocketsPerConnection": 2,
            "wallClockNote": "enforced by the platform (object/request kill); measured value in the benchmark report",
            "codeHotLoad": "missing — deployed Workers forbid dynamic eval; an app-code change is a deploy",
            "handlerHarness": "single-sourced LLP 0048 harness (packages/snapback-harness)",
        }))
    }

    fn cloudflare_do_sqlite_v8(runtime_facts: Value) -> Self {
        let mut manifest = Self::local_v0(local_v0_default_capability_gaps());
        manifest.target_profile_id = TARGET_PROFILE_CLOUDFLARE_DO_SQLITE_V8.to_owned();
        manifest.agent_safe = AgentSafeCapabilityExtensionV1::missing();
        manifest.full_text_search = None;
        manifest.vector_search = None;
        // No asset subsystem on the DO target: bytes, staging, and strict
        // delivery are unimplemented there (the committed gap row stands).
        manifest.assets = None;
        manifest.asset_upload = false;
        manifest.capability_gaps.push("assets".to_owned());
        // LLP 0062 §4 puts hosted **out of phase 1**: no hosted target
        // ingests or serves envelopes today. Withholding is the honest
        // capability-absent report; inheriting local's descriptor would
        // advertise principal classes and an envelope surface this target
        // does not have.
        manifest.app_cli_target = None;
        manifest.expo_push_seam = None;
        manifest.connected_client_predicate = None;
        manifest.supported_artifact_versions = vec![ArtifactVersion::V0];
        manifest.supported_auth_modes = vec![AuthMode::Dev];
        manifest.supported_artifact_auth_pairs = vec![SupportedArtifactAuthPair {
            schema_version: ArtifactVersion::V0,
            auth_mode: AuthMode::Dev,
        }];
        manifest.auth_protocols = None;
        manifest.hosted_auth = crate::auth::deployment::HostedAuthCapabilities::no_auth_target();
        manifest.storage_engine = "durable-object-sqlite".to_owned();
        manifest.runtime_engine = "v8".to_owned();
        manifest.local_server_lifecycle = false;
        manifest.vm_lifecycle = "fresh-isolate-per-deploy".to_owned();
        // The narrow proof has no external auth adapter and does not
        // impersonate users on the deployed Cloudflare target (ENG-23589).
        manifest.auth_impersonation = false;
        // Honest isolation claim (ENG-23575): the coordinator records captured
        // reads but does not yet VALIDATE them at commit; what it enforces is a
        // per-object mutex serializing handler execution + commit (and
        // subscription snapshot + registration). Do not inherit the local
        // target's read-set-validation claim.
        manifest.mutation_isolation_mode = "coordinator-serialized-invocations".to_owned();
        // The ephemeral/presence lane, cron, and the durable-only local
        // niceties are not in the narrow proof; report them honestly.
        manifest.ephemeral_realtime = false;
        manifest.ephemeral_websocket_publish = false;
        manifest.ephemeral_local_room_authority = false;
        // Do not inherit newer local-only queued/offline semantics as the
        // local profile grows. This hosted proof has no retained offline
        // journal or optimistic replay engine; its capability gap below is
        // the matching machine-readable refusal.
        manifest.offline_retention = false;
        manifest.optimistic_replay = false;
        manifest.cron = false;
        // No migration executor on this target: absence of the fact block
        // is the machine-readable refusal (LLP 0081 §4).
        manifest.migration = None;
        // No relational executor on this target: the `relational_query_v1`
        // capability gap is the machine-readable refusal, so the fact block
        // must not ride along from the local profile (LLP 0080 §2).
        manifest.relational_queries = None;
        // The narrow Cloudflare proof has no standard-pattern runtime
        // support (no cursor keyring, no pattern admission gates); loading
        // pattern-identified functions there is outside the proof, so no
        // fact block is claimed.
        manifest.standard_patterns = None;
        // The proof's supported query subset is single-table only (LLP 0040
        // §Measurements: evidence for the supported query subset only).
        manifest.supported_query_forms = vec![
            "ibex-ctx-db-single-table-eq".to_owned(),
            "ibex-ctx-db-single-table-in".to_owned(),
            "ibex-ctx-db-single-table-range".to_owned(),
            "v8-live-eq-replace".to_owned(),
            "websocket-live-replace".to_owned(),
        ];
        // The gaps the narrow proof does not close (LLP 0040 §App subset /
        // §Non-goals). `code_hot_load` is structural: the deployed Workers
        // runtime forbids dynamic eval, so an app-code change is a deploy.
        manifest.capability_gaps = vec![
            "offline_mutation_replay".to_owned(),
            "postgres".to_owned(),
            "hosted_untrusted_code".to_owned(),
            "external_auth".to_owned(),
            "auth_impersonation".to_owned(),
            "handler_captured_read_set_validation".to_owned(),
            "assets".to_owned(),
            "outbound_actions".to_owned(),
            "bounded_response_stream_v1".to_owned(),
            "bounded_batch_reads_v1".to_owned(),
            "bounded_children_v1".to_owned(),
            "snapshot_batch_v1".to_owned(),
            "snapshot_batch_v2".to_owned(),
            "notifications".to_owned(),
            "notifications.expoPushSeam".to_owned(),
            "realtime.connected-client-predicate".to_owned(),
            "cron".to_owned(),
            "ephemeral_realtime".to_owned(),
            "code_hot_load".to_owned(),
            "multiple_apps_per_deployment".to_owned(),
            "hosted_marketplace".to_owned(),
            "retained_version_resume".to_owned(),
            "write_activity_v1".to_owned(),
            "sequence_allocation_v1".to_owned(),
            "agent_safe_storage_v1".to_owned(),
            "agent_safe_derived_deployment_fork_v1".to_owned(),
        ];
        manifest.resource_limits = vec![
            // V8 wall-clock is enforced by the platform (the object/request is
            // killed); measured value carried in runtime_facts.
            ResourceLimit {
                name: "wall_clock_timeout".to_owned(),
                status: ResourceLimitStatus::Enforced,
            },
            ResourceLimit {
                name: "cpu_budget".to_owned(),
                status: ResourceLimitStatus::Enforced,
            },
            // The 2 MB row/BLOB cap is a hard platform limit (LLP 0014
            // one-way door 8) — a declared divergence from the local target.
            ResourceLimit {
                name: "maximum_row_bytes".to_owned(),
                status: ResourceLimitStatus::Enforced,
            },
            ResourceLimit {
                name: "maximum_storage_bytes".to_owned(),
                status: ResourceLimitStatus::Enforced,
            },
            ResourceLimit {
                name: "maximum_subscription_count".to_owned(),
                status: ResourceLimitStatus::Enforced,
            },
        ];
        manifest.runtime_facts = Some(runtime_facts);
        manifest.refresh_supported_capabilities(TargetCapabilityFacts::default());
        manifest
    }

    fn refresh_supported_capabilities(&mut self, facts: TargetCapabilityFacts) {
        self.packaged_store_qualification_mode = facts.packaged_store_qualification_mode;
        self.supported_capabilities = TargetCapabilityId::ALL
            .into_iter()
            .filter(|capability| capability.is_supported_by(self, facts))
            .collect();
        if self
            .supported_capabilities
            .contains(&TargetCapabilityId::BoundedBatchReadsV1)
        {
            self.capability_gaps
                .retain(|gap| gap != "bounded_batch_reads_v1");
        } else {
            ensure_bounded_batch_reads_capability_gap(&mut self.capability_gaps);
        }
        if self
            .supported_capabilities
            .contains(&TargetCapabilityId::SequenceAllocationV1)
        {
            self.capability_gaps
                .retain(|gap| gap != "sequence_allocation_v1");
        } else if !self
            .capability_gaps
            .iter()
            .any(|gap| gap == "sequence_allocation_v1")
        {
            self.capability_gaps
                .push("sequence_allocation_v1".to_owned());
        }
        // @ref LLP 0135#26-maturity-and-the-experimental-dependency-acknowledgment
        //   — static maturity and runtime support stay separate. Only the
        //   exact contributor local target can satisfy the dedicated executor
        //   fact plus every bounded/live dependency below.
        if self
            .supported_capabilities
            .contains(&TargetCapabilityId::SnapshotBatchV1)
        {
            self.capability_gaps
                .retain(|gap| gap != "snapshot_batch_v1");
        } else {
            ensure_snapshot_batch_capability_gap(&mut self.capability_gaps);
        }
        // @ref LLP 0157#d1--the-node-algebra — registration and maturity do
        // not let remote/hosted targets inherit the local mixed executor.
        if self
            .supported_capabilities
            .contains(&TargetCapabilityId::SnapshotBatchV2)
        {
            self.capability_gaps
                .retain(|gap| gap != "snapshot_batch_v2");
        } else {
            ensure_snapshot_batch_v2_capability_gap(&mut self.capability_gaps);
        }
        if self
            .supported_capabilities
            .contains(&TargetCapabilityId::SingleTableV1)
        {
            self.capability_gaps.retain(|gap| gap != "single_table_v1");
        } else {
            ensure_single_table_capability_gap(&mut self.capability_gaps);
        }
        if self
            .supported_capabilities
            .contains(&TargetCapabilityId::MixedBundleBootV2)
        {
            self.capability_gaps
                .retain(|gap| gap != "mixed_bundle_boot_v2");
        } else {
            ensure_mixed_bundle_capability_gap(&mut self.capability_gaps);
        }
        if self
            .supported_capabilities
            .contains(&TargetCapabilityId::LiveFullTextSearchV1)
        {
            self.capability_gaps
                .retain(|gap| gap != "live_full_text_search_v1");
        } else if !self
            .capability_gaps
            .iter()
            .any(|gap| gap == "live_full_text_search_v1")
        {
            self.capability_gaps
                .push("live_full_text_search_v1".to_owned());
        }
        if self
            .supported_capabilities
            .contains(&TargetCapabilityId::VectorSearchV1)
        {
            self.capability_gaps
                .retain(|gap| gap != crate::vector::types::VECTOR_CAPABILITY);
        } else {
            // A derived target constructor can start from the local shape,
            // but it may not inherit target authority merely by retaining a
            // sibling fact block. Unsupported means absent plus GAP.
            self.vector_search = None;
            if !self
                .capability_gaps
                .iter()
                .any(|gap| gap == crate::vector::types::VECTOR_CAPABILITY)
            {
                self.capability_gaps
                    .push(crate::vector::types::VECTOR_CAPABILITY.to_owned());
            }
        }
        // Re-establish the closed pair at its original position before
        // support removes either member. Derived targets can inherit a local
        // declaration where storage was published and therefore absent from
        // the GAP list; appending it at the tail would make their committed
        // projection order depend on a sibling target's publication state.
        ensure_agent_safe_capability_gaps(&mut self.capability_gaps);
        for id in [
            TargetCapabilityId::AgentSafeStorageV1,
            TargetCapabilityId::AgentSafeDerivedDeploymentForkV1,
        ] {
            if self.supported_capabilities.contains(&id) {
                self.capability_gaps.retain(|gap| gap != id.as_str());
            } else if !self.capability_gaps.iter().any(|gap| gap == id.as_str()) {
                self.capability_gaps.push(id.as_str().to_owned());
            }
        }
        // @ref LLP 0058#capability-maturity — the maturity map annotates
        // exactly the emitted support set; stable ids are omitted, so a
        // manifest with only stable support serializes without the field.
        self.capability_maturity = self
            .supported_capabilities
            .iter()
            .filter(|capability| capability.maturity() != CapabilityMaturity::Stable)
            .map(|capability| (*capability, capability.maturity()))
            .collect();
    }

    /// Validate one app-artifact requirement against the closed registry and
    /// this target's positive support set. Candidate claims and missing gaps
    /// are deliberately irrelevant. Callers with no acknowledgment channel
    /// get stable-only semantics: an experimental capability is refused
    /// exactly like unsupported one, because an experimental entry is not the
    /// plain 0058 compatibility assertion (LLP 0058 §Capability maturity).
    fn require_capability(&self, required: &str) -> SnapbackResult<TargetCapabilityId> {
        self.require_capability_acknowledging(required, &BTreeSet::new())
    }

    /// Requirement resolution with the artifact's experimental
    /// acknowledgments (LLP 0058 §Capability maturity, amendment 2026-07-24).
    /// A required id whose registry maturity is not `stable` admits only when
    /// the requiring artifact lists it in
    /// `acknowledgedExperimentalCapabilities`; acknowledging a stable id is a
    /// harmless no-op, so acknowledgments survive the capability's later
    /// promotion to stable unchanged.
    fn require_capability_acknowledging(
        &self,
        required: &str,
        acknowledged: &BTreeSet<TargetCapabilityId>,
    ) -> SnapbackResult<TargetCapabilityId> {
        let capability = required.parse::<TargetCapabilityId>().map_err(|()| {
            SnapbackError::error(
                "SNAPBACK_CAPABILITY_UNSUPPORTED",
                "capability",
                format!("unknown required target capability {required}"),
            )
            .with_details(serde_json::json!({ "capability": required }))
        })?;
        if !self.supported_capabilities.contains(&capability) {
            return Err(SnapbackError::error(
                "SNAPBACK_CAPABILITY_UNSUPPORTED",
                "capability",
                format!("target does not support required capability {required}"),
            )
            .with_details(serde_json::json!({ "capability": required })));
        }
        let maturity = capability.maturity();
        if maturity != CapabilityMaturity::Stable && !acknowledged.contains(&capability) {
            return Err(SnapbackError::error(
                "SNAPBACK_CAPABILITY_UNSUPPORTED",
                "capability",
                format!(
                    "target supports required capability {required} only at {} maturity, \
                     which is not plain support; the requiring artifact must list it in \
                     acknowledgedExperimentalCapabilities",
                    maturity.as_str()
                ),
            )
            .with_details(serde_json::json!({
                "capability": required,
                "maturity": maturity.as_str(),
                "acknowledged": false,
            })));
        }
        Ok(capability)
    }

    fn require_capabilities<'a>(
        &self,
        required: impl IntoIterator<Item = &'a str>,
        acknowledged: &BTreeSet<TargetCapabilityId>,
    ) -> SnapbackResult<()> {
        for capability in required {
            self.require_capability_acknowledging(capability, acknowledged)?;
        }
        Ok(())
    }
}
#[cfg(test)]
mod agent_safe_capability_tests {
    use super::*;
    use serde_json::json;

    fn owner_fact(profile: AgentSafeExplanationProfileV1) -> AgentSafeScopedExplanationFactV1 {
        AgentSafeScopedExplanationFactV1 {
            scope: AgentSafeExplanationScopeV1 {
                logical_lane: AgentSafeExplanationLogicalLaneV1::OrdinaryMutation,
                adapter: AgentSafeExplanationAdapterV1::HostPlan,
                access: AgentSafeExplanationAccessV1::PublicCurrentPolicy,
                profile,
            },
            class: AgentSafeExplanationClassV1 {
                detail: AgentSafeExplanationDetailV1::BoundedFacts,
                retention: AgentSafeExplanationRetentionV1::PolicyBounded,
            },
        }
    }

    #[test]
    fn agent_safe_registry_ids_are_experimental_and_independently_published() {
        for (wire, id) in [
            (
                "agent_safe_storage_v1",
                TargetCapabilityId::AgentSafeStorageV1,
            ),
            (
                "agent_safe_derived_deployment_fork_v1",
                TargetCapabilityId::AgentSafeDerivedDeploymentForkV1,
            ),
        ] {
            assert_eq!(wire.parse::<TargetCapabilityId>(), Ok(id));
            assert_eq!(id.maturity(), CapabilityMaturity::Experimental);
            let local = CapabilityManifest::local_v0_declared();
            let expected_local = match id {
                TargetCapabilityId::AgentSafeStorageV1 => {
                    crate::agent_safe_publication::storage_publication_verified()
                }
                TargetCapabilityId::AgentSafeDerivedDeploymentForkV1 => {
                    crate::agent_safe_publication::derived_fork_publication_verified()
                }
                _ => unreachable!(),
            };
            assert_eq!(
                id.is_supported_by(&local, TargetCapabilityFacts::local_auth_aware()),
                expected_local,
            );
            assert_eq!(local.supported_capabilities.contains(&id), expected_local);

            for manifest in [
                CapabilityManifest::remote_service_sqlite_ibex_declared(),
                CapabilityManifest::cloudflare_do_sqlite_v8(json!({})),
            ] {
                assert!(!id.is_supported_by(&manifest, TargetCapabilityFacts::local_auth_aware()));
                assert!(!manifest.supported_capabilities.contains(&id));
            }
        }
    }

    #[test]
    fn remote_projection_withholds_even_verified_local_agent_safe_publications() {
        let local_published = TargetCapabilityFacts {
            local_agent_safe_storage_publication_v1_verified: true,
            local_agent_safe_derived_fork_publication_v1_verified: true,
            ..TargetCapabilityFacts::local_auth_aware()
        };
        let remote = local_published.with_agent_safe_publication_withheld();

        assert!(!remote.local_agent_safe_storage_publication_v1_verified);
        assert!(!remote.local_agent_safe_derived_fork_publication_v1_verified);

        let mut inherited_gaps = vec![
            "before".to_owned(),
            "agent_safe_derived_deployment_fork_v1".to_owned(),
            "after".to_owned(),
        ];
        ensure_agent_safe_capability_gaps(&mut inherited_gaps);
        assert_eq!(
            inherited_gaps,
            [
                "before",
                "agent_safe_storage_v1",
                "agent_safe_derived_deployment_fork_v1",
                "after",
            ]
        );
    }

    #[test]
    fn agent_safe_public_projections_are_present_closed_and_target_scoped() {
        for manifest in [
            CapabilityManifest::local_v0_declared(),
            CapabilityManifest::remote_service_sqlite_ibex_declared(),
            CapabilityManifest::conformance_workerd_v8(json!({})),
            CapabilityManifest::cloudflare_do_sqlite_v8(json!({})),
        ] {
            let is_local = manifest.target_profile_id == TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX;
            let storage_published =
                is_local && crate::agent_safe_publication::storage_publication_verified();
            let expected_target = if storage_published {
                crate::agent_safe_publication::storage_target_candidate()
            } else {
                AgentSafeCapabilityFactsV1::missing()
            };
            assert_eq!(manifest.agent_safe.target, expected_target);
            assert_eq!(
                manifest.agent_safe.app_effective,
                AgentSafeCapabilityFactsV1::missing(),
                "the static target declaration never invents app-effective coverage",
            );
            assert_eq!(
                manifest
                    .capability_gaps
                    .iter()
                    .any(|gap| gap == "agent_safe_storage_v1"),
                !storage_published,
                "{} storage GAP disagrees with its exact publication chain",
                manifest.target_profile_id,
            );
            assert!(
                manifest
                    .capability_gaps
                    .iter()
                    .any(|gap| gap == "agent_safe_derived_deployment_fork_v1"),
                "{} must expose the additive fork GAP",
                manifest.target_profile_id,
            );
            assert_eq!(
                manifest
                    .supported_capabilities
                    .contains(&TargetCapabilityId::AgentSafeStorageV1),
                storage_published,
                "only the exact local storage chain may publish",
            );
            assert!(
                !manifest
                    .supported_capabilities
                    .contains(&TargetCapabilityId::AgentSafeDerivedDeploymentForkV1)
            );
        }
    }

    #[test]
    fn agent_safe_target_and_app_effective_are_independent_fail_closed_facts() {
        let mut candidate = AgentSafeCapabilityExtensionV1::missing();
        candidate.app_effective.envelope.ordinary_mutation.host_plan =
            AgentSafeEnvelopeCoverageV1::Covered;
        assert_eq!(
            candidate.validate(),
            Err("appEffective facts exceed target support"),
            "app-effective coverage cannot mint target support",
        );

        let create = owner_fact(AgentSafeExplanationProfileV1::GeneratedOwnedCrudOwnerCreateV1);
        let update = owner_fact(AgentSafeExplanationProfileV1::GeneratedOwnedCrudOwnerUpdateV1);
        let mut scoped = AgentSafeCapabilityExtensionV1::missing();
        scoped.target.explanation.scoped_facts = vec![create.clone(), update];
        scoped.app_effective.explanation.scoped_facts = vec![create];
        assert_eq!(
            scoped.validate(),
            Ok(()),
            "appEffective may honestly select a strict subset of target explanation profiles",
        );
    }

    #[test]
    fn agent_safe_fork_axes_and_aggregate_requirements_are_exact() {
        let mut partial = AgentSafeCapabilityExtensionV1::missing();
        partial.target.forks.derived_deployment.egress = AgentSafeForkEgressV1::DenyAll;
        assert_eq!(
            partial.validate(),
            Err("fork facts must be wholly Missing or declare every axis")
        );

        let mut bad_fork = AgentSafeCapabilityExtensionV1::missing();
        bad_fork.target.forks.in_app = AgentSafeForkAxesV1 {
            egress: AgentSafeForkEgressV1::DenyAll,
            promotion: AgentSafeForkPromotionV1::Promotable,
            base: AgentSafeForkBaseV1::NamedCheckpoint,
            isolation: AgentSafeForkIsolationV1::HostMediated,
        };
        assert_eq!(
            bad_fork.validate(),
            Err("Promotable forks require currentHead base")
        );

        let mut exact_derived = AgentSafeCapabilityExtensionV1::missing();
        exact_derived.target.forks.derived_deployment = AgentSafeForkAxesV1 {
            egress: AgentSafeForkEgressV1::DenyAll,
            promotion: AgentSafeForkPromotionV1::NotPromotable,
            base: AgentSafeForkBaseV1::CurrentHead,
            isolation: AgentSafeForkIsolationV1::HostMediated,
        };
        assert_eq!(exact_derived.validate(), Ok(()));

        let mut aggregate = AgentSafeCapabilityExtensionV1::missing();
        aggregate.target.aggregate.core = AgentSafeAggregateStateV1::Supported;
        assert_eq!(
            aggregate.validate(),
            Err("agent-safe aggregates require a separately verified publication carrier")
        );
    }

    #[test]
    fn agent_safe_explanation_scopes_are_closed_sorted_and_unique() {
        let create = owner_fact(AgentSafeExplanationProfileV1::GeneratedOwnedCrudOwnerCreateV1);
        let update = owner_fact(AgentSafeExplanationProfileV1::GeneratedOwnedCrudOwnerUpdateV1);

        let mut reversed = AgentSafeCapabilityExtensionV1::missing();
        reversed.target.explanation.scoped_facts = vec![update.clone(), create.clone()];
        assert_eq!(
            reversed.validate(),
            Err("explanation facts must be strictly scope-sorted and unique")
        );

        let mut duplicate = AgentSafeCapabilityExtensionV1::missing();
        duplicate.target.explanation.scoped_facts = vec![create.clone(), create.clone()];
        assert_eq!(
            duplicate.validate(),
            Err("explanation facts must be strictly scope-sorted and unique")
        );

        let mut wrong_adapter = create;
        wrong_adapter.scope.adapter = AgentSafeExplanationAdapterV1::IbexBuffered;
        let mut incompatible = AgentSafeCapabilityExtensionV1::missing();
        incompatible.target.explanation.scoped_facts = vec![wrong_adapter];
        assert_eq!(
            incompatible.validate(),
            Err("generated owner explanation profiles require ordinaryMutation HostPlan")
        );
    }

    #[test]
    fn agent_safe_wire_tampering_is_rejected() {
        let encoded = serde_json::to_value(AgentSafeCapabilityExtensionV1::missing())
            .expect("serialize Missing extension");

        let mut wrong_version = encoded.clone();
        wrong_version["schemaVersion"] = json!("agentSafe.v2");
        assert!(serde_json::from_value::<AgentSafeCapabilityExtensionV1>(wrong_version).is_err());

        let mut conflicting_axis = encoded.clone();
        conflicting_axis["target"]["forks"]["inApp"]["egress"] = json!({
            "denyAll": true,
            "captureOnly": true
        });
        assert!(
            serde_json::from_value::<AgentSafeCapabilityExtensionV1>(conflicting_axis).is_err(),
            "one scalar closed enum makes fork-axis alternatives mutually exclusive",
        );

        let mut injected = encoded.clone();
        injected["target"]["aggregate"]["agentSafeV2"] = json!("Supported");
        assert!(
            serde_json::from_value::<AgentSafeCapabilityExtensionV1>(injected).is_err(),
            "unknown extension members fail closed",
        );

        let mut unknown_adapter = encoded.clone();
        unknown_adapter["target"]["envelope"]["ordinaryMutation"]["rawSql"] = json!("Covered");
        assert!(
            serde_json::from_value::<AgentSafeCapabilityExtensionV1>(unknown_adapter).is_err(),
            "unknown physical adapters fail closed",
        );

        let create = owner_fact(AgentSafeExplanationProfileV1::GeneratedOwnedCrudOwnerCreateV1);
        let update = owner_fact(AgentSafeExplanationProfileV1::GeneratedOwnedCrudOwnerUpdateV1);
        let mut unsorted = encoded;
        unsorted["target"]["explanation"]["scopedFacts"] =
            serde_json::to_value([update, create]).expect("facts serialize");
        assert!(
            serde_json::from_value::<AgentSafeCapabilityExtensionV1>(unsorted).is_err(),
            "non-canonical scoped facts fail during wire decoding",
        );
    }
}
