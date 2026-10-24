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

// @ref LLP 3000.009.001.000.002#6 — internal is not provenance: an incoming FK can cascade lifecycle writes.
// Current installers create no trigger-backed constraints. Fenced upgrades and
// read-only legacy inspection admit only the two historical seq -> _commits
// no-action FKs, including their exact PostgreSQL-installed RI trigger set.
// Names of constraints were never fixed; trigger names include their own OID.
// Separate namespace arms and name-typed index keys avoid scanning unrelated
// schemas when activation repeatedly checks admission in a large catalog.
pub(super) const SQL: &str = r#"
WITH managed AS (
    SELECT c.* FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=current_schema() AND c.relname=ANY($1::text[]::name[])
    UNION ALL
    SELECT c.* FROM pg_class c
    WHERE c.relnamespace=pg_my_temp_schema()
      AND c.relname IN ('_evolution_restored','_adopt_groups','_adopt_conflicts')
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
"#;
