//! Compile-time expansion and admission of the deliberately narrow recipe shape.
use crate::{ast::*, diag::{Diagnostic, Fallible}, recipe};
use snapback4_core::schema::{timeline::Timeline, ColumnDefault, ColumnType, Constraint, Schema};
use super::catalog::Catalog;

pub fn expand(mut documents: Vec<Document>, diagnostics: &mut Vec<Diagnostic>) -> Vec<Document> {
    use std::collections::{BTreeMap, BTreeSet};
    let declarations: Vec<_> = documents.iter().flat_map(|doc| doc.timelines.clone()).collect();
    let mut names = BTreeMap::<String, usize>::new();
    for doc in &documents {
        let all = doc.tables.iter().map(|v| &v.name).chain(doc.maintains.iter().map(|v| &v.name))
            .chain(doc.programs.iter().map(|v| &v.name)).chain(doc.functions.iter().map(|v| &v.name))
            .chain(doc.schedules.iter().map(|v| &v.name)).chain(doc.timelines.iter().map(|v| &v.name))
            .chain(doc.effects.iter().map(|v| &v.name)).chain(doc.shapes.iter().map(|v| &v.name))
            .chain(doc.actions.iter().map(|v| &v.name)).chain(doc.routes.iter().map(|v| &v.name));
        for name in all { *names.entry(name.clone()).or_default() += 1; }
    }
    let mut accepted = BTreeSet::new();
    for decl in declarations.iter().cloned() {
        let owned: BTreeSet<_> = snapback4_core::schema::timeline::OWNED_SUFFIXES.iter().map(|suffix| format!("{}{suffix}", decl.name)).collect();
        let purge = format!("{}PurgeRemoved", decl.name);
        let schedule = format!("{purge}Every");
        let generated: BTreeSet<_> = owned.iter().cloned().chain([purge.clone(), schedule.clone()]).collect();
        let nested_collision = declarations.iter().any(|other| other.name != decl.name &&
            snapback4_core::schema::timeline::OWNED_SUFFIXES.iter().copied().chain(["PurgeRemoved", "PurgeRemovedEvery"])
                .any(|suffix| format!("{}{suffix}", other.name) == decl.name));
        if nested_collision || names.get(&decl.name) != Some(&1) || generated.iter().any(|name| names.contains_key(name)) {
            diagnostics.push(refusal(&decl, "E_TIMELINE_SHAPE", "timeline or generated name collides with another declaration", "choose timeline and generated names unused by tables, maintains, programs, functions, schedules, timelines, effects, shapes, actions and routes"));
            continue;
        }
        let source = match recipe::following(&decl.name, "schema") {
            Ok(source) => source,
            Err(error) => { diagnostics.push(refusal(&decl, "E_TIMELINE_SHAPE", error, "repair the Following recipe")); continue; }
        };
        let (recipe, errors) = crate::parse_document("schema.q", &source);
        if !errors.is_empty() {
            diagnostics.extend(errors);
            diagnostics.push(refusal(&decl, "E_TIMELINE_SHAPE", "the timeline recipe could not be parsed", "repair the Following recipe"));
            continue;
        }
        let expanded = projection(recipe, &decl, &owned, &purge, &schedule);
        match expanded {
            Ok(doc) => {
                // Publish names only with the complete expansion; failures reserve nothing.
                for name in &generated { names.insert(name.clone(), 1); }
                documents.push(doc); accepted.insert(decl.name);
            }
            Err(error) => diagnostics.push(error),
        }
    }
    // A rejected expansion cannot later be admitted from its original document.
    for doc in &mut documents { doc.timelines.retain(|decl| accepted.contains(&decl.name)); }
    documents
}

