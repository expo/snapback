use crate::ir::*;
use crate::schema::{RuleExpr, RuleTerm, Schema};
use crate::value::{canonical_json, digest, Value, ValueError};
use serde::Deserialize;
use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet};

const FIRST_REPLAY: &str = include_str!("../corpus/scenario-hydrate.json");

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReplayCase {
    schema: Schema,
    program: Program,
    context: ReplayContext,
    receipt: Receipt,
    expected: Expected,
}

#[derive(Clone, Deserialize)]
struct ReplayContext {
    viewer: String,
    args: BTreeMap<String, Value>,
}

#[derive(Deserialize)]
struct Receipt {
    rows: Vec<RowRecord>,
}

#[derive(Deserialize)]
struct RowRecord {
    table: String,
    row: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Expected {
    canonical_result: String,
    digest: String,
}

struct MemoryStore {
    rows: BTreeMap<String, BTreeMap<String, Value>>,
}

impl MemoryStore {
    fn from_receipt(receipt: Receipt) -> Result<Self, ValueError> {
        let mut rows = BTreeMap::<String, BTreeMap<String, Value>>::new();
        for record in receipt.rows {
            let id = record.row.field("id")?.as_str()?.to_owned();
            rows.entry(record.table).or_default().insert(id, record.row);
        }
        Ok(Self { rows })
    }

    fn lookup(&self, schema: &Schema, table: &str, index: &str, key: &[Value]) -> Option<Value> {
        let index = schema.table(table)?.index(index)?;
        self.rows.get(table)?.values().find_map(|row| {
            let values = index
                .columns
                .iter()
                .map(|column| row.field(column).cloned().unwrap_or(Value::Null))
                .collect::<Vec<_>>();
            (values == key).then(|| row.clone())
        })
    }

    #[allow(clippy::too_many_arguments)]
    fn scan(
        &self,
        schema: &Schema,
        table: &str,
        index: &str,
        prefix: &[Value],
        after: Option<&Value>,
        before: Option<&Value>,
        order: Order,
        limit: usize,
    ) -> Vec<Value> {
        let Some(index) = schema.table(table).and_then(|table| table.index(index)) else {
            return Vec::new();
        };
        let mut rows = self
            .rows
            .get(table)
            .into_iter()
            .flat_map(|rows| rows.values())
            .filter(|row| {
                let values = index
                    .columns
                    .iter()
                    .map(|column| row.field(column).cloned().unwrap_or(Value::Null))
                    .collect::<Vec<_>>();
                if !values.starts_with(prefix) {
                    return false;
                }
                let Some(value) = values.get(prefix.len()) else {
                    return true;
                };
                after.is_none_or(|after| value.total_cmp(after) == Ordering::Greater)
                    && before.is_none_or(|before| value.total_cmp(before) == Ordering::Less)
            })
            .cloned()
            .collect::<Vec<_>>();
        rows.sort_by(|left, right| {
            let mut compared = Ordering::Equal;
            for column in &index.columns {
                compared = left
                    .field(column)
                    .unwrap_or(&Value::Null)
                    .total_cmp(right.field(column).unwrap_or(&Value::Null));
                if compared != Ordering::Equal {
                    break;
                }
            }
            if compared == Ordering::Equal {
                compared = left
                    .field("id")
                    .expect("receipt row id")
                    .total_cmp(right.field("id").expect("receipt row id"));
            }
            if order == Order::Desc {
                compared.reverse()
            } else {
                compared
            }
        });
        rows.truncate(limit);
        rows
    }
}

struct Runner<'a> {
    schema: &'a Schema,
    store: &'a MemoryStore,
    context: ReplayContext,
    env: BTreeMap<String, Value>,
    consts: BTreeSet<String>,
}

enum Flow {
    Next,
    Break,
    Continue,
    Return(Value),
}

impl<'a> Runner<'a> {
    fn new(schema: &'a Schema, store: &'a MemoryStore, context: ReplayContext) -> Self {
        Self {
            schema,
            store,
            env: context.args.clone(),
            context,
            consts: BTreeSet::new(),
        }
    }

    fn execute(&mut self, program: &Program) -> Result<Value, String> {
        match self.statements(&program.body)? {
            Flow::Return(value) => Ok(value),
            _ => Ok(Value::Null),
        }
    }

