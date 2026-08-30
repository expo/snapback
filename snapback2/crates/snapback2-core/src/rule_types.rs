//! Structural typing for authorization rules at the `ProjectJson` trust boundary.
//!
//! Rule values intentionally share the v1 scalar wire representation with
//! ordinary ids.  Certification must therefore preserve the nominal
//! distinction that the wire cannot express: `Viewer` is a `Principal`, and
//! only principal fields (plus the reserved `system` literal) may meet it.

use crate::certificate::CheckError;
use crate::ir::ArgType;
use crate::schema::{ColumnType, Constraint, Effect, RuleExpr, RuleTerm, Schema};
use crate::value::Value;
use std::collections::BTreeMap;

const CODE: &str = "E_RULE_INVALID";
const REWRITE: &str =
    "declare authority axes as Principal and align rule terms with the referenced index columns";
const EFFECT_REWRITE: &str =
    "use OldField/NextField only in table update rules and Created only in table insert rules";

// @ref LLP 1001#6-identity-identityrs — certification restores the nominal Principal boundary erased by v1's shared Id wire scalar.
pub(crate) fn check(schema: &Schema) -> Vec<(String, CheckError)> {
    let mut errors = Vec::new();
    for (table_name, table) in &schema.tables {
        let subject = Subject::Table(&table.columns);
        for (side, effect, rule) in [
            ("read", Effect::Read, &table.rules.read),
            ("insert", Effect::Insert, &table.rules.insert),
            ("update", Effect::Update, &table.rules.update),
            ("delete", Effect::Delete, &table.rules.delete),
        ] {
            check_rule(
                schema,
                subject,
                RuleUse::Table(effect),
                rule,
                &format!("schema.tables.{table_name}.rules.{side}"),
                &mut errors,
            );
        }
        for (position, constraint) in table.constraints.iter().enumerate() {
            let Constraint::FinalExistsOnInsert {
                table: target,
                index,
                key,
            } = constraint
            else {
                continue;
            };
            check_final_exists(
                schema,
                table_name,
                subject,
                target,
                index,
                key,
                &format!("schema.tables.{table_name}.constraints[{position}].finalExistsOnInsert"),
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
                RuleUse::Other,
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
            RuleUse::Other,
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RuleUse {
    Table(Effect),
    Other,
}

impl RuleUse {
    fn is_update(self) -> bool {
        self == Self::Table(Effect::Update)
    }

    fn admits_created(self) -> bool {
        self == Self::Table(Effect::Insert)
    }
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
    TextLiteral(String),
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
            Value::String(value) => Self::TextLiteral(value.clone()),
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
            Self::Enum(variants) => format!("Enum<{}>", variants.join("|")),
            Self::Decimal(scale) => format!("Decimal<{scale}>"),
            Self::Money(currency, scale) => format!("Money<{currency},{scale}>"),
            Self::Optional(inner) => format!("Optional<{}>", inner.label()),
            Self::List(inner) => format!("List<{}>", inner.label()),
            Self::Scalar => "Scalar".to_owned(),
            Self::NullLiteral => "null literal".to_owned(),
            Self::IdLiteral { system: true } => "reserved system principal literal".to_owned(),
            Self::IdLiteral { system: false } => "id literal".to_owned(),
            Self::TextLiteral(value) => format!("text literal {value:?}"),
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
    rule_use: RuleUse,
    rule: &RuleExpr,
    site: &str,
    errors: &mut Vec<(String, CheckError)>,
) {
    match rule {
        RuleExpr::Public { .. } | RuleExpr::Allow | RuleExpr::Deny => {}
        RuleExpr::Eq(left, right) | RuleExpr::Ne(left, right) => {
            let left_type = term_type(subject, rule_use, left, &format!("{site}.left"), errors);
            let right_type = term_type(subject, rule_use, right, &format!("{site}.right"), errors);
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
                    rule_use,
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
                    rule_use,
                    rule,
                    &format!("{site}.or[{position}]"),
                    errors,
                );
            }
        }
        RuleExpr::Not(rule) => check_rule(
            schema,
            subject,
            rule_use,
            rule,
            &format!("{site}.not"),
            errors,
        ),
        RuleExpr::Exists {
            table, index, key, ..
        } => check_exists(
            schema, subject, rule_use, table, index, key, "exists", site, errors,
        ),
        RuleExpr::Created {
            table, index, key, ..
        } => {
            if !rule_use.admits_created() {
                errors.push(invalid_effect(
                    site,
                    "created-row probes are valid only in table insert rules".to_owned(),
                ));
            }
            check_exists(
                schema, subject, rule_use, table, index, key, "created", site, errors,
            );
        }
    }
}

fn check_exists(
    schema: &Schema,
    subject: Subject<'_>,
    rule_use: RuleUse,
    table_name: &str,
    index_name: &str,
    key: &[RuleTerm],
    probe: &str,
    site: &str,
    errors: &mut Vec<(String, CheckError)>,
) {
    let Some(table) = schema.table(table_name) else {
        errors.push(invalid(
            site,
            format!("rule {probe} references unknown table {table_name}"),
        ));
        return;
    };
    let Some(index) = table.index(index_name) else {
        errors.push(invalid(
            site,
            format!("rule {probe} references unknown index {table_name}.{index_name}"),
        ));
        return;
    };
    if key.len() != index.columns.len() {
        errors.push(invalid(
            site,
            format!(
                "rule {probe} key for {table_name}.{index_name} has {} terms; expected {}",
                key.len(),
                index.columns.len()
            ),
        ));
    }
    for (position, (term, column_name)) in key.iter().zip(&index.columns).enumerate() {
        let term_site = format!("{site}.{probe}.key[{position}]");
        let actual = term_type(subject, rule_use, term, &term_site, errors);
        let Some(expected) = table.columns.get(column_name).map(RuleType::from_column) else {
            errors.push(invalid(
                &term_site,
                format!(
                    "rule {probe} index {table_name}.{index_name} references missing column {column_name}"
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
                    "rule {probe} term for {table_name}.{index_name}.{column_name} is {}; expected {}",
                    actual.label(),
                    expected.label()
                ),
            ));
        }
    }
}

fn check_final_exists(
    schema: &Schema,
    source_table: &str,
    subject: Subject<'_>,
    target_table: &str,
    index_name: &str,
    key: &[RuleTerm],
    site: &str,
    errors: &mut Vec<(String, CheckError)>,
) {
    let Some(table) = schema.table(target_table) else {
        errors.push(invalid(
            site,
            format!("final-exists constraint references unknown table {target_table}"),
        ));
        return;
    };
    let Some(index) = table.index(index_name) else {
        errors.push(invalid(
            site,
            format!("final-exists constraint references unknown index {target_table}.{index_name}"),
        ));
        return;
    };
    if key.len() != index.columns.len() {
        errors.push(invalid(
            site,
            format!(
                "final-exists key for {target_table}.{index_name} has {} terms; expected {}",
                key.len(),
                index.columns.len()
            ),
        ));
    }
    for (position, (term, column_name)) in key.iter().zip(&index.columns).enumerate() {
        let term_site = format!("{site}.key[{position}]");
        let actual = term_type(subject, RuleUse::Other, term, &term_site, errors);
        let Some(expected) = table.columns.get(column_name).map(RuleType::from_column) else {
            errors.push(invalid(
                &term_site,
                format!(
                    "final-exists index {target_table}.{index_name} references missing column {column_name}"
                ),
            ));
            continue;
        };
        if let Some(actual) = actual
            && !compatible_final_exists(
                &actual,
                &expected,
                source_table,
                target_table,
                column_name,
                term,
            )
        {
            errors.push(invalid(
                &term_site,
                format!(
                    "final-exists term for {target_table}.{index_name}.{column_name} is {}; expected {}",
                    actual.label(),
                    expected.label()
                ),
            ));
        }
    }
}

fn compatible_final_exists(
    actual: &RuleType,
    expected: &RuleType,
    source_table: &str,
    target_table: &str,
    target_column: &str,
    term: &RuleTerm,
) -> bool {
    if compatible_exists(actual, expected, target_table, target_column) {
        return true;
    }
    let expected_ref = match expected {
        RuleType::Ref(table) => Some(table.as_str()),
        RuleType::Optional(inner) => match inner.as_ref() {
            RuleType::Ref(table) => Some(table.as_str()),
            _ => None,
        },
        _ => None,
    };
    matches!(term, RuleTerm::Field(field) if field == "id")
        && actual == &RuleType::Id
        && expected_ref == Some(source_table)
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
    rule_use: RuleUse,
    term: &RuleTerm,
    site: &str,
    errors: &mut Vec<(String, CheckError)>,
) -> Option<RuleType> {
    match term {
        RuleTerm::Viewer => Some(RuleType::Principal),
        RuleTerm::Literal(value) => Some(RuleType::from_literal(value)),
        RuleTerm::Field(field) => field_type(subject, field, site, errors),
        RuleTerm::OldField(field) | RuleTerm::NextField(field) => {
            if !rule_use.is_update() {
                let image = if matches!(term, RuleTerm::OldField(_)) {
                    "old"
                } else {
                    "next"
                };
                errors.push(invalid_effect(
                    site,
                    format!("{image}-row fields are valid only in table update rules"),
                ));
                None
            } else {
                field_type(subject, field, site, errors)
            }
        }
    }
}

fn field_type(
    subject: Subject<'_>,
    field: &str,
    site: &str,
    errors: &mut Vec<(String, CheckError)>,
) -> Option<RuleType> {
    match subject.field_type(field) {
        Some(kind) => Some(kind),
        None => {
            errors.push(invalid(
                site,
                format!("rule references unknown field {field} on its outer subject"),
            ));
            None
        }
    }
}

fn compatible(left: &RuleType, right: &RuleType) -> bool {
    if left == right {
        return true;
    }
    match (left, right) {
        (RuleType::TextLiteral(_), RuleType::TextLiteral(_)) => true,
        (RuleType::ArrayLiteral(left), RuleType::ArrayLiteral(right)) => {
            left.iter().all(json_literal) && right.iter().all(json_literal)
        }
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
        (RuleType::Text, RuleType::TextLiteral(_)) | (RuleType::TextLiteral(_), RuleType::Text) => {
            true
        }
        (RuleType::Enum(variants), RuleType::TextLiteral(value))
        | (RuleType::TextLiteral(value), RuleType::Enum(variants)) => variants.contains(value),
        (RuleType::Int | RuleType::Time, RuleType::IntLiteral)
        | (RuleType::IntLiteral, RuleType::Int | RuleType::Time) => true,
        (RuleType::Bool, RuleType::BoolLiteral) | (RuleType::BoolLiteral, RuleType::Bool) => true,
        (RuleType::Json, literal) | (literal, RuleType::Json) => json_literal(literal),
        (RuleType::List(inner), RuleType::ArrayLiteral(values))
        | (RuleType::ArrayLiteral(values), RuleType::List(inner)) => {
            values.iter().all(|value| compatible(inner, value))
        }
        _ => false,
    }
}

fn json_literal(value: &RuleType) -> bool {
    match value {
        RuleType::NullLiteral
        | RuleType::TextLiteral(_)
        | RuleType::IntLiteral
        | RuleType::BoolLiteral
        | RuleType::JsonLiteral => true,
        RuleType::ArrayLiteral(values) => values.iter().all(json_literal),
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

fn invalid_effect(site: &str, message: String) -> (String, CheckError) {
    (
        site.to_owned(),
        CheckError {
            code: CODE.to_owned(),
            message,
            rewrite: EFFECT_REWRITE.to_owned(),
        },
    )
}