fn projection(recipe: Document, decl: &TimelineDecl, owned: &std::collections::BTreeSet<String>, purge: &str, schedule: &str) -> Fallible<Document> {
    let total = format!("{}PullTotals", decl.name);
    let mut doc = Document { file: recipe.file, ..Document::default() };
    doc.tables = recipe.tables.into_iter().filter(|table| owned.contains(&table.name)).collect();
    doc.maintains = recipe.maintains.into_iter().filter(|m| m.name == total).collect();
    doc.programs = recipe.programs.into_iter().filter(|p| p.name == purge && p.kind == ProgramKind::Job).collect();
    doc.schedules = recipe.schedules.into_iter().filter(|s| s.name == schedule && (s.target == purge || s.target == format!("schema.{purge}"))).collect();
    // PullTotals is a maintain target; Follows remains the mapped application edge.
    let expected: std::collections::BTreeSet<_> = snapback4_core::schema::timeline::OWNED_SUFFIXES
        .iter().filter(|s| **s != "PullTotals").map(|s| format!("{}{s}", decl.name)).collect();
    let actual = doc.tables.iter().map(|t| t.name.clone()).collect::<std::collections::BTreeSet<_>>();
    if actual != expected || doc.tables.len() != expected.len() || actual.contains(&format!("{}Follows", decl.name)) || doc.maintains.len() != 1 || doc.programs.len() != 1 || doc.schedules.len() != 1 {
        return Err(refusal(decl, "E_TIMELINE_SHAPE", "timeline recipe is missing an owned projection, route total, purge job or schedule", "repair the named Following recipe declarations"));
    }
    // The recipe's tombstone id is its event id. Keep that event ordering
    // when the owned tombstone's physical identity becomes a digest.
    let Some(Stmt::For { domain: Expr::Read(read), .. }) = doc.programs.first_mut().and_then(|p| p.body.first_mut()) else {
        return Err(refusal(decl, "E_TIMELINE_SHAPE", "timeline purge is missing its event sweep", "repair the Following purge job"));
    };
    if read.table != format!("{}RemovedEvents", decl.name) {
        return Err(refusal(decl, "E_TIMELINE_SHAPE", "timeline purge must sweep its removed events", "repair the Following purge job"));
    }
    read.index = Some("byEvent".into());
    for schedule in &mut doc.schedules { schedule.target = purge.into(); }
    for table in &mut doc.tables { table.rules.retain(|rule| rule.effect == Effect::Read); }
    Ok(doc)
}

fn refusal(decl: &TimelineDecl, code: &str, message: impl Into<String>, rewrite: impl Into<String>) -> Diagnostic {
    Diagnostic::new(&decl.site, code, message, rewrite).guide("feeds")
}

