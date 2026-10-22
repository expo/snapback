//! Recovery must prove a complete committed bootstrap before normal open can
//! install additive upgrades. It never claims a token or repairs missing state.
// @ref LLP 3000.009.001.000#initial-http-profile-and-public-release-bootstrap — pending intent binds the only recoverable identity.
use super::{ownership, store};
use crate::{Program, RuntimeError, Schema, store_port::AnyStore};
use std::collections::BTreeMap;

pub(super) fn incomplete(detail: &str) -> RuntimeError {
    RuntimeError::Store(format!(
        "bootstrap incomplete: {detail}; restore the original complete bootstrap and its pending intent, then retry deploy"
    ))
}

impl AnyStore {
    pub fn validate_postgres_bootstrap(
        connection: &str,
        namespace: &str,
        id: &str,
    ) -> Result<(), RuntimeError> {
        let (mut client, _) = ownership::connect(connection.parse()?)?;
        client.batch_execute(&format!(
            "SET search_path={},pg_catalog; SET statement_timeout='5s'; SET lock_timeout='5s'",
            store::namespace(namespace)?
        ))?;
        let mut checked = store::Store::new(client);
        let tx = checked.bootstrap_read_transaction()?;
        super::bootstrap_schema::verify(&tx)?;
        ownership::verify_record(&tx, id)?;
        let owner = tx.query("SELECT token,holder,lease_until='-infinity'::timestamptz FROM _owner WHERE singleton", &[])?;
        if owner[0].get::<_, i64>(0) != 0
            || owner[0].get::<_, &str>(1) != "0000"
            || !owner[0].get::<_, bool>(2)
        {
            return Err(incomplete("bootstrap was already owned"));
        }
        let rows = tx.query(
            "SELECT singleton,version,schema,programs,generation FROM _backend",
            &[],
        )?;
        if rows.len() != 1
            || !rows[0].try_get::<_, bool>(0)?
            || rows[0].try_get::<_, &str>(1)? != store::VERSION
            || rows[0].try_get::<_, i64>(4)? != 1
        {
            return Err(incomplete("invalid initial backend/generation"));
        }
        let schema: Schema = store::decode(rows[0].try_get(2)?)?;
        let programs: BTreeMap<String, Program> = store::decode(rows[0].try_get(3)?)?;
        super::profile::admit(&schema, &programs)?;
        let hash = schema.hash();
        let activation = crate::activation::activation_hash(&schema, &programs, None);
        for (key, expected) in [
            ("generation", "1"),
            ("schema_hash", hash.as_str()),
            ("activation_hash", activation.as_str()),
            ("live_sum_candidates", "1"),
            ("time_audience_publications_v1", "1"),
        ] {
            if tx.meta(key)?.as_deref() != Some(expected) {
                return Err(incomplete(&format!("missing or mismatched marker {key}")));
            }
        }
        if schema.maintains.iter().any(|m| m.row_key.is_none())
            && tx.meta(crate::schema::MAINTAINED_ID_META)?.as_deref()
                != Some(crate::schema::MAINTAINED_ID_VERSION)
        {
            return Err(incomplete(
                "missing or mismatched maintained identity marker",
            ));
        }
        if crate::rows::caps::required(&schema)
            && tx.meta("cap_counts_schema")?.as_deref() != Some(&hash)
        {
            return Err(incomplete("missing or mismatched cap_counts_schema marker"));
        }
        if tx.meta("release")?.is_some() || tx.meta("release_revision")?.is_some_and(|r| r != "0") {
            return Err(incomplete("release already selected or revised"));
        }
        let head = tx.query("SELECT singleton,seq FROM _head", &[])?;
        if head.len() != 1 || !head[0].try_get::<_, bool>(0)? || head[0].try_get::<_, i64>(1)? < 0 {
            return Err(incomplete("invalid head singleton"));
        }
        let generations = tx.query("SELECT generation,schema,programs FROM _generations", &[])?;
        if generations.len() != 1
            || generations[0].get::<_, i64>(0) != 1
            || generations[0].get::<_, &str>(1) != rows[0].get::<_, &str>(2)
            || generations[0].get::<_, &str>(2) != rows[0].get::<_, &str>(3)
        {
            return Err(incomplete(
                "initial generation history differs from backend",
            ));
        }
        tx.rollback()
    }
}
