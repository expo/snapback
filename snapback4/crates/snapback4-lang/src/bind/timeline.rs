//! Materialized Following: no authored graph bounds; all source audiences stay public.
mod prediction;
pub(super) use prediction::aggregate_sites;
use crate::{ast::*, diag::{Diagnostic, Fallible}};
use snapback4_core::schema::{timeline::{Timeline, HISTORY_WINDOW}, Audience, ColumnDefault, ColumnType, Horizon, RuleExpr, RuleTerm, Schema, Table};
use super::catalog::Catalog;
use std::collections::{BTreeMap, BTreeSet};

pub fn expand(mut documents: Vec<Document>, diagnostics: &mut Vec<Diagnostic>) -> Vec<Document> {
    let declarations: Vec<_> = documents.iter().flat_map(|doc| doc.timelines.clone()).collect();
    let mut names = BTreeMap::<String, usize>::new();
    for doc in &documents {
        let all = doc.tables.iter().map(|v| &v.name).chain(doc.maintains.iter().map(|v| &v.name))
            .chain(doc.programs.iter().map(|v| &v.name)).chain(doc.functions.iter().map(|v| &v.name))
            .chain(doc.schedules.iter().map(|v| &v.name)).chain(doc.timelines.iter().map(|v| &v.name))
            .chain(doc.views.iter().map(|v| &v.name))
            .chain(doc.effects.iter().map(|v| &v.name)).chain(doc.shapes.iter().map(|v| &v.name))
            .chain(doc.actions.iter().map(|v| &v.name)).chain(doc.routes.iter().map(|v| &v.name));
        for name in all { *names.entry(name.clone()).or_default() += 1; }
    }
    let mut accepted = BTreeSet::new();
    for decl in &declarations {
        let owned: BTreeSet<_> = snapback4_core::schema::timeline::OWNED_SUFFIXES.iter().map(|s| format!("{}{s}", decl.name)).collect();
        let nested = declarations.iter().any(|other| other.name != decl.name && snapback4_core::schema::timeline::OWNED_SUFFIXES.iter().any(|s| format!("{}{s}", other.name) == decl.name));
        if nested || names.get(&decl.name) != Some(&1) || owned.iter().any(|n| names.contains_key(n)) {
            diagnostics.push(refusal(&decl, "E_TIMELINE_SHAPE", "timeline or owned name collides", "choose a distinct timeline name and leave its Posts, Feed, RemovedEvents, Work and Edges names unused"));
            continue;
        }
        let mut source = include_str!("timeline.q").replace("@T@", &decl.name);
        if decl.experimental_history_all {
            source = source.replace("  by byStatusTime: status, at, id",
                "  by byStatusTime: status, at, id\n  by byActorBirth: kind, actorId, admitted, id");
        }
        let (doc, errors) = crate::parse_document("timeline.q", &source);
        if !errors.is_empty() { diagnostics.extend(errors); continue; }
        for name in owned { names.insert(name, 1); }
        documents.push(doc);
        accepted.insert(decl.name.clone());
    }
    for doc in &mut documents { doc.timelines.retain(|decl| accepted.contains(&decl.name)); }
    documents
}

fn refusal(decl: &TimelineDecl, code: &str, message: impl Into<String>, rewrite: impl Into<String>) -> Diagnostic {
    Diagnostic::new(&decl.site, code, message, rewrite).guide("feeds")
}

fn owner(rule: &RuleExpr, name: &str) -> bool {
    match rule {
        RuleExpr::Eq(field, RuleTerm::Viewer) | RuleExpr::Eq(RuleTerm::Viewer, field) =>
            matches!(field, RuleTerm::Field(f) | RuleTerm::OldField(f) | RuleTerm::NextField(f) if f == name),
        RuleExpr::And(rules) => rules.iter().any(|r| owner(r, name)),
        _ => false,
    }
}

