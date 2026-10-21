//! SQLite access for release, schema and timeline activation.
use super::*;
use crate::activation::{
    ActivationPreparation, ActivationReader, ActivationTransaction, Backend, TimelineWorkReader,
};
use crate::metadata::RestoredPopulation;

impl ActivationReader for Tx<'_> {
    fn opening_backend(&self) -> Result<Backend, RuntimeError> {
        self.conn().query_row(
            "SELECT g.generation, g.schema, g.programs FROM _generations g JOIN _meta m ON m.key = 'generation' AND g.generation = CAST(m.value AS INTEGER)",
            [], |row| Ok(Backend(row.get(0)?, row.get(1)?, row.get(2)?)))
            .map_err(|e| RuntimeError::Store(format!("no readable activated backend in this store: {e}")))
    }
    fn check_selected_release(&self, expected: Option<u64>) -> Result<(), RuntimeError> {
        Store::check_selected_release(self.conn(), expected)
    }
    fn time_audience_clock(&self) -> Result<i64, RuntimeError> { self.time_audience_clock() }
    fn opening_marker(&self, marker: crate::metadata::SchemaMarker) -> Result<Option<String>, RuntimeError> { self.schema_marker(marker) }
    fn previous_schema(&self) -> Result<Option<String>, RuntimeError> {
        Ok(self.conn().query_row("SELECT schema FROM _generations WHERE generation = (SELECT CAST(value AS INTEGER) FROM _meta WHERE key = 'generation')", [], |row| row.get(0)).optional()?)
    }
    fn live_sum_marker(&self) -> Result<Option<String>, RuntimeError> {
        Ok(self
            .conn()
            .query_row(
                "SELECT value FROM _meta WHERE key = 'live_sum_candidates'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?)
    }
    fn activation_population(&self) -> Result<Option<String>, RuntimeError> {
        self.meta("activation_population")
    }
    fn narrowed_retained(&self) -> Result<Option<String>, RuntimeError> {
        self.meta("activation_narrowed_retained")
    }
    fn narrowed_restored(&self) -> Result<Option<String>, RuntimeError> {
        self.meta("activation_narrowed_restored")
    }
    fn restored_population(
        &self,
        kind: RestoredPopulation,
        path: &str,
    ) -> Result<Option<String>, RuntimeError> {
        let prefix = match kind {
            RestoredPopulation::Rows => "activation_narrowed_restored",
            RestoredPopulation::Column => "activation_column_restored",
            RestoredPopulation::Table => "activation_table_restored",
        };
        self.meta(&format!("{prefix}:{path}"))
    }
    fn activation_inventory(&self) -> Result<Vec<release_history::DormantItem>, RuntimeError> {
        release_history::inventory(self.conn(), None, usize::MAX)
    }
    fn table_populated(&self, table: &str) -> Result<bool, RuntimeError> {
        Ok(self.conn().query_row(
            "SELECT EXISTS(SELECT 1 FROM r JOIN _catalog c ON r.t = c.num WHERE c.name = ?1)",
            [table],
            |row| row.get(0),
        )?)
    }
    fn any_table_image(
        &self,
        table: &str,
        mut survives: impl FnMut(&Value) -> bool,
    ) -> Result<bool, RuntimeError> {
        let mut statement = self
            .conn()
            .prepare("SELECT data FROM r WHERE t = (SELECT num FROM _catalog WHERE name = ?1) ORDER BY id")?;
        let mut rows = statement.query([table])?;
        while let Some(row) = rows.next()? {
            let image: Value = crate::json_codec::from_text(
                row.get_ref(0)?
                    .as_str()
                    .map_err(|e| RuntimeError::Store(e.to_string()))?,
            )
            .map_err(|e| RuntimeError::Store(e.to_string()))?;
            if survives(&image) {
                return Ok(true);
            }
        }
        Ok(false)
    }
    fn timeline_rebuild_exists(&self, table: &str, id: &str) -> Result<bool, RuntimeError> {
        Ok(self.conn().query_row("SELECT EXISTS(SELECT 1 FROM r WHERE t = (SELECT num FROM _catalog WHERE name = ?1) AND id = ?2)", [table, id], |row| row.get(0))?)
    }
}

impl ActivationTransaction for Tx<'_> {
    fn set_active_release(&self, release: u64) -> Result<(), RuntimeError> {
        self.set_meta("release", &release.to_string())
    }
    fn mark_live_sum_candidates(&self) -> Result<(), RuntimeError> {
        self.set_meta("live_sum_candidates", "1")
    }
    fn mark_maintained_ids(&self) -> Result<(), RuntimeError> {
        self.set_meta(
            crate::schema::MAINTAINED_ID_META,
            crate::schema::MAINTAINED_ID_VERSION,
        )
    }
    fn set_audience_epoch(&self, table: &str, epoch: u64, now: i64) -> Result<(), RuntimeError> {
        self.set_meta(
            &crate::partition::audience_epoch_key(table),
            &epoch.to_string(),
        )?;
        self.set_meta(
            &crate::partition::audience_epoch_time_key(table),
            &now.to_string(),
        )
    }
    fn clear_activation_metadata(&self) -> Result<(), RuntimeError> {
        self.conn().execute("DELETE FROM _meta WHERE key IN ('activation_restore','activation_population','activation_narrowed_retained','activation_narrowed_restored') OR key LIKE 'activation_narrowed_restored:%' OR key LIKE 'activation_column_restored:%' OR key LIKE 'activation_table_restored:%' OR key LIKE 'activation_table_restored_ids:%' OR key LIKE 'activation_narrowed_restored_ids:%' OR key LIKE 'activation_column_restored_ids:%'",[])?;
        Ok(())
    }
    fn clear_retired_table(&self, table: &str) -> Result<(), RuntimeError> {
        self.conn().execute(
            "DELETE FROM r WHERE t = (SELECT num FROM _catalog WHERE name = ?1)",
            [table],
        )?;
        Ok(())
    }
    fn clear_retired_index(&self, table: &str, index: &str) -> Result<(), RuntimeError> {
        self.conn().execute(
            "DELETE FROM i WHERE ti = (SELECT num FROM _catalog WHERE name = ?1)",
            [format!("{table}.{index}")],
        )?;
        Ok(())
    }
}

