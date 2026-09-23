//! Compile-time expansion and admission of the deliberately narrow recipe shape.
use crate::{ast::*, diag::{Diagnostic, Fallible}, recipe};
use snapback4_core::schema::{timeline::Timeline, ColumnDefault, ColumnType, Constraint, Schema};
use super::catalog::Catalog;

pub fn expand(mut documents: Vec<Document>, diagnostics: &mut Vec<Diagnostic>) -> Vec<Document> {
    let declarations: Vec<_> = documents.iter().flat_map(|doc| doc.timelines.clone()).collect();
    let mut names = std::collections::BTreeSet::new();
    for decl in declarations {
        if !names.insert(decl.name.clone()) || documents.iter().any(|doc| doc.tables.iter().any(|t| t.name == decl.name)
            || doc.maintains.iter().any(|m| m.name == decl.name)) {
            diagnostics.push(refusal(&decl, "E_TIMELINE_SHAPE", "timeline name collides with another declaration", "choose a distinct timeline name"));
            continue;
        }
        // The recipe remains the schema source of truth. Only its tables,
        // internal route count and system purge survive this expansion.
        let source = recipe::following(&decl.name, "schema").expect("checked recipe");
        let (mut owned, errors) = crate::parse_document("schema.q", &source);
        diagnostics.extend(errors);
        owned.tables.retain(|table| table.name != format!("{}Follows", decl.name));
        for table in &mut owned.tables {
            table.rules.retain(|rule| rule.effect == Effect::Read);
        }
        owned.functions.clear();
        owned.programs.retain(|p| p.kind == ProgramKind::Job);
        for schedule in &mut owned.schedules { schedule.target = format!("{}PurgeRemoved", decl.name); }
        let names: std::collections::BTreeSet<_> = owned.tables.iter().map(|t|t.name.as_str())
            .chain(owned.maintains.iter().map(|m|m.name.as_str()))
            .chain(owned.programs.iter().map(|p|p.name.as_str())).collect();
        if documents.iter().any(|doc| doc.tables.iter().any(|t|names.contains(t.name.as_str()))
            || doc.maintains.iter().any(|m|names.contains(m.name.as_str()))
            || doc.programs.iter().any(|p|names.contains(p.name.as_str()))
            || doc.functions.iter().any(|f|names.contains(f.name.as_str()))) {
            diagnostics.push(refusal(&decl, "E_TIMELINE_SHAPE", "a generated timeline table or purge job name already belongs to the application", "choose a timeline name whose generated table and purge names are unused"));
            continue;
        }
        documents.push(owned);
    }
    documents
}

fn refusal(decl: &TimelineDecl, code: &str, message: impl Into<String>, rewrite: impl Into<String>) -> Diagnostic {
    Diagnostic::new(&decl.site, code, message, rewrite).guide("feeds")
}

// @ref LLP 3000.007.003#33-f3-the-following-recipes-contract-as-a-declaration — admission preserves the bridge's public disclosure and bounded graph.
pub fn admit(catalog: &Catalog, schema: &mut Schema, diagnostics: &mut Vec<Diagnostic>) {
    for decl in catalog.documents.iter().flat_map(|doc| &doc.timelines) {
        let result = (|| -> Fallible<Timeline> {
            let mapping = recipe::bridge::Mapping::parse(&decl.authors.join(":"), &decl.posts[..3].join(":"),
                &decl.edges.join(":"), &decl.reposts.join(":"))
                .and_then(|mapping| mapping.render(schema, &decl.name));
            if let Err(message) = mapping {
                return Err(refusal(decl, "E_TIMELINE_SHAPE", message,
                    "use four distinct public, fully sync public application tables with the owner rules, immutable mapped columns and unique keys shown in guide feeds"));
            }
            let posts = &schema.tables[&decl.posts[0]];
            if posts.columns.get(&decl.posts[3]) != Some(&ColumnType::Bool)
                || posts.defaults.get(&decl.posts[3]) != Some(&ColumnDefault::Literal(snapback4_core::Value::Bool(false))) {
                return Err(refusal(decl, "E_TIMELINE_REMOVAL", "the removal signal must be a required bool default false",
                    format!("table {}:\n  {}: bool default false", decl.posts[0], decl.posts[3])));
            }
            let edges = &schema.tables[&decl.edges[0]];
            let follower_index = edges.indexes.iter().find(|(_, index)| index.is_plain() && index.columns().first() == Some(&decl.edges[2]));
            let cap = |by: &[String], max| edges.constraints.iter().any(|c| matches!(c, Constraint::Cap { by: fields, max: bound } if fields == by && *bound == max));
            if follower_index.is_none() || !cap(&[decl.edges[1].clone()], 1000) || !cap(&[decl.edges[2].clone()], 1000) || !cap(&[], 100000) {
                return Err(refusal(decl, "E_TIMELINE_FOLLOWS", "the mapped follows table must carry promotion's follower index and all three edge caps",
                    format!("table {}:\n  by byTimelineFollowed: {}, {}\n  cap 1000 by {}\n  cap 1000 by {}\n  cap 100000",
                        decl.edges[0], decl.edges[2], decl.edges[1], decl.edges[1], decl.edges[2])));
            }
            Ok(Timeline { name: decl.name.clone(), authors: decl.authors.clone(), posts: decl.posts.clone(),
                reposts: decl.reposts.clone(), edges: decl.edges.clone(), follower_index: follower_index.unwrap().0.clone(),
                purge: format!("{}PurgeRemoved", decl.name) })
        })();
        match result { Ok(timeline) => schema.timelines.push(timeline), Err(error) => diagnostics.push(error) }
    }
}

