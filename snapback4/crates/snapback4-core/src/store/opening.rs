//! Server construction facts belong to the transaction that accepts the open.
// @ref LLP 3000.033#1.3 — no fallible construction reads after commit.
use super::*;

pub(crate) struct Metadata {
    pub store_id: String,
    pub dev_effects: bool,
}

impl Metadata {
    pub fn read(tx: &Tx<'_>) -> Result<Self, RuntimeError> {
        Ok(Self {
            store_id: tx.meta("store_id")?.unwrap_or_default(),
            dev_effects: tx.meta("release")?.is_none(),
        })
    }
}

/// An open that needs activation releases its first snapshot. Bind that repair
/// to the exact stored backend it validated, not just the declared hash.
pub(crate) struct Backend(pub i64, pub String, pub String);

impl Backend {
    pub fn check(&self, conn: &Connection) -> Result<(), RuntimeError> {
        let held: (i64, String, String) = conn.query_row(
            "SELECT g.generation, g.schema, g.programs FROM _generations g JOIN _meta m ON m.key = 'generation' AND g.generation = CAST(m.value AS INTEGER)",
            [], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?;
        if held.0 != self.0 || held.1 != self.1 || held.2 != self.2 {
            return Err(RuntimeError::Generation("the stored backend changed while opening; retry open".into()));
        }
        Ok(())
    }
}

impl Store {
    pub(super) fn check_version(conn: &Connection) -> Result<(), RuntimeError> {
        let version: String = conn.query_row("SELECT value FROM _meta WHERE key = 'version'", [], |r| r.get(0))?;
        if version != STORE_VERSION && version != super::dormant::VERSION && version != "snapback4-release-store-2" {
            return Err(RuntimeError::Store(format!("store version {version} is not {STORE_VERSION}; this data directory belongs to another Snapback")));
        }
        Ok(())
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