impl ActivationPreparation for super::release::ReleaseCheck<'_> {
    fn check_selected_release(&self, expected: Option<u64>) -> Result<(), RuntimeError> {
        Store::check_selected_release(self.0, expected)
    }
    fn check_backend(&self, backend: &Backend) -> Result<(), RuntimeError> {
        backend.check(self.0)
    }
    fn activation_inventory(&self) -> Result<Vec<release_history::DormantItem>, RuntimeError> {
        release_history::inventory(self.0, None, usize::MAX)
    }
    fn enable_dormant(&self) -> Result<(), RuntimeError> {
        dormant::enable(self.0)
    }
    fn prepare_release_metadata(
        &self,
        native_digest: &str,
        restore: bool,
    ) -> Result<(), RuntimeError> {
        self.0.execute("INSERT INTO _meta(key,value) VALUES('release_native_digest',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[native_digest])?;
        self.0.execute("INSERT INTO _meta(key,value) VALUES('activation_restore',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[if restore {"true"}else{"false"}])?;
        Ok(())
    }
}

impl TimelineWorkReader for Store {
    fn timeline_work_count(&self, table: &str, state: &str) -> Result<u64, RuntimeError> {
        self.conn().query_row(
            "SELECT count(*) FROM r JOIN _catalog c ON r.t = c.num WHERE c.name = ?1 AND json_extract(r.data, '$.Row.status.String') = ?2",
            [table, state], |row| row.get::<_, i64>(0).map(|n| n as u64)).map_err(RuntimeError::from)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn streaming_and_retired_name_cases() {
        let mut store = Store::memory().unwrap();
        let tx = store.transaction().unwrap();
        tx.conn()
            .execute("INSERT INTO _catalog(name, num) VALUES ('items', 1)", [])
            .unwrap();
        tx.conn()
            .execute(
                "INSERT INTO r(t, id, data) VALUES (1, 'a', ?1), (1, 'b', 'invalid json')",
                [crate::value::canonical_json(&Value::Null)],
            )
            .unwrap();
        crate::activation::test_cases::streaming_retirement(&tx);
        crate::activation::test_cases::retired_names(&tx);
        tx.rollback().unwrap();
    }
}