// @ref LLP 3000.007.003#33-f3-the-following-recipes-contract-as-a-declaration — admission preserves the bridge's public disclosure and bounded graph.
pub fn admit(catalog: &Catalog, schema: &mut Schema, diagnostics: &mut Vec<Diagnostic>) {
    for decl in catalog.documents.iter().flat_map(|doc| &doc.timelines) {
        let result = (|| -> Fallible<Timeline> {
            let owned: std::collections::BTreeSet<_> = snapback4_core::schema::timeline::OWNED_SUFFIXES.iter().map(|suffix| format!("{}{suffix}", decl.name)).collect();
            let mapped = [&decl.authors[0], &decl.posts[0], &decl.reposts[0], &decl.edges[0]].into_iter().cloned().collect::<std::collections::BTreeSet<_>>();
            let purge = format!("{}PurgeRemoved", decl.name);
            if schema.timelines.iter().any(|t| t.name == decl.name) || !owned.is_disjoint(&mapped)
                || owned.iter().any(|name| !schema.tables.contains_key(name))
                || !catalog.documents.iter().any(|doc| doc.programs.iter().any(|p| p.name == purge && p.kind == ProgramKind::Job))
                || !catalog.documents.iter().any(|doc| doc.schedules.iter().any(|s| s.name == format!("{purge}Every") && s.target == purge)) {
                return Err(refusal(decl, "E_TIMELINE_SHAPE", "timeline expansion is missing, duplicated or overlaps its mapping", "use a distinct timeline with its complete owned projections and purge program"));
            }
            let mapping = recipe::bridge::Mapping::parse(&decl.authors.join(":"), &decl.posts[..3].join(":"),
                &decl.edges.join(":"), &decl.reposts.join(":"))
                .and_then(|mapping| mapping.render(schema, &decl.name));
            if let Err(message) = mapping {
                return Err(refusal(decl, "E_TIMELINE_SHAPE", message,
                    "use four distinct application tables with an explicit public audience and full sync public, no horizon, expiry or maintained definition, and the owner rules, immutable mapped columns and unique keys shown in guide feeds"));
            }
            let posts = schema.table(&decl.posts[0]).ok_or_else(|| refusal(decl, "E_TIMELINE_SHAPE", "missing posts table", "declare the mapped posts table"))?;
            if posts.columns.get(&decl.posts[3]) != Some(&ColumnType::Bool)
                || posts.defaults.get(&decl.posts[3]) != Some(&ColumnDefault::Literal(snapback4_core::Value::Bool(false))) {
                return Err(refusal(decl, "E_TIMELINE_REMOVAL", "the removal signal must be a required bool default false",
                    format!("table {}:\n  {}: bool default false", decl.posts[0], decl.posts[3])));
            }
            let edges = schema.table(&decl.edges[0]).ok_or_else(|| refusal(decl, "E_TIMELINE_SHAPE", "missing follows table", "declare the mapped follows table"))?;
            let followed_index = edges.indexes.iter().find(|(_, index)| index.is_plain() && index.columns().first() == Some(&decl.edges[2]));
            let cap = |by: &[String], max| edges.constraints.iter().any(|c| matches!(c, Constraint::Cap { by: fields, max: bound } if fields == by && *bound == max));
            if followed_index.is_none() || !cap(&[decl.edges[1].clone()], 1000) || !cap(&[decl.edges[2].clone()], 1000) || !cap(&[], 100000) {
                return Err(refusal(decl, "E_TIMELINE_FOLLOWS", "the mapped follows table must carry promotion's follower index and all three edge caps",
                    format!("table {}:\n  by byTimelineFollowed: {}, {}\n  cap 1000 by {}\n  cap 1000 by {}\n  cap 100000",
                        decl.edges[0], decl.edges[2], decl.edges[1], decl.edges[1], decl.edges[2])));
            }
            let followed_index = followed_index.map(|(name, _)| name.clone()).ok_or_else(|| refusal(decl, "E_TIMELINE_FOLLOWS", "missing followed-leading index", "index the followed column first"))?;
            Ok(Timeline { name: decl.name.clone(), authors: decl.authors.clone(), posts: decl.posts.clone(),
                reposts: decl.reposts.clone(), edges: decl.edges.clone(), followed_index, purge, owned, mapped })
        })();
        match result { Ok(timeline) => schema.timelines.push(timeline), Err(error) => diagnostics.push(error) }
    }
}

pub fn write_site(schema: &Schema, table: &str, kind: &str, fact: &mut snapback4_core::schema::Execution) {
    use snapback4_core::schema::{ResidencySite, SiteClass};
    for timeline in schema.timelines.iter().filter(|timeline| timeline.maps(table)) {
        for (input, index) in timeline.inputs(table, kind) {
            let online = schema.tables[&input].sync.is_none();
            fact.sites.push(ResidencySite { site: format!("{kind} {table}: {input}/{index}"), table: input.clone(), index,
                kind: "timeline transition".into(), class: if online { SiteClass::Server } else { SiteClass::Held },
                reason: format!("timeline {} implicit input {input}: {}", timeline.name, if online { "online-only slot accounting" } else { "must be held to predict" }),
                rewrite: "queue the whole mutation without predicted rows when any input is online, unheld or retained-only".into() });
        }
    }
}

