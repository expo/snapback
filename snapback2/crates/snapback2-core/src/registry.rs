//! Certified project generations and the stateful query runtime.
// @ref LLP 1001#4-generation-and-runtime-registryrs-successorrs — one certified project is live.

use crate::certificate::{Ceilings, Certificate, CheckError, Checker};
use crate::engine::{
    AuthoritativeTrace, ClosureReceipt, Context, Engine, Execution, ExecutionState, PointTrace,
    RuleInputTrace, RuntimeError, is_sqlite_constraint,
};
use crate::ir::{ArgType, Expr, Program, ProgramKind, Stmt};
use crate::live::Subscriptions;
use crate::schema::{Auth, RuleExpr, Schema};
use crate::store::{CommitRecord, Store, unix_millis};
use crate::successor::{
    MigrationPlan, SuccessorRefusal, SuccessorReport, additive_refusal, apply_additive,
    apply_migration_drops, plan, successor_refusal,
};
use crate::value::{I53_MAX, I53_MIN, Value, ValueError, digest};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

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

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Generation {
    pub hash: String,
    pub schema: Schema,
    pub programs: BTreeMap<String, (Program, Certificate)>,
    pub effects: BTreeMap<String, EffectDecl>,
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

impl Generation {
    pub fn certify(
        project: &ProjectJson,
        ceilings: Ceilings,
    ) -> Result<Self, Vec<(String, CheckError)>> {
        let mut errors = Vec::new();
        let mut schema = project.schema.clone();
        schema.auth = project.auth.clone();

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
            for reserved in &reserved_rule_reads {
                errors.push((
                    format!("schema.{table}"),
                    CheckError {
                        code: "E_SCHEMA_RESERVED".to_owned(),
                        message: format!("rule reads reserved table {reserved}"),
                        rewrite: "use a principal kind or application-owned relation in rules"
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
            for (index_name, index) in &table.indexes {
                for column in &index.columns {
                    if table
                        .columns
                        .get(column)
                        .is_some_and(crate::schema::ColumnType::contains_list)
                    {
                        errors.push((
                            format!("schema.{table_name}"),
                            CheckError {
                                code: "E_SCHEMA_INDEX_COLUMN".to_owned(),
                                message: format!(
                                    "index {table_name}.{index_name} cannot use list column {column}"
                                ),
                                rewrite: "index scalar columns instead of list values".to_owned(),
                            },
                        ));
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
            Ok(Self {
                hash: digest(project),
                schema,
                programs,
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
}

impl Runtime {
    pub fn open(mut store: Store, generation: Generation) -> Result<Self, SuccessorRefusal> {
        crate::engine::validate_schema(&generation.schema).map_err(store_refusal)?;
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
            Some(hash) if hash == generation.hash => {}
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
                    generation.hash.clone(),
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
        })
    }

    pub fn execute(&mut self, op: &str, context: Context) -> Result<Execution, RuntimeError> {
        let (program, certificate) = self
            .generation
            .programs
            .get(op)
            .cloned()
            .ok_or_else(|| RuntimeError::OpUnknown(op.to_owned()))?;
        match self.engine.execute(&program, &certificate, context) {
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
                    })
                } else {
                    Err(error)
                }
            }
            Err(error) => Err(error),
        }
    }

    pub fn seed(&mut self, rows: &[(String, Value)]) -> Result<u64, RuntimeError> {
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
            ..Ceilings::default()
        };
        let certificate = Checker::new(&self.generation.schema, ceilings)
            .check(&program)
            .map_err(|error| RuntimeError::Schema(error.to_string()))?;
        let mut context = Context::system();
        context.now = Some(unix_millis());
        self.engine
            .execute_with_kind(&program, &certificate, context, Some("seed"))
            .map(|execution| execution.seq)
    }

    pub fn apply_successor(
        &mut self,
        next: Generation,
    ) -> Result<SuccessorReport, SuccessorRefusal> {
        crate::engine::validate_schema(&next.schema).map_err(store_refusal)?;
        if let Some(refusal) =
            successor_refusal(self.engine.store(), &self.generation.schema, &next.schema)
                .map_err(store_refusal)?
        {
            return Err(refusal);
        }
        let current = self.generation.schema.clone();
        let from = self.generation.hash.clone();
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
            next.hash.clone(),
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
    ) -> Result<SuccessorReport, RuntimeError> {
        crate::engine::validate_schema(&next.schema)?;
        let expected = plan(self.engine.store(), &self.generation.schema, &next.schema)?;
        if &expected != migration {
            return Err(RuntimeError::MigrationPlan(format!(
                "supplied plan does not match the current destructive delta: expected {:?}",
                expected.drops
            )));
        }
        let mut reduced = self.generation.schema.clone();
        let from = self.generation.hash.clone();
        let transaction = self.engine.store_mut().conn.transaction()?;
        apply_migration_drops(&transaction, &mut reduced, migration)?;
        if let Some(refusal) = additive_refusal(&transaction, &reduced, &next.schema)? {
            return Err(RuntimeError::Successor(Box::new(refusal)));
        }
        let report = apply_additive(
            &transaction,
            &reduced,
            &next.schema,
            from,
            next.hash.clone(),
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
            match kind {
                ArgType::Scalar
                    if matches!(value, Value::Array(_) | Value::Row(_) | Value::Map(_)) =>
                {
                    return Err(RuntimeError::Input(format!(
                        "channel {name} arg {arg} must be scalar"
                    )));
                }
                ArgType::List { max } if value.as_array()?.len() > *max as usize => {
                    return Err(RuntimeError::Fanout);
                }
                ArgType::List { .. } => {
                    value.as_array()?;
                }
                ArgType::Enum { variants } if !matches!(value, Value::String(value) if variants.contains(value)) =>
                {
                    return Err(RuntimeError::Input(format!(
                        "channel {name} arg {arg} must be one of {variants:?}"
                    )));
                }
                ArgType::Decimal { .. } | ArgType::Money { .. } if !matches!(value, Value::Int(value) if (I53_MIN..=I53_MAX).contains(value)) =>
                {
                    return Err(RuntimeError::Input(format!(
                        "channel {name} arg {arg} must be an integer"
                    )));
                }
                ArgType::Enum { .. }
                | ArgType::Decimal { .. }
                | ArgType::Money { .. }
                | ArgType::Scalar => {}
            }
        }
        let rule = match side {
            ChannelSide::Publish => channel.publish,
            ChannelSide::Subscribe => channel.subscribe,
        };
        let row = Value::Row(args.clone());
        let (admitted, trace) = self.engine.probe_rule(&rule, &row, context.clone())?;
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
    for (key, value) in [
        ("schema_hash", generation.schema.hash()),
        ("generation", generation.hash.clone()),
        ("schema_json", schema_json),
    ] {
        transaction.execute(
            "INSERT INTO _meta(key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            rusqlite::params![key, value],
        )?;
    }
    Ok(())
}

fn store_refusal(error: RuntimeError) -> SuccessorRefusal {
    SuccessorRefusal::store(&error)
}

fn rejection_code(error: &RuntimeError) -> Option<&str> {
    match error {
        RuntimeError::Require { code } => Some(code),
        RuntimeError::Rule { .. } => Some("rule"),
        RuntimeError::Constraint(_) => Some("E_CONSTRAINT"),
        error if is_sqlite_constraint(error) => Some("E_CONSTRAINT"),
        RuntimeError::Input(_) => Some("E_INPUT"),
        RuntimeError::Value(error) => Some(match error {
            ValueError::DivideByZero => "E_DIV_ZERO",
            ValueError::Overflow(_) => "E_OVERFLOW",
            ValueError::Type { .. } => "E_TYPE",
            ValueError::MissingField(_) => "E_FIELD",
        }),
        RuntimeError::Steps(_) | RuntimeError::Fanout | RuntimeError::TraceSubset(_) => {
            Some("bound")
        }
        // SQLite I/O/corruption and all non-program database failures remain Err.
        _ => None,
    }
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

fn collect_reserved_rule_reads(rule: &RuleExpr, reads: &mut BTreeSet<String>) {
    match rule {
        RuleExpr::Exists { table, .. } if table.starts_with('_') => {
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
