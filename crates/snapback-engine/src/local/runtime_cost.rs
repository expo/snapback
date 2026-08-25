//! Bounded, process-local runtime-cost visibility.
//!
//! This module is deliberately storage-only diagnostics. It does not make a
//! policy decision, persist a record, or export one through telemetry.
//!
//! @ref LLP 0267#71-posture-first-redaction-bounded-storage-localhosted — the
//! recorder has three count-and-byte bounded rings, capped exact maps, and a
//! disabled fast path.
//! @ref LLP 0267#73-query-and-live-re-evaluation-visibility-extends-1-adds-delivery —
//! query observations are projected before retention and subscription owed
//! state follows the total transition table.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, VecDeque};

pub const RUNTIME_COST_RING_RECORD_CAPACITY: usize = 512;
pub const RUNTIME_COST_COUNTER_KEY_CAPACITY: usize = 1_024;
pub const QUERY_CONSULTATION_SAMPLE_CAPACITY: usize = 16;
pub const MUTATION_PHASE_RING_BYTE_CAPACITY: usize = 1_048_576;
pub const QUERY_OBSERVATION_RING_BYTE_CAPACITY: usize = 2_097_152;
pub const LIVE_DELIVERY_RING_BYTE_CAPACITY: usize = 1_048_576;
pub const RUNTIME_COST_TOTAL_BYTE_CAPACITY: usize = MUTATION_PHASE_RING_BYTE_CAPACITY
    + QUERY_OBSERVATION_RING_BYTE_CAPACITY
    + LIVE_DELIVERY_RING_BYTE_CAPACITY;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MutationPhaseCostV1 {
    pub format: String,
    pub client_mutation_id: String,
    pub function_id: String,
    pub enqueued_at_ms: Option<f64>,
    pub dispatched_at_ms: Option<f64>,
    pub authorized_at_ms: Option<f64>,
    pub executed_at_ms: Option<f64>,
    pub committed_at_ms: Option<f64>,
    pub queue_wait_ms: Option<f64>,
    pub auth_wait_ms: Option<f64>,
    pub execution_ms: Option<f64>,
    pub commit_ms: Option<f64>,
    pub disposition: String,
}

impl MutationPhaseCostV1 {
    #[allow(clippy::too_many_arguments)]
    pub fn from_timestamps(
        client_mutation_id: String,
        function_id: String,
        enqueued_at_ms: Option<f64>,
        dispatched_at_ms: Option<f64>,
        authorized_at_ms: Option<f64>,
        executed_at_ms: Option<f64>,
        committed_at_ms: Option<f64>,
        disposition: String,
    ) -> Self {
        Self {
            format: "snapback.mutation-phase-cost.v1".to_owned(),
            client_mutation_id,
            function_id,
            enqueued_at_ms,
            dispatched_at_ms,
            authorized_at_ms,
            executed_at_ms,
            committed_at_ms,
            queue_wait_ms: duration_between(enqueued_at_ms, dispatched_at_ms),
            auth_wait_ms: duration_between(dispatched_at_ms, authorized_at_ms),
            execution_ms: duration_between(authorized_at_ms, executed_at_ms),
            commit_ms: duration_between(executed_at_ms, committed_at_ms),
            disposition,
        }
    }

    fn inspection_projection(&self) -> Self {
        let mut projected = self.clone();
        projected.client_mutation_id = inspection_pseudonym(&self.client_mutation_id);
        projected
    }
}

fn duration_between(start: Option<f64>, end: Option<f64>) -> Option<f64> {
    let (Some(start), Some(end)) = (start, end) else {
        return None;
    };
    let duration = end - start;
    duration.is_finite().then_some(duration.max(0.0))
}

