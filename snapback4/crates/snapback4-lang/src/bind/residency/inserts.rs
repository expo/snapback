//! Insert-arm limitations are distinct from an operation's server read sites.
use super::*;
use snapback4_core::engine::rules::upsert_absence;
use snapback4_core::schema::{ColumnDefault, Constraint, Table};
use snapback4_core::{Value, ir::Input};

pub(super) const UPSERT_BLOCKED: &str = "upsert insert blocked";
pub(super) const ABSENT_BLOCKED: &str = "insert if absent blocked";
pub(super) const PENDING: &str = "this write queues until the server answers; show its pending state";

pub(super) fn blocked(site: &ResidencySite) -> bool { matches!(site.kind.as_str(), UPSERT_BLOCKED | ABSENT_BLOCKED) }

// @ref LLP 3000.007#20.5 — report the first failed absence/coverage proof without turning a held-row update into a server-only operation.
pub(super) fn insert_site(schema: &Schema, location: &str, name: &str, addressed: Option<(&str, &[Expr])>, row: &Expr) -> ResidencySite {
    let kind = if addressed.is_some() { "upsert insert" } else { "insert if absent" };
    let index = addressed.map_or("byId", |(index, _)| index);
    let mut fact = site(schema, location, name, index, kind);
    fact.rewrite.clear();
    if let Some(reason) = failure(schema, name, addressed, row) {
        fact.kind = if addressed.is_some() { UPSERT_BLOCKED } else { ABSENT_BLOCKED }.into();
        fact.reason = reason;
    } else {
        fact.reason = match addressed.and_then(|(index, key)| upsert_absence(schema, name, index, key).ok()) {
            Some(visibility) if visibility.decided_true => format!("{kind} into {name}: absence is provable when the group and insert image are held and readable"),
            _ => format!("{kind} into {name}: predicts only when the key, insert image and constraint groups are held and readable; otherwise queues without a row"),
        };
    }
    fact
}

fn unpinned(table: &Table, columns: &[String]) -> String {
    let mut fields = BTreeSet::new();
    table.rules.read.device_audience_rule().fields(&mut fields);
    fields.retain(|field| !columns.contains(field));
    if fields.is_empty() { String::new() } else { format!("; unpinned: {}", fields.into_iter().collect::<Vec<_>>().join(", ")) }
}

fn failure(schema: &Schema, name: &str, addressed: Option<(&str, &[Expr])>, row: &Expr) -> Option<String> {
    let table = schema.table(name)?;
    let Some(sync) = &table.sync else { return Some(format!("{name} is online only")) };
    if let Some(horizon) = &sync.horizon {
        return Some(format!("{name} has horizon last {} by {} ({})", horizon.last, horizon.by, table.index(&horizon.by)?.columns().join(", ")));
    }
    let rule = table.rules.read.device_audience_rule();
    if rule.is_uniformly_readable() && sync.audience != Audience::Public {
        return Some(format!("{name} has public read rule `{}` but {} does not establish whole-table coverage", rule.quarry(), sync.line()));
    }
    if let Some((index, key)) = addressed && upsert_absence(schema, name, index, key).is_err() {
        let columns: Vec<_> = table.index(index)?.columns().into_iter().take(key.len()).collect();
        return Some(format!("{name} read rule `{}` is not decided by key {index} ({}){}", rule.quarry(), columns.join(", "), unpinned(table, &columns)));
    }
    // The runtime skips byId only for an id minted during this call; parameters and unknown images are supplied too.
    let unknown_id = ir::var("<runtime>");
    let supplied_id = match row {
        Expr::Object(fields) => fields.get("id").filter(|value| !matches!(value, Expr::Input(Input::NewId))),
        _ => Some(&unknown_id),
    };
    if addressed.is_none() && (supplied_id.is_some() || !table.indexes.iter().any(|(name, index)| name != "byId" && index.unique)) {
        let key = [supplied_id.cloned().unwrap_or_else(|| ir::var("id"))];
        if upsert_absence(schema, name, "byId", &key).is_err() {
            let columns = vec!["id".into()];
            return Some(format!("{name} read rule `{}` is not decided by key byId (id){}", rule.quarry(), unpinned(table, &columns)));
        }
    }
    // Use the known insert image so a nullable key with a non-null default is
    // checked, while an explicit null still bypasses uniqueness as at runtime.
    let mut image = BTreeMap::new();
    if let Expr::Object(fields) = row {
        image.extend(table.defaults.iter().map(|(column, default)| (column.clone(), match default {
            ColumnDefault::Literal(value) => Expr::Literal(value.clone()), ColumnDefault::Viewer => Expr::Input(Input::Viewer), ColumnDefault::Now => Expr::Input(Input::Now),
        })));
        if let Some((index, key)) = addressed { image.extend(table.index(index)?.columns().into_iter().zip(key.iter().cloned())); }
        image.extend(fields.clone());
    }
    for (index, definition) in &table.indexes {
        if !definition.unique || index == "byId" || addressed.is_some_and(|(target, _)| target == index) { continue; }
        let columns = definition.columns();
        if columns.iter().any(|column| matches!(image.get(column), Some(Expr::Literal(Value::Null)))) { continue; }
        if columns.iter().any(|column| table.columns.get(column).is_some_and(|kind| kind.is_optional()) && !matches!(image.get(column), Some(Expr::Literal(_)) | Some(Expr::Input(Input::Viewer | Input::Now | Input::NewId)))) { continue; }
        let key: Vec<_> = columns.iter().map(|column| image.get(column).cloned().unwrap_or_else(|| ir::var(column))).collect();
        if upsert_absence(schema, name, index, &key).is_err() {
            return Some(format!("{name} unique key {index} ({}) is not covered by read rule `{}`{}", columns.join(", "), rule.quarry(), unpinned(table, &columns)));
        }
    }
    for constraint in &table.constraints {
        if let Constraint::Cap { by, max } = constraint {
            let (index, _) = table.indexes.iter().find(|(_, index)| index.is_plain() && index.columns().starts_with(by))?;
            let key: Vec<_> = by.iter().map(|column| ir::var(column)).collect();
            if upsert_absence(schema, name, index, &key).is_err() {
                let group = if by.is_empty() { " (whole table)".into() } else { format!(" by {}", by.join(", ")) };
                return Some(format!("{name} cap {max}{group} is not covered by read rule `{}`{}", rule.quarry(), unpinned(table, by)));
            }
        }
    }
    None
}