fn source<'a>(schema: &'a Schema, decl: &TimelineDecl, name: &str, actor: &str, time: Option<&str>, columns: &[(&str, ColumnType)]) -> Fallible<&'a Table> {
    let acquisition = time.map_or_else(|| "sync public, sync public last 1000, or online only".into(), |at| format!("sync public, sync public last 1000 by .{at}, or online only"));
    let fail = |message| refusal(decl, "E_TIMELINE_SHAPE", message,
        format!("declare {name} public with {acquisition}; require .{actor} = viewer for inserts and allowed deletes/updates; keep mapped fields immutable"));
    let t = schema.table(name).ok_or_else(|| fail(format!("missing timeline source {name}")))?;
    if !t.rules.read.is_public() || t.is_expiring() || schema.maintain_for(name).is_some() {
        return Err(fail(format!("{name} must be explicitly public, non-expiring application data")));
    }
    // @ref LLP 3000.016#2.1 — events have time floors; application follows admit any public residency.
    let valid_sync = match (&t.sync, time) {
        (None, _) => true,
        (Some(sync), time) if sync.audience == Audience::Public => match &sync.horizon {
            None => true,
            Some(horizon) => time.is_none_or(|at| t.index(&horizon.by)
                .is_some_and(|index| index.is_plain() && index.columns() == [at, "id"])),
        },
        _ => false,
    };
    if !valid_sync {
        return Err(fail(format!("{name} needs {acquisition}; a source floor must order by its mapped time then id")));
    }
    if !owner(&t.rules.insert, actor) || [&t.rules.update, &t.rules.delete].iter().any(|r| **r != RuleExpr::Deny && !owner(r, actor)) {
        return Err(fail(format!("{name} must retain its owner's write authority")));
    }
    for (col, ty) in columns {
        if t.columns.get(*col) != Some(ty) { return Err(fail(format!("{name}.{col} must be required {ty:?}"))); }
        if t.rules.update != RuleExpr::Deny && !t.immutable_fields().any(|f| f == *col) {
            return Err(fail(format!("{name}.{col} must be immutable")));
        }
    }
    Ok(t)
}

