//! Rank-7 integration harnesses that need explicit privileged test fixtures.
//!
//! This crate intentionally has no production dependencies. Its integration
//! tests declare privileged external tools as visible dev-dependencies so the
//! workspace graph gate can audit them directly.
