//! Recognize a public activity union, then reuse timeline admission and reads.
// @ref LLP 3000.013#33-materialized-views-following — structure selects storage, never grants disclosure.
use crate::{ast::*, diag::{Diagnostic, Fallible, Site}, types::Ty};
use super::{intent, timeline};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug)]
pub struct Plan {
    pub fields: BTreeMap<String, String>,
    pub time: String,
}
impl Plan {
    pub fn ty(&self) -> Ty {
        Ty::RowShape(self.fields.iter().map(|(name, source)| (name.clone(), match source.as_str() {
            "actorId" => Ty::Principal, "at" => Ty::Time, "repost" => Ty::Bool, _ => Ty::Id,
        })).collect())
    }
}

fn refusal(site: &Site, message: impl Into<String>) -> Diagnostic {
    Diagnostic::new(site, "E_VIEW_FEED_SHAPE", message,
        "use a two-branch public activity view: originals { post: .id, actor: .author, at, repost: false }; reposts { post: .original, actor: .actor, at, repost: true }; then view following: activity where .actor = viewer or exists edges[viewer, .actor]; edges need one declared unique (follower, followed) principal pair").guide("feeds")
}
fn focal(name: &str, site: &Site) -> Expr {
    Expr::Member { base: Box::new(Expr::Focal { site: site.clone() }), name: name.into(), site: site.clone() }
}
fn viewer(value: &Expr) -> bool { matches!(value, Expr::Name { name, .. } if name == "viewer") }
fn boolean(value: &Expr, expected: bool) -> bool { matches!(value, Expr::Literal { value: Literal::Bool(v), .. } if *v == expected) }
fn fields(branch: &ViewBranch) -> Fallible<BTreeMap<String, Expr>> {
    let mut fields = BTreeMap::new();
    for field in &branch.fields {
        let (name, value) = match field {
            ShapeField::Bare { name, site } => (name, focal(name, site)),
            ShapeField::Field { name, value, .. } if name != "id" => (name, value.clone()),
            _ => return Err(refusal(&branch.site, "Following branches need named scalar projections and an implicit source id")),
        };
        if fields.insert(name.clone(), value).is_some() { return Err(refusal(&branch.site, format!("duplicate view field {name}"))); }
    }
    fields.remove("id");
    Ok(fields)
}
fn column<'a>(table: &'a TableDecl, name: &str) -> Option<&'a ColumnDecl> { table.columns.iter().find(|c| c.name == name) }
fn kind(table: &TableDecl, name: &str, expected: &TypeKind) -> bool {
    column(table, name).is_some_and(|c| !c.type_.optional && &c.type_.kind == expected)
}
fn negative_column(expr: &Expr) -> Option<&str> {
    match expr {
        Expr::Unary { op, value, .. } if op == "not" => intent::column(value),
        Expr::Binary { op, left, right, .. } if op == "=" => {
            if boolean(right, false) { intent::column(left) } else if boolean(left, false) { intent::column(right) } else { None }
        }
        _ => None,
    }
}

