//! `deliver`: per-recipient custody derived from one declaration on the
//! content table. The engine owns the generated log and receipts table: their
//! shapes are functions of the declaration, they are never authored, and no
//! program writes them (LLP 1019 §1–§2).
// @ref LLP 1019#2-the-custody-log — the log is custody, not a projection: an
// ordinary durable table outside `Schema.maintains`, so a successor sees its
// addition and nothing rebuilds it from current membership.

use crate::schema::{
    ColumnType, Constraint, Index, IndexComponent, RetentionPolicy, RuleExpr, RuleTerm, Rules,
    Schema, Table, Tombstone,
};
use crate::value::{Value, digest, object};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

/// The event kinds a log records for one content row, to its original recipients.
pub const EVENT_KINDS: [&str; 3] = ["delivered", "changed", "removed"];
const LOG_COLUMNS: [&str; 8] = [
    "id",
    "recipient",
    "row",
    "incarnation",
    "kind",
    "audience",
    "seq",
    "at",
];
const RECEIPT_COLUMNS: [&str; 5] = ["id", "row", "recipient", "received", "seq"];

/// The prefix keys pin no capped group of the target (family `bound`).
pub const UNBOUNDED: &str = "E_DELIVER_UNBOUNDED";
/// The target's principal column is absent or ambiguous (family `schema`).
pub const PRINCIPAL: &str = "E_DELIVER_PRINCIPAL";
/// A raw schema's declaration or generated table is not the canonical form,
/// or a program writes a generated table (family `schema`).
pub const SHAPE: &str = "E_SCHEMA_DELIVER";

/// `deliver to <target>[<prefix>] [by .<principal>] as <log> [with receipts] [bootstrap]`
/// on a content table, resolved: the compiler picks the principal column; raw
/// IR names it. The audience bound `A` is not here: it is an engine fact
/// (`audience_bound`), never spelled and never hashed.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Deliver {
    /// The table whose rows carry the recipients.
    pub target: String,
    /// Content columns that pin one capped group of `target`, positionally
    /// against that group's `cap N by` columns.
    pub prefix: Vec<String>,
    /// The target's principal column each recipient is read from.
    pub principal: String,
    /// The generated log's name (`as <name>`).
    pub log: String,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub receipts: bool,
    /// Fan out `delivered` events to current members when the log is
    /// installed over existing content rows; inert afterwards.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub bootstrap: bool,
}

impl Deliver {
    pub fn receipts_table(&self) -> Option<String> {
        self.receipts.then(|| format!("{}Receipts", self.log))
    }

    /// The engine-owned tables this declaration generates.
    pub fn generated(&self) -> Vec<String> {
        std::iter::once(self.log.clone())
            .chain(self.receipts_table())
            .collect()
    }