pub fn write_site(schema: &Schema, table: &str, kind: &str, fact: &mut snapback4_core::schema::Execution) {
    use snapback4_core::schema::{ResidencySite, SiteClass};
    for timeline in schema.timelines.iter().filter(|timeline| timeline.maps(table)) {
        fact.sites.push(ResidencySite { site: format!("{kind} {table}"), table: timeline.table("PullCounts"),
            index: "byReader".into(), kind: "timeline transition".into(), class: SiteClass::Server,
            reason: format!("timeline {} transitions execute on the server; implicit slot accounting is online only", timeline.name),
            rewrite: "queue this mutation without prediction; timeline device execution is not enabled".into() });
    }
}

/// Reuse the existing merge, tombstone predicate, shape and cursor machinery.
pub fn read(timeline: &Timeline, read: &ReadExpr) -> Fallible<Expr> {
    let range = read.range.clone().unwrap_or(RangeSpec { order: Order::Desc, take: 20, cursor: None, site: read.site.clone() });
    if read.keys.len() != 1 || !read.seeks.is_empty() || read.matching.is_some() || read.index.is_some()
        || read.filter.is_some() || range.order != Order::Desc {
        return Err(Diagnostic::new(&read.site, "E_TIMELINE_READ", "a timeline reads one viewer, newest first",
            format!("{}[viewer] after c last 20", timeline.name)).guide("feeds"));
    }
    let source = format!("query q(c: cursor ?):\n  return merge {} after c last {} by byReaderTime where not exists {}[eventId = .eventId]:\n    [viewer]\n    {}[p.authorId] for p in {}[viewer] by byReaderAuthor\n",
        timeline.table("Feed"), range.take, timeline.table("RemovedEvents"), timeline.table("Broadcast"), timeline.table("Pulls"));
    let (doc, errors) = crate::parse_document("timeline.q", &source);
    assert!(errors.is_empty(), "{errors:?}");
    let Stmt::Return { value: Expr::Merge(mut merge), .. } = doc.programs[0].body[0].clone() else { unreachable!() };
    merge.cursor = range.cursor;
    merge.site = read.site.clone();
    merge.lanes[0].prefix = vec![read.keys[0].value.clone()];
    if let Some((_, Expr::Read(domain))) = &mut merge.lanes[1].loop_ { domain.keys[0].value = read.keys[0].value.clone(); }
    let fields = ["id", "postId", "actorId", "authorId", "repost", "at"].into_iter().map(|name| ShapeField::Field {
        name: name.into(), value: Expr::Member { base: Box::new(Expr::Focal { site: read.site.clone() }), name: if name == "id" { "eventId" } else { name }.into(), site: read.site.clone() }, site: read.site.clone(),
    }).collect();
    Ok(Expr::Shape { base: Box::new(Expr::Merge(merge)), fields, site: read.site.clone() })
}
