//! Read-only deployment configuration and owner inspection, before acquisition.
// @ref LLP 3000.009.001.000#3.4 — startup selects persisted source without opening a token-zero writer.
use super::{ownership, store};
use crate::{
    RuntimeError,
    store_port::{AnyStore, DeploymentState},
};

impl AnyStore {
    /// Validate the currently admitted transport and return a non-secret binding.
    pub fn postgres_binding(connection: &str, namespace: &str) -> Result<String, RuntimeError> {
        store::namespace(namespace)?;
        let config: postgres::Config = connection.parse()?;
        // NoTls is the current adapter. Refuse TCP rather than silently dropping TLS.
        if config.get_hosts().is_empty()
            || config
                .get_hosts()
                .iter()
                .any(|h| !matches!(h, postgres::config::Host::Unix(_)))
        {
            return Err(RuntimeError::StoreUnsupported {
                family: "connection-tls",
            });
        }
        Ok(crate::value::canonical_json(&serde_json::json!({
            "backend":"postgres", "hosts":config.get_hosts().iter().map(|h| match h {
                postgres::config::Host::Unix(p) => p.to_string_lossy().into_owned(),
                postgres::config::Host::Tcp(h) => h.clone(),
            }).collect::<Vec<_>>(), "ports":config.get_ports(), "database":config.get_dbname().unwrap_or(""),
            "role":config.get_user().unwrap_or(""), "schema":namespace, "ha":"none"
        })))
    }

    pub fn postgres_deployment(
        connection: &str,
        namespace: &str,
    ) -> Result<Option<DeploymentState>, RuntimeError> {
        let quoted = store::namespace(namespace)?;
        let (mut client, _) = ownership::connect(connection.parse()?)?;
        if !client
            .query_one("SELECT to_regnamespace($1) IS NOT NULL", &[&namespace])?
            .get::<_, bool>(0)
        {
            return Ok(None);
        }
        client.batch_execute(&format!(
            "SET search_path={quoted},pg_catalog; SET statement_timeout='5s'"
        ))?;
        let mut tx = client.build_transaction().read_only(true).start()?;
        let row = tx.query_one("SELECT o.store_id,o.holder,o.token,o.lease_until::text,o.lease_until<clock_timestamp(),b.generation, (SELECT value FROM _meta WHERE key='release'), (SELECT value FROM _meta WHERE key='release_revision'), (SELECT value FROM _meta WHERE key='store_id') FROM _owner o CROSS JOIN _backend b WHERE o.singleton AND b.singleton", &[])?;
        let store_id: String = row.try_get(0)?;
        if row.try_get::<_, Option<String>>(8)?.as_deref() != Some(&store_id) {
            return Err(RuntimeError::StoreOwnership(
                "deployment store identity mismatch".into(),
            ));
        }
        let parse = |text: Option<String>| -> Result<Option<u64>, RuntimeError> {
            text.map(|s| {
                s.parse().map_err(|_| {
                    RuntimeError::Generation("invalid persisted release counter".into())
                })
            })
            .transpose()
        };
        let state = DeploymentState {
            store_id,
            holder: row.try_get(1)?,
            token: row.try_get(2)?,
            lease_until: row.try_get(3)?,
            expired: row.try_get(4)?,
            generation: u64::try_from(row.try_get::<_, i64>(5)?)
                .map_err(|_| RuntimeError::Generation("invalid generation".into()))?,
            release: parse(row.try_get(6)?)?,
            revision: parse(row.try_get(7)?)?.unwrap_or(0),
        };
        let hex = |s: &str, n: usize| s.len() == n && s.bytes().all(|c| c.is_ascii_hexdigit());
        if !hex(&state.store_id, 32) || !hex(&state.holder, 4) || state.token < 0 {
            return Err(RuntimeError::StoreOwnership(
                "invalid deployment owner identity/token".into(),
            ));
        }
        if state.generation == 0 || state.release == Some(0) {
            return Err(RuntimeError::Generation(
                "invalid persisted release/generation".into(),
            ));
        }
        tx.rollback()?;
        Ok(Some(state))
    }
}
