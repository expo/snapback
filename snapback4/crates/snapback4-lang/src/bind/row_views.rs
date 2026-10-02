//! A row-keyed view is an aggregate with a bounded recipient domain.
// @ref LLP 3000.015#3 — the parent equality selects recipients; their fields parameterize the predicate.
use super::{catalog::TableInfo, maintains};
use crate::{
    ast::*,
    diag::{Diagnostic, Fallible, Site},
};
use snapback4_core::{maintain::RowKey, schema::Constraint};
use std::collections::BTreeMap;

pub(super) fn refusal(site: &Site, message: impl Into<String>) -> Diagnostic {
    Diagnostic::new(site, "E_VIEW_KEY", message,
        "view unread: count messages by members m where .conversationId = m.conversationId and .ordinal > m.readUpTo and .senderId != m.principal and not .tombstone; declare cap 100 by conversationId on members").guide("maintains")
}

pub(super) fn predicate_field(info: &TableInfo, field: &str, site: &Site) -> Fallible<()> {
    if info.maintained.as_ref().is_some_and(|m| m.row_key.is_some())
        && (matches!(field, "recountPending" | "pending") || (field != "id" && !info.columns.contains_key(field))) {
        return Err(Diagnostic::new(site, "E_VIEW_KEY", format!("{}.{} is maintenance or private state and cannot decide a predicate", info.decl.name, field),
            "predicate on value, member identity or copied member fields; project recountPending as data and check complete").guide("maintains"));
    }
    Ok(())
}

fn member_field<'a>(e: &'a Expr, alias: &str) -> Option<&'a str> {
    match e {
        Expr::Member { base, name, .. } if matches!(base.as_ref(), Expr::Name { name, .. } if name == alias) => {
            Some(name)
        }
        _ => None,
    }
}
fn source_field(e: &Expr) -> Option<&str> {
    match e {
        Expr::Member { base, name, .. } if matches!(base.as_ref(), Expr::Focal { .. }) => {
            Some(name)
        }
        _ => None,
    }
}
fn has_member(e: &Expr, alias: &str) -> bool {
    if member_field(e, alias).is_some() {
        return true;
    }
    match e {
        Expr::Binary { left, right, .. } => has_member(left, alias) || has_member(right, alias),
        Expr::Unary { value, .. } => has_member(value, alias),
        Expr::Name { name, .. } => name == alias,
        _ => false,
    }
}

pub(super) fn bind(
    tables: &BTreeMap<String, TableInfo>,
    m: &MaintainDecl,
) -> Fallible<(RowKey, snapback4_core::maintain::Predicate)> {
    let (table, alias) = m.row_key.as_ref().unwrap();
    let fail = |text: &str| refusal(&m.site, text);
    let u = tables
        .get(table)
        .ok_or_else(|| fail("the row key needs an ordinary table"))?;
    let t = tables
        .get(&m.source)
        .ok_or_else(|| fail("the counted source needs an ordinary table"))?;
    if table == &m.source
        || u.maintained.is_some()
        || t.maintained.is_some()
        || m.column.is_some()
        || m.read.is_some()
    {
        return Err(fail(
            "row-keyed views count two distinct ordinary tables and inherit the keyed row's read rule",
        ));
    }
    let predicate = m
        .filter
        .as_ref()
        .ok_or_else(|| fail("a row-keyed view needs its parent equality in where"))?;
    let mut key = Vec::new();
    fn visit(
        e: &Expr,
        alias: &str,
        t: &TableInfo,
        u: &TableInfo,
        key: &mut Vec<(String, String)>,
    ) -> Fallible<()> {
        if let Expr::Binary {
            op, left, right, ..
        } = e
        {
            if op == "and" {
                visit(left, alias, t, u, key)?;
                visit(right, alias, t, u, key)?;
                return Ok(());
            }
            let pair = source_field(left)
                .zip(member_field(right, alias))
                .or_else(|| source_field(right).zip(member_field(left, alias)));
            if let Some((s, r)) = pair {
                if op == "="
                    && matches!((t.columns.get(s),u.columns.get(r)),
                    (Some(ScalarType {kind: TypeKind::Ref { table:a }, optional:false}), Some(ScalarType {kind:TypeKind::Ref {table:b}, optional:false})) if a==b)
                {
                    key.push((s.into(), r.into()));
                }
                if matches!(op.as_str(), "=" | "!=" | "<" | "<=" | ">" | ">=") {
                    return Ok(());
                }
            }
        }
        if has_member(e, alias) {
            return Err(refusal(
                e.site(),
                "member fields occur only in conjunctive comparisons with source fields; the key is exactly one parent-reference equality",
            ));
        }
        maintains::predicate(t, e).map(|_| ()).map_err(|_| {
            refusal(
                e.site(),
                "conditions must be source-local scalar predicates or source/member comparisons",
            )
        })
    }
    visit(predicate, alias, t, u, &mut key)?;
    if key.len() != 1 {
        return Err(fail(
            "the predicate needs exactly one equality between required references to the same parent table",
        ));
    }
    let (source_key, member_key) = key.pop().unwrap();
    let cap = u
        .decl
        .caps
        .iter()
        .find(|c| c.by == vec![member_key.clone()]);
    // The core verifies the resolved cap too; the declaration syntax keeps its own tuple order.
    let fanout = cap.map(|c| c.max).ok_or_else(|| {
        fail("the member table needs a cap by its parent reference to bound source-event fanout")
    })?;
    let mut joint = t.clone();
    for (name, ty) in &u.columns {
        joint.columns.insert(format!("$row.{name}"), ty.clone());
    }
    joint.columns.insert(
        "$row.id".into(),
        ScalarType {
            kind: TypeKind::Id,
            optional: false,
        },
    );
    fn rewrite(e: &mut Expr, alias: &str) {
        if let Some(name) = member_field(e, alias) {
            let site = e.site().clone();
            let name = format!("$row.{name}");
            *e = Expr::Member {
                base: Box::new(Expr::Focal { site: site.clone() }),
                name,
                site,
            };
            return;
        }
        match e {
            Expr::Binary { left, right, .. } => {
                rewrite(left, alias);
                rewrite(right, alias);
            }
            Expr::Unary { value, .. } => rewrite(value, alias),
            _ => {}
        }
    }
    let mut expr = predicate.clone();
    rewrite(&mut expr, alias);
    let filter = maintains::predicate(&joint, &expr).map_err(|d| refusal(&d.site, d.message))?;
    Ok((
        RowKey {
            table: table.clone(),
            source_key,
            member_key,
            fanout: fanout as u64,
            predicate: filter.clone(),
        },
        filter,
    ))
}

