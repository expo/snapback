use super::*;
use crate::store::EffectClaimBinding;
use serde::Serialize;

#[derive(Serialize)]
struct ThenSchemaIdentity<'a> {
    tables: BTreeMap<&'a str, &'a crate::schema::Table>,
    maintains: Vec<&'a crate::schema::Maintain>,
    schedules: Vec<&'a crate::timers::Schedule>,
}

impl Generation {
    /// Target-specific effect custody. Global schema/program hashes are not
    /// used: an unrelated compatible successor must not force another provider
    /// call, while every declaration, body, argument, certificate, and relevant
    /// schema semantic of the `then` target remains bound.
    pub(crate) fn effect_claim_identity(&self, effect: &str) -> Option<String> {
        let declaration = self.effects.get(effect)?;
        let target = declaration
            .then
            .as_deref()
            .and_then(|name| self.programs.get(name));
        let Some((program, certificate)) = target else {
            return Some(digest(&(declaration, Option::<u8>::None)));
        };

        let mut certificate = certificate.clone();
        // The full schema hash changes for unrelated tables. All target-local
        // certificate and schema semantics below remain exact.
        certificate.schema_hash.clear();
        let mut names = certificate
            .read_sites
            .iter()
            .map(|site| site.table.clone())
            .chain(
                certificate
                    .write_sites
                    .iter()
                    .map(|site| site.table.clone()),
            )
            .chain(certificate.maintained_writes.keys().cloned())
            .filter(|name| self.schema.tables.contains_key(name))
            .collect::<BTreeSet<_>>();
        loop {
            let before = names.len();
            for maintain in &self.schema.maintains {
                if names.contains(&maintain.source) || names.contains(&maintain.target) {
                    names.insert(maintain.source.clone());
                    names.insert(maintain.target.clone());
                }
            }
            for name in names.clone() {
                let Some(table) = self.schema.tables.get(&name) else {
                    continue;
                };
                for column in table.columns.values() {
                    collect_column_tables(column, &mut names);
                }
                for rule in [
                    &table.rules.read,
                    &table.rules.insert,
                    &table.rules.update,
                    &table.rules.delete,
                ] {
                    collect_rule_tables(rule, &mut names);
                }
                for constraint in &table.constraints {
                    if let crate::schema::Constraint::FinalExistsOnInsert { table, .. } = constraint
                    {
                        names.insert(table.clone());
                    }
                }
            }
            if names.len() == before {
                break;
            }
        }
        certificate.tables.retain(|name, _| names.contains(name));
        // Rule hashes include the global schema identity. The projected table
        // definitions below bind the same rules without unrelated churn.
        certificate.rule_hashes.clear();
        // Disclosures are a generation-wide client artifact, not execution
        // custody for this private target.
        certificate.disclosures.clear();
        let schema = ThenSchemaIdentity {
            tables: names
                .iter()
                .filter_map(|name| {
                    self.schema
                        .tables
                        .get(name)
                        .map(|table| (name.as_str(), table))
                })
                .collect(),
            maintains: self
                .schema
                .maintains
                .iter()
                .filter(|maintain| {
                    names.contains(&maintain.source) || names.contains(&maintain.target)
                })
                .collect(),
            schedules: self
                .schema
                .schedules
                .iter()
                .filter(|schedule| {
                    matches!(&schedule.trigger, crate::timers::Trigger::Row { table, .. }
                        if names.contains(table))
                })
                .collect(),
        };
        Some(digest(&(declaration, program, certificate, schema)))
    }

    fn effect_claim_bindings(&self) -> BTreeMap<String, EffectClaimBinding> {
        self.effects
            .iter()
            .map(|(name, declaration)| {
                (
                    name.clone(),
                    EffectClaimBinding {
                        then_op: declaration.then.clone(),
                        identity: self.effect_claim_identity(name),
                    },
                )
            })
            .collect()
    }
}

fn collect_column_tables(column: &crate::schema::ColumnType, names: &mut BTreeSet<String>) {
    match column {
        crate::schema::ColumnType::Ref { table } => {
            names.insert(table.clone());
        }
        crate::schema::ColumnType::Optional(inner)
        | crate::schema::ColumnType::List { of: inner, .. } => {
            collect_column_tables(inner, names);
        }
        _ => {}
    }
}

fn collect_rule_tables(rule: &RuleExpr, names: &mut BTreeSet<String>) {
    match rule {
        RuleExpr::Exists { table, .. } | RuleExpr::Created { table, .. } => {
            names.insert(table.clone());
        }
        RuleExpr::And(rules) | RuleExpr::Or(rules) => {
            for rule in rules {
                collect_rule_tables(rule, names);
            }
        }
        RuleExpr::Not(rule) => collect_rule_tables(rule, names),
        _ => {}
    }
}

impl Runtime {
    /// Runtime claims always carry the real target-specific identity. The
    /// direct Store compatibility method intentionally cannot mint it.
    pub fn claim_effect(&self, now: i64) -> Result<crate::OutboxClaim, RuntimeError> {
        self.store()
            .outbox_claim_next_bound(now, &self.generation.effect_claim_bindings())
    }

    /// Convert only after the durable binding has matched. The provider stores
    /// its raw result; the engine supplies the authored envelope.
    pub fn settle_effect_then(
        &mut self,
        outbox_id: &str,
        now: i64,
    ) -> Result<Execution, RuntimeError> {
        let pending = self
            .store()
            .outbox_get(outbox_id)?
            .ok_or_else(|| RuntimeError::Input(format!("unknown outbox row {outbox_id}")))?;
        let op = pending
            .then_op
            .as_deref()
            .ok_or_else(|| RuntimeError::Input("pending effect has no then operation".into()))?
            .to_owned();
        let Some((program, _)) = self.bound_then_target(&op, outbox_id)? else {
            return self.then_rejection("E_EFFECT_THEN_CHANGED");
        };
        let envelope = serde_json::json!({
            "outboxId": pending.id,
            "effect": pending.effect,
            "result": pending.result.unwrap_or(serde_json::Value::Null),
        });
        let args = match crate::wire::program_args(&program, &envelope) {
            Ok(args) => args,
            Err(error) => {
                return self.reject_then(&op, outbox_id, "E_EFFECT_THEN_INPUT", &error.to_string());
            }
        };
        let ids = self.reserve_new_ids()?;
        self.execute_then(&op, args, now, Some(now), ids, outbox_id)
    }
}
