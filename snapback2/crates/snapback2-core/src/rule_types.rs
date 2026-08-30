//! Structural typing for authorization rules at the `ProjectJson` trust boundary.
//!
//! Rule values intentionally share the v1 scalar wire representation with
//! ordinary ids.  Certification must therefore preserve the nominal
//! distinction that the wire cannot express: `Viewer` is a `Principal`, and
//! only principal fields (plus the reserved `system` literal) may meet it.

use crate::certificate::CheckError;
use crate::ir::ArgType;
use crate::schema::{ColumnType, RuleExpr, RuleTerm, Schema};
use crate::value::Value;
use std::collections::BTreeMap;

const CODE: &str = "E_RULE_INVALID";
const REWRITE: &str =
    "declare authority axes as Principal and align rule terms with the referenced index columns";

// @ref LLP 1001#6-identity-identityrs — certification restores the nominal Principal boundary erased by v1's shared Id wire scalar.
pub(crate) fn check(schema: &Schema) -> Vec<(String, CheckError)> {
    let mut errors = Vec::new();
    for (table_name, table) in &schema.tables {
        let subject = Subject::Table(&table.columns);
        for (side, rule) in [
            ("read", &table.rules.read),
            ("insert", &table.rules.insert),
            ("update", &table.rules.update),
            ("delete", &table.rules.delete),
        ] {
            check_rule(
                schema,
                subject,
                rule,
                &format!("schema.tables.{table_name}.rules.{side}"),
                &mut errors,
            );
        }
    }
    for (channel_name, channel) in &schema.channels {
        let subject = Subject::Channel(&channel.args);
        for (side, rule) in [
            ("publish", &channel.publish),
            ("subscribe", &channel.subscribe),
        ] {
            check_rule(
                schema,
                subject,
                rule,
                &format!("schema.channels.{channel_name}.{side}"),
                &mut errors,
            );
        }
    }
    // A maintained value's readability rule is evaluated over the target
    // row shape, matching the authored/compiler surface.
    for (position, maintain) in schema.maintains.iter().enumerate() {
        let Some(rule) = &maintain.readable else {
            continue;
        };
        let subject = schema
            .table(&maintain.target)
            .map(|table| Subject::Table(&table.columns))
            .unwrap_or(Subject::None);
        check_rule(
            schema,
            subject,
            rule,
            &format!("schema.maintains[{position}].readable"),
            &mut errors,
        );
    }
    errors
}