pub(super) fn target(
    tables: &BTreeMap<String, TableInfo>,
    m: &MaintainDecl,
) -> Fallible<TableDecl> {
    let (key, _) = bind(tables, m)?;
    let u = &tables[&key.table];
    if ["member", "value", "recountPending"]
        .iter()
        .any(|name| u.columns.contains_key(*name))
        || u.decl.columns.iter().any(|c| c.maintained.is_some())
    {
        return Err(refusal(
            &m.site,
            "row-keyed view reserves member, value and recountPending; the keyed row must have ordinary fields",
        ));
    }
    // Only focal fields used by the member's read rule belong to its authority image.
    fn fields(e: &Expr, out: &mut std::collections::BTreeSet<String>) {
        match e {
            Expr::Member { base, name, .. } if matches!(base.as_ref(), Expr::Focal { .. }) => {
                out.insert(name.clone());
            }
            Expr::Binary { left, right, .. } => {
                fields(left, out);
                fields(right, out);
            }
            Expr::Unary { value, .. } => fields(value, out),
            Expr::Exists { read, .. } | Expr::Created { read, .. } => {
                for key in &read.keys {
                    fields(&key.value, out);
                }
            }
            _ => {}
        }
    }
    let mut keep = std::collections::BTreeSet::new();
    for rule in u.decl.rules.iter().filter(|r| r.effect == Effect::Read) {
        fields(&rule.value, &mut keep);
    }
    let mut decl = u.decl.clone();
    decl.columns.retain(|c| keep.contains(&c.name));
    decl.name = m.name.clone();
    decl.site = m.site.clone();
    decl.columns.extend(
        [
            ("member", TypeKind::Ref { table: key.table }),
            ("value", TypeKind::Int),
            ("recountPending", TypeKind::Bool),
        ]
        .map(|(name, kind)| ColumnDecl { sequence: None, written_by: None, readable_by_audience: false,
            name: name.into(),
            type_: ScalarType {
                kind,
                optional: false,
            },
            default: None,
            maintained: None,
            site: m.site.clone(),
        }),
    );
    decl.indexes = vec![IndexDecl {
        name: "byGroup".into(),
        columns: vec!["member".into()],
        unique: true,
        refusal: None,
        words: None,
        computed: BTreeMap::new(),
        site: m.site.clone(),
    }];
    decl.rules.retain(|r| r.effect == Effect::Read);
    decl.immutable.clear();
    decl.caps.clear();
    decl.final_exists.clear();
    decl.search.clear();
    decl.expire = None;
    decl.sync = None;
    decl.online_only = m.online_only;
    decl.retain = None;
    Ok(decl)
}

pub(super) fn lower(
    catalog: &super::catalog::Catalog,
    schema: &mut snapback4_core::Schema,
    m: &MaintainDecl,
) -> Fallible<()> {
    let (key, _) = bind(&catalog.tables, m)?;
    if !key.audience_supported(schema, &m.source) {
        return Err(refusal(&m.site, "row-keyed source/member audiences are unsupported: every member-row reader must be able to read the entire counted parent group; use the same parent grant, a membership witness, or a public source"));
    }
    let u = &schema.tables[&key.table];
    let read = u.rules.read.clone();
    let sync = if m.online_only {
        None
    } else {
        u.sync.clone().map(|mut s| {
            s.horizon = None;
            s
        })
    };
    let target = schema.tables.get_mut(&m.name).unwrap();
    target.rules.read = read;
    target.sync = sync;
    if let Some(sync) = &target.sync {
        let mut fields = match &sync.audience {
            snapback4_core::schema::Audience::Public => vec![],
            snapback4_core::schema::Audience::Column(c) => vec![c.clone()],
            snapback4_core::schema::Audience::Target { prefix, .. } => prefix.clone(),
        };
        fields.push("id".into());
        target.indexes.insert(
            "$view:audience".into(),
            snapback4_core::schema::Index::of(
                &fields.iter().map(String::as_str).collect::<Vec<_>>(),
                false,
            ),
        );
    }
    target
        .constraints
        .retain(|c| matches!(c, Constraint::Unique { .. }));
    schema.maintains.push(snapback4_core::schema::Maintain {
        own_keys: None,
        row_key: Some(key),
        parent_key: None,
        aliases: BTreeMap::new(),
        private: None,
        filter: None,
        computed: BTreeMap::new(),
        residency: target.residency.clone(),
        kind: snapback4_core::schema::MaintainKind::Count,
        source: m.source.clone(),
        by: vec!["member".into()],
        target: m.name.clone(),
        readable: None,
    });
    Ok(())
}