// Retain only scalar facts and object shape; do not evaluate expressions or
// copy large query/array trees just to explain a nullable unique key.
pub(super) fn image(value: &Expr, known: &BTreeMap<String, Expr>) -> Expr {
    match value {
        Expr::Variable(name) => known.get(name).cloned().unwrap_or_else(|| value.clone()),
        Expr::Literal(_) | Expr::Input(_) => value.clone(),
        Expr::Object(fields) => Expr::Object(fields.iter().map(|(name, value)| (name.clone(), image(value, known))).collect()),
        _ => ir::var("<runtime>"),
    }
}

// @ref LLP 3000.007#20.5 — a mint proves primary-key absence until that local may be assigned another value.
// Immutable $value snapshots already have their own facts in inspect.
pub(super) fn track_minted_alias(stmt: &Stmt, known: &mut BTreeMap<String, Expr>, aliases: &mut BTreeSet<String>) {
    let binding = match stmt { Stmt::Let { name, value } | Stmt::Assign { name, value } | Stmt::Const { name, value } => Some((name, value)), _ => None };
    if let Some((name, value)) = binding {
        if name.starts_with("$value") || matches!(stmt, Stmt::Const { .. }) { return; }
        let minted = matches!(image(value, known), Expr::Input(Input::NewId));
        if aliases.remove(name) { known.remove(name); }
        if minted { known.insert(name.clone(), Expr::Input(Input::NewId)); aliases.insert(name.clone()); }
    } else {
        invalidate_minted_aliases(stmt, known, aliases);
    }
}

// A branch or loop may run any of its assignments; retain facts only for the
// other locals. Reads, emits and writes without a result binding cannot change them.
fn invalidate_minted_aliases(stmt: &Stmt, known: &mut BTreeMap<String, Expr>, aliases: &mut BTreeSet<String>) {
    let name = match stmt {
        Stmt::Let { name, .. } | Stmt::Assign { name, .. } | Stmt::Const { name, .. } | Stmt::Push { target: name, .. }
            | Stmt::InsertIfAbsent { result: name, .. } => Some(name),
        Stmt::If { then_body, else_body, .. } => {
            for stmt in then_body.iter().chain(else_body) { invalidate_minted_aliases(stmt, known, aliases); }
            None
        }
        Stmt::For { binding, body, .. } => {
            for stmt in body { invalidate_minted_aliases(stmt, known, aliases); }
            Some(binding)
        }
        Stmt::WriteTarget { result, condition, .. } => {
            if let Some(condition) = condition {
                for stmt in &condition.setup { invalidate_minted_aliases(stmt, known, aliases); }
            }
            result.as_ref()
        }
        _ => None,
    };
    if let Some(name) = name && aliases.remove(name) {
        known.remove(name);
    }
}