    /// The declaration as one Quarry line, for rewrites.
    pub fn line(&self, principal: Option<&str>) -> String {
        let prefix = self
            .prefix
            .iter()
            .map(|column| format!(".{column}"))
            .collect::<Vec<_>>()
            .join(", ");
        let by = principal
            .map(|column| format!(" by .{column}"))
            .unwrap_or_default();
        let receipts = if self.receipts { " with receipts" } else { "" };
        let bootstrap = if self.bootstrap { " bootstrap" } else { "" };
        format!(
            "deliver to {}[{prefix}]{by} as {}{receipts}{bootstrap}",
            self.target, self.log
        )
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Generated {
    Log,
    Receipts,
}

/// `(content table, its table, its declaration)` for every table carrying `deliver`.
pub fn declarations(schema: &Schema) -> impl Iterator<Item = (&str, &Table, &Deliver)> {
    schema.tables.iter().filter_map(|(name, table)| {
        table
            .deliver
            .as_ref()
            .map(|deliver| (name.as_str(), table, deliver))
    })
}

/// The declaration owning `table` when it is a generated log or receipts table.
pub fn owner<'a>(schema: &'a Schema, table: &str) -> Option<(&'a str, &'a Deliver, Generated)> {
    declarations(schema).find_map(|(content, _, deliver)| {
        if deliver.log == table {
            Some((content, deliver, Generated::Log))
        } else if deliver.receipts_table().as_deref() == Some(table) {
            Some((content, deliver, Generated::Receipts))
        } else {
            None
        }
    })
}

// @ref LLP 1019#1-the-declaration — the pinned group is the cap whose `by`
// tuple equals the prefix column names, never the first cap of the same
// arity: two same-typed caps would otherwise bind an unrelated `N`.
/// The `N` of the target's `cap N by <the prefix columns>`.
pub fn group_cap(target: &Table, prefix: &[String]) -> Option<u32> {
    target.constraints.iter().find_map(|constraint| match constraint {
        Constraint::Cap { by, max } if by == prefix => Some(*max),
        _ => None,
    })
}

/// The `_meta` key prefix under which the engine records each log's audience bound.
pub const AUDIENCE_META_PREFIX: &str = "custody_audience:";

// @ref LLP 1019#4-certification — `A = max(target cap, largest stored delivered
// audience)` is recomputed at every installation and persisted as an engine
// fact: it is not in the schema, so lowering the cap is an ordinary successor
// and the certificate's schema hash stays the compiler's.
/// The audience bound `A` the engine recorded for `log`, if the log is installed.
pub fn audience_bound(store: &crate::store::Store, log: &str) -> Result<Option<u32>, crate::RuntimeError> {
    Ok(store
        .meta(&format!("{AUDIENCE_META_PREFIX}{log}"))?
        .and_then(|value| value.parse().ok()))
}

fn index(columns: &[&str], unique: bool) -> Index {
    Index {
        components: columns
            .iter()
            .map(|column| IndexComponent::Column((*column).to_owned()))
            .collect(),
        unique,
    }
}

fn deny() -> Rules {
    Rules {
        read: RuleExpr::Deny,
        insert: RuleExpr::Deny,
        update: RuleExpr::Deny,
        delete: RuleExpr::Deny,
    }
}

/// The canonical log shape for `content` under `deliver`; `None` when a prefix
/// column is missing or collides with a log column (reported as an issue).
pub fn log_table(schema: &Schema, content: &str, deliver: &Deliver) -> Option<Table> {
    let content_table = schema.tables.get(content)?;
    let mut columns = BTreeMap::from([
        ("id".to_owned(), ColumnType::Id),
        ("recipient".to_owned(), ColumnType::Principal),
        (
            "row".to_owned(),
            ColumnType::Ref {
                table: content.to_owned(),
            },
        ),
        ("incarnation".to_owned(), ColumnType::Int),
        (
            "kind".to_owned(),
            ColumnType::Enum {
                variants: EVENT_KINDS.map(str::to_owned).to_vec(),
            },
        ),
        ("audience".to_owned(), ColumnType::Int),
        ("seq".to_owned(), ColumnType::Int),
        ("at".to_owned(), ColumnType::Time),
    ]);
    for column in &deliver.prefix {
        if LOG_COLUMNS.contains(&column.as_str()) {
            return None;
        }
        columns.insert(column.clone(), content_table.columns.get(column)?.clone());
    }
    let mut group = vec!["recipient"];
    group.extend(deliver.prefix.iter().map(String::as_str));
    group.extend(["kind", "seq", "id"]);
    Some(Table {
        constraints: vec![Constraint::Immutable {
            fields: columns.keys().filter(|c| *c != "id").cloned().collect(),
        }],
        columns,
        indexes: BTreeMap::from([
            ("byId".to_owned(), index(&["id"], true)),
            (
                "byRecipient".to_owned(),
                index(&["recipient", "seq", "id"], false),
            ),
            ("byRecipientGroup".to_owned(), index(&group, false)),
            // @ref LLP 1019#mechanism--decided-by-p0-2026-09-10 — `(row, kind, recipient)`:
            // historical fan-out seeks `(row, 'delivered')`, which `A` bounds; an
            // all-kind scan would include unbounded `changed` events.
            (
                "byRow".to_owned(),
                index(&["row", "kind", "recipient"], false),
            ),
        ]),
        rules: Rules {
            read: RuleExpr::Eq(RuleTerm::Field("recipient".to_owned()), RuleTerm::Viewer),
            ..deny()
        },
        retain: RetentionPolicy::UntilRevoked,
        // @ref LLP 1019#3-what-writes-it — the `removed` event is the tombstone;
        // the twin's swap rule 3 applies with no authored declaration.
        tombstones: vec![Tombstone {
            table: content.to_owned(),
            column: "row".to_owned(),
            when: RuleExpr::Eq(
                RuleTerm::Field("kind".to_owned()),
                RuleTerm::Literal(Value::String("removed".to_owned())),
            ),
        }],
        deliver: None,
    })
}

/// The canonical receipts shape: `row`, `recipient`, `received`, `seq`, plus
/// every content column the content read rule reads, so that rule can be
/// inherited table-wide with `.id` rewritten to `.row` (LLP 1019 §6).
pub fn receipts_table(schema: &Schema, content: &str, deliver: &Deliver) -> Option<Table> {
    deliver.receipts_table()?;
    let content_table = schema.tables.get(content)?;
    let mut columns = BTreeMap::from([
        ("id".to_owned(), ColumnType::Id),
        (
            "row".to_owned(),
            ColumnType::Ref {
                table: content.to_owned(),
            },
        ),
        ("recipient".to_owned(), ColumnType::Principal),
        ("received".to_owned(), ColumnType::Bool),
        ("seq".to_owned(), ColumnType::Int),
    ]);
    let mut fields = BTreeSet::new();
    rule_fields(&content_table.rules.read, &mut fields);
    for field in fields {
        if field == "id" {
            continue;
        }
        if RECEIPT_COLUMNS.contains(&field.as_str()) {
            return None;
        }
        columns.insert(field.clone(), content_table.columns.get(&field)?.clone());
    }
    Some(Table {
        columns,
        indexes: BTreeMap::from([
            ("byId".to_owned(), index(&["id"], true)),
            ("byRow".to_owned(), index(&["row", "recipient"], true)),
        ]),
        rules: Rules {
            read: rewrite_id_to_row(&content_table.rules.read),
            ..deny()
        },
        constraints: vec![
            Constraint::Unique {
                index: "byRow".to_owned(),
            },
            Constraint::Immutable {
                fields: vec!["recipient".to_owned(), "row".to_owned()],
            },
        ],
        retain: RetentionPolicy::UntilRevoked,
        tombstones: Vec::new(),
        deliver: None,
    })
}

/// Every `.field` a read rule reads, on any probe key or comparison.
pub fn rule_fields(rule: &RuleExpr, out: &mut BTreeSet<String>) {
    let term = |term: &RuleTerm, out: &mut BTreeSet<String>| {
        if let RuleTerm::Field(field) = term {
            out.insert(field.clone());
        }
    };
    match rule {
        RuleExpr::Public { .. } | RuleExpr::Allow | RuleExpr::Deny => {}
        RuleExpr::Eq(left, right) | RuleExpr::Ne(left, right) => {
            term(left, out);
            term(right, out);
        }
        RuleExpr::And(items) | RuleExpr::Or(items) => {
            for item in items {
                rule_fields(item, out);
            }
        }
        RuleExpr::Not(inner) => rule_fields(inner, out),
        RuleExpr::Exists { key, .. } | RuleExpr::Created { key, .. } => {
            for item in key {
                term(item, out);
            }
        }
    }
}

fn rewrite_id_to_row(rule: &RuleExpr) -> RuleExpr {
    let term = |term: &RuleTerm| match term {
        RuleTerm::Field(field) if field == "id" => RuleTerm::Field("row".to_owned()),
        other => other.clone(),
    };
    match rule {
        RuleExpr::Public { .. } | RuleExpr::Allow | RuleExpr::Deny => rule.clone(),
        RuleExpr::Eq(left, right) => RuleExpr::Eq(term(left), term(right)),
        RuleExpr::Ne(left, right) => RuleExpr::Ne(term(left), term(right)),
        RuleExpr::And(items) => RuleExpr::And(items.iter().map(rewrite_id_to_row).collect()),
        RuleExpr::Or(items) => RuleExpr::Or(items.iter().map(rewrite_id_to_row).collect()),
        RuleExpr::Not(inner) => RuleExpr::Not(Box::new(rewrite_id_to_row(inner))),
        RuleExpr::Exists {
            table,
            index,
            key,
            provenance,
        } => RuleExpr::Exists {
            table: table.clone(),
            index: index.clone(),
            key: key.iter().map(term).collect(),
            provenance: *provenance,
        },
        RuleExpr::Created {
            table,
            index,
            key,
            provenance,
        } => RuleExpr::Created {
            table: table.clone(),
            index: index.clone(),
            key: key.iter().map(term).collect(),
            provenance: *provenance,
        },
    }
}

// @ref LLP 1019#7-the-twin — repeated events for one row in one commit need
// distinct identities: the digest takes the commit's per-event ordinal.
/// One event row of a log: the identity is a digest of the content row, the
/// recipient, the kind, the commit, and the event's ordinal within that
/// commit, so repeated changes in one commit or across commits never collide
/// and the twin can derive the sender's own event.
#[allow(clippy::too_many_arguments)]
pub fn event_row(
    content_row: &Value,
    deliver: &Deliver,
    recipient: &str,
    kind: &str,
    incarnation: i64,
    audience: i64,
    seq: i64,
    ordinal: u32,
    at: i64,
) -> Result<Value, crate::RuntimeError> {
    let row_id = content_row.field("id")?.clone();
    let mut fields: Vec<(String, Value)> = vec![
        (
            "id".to_owned(),
            Value::Id(digest(&(&row_id, recipient, kind, seq, ordinal))),
        ),
        ("recipient".to_owned(), Value::Id(recipient.to_owned())),
        ("row".to_owned(), row_id),
        ("incarnation".to_owned(), Value::Int(incarnation)),
        ("kind".to_owned(), Value::String(kind.to_owned())),
        ("audience".to_owned(), Value::Int(audience)),
        ("seq".to_owned(), Value::Int(seq)),
        ("at".to_owned(), Value::Int(at)),
    ];
    for column in &deliver.prefix {
        fields.push((column.clone(), content_row.field(column)?.clone()));
    }
    Ok(object(fields))
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DeliveryIssue {
    /// The content table whose declaration is refused.
    pub table: String,
    pub code: &'static str,
    pub message: String,
    pub rewrite: String,
}

// @ref LLP 1019#1-the-declaration — the raw-schema form admits the same
// declaration under the same refusals as Quarry, and the generated tables must
// be exactly the engine's shape: ownership is decided here, before any
// generation can carry an authored look-alike.
/// Validate every `deliver` declaration and the tables it generates.
pub fn delivery_issues(schema: &Schema) -> Vec<DeliveryIssue> {
    let mut issues = Vec::new();
    let mut claims = BTreeMap::<String, Vec<String>>::new();
    for (content, _, deliver) in declarations(schema) {
        for name in deliver.generated() {
            claims.entry(name).or_default().push(content.to_owned());
        }
    }
    for (content, content_table, deliver) in declarations(schema) {
        let mut refuse = |code: &'static str, message: String, rewrite: String| {
            issues.push(DeliveryIssue {
                table: content.to_owned(),
                code,
                message,
                rewrite,
            });
        };
        let line = deliver.line(Some(&deliver.principal));
        for name in deliver.generated() {
            let owners = &claims[&name];
            if owners.len() > 1 {
                refuse(
                    SHAPE,
                    format!(
                        "deliver as {}: {name} is generated by both {}",
                        deliver.log,
                        owners.join(" and ")
                    ),
                    format!("give each deliver line its own as <name>: {line}"),
                );
            }
            if name == content || name == deliver.target {
                refuse(
                    SHAPE,
                    format!("deliver as {name} names the content or target table"),
                    format!("choose a new name for the generated log: {line}"),
                );
            }
        }
        if deliver.prefix.is_empty() {
            refuse(
                SHAPE,
                format!("deliver to {} needs at least one prefix key", deliver.target),
                deliver.line(Some(&deliver.principal)),
            );
        }
        let Some(target) = schema
            .tables
            .get(&deliver.target)
            .filter(|_| deliver.target != crate::CONNECTED_TABLE)
        else {
            refuse(
                SHAPE,
                format!("deliver names unknown target table {}", deliver.target),
                format!("deliver to a declared table: {line}"),
            );
            continue;
        };
        if owner(schema, &deliver.target).is_some() {
            refuse(
                SHAPE,
                format!(
                    "deliver to {}: an engine-owned custody table cannot be a target",
                    deliver.target
                ),
                format!("deliver to the table that carries the recipients: {line}"),
            );
            continue;
        }
        let mut prefix_ok = true;
        for column in &deliver.prefix {
            if LOG_COLUMNS.contains(&column.as_str()) {
                prefix_ok = false;
                refuse(
                    SHAPE,
                    format!("prefix key .{column} collides with a log column of the same name"),
                    format!("rename {content}.{column}, then {line}"),
                );
            } else if !content_table.columns.contains_key(column) {
                prefix_ok = false;
                refuse(
                    SHAPE,
                    format!("prefix key .{column} is not a column of {content}"),
                    format!(
                        "use columns of {content}: {}",
                        content_table
                            .columns
                            .keys()
                            .filter(|name| *name != "id")
                            .cloned()
                            .collect::<Vec<_>>()
                            .join(", ")
                    ),
                );
            }
        }
        let by = deliver.prefix.join(", ");
        let Some(max) = group_cap(target, &deliver.prefix) else {
            refuse(
                UNBOUNDED,
                format!(
                    "deliver to {}[{}] pins no capped group: {} has no cap N by {by}",
                    deliver.target,
                    deliver
                        .prefix
                        .iter()
                        .map(|column| format!(".{column}"))
                        .collect::<Vec<_>>()
                        .join(", "),
                    deliver.target,
                ),
                format!("cap 50 by {by}"),
            );
            continue;
        };
        if prefix_ok {
            for column in &deliver.prefix {
                let content_type = &content_table.columns[column];
                let target_type = target.columns.get(column);
                if target_type != Some(content_type) {
                    refuse(
                        SHAPE,
                        format!(
                            "prefix key .{column} ({content_type}) does not match {}.{column} ({}) in cap {max} by {by}",
                            deliver.target,
                            target_type
                                .map(ToString::to_string)
                                .unwrap_or_else(|| "missing".to_owned()),
                        ),
                        format!("pin the cap's columns with content columns of the same type: {line}"),
                    );
                }
            }
        }
        if crate::cap::enforcement_index(target, &deliver.prefix).is_none() {
            refuse(
                UNBOUNDED,
                format!(
                    "cap {max} by {by} on {} has no index whose leading columns are {by}",
                    deliver.target,
                ),
                format!("by byGroup: {by}, {}", deliver.principal),
            );
        }
        let principals = target
            .columns
            .iter()
            .filter(|(_, kind)| **kind == ColumnType::Principal)
            .map(|(name, _)| name.clone())
            .collect::<Vec<_>>();
        if target.columns.get(&deliver.principal) != Some(&ColumnType::Principal) {
            refuse(
                PRINCIPAL,
                match target.columns.get(&deliver.principal) {
                    Some(kind) => format!(
                        "deliver by .{}: {}.{} is {kind}, not principal",
                        deliver.principal, deliver.target, deliver.principal
                    ),
                    None => format!(
                        "deliver by .{}: {} has no such column",
                        deliver.principal, deliver.target
                    ),
                },
                match principals.first() {
                    Some(column) => deliver.line(Some(column)),
                    None => format!(
                        "declare a principal column on {} and name it: {}",
                        deliver.target,
                        deliver.line(Some("principal"))
                    ),
                },
            );
        }
        let expected = [
            (deliver.log.clone(), log_table(schema, content, deliver)),
            (
                deliver.receipts_table().unwrap_or_default(),
                receipts_table(schema, content, deliver),
            ),
        ];
        for (name, expected) in expected {
            if name.is_empty() {
                continue;
            }
            let Some(expected) = expected else {
                if prefix_ok {
                    refuse(
                        SHAPE,
                        format!(
                            "{name} cannot be derived: {content}'s read rule reads a column named like a receipts column"
                        ),
                        format!("rename that column of {content}, then {line}"),
                    );
                }
                continue;
            };
            match schema.tables.get(&name) {
                None => refuse(
                    SHAPE,
                    format!(
                        "deliver as {}: generated table {name} is missing from the schema",
                        deliver.log
                    ),
                    format!("let the compiler emit {name} from the deliver line; a raw schema must carry the engine's exact shape"),
                ),
                Some(actual) if *actual != expected => refuse(
                    SHAPE,
                    format!(
                        "{name} is not the engine-generated {} for {content}: {} differs",
                        if deliver.log == name { "log" } else { "receipts table" },
                        first_difference(actual, &expected)
                    ),
                    format!("let the compiler emit {name} from the deliver line; do not author it"),
                ),
                Some(_) => {}
            }
        }
    }
    issues
}

fn first_difference(actual: &Table, expected: &Table) -> &'static str {
    if actual.columns != expected.columns {
        "columns"
    } else if actual.indexes != expected.indexes {
        "indexes"
    } else if actual.rules != expected.rules {
        "rules"
    } else if actual.constraints != expected.constraints {
        "constraints"
    } else if actual.retain != expected.retain {
        "retain"
    } else if actual.tombstones != expected.tombstones {
        "tombstones"
    } else {
        "deliver"
    }
}
