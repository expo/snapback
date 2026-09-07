//! Certified project generations and the stateful query runtime.
// @ref LLP 1001#4-generation-and-runtime-registryrs-successorrs — one certified project is live.

use crate::certificate::{Ceilings, Certificate, CheckError, Checker, RuleCertificate};
use crate::engine::{
    AuthoritativeTrace, ClosureReceipt, Context, Engine, Execution, ExecutionState, PointTrace,
    RuleInputTrace, RuntimeError,
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
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, VecDeque};

#[path = "registry_offline.rs"]
mod registry_offline;

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
    #[serde(skip_serializing)]
    timer_bindings: BTreeMap<String, crate::timers::TimerCertificates>,
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

#[derive(Clone, Debug, Serialize, Deserialize)]
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

    /// A schedule binding's program and certificate: certified beside the operations, never one of them.
    pub fn timer_binding(&self, program: &str) -> Option<(&Program, &Certificate)> {
        self.timer_bindings
            .values()
            .find(|c| c.binding.name == program)
            .map(|c| (&c.binding, &c.binding_certificate))
    }

    /// Every schedule binding program, for a certification that must see them beside the operations.
    pub fn timer_binding_programs(&self) -> Vec<Program> {
        self.timer_bindings
            .values()
            .map(|c| c.binding.clone())
            .collect()
    }

    pub fn schema_certificate(&self) -> serde_json::Value {
        let mut certificate = serde_json::json!({"schedules":self.schema.schedules.iter().map(|s|serde_json::json!({"name":s.name,"trigger":s.trigger,"target":s.target})).collect::<Vec<_>>()});
        disclose_once_assets(&mut certificate, &self.schema);
        certificate
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
        errors.extend(crate::cap::schema_errors(&schema));

        for table in schema
            .tables
            .keys()
            .filter(|table| table.starts_with('_') || table.as_str() == "connected")
        {
            errors.push((
                "schema".to_owned(),
                CheckError {
                    site: None,
                    code: "E_SCHEMA_RESERVED".to_owned(),
                    message: format!("schema declares reserved table {table}"),
                    rewrite:
                        "use an application table name other than connected, without a leading '_'"
                            .to_owned(),
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
                        site: None,
                        code: "E_SCHEMA_RESERVED".to_owned(),
                        message: format!("rule reads reserved table {reserved}"),
                        rewrite: "use deny for owner-only writes, or an application-owned relation in viewer rules"
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
                        site: None,
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
                        site: None,
                        code: "E_SCHEMA_ID_RESERVED".to_owned(),
                        message: format!(
                            "table {table_name} must declare the implicit id column as Id"
                        ),
                        rewrite: "restore the compiler-emitted id: Id column".to_owned(),
                    },
                ));
            }
            for error in crate::schema::index_errors(table_name, table) {
                errors.push((format!("schema.{table_name}"), CheckError {
                    site: None, code: "E_SCHEMA_INDEX_COLUMN".into(), message: error.to_string(),
                    rewrite: "declare bounded scalar components and at most one nonunique wordPrefixes before an ordinary suffix".into(),
                }));
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
                            site: None,
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
                            site: None,
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
                    site: None,
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
                        site: None,
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
                        site: None,
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
                        site: None,
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
                            site: None,
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

        let timer_bindings = match crate::timers::certify(
            &schema,
            &project
                .programs
                .iter()
                .map(|p| (p.name.clone(), p.clone()))
                .collect::<Vec<_>>(),
            &ceilings,
        ) {
            Ok(bindings) => bindings,
            Err(mut refused) => {
                errors.append(&mut refused);
                BTreeMap::new()
            }
        };
        // @ref LLP 1016#d5--schedules-row-timers-and-periods-on-the-owners-clock — a binding is
        // certified like any program but is never an operation: it leaves the client-visible map
        // and its identity joins program_hash only when a schedule exists, so schedule-less
        // stores keep their custody hash.
        for certificates in timer_bindings.values() {
            programs.remove(&certificates.binding.name);
        }
        if errors.is_empty() {
            let certified_programs = programs
                .iter()
                .map(|(name, (program, certificate))| (name, program, digest(certificate)))
                .collect::<Vec<_>>();
            let program_hash = if timer_bindings.is_empty() {
                digest(&(schema.hash(), certified_programs))
            } else {
                let bindings = timer_bindings
                    .iter()
                    .map(|(name, c)| {
                        (
                            name,
                            &c.binding,
                            digest(&c.binding_certificate),
                            digest(&c.target),
                        )
                    })
                    .collect::<Vec<_>>();
                digest(&(schema.hash(), certified_programs, bindings))
            };
            Ok(Self {
                schema,
                programs,
                program_hash,
                table_read_certificates,
                channel_certificates,
                timer_bindings,
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
    pub(crate) executions: u64,
    #[cfg(test)]
    fail_after_then_commit: bool,
}
impl Runtime {
    pub fn open(mut store: Store, generation: Generation) -> Result<Self, SuccessorRefusal> {
        crate::engine::validate_schema(&generation.schema)
            .map_err(|errors| store_refusal(first_schema_error(errors)))?;
        let generation_hash = generation.hash();
        let installed = store.meta("generation").map_err(store_refusal)?;
        let installed_program = store.meta("program_generation").map_err(store_refusal)?;
        let installed_effects = store.meta("effects_generation").map_err(store_refusal)?;
        let succession = installed_effects
            .as_ref()
            .is_some_and(|h| h != &generation.effects_hash())
            || installed.as_ref().is_some_and(|h| h != &generation.hash())
            || installed_program
                .as_deref()
                .is_some_and(|h| h != generation.program_hash());
        match installed.clone() {
            None => {
                let row_count: i64 = store
                    .conn
                    .query_row("SELECT COUNT(*) FROM rows", [], |row| row.get(0))
                    .map_err(|error| store_refusal(error.into()))?;
                if row_count != 0 {
                    return Err(SuccessorRefusal::destructive(MigrationPlan::default()));
                }
                persist_generation(&mut store, &generation, unix_millis())
                    .map_err(store_refusal)?;
            }
            Some(hash) if hash == generation_hash => {
                // Additive owner metadata can appear after the generation was
                // first installed (for example the outbox declaration binding).
                persist_generation(&mut store, &generation, unix_millis())
                    .map_err(store_refusal)?;
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
                persist_generation_transaction(&transaction, &generation, unix_millis())
                    .map_err(store_refusal)?;
                transaction
                    .commit()
                    .map_err(|error| store_refusal(RuntimeError::Sql(error)))?;
            }
        }
        crate::store_jobs::reconcile(&store.conn, &generation, succession)
            .map_err(store_refusal)?;
        store
            .conn
            .execute("UPDATE _jobs SET state='queued' WHERE state='running'", [])
            .map_err(|e| store_refusal(e.into()))?;
        let engine = Engine::new(store, generation.schema.clone()).map_err(store_refusal)?;
        Ok(Self {
            engine,
            generation,
            subs: Subscriptions::default(),
            executions: 0,
            #[cfg(test)]
            fail_after_then_commit: false,
        })
    }

    pub fn execute(&mut self, op: &str, context: Context) -> Result<Execution, RuntimeError> {
        self.executions = self.executions.saturating_add(1);
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

    pub fn discard_upload(&mut self, actor: &crate::Actor, id: &str) -> Result<bool, RuntimeError> {
        self.engine.store_mut().discard_upload(actor.id(), id)
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

    /// The HTTP delivery reserved this principal, authorized the row, and wrote body bytes.
    pub fn record_asset_view(
        &mut self,
        id: &str,
        principal: &str,
        at: i64,
    ) -> Result<(), RuntimeError> {
        self.engine.store_mut().record_asset_view(id, principal, at)
    }

    pub fn reclaim_assets(&mut self, now: i64) -> Result<Vec<String>, RuntimeError> {
        self.engine.store_mut().reclaim(now)
    }

    pub fn finish_asset_reclaims(&mut self, ids: &[String]) -> Result<(), RuntimeError> {
        self.engine.store_mut().finish_asset_reclaims(ids)
    }

    /// Execute an effect's `then` mutation and settle its durable outbox row
    /// in the mutation's own SQLite transaction.
    // @ref LLP 1016#d1--the-system-principal-is-the-stores-owner — `then` skips viewer rules; its writes and outbox settlement remain one transaction.
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
            result_provenance: Default::default(),
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
                        result_provenance: Default::default(),
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
        self.reset_and_seed_at(rows, unix_millis())
    }

    /// Reset at the caller's clock sample: a reset store is a fresh install, and its period
    /// timers are anchored to `now` — the owner's dev clock, never bare wall time.
    pub fn reset_and_seed_at(
        &mut self,
        rows: &[(String, Value)],
        now: i64,
    ) -> Result<ResetResult, RuntimeError> {
        let (program, certificate) = seed_program(&self.generation.schema, rows)?;
        let (execution, asset_ids) = self.engine.reset_and_seed(&program, &certificate, now)?;
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
        self.apply_successor_at(next, unix_millis())
    }

    // @ref LLP 1016#d5--schedules-row-timers-and-periods-on-the-owners-clock — a period timer a
    // successor installs is anchored to the caller's clock sample, the clock the writer fires
    // against; wall time under an advanced dev clock would arm it already due with a large skip.
    pub fn apply_successor_at(
        &mut self,
        next: Generation,
        now: i64,
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
        crate::store_jobs::reconcile(&transaction, &next, true).map_err(store_refusal)?;
        persist_generation_transaction(&transaction, &next, now).map_err(store_refusal)?;
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
        crate::store_jobs::reconcile(&transaction, &next, true)?;
        persist_generation_transaction(&transaction, &next, released_at)?;
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
        let mut args = args.clone();
        crate::engine::complete_optional_args(&channel.args, &mut args);
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
            crate::engine::validate_typed_arg_value(
                &self.generation.schema,
                kind,
                value,
                &format!("channel {name} arg {arg}"),
            )?;
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
        let row = Value::Row(args.clone().into());
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
        // @ref LLP 1017#24-metering — seeds reserve cap work but waive these ceilings.
        examined: u64::MAX,
        index_entries: u64::MAX,
        steps: u64::MAX,
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

fn persist_generation(
    store: &mut Store,
    generation: &Generation,
    now: i64,
) -> Result<(), RuntimeError> {
    let transaction = store.conn.transaction()?;
    persist_generation_transaction(&transaction, generation, now)?;
    transaction.commit()?;
    Ok(())
}

/// `now` is the clock a newly installed period timer is anchored to: the owner passes its own
/// (dev-clock) sample through `apply_successor_at`; a fresh open uses wall time, which is the
/// owner's clock at process start.
fn persist_generation_transaction(
    transaction: &rusqlite::Transaction<'_>,
    generation: &Generation,
    now: i64,
) -> Result<(), RuntimeError> {
    let previous: Option<String> = transaction
        .query_row("SELECT value FROM _meta WHERE key='schema_json'", [], |r| {
            r.get(0)
        })
        .optional()?;
    let previous = previous
        .as_deref()
        .map(crate::store_jobs::decode::<Schema>)
        .transpose()?
        .unwrap_or_default();
    crate::store_timers::reconcile(transaction, &previous, &generation.schema, now)?;
    let schema_json = serde_json::to_string(&generation.schema)
        .map_err(|error| RuntimeError::Serialization(error.to_string()))?;
    let effects_json = serde_json::to_string(&generation.effects)
        .map_err(|error| RuntimeError::Serialization(error.to_string()))?;
    let effects_hash = generation.effects_hash();
    for (key, value) in [
        ("schema_hash", generation.schema.hash()),
        ("generation", generation.hash()),
        ("program_generation", generation.program_hash().to_owned()),
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
    match error {
        RuntimeError::Successor(refusal) => *refusal,
        error => SuccessorRefusal::store(&error),
    }
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
#[path = "registry_then_tests.rs"]
mod then_tests;

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

// @ref LLP 1006#2a1-one-use-image-delivery-clique-f3-2026-09-05 — custody is disclosed beside all other schema facts.
fn disclose_once_assets(certificate: &mut serde_json::Value, schema: &Schema) {
    let once: Vec<_> = schema.tables.iter().flat_map(|(name, table)| table.columns.iter()
        .filter(|(_, kind)| kind.is_once()).map(move |(column, _)|
            serde_json::json!(format!("{name}.{column}: one image delivery per authenticated principal; owning row read rule; no device byte cache")))).collect();
    if !once.is_empty() {
        certificate
            .as_object_mut()
            .expect("schema certificate object")
            .entry("disclosures")
            .or_insert_with(|| serde_json::json!([]))
            .as_array_mut()
            .expect("disclosures array")
            .extend(once);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Actor;
    use crate::schema::{ColumnType, Index, RuleTerm, Rules, Table};

    #[test]
    fn once_disclosures_preserve_existing_schema_disclosures() {
        let case: serde_json::Value =
            serde_json::from_str(include_str!("../../../corpus/asset-once-image-insert.json"))
                .unwrap();
        let schema: Schema = serde_json::from_value(case["schema"].clone()).unwrap();
        let mut certificate = serde_json::json!({"disclosures":["existing fact"], "schedules":[]});
        disclose_once_assets(&mut certificate, &schema);
        assert_eq!(
            certificate["disclosures"],
            serde_json::json!([
                "existing fact",
                "media.photo: one image delivery per authenticated principal; owning row read rule; no device byte cache"
            ])
        );
        assert_eq!(certificate["schedules"], serde_json::json!([]));
    }

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
                            components: (vec!["id".to_owned()])
                                .into_iter()
                                .map(crate::search_key::IndexComponent::Column)
                                .collect(),
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
                    retain: Default::default(),
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
                    Value::Row(
                        BTreeMap::from([
                            ("id".to_owned(), Value::Id("seed".to_owned())),
                            ("ownerId".to_owned(), Value::Id("dev:alice".to_owned())),
                        ])
                        .into(),
                    ),
                ),
                (
                    "todos".to_owned(),
                    Value::Row(
                        BTreeMap::from([
                            ("id".to_owned(), Value::Id("ghost".to_owned())),
                            ("ownerId".to_owned(), Value::Id("dev:alice".to_owned())),
                        ])
                        .into(),
                    ),
                ),
                (
                    "todos".to_owned(),
                    Value::Row(
                        BTreeMap::from([
                            ("id".to_owned(), Value::Id("denied".to_owned())),
                            ("ownerId".to_owned(), Value::Id("dev:bob".to_owned())),
                        ])
                        .into(),
                    ),
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

#[path = "registry_operator.rs"]
mod operator;
pub use operator::OperatorId;

#[path = "registry_jobs.rs"]
mod registry_jobs;

#[path = "registry_timers.rs"]
mod registry_timers;
