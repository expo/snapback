//! Snapback 2 data plane: bounded data programs (LLP 0329.014.004), seeded from
//! spike S1 (`spikes/bounded-programs/`, LLP 0329.014 §8). No JS engine lives here.
mod bounds;
pub mod certificate;
mod certificate_policy;
pub mod client;
mod collection_rewrite;
pub mod engine;
mod growth;
pub mod identity;
pub mod ir;
pub mod live;
pub mod programs;
pub mod registry;
mod retention;
pub mod schema;
pub mod store;
pub mod successor;
pub mod value;

pub use certificate::{
    Ceilings, Certificate, CheckError, Checker, Completeness, PredictionMode, ReadSite,
    RuleCertificate, WriteKind, WriteSite, declared_serialized_row_max, max_certified_page_rows,
};
pub use client::{ClientStore, LocalState};
pub use engine::{
    AuthoritativeTrace, Context, Engine, Execution, ExecutionState, PointTrace, RuleInputTrace,
    RuntimeError, StopReason, validate_schema,
};
pub use identity::{
    Actor, ActorError, IR_CONTRACT_JSON, IdentityError, Principal, SYSTEM_PRINCIPAL_ID, Session,
};
pub use ir::*;
pub use live::{Delivery, SubscriptionId, SubscriptionInfo, Subscriptions};
pub use programs::*;
pub use registry::{
    ChannelCertificates, ChannelSide, ChannelVerdict, EffectDecl, Generation, ProjectJson,
    RowRuleVerdict, Runtime,
};
pub use schema::*;
pub use store::{CommitRecord, OutboxCounts, OutboxRow, Store, TouchedKey};
pub use successor::{Drop, MigrationPlan, SuccessorRefusal, SuccessorReport, UniqueConflict};
pub use value::*;
