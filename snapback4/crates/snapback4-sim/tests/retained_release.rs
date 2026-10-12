//! The same deterministic fault trace used by device conformance is also a
//! simulator acceptance: stale/reordered pages, audience isolation and restart.
// @ref LLP 3000.000.000#6-devices-and-partitions — source rollback always gets a new replica generation.
#[path = "../../snapback4-device/tests/retained_release.rs"]
mod trace;