/// Reuse the existing merge, tombstone predicate, shape and cursor machinery.
pub fn read(timeline: &Timeline, read: &ReadExpr) -> Fallible<Expr> {
    let range = read.range.clone().unwrap_or(RangeSpec { order: Order::Desc, take: 20, cursor: None, site: read.site.clone() });
    if read.keys.len() != 1 || !read.seeks.is_empty() || read.matching.is_some() || read.index.is_some()
        || read.filter.is_some() || range.order != Order::Desc {
        return Err(Diagnostic::new(&read.site, "E_TIMELINE_READ", "a timeline reads one viewer, newest first by time then event id",
            format!("{}[viewer] after c last 20", timeline.name)).guide("feeds"));
    }
    let source = format!("query q(c: cursor ?):\n  return merge {} after c last {} by byReaderTime where not exists {}[eventId = .eventId]:\n    [viewer]\n    {}[p.authorId] for p in {}[viewer] by byReaderAuthor\n",
        timeline.table("Feed"), range.take, timeline.table("RemovedEvents"), timeline.table("Broadcast"), timeline.table("Pulls"));
    let (doc, errors) = crate::parse_document("timeline.q", &source);
    let shape_error = || Diagnostic::new(&read.site, "E_TIMELINE_READ", "timeline read expansion has an invalid shape", format!("{}[viewer] after c last 20", timeline.name)).guide("feeds");
    if !errors.is_empty() { return Err(shape_error()); }
    let Some(Stmt::Return { value: Expr::Merge(mut merge), .. }) = doc.programs.first().and_then(|p| p.body.first()).cloned() else { return Err(shape_error()); };
    merge.cursor = range.cursor;
    merge.site = read.site.clone();
    let key = read.keys.first().ok_or_else(shape_error)?.value.clone();
    merge.lanes.first_mut().ok_or_else(shape_error)?.prefix = vec![key.clone()];
    let Some((_, Expr::Read(domain))) = &mut merge.lanes.get_mut(1).ok_or_else(shape_error)?.loop_ else { return Err(shape_error()); };
    domain.keys.first_mut().ok_or_else(shape_error)?.value = key;
    let fields = ["id", "postId", "actorId", "authorId", "repost", "at"].into_iter().map(|name| ShapeField::Field {
        name: name.into(), value: Expr::Member { base: Box::new(Expr::Focal { site: read.site.clone() }), name: if name == "id" { "eventId" } else { name }.into(), site: read.site.clone() }, site: read.site.clone(),
    }).collect();
    Ok(Expr::Shape { base: Box::new(Expr::Merge(merge)), fields, site: read.site.clone() })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn expansion_keeps_only_named_projections_and_refuses_a_missing_job() {
        let declaration = "maintain feed: timeline\n  authors profiles by principal\n  events posts by authorId, at removed by removed\n  reposts reposts by actorId, postId, at\n  edges follows by followerId, followedId\n";
        let (declarations, errors) = crate::parse_document("schema.q", declaration); assert!(errors.is_empty());
        let decl = &declarations.timelines[0];
        let owned = snapback4_core::schema::timeline::OWNED_SUFFIXES.into_iter().map(|s| format!("feed{s}")).collect();
        let source = recipe::following("feed", "schema").unwrap();
        let (recipe, errors) = crate::parse_document("schema.q", &source); assert!(errors.is_empty());
        let expanded = projection(recipe.clone(), decl, &owned, "feedPurgeRemoved", "feedPurgeRemovedEvery").unwrap();
        assert_eq!(expanded.tables.len(), 7); assert_eq!(expanded.maintains.len(), 1);
        assert_eq!(expanded.programs.len(), 1); assert_eq!(expanded.schedules.len(), 1);
        assert!(expanded.functions.is_empty()); assert!(expanded.tables.iter().all(|t|t.name != "feedFollows"));
        let expected: std::collections::BTreeSet<_> = snapback4_core::schema::timeline::OWNED_SUFFIXES.iter()
            .filter(|s| **s != "PullTotals").map(|s|format!("feed{s}")).collect();
        assert_eq!(expanded.tables.iter().map(|t|t.name.clone()).collect::<std::collections::BTreeSet<_>>(),expected);
        for mutation in 0..5 {
            let mut malformed=recipe.clone();
            match mutation {
                0 => { malformed.tables.iter_mut().find(|t|t.name=="feedFeed").unwrap().name="feedFollows".into(); }
                1 => { let Stmt::For {domain:Expr::Read(read),..}=&mut malformed.programs.iter_mut().find(|p|p.name=="feedPurgeRemoved").unwrap().body[0] else {panic!("sweep")}; read.table="feedFeed".into(); }
                2 => { malformed.programs.iter_mut().find(|p|p.name=="feedPurgeRemoved").unwrap().kind=ProgramKind::Mutation; }
                3 => { malformed.schedules[0].target="callerJob".into(); }
                _ => { malformed.tables.push(malformed.tables.iter().find(|t|t.name=="feedFeed").unwrap().clone()); }
            }
            assert_eq!(projection(malformed,decl,&owned,"feedPurgeRemoved","feedPurgeRemovedEvery").unwrap_err().code,"E_TIMELINE_SHAPE");
        }
        let mut missing = recipe; missing.programs.clear();
        assert_eq!(projection(missing, decl, &owned, "feedPurgeRemoved", "feedPurgeRemovedEvery").unwrap_err().code, "E_TIMELINE_SHAPE");
    }
}
