//! Whole managed-schema interception refusal, including incoming constraints.
use super::store::Tx;
use crate::RuntimeError;

pub(super) fn verify(tx: &Tx<'_>) -> Result<(), RuntimeError> {
    let rows = tx.query(SQL, &[&crate::managed_relations::TABLES])?;
    if let Some(row) = rows.first() {
        return Err(crate::managed_relations::refusal(row.get(0), row.get(1)));
    }
    Ok(())
}

// Capture identity before DDL without preempting the family's named attach
// diagnostics. Positive checks run after its installers, before movement.
pub(super) fn capture(tx: &Tx<'_>) -> Result<(), RuntimeError> {
    let mut captured = tx.activation_relations.borrow_mut();
    for row in tx.query(IDENTITIES, &[&crate::managed_relations::TABLES])? {
        captured
            .entry((row.get::<_, u32>(1), row.get::<_, String>(2)))
            .or_insert(row.get::<_, u32>(0));
    }
    Ok(())
}

// @ref LLP 3000.009.001.000.002#6 — after installer DDL/before movement and immediately before COMMIT.
pub(super) fn verify_activation(tx: &Tx<'_>) -> Result<(), RuntimeError> {
    verify(tx)?;
    // Capture identities on first admission and retain them through COMMIT.
    // A privileged DDL hook must not substitute an equally named heap.
    let rows = tx.query(IDENTITIES, &[&crate::managed_relations::TABLES])?;
    let mut current = std::collections::BTreeMap::new();
    for row in rows {
        let name: String = row.get(2);
        if row.get::<_, &str>(4) != "r" {
            return Err(crate::managed_relations::refusal(
                &name,
                "expected plain heap",
            ));
        }
        if !row.get::<_, bool>(5) {
            return Err(crate::managed_relations::refusal(
                &name,
                "shadowed managed relation",
            ));
        }
        if !row.get::<_, bool>(3) {
            return Err(crate::managed_relations::refusal(
                &name,
                "not owned by activation role",
            ));
        }
        current.insert((row.get::<_, u32>(1), name), row.get::<_, u32>(0));
    }
    let mut captured = tx.activation_relations.borrow_mut();
    for (name, oid) in captured.iter() {
        if current.get(name) != Some(oid) {
            return Err(crate::managed_relations::refusal(
                &name.1,
                "captured relation OID changed or disappeared",
            ));
        }
    }
    captured.extend(current);
    Ok(())
}

