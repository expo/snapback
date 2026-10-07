//! Seeded Quarry source tests, rewrite oracles, meter boundaries and replay.
//! Only public engine APIs are used; the crate is not a shipped dependency.
// @ref LLP 3000.035#5.1-stage-1-a-generator-and-rust-against-rust-comparison — source generator and Rust outcome comparison.
pub mod ast;
pub mod campaign;
pub mod coverage;
pub mod execute;
pub mod generate;
pub mod meter;
pub mod oracle;
pub mod shrink;
pub mod sites;