    fn statements(&mut self, statements: &[Stmt]) -> Result<Flow, String> {
        for statement in statements {
            let flow = match statement {
                Stmt::Const { name, value } => {
                    let value = self.expr(value)?;
                    self.env.insert(name.clone(), value);
                    self.consts.insert(name.clone());
                    Flow::Next
                }
                Stmt::Let { name, value } => {
                    let value = self.expr(value)?;
                    self.env.insert(name.clone(), value);
                    Flow::Next
                }
                Stmt::Assign { name, value } => {
                    if self.consts.contains(name) {
                        return Err("assign to const".to_owned());
                    }
                    let value = self.expr(value)?;
                    self.env.insert(name.clone(), value);
                    Flow::Next
                }
                Stmt::Push { target, value } => {
                    let value = self.expr(value)?;
                    let Some(Value::Array(target)) = self.env.get_mut(target) else {
                        return Err("push target".to_owned());
                    };
                    target.push(value);
                    Flow::Next
                }
                Stmt::If {
                    condition,
                    then_body,
                    else_body,
                } => {
                    let branch = if self.expr(condition)?.as_bool().map_err(show)? {
                        then_body
                    } else {
                        else_body
                    };
                    self.statements(branch)?
                }
                Stmt::For {
                    binding,
                    domain,
                    body,
                } => {
                    let mut result = Flow::Next;
                    for value in self.domain(domain)? {
                        self.env.insert(binding.clone(), value);
                        match self.statements(body)? {
                            Flow::Next | Flow::Continue => {}
                            Flow::Break => break,
                            returned @ Flow::Return(_) => {
                                result = returned;
                                break;
                            }
                        }
                    }
                    result
                }
                Stmt::Require { condition, .. } => {
                    if !self.expr(condition)?.as_bool().map_err(show)? {
                        return Err("require".to_owned());
                    }
                    Flow::Next
                }
                Stmt::Return(value) => Flow::Return(self.expr(value)?),
                Stmt::Break => Flow::Break,
                Stmt::Continue => Flow::Continue,
                _ => return Err("write in hydration replay".to_owned()),
            };
            if !matches!(flow, Flow::Next) {
                return Ok(flow);
            }
        }
        Ok(Flow::Next)
    }

    fn domain(&mut self, domain: &LoopDomain) -> Result<Vec<Value>, String> {
        match domain {
            LoopDomain::Page(scan) => self
                .scan(scan)?
                .as_array()
                .map(ToOwned::to_owned)
                .map_err(show),
            LoopDomain::LiteralRange {
                start,
                end_exclusive,
            } => (*start..*end_exclusive)
                .map(|value| Value::int(value as i128).map_err(show))
                .collect(),
            LoopDomain::ArgList { name, max } => {
                let values = self
                    .env
                    .get(name)
                    .ok_or_else(|| "arg list".to_owned())?
                    .as_array()
                    .map_err(show)?
                    .to_vec();
                if values.len() > *max as usize {
                    return Err("fanout".to_owned());
                }
                Ok(values)
            }
            LoopDomain::DerivedArray { value, max, .. } => {
                let values = self.expr(value)?.as_array().map_err(show)?.to_vec();
                if values.len() > *max as usize {
                    return Err("fanout".to_owned());
                }
                Ok(values)
            }
            LoopDomain::Recurse(_) => Err("recurse not needed by first replay".to_owned()),
        }
    }

    fn expr(&mut self, expression: &Expr) -> Result<Value, String> {
        match expression {
            Expr::Literal(value) => Ok(value.clone()),
            Expr::Variable(name) => self
                .env
                .get(name)
                .cloned()
                .ok_or_else(|| format!("unknown {name}")),
            Expr::Input(Input::Viewer) => Ok(Value::Id(self.context.viewer.clone())),
            Expr::Input(_) => Err("unpinned input".to_owned()),
            Expr::Field { base, name } => self.expr(base)?.field(name).cloned().map_err(show),
            Expr::Array(values) => values
                .iter()
                .map(|value| self.expr(value))
                .collect::<Result<Vec<_>, _>>()
                .map(Value::Array),
            Expr::Object(values) => values
                .iter()
                .map(|(key, value)| Ok((key.clone(), self.expr(value)?)))
                .collect::<Result<BTreeMap<_, _>, _>>()
                .map(Value::Row),
            Expr::Binary { op, left, right } => {
                let left = self.expr(left)?;
                let right = self.expr(right)?;
                match op {
                    BinaryOp::Eq => Ok(Value::Bool(left == right)),
                    BinaryOp::Ne => Ok(Value::Bool(left != right)),
                    _ => Err("binary not needed by first replay".to_owned()),
                }
            }
            Expr::Unary { .. } => Err("unary not needed by first replay".to_owned()),
            Expr::Builtin { builtin, args } => {
                let args = args
                    .iter()
                    .map(|value| self.expr(value))
                    .collect::<Result<Vec<_>, _>>()?;
                self.builtin(builtin, args)
            }
            Expr::Get(read) => self.get(read),
            Expr::Exists(read) => Ok(Value::Bool(self.get(read)? != Value::Null)),
            Expr::Scan(scan) => self.scan(scan),
        }
    }

