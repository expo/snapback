//! One complete first schema, followed by feature-specific pointers.
// @ref LLP 3000.037.000#8 — start replaces the introductory card tour.
pub const START_CARDS: &[&str] = &[];
pub(super) fn card() -> &'static str { include_str!("start.md") }