// @ref LLP 3000.013#4-following-without-caps — background fan-out removes every required capacity but preserves source disclosure.
pub fn admit(catalog: &Catalog, schema: &mut Schema, diagnostics: &mut Vec<Diagnostic>) {
    for decl in catalog.documents.iter().flat_map(|doc| &doc.timelines) {
        let result = (|| -> Fallible<Timeline> {
            let owned: BTreeSet<_> = snapback4_core::schema::timeline::OWNED_SUFFIXES.iter().map(|s| format!("{}{s}", decl.name)).collect();
            let mapped: BTreeSet<_> = [&decl.posts[0], &decl.reposts[0], &decl.edges[0]].into_iter().cloned().collect();
            if mapped.len() != 3 || !owned.is_disjoint(&mapped) || owned.iter().any(|n| !schema.tables.contains_key(n)) {
                return Err(refusal(decl, "E_TIMELINE_SHAPE", "timeline sources and owned tables must be distinct", "map three distinct public tables: events, reposts and edges"));
            }
            let posts = source(schema, decl, &decl.posts[0], &decl.posts[1], Some(&decl.posts[2]), &[(&decl.posts[1], ColumnType::Principal), (&decl.posts[2], ColumnType::Time)])?;
            if posts.rules.delete != RuleExpr::Deny {
                return Err(refusal(decl, "E_TIMELINE_SHAPE", "original cards must survive removal for independent reposts", "deny post deletion and set removed: true instead"));
            }
            if !decl.posts[3].is_empty() && (posts.columns.get(&decl.posts[3]) != Some(&ColumnType::Bool)
                || posts.defaults.get(&decl.posts[3]) != Some(&ColumnDefault::Literal(snapback4_core::Value::Bool(false)))) {
                return Err(refusal(decl, "E_TIMELINE_REMOVAL", "removal needs a bool default false", format!("table {}:\n  {}: bool default false", decl.posts[0], decl.posts[3])));
            }
            let filter = decl.filter.as_ref().map(|expr| {
                let filter = super::maintains::predicate(&catalog.tables[&decl.posts[0]], expr)
                    .map_err(|e| refusal(decl, "E_TIMELINE_FILTER", e.message, "use a row-local predicate over immutable columns, for example .parentId = null and not .removed"))?;
                let mut fields = BTreeSet::new(); filter.fields(&mut fields);
                if fields.iter().any(|f| f != "id" && f != &decl.posts[3] && !posts.immutable_fields().any(|c| c == f)) {
                    return Err(refusal(decl, "E_TIMELINE_FILTER", "originals filter depends on a mutable column", "declare each filter column immutable; only the one-way removal flag may change"));
                }
                Ok(filter)
            }).transpose()?;
            let reposts = source(schema, decl, &decl.reposts[0], &decl.reposts[1], Some(&decl.reposts[3]), &[(&decl.reposts[1], ColumnType::Principal), (&decl.reposts[2], ColumnType::Ref { table: decl.posts[0].clone() }), (&decl.reposts[3], ColumnType::Time)])?;
            let edges = source(schema, decl, &decl.edges[0], &decl.edges[1], None, &[(&decl.edges[1], ColumnType::Principal), (&decl.edges[2], ColumnType::Principal)])?;
            for (t, pair) in [(reposts, &decl.reposts[1..3]), (edges, &decl.edges[1..3])] {
                if t.rules.update != RuleExpr::Deny || !owner(&t.rules.delete, &pair[0]) || !t.indexes.values().any(|i| i.unique && i.is_plain() && i.columns() == pair) {
                    return Err(refusal(decl, "E_TIMELINE_SHAPE", "edges and reposts need immutable attribution and a total unique pair", format!("unique byPair: {}\n  update <- deny", pair.join(", "))));
                }
            }
            // Always own a stable, unreachable-from-source index name. Reusing
            // an arbitrary authored name can silently reinterpret a saved cursor.
            let followed_index = format!("$timeline:{}:followers", decl.name);
            reserve_followed_index(decl, &mut schema.tables.get_mut(&decl.edges[0]).unwrap().indexes, &followed_index)?;
            // @ref LLP 3000.016#21a-owned-events-follow-their-source-rows — slots are required bool / optional id, with no literal defaults.
            schema.tables.get_mut(&decl.posts[0]).unwrap().columns.insert(format!("$timeline:{}:post", decl.name), ColumnType::Bool);
            schema.tables.get_mut(&decl.reposts[0]).unwrap().columns.insert(format!("$timeline:{}:repost", decl.name), ColumnType::Optional(Box::new(ColumnType::Id)));
            schema.tables.get_mut(&format!("{}Feed", decl.name)).unwrap().sync.as_mut().unwrap().horizon =
                Some(Horizon { last: HISTORY_WINDOW as u32, by: "byReaderPage".into() });
            Ok(Timeline { name: decl.name.clone(), version: if decl.experimental_history_all { 3 } else { 2 }, filter, authors: Default::default(), posts: decl.posts.clone(), reposts: decl.reposts.clone(), edges: decl.edges.clone(),
                author_cap: 1000, edge_cap: 100000, followed_index, purge: String::new(), owned, mapped })
        })();
        match result { Ok(t) => schema.timelines.push(t), Err(e) => diagnostics.push(e) }
    }
}

pub fn notes(catalog: &Catalog, _schema: &Schema) -> Vec<Diagnostic> {
    catalog.documents.iter().flat_map(|d| &d.timelines).filter(|d| !d.authors[0].is_empty() || d.size.is_some()).map(|d|
        refusal(d, "N_TIMELINE_COMPAT", "authors and size no longer affect timeline delivery", "remove authors and size; keep events, reposts and edges")).collect()
}

pub fn write_site(schema: &Schema, table: &str, kind: &str, fact: &mut snapback4_core::schema::Execution) {
    use snapback4_core::schema::{ResidencySite, SiteClass};
    for timeline in schema.timelines.iter().filter(|timeline| timeline.maps(table)) {
        for (input, index) in timeline.inputs(table, kind) {
            let sync = schema.tables[&input].sync.as_ref();
            let online = table == timeline.edges[0] || sync.is_none();
            let horizon = sync.is_some_and(|sync| sync.horizon.is_some());
            fact.sites.push(ResidencySite { site: format!("{kind} {table}: {input}/{index}"), table: input.clone(), index,
                kind: "timeline transition".into(), class: if online { SiteClass::Server } else if horizon { SiteClass::Horizon } else { SiteClass::Held },
                reason: format!("timeline {} implicit input {input}: {}", timeline.name, if online { "server-owned background work" } else if horizon { "a miss past the acquisition floor queues without rows; must be currently held to predict" } else { "must be currently held to predict; retained-only coverage queues without rows" }),
                rewrite: if table == timeline.edges[0] { "queue the whole mutation without predicted rows: backfill and cleanup are server-owned".into() } else { "queue the whole mutation without predicted rows when any input is online, unheld or retained-only".into() } });
        }
    }
}

