//! Snapback 2 data plane: bounded data programs (LLP 0329.014.004), seeded from
//! spike S1 (`spikes/bounded-programs/`, LLP 0329.014 §8). No JS engine lives here.
mod bounds;
pub mod certificate;
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
    Ceilings, Certificate, CheckError, Checker, Completeness, PredictionMode, ReadSite, WriteKind,
    WriteSite, declared_serialized_row_max, max_certified_page_rows,
};
pub use client::{ClientStore, LocalState};
pub use engine::{
    AuthoritativeTrace, Context, Engine, Execution, ExecutionState, PointTrace, RuleInputTrace,
    RuntimeError, StopReason,
};
pub use identity::{IdentityError, Principal, Session};
pub use ir::*;
pub use live::{Delivery, SubscriptionId, SubscriptionInfo, Subscriptions};
pub use programs::*;
pub use registry::{
    ChannelSide, ChannelVerdict, EffectDecl, Generation, ProjectJson, RowRuleVerdict, Runtime,
};
pub use schema::*;
pub use store::{CommitRecord, OutboxCounts, OutboxRow, Store, TouchedKey};
pub use successor::{Drop, MigrationPlan, SuccessorRefusal, SuccessorReport, UniqueConflict};
pub use value::*;
