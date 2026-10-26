//! Read-only deployment configuration and owner inspection, before acquisition.
// @ref LLP 3000.009.001.000#3.4 — startup selects persisted source without opening a token-zero writer.
use super::{ownership, store};
use crate::{
    RuntimeError,
    store_port::{AnyStore, DeploymentState},
};

impl AnyStore {
    /// Read the owner's persisted clock declaration; the caller's environment
    /// cannot describe a different running owner's grant. Persisted state cannot
    /// confirm the owner's local grant after reconnect/revocation. No writer is acquired.
    pub fn postgres_diagnostics(connection: &str, namespace: &str) -> Result<(String, Vec<String>), RuntimeError> {
        let quoted=store::namespace(namespace)?;
        let (mut client,_)=ownership::connect(connection.parse()?)?;
        client.batch_execute(&format!("SET search_path={quoted},pg_catalog; SET statement_timeout='5s'"))?;
        let mut tx=client.build_transaction().read_only(true).start()?;
        super::checks::diagnose(&mut tx, namespace)?;
        let warnings=tx.query(super::managed_relations::EVENT_TRIGGERS,&[])?.iter().map(|row|
            super::managed_relations::event_warning(row.get(0),row.get(1),row.get(2),row.get(3),row.get(4),row.get(5))
        ).collect();
        let mut tier=crate::store_port::g5_read_cache_tier("no live qualified read grant on the owner (unset bounds or expired/drained grant)");
        if tx.query_one("SELECT to_regclass('_read_grant') IS NOT NULL",&[])?.get::<_,bool>(0) {
            if let Some(row)=tx.query_opt("SELECT g.epoch,(SELECT value FROM _meta WHERE key='read_grant_clock') FROM _read_grant g JOIN _owner o ON o.singleton=g.singleton AND o.store_id=g.store_id AND o.token=g.token AND o.holder=g.holder WHERE g.singleton AND g.valid_until>clock_timestamp() AND o.lease_until>clock_timestamp()",&[])? {
                let epoch:String=row.get(0);
                let notice=row.get::<_,Option<String>>(1).and_then(|s|serde_json::from_str::<serde_json::Value>(&s).ok());
                tier=match notice.filter(|n|n["epoch"].as_str()==Some(epoch.as_str())) {
                    Some(n) if n["rate_ppm"].as_u64().is_some() && n["forward_jump_ms"].as_u64().is_some()=>format!("persisted G6 read grant (clock bounds {},{}); owner-local activity unconfirmed (revocation/reconnect may use G5 validation)",n["rate_ppm"].as_u64().unwrap(),n["forward_jump_ms"].as_u64().unwrap()),
                    _=>"persisted G6 read grant (clock bounds unavailable from legacy owner); owner-local activity unconfirmed (revocation/reconnect may use G5 validation)".into(),
                };
            }
        }
        tx.rollback()?;
        Ok((tier,warnings))
    }

    /// Validate the currently admitted transport and return a non-secret binding.
    pub fn postgres_binding(connection: &str, namespace: &str) -> Result<String, RuntimeError> {
        store::namespace(namespace)?;
        let config: postgres::Config = connection.parse()?;
        // hostaddr takes precedence over host in the driver, including Unix hosts.
        // NoTls is the current adapter: every possible target must be a socket.
        if !config.get_hostaddrs().is_empty()
            || config.get_hosts().is_empty()
            || config
                .get_hosts()
                .iter()
                .any(|h| !matches!(h, postgres::config::Host::Unix(_)))
        {
            return Err(RuntimeError::StoreUnsupported {
                family: "connection-tls",
            });
        }
        let targets = config.get_hosts().iter().enumerate().map(|(i, host)| {
            let postgres::config::Host::Unix(directory) = host else { unreachable!() };
            let port = config.get_ports().get(i).or_else(|| config.get_ports().first())
                .copied().unwrap_or(5432);
            let socket = directory.join(format!(".s.PGSQL.{port}"));
            let socket = socket.to_str().ok_or_else(|| RuntimeError::Input(
                "Postgres socket paths must be UTF-8 for the deployment binding".into()
            ))?;
            Ok(serde_json::json!({"transport":"unix", "socket":socket}))
        }).collect::<Result<Vec<_>, RuntimeError>>()?;
        Ok(crate::value::canonical_json(&serde_json::json!({
            "backend":"postgres", "targets":targets, "hosts":config.get_hosts().iter().map(|h| match h {
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
        if let Some(row) = tx.query(super::managed_relations::SQL, &[&crate::managed_relations::TABLES])?.first() {
            return Err(crate::managed_relations::refusal(row.get(0), row.get(1)));
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn driver_errors_are_redacted_in_display_and_wire_refusals() {
        let driver = "password=private-password port=not_a_port".parse::<postgres::Config>().unwrap_err();
        for error in [RuntimeError::Postgres(driver), RuntimeError::CommitOutcomeUnknown("server detail: private-password".into())] {
            let rendered = error.to_string();
            let refusal = error.refusal();
            assert_eq!(refusal.code, error.code());
            assert_eq!(refusal.family, "store");
            assert!(!rendered.contains("private-password"), "{rendered}");
            assert!(!serde_json::to_string(&refusal).unwrap().contains("private-password"));
            if matches!(error, RuntimeError::CommitOutcomeUnknown(_)) {
                assert!(rendered.contains("resolve the persisted receipt"));
                assert!(!refusal.retryable);
            }
        }
    }

    #[test]
    fn binding_records_effective_socket_targets_without_connecting() {
        assert!(AnyStore::postgres_binding("postgres://app@/db?host=%2Ftmp%FF", "my_app").is_err());
        for (parameters, expected) in [
            ("host=/tmp/socket", vec!["/tmp/socket/.s.PGSQL.5432"]),
            ("host=/tmp/one&host=/tmp/two&port=5433,5434", vec!["/tmp/one/.s.PGSQL.5433", "/tmp/two/.s.PGSQL.5434"]),
            ("host=/tmp/one&host=/tmp/two&port=5435", vec!["/tmp/one/.s.PGSQL.5435", "/tmp/two/.s.PGSQL.5435"]),
        ] {
            let binding = AnyStore::postgres_binding(&format!("postgres://app:private-password@/db?{parameters}"), "my_app").unwrap();
            assert!(!binding.contains("private-password"));
            let binding: serde_json::Value = serde_json::from_str(&binding).unwrap();
            let targets = binding["targets"].as_array().unwrap();
            assert_eq!(targets.len(), expected.len());
            for (target, socket) in targets.iter().zip(expected) {
                assert_eq!(target["transport"], "unix");
                assert_eq!(target["socket"], socket);
            }
        }
    }
}
