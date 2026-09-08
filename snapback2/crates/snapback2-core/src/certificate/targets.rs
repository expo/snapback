//! Exact application row addresses; write bounds alone never prove ID allocation.
// @ref LLP 1018.003.001#3-semantic-mutation-targets — unsupported control flow keeps an intent-only item.
use crate::ir::*;
use crate::schema::{IndexComponent, Schema};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TargetSource {
    NewId(u64),
    Argument(String),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TargetKind {
    Create,
    Update,
    Remove,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UnresolvedTarget {
    Conditional,
    Repeated,
    Ambiguous,
    Computed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MutationTarget {
    pub table: String,
    pub kind: TargetKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<TargetSource>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unresolved: Option<UnresolvedTarget>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct MutationTargets {
    pub targets: Vec<MutationTarget>,
    /// Exact direct row effects only; maintained/engine writes remain separately certified.
    pub complete: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
enum Fact {
    #[default]
    Unknown,
    Id(TargetSource),
    Object(BTreeMap<String, Fact>),
}
impl Fact {
    fn field(self, name: &str) -> Self {
        match self {
            Self::Object(mut fields) => fields.remove(name).unwrap_or_default(),
            _ => Self::Unknown,
        }
    }
}

#[derive(Clone, Default)]
struct Analysis {
    env: BTreeMap<String, Fact>,
    primary_indexes: BTreeSet<(String, String)>,
    next: Option<u64>,
    targets: BTreeMap<(String, TargetKind), MutationTarget>,
    unknown_effects: bool,
}

pub(super) fn derive(schema: &Schema, program: &Program) -> Option<MutationTargets> {
    if program.kind != ProgramKind::Mutation {
        return None;
    }
    let primary_indexes = schema
        .tables
        .iter()
        .flat_map(|(table, definition)| {
            definition
                .indexes
                .iter()
                .filter(|(_, index)| {
                    index.unique && index.components == [IndexComponent::Column("id".into())]
                })
                .map(|(index, _)| (table.clone(), index.clone()))
        })
        .collect();
    let mut analysis = Analysis {
        next: Some(0),
        primary_indexes,
        ..Analysis::default()
    };
    for (name, kind) in &program.args {
        if matches!(kind, ArgType::Id | ArgType::Ref { .. }) {
            analysis
                .env
                .insert(name.clone(), Fact::Id(TargetSource::Argument(name.clone())));
        }
    }
    analysis.statements(&program.body, None);
    Some(MutationTargets {
        complete: !analysis.unknown_effects
            && analysis.targets.values().all(|t| t.source.is_some()),
        targets: analysis.targets.into_values().collect(),
    })
}

impl Analysis {
    fn add(&mut self, table: &str, kind: TargetKind, fact: Fact, guard: Option<UnresolvedTarget>) {
        let source = match fact {
            Fact::Id(source) if guard.is_none() => Some(source),
            _ => None,
        };
        let unresolved = if source.is_some() {
            None
        } else {
            Some(guard.unwrap_or(UnresolvedTarget::Computed))
        };
        self.targets
            .entry((table.to_owned(), kind))
            .and_modify(|existing| {
                existing.source = None;
                existing.unresolved = Some(UnresolvedTarget::Ambiguous);
            })
            .or_insert(MutationTarget {
                table: table.to_owned(),
                kind,
                source,
                unresolved,
            });
    }

    fn merge_targets(&mut self, other: Self) {
        self.unknown_effects |= other.unknown_effects;
        for target in other.targets.into_values() {
            self.add(
                &target.table,
                target.kind,
                target.source.map(Fact::Id).unwrap_or_default(),
                target.unresolved,
            );
        }
    }

    fn statements(&mut self, statements: &[Stmt], mut guard: Option<UnresolvedTarget>) {
        for stmt in statements {
            match stmt {
                Stmt::Const { name, value }
                | Stmt::Let { name, value }
                | Stmt::Assign { name, value } => {
                    let value = self.expr(value);
                    self.env.insert(name.clone(), value);
                }
                Stmt::Push { target, value } => {
                    self.expr(value);
                    self.env.insert(target.clone(), Fact::Unknown);
                }
                Stmt::Require { condition, .. } => {
                    self.expr(condition);
                }
                Stmt::Return(value) => {
                    self.expr(value);
                    break;
                }
                Stmt::Break | Stmt::Continue => break,
                Stmt::Insert { table, row } => {
                    let row = self.expr(row);
                    self.add(table, TargetKind::Create, row.field("id"), guard);
                }
                Stmt::Update { table, key, patch } => {
                    let key = self.expr(key);
                    self.expr(patch);
                    self.add(table, TargetKind::Update, key, guard);
                }
                Stmt::Delete { table, key } => {
                    let key = self.expr(key);
                    self.add(table, TargetKind::Remove, key, guard);
                }
                Stmt::Upsert { table, key, row } => {
                    self.expr(key);
                    self.expr(row);
                    // The existing-row branch and creating branch are not one action kind.
                    self.add(
                        table,
                        TargetKind::Create,
                        Fact::Unknown,
                        Some(UnresolvedTarget::Conditional),
                    );
                    self.add(
                        table,
                        TargetKind::Update,
                        Fact::Unknown,
                        Some(UnresolvedTarget::Conditional),
                    );
                }
                Stmt::Emit { payload, .. } => {
                    self.expr(payload);
                    self.allocate();
                    self.unknown_effects = true;
                }
                Stmt::If {
                    condition,
                    then_body,
                    else_body,
                } => {
                    self.expr(condition);
                    let mut left = self.fork();
                    let mut right = self.fork();
                    let conditional = guard.or(Some(UnresolvedTarget::Conditional));
                    left.statements(then_body, conditional);
                    right.statements(else_body, conditional);
                    self.next = if left.next == right.next {
                        left.next
                    } else {
                        None
                    };
                    for (name, value) in &mut self.env {
                        *value = match (left.env.get(name), right.env.get(name)) {
                            (Some(a), Some(b)) if a == b => a.clone(),
                            _ => Fact::Unknown,
                        };
                    }
                    self.merge_targets(left);
                    self.merge_targets(right);
                    if may_exit(then_body, true) || may_exit(else_body, true) {
                        guard = conditional;
                    }
                }
                Stmt::For {
                    binding,
                    domain,
                    body,
                } => {
                    match domain {
                        LoopDomain::Page(scan) => self.opaque(scan),
                        LoopDomain::DerivedArray { value, .. } => {
                            self.expr(value);
                        }
                        LoopDomain::Recurse(recurse) => {
                            self.expr(&recurse.seed);
                        }
                        _ => {}
                    }
                    let mut repeated = self.fork();
                    repeated.next = None;
                    repeated.env.insert(binding.clone(), Fact::Unknown);
                    repeated.statements(body, Some(UnresolvedTarget::Repeated));
                    // A break/continue may keep an intermediate assignment even
                    // when the final body environment equals the entry one.
                    let mut assigned = BTreeSet::from([binding.as_str()]);
                    assigned_bindings(body, &mut assigned);
                    for (name, value) in &mut self.env {
                        if assigned.contains(name.as_str()) || repeated.env.get(name) != Some(value)
                        {
                            *value = Fact::Unknown;
                        }
                    }
                    if allocates(body) {
                        self.next = None;
                    }
                    self.merge_targets(repeated);
                    if may_exit(body, false) {
                        guard = guard.or(Some(UnresolvedTarget::Conditional));
                    }
                }
            }
        }
    }

    fn fork(&self) -> Self {
        Self {
            env: self.env.clone(),
            primary_indexes: self.primary_indexes.clone(),
            next: self.next,
            ..Self::default()
        }
    }

    fn allocate(&mut self) -> Fact {
        let index = self.next;
        self.next = self.next.and_then(|n| n.checked_add(1));
        index
            .map(|n| Fact::Id(TargetSource::NewId(n)))
            .unwrap_or_default()
    }

    fn expr(&mut self, expr: &Expr) -> Fact {
        match expr {
            Expr::Input(Input::NewId) => self.allocate(),
            Expr::Variable(name) => self.env.get(name).cloned().unwrap_or_default(),
            Expr::Object(fields) => Fact::Object(
                fields
                    .iter()
                    .map(|(name, value)| (name.clone(), self.expr(value)))
                    .collect(),
            ),
            Expr::Field { base, name } => self.expr(base).field(name),
            Expr::Get(read) => {
                let keys: Vec<_> = read.key.iter().map(|key| self.expr(key)).collect();
                if self
                    .primary_indexes
                    .contains(&(read.table.clone(), read.index.clone()))
                    && keys.len() == 1
                {
                    Fact::Object(BTreeMap::from([("id".to_owned(), keys[0].clone())]))
                } else {
                    Fact::Unknown
                }
            }
            Expr::Exists(read) => {
                for key in &read.key {
                    self.expr(key);
                }
                Fact::Unknown
            }
            Expr::Array(values) | Expr::Builtin { args: values, .. } => {
                for value in values {
                    self.expr(value);
                }
                Fact::Unknown
            }
            Expr::Unary { value, .. } => {
                self.expr(value);
                Fact::Unknown
            }
            Expr::Binary { op, left, right } => {
                self.expr(left);
                if matches!(op, BinaryOp::And | BinaryOp::Or) && allocates(right) {
                    self.next = None;
                }
                self.expr(right);
                Fact::Unknown
            }
            Expr::Scan(scan) => {
                self.opaque(scan);
                Fact::Unknown
            }
            Expr::Merge(merge) => {
                self.opaque(merge);
                self.env.clear();
                Fact::Unknown
            }
            _ => Fact::Unknown,
        }
    }

    // Complex collection execution is deliberately not a second evaluator. It
    // poisons later allocation offsets and records any nested write as unknown.
    fn opaque(&mut self, value: &impl Serialize) {
        let value = serde_json::to_value(value).expect("IR serializes");
        self.opaque_value(&value);
    }
    fn opaque_value(&mut self, value: &serde_json::Value) {
        if let Some(object) = value.as_object() {
            if object.get("Input").and_then(|v| v.as_str()) == Some("NewId")
                || object.contains_key("Emit")
            {
                self.next = None;
            }
            for (name, kind) in [
                ("Insert", TargetKind::Create),
                ("Update", TargetKind::Update),
                ("Delete", TargetKind::Remove),
            ] {
                if let Some(table) = object
                    .get(name)
                    .and_then(|v| v.get("table"))
                    .and_then(|v| v.as_str())
                {
                    self.add(table, kind, Fact::Unknown, Some(UnresolvedTarget::Repeated));
                    self.unknown_effects = true;
                }
            }
            if let Some(table) = object
                .get("Upsert")
                .and_then(|v| v.get("table"))
                .and_then(|v| v.as_str())
            {
                self.add(
                    table,
                    TargetKind::Create,
                    Fact::Unknown,
                    Some(UnresolvedTarget::Repeated),
                );
                self.add(
                    table,
                    TargetKind::Update,
                    Fact::Unknown,
                    Some(UnresolvedTarget::Repeated),
                );
            }
            if object.contains_key("Upsert") || object.contains_key("Emit") {
                self.unknown_effects = true;
            }
            for child in object.values() {
                self.opaque_value(child);
            }
        } else if let Some(array) = value.as_array() {
            for child in array {
                self.opaque_value(child);
            }
        }
    }
}

fn allocates<T: Serialize + ?Sized>(value: &T) -> bool {
    fn visit(value: &serde_json::Value) -> bool {
        match value {
            serde_json::Value::Object(fields) => {
                fields.get("Input").and_then(|v| v.as_str()) == Some("NewId")
                    || fields.contains_key("Emit")
                    || fields.values().any(visit)
            }
            serde_json::Value::Array(values) => values.iter().any(visit),
            _ => false,
        }
    }
    visit(&serde_json::to_value(value).expect("IR serializes"))
}
fn assigned_bindings<'a>(body: &'a [Stmt], names: &mut BTreeSet<&'a str>) {
    for stmt in body {
        match stmt {
            Stmt::Const { name, .. }
            | Stmt::Let { name, .. }
            | Stmt::Assign { name, .. }
            | Stmt::Push { target: name, .. } => {
                names.insert(name);
            }
            Stmt::If {
                then_body,
                else_body,
                ..
            } => {
                assigned_bindings(then_body, names);
                assigned_bindings(else_body, names);
            }
            Stmt::For { binding, body, .. } => {
                names.insert(binding);
                assigned_bindings(body, names);
            }
            _ => {}
        }
    }
}

fn may_exit(body: &[Stmt], loop_exits_escape: bool) -> bool {
    body.iter().any(|stmt| match stmt {
        Stmt::Return(_) => true,
        Stmt::Break | Stmt::Continue => loop_exits_escape,
        Stmt::If {
            then_body,
            else_body,
            ..
        } => may_exit(then_body, loop_exits_escape) || may_exit(else_body, loop_exits_escape),
        // Return propagates out of a loop; break and continue are consumed there.
        Stmt::For { body, .. } => may_exit(body, false),
        _ => false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn program(body: serde_json::Value) -> Program {
        serde_json::from_value(json!({
            "name": "test.write", "kind": "Mutation", "read_time_granularity_ms": null,
            "args": { "messageId": { "Ref": { "table": "messages" } }, "first": "Id",
                "second": { "Ref": { "table": "messages" } }, "flag": "Bool" }, "body": body,
        }))
        .unwrap()
    }
    fn targets(body: serde_json::Value) -> MutationTargets {
        let program = program(body);
        derive(&crate::programs::spike_schema(), &program).unwrap()
    }
    fn insert(table: &str) -> serde_json::Value {
        json!({ "Insert": { "table": table, "row": { "Object": { "id": { "Input": "NewId" } } } } })
    }
    fn message(contract: &MutationTargets) -> &MutationTarget {
        contract
            .targets
            .iter()
            .find(|target| target.table == "messages")
            .unwrap()
    }

    #[test]
    fn unrelated_insert_order_and_nonwrite_allocations_change_only_the_derived_offset() {
        let first = targets(json!([insert("messages"), insert("audit")]));
        let reordered = targets(json!([insert("audit"), insert("messages")]));
        assert_eq!(message(&first).source, Some(TargetSource::NewId(0)));
        assert_eq!(message(&reordered).source, Some(TargetSource::NewId(1)));
        let allocated = targets(json!([
            { "Const": { "name": "unused", "value": { "Input": "NewId" } } },
            { "Const": { "name": "row", "value": { "Object": {
                "before": { "Input": "NewId" }, "id": { "Input": "NewId" }
            } } } },
            { "Const": { "name": "alias", "value": { "Variable": "row" } } },
            { "Insert": { "table": "messages", "row": { "Variable": "alias" } } },
        ]));
        assert_eq!(message(&allocated).source, Some(TargetSource::NewId(2)));
    }

    #[test]
    fn conditional_repeated_ambiguous_and_early_return_targets_fail_closed() {
        let conditional = targets(json!([
            { "If": { "condition": { "Variable": "flag" }, "then_body": [insert("audit")], "else_body": [] } },
            insert("messages"),
        ]));
        assert_eq!(
            message(&conditional).unresolved,
            Some(UnresolvedTarget::Computed)
        );
        let repeated = targets(
            json!([{ "For": { "binding": "item", "domain": { "LiteralRange": {
            "start": 0, "end_exclusive": 2
        } }, "body": [insert("messages")] } }]),
        );
        assert_eq!(
            message(&repeated).unresolved,
            Some(UnresolvedTarget::Repeated)
        );
        let ambiguous = targets(json!([insert("messages"), insert("messages")]));
        assert_eq!(
            message(&ambiguous).unresolved,
            Some(UnresolvedTarget::Ambiguous)
        );
        let early = targets(json!([
            { "If": { "condition": { "Variable": "flag" }, "then_body": [{ "Return": { "Literal": "Null" } }], "else_body": [] } },
            insert("messages"),
        ]));
        assert_eq!(
            message(&early).unresolved,
            Some(UnresolvedTarget::Conditional)
        );
        for contract in [conditional, repeated, ambiguous, early] {
            assert!(!contract.complete);
        }
    }

    #[test]
    fn repeated_allocation_does_not_erase_an_argument_address_or_read_alias() {
        let contract = targets(json!([
            { "Const": { "name": "row", "value": { "Get": {
                "site": "get", "table": "messages", "index": "byId", "key": [{ "Variable": "messageId" }], "provenance": "Arg"
            } } } },
            { "For": { "binding": "item", "domain": { "LiteralRange": { "start": 0, "end_exclusive": 2 } }, "body": [insert("deliveries")] } },
            { "Delete": { "table": "messages", "key": { "Field": { "base": { "Variable": "row" }, "name": "id" } } } },
        ]));
        assert_eq!(
            message(&contract).source,
            Some(TargetSource::Argument("messageId".into()))
        );
        assert_eq!(message(&contract).kind, TargetKind::Remove);
        assert!(!contract.complete);
    }

    fn execute_deletion(
        program: &Program,
        expected: impl Fn(bool) -> Vec<&'static str>,
    ) -> MutationTargets {
        use crate::{Actor, Ceilings, Checker, Context, Engine, Index, Value, public_table};
        let schema = Schema {
            tables: BTreeMap::from([(
                "messages".into(),
                public_table(
                    BTreeMap::from([("id".into(), crate::ColumnType::Id)]),
                    BTreeMap::from([(
                        "byId".into(),
                        Index {
                            components: vec![IndexComponent::Column("id".into())],
                            unique: true,
                        },
                    )]),
                ),
            )]),
            ..Schema::default()
        };
        let certificate = Checker::new(&schema, Ceilings::default())
            .check(program)
            .unwrap();
        for flag in [false, true] {
            let mut engine = Engine::memory(schema.clone()).unwrap();
            for id in ["first", "second"] {
                engine
                    .seed(
                        "messages",
                        Value::Row(BTreeMap::from([("id".into(), Value::Id(id.into()))]).into()),
                    )
                    .unwrap();
            }
            let context = Context::mutation(
                Actor::user("tester").unwrap(),
                BTreeMap::from([
                    ("messageId".into(), Value::Id("first".into())),
                    ("first".into(), Value::Id("first".into())),
                    ("second".into(), Value::Id("second".into())),
                    ("flag".into(), Value::Bool(flag)),
                ]),
            );
            let execution = engine.execute(program, &certificate, context).unwrap();
            assert!(matches!(
                execution.state,
                crate::ExecutionState::Committed { .. }
            ));
            let rows = engine.rows("messages").unwrap();
            let remaining = rows
                .iter()
                .map(|row| row.field("id").unwrap().as_str().unwrap())
                .collect::<Vec<_>>();
            assert_eq!(remaining, expected(flag));
        }
        certificate.mutation_targets.unwrap()
    }

    fn loop_exit_invalidates_intermediate_alias(exit: &str) {
        for nested_assignment in [false, true] {
            let assign = json!({ "Assign": { "name": "id", "value": { "Variable": "second" } } });
            let conditional = json!({ "If": { "condition": { "Variable": "flag" },
                "then_body": if nested_assignment { json!([assign, exit]) } else { json!([exit]) },
                "else_body": [] } });
            let mut body = if nested_assignment {
                vec![conditional]
            } else {
                vec![assign, conditional]
            };
            body.push(json!({ "Assign": { "name": "id", "value": { "Variable": "first" } } }));
            let program = program(json!([
                { "Let": { "name": "id", "value": { "Variable": "first" } } },
                { "For": { "binding": "item", "domain": { "LiteralRange": { "start": 0, "end_exclusive": 1 } }, "body": body } },
                { "Delete": { "table": "messages", "key": { "Variable": "id" } } },
            ]));
            let contract =
                execute_deletion(&program, |flag| vec![if flag { "first" } else { "second" }]);
            assert_eq!(
                message(&contract).source,
                None,
                "{exit}, nested assignment: {nested_assignment}"
            );
            assert_eq!(
                message(&contract).unresolved,
                Some(UnresolvedTarget::Computed)
            );
            assert!(!contract.complete);
        }
    }

    #[test]
    fn loop_break_does_not_prove_the_overwritten_final_alias() {
        loop_exit_invalidates_intermediate_alias("Break");
    }

    #[test]
    fn loop_continue_does_not_prove_the_overwritten_final_alias() {
        loop_exit_invalidates_intermediate_alias("Continue");
    }

    #[test]
    fn conditional_escaping_exits_make_later_writes_conditional() {
        for exit in ["Break", "Continue"] {
            let conditional = json!({ "If": { "condition": { "Variable": "flag" }, "then_body": [exit], "else_body": [] } });
            let delete =
                json!({ "Delete": { "table": "messages", "key": { "Variable": "first" } } });
            let escaped = execute_deletion(&program(json!([conditional, delete])), |flag| {
                if flag {
                    vec!["first", "second"]
                } else {
                    vec!["second"]
                }
            });
            assert_eq!(
                message(&escaped).unresolved,
                Some(UnresolvedTarget::Conditional),
                "{exit}"
            );
            assert!(!escaped.complete);
            let consumed = execute_deletion(
                &program(json!([
                    { "For": { "binding": "item", "domain": { "LiteralRange": { "start": 0, "end_exclusive": 1 } }, "body": [conditional] } }, delete,
                ])),
                |_| vec!["second"],
            );
            assert_eq!(
                message(&consumed).source,
                Some(TargetSource::Argument("first".into()))
            );
            assert!(consumed.complete);
        }
    }

    #[test]
    fn branch_assignment_and_short_circuit_allocation_do_not_leave_old_aliases() {
        let branch = targets(json!([
            { "Let": { "name": "id", "value": { "Variable": "messageId" } } },
            { "If": { "condition": { "Variable": "flag" }, "then_body": [
                { "Assign": { "name": "id", "value": { "Input": "NewId" } } }
            ], "else_body": [] } },
            { "Delete": { "table": "messages", "key": { "Variable": "id" } } },
        ]));
        assert_eq!(
            message(&branch).unresolved,
            Some(UnresolvedTarget::Computed)
        );
        let short = targets(json!([
            { "Require": { "code": "CHECK", "condition": { "Binary": { "op": "Or", "left": { "Variable": "flag" }, "right": {
                "Binary": { "op": "Eq", "left": { "Input": "NewId" }, "right": { "Variable": "messageId" } }
            } } } } }, insert("messages"),
        ]));
        assert_eq!(message(&short).unresolved, Some(UnresolvedTarget::Computed));
    }

    #[test]
    fn a_primary_read_is_proved_by_the_schema_not_the_index_name() {
        let mut schema = crate::programs::spike_schema();
        let program: Program = serde_json::from_value(json!({
            "name": "test.remove", "kind": "Mutation", "args": { "messageId": "Id" },
            "read_time_granularity_ms": null, "body": [{ "Delete": { "table": "messages", "key": {
                "Field": { "name": "id", "base": { "Get": {
                    "site": "read", "table": "messages", "index": "byId", "key": [{ "Variable": "messageId" }], "provenance": "Arg"
                } } }
            } } }]
        })).unwrap();
        assert_eq!(
            message(&derive(&schema, &program).unwrap()).source,
            Some(TargetSource::Argument("messageId".into()))
        );
        let index = schema
            .tables
            .get_mut("messages")
            .unwrap()
            .indexes
            .get_mut("byId")
            .unwrap();
        index.components = vec![IndexComponent::Column("authorId".into())];
        assert_eq!(
            message(&derive(&schema, &program).unwrap()).unresolved,
            Some(UnresolvedTarget::Computed)
        );
    }
}