fn inspection_pseudonym(raw: &str) -> String {
    // Rust strings are valid Unicode and a JSON string is always JCS-encodable.
    snapback_types::rqs_contract::sha256_identity(&Value::String(raw.to_owned()))
        .expect("a Rust string has a canonical JSON representation")
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum QueryExecutionKindV1 {
    Finite,
    LiveEstablishment,
    LiveReevaluation,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum QueryObservationStatusV1 {
    Executed,
    MemoDelivery,
    Skipped,
    Refused,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum AccessBoundV1 {
    Absent,
    Exclusive,
    Inclusive,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum AccessDirectionV1 {
    Asc,
    Desc,
    Unordered,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SelectedAccessPathV1 {
    FullScan,
    Point { index: String },
    Unique { index: String },
    BoundedIndex { index: String },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AccessBoundShapeV1 {
    pub component: String,
    pub lower: AccessBoundV1,
    pub upper: AccessBoundV1,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AccessPathConsultationV1 {
    pub ordinal: u64,
    pub node_id: Option<String>,
    pub table: String,
    pub selected_path: SelectedAccessPathV1,
    pub bound_shape: Vec<AccessBoundShapeV1>,
    pub direction: AccessDirectionV1,
    pub examined_entries: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct LiveFanoutBasisV1 {
    pub execution_kind: QueryExecutionKindV1,
    pub raw_real_evaluation_max_ms: f64,
    pub raw_memo_delivery_max_ms: f64,
    pub admission_factor: f64,
    pub real_evaluation_basis_ms: f64,
    pub memo_delivery_basis_ms: f64,
    pub max_observers: u64,
    pub max_distinct_evaluation_groups: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QueryTargetWorkV1 {
    pub vector: snapback_kernel::vector::VectorWorkCountersV1,
}

/// Complete internal observation. The recorder validates its closed-ledger
/// invariants, then retains only [`QueryCostObservationInspectV1`].
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QueryCostObservationV1 {
    pub format: String,
    pub function_id: String,
    pub function_generation: String,
    pub plan_identity: Option<String>,
    pub target_profile: String,
    pub fixture_identity: Option<String>,
    pub authority_class: String,
    pub execution_kind: QueryExecutionKindV1,
    pub status: QueryObservationStatusV1,
    pub complete: bool,
    pub scanned_rows: u64,
    pub access_path_consultations: Vec<AccessPathConsultationV1>,
    pub index_range_count: u64,
    pub result_rows: Option<u64>,
    pub result_bytes: Option<u64>,
    pub evaluation_turn_ms: Option<f64>,
    pub memo_delivery_turn_ms: Option<f64>,
    pub estimated_live_fanout_ms: Option<f64>,
    pub estimate_basis: Option<LiveFanoutBasisV1>,
    pub structural_work: Option<crate::graph_evaluator::StructuralWorkV1>,
    pub target_work: Option<QueryTargetWorkV1>,
}

impl QueryCostObservationV1 {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.format != "snapback.query-cost-observation.v1" {
            return Err("query observation format is not v1");
        }
        if self.index_range_count != self.access_path_consultations.len() as u64 {
            return Err("indexRangeCount does not equal the complete consultation count");
        }
        if self
            .access_path_consultations
            .iter()
            .enumerate()
            .any(|(ordinal, consultation)| consultation.ordinal != ordinal as u64)
        {
            return Err("consultation ordinals are not consecutive");
        }
        let scanned_rows = self
            .access_path_consultations
            .iter()
            .try_fold(0_u64, |sum, item| sum.checked_add(item.examined_entries))
            .ok_or("scannedRows overflow")?;
        if scanned_rows != self.scanned_rows {
            return Err("scannedRows does not equal the checked consultation sum");
        }
        if [
            self.evaluation_turn_ms,
            self.memo_delivery_turn_ms,
            self.estimated_live_fanout_ms,
        ]
        .into_iter()
        .flatten()
        .any(|duration| !duration.is_finite() || duration < 0.0)
        {
            return Err("duration is not finite and non-negative");
        }
        match self.status {
            QueryObservationStatusV1::Executed if self.memo_delivery_turn_ms.is_some() => {
                Err("an executed turn cannot carry memo delivery time")
            }
            QueryObservationStatusV1::MemoDelivery
                if self.scanned_rows != 0
                    || self.index_range_count != 0
                    || self.evaluation_turn_ms.is_some()
                    || self.memo_delivery_turn_ms.is_none() =>
            {
                Err("a memo delivery must carry only memo timing and copied result facts")
            }
            QueryObservationStatusV1::Skipped
                if !self.complete
                    || self.scanned_rows != 0
                    || self.index_range_count != 0
                    || self.result_rows.is_some()
                    || self.result_bytes.is_some()
                    || self.evaluation_turn_ms.is_some()
                    || self.memo_delivery_turn_ms.is_some() =>
            {
                Err("a skipped turn must be complete and carry no work or result facts")
            }
            _ => Ok(()),
        }
    }

    pub fn inspection_projection(&self) -> Result<QueryCostObservationInspectV1, &'static str> {
        self.validate()?;
        let sample = self
            .access_path_consultations
            .iter()
            .take(QUERY_CONSULTATION_SAMPLE_CAPACITY)
            .cloned()
            .collect::<Vec<_>>();
        Ok(QueryCostObservationInspectV1 {
            format: "snapback.query-cost-observation-inspect.v1".to_owned(),
            function_id: self.function_id.clone(),
            function_generation: self.function_generation.clone(),
            plan_identity: self.plan_identity.clone(),
            target_profile: self.target_profile.clone(),
            authority_class: self.authority_class.clone(),
            execution_kind: self.execution_kind,
            status: self.status,
            complete: self.complete,
            scanned_rows: self.scanned_rows,
            consultation_sample: sample,
            total_consultations: self.index_range_count,
            consultations_truncated: self.index_range_count
                > QUERY_CONSULTATION_SAMPLE_CAPACITY as u64,
            index_range_count: self.index_range_count,
            result_rows: self.result_rows,
            result_bytes: self.result_bytes,
            evaluation_turn_ms: self.evaluation_turn_ms,
            memo_delivery_turn_ms: self.memo_delivery_turn_ms,
            estimated_live_fanout_ms: self.estimated_live_fanout_ms,
            estimate_basis: self.estimate_basis.clone(),
            structural_work: self.structural_work.clone(),
            target_work: self.target_work.clone(),
        })
    }
}

/// Value-free bounded projection retained by the recorder. There is
/// intentionally no `fixtureIdentity` field.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QueryCostObservationInspectV1 {
    pub format: String,
    pub function_id: String,
    pub function_generation: String,
    pub plan_identity: Option<String>,
    pub target_profile: String,
    pub authority_class: String,
    pub execution_kind: QueryExecutionKindV1,
    pub status: QueryObservationStatusV1,
    pub complete: bool,
    pub scanned_rows: u64,
    pub consultation_sample: Vec<AccessPathConsultationV1>,
    pub total_consultations: u64,
    pub consultations_truncated: bool,
    pub index_range_count: u64,
    pub result_rows: Option<u64>,
    pub result_bytes: Option<u64>,
    pub evaluation_turn_ms: Option<f64>,
    pub memo_delivery_turn_ms: Option<f64>,
    pub estimated_live_fanout_ms: Option<f64>,
    pub estimate_basis: Option<LiveFanoutBasisV1>,
    pub structural_work: Option<crate::graph_evaluator::StructuralWorkV1>,
    pub target_work: Option<QueryTargetWorkV1>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum LiveRerunCauseV1 {
    AuthorizationInvalidation,
    MutationInvalidation,
    Refresh,
    ReconnectReestablish,
}

impl LiveRerunCauseV1 {
    pub fn merge(self, other: Self) -> Self {
        if self.precedence() <= other.precedence() {
            self
        } else {
            other
        }
    }

    fn precedence(self) -> u8 {
        match self {
            Self::AuthorizationInvalidation => 0,
            Self::MutationInvalidation => 1,
            Self::Refresh => 2,
            Self::ReconnectReestablish => 3,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CoveredVersionsV1 {
    pub first: u64,
    pub last: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct LiveDeliveryWaveV1 {
    pub format: String,
    pub wave_seq: u64,
    pub function_id: String,
    pub plan_identity: Option<String>,
    pub rerun_cause: LiveRerunCauseV1,
    pub coalesced: bool,
    pub covered_versions: Option<CoveredVersionsV1>,
    pub delivered_version: Option<u64>,
    pub subscriber_count: u64,
    pub distinct_evaluation_groups: u64,
    pub real_evaluations: u64,
    pub memo_deliveries: u64,
    pub delivered_frames: u64,
    pub max_evaluation_turn_ms: Option<f64>,
    pub total_evaluation_turn_ms: Option<f64>,
    pub max_memo_delivery_turn_ms: Option<f64>,
    pub total_memo_delivery_turn_ms: Option<f64>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum LiveEvaluationStageV1 {
    Idle,
    Evaluating,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum LivePendingWorkV1 {
    None,
    Queued,
    Coalescing,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct LiveSubscriptionCostRowV1 {
    pub subscription_id: String,
    pub function_id: String,
    pub last_delivered_wave_seq: Option<u64>,
    pub last_delivered_version: Option<u64>,
    pub owed_through_version: Option<u64>,
    pub evaluation: LiveEvaluationStageV1,
    pub current_wave_seq: Option<u64>,
    pub pending_work: LivePendingWorkV1,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PhaseCostCounterV1 {
    pub count: u64,
    pub total_ms: f64,
    pub max_ms: f64,
}

impl PhaseCostCounterV1 {
    fn record(&mut self, duration_ms: Option<f64>) {
        let Some(duration_ms) = duration_ms.filter(|value| value.is_finite() && *value >= 0.0)
        else {
            return;
        };
        self.count = self.count.saturating_add(1);
        self.total_ms += duration_ms;
        self.max_ms = self.max_ms.max(duration_ms);
    }

    fn merge(&mut self, other: Self) {
        self.count = self.count.saturating_add(other.count);
        self.total_ms += other.total_ms;
        self.max_ms = self.max_ms.max(other.max_ms);
    }
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FunctionMutationPhaseCountersV1 {
    pub mutation_count: u64,
    pub authorization: PhaseCostCounterV1,
    pub execution: PhaseCostCounterV1,
    pub commit: PhaseCostCounterV1,
}

impl FunctionMutationPhaseCountersV1 {
    fn record(
        &mut self,
        authorization_ms: Option<f64>,
        execution_ms: Option<f64>,
        commit_ms: Option<f64>,
    ) {
        self.mutation_count = self.mutation_count.saturating_add(1);
        self.authorization.record(authorization_ms);
        self.execution.record(execution_ms);
        self.commit.record(commit_ms);
    }

    fn merge(&mut self, other: Self) {
        self.mutation_count = self.mutation_count.saturating_add(other.mutation_count);
        self.authorization.merge(other.authorization);
        self.execution.merge(other.execution);
        self.commit.merge(other.commit);
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CappedFunctionMutationPhaseCountersV1 {
    pub key_capacity: usize,
    pub functions: BTreeMap<String, FunctionMutationPhaseCountersV1>,
    pub other_keys: FunctionMutationPhaseCountersV1,
    pub evicted_keys: u64,
}

#[derive(Clone, Debug)]
struct CappedFunctionCounters {
    key_capacity: usize,
    sequence: u64,
    entries: BTreeMap<String, (FunctionMutationPhaseCountersV1, u64)>,
    other_keys: FunctionMutationPhaseCountersV1,
    evicted_keys: u64,
}

impl CappedFunctionCounters {
    fn new(key_capacity: usize) -> Self {
        Self {
            key_capacity,
            sequence: 0,
            entries: BTreeMap::new(),
            other_keys: FunctionMutationPhaseCountersV1::default(),
            evicted_keys: 0,
        }
    }

    fn record(
        &mut self,
        function_id: &str,
        authorization_ms: Option<f64>,
        execution_ms: Option<f64>,
        commit_ms: Option<f64>,
    ) {
        self.sequence = self.sequence.saturating_add(1);
        if let Some((counters, updated_at)) = self.entries.get_mut(function_id) {
            counters.record(authorization_ms, execution_ms, commit_ms);
            *updated_at = self.sequence;
            return;
        }
        if self.key_capacity == 0 {
            let mut counters = FunctionMutationPhaseCountersV1::default();
            counters.record(authorization_ms, execution_ms, commit_ms);
            self.other_keys.merge(counters);
            self.evicted_keys = self.evicted_keys.saturating_add(1);
            return;
        }
        if self.entries.len() == self.key_capacity {
            let evicted = self
                .entries
                .iter()
                .min_by_key(|(_, (_, updated_at))| *updated_at)
                .map(|(key, _)| key.clone())
                .expect("a full positive-capacity map has an entry");
            let (counters, _) = self
                .entries
                .remove(&evicted)
                .expect("the selected LRU key exists");
            self.other_keys.merge(counters);
            self.evicted_keys = self.evicted_keys.saturating_add(1);
        }
        let mut counters = FunctionMutationPhaseCountersV1::default();
        counters.record(authorization_ms, execution_ms, commit_ms);
        self.entries
            .insert(function_id.to_owned(), (counters, self.sequence));
    }

    fn snapshot(&self) -> CappedFunctionMutationPhaseCountersV1 {
        CappedFunctionMutationPhaseCountersV1 {
            key_capacity: self.key_capacity,
            functions: self
                .entries
                .iter()
                .map(|(key, (value, _))| (key.clone(), value.clone()))
                .collect(),
            other_keys: self.other_keys.clone(),
            evicted_keys: self.evicted_keys,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCostRingSnapshotV1<T> {
    pub record_capacity: usize,
    pub byte_capacity: usize,
    pub retained_bytes: usize,
    pub dropped_records: u64,
    pub records: Vec<T>,
}

#[derive(Clone, Debug)]
struct ByteAccountedRing<T> {
    record_capacity: usize,
    byte_capacity: usize,
    retained_bytes: usize,
    dropped_records: u64,
    records: VecDeque<(T, usize)>,
}

impl<T: Clone> ByteAccountedRing<T> {
    fn new(record_capacity: usize, byte_capacity: usize) -> Self {
        Self {
            record_capacity,
            byte_capacity,
            retained_bytes: 0,
            dropped_records: 0,
            records: VecDeque::new(),
        }
    }

    fn push(&mut self, record: T, admitted_bytes: usize) {
        if admitted_bytes > self.byte_capacity || self.record_capacity == 0 {
            self.dropped_records = self.dropped_records.saturating_add(1);
            return;
        }
        while self.records.len() >= self.record_capacity
            || self.retained_bytes.saturating_add(admitted_bytes) > self.byte_capacity
        {
            let Some((_, bytes)) = self.records.pop_front() else {
                break;
            };
            self.retained_bytes -= bytes;
            self.dropped_records = self.dropped_records.saturating_add(1);
        }
        self.retained_bytes += admitted_bytes;
        self.records.push_back((record, admitted_bytes));
    }

    fn note_dropped_record(&mut self) {
        self.dropped_records = self.dropped_records.saturating_add(1);
    }

    fn remove_first(&mut self, predicate: impl Fn(&T) -> bool) -> Option<T> {
        let position = self
            .records
            .iter()
            .position(|(record, _)| predicate(record))?;
        let (record, bytes) = self
            .records
            .remove(position)
            .expect("the located ring record exists");
        self.retained_bytes -= bytes;
        Some(record)
    }

    fn snapshot<U>(&self, project: impl Fn(&T) -> U) -> RuntimeCostRingSnapshotV1<U> {
        RuntimeCostRingSnapshotV1 {
            record_capacity: self.record_capacity,
            byte_capacity: self.byte_capacity,
            retained_bytes: self.retained_bytes,
            dropped_records: self.dropped_records,
            records: self
                .records
                .iter()
                .map(|(record, _)| project(record))
                .collect(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QueryObservationRingSnapshotV1 {
    pub record_capacity: usize,
    pub byte_capacity: usize,
    pub retained_bytes: usize,
    pub dropped_records: u64,
    pub truncated_records: u64,
    pub records: Vec<QueryCostObservationInspectV1>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCostSnapshotV1 {
    pub format: String,
    pub enabled: bool,
    pub total_byte_capacity: usize,
    pub mutation_phases: RuntimeCostRingSnapshotV1<MutationPhaseCostV1>,
    pub query_observations: QueryObservationRingSnapshotV1,
    pub live_delivery_waves: RuntimeCostRingSnapshotV1<LiveDeliveryWaveV1>,
    pub server_mutation_phase_counters: CappedFunctionMutationPhaseCountersV1,
    pub subscription_registry: Vec<LiveSubscriptionCostRowV1>,
}

#[derive(Clone, Debug)]
pub struct RuntimeCostRecorder {
    enabled: bool,
    mutation_phases: ByteAccountedRing<MutationPhaseCostV1>,
    query_observations: ByteAccountedRing<QueryCostObservationInspectV1>,
    query_truncated_records: u64,
    live_delivery_waves: ByteAccountedRing<LiveDeliveryWaveV1>,
    server_mutation_phase_counters: CappedFunctionCounters,
    subscription_registry: BTreeMap<String, LiveSubscriptionCostRowV1>,
    next_wave_seq: u64,
}

impl Default for RuntimeCostRecorder {
    fn default() -> Self {
        Self::disabled()
    }
}

impl RuntimeCostRecorder {
    pub fn disabled() -> Self {
        Self::with_limits(
            false,
            RUNTIME_COST_RING_RECORD_CAPACITY,
            [
                MUTATION_PHASE_RING_BYTE_CAPACITY,
                QUERY_OBSERVATION_RING_BYTE_CAPACITY,
                LIVE_DELIVERY_RING_BYTE_CAPACITY,
            ],
            RUNTIME_COST_COUNTER_KEY_CAPACITY,
        )
    }

    pub fn enabled() -> Self {
        Self::with_limits(
            true,
            RUNTIME_COST_RING_RECORD_CAPACITY,
            [
                MUTATION_PHASE_RING_BYTE_CAPACITY,
                QUERY_OBSERVATION_RING_BYTE_CAPACITY,
                LIVE_DELIVERY_RING_BYTE_CAPACITY,
            ],
            RUNTIME_COST_COUNTER_KEY_CAPACITY,
        )
    }

    fn with_limits(
        enabled: bool,
        record_capacity: usize,
        byte_capacities: [usize; 3],
        key_capacity: usize,
    ) -> Self {
        Self {
            enabled,
            mutation_phases: ByteAccountedRing::new(record_capacity, byte_capacities[0]),
            query_observations: ByteAccountedRing::new(record_capacity, byte_capacities[1]),
            query_truncated_records: 0,
            live_delivery_waves: ByteAccountedRing::new(record_capacity, byte_capacities[2]),
            server_mutation_phase_counters: CappedFunctionCounters::new(key_capacity),
            subscription_registry: BTreeMap::new(),
            next_wave_seq: 0,
        }
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled
    }

    pub fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
    }

    pub fn record_mutation_phase(&mut self, record: MutationPhaseCostV1) {
        if !self.enabled {
            return;
        }
        let projected = record.inspection_projection();
        let bytes = serde_json::to_vec(&projected).map_or(usize::MAX, |value| value.len());
        self.mutation_phases.push(projected, bytes);
    }

    pub fn record_server_mutation_phases(
        &mut self,
        function_id: &str,
        authorization_ms: Option<f64>,
        execution_ms: Option<f64>,
        commit_ms: Option<f64>,
    ) {
        if !self.enabled {
            return;
        }
        self.server_mutation_phase_counters.record(
            function_id,
            authorization_ms,
            execution_ms,
            commit_ms,
        );
    }

    pub fn record_query_observation(&mut self, observation: &QueryCostObservationV1) {
        if !self.enabled {
            return;
        }
        let Ok(projected) = observation.inspection_projection() else {
            self.query_observations.note_dropped_record();
            return;
        };
        if projected.consultations_truncated {
            self.query_truncated_records = self.query_truncated_records.saturating_add(1);
        }
        let bytes = serde_json::to_vec(&projected).map_or(usize::MAX, |value| value.len());
        self.query_observations.push(projected, bytes);
    }

    pub fn record_live_delivery_wave(&mut self, mut wave: LiveDeliveryWaveV1) {
        if !self.enabled {
            return;
        }
        wave.format = "snapback.live-delivery-wave.v1".to_owned();
        if let Some(previous) = self
            .live_delivery_waves
            .remove_first(|record| record.wave_seq == wave.wave_seq)
        {
            wave = merge_live_delivery_wave(previous, wave);
        }
        let bytes = serde_json::to_vec(&wave).map_or(usize::MAX, |value| value.len());
        self.live_delivery_waves.push(wave, bytes);
    }

    pub fn reserve_wave_seq(&mut self) -> Option<u64> {
        if !self.enabled {
            return None;
        }
        self.next_wave_seq = self.next_wave_seq.saturating_add(1);
        Some(self.next_wave_seq)
    }

    pub fn establish_subscription(
        &mut self,
        subscription_id: &str,
        function_id: &str,
        delivered_version: Option<u64>,
        plan_identity: Option<String>,
        evaluation_turn_ms: Option<f64>,
    ) {
        if !self.enabled {
            return;
        }
        let wave_seq = self
            .reserve_wave_seq()
            .expect("an enabled recorder reserves a wave sequence");
        self.record_live_delivery_wave(LiveDeliveryWaveV1 {
            format: "snapback.live-delivery-wave.v1".to_owned(),
            wave_seq,
            function_id: function_id.to_owned(),
            plan_identity,
            rerun_cause: LiveRerunCauseV1::ReconnectReestablish,
            coalesced: false,
            covered_versions: None,
            delivered_version,
            subscriber_count: 1,
            distinct_evaluation_groups: 1,
            real_evaluations: 1,
            memo_deliveries: 0,
            delivered_frames: 1,
            max_evaluation_turn_ms: evaluation_turn_ms,
            total_evaluation_turn_ms: evaluation_turn_ms,
            max_memo_delivery_turn_ms: None,
            total_memo_delivery_turn_ms: None,
        });
        self.subscription_registry.insert(
            subscription_id.to_owned(),
            LiveSubscriptionCostRowV1 {
                subscription_id: subscription_id.to_owned(),
                function_id: function_id.to_owned(),
                last_delivered_wave_seq: Some(wave_seq),
                last_delivered_version: delivered_version,
                owed_through_version: None,
                evaluation: LiveEvaluationStageV1::Idle,
                current_wave_seq: None,
                pending_work: LivePendingWorkV1::None,
            },
        );
    }

    pub fn charge_committed_version(&mut self, subscription_id: &str, version: u64) {
        if let Some(row) = self.enabled_row_mut(subscription_id) {
            row.owed_through_version = Some(row.owed_through_version.unwrap_or(0).max(version));
            if row.pending_work == LivePendingWorkV1::None {
                row.pending_work = LivePendingWorkV1::Queued;
            }
        }
    }

    pub fn charge_writeless_authority(&mut self, subscription_id: &str) {
        if let Some(row) = self.enabled_row_mut(subscription_id)
            && row.pending_work == LivePendingWorkV1::None
        {
            row.pending_work = LivePendingWorkV1::Queued;
        }
    }

    pub fn mark_coalescing(&mut self, subscription_id: &str) {
        if let Some(row) = self.enabled_row_mut(subscription_id)
            && row.pending_work == LivePendingWorkV1::Queued
        {
            row.pending_work = LivePendingWorkV1::Coalescing;
        }
    }

    pub fn start_wave(&mut self, subscription_id: &str, wave_seq: Option<u64>) -> Option<u64> {
        if !self.enabled || !self.subscription_registry.contains_key(subscription_id) {
            return None;
        }
        let wave_seq = wave_seq.unwrap_or_else(|| {
            self.reserve_wave_seq()
                .expect("an enabled recorder reserves a wave sequence")
        });
        let row = self
            .subscription_registry
            .get_mut(subscription_id)
            .expect("membership was checked");
        row.evaluation = LiveEvaluationStageV1::Evaluating;
        row.current_wave_seq = Some(wave_seq);
        row.pending_work = LivePendingWorkV1::None;
        Some(wave_seq)
    }

    /// T-DELIVER is compare-and-clear: a charge above `delivered_version`
    /// and its queued/coalescing stage survive the in-flight wave.
    pub fn deliver_wave(&mut self, subscription_id: &str, wave_seq: u64, delivered_version: u64) {
        if let Some(row) = self.enabled_row_mut(subscription_id) {
            if row.current_wave_seq != Some(wave_seq) {
                return;
            }
            if row
                .owed_through_version
                .is_some_and(|owed| owed <= delivered_version)
            {
                row.owed_through_version = None;
            }
            row.evaluation = LiveEvaluationStageV1::Idle;
            row.current_wave_seq = None;
            row.last_delivered_wave_seq = Some(wave_seq);
            row.last_delivered_version = Some(delivered_version);
        }
    }

    pub fn authority_gate_discard(&mut self, subscription_id: &str, wave_seq: u64) {
        self.finish_owed(subscription_id, wave_seq, LivePendingWorkV1::Queued);
    }

    pub fn finish_in_flight_cancellation(&mut self, subscription_id: &str, wave_seq: u64) {
        self.finish_owed(subscription_id, wave_seq, LivePendingWorkV1::Queued);
    }

    pub fn evaluation_timeout(&mut self, subscription_id: &str, wave_seq: u64) {
        self.finish_owed(subscription_id, wave_seq, LivePendingWorkV1::Queued);
    }

    /// A matcher-proved skip or value-equal no-frame turn covers the charged
    /// cut without publishing a new client join anchor.
    pub fn complete_without_delivery(
        &mut self,
        subscription_id: &str,
        wave_seq: u64,
        covered_through: u64,
    ) {
        if let Some(row) = self.enabled_row_mut(subscription_id) {
            if row.current_wave_seq != Some(wave_seq) {
                return;
            }
            if row
                .owed_through_version
                .is_some_and(|owed| owed <= covered_through)
            {
                row.owed_through_version = None;
            }
            row.evaluation = LiveEvaluationStageV1::Idle;
            row.current_wave_seq = None;
        }
    }

    pub fn refresh_degradation(&mut self, subscription_id: &str) {
        if let Some(row) = self.enabled_row_mut(subscription_id) {
            row.pending_work = LivePendingWorkV1::Queued;
        }
    }

    /// Queued cancellation transfers its obligation to the superseding frame;
    /// every registry field is deliberately unchanged.
    pub fn queued_cancellation_transfer(&mut self, _subscription_id: &str) {}

    pub fn retire_subscription(&mut self, subscription_id: &str) {
        if self.enabled {
            self.subscription_registry.remove(subscription_id);
        }
    }

    fn finish_owed(
        &mut self,
        subscription_id: &str,
        wave_seq: u64,
        pending_work: LivePendingWorkV1,
    ) {
        if let Some(row) = self.enabled_row_mut(subscription_id) {
            if row.current_wave_seq != Some(wave_seq) {
                return;
            }
            row.evaluation = LiveEvaluationStageV1::Idle;
            row.current_wave_seq = None;
            row.pending_work = pending_work;
        }
    }

    fn enabled_row_mut(&mut self, subscription_id: &str) -> Option<&mut LiveSubscriptionCostRowV1> {
        if !self.enabled {
            return None;
        }
        self.subscription_registry.get_mut(subscription_id)
    }

    pub fn snapshot(&self) -> RuntimeCostSnapshotV1 {
        let mutation_phases = self
            .mutation_phases
            .snapshot(MutationPhaseCostV1::inspection_projection);
        let query = self.query_observations.snapshot(Clone::clone);
        RuntimeCostSnapshotV1 {
            format: "snapback.runtime-cost-snapshot.v1".to_owned(),
            enabled: self.enabled,
            total_byte_capacity: RUNTIME_COST_TOTAL_BYTE_CAPACITY,
            mutation_phases,
            query_observations: QueryObservationRingSnapshotV1 {
                record_capacity: query.record_capacity,
                byte_capacity: query.byte_capacity,
                retained_bytes: query.retained_bytes,
                dropped_records: query.dropped_records,
                truncated_records: self.query_truncated_records,
                records: query.records,
            },
            live_delivery_waves: self.live_delivery_waves.snapshot(Clone::clone),
            server_mutation_phase_counters: self.server_mutation_phase_counters.snapshot(),
            subscription_registry: self.subscription_registry.values().cloned().collect(),
        }
    }
}

fn merge_live_delivery_wave(
    mut aggregate: LiveDeliveryWaveV1,
    next: LiveDeliveryWaveV1,
) -> LiveDeliveryWaveV1 {
    debug_assert_eq!(aggregate.wave_seq, next.wave_seq);
    debug_assert_eq!(aggregate.function_id, next.function_id);
    debug_assert_eq!(aggregate.plan_identity, next.plan_identity);
    aggregate.rerun_cause = aggregate.rerun_cause.merge(next.rerun_cause);
    aggregate.coalesced |= next.coalesced;
    aggregate.covered_versions = match (aggregate.covered_versions, next.covered_versions) {
        (Some(left), Some(right)) => Some(CoveredVersionsV1 {
            first: left.first.min(right.first),
            last: left.last.max(right.last),
        }),
        (Some(covered), None) | (None, Some(covered)) => Some(covered),
        (None, None) => None,
    };
    aggregate.delivered_version = match (aggregate.delivered_version, next.delivered_version) {
        (Some(left), Some(right)) => Some(left.max(right)),
        (Some(version), None) | (None, Some(version)) => Some(version),
        (None, None) => None,
    };
    aggregate.subscriber_count = aggregate
        .subscriber_count
        .saturating_add(next.subscriber_count);
    aggregate.distinct_evaluation_groups = aggregate
        .distinct_evaluation_groups
        .saturating_add(next.distinct_evaluation_groups);
    aggregate.real_evaluations = aggregate
        .real_evaluations
        .saturating_add(next.real_evaluations);
    aggregate.memo_deliveries = aggregate
        .memo_deliveries
        .saturating_add(next.memo_deliveries);
    aggregate.delivered_frames = aggregate
        .delivered_frames
        .saturating_add(next.delivered_frames);
    aggregate.max_evaluation_turn_ms = max_optional_duration(
        aggregate.max_evaluation_turn_ms,
        next.max_evaluation_turn_ms,
    );
    aggregate.total_evaluation_turn_ms = sum_optional_duration(
        aggregate.total_evaluation_turn_ms,
        next.total_evaluation_turn_ms,
    );
    aggregate.max_memo_delivery_turn_ms = max_optional_duration(
        aggregate.max_memo_delivery_turn_ms,
        next.max_memo_delivery_turn_ms,
    );
    aggregate.total_memo_delivery_turn_ms = sum_optional_duration(
        aggregate.total_memo_delivery_turn_ms,
        next.total_memo_delivery_turn_ms,
    );
    aggregate
}

fn max_optional_duration(left: Option<f64>, right: Option<f64>) -> Option<f64> {
    match (left, right) {
        (Some(left), Some(right)) => Some(left.max(right)),
        (Some(value), None) | (None, Some(value)) => Some(value),
        (None, None) => None,
    }
}

fn sum_optional_duration(left: Option<f64>, right: Option<f64>) -> Option<f64> {
    match (left, right) {
        (Some(left), Some(right)) => {
            let total = left + right;
            total.is_finite().then_some(total)
        }
        (Some(value), None) | (None, Some(value)) => Some(value),
        (None, None) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn consultation(ordinal: u64, examined_entries: u64) -> AccessPathConsultationV1 {
        AccessPathConsultationV1 {
            ordinal,
            node_id: Some(format!("node-{ordinal}")),
            table: "todos".to_owned(),
            selected_path: SelectedAccessPathV1::BoundedIndex {
                index: "by_owner".to_owned(),
            },
            bound_shape: vec![AccessBoundShapeV1 {
                component: "owner".to_owned(),
                lower: AccessBoundV1::Inclusive,
                upper: AccessBoundV1::Inclusive,
            }],
            direction: AccessDirectionV1::Asc,
            examined_entries,
        }
    }

    fn observation(consultations: u64) -> QueryCostObservationV1 {
        QueryCostObservationV1 {
            format: "snapback.query-cost-observation.v1".to_owned(),
            function_id: "todos.list".to_owned(),
            function_generation: "generation-1".to_owned(),
            plan_identity: Some("plan-1".to_owned()),
            target_profile: "local".to_owned(),
            fixture_identity: Some("SECRET-FIXTURE".to_owned()),
            authority_class: "authenticated".to_owned(),
            execution_kind: QueryExecutionKindV1::Finite,
            status: QueryObservationStatusV1::Executed,
            complete: true,
            scanned_rows: consultations,
            access_path_consultations: (0..consultations)
                .map(|ordinal| consultation(ordinal, 1))
                .collect(),
            index_range_count: consultations,
            result_rows: Some(1),
            result_bytes: Some(12),
            evaluation_turn_ms: Some(1.5),
            memo_delivery_turn_ms: None,
            estimated_live_fanout_ms: None,
            estimate_basis: None,
            structural_work: None,
            target_work: None,
        }
    }

    fn row(recorder: &RuntimeCostRecorder, id: &str) -> LiveSubscriptionCostRowV1 {
        recorder
            .snapshot()
            .subscription_registry
            .into_iter()
            .find(|row| row.subscription_id == id)
            .expect("registry row")
    }

    #[test]
    fn recorder_defaults_fit_three_family_four_mib_bound() {
        assert_eq!(RUNTIME_COST_RING_RECORD_CAPACITY, 512);
        assert_eq!(RUNTIME_COST_TOTAL_BYTE_CAPACITY, 4 * 1024 * 1024);
        let snapshot = RuntimeCostRecorder::enabled().snapshot();
        assert_eq!(snapshot.mutation_phases.record_capacity, 512);
        assert_eq!(snapshot.query_observations.record_capacity, 512);
        assert_eq!(snapshot.live_delivery_waves.record_capacity, 512);

        let mut ring = ByteAccountedRing::new(RUNTIME_COST_RING_RECORD_CAPACITY, usize::MAX);
        for value in 0..=RUNTIME_COST_RING_RECORD_CAPACITY {
            ring.push(value, 1);
        }
        let snapshot = ring.snapshot(|value| *value);
        assert_eq!(snapshot.records.len(), 512);
        assert_eq!(snapshot.records[0], 1);
        assert_eq!(snapshot.dropped_records, 1);
    }

    #[test]
    fn ring_enforces_count_bytes_and_oversize_drop_accounting() {
        let mut ring = ByteAccountedRing::new(2, 8);
        ring.push("one", 4);
        ring.push("two", 4);
        ring.push("three", 4);
        let snapshot = ring.snapshot(|value| *value);
        assert_eq!(snapshot.records, vec!["two", "three"]);
        assert_eq!(snapshot.retained_bytes, 8);
        assert_eq!(snapshot.dropped_records, 1);
        ring.push("oversize", 9);
        let snapshot = ring.snapshot(|value| *value);
        assert_eq!(snapshot.records, vec!["two", "three"]);
        assert_eq!(snapshot.dropped_records, 2);
    }

    #[test]
    fn recorder_off_is_a_noop_for_every_family_and_exact_state() {
        let mut recorder = RuntimeCostRecorder::disabled();
        recorder.record_mutation_phase(MutationPhaseCostV1::from_timestamps(
            "raw-id".to_owned(),
            "mutate".to_owned(),
            Some(1.0),
            Some(2.0),
            Some(3.0),
            Some(4.0),
            Some(5.0),
            "committed".to_owned(),
        ));
        recorder.record_server_mutation_phases("mutate", Some(1.0), Some(1.0), Some(1.0));
        recorder.record_query_observation(&observation(1));
        recorder.establish_subscription("sub", "query", Some(1), None, None);
        recorder.record_live_delivery_wave(LiveDeliveryWaveV1 {
            format: String::new(),
            wave_seq: 1,
            function_id: "query".to_owned(),
            plan_identity: None,
            rerun_cause: LiveRerunCauseV1::Refresh,
            coalesced: false,
            covered_versions: None,
            delivered_version: None,
            subscriber_count: 1,
            distinct_evaluation_groups: 1,
            real_evaluations: 1,
            memo_deliveries: 0,
            delivered_frames: 0,
            max_evaluation_turn_ms: Some(1.0),
            total_evaluation_turn_ms: Some(1.0),
            max_memo_delivery_turn_ms: None,
            total_memo_delivery_turn_ms: None,
        });
        let snapshot = recorder.snapshot();
        assert!(!snapshot.enabled);
        assert!(snapshot.mutation_phases.records.is_empty());
        assert!(snapshot.query_observations.records.is_empty());
        assert!(snapshot.live_delivery_waves.records.is_empty());
        assert!(snapshot.server_mutation_phase_counters.functions.is_empty());
        assert!(snapshot.subscription_registry.is_empty());
    }

    #[test]
    fn snapshot_pseudonymizes_caller_identity_and_drops_fixture_identity() {
        let raw_id = "save-user@example.com-draft";
        let mut recorder = RuntimeCostRecorder::enabled();
        recorder.record_mutation_phase(MutationPhaseCostV1::from_timestamps(
            raw_id.to_owned(),
            "todos.save".to_owned(),
            Some(1.0),
            Some(2.0),
            Some(3.0),
            Some(4.0),
            Some(5.0),
            "committed".to_owned(),
        ));
        recorder.record_query_observation(&observation(1));
        let json = serde_json::to_string(&recorder.snapshot()).unwrap();
        assert!(!json.contains(raw_id));
        assert!(!json.contains("SECRET-FIXTURE"));
        assert!(!json.contains("fixtureIdentity"));
        assert!(json.contains("sha256:"));
    }

    #[test]
    fn mutation_ring_accounts_the_projection_it_actually_retains() {
        let raw_id = "application-value".repeat(4_096);
        let mut recorder = RuntimeCostRecorder::with_limits(
            true,
            8,
            [
                4_096,
                QUERY_OBSERVATION_RING_BYTE_CAPACITY,
                LIVE_DELIVERY_RING_BYTE_CAPACITY,
            ],
            8,
        );
        recorder.record_mutation_phase(MutationPhaseCostV1::from_timestamps(
            raw_id.clone(),
            "todos.save".to_owned(),
            Some(1.0),
            Some(2.0),
            Some(3.0),
            Some(4.0),
            Some(5.0),
            "committed".to_owned(),
        ));

        let snapshot = recorder.snapshot();
        assert_eq!(snapshot.mutation_phases.records.len(), 1);
        assert_ne!(
            snapshot.mutation_phases.records[0].client_mutation_id,
            raw_id
        );
        let retained = &recorder
            .mutation_phases
            .records
            .front()
            .expect("one retained projected mutation")
            .0;
        assert_eq!(
            snapshot.mutation_phases.retained_bytes,
            serde_json::to_vec(retained).unwrap().len()
        );
    }

    #[test]
    fn invalid_query_observation_is_dropped_without_failing_the_caller() {
        let mut recorder = RuntimeCostRecorder::enabled();
        let mut invalid = observation(1);
        invalid.index_range_count = 2;

        recorder.record_query_observation(&invalid);

        let snapshot = recorder.snapshot();
        assert!(snapshot.query_observations.records.is_empty());
        assert_eq!(snapshot.query_observations.dropped_records, 1);
    }

    #[test]
    fn structural_work_rejects_arbitrary_application_values() {
        let mut value = serde_json::to_value(crate::graph_evaluator::StructuralWorkV1::default())
            .expect("structural work serializes");
        value
            .as_object_mut()
            .expect("structural work is an object")
            .insert(
                "applicationValue".to_owned(),
                serde_json::json!({ "secret": true }),
            );

        assert!(
            serde_json::from_value::<crate::graph_evaluator::StructuralWorkV1>(value).is_err(),
            "the closed structural-work carrier must reject arbitrary application values"
        );
    }

    #[test]
    fn mutation_phase_nullability_requires_both_endpoints() {
        let record = MutationPhaseCostV1::from_timestamps(
            "id".to_owned(),
            "mutate".to_owned(),
            Some(10.0),
            None,
            Some(30.0),
            Some(35.0),
            None,
            "refused".to_owned(),
        );
        assert_eq!(record.queue_wait_ms, None);
        assert_eq!(record.auth_wait_ms, None);
        assert_eq!(record.execution_ms, Some(5.0));
        assert_eq!(record.commit_ms, None);
    }

    #[test]
    fn query_projection_keeps_exact_totals_and_bounds_sample() {
        let mut recorder = RuntimeCostRecorder::enabled();
        recorder.record_query_observation(&observation(20));
        let snapshot = recorder.snapshot();
        let record = &snapshot.query_observations.records[0];
        assert_eq!(record.consultation_sample.len(), 16);
        assert_eq!(record.total_consultations, 20);
        assert_eq!(record.index_range_count, 20);
        assert_eq!(record.scanned_rows, 20);
        assert!(record.consultations_truncated);
        assert_eq!(snapshot.query_observations.truncated_records, 1);
    }

    #[test]
    fn counter_map_evicts_lru_into_exact_other_bucket() {
        let mut map = CappedFunctionCounters::new(2);
        map.record("a", Some(1.0), Some(2.0), Some(3.0));
        map.record("b", Some(4.0), None, None);
        map.record("a", Some(5.0), None, None);
        map.record("c", Some(6.0), Some(7.0), Some(8.0));
        let snapshot = map.snapshot();
        assert_eq!(snapshot.functions.len(), 2);
        assert!(snapshot.functions.contains_key("a"));
        assert!(snapshot.functions.contains_key("c"));
        assert_eq!(snapshot.evicted_keys, 1);
        assert_eq!(snapshot.other_keys.mutation_count, 1);
        assert_eq!(snapshot.other_keys.authorization.total_ms, 4.0);
        assert_eq!(
            snapshot
                .functions
                .values()
                .map(|value| value.mutation_count)
                .sum::<u64>()
                + snapshot.other_keys.mutation_count,
            4
        );
    }

    #[test]
    fn rerun_cause_uses_normative_precedence() {
        assert_eq!(
            LiveRerunCauseV1::ReconnectReestablish.merge(LiveRerunCauseV1::Refresh),
            LiveRerunCauseV1::Refresh
        );
        assert_eq!(
            LiveRerunCauseV1::MutationInvalidation
                .merge(LiveRerunCauseV1::AuthorizationInvalidation),
            LiveRerunCauseV1::AuthorizationInvalidation
        );
    }

    #[test]
    fn delivery_compare_and_clear_preserves_midflight_charge_and_stage() {
        let mut recorder = RuntimeCostRecorder::enabled();
        recorder.establish_subscription("sub", "query", Some(10), None, None);
        recorder.charge_committed_version("sub", 11);
        let wave = recorder.start_wave("sub", None).unwrap();
        recorder.charge_committed_version("sub", 12);
        recorder.mark_coalescing("sub");
        recorder.deliver_wave("sub", wave, 11);
        let row = row(&recorder, "sub");
        assert_eq!(row.owed_through_version, Some(12));
        assert_eq!(row.pending_work, LivePendingWorkV1::Coalescing);
        assert_eq!(row.evaluation, LiveEvaluationStageV1::Idle);
        assert_eq!(row.last_delivered_wave_seq, Some(wave));
        assert_eq!(row.last_delivered_version, Some(11));
    }

    #[test]
    fn non_delivery_transitions_preserve_obligations() {
        let mut recorder = RuntimeCostRecorder::enabled();
        recorder.establish_subscription("sub", "query", Some(10), None, None);
        recorder.charge_writeless_authority("sub");
        assert_eq!(row(&recorder, "sub").owed_through_version, None);
        assert_eq!(
            row(&recorder, "sub").pending_work,
            LivePendingWorkV1::Queued
        );

        recorder.queued_cancellation_transfer("sub");
        assert_eq!(
            row(&recorder, "sub").pending_work,
            LivePendingWorkV1::Queued
        );

        let authority_wave = recorder.start_wave("sub", None).unwrap();
        recorder.authority_gate_discard("sub", authority_wave);
        assert_eq!(
            row(&recorder, "sub").pending_work,
            LivePendingWorkV1::Queued
        );

        let cancelled_wave = recorder.start_wave("sub", None).unwrap();
        recorder.finish_in_flight_cancellation("sub", cancelled_wave);
        assert_eq!(
            row(&recorder, "sub").pending_work,
            LivePendingWorkV1::Queued
        );

        let timeout_wave = recorder.start_wave("sub", None).unwrap();
        recorder.evaluation_timeout("sub", timeout_wave);
        assert_eq!(
            row(&recorder, "sub").pending_work,
            LivePendingWorkV1::Queued
        );

        recorder.refresh_degradation("sub");
        assert_eq!(
            row(&recorder, "sub").pending_work,
            LivePendingWorkV1::Queued
        );

        recorder.retire_subscription("sub");
        assert!(recorder.snapshot().subscription_registry.is_empty());
    }

    #[test]
    fn retirement_then_reconnect_establishes_a_fresh_row() {
        let mut recorder = RuntimeCostRecorder::enabled();
        recorder.establish_subscription("old", "query", Some(10), None, None);
        recorder.charge_committed_version("old", 11);
        recorder.retire_subscription("old");
        recorder.establish_subscription("new", "query", Some(12), None, None);
        let snapshot = recorder.snapshot();
        assert_eq!(snapshot.subscription_registry.len(), 1);
        assert_eq!(snapshot.subscription_registry[0].subscription_id, "new");
        assert_eq!(
            snapshot.subscription_registry[0].last_delivered_version,
            Some(12)
        );
        assert_eq!(snapshot.subscription_registry[0].owed_through_version, None);
        assert_eq!(
            snapshot.subscription_registry[0].pending_work,
            LivePendingWorkV1::None
        );
    }
}