fn recognize(feed: &FeedView, views: &BTreeMap<String, ViewDecl>, tables: &BTreeMap<String, TableDecl>) -> Fallible<(TimelineDecl, Plan)> {
    let fail = |message| refusal(&feed.site, message);
    let union = views.get(&feed.source).ok_or_else(|| fail(format!("{} must name a planned activity union", feed.source)))?;
    if union.branches.len() != 2 { return Err(fail("Following needs exactly an originals branch and a reposts branch".into())); }
    let Expr::Binary { op, left, right, .. } = &feed.predicate else { return Err(fail("Following needs viewer-or-followed membership".into())); };
    if op != "or" { return Err(fail("Following needs viewer-or-followed membership".into())); }
    let (own, probe) = if matches!(right.as_ref(), Expr::Exists { .. }) { (left.as_ref(), right.as_ref()) } else { (right.as_ref(), left.as_ref()) };
    let Expr::Binary { op, left, right, .. } = own else { return Err(fail("the own branch must compare the projected actor with viewer".into())); };
    let actor = if op == "=" && viewer(right) { intent::column(left) } else if op == "=" && viewer(left) { intent::column(right) } else { None }
        .ok_or_else(|| fail("the own branch must compare the projected actor with viewer".into()))?;
    let Expr::Exists { read, .. } = probe else { return Err(fail("the followed branch must probe the declared edge pair".into())); };
    if read.keys.len() != 2 || read.keys.iter().any(|k| k.column.is_some()) || !viewer(&read.keys[0].value)
        || intent::column(&read.keys[1].value) != Some(actor) || read.index.is_some() || read.range.is_some()
        || read.filter.is_some() || read.matching.is_some() || !read.seeks.is_empty() || !read.order_keys.is_empty() {
        return Err(fail("the edge probe must be exactly edges[viewer, .actor]".into()));
    }
    let edges = tables.get(&read.table).ok_or_else(|| fail("the edge probe must name an application table".into()))?;
    let pairs: Vec<_> = edges.indexes.iter().filter(|i| i.unique && i.is_plain() && i.columns.len() == 2).collect();
    if pairs.len() != 1 || !pairs[0].columns.iter().all(|c| kind(edges, c, &TypeKind::Principal)) {
        return Err(fail("edges need exactly one declared two-column unique key, both required principals in (follower, followed) order".into()));
    }
    let projections = [fields(&union.branches[0])?, fields(&union.branches[1])?];
    if projections[0].len() != 4 || projections[0].keys().ne(projections[1].keys()) {
        return Err(fail("both branches must project the same four fields: original reference, actor, time and repost flag (id is implicit)".into()));
    }
    for originals in 0..2 {
        let reposts = 1 - originals;
        let a = &union.branches[originals]; let b = &union.branches[reposts];
        let p = &projections[originals]; let r = &projections[reposts];
        let Some(posts) = tables.get(&a.source) else { continue; };
        let Some(reposts_table) = tables.get(&b.source) else { continue; };
        let Some(author) = p.get(actor).and_then(intent::column).filter(|c| kind(posts, c, &TypeKind::Principal)) else { continue; };
        let Some(reposter) = r.get(actor).and_then(intent::column).filter(|c| kind(reposts_table, c, &TypeKind::Principal)) else { continue; };
        let original: Vec<_> = p.iter().filter(|(_, v)| intent::column(v) == Some("id")).filter(|(n, _)|
            intent::column(&r[*n]).is_some_and(|c| kind(reposts_table, c, &TypeKind::Ref { table: a.source.clone() }))).collect();
        let times: Vec<_> = p.iter().filter(|(n, v)| intent::column(v).is_some_and(|c| kind(posts, c, &TypeKind::Time))
            && intent::column(&r[*n]).is_some_and(|c| kind(reposts_table, c, &TypeKind::Time))).collect();
        let flags: Vec<_> = p.iter().filter(|(n, v)| boolean(v, false) && boolean(&r[*n], true)).collect();
        if original.len() != 1 || times.len() != 1 || flags.len() != 1 { continue; }
        if b.predicate.is_some() { return Err(refusal(&b.site, "Following does not materialize a filtered reposts branch")); }
        // Only a negative conjunct can be the changing, one-way removal flag.
        // All other predicate columns go through timeline's immutability proof.
        let mut conjuncts = Vec::new();
        if let Some(predicate) = &a.predicate { intent::split(predicate.clone(), &mut conjuncts); }
        let candidates: BTreeSet<_> = conjuncts.iter().filter_map(negative_column).filter(|c|
            kind(posts, c, &TypeKind::Bool) && !posts.immutable.iter().any(|(fields, _)| fields.iter().any(|f| f == c))).collect();
        if candidates.len() > 1 { return Err(refusal(&a.site, "Following supports one changing removal flag; other predicate columns must be immutable")); }
        let removed = candidates.first().copied().unwrap_or("");
        let decl = TimelineDecl { experimental_history_all: false, name: feed.name.clone(), authors: Default::default(), size: None, site: feed.site.clone(), filter: a.predicate.clone(),
            posts: [a.source.clone(), author.into(), intent::column(times[0].1).unwrap().into(), removed.into()],
            reposts: [b.source.clone(), reposter.into(), intent::column(&r[original[0].0]).unwrap().into(), intent::column(&r[times[0].0]).unwrap().into()],
            edges: [read.table.clone(), pairs[0].columns[0].clone(), pairs[0].columns[1].clone()] };
        let plan = Plan { time: times[0].0.clone(), fields: BTreeMap::from([
            ("id".into(), "eventId".into()), (original[0].0.clone(), "postId".into()),
            (actor.into(), "actorId".into()), (times[0].0.clone(), "at".into()), (flags[0].0.clone(), "repost".into()),
        ]) };
        return Ok((decl, plan));
    }
    Err(fail("the union needs original id/reference, principal actors, time columns and false/true repost projections".into()))
}

pub(super) fn expand(documents: &mut [Document], diagnostics: &mut Vec<Diagnostic>) -> BTreeMap<String, Plan> {
    let views = documents.iter().flat_map(|d| d.views.iter().map(|v| (v.name.clone(), v.clone()))).collect();
    let tables = documents.iter().flat_map(|d| d.tables.iter().map(|t| (t.name.clone(), t.clone()))).collect();
    let mut plans = BTreeMap::new();
    for doc in documents {
        for feed in &doc.feed_views {
            match recognize(feed, &views, &tables) {
                Ok((decl, plan)) => { doc.timelines.push(decl); plans.insert(feed.name.clone(), plan); }
                Err(error) => diagnostics.push(error),
            }
        }
    }
    plans
}

pub(super) fn read(timeline: &snapback4_core::schema::timeline::Timeline, plan: &Plan, read: &ReadExpr) -> Fallible<Expr> {
    if !read.keys.is_empty() || read.order_keys != [plan.time.clone()]
        || !read.seeks.is_empty() || read.filter.is_some() || read.index.is_some() || read.matching.is_some()
        || read.range.as_ref().is_none_or(|r| r.order != Order::Desc) {
        return Err(Diagnostic::new(&read.site, "E_TIMELINE_READ", "Following reads the viewer's delivered inbox by its projected time field",
            format!("{} last 20 by .{} after c", timeline.name, plan.time)).guide("feeds"));
    }
    let mut input = read.clone();
    input.keys = vec![KeyPart { column: None, value: Expr::Name { name: "viewer".into(), site: read.site.clone() }, site: read.site.clone() }];
    let Expr::Shape { base, .. } = timeline::read(timeline, &input)? else { unreachable!("timeline read projection") };
    Ok(Expr::Shape { base, site: read.site.clone(), fields: plan.fields.iter().map(|(name, column)| ShapeField::Field {
        name: name.clone(), value: focal(column, &read.site), site: read.site.clone(),
    }).collect() })
}
