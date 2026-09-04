//! Certified project generations and the stateful query runtime.
// @ref LLP 1001#4-generation-and-runtime-registryrs-successorrs — one certified project is live.

use crate::certificate::{Ceilings, Certificate, CheckError, Checker, RuleCertificate};
use crate::engine::{
    AuthoritativeTrace, ClosureReceipt, Context, Engine, Execution, ExecutionState, PointTrace,
    RuleInputTrace, RuntimeError, validate_arg_value,
};
use crate::ir::{ArgType, Expr, Program, ProgramKind, Stmt};
use crate::live::Subscriptions;
use crate::schema::{Auth, RuleExpr, Schema, maintain_issues};
use crate::store::{CommitRecord, Store, unix_millis};
use crate::successor::{
    MigrationPlan, SuccessorRefusal, SuccessorReport, additive_refusal, apply_additive,
    apply_migration_drops, plan, projected_predecessor_ids, successor_refusal,
};
use crate::value::{Value, digest};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, VecDeque};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectDecl {
    pub name: String,
    pub grants: Vec<String>,
    pub source: String,
    pub then: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectJson {
    pub version: u32,
    pub schema: Schema,
    pub programs: Vec<Program>,
    pub effects: Vec<EffectDecl>,
    pub auth: Auth,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Generation {
    schema: Schema,
    programs: BTreeMap<String, (Program, Certificate)>,
    #[serde(skip_serializing)]
    program_hash: String,
    #[serde(skip_serializing)]
    table_read_certificates: BTreeMap<String, RuleCertificate>,
    channel_certificates: BTreeMap<String, ChannelCertificates>,
    effects: BTreeMap<String, EffectDecl>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelCertificates {
    pub publish: RuleCertificate,
    pub subscribe: RuleCertificate,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChannelSide {
    Publish,
    Subscribe,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelVerdict {
    pub admitted: bool,
    pub rule_inputs: Vec<RuleInputTrace>,
    pub points: Vec<PointTrace>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RowRuleVerdict {
    pub id: String,
    pub admitted: bool,
    pub trace: AuthoritativeTrace,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResetResult {
    pub seq: u64,
    pub asset_ids: Vec<String>,
}

impl Generation {
    /// The generation identity is always derived from its certified schema.
    pub fn hash(&self) -> String {
        self.schema.hash()
    }

    /// Identity of the schema plus every certified operation. This is kept
    /// separate from `hash()`, whose schema-only value is a durable successor
    /// fence already persisted by existing stores.
    // @ref LLP 1012#8-the-delivery-envelope-the-validator-and-resume — offline custody binds answers to the exact certified program set, not only the schema.
    pub fn program_hash(&self) -> &str {
        &self.program_hash
    }

    pub fn schema(&self) -> &Schema {
        &self.schema
    }

    pub fn programs(&self) -> &BTreeMap<String, (Program, Certificate)> {
        &self.programs
    }

    pub fn channel_certificates(&self) -> &BTreeMap<String, ChannelCertificates> {
        &self.channel_certificates
    }

    pub fn effects(&self) -> &BTreeMap<String, EffectDecl> {
        &self.effects
    }

    pub fn effects_hash(&self) -> String {
        digest(&self.effects)
    }

    pub fn certify(
        project: &ProjectJson,
        ceilings: Ceilings,
    ) -> Result<Self, Vec<(String, CheckError)>> {
        let mut errors = Vec::new();
        let mut schema = project.schema.clone();
        schema.auth = project.auth.clone();

        errors.extend(crate::rule_types::check(&schema));

        for table in schema.tables.keys().filter(|table| table.starts_with('_')) {
            errors.push((
                "schema".to_owned(),
                CheckError {
                    code: "E_SCHEMA_RESERVED".to_owned(),
                    message: format!("schema declares reserved table {table}"),
                    rewrite: "rename the table without a leading '_'".to_owned(),
                },
            ));
        }
        let mut reserved_rule_reads = BTreeSet::new();
        for (table, definition) in &schema.tables {
            for rule in [
                &definition.rules.read,
                &definition.rules.insert,
                &definition.rules.update,
                &definition.rules.delete,
            ] {
                collect_reserved_rule_reads(rule, &mut reserved_rule_reads);
            }
            for constraint in &definition.constraints {
                if let crate::schema::Constraint::FinalExistsOnInsert { table, .. } = constraint
                    && table.starts_with('_')
                {
                    reserved_rule_reads.insert(table.clone());
                }
            }
            for reserved in &reserved_rule_reads {
                errors.push((
                    format!("schema.{table}"),
                    CheckError {
                        code: "E_SCHEMA_RESERVED".to_owned(),
                        message: format!("rule reads reserved table {reserved}"),
                        rewrite: "use rule.system() or an application-owned relation in rules"
                            .to_owned(),
                    },
                ));
            }
            reserved_rule_reads.clear();
        }
        for (channel, definition) in &schema.channels {
            collect_reserved_rule_reads(&definition.publish, &mut reserved_rule_reads);
            collect_reserved_rule_reads(&definition.subscribe, &mut reserved_rule_reads);
            for reserved in &reserved_rule_reads {
                errors.push((
                    format!("channel.{channel}"),
                    CheckError {
                        code: "E_SCHEMA_RESERVED".to_owned(),
                        message: format!("channel rule reads reserved table {reserved}"),
                        rewrite: "authorize the channel from application-owned relations"
                            .to_owned(),
                    },
                ));
            }
            reserved_rule_reads.clear();
        }

        for (table_name, table) in &schema.tables {
            if table.columns.get("id") != Some(&crate::schema::ColumnType::Id) {
                errors.push((
                    format!("schema.{table_name}"),
                    CheckError {
                        code: "E_SCHEMA_ID_RESERVED".to_owned(),
                        message: format!(
                            "table {table_name} must declare the implicit id column as Id"
                        ),
                        rewrite: "restore the compiler-emitted id: Id column".to_owned(),
                    },
                ));
            }
            for (index_name, index) in &table.indexes {
                if index.columns.is_empty() || index.columns.len() > 8 {
                    errors.push((
                        format!("schema.{table_name}"),
                        CheckError {
                            code: "E_SCHEMA_INDEX_COLUMN".to_owned(),
                            message: format!(
                                "index {table_name}.{index_name} must declare between 1 and 8 columns"
                            ),
                            rewrite: "declare an index with at most 8 scalar columns".to_owned(),
                        },
                    ));
                }
                for column in &index.columns {
                    if !table.columns.contains_key(column) {
                        errors.push((
                            format!("schema.{table_name}"),
                            CheckError {
                                code: "E_SCHEMA_INDEX_COLUMN".to_owned(),
                                message: format!(
                                    "index {table_name}.{index_name} names undeclared column {column}"
                                ),
                                rewrite: "declare the column or remove it from the index"
                                    .to_owned(),
                            },
                        ));
                    }
                    if table
                        .columns
                        .get(column)
                        .is_some_and(|kind| !kind.is_indexable())
                    {
                        errors.push((
                            format!("schema.{table_name}"),
                            CheckError {
                                code: "E_SCHEMA_INDEX_COLUMN".to_owned(),
                                message: format!(
                                    "index {table_name}.{index_name} cannot use non-indexable column {column}"
                                ),
                                rewrite: "index a non-asset scalar column instead".to_owned(),
                            },
                        ));
                    }
                }
            }
            for constraint in &table.constraints {
                let crate::schema::Constraint::Text { field, min, .. } = constraint else {
                    continue;
                };
                let max = match table.columns.get(field) {
                    Some(crate::schema::ColumnType::Text { max }) => Some(*max),
                    Some(crate::schema::ColumnType::Optional(inner)) => match inner.as_ref() {
                        crate::schema::ColumnType::Text { max } => Some(*max),
                        _ => None,
                    },
                    _ => None,
                };
                match max {
                    None => errors.push((
                        format!("schema.{table_name}"),
                        CheckError {
                            code: "E_SCHEMA_CONSTRAINT".to_owned(),
                            message: format!(
                                "text constraint names non-text or missing column {table_name}.{field}"
                            ),
                            rewrite: "name a Text or Optional<Text> column in the text constraint"
                                .to_owned(),
                        },
                    )),
                    Some(max) if *min > max => errors.push((
                        format!("schema.{table_name}"),
                        CheckError {
                            code: "E_SCHEMA_CONSTRAINT".to_owned(),
                            message: format!(
                                "text constraint minimum {min} exceeds {table_name}.{field} maximum {max}"
                            ),
                            rewrite: "lower min or raise the column's text maximum".to_owned(),
                        },
                    )),
                    Some(_) => {}
                }
            }
        }

        errors.extend(maintain_issues(&schema).into_iter().map(|issue| {
            (
                format!("schema.maintains[{}]", issue.position),
                CheckError {
                    code: "E_SCHEMA_MAINTAIN".to_owned(),
                    message: issue.message,
                    rewrite:
                        "make each maintain target one closed { id, ...by, value: Int } projection"
                            .to_owned(),
                },
            )
        }));

        let mut table_read_certificates = BTreeMap::new();
        for (name, table) in &schema.tables {
            match Checker::new(&schema, ceilings.clone()).check_rule(&table.rules.read) {
                Ok(certificate) => {
                    table_read_certificates.insert(name.clone(), certificate);
                }
                Err(rule_errors) => errors.extend(
                    rule_errors
                        .into_iter()
                        .map(|error| (format!("schema.{name}.rules.read"), error)),
                ),
            }
        }

        let mut channel_certificates = BTreeMap::new();
        for (name, channel) in &schema.channels {
            let checker = Checker::new(&schema, ceilings.clone());
            let publish = checker.check_rule(&channel.publish);
            let subscribe = checker.check_rule(&channel.subscribe);
            match (publish, subscribe) {
                (Ok(publish), Ok(subscribe)) => {
                    channel_certificates
                        .insert(name.clone(), ChannelCertificates { publish, subscribe });
                }
                (publish, subscribe) => {
                    if let Err(rule_errors) = publish {
                        errors.extend(
                            rule_errors
                                .into_iter()
                                .map(|error| (format!("channel.{name}.publish"), error)),
                        );
                    }
                    if let Err(rule_errors) = subscribe {
                        errors.extend(
                            rule_errors
                                .into_iter()
                                .map(|error| (format!("channel.{name}.subscribe"), error)),
                        );
                    }
                }
            }
        }

        let mut effects = BTreeMap::new();
        for effect in &project.effects {
            if effects
                .insert(effect.name.clone(), effect.clone())
                .is_some()
            {
                errors.push((
                    effect.name.clone(),
                    CheckError {
                        code: "E_EFFECT_DUPLICATE".to_owned(),
                        message: format!("effect {} is declared more than once", effect.name),
                        rewrite: "keep one declaration for each effect name".to_owned(),
                    },
                ));
            }
        }
        for effect in &schema.effects {
            if !effects.contains_key(effect) {
                errors.push((
                    "schema.effects".to_owned(),
                    CheckError {
                        code: "E_EFFECT_UNDECLARED".to_owned(),
                        message: format!(
                            "schema names effect {effect} without a project effect declaration"
                        ),
                        rewrite: format!(
                            "declare {effect} in project effects or remove it from schema.effects"
                        ),
                    },
                ));
            }
        }

        let mut programs = BTreeMap::new();
        let mut seen_programs = BTreeSet::new();
        for program in &project.programs {
            let first_declaration = seen_programs.insert(program.name.clone());
            if !first_declaration {
                errors.push((
                    program.name.clone(),
                    CheckError {
                        code: "E_OP_DUPLICATE".to_owned(),
                        message: format!("program {} is declared more than once", program.name),
                        rewrite: "give every exported program one qualified name".to_owned(),
                    },
                ));
            }
            match Checker::new(&schema, ceilings.clone()).check_all(program) {
                Ok(certificate) if first_declaration => {
                    programs.insert(program.name.clone(), (program.clone(), certificate));
                }
                Ok(_) => {}
                Err(program_errors) => errors.extend(
                    program_errors
                        .into_iter()
                        .map(|error| (program.name.clone(), error)),
                ),
            }
            let mut emitted = Vec::new();
            collect_emits(&program.body, &mut emitted);
            for effect in emitted {
                if !effects.contains_key(effect) {
                    errors.push((
                        program.name.clone(),
                        CheckError {
                            code: "E_EFFECT_UNKNOWN".to_owned(),
                            message: format!(
                                "program {} emits undeclared effect {effect}",
                                program.name
                            ),
                            rewrite: format!("declare {effect} in project effects"),
                        },
                    ));
                }
            }
        }

        if errors.is_empty() {
            let certified_programs = programs
                .iter()
                .map(|(name, (program, certificate))| (name, program, digest(certificate)))
                .collect::<Vec<_>>();
            let program_hash = digest(&(schema.hash(), certified_programs));
            Ok(Self {
                schema,
                programs,
                program_hash,
                table_read_certificates,
                channel_certificates,
                effects,
            })
        } else {
            Err(errors)
        }
    }
}

pub struct Runtime {
    pub(crate) engine: Engine,
    pub(crate) generation: Generation,
    pub(crate) subs: Subscriptions,
    #[cfg(test)]
    fail_after_then_commit: bool,
}

impl Runtime {
    pub fn open(mut store: Store, generation: Generation) -> Result<Self, SuccessorRefusal> {
        crate::engine::validate_schema(&generation.schema)
            .map_err(|errors| store_refusal(first_schema_error(errors)))?;
        let generation_hash = generation.hash();
        let installed = store.meta("generation").map_err(store_refusal)?;
        match installed {
            None => {
                let row_count: i64 = store
                    .conn
                    .query_row("SELECT COUNT(*) FROM rows", [], |row| row.get(0))
                    .map_err(|error| store_refusal(error.into()))?;
                if row_count != 0 {
                    return Err(SuccessorRefusal::destructive(MigrationPlan::default()));
                }
                persist_generation(&mut store, &generation).map_err(store_refusal)?;
            }
            Some(hash) if hash == generation_hash => {
                // Additive owner metadata can appear after the generation was
                // first installed (for example the outbox declaration binding).
                persist_generation(&mut store, &generation).map_err(store_refusal)?;
            }
            Some(hash) => {
                let current_json = store
                    .meta("schema_json")
                    .map_err(store_refusal)?
                    .ok_or_else(|| SuccessorRefusal::destructive(MigrationPlan::default()))?;
                let current: Schema = serde_json::from_str(&current_json).map_err(|error| {
                    store_refusal(RuntimeError::Serialization(error.to_string()))
                })?;
                if let Some(refusal) = successor_refusal(&store, &current, &generation.schema)
                    .map_err(store_refusal)?
                {
                    return Err(refusal);
                }
                let transaction = store
                    .conn
                    .transaction()
                    .map_err(|error| store_refusal(RuntimeError::Sql(error)))?;
                apply_additive(
                    &transaction,
                    &current,
                    &generation.schema,
                    hash,
                    generation_hash,
                    None,
                )
                .map_err(store_refusal)?;
                persist_generation_transaction(&transaction, &generation).map_err(store_refusal)?;
                transaction
                    .commit()
                    .map_err(|error| store_refusal(RuntimeError::Sql(error)))?;
            }
        }
        let engine = Engine::new(store, generation.schema.clone()).map_err(store_refusal)?;
        Ok(Self {
            engine,
            generation,
            subs: Subscriptions::default(),
            #[cfg(test)]
            fail_after_then_commit: false,
        })
    }

    pub fn execute(&mut self, op: &str, context: Context) -> Result<Execution, RuntimeError> {
        let (program, certificate) = self
            .generation
            .programs
            .get(op)
            .cloned()
            .ok_or_else(|| RuntimeError::OpUnknown(op.to_owned()))?;
        self.execute_certified(&program, &certificate, context)
    }

    /// Commit one fixed-size application-id range before handing it to a
    /// mutation. Unused ids are gaps; no execution rollback can reclaim them.
    // @ref LLP 1001#1-store-storers — Runtime exposes allocation without exposing mutable storage.
    pub fn reserve_new_ids(&mut self) -> Result<VecDeque<String>, RuntimeError> {
        self.engine.store_mut().reserve_new_ids()
    }

    /// Allocate an ordinary engine id and open its receiving ledger row.
    pub fn begin_asset(
        &mut self,
        kind: crate::AssetKind,
        actor: &crate::Actor,
        created_at: i64,
    ) -> Result<String, RuntimeError> {
        self.engine
            .store_mut()
            .begin_asset(kind, actor.id(), created_at)
    }

    pub fn begin_asset_charged(
        &mut self,
        kind: crate::AssetKind,
        actor: &crate::Actor,
        created_at: i64,
        staged_bytes: u64,
    ) -> Result<String, RuntimeError> {
        self.engine
            .store_mut()
            .begin_asset_charged(kind, actor.id(), created_at, staged_bytes)
    }

    pub fn asset_staging_usage(
        &self,
        actor: &crate::Actor,
    ) -> Result<crate::AssetStagingSnapshot, RuntimeError> {
        self.engine.store().asset_staging_usage(actor.id())
    }

    pub fn asset_ids(&self) -> Result<Vec<String>, RuntimeError> {
        self.engine.store().asset_ids()
    }

    pub fn reserve_asset_finalized_bytes(
        &mut self,
        id: &str,
        bytes: u64,
    ) -> Result<(), RuntimeError> {
        self.engine
            .store_mut()
            .asset_reserve_finalized_bytes(id, bytes)
    }

    pub fn mark_asset_ready(
        &mut self,
        id: &str,
        facts: &crate::AssetReadyFacts,
    ) -> Result<(), RuntimeError> {
        self.engine.store_mut().asset_mark_ready(id, facts)
    }

    pub fn mark_asset_failed(&mut self, id: &str) -> Result<(), RuntimeError> {
        self.engine.store_mut().asset_mark_failed(id)
    }

    /// Resolve one asset through its authoritative locator and the located
    /// row's certified read rule. Every ordinary authority miss is the same
    /// not-found-shaped refusal.
    // @ref LLP 1006#2-authority-delivery-is-by-the-row-that-holds-it — delivery follows one ledger locator and one certified point read.
    pub fn asset_delivery(
        &mut self,
        id: &str,
        context: Context,
    ) -> Result<crate::assets_ledger::AssetDelivery, RuntimeError> {
        self.engine
            .asset_delivery(id, context, &self.generation.table_read_certificates)
    }

    /// Credential-free delivery is intentionally narrower than authenticated
    /// delivery: only a table authored as `public(reason)` may pass.
    // @ref LLP 1006#2-authority-delivery-is-by-the-row-that-holds-it — tokenless public delivery
    // still validates the generated read certificate and the current row.
    pub fn public_asset_delivery(
        &mut self,
        id: &str,
    ) -> Result<crate::assets_ledger::AssetDelivery, RuntimeError> {
        self.engine
            .public_asset_delivery(id, &self.generation.table_read_certificates)
    }

    pub fn reclaim_assets(&mut self, now: i64) -> Result<Vec<String>, RuntimeError> {
        self.engine.store_mut().reclaim(now)
    }

    pub fn finish_asset_reclaims(&mut self, ids: &[String]) -> Result<(), RuntimeError> {
        self.engine.store_mut().finish_asset_reclaims(ids)
    }

    /// Execute an effect's `then` mutation and settle its durable outbox row
    /// in the mutation's own SQLite transaction.
    // @ref LLP 1003#2-the-outbox-lifecycle — `then` and `then_pending` → `sent` are one transaction.
    pub fn execute_then(
        &mut self,
        op: &str,
        args: BTreeMap<String, Value>,
        now: i64,
        read_time: Option<i64>,
        new_ids: VecDeque<String>,
        outbox_id: &str,
    ) -> Result<Execution, RuntimeError> {
        let Some((program, certificate)) = self.bound_then_target(op, outbox_id)? else {
            return self.then_rejection("E_EFFECT_THEN_CHANGED");
        };

        // The durable then binding is the capability: public callers can
        // supply inputs, but only the engine's purpose-specific entry point
        // can mint the system context, and only for this bound outbox row.
        let execution = self.engine.execute_then(
            &program,
            &certificate,
            args,
            now,
            read_time,
            new_ids,
            outbox_id,
        )?;
        #[cfg(test)]
        if std::mem::take(&mut self.fail_after_then_commit) {
            return Err(RuntimeError::Input(
                "simulated crash after atomic then commit".to_owned(),
            ));
        }
        Ok(execution)
    }

    /// Settle a `then` whose JSON could not be represented by its declared
    /// data-plane argument type. No effect result conversion happens before
    /// the durable `then_pending` row exists.
    pub fn reject_then(
        &mut self,
        op: &str,
        outbox_id: &str,
        code: &str,
        message: &str,
    ) -> Result<Execution, RuntimeError> {
        let Some(_) = self.bound_then_target(op, outbox_id)? else {
            return self.then_rejection("E_EFFECT_THEN_CHANGED");
        };
        self.engine.settle_rejected_then(outbox_id, code, message)
    }

    #[cfg(test)]
    fn fail_after_then_commit_once(&mut self) {
        self.fail_after_then_commit = true;
    }

    fn bound_then_target(
        &self,
        op: &str,
        outbox_id: &str,
    ) -> Result<Option<(Program, Certificate)>, RuntimeError> {
        let pending = self
            .engine
            .store()
            .outbox_get(outbox_id)?
            .ok_or_else(|| RuntimeError::Input(format!("unknown outbox row {outbox_id}")))?;
        if pending.state != "then_pending" {
            return Err(RuntimeError::Input(format!(
                "outbox row {outbox_id} is {}, not then_pending",
                pending.state
            )));
        }
        let current = self.generation.effects.get(&pending.effect);
        let claimed = pending
            .generation
            .as_deref()
            .map(|generation| format!("effects_json:{generation}"))
            .map(|key| self.engine.store().meta(&key))
            .transpose()?
            .flatten()
            .map(|json| {
                serde_json::from_str::<BTreeMap<String, EffectDecl>>(&json)
                    .map_err(|error| RuntimeError::Serialization(error.to_string()))
            })
            .transpose()?
            .and_then(|effects| effects.get(&pending.effect).cloned());
        let binding_matches = current
            .zip(claimed.as_ref())
            .is_some_and(|(current, claimed)| {
                current.then.as_deref() == Some(op)
                    && pending.then_op.as_deref() == Some(op)
                    && digest(&current.source) == digest(&claimed.source)
            });
        let target = self.generation.programs.get(op).cloned();
        if !binding_matches
            || !target
                .as_ref()
                .is_some_and(|(program, _)| program.kind == ProgramKind::Mutation)
        {
            self.fail_changed_then(outbox_id)?;
            return Ok(None);
        }
        Ok(target)
    }

    fn fail_changed_then(&self, outbox_id: &str) -> Result<(), RuntimeError> {
        let changed = self.engine.store().conn.execute(
            "UPDATE _outbox SET state = 'failed', last_error = 'E_EFFECT_THEN_CHANGED',
                    updated_at = ?1
             WHERE id = ?2 AND state = 'then_pending'",
            rusqlite::params![unix_millis(), outbox_id],
        )?;
        if changed == 1 {
            Ok(())
        } else {
            Err(RuntimeError::Input(format!(
                "outbox row {outbox_id} is not then_pending"
            )))
        }
    }

    fn then_rejection(&self, code: &str) -> Result<Execution, RuntimeError> {
        Ok(Execution {
            result: Value::Null,
            trace: AuthoritativeTrace::default(),
            receipt: ClosureReceipt::default(),
            state: ExecutionState::Rejected {
                code: code.to_owned(),
                message: code.to_owned(),
            },
            seq: self.engine.store().commit_seq()?,
            next: None,
        })
    }

    pub fn execute_adhoc(
        &mut self,
        program: &Program,
        context: Context,
    ) -> Result<Execution, RuntimeError> {
        let certificate = Checker::new(&self.generation.schema, Ceilings::default())
            .check(program)
            .map_err(|error| RuntimeError::Schema(error.to_string()))?;
        self.execute_certified(program, &certificate, context)
    }

    fn execute_certified(
        &mut self,
        program: &Program,
        certificate: &Certificate,
        context: Context,
    ) -> Result<Execution, RuntimeError> {
        match self.engine.execute(program, certificate, context) {
            Ok(execution) => Ok(execution),
            Err(error) if program.kind == ProgramKind::Mutation => {
                if let Some(code) = rejection_code(&error) {
                    Ok(Execution {
                        result: Value::Null,
                        trace: AuthoritativeTrace::default(),
                        receipt: ClosureReceipt::default(),
                        state: ExecutionState::Rejected {
                            code: code.to_owned(),
                            message: error.to_string(),
                        },
                        seq: self.engine.store().commit_seq()?,
                        next: None,
                    })
                } else {
                    Err(error)
                }
            }
            Err(error) => Err(error),
        }
    }

    pub fn seed(&mut self, rows: &[(String, Value)]) -> Result<u64, RuntimeError> {
        let (program, certificate) = seed_program(&self.generation.schema, rows)?;
        self.engine
            .execute_seed(&program, &certificate, unix_millis())
            .map(|execution| execution.seq)
    }

    /// Reset application data and apply the seed in one SQLite transaction.
    /// Program construction and certification precede the destructive statement,
    /// and any execution refusal rolls the whole transaction back.
    pub fn reset_and_seed(
        &mut self,
        rows: &[(String, Value)],
    ) -> Result<ResetResult, RuntimeError> {
        let (program, certificate) = seed_program(&self.generation.schema, rows)?;
        let (execution, asset_ids) =
            self.engine
                .reset_and_seed(&program, &certificate, unix_millis())?;
        self.rerun_all_subscriptions();
        Ok(ResetResult {
            seq: execution.seq,
            asset_ids,
        })
    }

    pub fn apply_successor(
        &mut self,
        next: Generation,
    ) -> Result<SuccessorReport, SuccessorRefusal> {
        crate::engine::validate_schema(&next.schema)
            .map_err(|errors| store_refusal(first_schema_error(errors)))?;
        if let Some(refusal) =
            successor_refusal(self.engine.store(), &self.generation.schema, &next.schema)
                .map_err(store_refusal)?
        {
            return Err(refusal);
        }
        let current = self.generation.schema.clone();
        let from = self.generation.hash();
        let transaction = self
            .engine
            .store_mut()
            .conn
            .transaction()
            .map_err(|error| store_refusal(RuntimeError::Sql(error)))?;
        let report = apply_additive(
            &transaction,
            &current,
            &next.schema,
            from,
            next.hash(),
            None,
        )
        .map_err(store_refusal)?;
        persist_generation_transaction(&transaction, &next).map_err(store_refusal)?;
        transaction
            .commit()
            .map_err(|error| store_refusal(RuntimeError::Sql(error)))?;
        self.engine
            .set_schema(next.schema.clone())
            .map_err(store_refusal)?;
        self.generation = next;
        self.rerun_all_subscriptions();
        Ok(report)
    }

    pub fn apply_migration(
        &mut self,
        next: Generation,
        migration: &MigrationPlan,
        released_at: i64,
    ) -> Result<SuccessorReport, RuntimeError> {
        crate::engine::validate_schema(&next.schema).map_err(first_schema_error)?;
        let expected = plan(self.engine.store(), &self.generation.schema, &next.schema)?;
        if &expected != migration {
            return Err(RuntimeError::MigrationPlan(format!(
                "supplied plan does not match the current destructive delta: expected {:?}",
                expected.drops
            )));
        }
        let mut reduced = self.generation.schema.clone();
        let from = self.generation.hash();
        let transaction = self.engine.store_mut().conn.transaction()?;
        let predecessor_maintain_ids =
            projected_predecessor_ids(&transaction, &reduced, &next.schema)?;
        apply_migration_drops(&transaction, &mut reduced, migration, released_at)?;
        if let Some(refusal) = additive_refusal(&transaction, &reduced, &next.schema)? {
            return Err(RuntimeError::Successor(Box::new(refusal)));
        }
        let report = apply_additive(
            &transaction,
            &reduced,
            &next.schema,
            from,
            next.hash(),
            Some(predecessor_maintain_ids),
        )?;
        persist_generation_transaction(&transaction, &next)?;
        transaction.commit()?;
        self.engine.set_schema(next.schema.clone())?;
        self.generation = next;
        self.rerun_all_subscriptions();
        Ok(report)
    }

    pub fn generation(&self) -> &Generation {
        &self.generation
    }

    pub fn store(&self) -> &Store {
        self.engine.store()
    }

    // @ref LLP 1002#7-test-and-the-receipt — expected rule sets come from engine verdicts over every stored row.
    /// Evaluate a table's read rule against every stored row using the same
    /// engine and principal context as a real query. This is a control-plane
    /// proof primitive; callers cannot supply or omit the candidate rows.
    pub fn read_rule_verdicts(
        &mut self,
        table: &str,
        context: Context,
    ) -> Result<Vec<RowRuleVerdict>, RuntimeError> {
        let rule = self
            .generation
            .schema
            .table(table)
            .map(|table| table.rules.read.clone())
            .ok_or_else(|| RuntimeError::Schema(format!("missing table {table}")))?;
        let rows = self.engine.rows(table)?;
        rows.into_iter()
            .map(|row| {
                let (admitted, trace) =
                    self.engine.probe_rule(&rule, &row, context.clone(), None)?;
                Ok(RowRuleVerdict {
                    id: row.field("id")?.as_str()?.to_owned(),
                    admitted,
                    trace,
                })
            })
            .collect()
    }

    pub fn channel_admit(
        &mut self,
        name: &str,
        side: ChannelSide,
        args: &BTreeMap<String, Value>,
        context: &Context,
    ) -> Result<ChannelVerdict, RuntimeError> {
        let channel = self
            .generation
            .schema
            .channels
            .get(name)
            .cloned()
            .ok_or_else(|| RuntimeError::Input(format!("unknown channel {name}")))?;
        if args.len() != channel.args.len() {
            return Err(RuntimeError::Input(format!(
                "channel {name} expected {} args, got {}",
                channel.args.len(),
                args.len()
            )));
        }
        for (arg, kind) in &channel.args {
            let value = args
                .get(arg)
                .ok_or_else(|| RuntimeError::Input(format!("channel {name} missing arg {arg}")))?;
            validate_arg_value(kind, value, &format!("channel {name} arg {arg}"))?;
            if matches!(kind, ArgType::Scalar)
                && matches!(value, Value::Array(_) | Value::Row(_) | Value::Map(_))
            {
                return Err(RuntimeError::Input(format!(
                    "channel {name} arg {arg} must be scalar"
                )));
            }
        }
        let certificates = self
            .generation
            .channel_certificates
            .get(name)
            .ok_or_else(|| {
                RuntimeError::TraceSubset(format!("channel {name} lacks certificate"))
            })?;
        let (rule, certificate) = match side {
            ChannelSide::Publish => (channel.publish, &certificates.publish),
            ChannelSide::Subscribe => (channel.subscribe, &certificates.subscribe),
        };
        let row = Value::Row(args.clone());
        let (admitted, trace) =
            self.engine
                .probe_rule(&rule, &row, context.clone(), Some(certificate))?;
        Ok(ChannelVerdict {
            admitted,
            rule_inputs: trace.rule_inputs,
            points: trace.points,
        })
    }

    pub fn channel_touched(commit: &CommitRecord, verdict: &ChannelVerdict) -> bool {
        commit.touched.iter().any(|touched| {
            verdict.rule_inputs.iter().any(|input| {
                input.table == touched.table
                    && input.index == touched.index
                    && input.key == touched.key
            }) || verdict.points.iter().any(|point| {
                point.table == touched.table
                    && point.index == touched.index
                    && point.key == touched.key
            })
        })
    }
}

fn seed_program(
    schema: &Schema,
    rows: &[(String, Value)],
) -> Result<(Program, Certificate), RuntimeError> {
    for (table_name, row) in rows {
        crate::assets::refuse_seed_assets(schema, table_name, row)?;
    }
    let program = Program {
        name: "seed".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        result_page_site: None,
        body: rows
            .iter()
            .map(|(table, row)| {
                let id = row
                    .field("id")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)?;
                Ok(Stmt::Upsert {
                    table: table.clone(),
                    key: Expr::Literal(Value::Id(id)),
                    row: Expr::Literal(row.clone()),
                })
            })
            .chain(std::iter::once(Ok(Stmt::Return(Expr::Literal(
                Value::Null,
            )))))
            .collect::<Result<Vec<_>, RuntimeError>>()?,
    };
    let ceilings = Ceilings {
        write_rows: u64::MAX,
        ..Ceilings::default()
    };
    let certificate = Checker::new(schema, ceilings)
        .check(&program)
        .map_err(|error| {
            // Seed E_ARGS_* refusals describe invalid supplied row values, not schema structure.
            if error.code.starts_with("E_ARGS_") {
                RuntimeError::Input(error.to_string())
            } else {
                RuntimeError::Schema(error.to_string())
            }
        })?;
    Ok((program, certificate))
}

fn persist_generation(store: &mut Store, generation: &Generation) -> Result<(), RuntimeError> {
    let transaction = store.conn.transaction()?;
    persist_generation_transaction(&transaction, generation)?;
    transaction.commit()?;
    Ok(())
}

fn persist_generation_transaction(
    transaction: &rusqlite::Transaction<'_>,
    generation: &Generation,
) -> Result<(), RuntimeError> {
    let schema_json = serde_json::to_string(&generation.schema)
        .map_err(|error| RuntimeError::Serialization(error.to_string()))?;
    let effects_json = serde_json::to_string(&generation.effects)
        .map_err(|error| RuntimeError::Serialization(error.to_string()))?;
    let effects_hash = generation.effects_hash();
    for (key, value) in [
        ("schema_hash", generation.schema.hash()),
        ("generation", generation.hash()),
        ("schema_json", schema_json),
        ("effects_json", effects_json),
        ("effects_generation", effects_hash.clone()),
    ] {
        transaction.execute(
            "INSERT INTO _meta(key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            rusqlite::params![key, value],
        )?;
    }
    transaction.execute(
        "INSERT INTO _meta(key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![
            format!("effects_json:{effects_hash}"),
            serde_json::to_string(&generation.effects)
                .map_err(|error| RuntimeError::Serialization(error.to_string()))?
        ],
    )?;
    Ok(())
}

fn store_refusal(error: RuntimeError) -> SuccessorRefusal {
    SuccessorRefusal::store(&error)
}

fn first_schema_error(errors: Vec<RuntimeError>) -> RuntimeError {
    errors
        .into_iter()
        .next()
        .expect("schema validation refusal contains at least one diagnostic")
}

fn rejection_code(error: &RuntimeError) -> Option<&str> {
    crate::engine::mutation_rejection_code(error)
}

fn collect_emits<'a>(statements: &'a [Stmt], effects: &mut Vec<&'a str>) {
    for statement in statements {
        match statement {
            Stmt::Emit { effect, .. } => effects.push(effect),
            Stmt::If {
                then_body,
                else_body,
                ..
            } => {
                collect_emits(then_body, effects);
                collect_emits(else_body, effects);
            }
            Stmt::For { body, .. } => collect_emits(body, effects),
            _ => {}
        }
    }
}

#[cfg(test)]
mod then_tests {
    use super::*;
    use crate::schema::Schema;
    use crate::{Actor, SYSTEM_PRINCIPAL_ID};
    use std::collections::{BTreeMap, VecDeque};
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn execute_then_uses_the_private_reserved_system_context() {
        let mut admitted = pending_then_runtime("outbox-admitted");
        let execution = admitted
            .execute_then(
                "clock.then",
                BTreeMap::new(),
                15,
                None,
                VecDeque::new(),
                "outbox-admitted",
            )
            .unwrap();
        assert!(matches!(execution.state, ExecutionState::Committed { .. }));
        assert_eq!(
            admitted
                .store()
                .outbox_get("outbox-admitted")
                .unwrap()
                .unwrap()
                .state,
            "sent"
        );
        let commit = admitted.store().commits_since(0, 2).unwrap().pop().unwrap();
        assert_eq!(commit.principal, SYSTEM_PRINCIPAL_ID.as_str());
        assert_eq!(commit.kind, "system");
    }

    #[test]
    fn rejected_then_fault_after_commit_cannot_replay_after_time_changes() {
        let path = temp_path();
        let generation = timed_then_generation();
        {
            let mut runtime =
                Runtime::open(Store::open(&path).unwrap(), generation.clone()).unwrap();
            let mut emit = Context::mutation(Actor::user("user").unwrap(), BTreeMap::new());
            emit.now = Some(1);
            emit.new_ids = VecDeque::from(["outbox-1".to_owned()]);
            runtime.execute("clock.emit", emit).unwrap();
            runtime
                .store()
                .outbox_claim_next(1, &["clock.effect".to_owned()])
                .unwrap()
                .unwrap();
            runtime
                .store()
                .outbox_settle(
                    "outbox-1",
                    "then_pending",
                    Some(&serde_json::Value::Null),
                    None,
                    None,
                )
                .unwrap();

            runtime.fail_after_then_commit_once();
            let error = runtime
                .execute_then(
                    "clock.then",
                    BTreeMap::new(),
                    5,
                    None,
                    VecDeque::new(),
                    "outbox-1",
                )
                .unwrap_err();
            assert!(error.to_string().contains("simulated crash"));
        }

        let mut restarted = Runtime::open(Store::open(&path).unwrap(), generation).unwrap();
        let row = restarted.store().outbox_get("outbox-1").unwrap().unwrap();
        assert_eq!(row.state, "sent");
        assert!(
            row.last_error
                .as_deref()
                .is_some_and(|error| error.contains("TOO_EARLY"))
        );
        assert!(
            restarted
                .execute_then(
                    "clock.then",
                    BTreeMap::new(),
                    15,
                    None,
                    VecDeque::new(),
                    "outbox-1",
                )
                .unwrap_err()
                .to_string()
                .contains("not then_pending"),
            "restart cannot re-run a then that would now commit"
        );
        drop(restarted);
        cleanup(&path);
    }

    fn timed_then_generation() -> Generation {
        Generation::certify(
            &ProjectJson {
                version: 1,
                schema: Schema {
                    tables: BTreeMap::new(),
                    maintains: Vec::new(),
                    channels: BTreeMap::new(),
                    auth: Auth::default(),
                    effects: vec!["clock.effect".to_owned()],
                },
                programs: vec![
                    Program {
                        name: "clock.emit".to_owned(),
                        kind: ProgramKind::Mutation,
                        args: BTreeMap::new(),
                        read_time_granularity_ms: None,
                        result_page_site: None,
                        body: vec![Stmt::Emit {
                            effect: "clock.effect".to_owned(),
                            payload: Expr::Literal(Value::Null),
                        }],
                    },
                    Program {
                        name: "clock.then".to_owned(),
                        kind: ProgramKind::Mutation,
                        args: BTreeMap::new(),
                        read_time_granularity_ms: None,
                        result_page_site: None,
                        body: vec![Stmt::Require {
                            condition: Expr::Binary {
                                op: crate::ir::BinaryOp::Gte,
                                left: Box::new(Expr::Input(crate::ir::Input::Now)),
                                right: Box::new(Expr::Literal(Value::Int(10))),
                            },
                            code: "TOO_EARLY".to_owned(),
                        }],
                    },
                ],
                effects: vec![EffectDecl {
                    name: "clock.effect".to_owned(),
                    grants: Vec::new(),
                    source: "async () => null".to_owned(),
                    then: Some("clock.then".to_owned()),
                }],
                auth: Auth::default(),
            },
            Ceilings::default(),
        )
        .unwrap()
    }

    fn pending_then_runtime(outbox_id: &str) -> Runtime {
        let mut runtime = Runtime::open(Store::memory().unwrap(), timed_then_generation()).unwrap();
        let mut emit = Context::mutation(Actor::user("user").unwrap(), BTreeMap::new());
        emit.now = Some(1);
        emit.new_ids = VecDeque::from([outbox_id.to_owned()]);
        runtime.execute("clock.emit", emit).unwrap();
        runtime
            .store()
            .outbox_claim_next(1, &["clock.effect".to_owned()])
            .unwrap()
            .unwrap();
        runtime
            .store()
            .outbox_settle(
                outbox_id,
                "then_pending",
                Some(&serde_json::Value::Null),
                None,
                None,
            )
            .unwrap();
        runtime
    }

    fn temp_path() -> PathBuf {
        std::env::temp_dir().join(format!(
            "snapback2-then-fault-{}-{}.sqlite",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ))
    }

    fn cleanup(path: &std::path::Path) {
        for path in [
            path.to_path_buf(),
            PathBuf::from(format!("{}-wal", path.display())),
            PathBuf::from(format!("{}-shm", path.display())),
        ] {
            let _ = std::fs::remove_file(path);
        }
    }
}

fn collect_reserved_rule_reads(rule: &RuleExpr, reads: &mut BTreeSet<String>) {
    match rule {
        RuleExpr::Exists { table, .. } | RuleExpr::Created { table, .. }
            if table.starts_with('_') =>
        {
            reads.insert(table.clone());
        }
        RuleExpr::And(rules) | RuleExpr::Or(rules) => {
            for rule in rules {
                collect_reserved_rule_reads(rule, reads);
            }
        }
        RuleExpr::Not(rule) => collect_reserved_rule_reads(rule, reads),
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Actor;
    use crate::schema::{ColumnType, Index, RuleTerm, Rules, Table};

    #[test]
    fn adhoc_execution_does_not_install_a_program_or_change_the_generation() {
        let generation = Generation::certify(
            &ProjectJson {
                version: 1,
                schema: Schema::default(),
                programs: Vec::new(),
                effects: Vec::new(),
                auth: Auth::default(),
            },
            Ceilings::default(),
        )
        .unwrap();
        let before = generation.clone();
        let mut runtime = Runtime::open(Store::memory().unwrap(), generation).unwrap();
        let program = Program {
            name: "__owner.inspect".to_owned(),
            kind: ProgramKind::Query,
            args: BTreeMap::new(),
            read_time_granularity_ms: None,
            result_page_site: None,
            body: vec![Stmt::Return(Expr::Literal(Value::Int(42)))],
        };

        let execution = runtime
            .execute_adhoc(
                &program,
                Context::query(Actor::persona("alice").unwrap(), BTreeMap::new()),
            )
            .unwrap();

        assert_eq!(execution.result, Value::Int(42));
        assert_eq!(runtime.generation(), &before);
        assert_eq!(
            runtime.store().meta("generation").unwrap(),
            Some(before.hash())
        );
    }

    #[test]
    fn read_rule_verdicts_are_engine_evaluated_over_every_stored_row() {
        let schema = Schema {
            tables: BTreeMap::from([(
                "todos".to_owned(),
                Table {
                    columns: BTreeMap::from([
                        ("id".to_owned(), ColumnType::Id),
                        ("ownerId".to_owned(), ColumnType::Principal),
                    ]),
                    indexes: BTreeMap::from([(
                        "byId".to_owned(),
                        Index {
                            columns: vec!["id".to_owned()],
                            unique: true,
                        },
                    )]),
                    rules: Rules {
                        read: RuleExpr::Eq(RuleTerm::Field("ownerId".to_owned()), RuleTerm::Viewer),
                        insert: RuleExpr::Allow,
                        update: RuleExpr::Allow,
                        delete: RuleExpr::Allow,
                    },
                    constraints: Vec::new(),
                },
            )]),
            ..Schema::default()
        };
        let generation = Generation::certify(
            &ProjectJson {
                version: 1,
                schema,
                programs: Vec::new(),
                effects: Vec::new(),
                auth: Auth::default(),
            },
            Ceilings::default(),
        )
        .unwrap();
        let mut runtime = Runtime::open(Store::memory().unwrap(), generation).unwrap();
        runtime
            .seed(&[
                (
                    "todos".to_owned(),
                    Value::Row(BTreeMap::from([
                        ("id".to_owned(), Value::Id("seed".to_owned())),
                        ("ownerId".to_owned(), Value::Id("dev:alice".to_owned())),
                    ])),
                ),
                (
                    "todos".to_owned(),
                    Value::Row(BTreeMap::from([
                        ("id".to_owned(), Value::Id("ghost".to_owned())),
                        ("ownerId".to_owned(), Value::Id("dev:alice".to_owned())),
                    ])),
                ),
                (
                    "todos".to_owned(),
                    Value::Row(BTreeMap::from([
                        ("id".to_owned(), Value::Id("denied".to_owned())),
                        ("ownerId".to_owned(), Value::Id("dev:bob".to_owned())),
                    ])),
                ),
            ])
            .unwrap();
        let context = Context::query(Actor::persona("alice").unwrap(), BTreeMap::new());

        let verdicts = runtime.read_rule_verdicts("todos", context).unwrap();
        let admitted = verdicts
            .iter()
            .filter(|verdict| verdict.admitted)
            .map(|verdict| verdict.id.as_str())
            .collect::<BTreeSet<_>>();

        assert_eq!(verdicts.len(), 3);
        assert_eq!(admitted, BTreeSet::from(["ghost", "seed"]));
    }
}