// @ref LLP 3000.009.001.000.002#6 — internal is not provenance: an incoming FK can cascade lifecycle writes.
// Current installers create no trigger-backed constraints. Fenced upgrades and
// read-only legacy inspection admit only the two historical seq -> _commits
// no-action FKs, including their exact PostgreSQL-installed RI trigger set.
// Names of constraints were never fixed; trigger names include their own OID.
// Separate namespace arms and name-typed index keys avoid scanning unrelated
// schemas when activation repeatedly checks admission in a large catalog.
macro_rules! selection {
    () => {
        r#"    SELECT c.* FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=current_schema() AND c.relname=ANY($1::text[]::name[])
    UNION ALL
    SELECT c.* FROM pg_class c
    WHERE c.relnamespace=pg_my_temp_schema()
      AND c.relname IN ('_evolution_restored','_adopt_groups','_adopt_conflicts','_activation_images')"#
    };
}
const IDENTITIES: &str = concat!(
    "SELECT c.oid,c.relnamespace,c.relname::text,c.relowner=current_user::regrole::oid,c.relkind::text,COALESCE(to_regclass(quote_ident(c.relname))=c.oid,false) FROM (",
    selection!(),
    ") c"
);
pub(super) const SQL: &str = concat!(
    r#"
WITH managed AS (
"#,
    selection!(),
    r#"
), legacy AS (
    SELECT c.* FROM pg_constraint c JOIN managed source ON source.oid=c.conrelid
    JOIN managed target ON target.oid=c.confrelid
    WHERE source.relname IN ('_log','_outbox') AND target.relname='_commits'
      AND c.contype='f' AND c.convalidated AND NOT c.condeferrable AND NOT c.condeferred
      AND c.conparentid=0 AND c.confupdtype='a' AND c.confdeltype='a' AND c.confmatchtype='s'
      AND c.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='seq' AND NOT attisdropped)]
      AND c.confkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.confrelid AND attname='seq' AND NOT attisdropped)]
      AND (SELECT count(*) FROM pg_constraint other WHERE other.conrelid=c.conrelid AND other.contype='f')=1
), expected_triggers AS (
    SELECT c.oid AS constraint_id, e.* FROM legacy c CROSS JOIN LATERAL (VALUES
      (c.conrelid,c.confrelid,5,'RI_ConstraintTrigger_c_','"pg_catalog"."RI_FKey_check_ins"()'::regprocedure),
      (c.conrelid,c.confrelid,17,'RI_ConstraintTrigger_c_','"pg_catalog"."RI_FKey_check_upd"()'::regprocedure),
      (c.confrelid,c.conrelid,9,'RI_ConstraintTrigger_a_','"pg_catalog"."RI_FKey_noaction_del"()'::regprocedure),
      (c.confrelid,c.conrelid,17,'RI_ConstraintTrigger_a_','"pg_catalog"."RI_FKey_noaction_upd"()'::regprocedure)
    ) AS e(relation_id,other_id,kind,prefix,function_id)
), allowed_triggers AS (
    SELECT t.oid,t.tgconstraint FROM pg_trigger t JOIN expected_triggers e
      ON t.tgconstraint=e.constraint_id AND t.tgrelid=e.relation_id AND t.tgconstrrelid=e.other_id
      AND t.tgtype=e.kind AND t.tgfoid=e.function_id
      AND t.tgname::text=e.prefix || t.oid::text
    WHERE t.tgisinternal AND t.tgenabled='O' AND NOT t.tgdeferrable AND NOT t.tginitdeferred
      AND t.tgnargs=0 AND octet_length(t.tgargs)=0 AND t.tgqual IS NULL
      AND t.tgattr=''::int2vector AND t.tgoldtable IS NULL AND t.tgnewtable IS NULL
), findings AS (
    SELECT c.relname::text AS relation, 'row security'::text AS object FROM managed c
      WHERE c.relrowsecurity OR c.relforcerowsecurity
    UNION ALL
    SELECT c.relname::text, 'foreign trigger ' || t.tgname::text FROM managed c JOIN pg_trigger t ON t.tgrelid=c.oid
      WHERE NOT EXISTS(SELECT 1 FROM allowed_triggers a WHERE a.oid=t.oid)
    UNION ALL
    SELECT c.relname::text, 'foreign constraint ' || k.conname::text FROM managed c JOIN pg_constraint k
      ON k.conrelid=c.oid OR k.confrelid=c.oid
      WHERE (k.contype='f' OR k.confrelid<>0)
        AND NOT EXISTS(SELECT 1 FROM legacy l WHERE l.oid=k.oid
          AND (SELECT count(*) FROM allowed_triggers a WHERE a.tgconstraint=k.oid)=4
          AND (SELECT count(*) FROM pg_trigger t WHERE t.tgconstraint=k.oid)=4)
    UNION ALL
    SELECT c.relname::text, 'rewrite rule ' || w.rulename::text FROM managed c JOIN pg_rewrite w ON w.ev_class=c.oid
      WHERE NOT(w.rulename='_RETURN' AND c.relkind IN ('v','m'))
)
SELECT relation,object FROM findings ORDER BY relation,object LIMIT 1
"#
);

// @ref LLP 3000.009.001.000.002#6 — privileged DDL code is visible, allowed, and outside the supported fence.
pub(super) const EVENT_TRIGGERS: &str = "SELECT e.evtname::text,e.evtevent::text,e.evttags,pg_get_userbyid(e.evtowner)::text,format('%I.%I(%s)',n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),e.evtenabled::text FROM pg_event_trigger e JOIN pg_proc p ON p.oid=e.evtfoid JOIN pg_namespace n ON n.oid=p.pronamespace WHERE e.evtenabled<>'D' ORDER BY e.evtname";
pub(super) fn warn_event_triggers(tx: &Tx<'_>) -> Result<(), RuntimeError> {
    for row in tx.query(EVENT_TRIGGERS, &[])? {
        eprintln!(
            "{}",
            event_warning(
                row.get(0),
                row.get(1),
                row.get(2),
                row.get(3),
                row.get(4),
                row.get(5)
            )
        );
    }
    Ok(())
}
pub(super) fn event_warning(
    name: &str,
    event: &str,
    tags: Option<Vec<String>>,
    owner: &str,
    function: &str,
    mode: &str,
) -> String {
    format!(
        "WARNING: enabled Postgres event trigger {}; privileged activation-DDL rewriting is outside the supported contract",
        serde_json::json!({"name":name,"events":event,"tags":tags.map(serde_json::Value::from).unwrap_or_else(||serde_json::Value::from("all")),"owner":owner,"function":function,"enabledMode":mode})
    )
}
