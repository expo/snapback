//! Release audit relations are installed at attach, never in a hot writer.
use super::{shape, store::Tx};
use crate::RuntimeError;

pub(super) fn initialize(tx: &Tx<'_>) -> Result<(), RuntimeError> {
    for (table, columns, primary) in [
        ("_release_events", &[("id", "bigint", true, false), ("at", "bigint", true, false), ("operation", "text", true, false), ("release", "bigint", false, false), ("previous", "bigint", false, false), ("generation", "bigint", true, false), ("revision", "bigint", true, false), ("summary", "text", true, false)][..], &["id"][..]),
        ("_release_event_items", &[("event", "bigint", true, false), ("path", "text", true, true), ("detail", "text", true, false)][..], &["event", "path"][..]),
    ] {
        shape::verify(tx, table, columns, primary, "SNAPBACK_RELEASE_SCHEMA")?;
    }
    tx.batch(r#"
        CREATE TABLE IF NOT EXISTS _release_events (id BIGINT PRIMARY KEY, at BIGINT NOT NULL, operation TEXT NOT NULL, release BIGINT, previous BIGINT, generation BIGINT NOT NULL, revision BIGINT NOT NULL, summary TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS _release_event_items (event BIGINT NOT NULL, path TEXT COLLATE "C" NOT NULL, detail TEXT NOT NULL, PRIMARY KEY(event,path));
    "#)
}
