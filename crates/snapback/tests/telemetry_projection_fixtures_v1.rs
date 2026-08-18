//! Independent consumer views over the shared LLP 0154/0104 projection corpus.
//!
//! @ref LLP 0154#deliverables-checklist-phase-1 — checklist 2 requires one
//! fixture corpus that telemetry and metering each deserialize, rather than a
//! producer test that merely round-trips its own Rust type.

use serde::Deserialize;
use std::collections::{BTreeMap, BTreeSet};

const CORPUS: &str = include_str!("../schemas/telemetry.projection-fixtures-v1.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TelemetryCorpusView {
    registry_version: u32,
    cases: Vec<TelemetryCaseView>,
    boundary_protocol: Vec<BoundaryView>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TelemetryCaseView {
    name: String,
    expected_telemetry: Vec<TelemetryRowView>,
    expected_telemetry_counters: Vec<TelemetryCounterView>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TelemetryRowView {
    observation_id: String,
    registry_version: u32,
    ts_ms: i64,
    recorded_ts_ms: i64,
    phase: String,
    kind: String,
    app_id: String,
    environment: String,
    release: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TelemetryCounterView {
    observation_id: String,
    recorded_ts_ms: i64,
    metric_id: String,
    quantity: i64,
}

#[derive(Debug, Deserialize)]
struct BoundaryView {
    name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MeteringCorpusView {
    registry_version: u32,
    cases: Vec<MeteringCaseView>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MeteringCaseView {
    name: String,
    delivery_attempts: u32,
    expected_metering: Vec<UsageEventView>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UsageEventView {
    event_id: String,
    schema_version: String,
    registry_version: u32,
    operation_class: String,
    stage: String,
    occurred_at_ms: i64,
    observed_at_ms: i64,
    expo_app_id: String,
    snapback_environment_id: String,
    release_id: Option<String>,
    metric_id: String,
    quantity: i64,
    unit: String,
}

fn telemetry_cases(view: &TelemetryCorpusView) -> BTreeMap<&str, &TelemetryCaseView> {
    view.cases
        .iter()
        .map(|case| (case.name.as_str(), case))
        .collect()
}

fn metering_cases(view: &MeteringCorpusView) -> BTreeMap<&str, &MeteringCaseView> {
    view.cases
        .iter()
        .map(|case| (case.name.as_str(), case))
        .collect()
}

#[test]
fn telemetry_and_metering_independently_deserialize_one_corpus() {
    let telemetry: TelemetryCorpusView = serde_json::from_str(CORPUS).unwrap();
    let metering: MeteringCorpusView = serde_json::from_str(CORPUS).unwrap();
    assert_eq!(telemetry.registry_version, 3);
    assert_eq!(metering.registry_version, 3);
    assert_eq!(
        telemetry_cases(&telemetry)
            .keys()
            .copied()
            .collect::<Vec<_>>(),
        metering_cases(&metering)
            .keys()
            .copied()
            .collect::<Vec<_>>()
    );
}

#[test]
fn independent_views_pin_identity_timing_and_counter_semantics() {
    let telemetry: TelemetryCorpusView = serde_json::from_str(CORPUS).unwrap();
    let metering: MeteringCorpusView = serde_json::from_str(CORPUS).unwrap();
    let telemetry_cases = telemetry_cases(&telemetry);
    let metering_cases = metering_cases(&metering);

    let identity_row =
        &telemetry_cases["row_meta_identity_equals_c7_metering_envelope"].expected_telemetry[0];
    let identity_event =
        &metering_cases["row_meta_identity_equals_c7_metering_envelope"].expected_metering[0];
    assert_eq!(identity_row.app_id, identity_event.expo_app_id);
    assert_eq!(
        identity_row.environment,
        identity_event.snapback_environment_id
    );
    assert_eq!(identity_row.release, identity_event.release_id);
    assert_eq!(identity_row.ts_ms, identity_event.occurred_at_ms);
    assert_eq!(
        identity_row.registry_version,
        identity_event.registry_version
    );
    assert_eq!(identity_row.kind, "function_run");
    assert_eq!(identity_event.operation_class, "function.query");

    let timing = telemetry_cases["per_class_record_timing_and_timestamp_semantics"];
    let subscribe = timing
        .expected_telemetry
        .iter()
        .filter(|row| row.observation_id.contains("subscribe"))
        .map(|row| (row.phase.as_str(), row.ts_ms, row.recorded_ts_ms))
        .collect::<Vec<_>>();
    assert_eq!(
        subscribe,
        vec![("admission", 1_000, 1_010), ("terminal", 1_000, 1_090)]
    );
    assert_eq!(timing.expected_telemetry_counters.len(), 1);
    let counter = &timing.expected_telemetry_counters[0];
    assert!(counter.observation_id.contains("realtime"));
    assert_eq!(counter.recorded_ts_ms, 1_080);
    assert_eq!(counter.metric_id, "realtime_messages");
    assert_eq!(counter.quantity, 3);
}

#[test]
fn independent_metering_view_pins_multi_metric_ids_retry_and_double_count_rules() {
    let metering: MeteringCorpusView = serde_json::from_str(CORPUS).unwrap();
    let cases = metering_cases(&metering);
    let multi = cases["derived_multi_metric_event_ids"];
    let ids = multi
        .expected_metering
        .iter()
        .map(|event| (event.metric_id.as_str(), event.event_id.as_str()))
        .collect::<BTreeMap<_, _>>();
    assert_eq!(
        ids,
        BTreeMap::from([
            (
                "backend_requests",
                "sha256:fbf994787e4412d4cdef65db637a150459b43de0f1d00ec63f3b952698088f68",
            ),
            (
                "cpu_ms",
                "sha256:05b77913fd02cfe65679164446fa24488662c3aa7fb1c2ac4b08e94e8dcfe6b0",
            ),
            (
                "data_transfer_bytes",
                "sha256:b66752e1ee7ac3c7e1116a779571369fd51f2f973e316cc9a66912b3ae3300fa",
            ),
        ])
    );
    for event in &multi.expected_metering {
        assert_eq!(event.schema_version, "snapback.usage-event.v1");
        assert_eq!(event.registry_version, 3);
        assert_eq!(event.occurred_at_ms, 1_000);
        match event.stage.as_str() {
            "admission" => assert_eq!(event.observed_at_ms, 1_010),
            "terminal" => assert_eq!(event.observed_at_ms, 1_090),
            stage => panic!("unexpected multi-metric stage {stage}"),
        }
        assert!(!event.unit.is_empty());
    }

    let retry = cases["retry_and_event_id_dedup"];
    assert_eq!(retry.delivery_attempts, 3);
    assert_eq!(retry.expected_metering.len(), 1);
    assert_eq!(retry.expected_metering[0].quantity, 1);

    for pair in [
        "no_job_action_double_count",
        "no_carrier_logical_double_count",
    ] {
        let requests = cases[pair]
            .expected_metering
            .iter()
            .filter(|event| event.metric_id == "backend_requests")
            .map(|event| event.quantity)
            .sum::<i64>();
        assert_eq!(requests, 1, "{pair}");
    }
}

#[test]
fn boundary_manifest_names_every_normative_store_fixture() {
    let telemetry: TelemetryCorpusView = serde_json::from_str(CORPUS).unwrap();
    assert_eq!(
        telemetry
            .boundary_protocol
            .iter()
            .map(|fixture| fixture.name.as_str())
            .collect::<BTreeSet<_>>(),
        [
            "cap_exhaustion_rolls_before_shed",
            "clock_rollback_across_hour_finalization",
            "clock_rollback_against_retention_floor",
            "hatch_server_boundary_parity",
            "late_completion_recorded_time_bucket",
            "max_days_7_to_1_to_7_without_sweep",
            "max_days_n_to_0_to_n_without_sweep",
            "mid_hour_maintenance_exactly_once_before_after_restart",
            "raw_tail_stats_across_restart",
            "reset_in_flight_generation_race",
            "snapshot_bounded_export",
        ]
        .into_iter()
        .collect()
    );
}