/// Reuse the existing filtered scan, shape and cursor machinery.
pub fn read(timeline: &Timeline, read: &ReadExpr) -> Fallible<Expr> {
    let range = read.range.clone().unwrap_or(RangeSpec { order: Order::Desc, take: 20, cursor: None, site: read.site.clone() });
    if read.keys.len() != 1 || !read.seeks.is_empty() || read.matching.is_some() || read.index.is_some()
        || read.filter.is_some() || range.order != Order::Desc {
        return Err(Diagnostic::new(&read.site, "E_TIMELINE_READ", "a timeline reads one viewer, newest first by time then event id",
            format!("{}[viewer] after c last 20", timeline.name)).guide("feeds"));
    }
    // @ref LLP 3000.013#2.1 — nullable epochs need a declared id tiebreak;
    // keep the separate unique indexes as constraints, not page positions.
    let source = format!("query q(c: cursor ?):\n  return {}[viewer] after c last {} by byReaderPage where (.actorId = viewer or exists {}[readerId = viewer, actorId = .actorId, epoch = .epoch]) and not exists {}[eventId = .eventId]\n",
        timeline.table("Feed"), range.take, timeline.table("Edges"), timeline.table("RemovedEvents"));
    let (doc, errors) = crate::parse_document("timeline.q", &source);
    let shape_error = || Diagnostic::new(&read.site, "E_TIMELINE_READ", "timeline read expansion has an invalid shape", format!("{}[viewer] after c last 20", timeline.name)).guide("feeds");
    if !errors.is_empty() { return Err(shape_error()); }
    let Some(Stmt::Return { value: Expr::Read(mut scan), .. }) = doc.programs.first().and_then(|p| p.body.first()).cloned() else { return Err(shape_error()); };
    scan.range = Some(range);
    scan.site = read.site.clone();
    scan.keys = read.keys.clone();
    let fields = ["id", "postId", "actorId", "authorId", "repost", "at"].into_iter().map(|name| ShapeField::Field {
        name: name.into(), value: Expr::Member { base: Box::new(Expr::Focal { site: read.site.clone() }), name: if name == "id" { "eventId" } else { name }.into(), site: read.site.clone() }, site: read.site.clone(),
    }).collect();
    Ok(Expr::Shape { base: Box::new(Expr::Read(scan)), fields, site: read.site.clone() })
}

fn reserve_followed_index(decl: &TimelineDecl, indexes: &mut BTreeMap<String, snapback4_core::schema::Index>, name: &str) -> Fallible<()> {
    let definition = snapback4_core::schema::Index {
        components: vec![snapback4_core::schema::IndexComponent::Column(decl.edges[2].clone()), snapback4_core::schema::IndexComponent::Column(decl.edges[1].clone())], unique: false,
    };
    if indexes.get(name).is_some_and(|existing| existing != &definition) {
        return Err(refusal(decl, "E_TIMELINE_SHAPE", "reserved timeline follower index differs from its canonical definition", "restore the compiler-owned follower index; declare application indexes under a separate name"));
    }
    indexes.insert(name.into(), definition);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reserved_follower_index_requires_its_exact_definition() {
        let (doc, errors) = crate::parse_document("test.q", "maintain feed: timeline\n  events posts by authorId, at removed by removed\n  reposts reposts by actorId, postId, at\n  edges follows by followerId, followedId\n");
        assert!(errors.is_empty());
        let decl = &doc.timelines[0];
        let name = "$timeline:feed:followers";
        let mut indexes = BTreeMap::new();
        reserve_followed_index(decl, &mut indexes, name).unwrap();
        reserve_followed_index(decl, &mut indexes, name).unwrap();
        indexes.get_mut(name).unwrap().components.reverse();
        let previous = indexes.clone();
        assert_eq!(reserve_followed_index(decl, &mut indexes, name).unwrap_err().code, "E_TIMELINE_SHAPE");
        assert_eq!(indexes, previous, "refusal must not overwrite the conflicting index");
    }
}
