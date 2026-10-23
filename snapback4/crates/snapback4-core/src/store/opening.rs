//! Server construction facts belong to the transaction that accepts the open.
// @ref LLP 3000.033#1.3 — no fallible construction reads after commit.
use super::*;

pub(crate) use crate::store_port::OpeningMetadata as Metadata;

impl Metadata {
    pub fn read(tx: &impl crate::metadata::MetadataReader) -> Result<Self, RuntimeError> {
        Ok(Self {
            store_id: tx.store_identity()?.unwrap_or_default(),
            dev_effects: tx.release_value()?.is_none(),
        })
    }
}

/// An open that needs activation releases its first snapshot. Bind that repair
/// to the exact stored backend it validated, not just the declared hash.
pub(crate) use crate::activation::Backend;

impl Backend {
    pub fn check(&self, conn: &Connection) -> Result<(), RuntimeError> {
        let raw: Option<String> = conn.query_row("SELECT value FROM _meta WHERE key='generation'", [], |row| row.get(0)).optional()?;
        let generation = crate::activation::stored_generation(raw.as_deref())?;
        let held: (i64, String, String) = conn.query_row(
            "SELECT generation, schema, programs FROM _generations WHERE generation = ?1",
            [generation], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?;
        crate::activation::check_backend(&Backend(held.0, held.1, held.2), self)
    }
}

impl Store {
    pub(super) fn check_version(conn: &Connection) -> Result<(), RuntimeError> {
        let version: String = conn.query_row("SELECT value FROM _meta WHERE key = 'version'", [], |r| r.get(0))?;
        Self::validate_version(&version)?;
        Ok(())
    }

    // @ref LLP 3000.000.000.001#11-wave-22-loop-repairs-dx6 — later known-family formats require an explicit upgrade repair.
    pub(super) fn validate_version(version: &str) -> Result<(), RuntimeError> {
        if [STORE_VERSION, super::dormant::VERSION, "snapback4-release-store-2", "snapback4-release-store-6", "snapback4-release-store-8", "snapback4-release-store-9", super::table_renames::VERSION, super::backfills::VERSION].contains(&version) {
            return Ok(());
        }
        let newer = version.strip_prefix("snapback4-release-store-").and_then(|number| number.parse::<u64>().ok()).is_some_and(|number| number > 10)
            || version.strip_prefix("snapback4-store-").and_then(|number| number.parse::<u64>().ok()).is_some_and(|number| number > 1);
        let owner = if newer { format!("a newer Snapback ({version}); upgrade Snapback before opening this data directory") }
            else { format!("another Snapback ({version}); expected a supported {STORE_VERSION} format") };
        Err(RuntimeError::Store(format!("this data directory belongs to {owner}")))
    }

    pub(crate) fn opening_transaction(&mut self) -> Result<Tx<'_>, RuntimeError> {
        let tx = if self.conn.is_readonly("main")? { self.read_transaction()? } else { self.transaction()? };
        Self::check_version(tx.conn())?;
        let catalog = tx.conn().prepare("SELECT name, num FROM _catalog")?.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<BTreeMap<String, i64>, _>>()?;
        if &catalog != tx.catalog {
            return Err(RuntimeError::Generation("the catalog changed while opening; retry open".into()));
        }
        Ok(tx)
    }

    /// The caller keeps its validation transaction until all construction reads
    /// and upgrades finish. Read-only inspection never installs anything.
    pub(crate) fn finish_open(tx: Tx<'_>) -> Result<Metadata, RuntimeError> {
        if tx.conn().is_readonly("main")? {
            let metadata = Metadata::read(&tx)?;
            tx.rollback()?;
            return Ok(metadata);
        }
        Self::initialize_schema(tx.conn())?;
        Self::initialize_change_evidence(tx.conn())?;
        let metadata = Metadata::read(&tx)?;
        tx.commit()?;
        Ok(metadata)
    }
}
