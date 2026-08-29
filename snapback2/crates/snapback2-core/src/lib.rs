//! Snapback 2 data plane: bounded data programs (LLP 0329.014.004), seeded from
//! spike S1 (`spikes/bounded-programs/`, LLP 0329.014 §8). No JS engine lives here.
pub mod certificate;
pub mod client;
pub mod engine;
pub mod ir;
pub mod programs;
pub mod schema;
pub mod value;

pub use certificate::{Ceilings, Certificate, CheckError, Checker, PredictionMode};
pub use client::{ClientStore, LocalState};
pub use engine::{Context, Engine, Execution, RuntimeError, StopReason};
pub use ir::*;
pub use programs::*;
pub use schema::*;
pub use value::*;
