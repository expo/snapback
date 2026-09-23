//! Timeline expansion and support for already installed Following modules.
use crate::{ast::*, diag::Site, lexer::{Kind, Token}};
use std::collections::{BTreeMap, BTreeSet};

pub mod bridge;

pub fn prefixed_name(prefix: &str, name: &str) -> String {
    if prefix.is_empty() { return name.into(); }
    let mut chars = name.chars();
    format!("{prefix}{}{}", chars.next().unwrap().to_ascii_uppercase(), chars.as_str())
}

pub fn valid_prefix(prefix: &str) -> bool {
    let mut chars = prefix.chars();
    chars.next().is_some_and(|c| c.is_ascii_alphabetic() || c == '_') && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FollowingCaps { authors: u32, edges: u32, routes: u32 }

// @ref LLP 3000.007#20.3 — promotion and backfill share one unchanged mutation meter.
// @ref LLP 3000.007#20.21 — pin public slot counts to a private maintain; reserve its per-route write too.
// Three writes per route for the author and 51 followers, plus the recipe
// edge, promotion update and the documented app edge: 3 * 52 + 3 = 159.
const BACKFILL_PROMOTION_ALLOWANCE: u64 = 3 * (51 + 1) + 3;
const BACKFILL_MIN_EVENTS: u32 = 200;

impl FollowingCaps {
    pub fn authors(self) -> u32 { self.authors }
    pub fn edges(self) -> u32 { self.edges }
    pub fn backfill(self) -> u32 {
        let write_bound = (snapback4_core::Ceilings::default().rows_written - BACKFILL_PROMOTION_ALLOWANCE) as u32;
        self.authors.max(BACKFILL_MIN_EVENTS).min(write_bound)
    }

    pub fn parse(authors: Option<&str>, edges: Option<&str>) -> Result<Self, String> {
        fn number(flag: &str, value: Option<&str>, default: u32) -> Result<u32, String> {
            match value {
                None => Ok(default),
                Some(value) if !value.is_empty() && value.bytes().all(|c| c.is_ascii_digit()) => value.parse::<u32>().ok().filter(|n| *n > 0)
                    .ok_or_else(|| format!("--{flag} needs a positive 32-bit integer")),
                _ => Err(format!("--{flag} needs a positive 32-bit integer")),
            }
        }
        let authors = number("authors", authors, 1000)?;
        let edges = number("edges", edges, 100000)?;
        let routes = authors.checked_mul(32).ok_or("--authors must be at most 134217727 so its 32-per-author route budget fits a Quarry cap")?;
        if u64::from(edges) > u64::from(authors) * 1000 {
            return Err(format!("--edges {edges} exceeds --authors {authors} * 1000 followers/author; grow --authors or reduce --edges"));
        }
        if routes < edges.min(1000) + 1 {
            return Err(format!("--authors {authors} gives {routes} pull slots, fewer than one full follower group plus its author ({}); grow --authors or reduce --edges", edges.min(1000) + 1));
        }
        Ok(Self { authors, edges, routes })
    }

    pub fn summary(self) -> String {
        format!("authors={}, edges={}, pulls={}, pullCounts={}, sourceEvents=60000, broadcast=32000, tombstones=32000; follows/reader=1000, followers/author=1000, events/actor=1000, tombstones/actor=1000, pulls/reader=32, inbox/reader=50000, inbox/reader/actor=1000, inbox/event=1001; backfill/author={}", self.authors, self.edges, self.routes, self.routes, self.backfill())
    }
}

pub fn following(prefix: &str, module: &str) -> Result<String, String> {
    following_sized(prefix, module, FollowingCaps::parse(None, None)?)
}

pub fn following_sized(prefix: &str, module: &str, caps: FollowingCaps) -> Result<String, String> {
    // @ref LLP 3000.007#20.3 — promotion requires every follower's route in the triggering follow transaction.
    let source = include_str!("recipe/following.q");
    // @ref LLP 3000.007#20.3 — size metadata while keeping backfill within the promotion write allowance.
    let (doc, errors) = crate::parse_document("feed.q", &source);
    if !errors.is_empty() { return Err(errors.iter().map(ToString::to_string).collect::<Vec<_>>().join("\n")); }
    let mut lines = source.lines().map(str::to_owned).collect::<Vec<_>>();
    for (name, max) in [("authors", caps.authors), ("follows", caps.edges), ("pulls", caps.routes), ("pullCounts", caps.routes)] {
        let table = doc.tables.iter().find(|t| t.name == name).ok_or_else(|| format!("Following recipe is missing table {name}"))?;
        let cap = table.caps.iter().find(|c| c.by.is_empty()).ok_or_else(|| format!("Following recipe is missing {name}'s global cap"))?;
        *lines.get_mut((cap.site.line as usize).checked_sub(1).ok_or("Following cap has an invalid source span")?).ok_or("Following cap has an invalid source span")? = format!("  cap {max}");
    }
    let follow = doc.functions.iter().find(|f| f.name == "addFollow").ok_or("Following recipe is missing addFollow")?;
    let FunctionBody::Block(body) = &follow.body else { return Err("Following addFollow must have a block body".into()); };
    let stop = body.iter().find_map(|stmt| match stmt {
        Stmt::For { domain: Expr::Read(read), body, .. } if read.table == "posts" => body.iter().find_map(|stmt| match stmt {
            Stmt::If { condition: Expr::Binary { left, .. }, site, .. } if matches!(left.as_ref(), Expr::Name { name, .. } if name == "visited") => Some(site),
            _ => None,
        }),
        _ => None,
    }).ok_or("Following recipe is missing its bounded backfill stop")?;
    *lines.get_mut((stop.line as usize).checked_sub(1).ok_or("Following backfill has an invalid source span")?).ok_or("Following backfill has an invalid source span")? = format!("    if visited = {}:", caps.backfill());
    let source = lines.join("\n") + "\n";
    // @ref LLP 3000.007#20.3 — a wired app owns mutation authority; installed recipe operations are helpers, never a second client write API.
    let source = if prefix.is_empty() { source } else {
        let (doc, errors) = crate::parse_document("feed.q", &source);
        if !errors.is_empty() { return Err(errors.iter().map(ToString::to_string).collect::<Vec<_>>().join("\n")); }
        let mutations: BTreeSet<_> = doc.programs.iter().filter(|p| p.kind == ProgramKind::Mutation).map(|p| p.site.line as usize).collect();
        source.lines().enumerate().map(|(n, line)| if mutations.contains(&(n + 1)) { line.replacen("mutation ", "fn ", 1) } else { line.into() }).collect::<Vec<_>>().join("\n") + "\n"
    };
    prefix_module(&source, prefix, module)
}

// @ref LLP 3000.007#20.3 — adoption renames declaration references through syntax; literals, fields and local bindings keep their meanings.
// Index names are table-local. Keeping them also preserves the identical
// index names required by the inbox/broadcast merge; none need renaming.
pub fn prefix_module(source: &str, prefix: &str, module: &str) -> Result<String, String> {
    rename_module(source, prefix, module).map(|(source, _)| source)
}

/// Global references left outside the recipe's declarations, including builtins.
/// An app declaration with one of these names could silently change its binding.
pub fn unrenamed_references(source: &str) -> Result<BTreeSet<String>, String> {
    rename_module(source, "", "").map(|(_, references)| references)
}

fn rename_module(source: &str, prefix: &str, module: &str) -> Result<(String, BTreeSet<String>), String> {
    if !prefix.is_empty() && !valid_prefix(prefix) { return Err("--prefix needs a Quarry identifier, for example --prefix feed".into()); }
    let source = source.replace("\r\n", "\n").replace('\r', "\n");
    let source_module = "feed";
    let source_file = format!("{source_module}.q");
    let (doc, errors) = crate::parse_document(&source_file, &source);
    if !errors.is_empty() { return Err(errors.iter().map(ToString::to_string).collect::<Vec<_>>().join("\n")); }
    let (tokens, _) = crate::lexer::lex(&source_file, &source);
    let names = doc.tables.iter().map(|d| &d.name).chain(doc.maintains.iter().map(|d| &d.name))
        .chain(doc.functions.iter().map(|d| &d.name)).chain(doc.shapes.iter().map(|d| &d.name))
        .chain(doc.programs.iter().map(|d| &d.name)).chain(doc.schedules.iter().map(|d| &d.name))
        .chain(doc.effects.iter().map(|d| &d.name)).chain(doc.actions.iter().map(|d| &d.name))
        .map(|n| (n.clone(), prefixed_name(prefix, n))).collect();
    let mut edit = Rename { tokens, names, edits: BTreeMap::new(), unrenamed: BTreeSet::new() };
    for table in &doc.tables {
        edit.name(&table.site, &table.name, 1);
        for col in &table.columns {
            edit.type_(&col.site, &col.type_);
            if let Some(value) = &col.default { edit.expr(value); }
        }
        for rule in &table.rules { edit.expr(&rule.value); }
        for (value, _) in &table.final_exists { edit.expr(value); }
        if let Some(SyncDecl { audience: SyncAudience::Target { table, .. }, site, .. }) = &table.sync { edit.name(site, table, 1); }
    }
    for maintain in &doc.maintains {
        edit.name(&maintain.site, &maintain.name, 1);
        edit.name(&maintain.site, &maintain.source, 3);
        if let Some(filter) = &maintain.filter { edit.expr(filter); }
        for key in &maintain.keys { edit.expr(key); }
        edit.expr(&maintain.read.value);
    }
    for shape in &doc.shapes { edit.name(&shape.site, &shape.name, 1); edit.shape(&shape.fields); }
    for function in &doc.functions {
        edit.name(&function.site, &function.name, 1);
        for arg in &function.args { edit.type_(&arg.site, &arg.type_); }
        match &function.body { FunctionBody::Expression(value) => edit.expr(value), FunctionBody::Block(body) => edit.body(body) }
    }
    for program in &doc.programs {
        edit.name(&program.site, &program.name, 1);
        for arg in &program.args { edit.type_(&arg.site, &arg.type_); }
        edit.body(&program.prelude); edit.body(&program.body);
    }
    for action in &doc.actions {
        edit.name(&action.site, &action.name, 1);
        for arg in &action.args { edit.type_(&arg.site, &arg.type_); }
        edit.expr(&action.rule);
    }
    for effect in &doc.effects { edit.name(&effect.site, &effect.name, 1); }
    for schedule in &doc.schedules {
        edit.name(&schedule.site, &schedule.name, 1);
        // Qualified targets lex as module, dot, operation. A foreign target
        // keeps its meaning even when a local operation has the same name;
        // the output module (including empty) is not the source's identity.
        let (qualifier, operation) = schedule.target.rsplit_once('.').map_or((None, schedule.target.as_str()), |(module, operation)| (Some(module), operation));
        if !doc.programs.iter().any(|p| p.name == operation) || qualifier.is_some_and(|q| q != source_module) {
            edit.unrenamed.insert(schedule.target.clone());
            continue;
        }
        if qualifier.is_some() {
            let operation_site = edit.tokens.iter().rev().find(|t| t.site.line == schedule.site.line && t.kind == Kind::Word && t.value == operation).unwrap().site.clone();
            edit.name(&operation_site, operation, 0);
        } else {
            let target = prefixed_name(prefix, operation);
            let target = if module.is_empty() { target } else { format!("{module}.{target}") };
            edit.replace(&schedule.site, operation, 2, target);
        }
    }
    // Apply only AST-selected identifier tokens, from the right, so byte
    // offsets never shift and comments/string contents are never candidates.
    let mut lines = source.split('\n').map(str::to_owned).collect::<Vec<_>>();
    for ((line, col), (old, new)) in edit.edits.into_iter().rev() {
        let line = &mut lines[line as usize - 1];
        let offset = line.char_indices().nth(col as usize - 1).unwrap().0;
        line.replace_range(offset..offset + old.len(), &new);
    }
    Ok((lines.join("\n"), edit.unrenamed))
}

struct Rename {
    tokens: Vec<Token>,
    names: BTreeMap<String, String>,
    edits: BTreeMap<(u32, u32), (String, String)>,
    unrenamed: BTreeSet<String>,
}

impl Rename {
    fn replace(&mut self, site: &Site, name: &str, skip: usize, replacement: String) {
        let token = self.tokens.iter().filter(|t| t.site.line == site.line && t.site.col >= site.col && !matches!(t.kind, Kind::Indent | Kind::Dedent))
            .skip(skip).find(|t| t.kind == Kind::Word && t.value == name).unwrap_or_else(|| panic!("AST identifier {name} at {site:?}, skip {skip} has no token"));
        self.edits.insert((token.site.line, token.site.col), (name.into(), replacement));
    }
    fn name(&mut self, site: &Site, name: &str, skip: usize) {
        if let Some(new) = self.names.get(name) { self.replace(site, name, skip, new.clone()); }
        else { self.unrenamed.insert(name.into()); }
    }
    fn type_(&mut self, site: &Site, ty: &ScalarType) {
        match &ty.kind {
            TypeKind::Ref { table } => self.name(site, table, 2),
            TypeKind::List { item, .. } => self.type_(site, item),
            _ => {},
        }
    }
    fn read(&mut self, read: &ReadExpr) {
        self.name(&read.site, &read.table, 0);
        for key in &read.keys { self.expr(&key.value); }
        for seek in &read.seeks { self.expr(&seek.value); }
        for value in [&read.filter, &read.matching, &read.range.as_ref().and_then(|r| r.cursor.clone())].into_iter().flatten() { self.expr(value); }
    }
    fn fields(&mut self, fields: &[ObjectField]) { for field in fields { if let Some(value) = &field.value { self.expr(value); } } }
    fn shape(&mut self, fields: &[ShapeField]) {
        for field in fields {
            match field {
                ShapeField::NamedSpread { name, site } => self.name(site, name, 0),
                ShapeField::Field { value, .. } => self.expr(value),
                _ => {},
            }
        }
    }
    fn expr(&mut self, value: &Expr) {
        match value {
            Expr::Name { .. } | Expr::Focal { .. } | Expr::Literal { .. } => {},
            Expr::Array { items, .. } => for value in items { self.expr(value); },
            Expr::Object { fields, .. } => self.fields(fields),
            Expr::Unary { value, .. } | Expr::Member { base: value, .. } | Expr::Assert { value, .. } => self.expr(value),
            Expr::Binary { left, right, .. } => { self.expr(left); self.expr(right); }
            Expr::Call { name, args, site } => {
                let name_site = self.tokens.iter().rev().find(|t| t.site.line == site.line && t.site.col < site.col && t.kind == Kind::Word && t.value == *name).expect("call name before its opening parenthesis").site.clone();
                self.name(&name_site, name, 0); for value in args { self.expr(value); } }
            Expr::Read(read) | Expr::Exists { read, .. } | Expr::Created { read, .. } => self.read(read),
            Expr::Merge(merge) => {
                self.name(&merge.site, &merge.table, 1);
                for value in [&merge.matching, &merge.filter, &merge.cursor].into_iter().flatten() { self.expr(value); }
                for lane in &merge.lanes {
                    if let Some(table) = &lane.table { self.name(&lane.site, table, 0); }
                    for value in &lane.prefix { self.expr(value); }
                    if let Some((_, domain)) = &lane.loop_ { self.expr(domain); }
                }
            }
            Expr::ShapeUse { base, name, site } => { self.expr(base); self.name(site, name, 0); }
            Expr::Shape { base, fields, .. } => { self.expr(base); self.shape(fields); }
            Expr::Walk { table, seed, site, .. } => { self.name(site, table, 1); self.expr(seed); }
            Expr::If { then, condition, otherwise, .. } => { self.expr(then); self.expr(condition); self.expr(otherwise); }
            Expr::Write { table, keys, fields, condition, site, .. } => {
                self.name(site, table, 1);
                for key in keys { self.expr(&key.value); }
                self.fields(fields);
                if let Some(condition) = condition { self.expr(condition); }
            }
        }
    }
    fn body(&mut self, body: &[Stmt]) {
        for stmt in body {
            match stmt {
                Stmt::Bind { value, .. } | Stmt::Expr { value, .. } | Stmt::Return { value, .. } => self.expr(value),
                Stmt::Require { condition, .. } => self.expr(condition),
                Stmt::Emit { effect, payload, site } => { self.name(site, effect, 1); self.expr(payload); }
                Stmt::If { condition, then_body, else_body, .. } => { self.expr(condition); self.body(then_body); self.body(else_body); }
                Stmt::For { domain, body, .. } => { self.expr(domain); self.body(body); }
                Stmt::Break { .. } | Stmt::Continue { .. } => {},
            }
        }
    }
}