    fn builtin(&self, builtin: &Builtin, mut args: Vec<Value>) -> Result<Value, String> {
        match builtin {
            Builtin::MentionTokens => {
                let text = args.remove(0).as_str().map_err(show)?.to_owned();
                let mut seen = BTreeSet::new();
                Ok(Value::Array(
                    text.split_whitespace()
                        .filter_map(|word| word.strip_prefix('@'))
                        .map(|word| word.trim_matches(|c: char| !c.is_alphanumeric() && c != '_'))
                        .filter(|word| !word.is_empty())
                        .filter(|word| seen.insert((*word).to_owned()))
                        .map(|word| Value::String(word.to_owned()))
                        .collect(),
                ))
            }
            _ => Err("builtin not needed by first replay".to_owned()),
        }
    }

    fn get(&mut self, read: &Read) -> Result<Value, String> {
        let key = read
            .key
            .iter()
            .map(|value| self.expr(value))
            .collect::<Result<Vec<_>, _>>()?;
        let Some(row) = self
            .store
            .lookup(self.schema, &read.table, &read.index, &key)
        else {
            return Ok(Value::Null);
        };
        Ok(if self.check_read_rule(&read.table, &row)? {
            row
        } else {
            Value::Null
        })
    }

    fn scan(&mut self, scan: &Scan) -> Result<Value, String> {
        let prefix = scan
            .prefix
            .iter()
            .map(|value| self.expr(value))
            .collect::<Result<Vec<_>, _>>()?;
        let after = scan
            .after
            .as_deref()
            .map(|value| self.expr(value))
            .transpose()?;
        let before = scan
            .before
            .as_deref()
            .map(|value| self.expr(value))
            .transpose()?;
        let take = match scan.take {
            Bound::Literal(value) => value as usize,
            Bound::Arg { .. } => return Err("arg take not needed by first replay".to_owned()),
        };
        let rows = self.store.scan(
            self.schema,
            &scan.table,
            &scan.index,
            &prefix,
            after.as_ref(),
            before.as_ref(),
            scan.order,
            take + 2,
        );
        let visible = rows
            .into_iter()
            .filter_map(|row| {
                self.check_read_rule(&scan.table, &row)
                    .ok()
                    .and_then(|visible| visible.then_some(row))
            })
            .take(take)
            .collect();
        Ok(Value::Array(visible))
    }

    fn check_read_rule(&self, table: &str, row: &Value) -> Result<bool, String> {
        let rule = &self
            .schema
            .table(table)
            .ok_or_else(|| "table".to_owned())?
            .rules
            .read;
        self.rule(rule, row)
    }

    fn rule(&self, rule: &RuleExpr, row: &Value) -> Result<bool, String> {
        match rule {
            RuleExpr::Public { .. } | RuleExpr::Allow => Ok(true),
            RuleExpr::Deny => Ok(false),
            RuleExpr::Eq(left, right) => {
                Ok(self.rule_term(left, row)? == self.rule_term(right, row)?)
            }
            RuleExpr::Ne(left, right) => {
                Ok(self.rule_term(left, row)? != self.rule_term(right, row)?)
            }
            RuleExpr::And(rules) => {
                for rule in rules {
                    if !self.rule(rule, row)? {
                        return Ok(false);
                    }
                }
                Ok(true)
            }
            RuleExpr::Or(rules) => {
                for rule in rules {
                    if self.rule(rule, row)? {
                        return Ok(true);
                    }
                }
                Ok(false)
            }
            RuleExpr::Not(rule) => Ok(!self.rule(rule, row)?),
            RuleExpr::Exists {
                table, index, key, ..
            } => {
                let key = key
                    .iter()
                    .map(|term| self.rule_term(term, row))
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(self.store.lookup(self.schema, table, index, &key).is_some())
            }
            RuleExpr::PrincipalKind(_) => Ok(false),
        }
    }

    fn rule_term(&self, term: &RuleTerm, row: &Value) -> Result<Value, String> {
        match term {
            RuleTerm::Field(name) => row.field(name).cloned().map_err(show),
            RuleTerm::Viewer => Ok(Value::Id(self.context.viewer.clone())),
            RuleTerm::Literal(value) => Ok(value.clone()),
        }
    }
}

fn show(error: ValueError) -> String {
    error.to_string()
}

#[no_mangle]
pub extern "C" fn replay_first() -> i32 {
    let Ok(case) = serde_json::from_str::<ReplayCase>(FIRST_REPLAY) else {
        return 0;
    };
    let Ok(store) = MemoryStore::from_receipt(case.receipt) else {
        return 0;
    };
    let Ok(result) = Runner::new(&case.schema, &store, case.context).execute(&case.program) else {
        return 0;
    };
    i32::from(
        canonical_json(&result) == case.expected.canonical_result
            && digest(&result) == case.expected.digest,
    )
}
