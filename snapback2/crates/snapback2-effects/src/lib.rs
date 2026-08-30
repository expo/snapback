//! Effects run outside the Snapback 2 data plane.
//!
//! The default build contains the [`EffectHost`] seam and [`NoEngine`] only.
//! Enabling `hermes` adds [`Ibex2Host`], the sole place Snapback 2 links a
//! JavaScript engine. Durable jobs cross the owner boundary through
//! [`OutboxAccess`], so no store borrow is held while JavaScript or network I/O
//! runs.

mod host;
mod runner;

pub use host::{EffectHost, EffectJob, EffectLog, NoEngine, Outcome, describe};
pub use runner::{
    DEFAULT_BUDGET, DEFAULT_DRAIN_LIMIT, Drained, EffectDeclarations, OutboxAccess, OutboxError,
    OutboxSettlement, PendingThen, Runner, ThenOutcome,
};

#[cfg(feature = "hermes")]
mod ibex;
#[cfg(feature = "hermes")]
pub use ibex::Ibex2Host;