#[derive(Clone, Copy)]
enum Subject<'a> {
    Table(&'a BTreeMap<String, ColumnType>),
    Channel(&'a BTreeMap<String, ArgType>),
    None,
}

impl Subject<'_> {
    fn field_type(self, field: &str) -> Option<RuleType> {
        match self {
            Self::Table(columns) => columns.get(field).map(RuleType::from_column),
            Self::Channel(args) => args.get(field).map(RuleType::from_arg),
            Self::None => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum RuleType {
    Principal,
    Id,
    Ref(String),
    Text,
    Int,
    Bool,
    Time,
    Json,
    Enum(Vec<String>),
    Decimal(u8),
    Money(String, u8),
    Optional(Box<RuleType>),
    List(Box<RuleType>),
    Scalar,
    NullLiteral,
    IdLiteral { system: bool },
    TextLiteral,
    IntLiteral,
    BoolLiteral,
    ArrayLiteral(Vec<RuleType>),
    JsonLiteral,
}

impl RuleType {
    fn from_column(kind: &ColumnType) -> Self {
        match kind {
            ColumnType::Principal => Self::Principal,
            ColumnType::Id => Self::Id,
            ColumnType::Ref { table } => Self::Ref(table.clone()),
            ColumnType::Text { .. } => Self::Text,
            ColumnType::Int => Self::Int,
            ColumnType::Bool => Self::Bool,
            ColumnType::Time => Self::Time,
            ColumnType::Json { .. } => Self::Json,
            ColumnType::Enum { variants } => Self::Enum(variants.clone()),
            ColumnType::Decimal { scale } => Self::Decimal(*scale),
            ColumnType::Money { currency, scale } => Self::Money(currency.clone(), *scale),
            ColumnType::Optional(inner) => Self::Optional(Box::new(Self::from_column(inner))),
            ColumnType::List { of, .. } => Self::List(Box::new(Self::from_column(of))),
        }
    }

    fn from_arg(kind: &ArgType) -> Self {
        match kind {
            ArgType::Principal => Self::Principal,
            ArgType::Id => Self::Id,
            ArgType::Ref { table } => Self::Ref(table.clone()),
            ArgType::Text { .. } => Self::Text,
            ArgType::Int => Self::Int,
            ArgType::Bool => Self::Bool,
            ArgType::Time => Self::Time,
            ArgType::Json { .. } => Self::Json,
            ArgType::Enum { variants } => Self::Enum(variants.clone()),
            ArgType::Decimal { scale } => Self::Decimal(*scale),
            ArgType::Money { currency, scale } => Self::Money(currency.clone(), *scale),
            ArgType::Optional(inner) => Self::Optional(Box::new(Self::from_arg(inner))),
            ArgType::List { of, .. } => Self::List(Box::new(
                of.as_deref().map(Self::from_arg).unwrap_or(Self::Scalar),
            )),
            ArgType::Scalar => Self::Scalar,
        }
    }

    fn from_literal(value: &Value) -> Self {
        match value {
            Value::Null => Self::NullLiteral,
            Value::Bool(_) => Self::BoolLiteral,
            Value::Int(_) => Self::IntLiteral,
            Value::String(_) => Self::TextLiteral,
            Value::Id(value) => Self::IdLiteral {
                system: value == "system",
            },
            Value::Array(values) => {
                Self::ArrayLiteral(values.iter().map(Self::from_literal).collect())
            }
            Value::Row(_) | Value::Map(_) => Self::JsonLiteral,
        }
    }

    fn label(&self) -> String {
        match self {
            Self::Principal => "Principal".to_owned(),
            Self::Id => "Id".to_owned(),
            Self::Ref(table) => format!("Ref<{table}>"),
            Self::Text => "Text".to_owned(),
            Self::Int => "Int".to_owned(),
            Self::Bool => "Bool".to_owned(),
            Self::Time => "Time".to_owned(),
            Self::Json => "Json".to_owned(),
            Self::Enum(_) => "Enum".to_owned(),
            Self::Decimal(scale) => format!("Decimal<{scale}>"),
            Self::Money(currency, scale) => format!("Money<{currency},{scale}>"),
            Self::Optional(inner) => format!("Optional<{}>", inner.label()),
            Self::List(inner) => format!("List<{}>", inner.label()),
            Self::Scalar => "Scalar".to_owned(),
            Self::NullLiteral => "null literal".to_owned(),
            Self::IdLiteral { system: true } => "reserved system principal literal".to_owned(),
            Self::IdLiteral { system: false } => "id literal".to_owned(),
            Self::TextLiteral => "text literal".to_owned(),
            Self::IntLiteral => "integer literal".to_owned(),
            Self::BoolLiteral => "boolean literal".to_owned(),
            Self::ArrayLiteral(_) => "array literal".to_owned(),
            Self::JsonLiteral => "json literal".to_owned(),
        }
    }
}

fn check_rule(
    schema: &Schema,
    subject: Subject<'_>,
    rule: &RuleExpr,
    site: &str,
    errors: &mut Vec<(String, CheckError)>,
) {
    match rule {
        RuleExpr::Public { .. } | RuleExpr::Allow | RuleExpr::Deny => {}
        RuleExpr::Eq(left, right) | RuleExpr::Ne(left, right) => {
            let left_type = term_type(subject, left, &format!("{site}.left"), errors);
            let right_type = term_type(subject, right, &format!("{site}.right"), errors);
            if let (Some(left_type), Some(right_type)) = (left_type, right_type)
                && !compatible(&left_type, &right_type)
            {
                errors.push(invalid(
                    site,
                    format!(
                        "rule comparison joins {} with {}",
                        left_type.label(),
                        right_type.label()
                    ),
                ));
            }
        }
        RuleExpr::And(rules) => {
            for (position, rule) in rules.iter().enumerate() {
                check_rule(
                    schema,
                    subject,
                    rule,
                    &format!("{site}.and[{position}]"),
                    errors,
                );
            }
        }
        RuleExpr::Or(rules) => {
            for (position, rule) in rules.iter().enumerate() {
                check_rule(
                    schema,
                    subject,
                    rule,
                    &format!("{site}.or[{position}]"),
                    errors,
                );
            }
        }
        RuleExpr::Not(rule) => check_rule(schema, subject, rule, &format!("{site}.not"), errors),
        RuleExpr::Exists {
            table, index, key, ..
        } => check_exists(schema, subject, table, index, key, site, errors),
    }
}

fn check_exists(
    schema: &Schema,
    subject: Subject<'_>,
    table_name: &str,
    index_name: &str,
    key: &[RuleTerm],
    site: &str,
    errors: &mut Vec<(String, CheckError)>,
) {
    let Some(table) = schema.table(table_name) else {
        errors.push(invalid(
            site,
            format!("rule exists references unknown table {table_name}"),
        ));
        return;
    };
    let Some(index) = table.index(index_name) else {
        errors.push(invalid(
            site,
            format!("rule exists references unknown index {table_name}.{index_name}"),
        ));
        return;
    };
    if key.len() != index.columns.len() {
        errors.push(invalid(
            site,
            format!(
                "rule exists key for {table_name}.{index_name} has {} terms; expected {}",
                key.len(),
                index.columns.len()
            ),
        ));
    }
    for (position, (term, column_name)) in key.iter().zip(&index.columns).enumerate() {
        let term_site = format!("{site}.exists.key[{position}]");
        let actual = term_type(subject, term, &term_site, errors);
        let Some(expected) = table.columns.get(column_name).map(RuleType::from_column) else {
            errors.push(invalid(
                &term_site,
                format!(
                    "rule exists index {table_name}.{index_name} references missing column {column_name}"
                ),
            ));
            continue;
        };
        if let Some(actual) = actual
            && !compatible_exists(&actual, &expected, table_name, column_name)
        {
            errors.push(invalid(
                &term_site,
                format!(
                    "rule exists term for {table_name}.{index_name}.{column_name} is {}; expected {}",
                    actual.label(),
                    expected.label()
                ),
            ));
        }
    }
}

fn compatible_exists(
    actual: &RuleType,
    expected: &RuleType,
    target_table: &str,
    target_column: &str,
) -> bool {
    compatible(actual, expected)
        || matches!(
            (actual, expected),
            (RuleType::Ref(table), RuleType::Id)
                if table == target_table && target_column == "id"
        )
}

fn term_type(
    subject: Subject<'_>,
    term: &RuleTerm,
    site: &str,
    errors: &mut Vec<(String, CheckError)>,
) -> Option<RuleType> {
    match term {
        RuleTerm::Viewer => Some(RuleType::Principal),
        RuleTerm::Literal(value) => Some(RuleType::from_literal(value)),
        RuleTerm::Field(field) => match subject.field_type(field) {
            Some(kind) => Some(kind),
            None => {
                errors.push(invalid(
                    site,
                    format!("rule references unknown field {field} on its outer subject"),
                ));
                None
            }
        },
    }
}

fn compatible(left: &RuleType, right: &RuleType) -> bool {
    if left == right {
        return true;
    }
    match (left, right) {
        (RuleType::Optional(inner), RuleType::NullLiteral)
        | (RuleType::NullLiteral, RuleType::Optional(inner)) => {
            let _ = inner;
            true
        }
        (RuleType::Optional(inner), other) | (other, RuleType::Optional(inner)) => {
            compatible(inner, other)
        }
        (RuleType::Principal, RuleType::IdLiteral { system: true })
        | (RuleType::IdLiteral { system: true }, RuleType::Principal) => true,
        (RuleType::Id | RuleType::Ref(_), RuleType::IdLiteral { .. })
        | (RuleType::IdLiteral { .. }, RuleType::Id | RuleType::Ref(_)) => true,
        (RuleType::Text | RuleType::Enum(_), RuleType::TextLiteral)
        | (RuleType::TextLiteral, RuleType::Text | RuleType::Enum(_)) => true,
        (
            RuleType::Int | RuleType::Time | RuleType::Decimal(_) | RuleType::Money(_, _),
            RuleType::IntLiteral,
        )
        | (
            RuleType::IntLiteral,
            RuleType::Int | RuleType::Time | RuleType::Decimal(_) | RuleType::Money(_, _),
        ) => true,
        (RuleType::Bool, RuleType::BoolLiteral) | (RuleType::BoolLiteral, RuleType::Bool) => true,
        (RuleType::Json, RuleType::JsonLiteral) | (RuleType::JsonLiteral, RuleType::Json) => true,
        (RuleType::List(inner), RuleType::ArrayLiteral(values))
        | (RuleType::ArrayLiteral(values), RuleType::List(inner)) => {
            values.iter().all(|value| compatible(inner, value))
        }
        _ => false,
    }
}

fn invalid(site: &str, message: String) -> (String, CheckError) {
    (
        site.to_owned(),
        CheckError {
            code: CODE.to_owned(),
            message,
            rewrite: REWRITE.to_owned(),
        },
    )
}
