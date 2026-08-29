//! Certified project generations and the stateful query runtime.
// @ref LLP 1001#4-generation-and-runtime-registryrs-successorrs — one certified project is live.

use crate::certificate::{Ceilings, Certificate, CheckError, Checker};
use crate::engine::{
    AuthoritativeTrace, ClosureReceipt, Context, Engine, Execution, ExecutionState, RuntimeError,
};
use crate::ir::{ArgType, Expr, Program, ProgramKind, Stmt};
use crate::live::Subscriptions;
use crate::schema::{Auth, RuleExpr, Schema};
use crate::store::{Store, unix_millis};
use crate::successor::{
    MigrationPlan, SuccessorRefusal, SuccessorReport, apply_additive, apply_migration_drops, plan,
};
use crate::value::{Value, digest};
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

        let declared_effects: BTreeSet<_> = schema.effects.iter().cloned().collect();
        let mut programs = BTreeMap::new();
        let mut seen_programs = BTreeSet::new();
        for program in &project.programs {
            if !seen_programs.insert(program.name.clone()) {
                errors.push((
                    program.name.clone(),
                    CheckError {
                        code: "E_OP_DUPLICATE".to_owned(),
                        message: format!("program {} is declared more than once", program.name),
                        rewrite: "give every exported program one qualified name".to_owned(),
                    },
                ));
                continue;
            }
            match Checker::new(&schema, ceilings.clone()).check(program) {
                Ok(certificate) => {
                    programs.insert(program.name.clone(), (program.clone(), certificate));
                }
                Err(error) => errors.push((program.name.clone(), error)),
            }
            let mut emitted = Vec::new();
            collect_emits(&program.body, &mut emitted);
            for effect in emitted {
                if !declared_effects.contains(effect) {
                    errors.push((
                        program.name.clone(),
                        CheckError {
                            code: "E_EFFECT_UNKNOWN".to_owned(),
                            message: format!(
                                "program {} emits undeclared effect {effect}",
                                program.name
                            ),
                            rewrite: format!(
                                "declare {effect} in schema.effects and project effects"
                            ),
                        },
                    ));
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
        let installed = store.meta("generation").map_err(store_refusal)?;
        match installed {
            None => {
                let row_count: i64 = store
                    .conn
                    .query_row("SELECT COUNT(*) FROM rows", [], |row| row.get(0))
                    .map_err(|error| store_refusal(error.into()))?;
                if row_count != 0 {
                    return Err(SuccessorRefusal {
                        code: "E_SUCCESSOR_DESTRUCTIVE".to_owned(),
                        plan: MigrationPlan::default(),
                    });
                }
                persist_generation(&mut store, &generation).map_err(store_refusal)?;
            }
            Some(hash) if hash == generation.hash => {}
            Some(hash) => {
                let current_json = store
                    .meta("schema_json")
                    .map_err(store_refusal)?
                    .ok_or_else(|| SuccessorRefusal {
                        code: "E_SUCCESSOR_DESTRUCTIVE".to_owned(),
                        plan: MigrationPlan::default(),
                    })?;
                let current: Schema = serde_json::from_str(&current_json).map_err(|error| {
                    store_refusal(RuntimeError::Serialization(error.to_string()))
                })?;
                let migration =
                    plan(&store, &current, &generation.schema).map_err(store_refusal)?;
                if !migration.drops.is_empty() {
                    return Err(SuccessorRefusal {
                        code: "E_SUCCESSOR_DESTRUCTIVE".to_owned(),
                        plan: migration,
                    });
                }
                apply_additive(
                    &mut store,
                    &current,
                    &generation.schema,
                    hash,
                    generation.hash.clone(),
                )
                .map_err(store_refusal)?;
                persist_generation(&mut store, &generation).map_err(store_refusal)?;
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
            Err(RuntimeError::Rule { table, effect }) => Ok(Execution {
                result: Value::Null,
                trace: AuthoritativeTrace::default(),
                receipt: ClosureReceipt::default(),
                state: ExecutionState::Denied {
                    rule: format!("{table}.{effect:?}"),
                },
                seq: self.engine.store().commit_seq()?,
            }),
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
        let migration = plan(self.engine.store(), &self.generation.schema, &next.schema)
            .map_err(store_refusal)?;
        if !migration.drops.is_empty() {
            return Err(SuccessorRefusal {
                code: "E_SUCCESSOR_DESTRUCTIVE".to_owned(),
                plan: migration,
            });
        }
        let report = apply_additive(
            self.engine.store_mut(),
            &self.generation.schema,
            &next.schema,
            self.generation.hash.clone(),
            next.hash.clone(),
        )
        .map_err(store_refusal)?;
        persist_generation(self.engine.store_mut(), &next).map_err(store_refusal)?;
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
        let mut reduced = self.generation.schema.clone();
        apply_migration_drops(
            self.engine.store_mut(),
            &mut reduced,
            &next.schema,
            migration,
        )?;
        let report = apply_additive(
            self.engine.store_mut(),
            &reduced,
            &next.schema,
            self.generation.hash.clone(),
            next.hash.clone(),
        )?;
        persist_generation(self.engine.store_mut(), &next)?;
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
    ) -> Result<bool, RuntimeError> {
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
                ArgType::Scalar => {}
            }
        }
        let rule = match side {
            ChannelSide::Publish => channel.publish,
            ChannelSide::Subscribe => channel.subscribe,
        };
        let row = Value::Row(args.clone());
        let (admitted, _trace) = self.engine.probe_rule(&rule, &row, context.clone())?;
        Ok(admitted)
    }
}

fn persist_generation(store: &mut Store, generation: &Generation) -> Result<(), RuntimeError> {
    store.set_meta("schema_hash", &generation.schema.hash())?;
    store.set_meta("generation", &generation.hash)?;
    store.set_meta(
        "schema_json",
        &serde_json::to_string(&generation.schema)
            .map_err(|error| RuntimeError::Serialization(error.to_string()))?,
    )?;
    Ok(())
}

fn store_refusal(_error: RuntimeError) -> SuccessorRefusal {
    SuccessorRefusal {
        code: "E_SUCCESSOR_STORE".to_owned(),
        plan: MigrationPlan::default(),
    }
}

fn rejection_code(error: &RuntimeError) -> Option<&str> {
    match error {
        RuntimeError::Require { code } => Some(code),
        RuntimeError::Rule { .. } => Some("rule"),
        RuntimeError::Constraint(_) => Some("constraint"),
        RuntimeError::Input(_) => Some("input"),
        RuntimeError::Steps(_) | RuntimeError::Fanout | RuntimeError::TraceSubset(_) => {
            Some("bound")
        }
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
