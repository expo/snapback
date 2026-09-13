//! Snapback 2 data plane: bounded data programs (LLP 0329.014.004), seeded from
//! spike S1 (`spikes/bounded-programs/`, LLP 0329.014 §8). No JS engine lives here.
mod assets;
pub mod acquisition;
pub mod assets_ledger;
mod bounds;
mod cap;
pub mod certificate;
mod certificate_policy;
pub mod client;
mod collection_rewrite;
mod connected;
pub mod cursor;
pub mod delivery;
pub mod engine;
mod growth;
pub mod identity;
pub mod ir;
pub mod live;
pub mod offline;
pub mod principal;
pub mod programs;
pub mod registry;
mod retention;
mod rule_types;
pub mod schema;
pub use connected::{CONNECTED_INDEX, CONNECTED_TABLE};
pub mod search_key;
pub mod store;
pub mod successor;
pub mod unicode;
mod unicode_tables;
pub mod value;

pub use assets::AssetKind;
pub use acquisition::{AcquisitionReceiptGroup, AcquisitionReceiptOutcome, AcquisitionReceiptPacket};
pub use assets_ledger::{
    ASSET_RECLAIM_GRACE_MS, AssetDelivery, AssetLedgerRow, AssetLocator, AssetReadyFacts,
    AssetReclaimPage, AssetStagingSnapshot, AssetStagingUsage, AssetState, STAGING_GLOBAL_BYTES,
    STAGING_GLOBAL_OBJECTS, STAGING_PER_PRINCIPAL_BYTES, STAGING_PER_PRINCIPAL_OBJECTS,
};
pub use certificate::{
    Ceilings, Certificate, CertificateTable, CheckError, Checker, Completeness, PredictionMode,
    ReadSite, RuleCertificate, WriteKind, WriteSite, declared_serialized_row_max,
    max_certified_page_rows,
};
pub use client::{ClientStore, LocalState};
pub use cursor::{
    CursorColumn, CursorError, CursorPosition, decode_cursor, decode_cursor_for, encode_cursor,
};
pub use delivery::{Deliver, DeliveryIssue, delivery_issues};
pub use engine::{
    AuthoritativeTrace, Context, Engine, Execution, ExecutionState, PointTrace, ResultProvenance,
    RuleInputTrace, RuntimeError, StopReason, validate_schema,
};
pub use identity::{
    Actor, ActorError, CURRENT_VALUE_MODEL_VERSION, IR_CONTRACT_JSON, IdentityError, Principal,
    SYSTEM_PRINCIPAL_ID, Session, SessionAuthority,
};
pub use ir::*;
pub use live::{Delivery, SubscriptionId, SubscriptionInfo, Subscriptions};
pub use offline::{
    DELIVERY_PROTOCOL_V1, DeliveryAuthority, DeliveryEnvelopeV1, DeliveryProjectionContext,
    DeliveryProjectionError, DeliveryRange, DeliveryReceipt, DeliveryRow, DeliveryState,
    DeliveryVerdict, REPLAY_GRANT_COUNT, REPLAY_GRANT_LIFETIME_MS, REPLAY_GRANT_LOW_WATERMARK,
    ReplayCommit, ReplayGrant, ReplayTrace, ReplayTracePoint, ReplayTraceVerdict,
    StoredClientIntent, created_inputs_digest, project as project_delivery,
    replay_mutation_response, row_digest, rule_inputs_digest, value_to_wire_json, WireValue,
};
pub use principal::PrincipalId;
pub use programs::*;
pub use registry::{
    ChannelCertificates, ChannelSide, ChannelVerdict, EffectDecl, Generation, OperatorId,
    ProjectJson, ResetResult, RowRuleVerdict, Runtime,
};
pub use schema::*;
pub use store::{CommitRecord, OutboxClaim, OutboxCounts, OutboxRow, ScopeTouch, Store, TouchedKey};
pub use successor::{Drop, MigrationPlan, SuccessorRefusal, SuccessorReport, UniqueConflict};
pub use value::*;

pub mod jobs;
mod store_jobs;
mod store_rehearsal;
pub use store_rehearsal::{RehearsalEmit, RehearsalRelease, RehearsalSideEffects};

mod store_timers;
pub mod timers;
