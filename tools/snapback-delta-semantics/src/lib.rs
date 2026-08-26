//! Pure, tool-only reference evaluator for LLP 0309.000 operator delta semantics.
//!
//! This crate is deliberately isolated from the graph and local serving
//! lanes. It accepts all bounded reads as an explicit transcript and has no
//! ambient storage, clock, authorization, or runtime effects.

mod evaluator;
mod types;

pub use evaluator::{
    evaluate_admit, evaluate_assemble, evaluate_case, evaluate_composition, evaluate_lookup,
    evaluate_membership_lift, evaluate_operator, evaluate_per_parent_window, evaluate_principal,
    evaluate_support, evaluate_window, fold_app_batch,
};
pub use types::*;

#[cfg(test)]
mod tests;
