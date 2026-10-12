//! The Quarry parser, ported from Snapback 2. Every refusal is a located
//! diagnostic with a rewrite; the parser recovers per line and per
//! declaration so one document yields every problem at once.

use crate::ast::*;
use crate::diag::{Diagnostic, Fallible, Site, syntax, syntax_with, unsupported};
use crate::lexer::{Kind, Token, lex};
use crate::print;

mod expr;
mod predicates;
pub(crate) mod repairs;
mod views;
mod maintains;
mod timeline;
mod expected;
mod reserved;
mod programs;
mod actions;
mod routes;

pub(crate) fn precedence(op: &str) -> Option<u8> {
    Some(match op {
        "??" => 1,
        "or" => 2,
        "and" => 3,
        "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" => 4,
        "+" | "-" => 5,
        "*" | "/" | "%" => 6,
        _ => return None,
    })
}

pub fn parse_document(file: &str, source: &str) -> (Document, Vec<Diagnostic>) {
    parse_with_types(file, source, Vec::new(), Default::default())
}

pub(crate) fn parse_with_types(file: &str, source: &str, known_tables: Vec<TableDecl>, known_views: std::collections::BTreeMap<String, crate::types::Ty>) -> (Document, Vec<Diagnostic>) {
    let (tokens, diagnostics) = lex(file, source);
    let source = source.replace("\r\n", "\n").replace('\r', "\n").split('\n').map(str::to_owned).collect();
    let mut parser = Parser { source, tokens, position: 0, declaration_start: 0, comparison_spans: Default::default(), expression_spans: Default::default(), diagnostics, focal_table: None, repair_args: None, known_tables, known_views, document: Document { file: file.to_owned(), ..Document::default() } };
    parser.document();
    (parser.document, parser.diagnostics)
}

struct Parser {
    source: Vec<String>,
    tokens: Vec<Token>,
    position: usize,
    declaration_start: usize,
    comparison_spans: std::collections::BTreeMap<(u32, u32), std::ops::Range<usize>>,
    expression_spans: std::collections::BTreeMap<(u32, u32), std::ops::Range<usize>>,
    diagnostics: Vec<Diagnostic>,
    document: Document,
    focal_table: Option<String>,
    known_tables: Vec<TableDecl>,
    known_views: std::collections::BTreeMap<String, crate::types::Ty>,
    repair_args: Option<(Site, Vec<ArgDecl>)>,
}

const TOP_LEVEL: [&str; 19] = ["view", "use", "table", "maintain", "channel", "query", "mutation", "job", "action", "route", "effect", "shape", "fn", "proc", "cursor", "schedule", "index", "unique", "deliver"];

impl Parser {
    fn document(&mut self) {
        while !self.at_kind(Kind::Eof) {
            self.skip_newlines();
            if self.at_kind(Kind::Eof) {
                break;
            }
            let start = self.position;
            let result = self.top_level();
            if result.is_ok() && let Some(last) = self.tokens[start..self.position].iter()
                .rev().find(|t| !matches!(t.kind, Kind::Newline | Kind::Indent | Kind::Dedent | Kind::Eof)) {
                let first = &self.tokens[start].site;
                let text = self.source[first.line as usize - 1..last.site.line as usize].join("\n");
                self.document.source.declarations.insert(first.to_string(), text);
            }
            if let Err(diagnostic) = result {
                self.diagnostics.push(diagnostic);
                self.recover_top_level();
            }
        }
    }

    fn top_level(&mut self) -> Fallible<()> {
        self.declaration_start = self.position;
        self.comparison_spans.clear();
        self.expression_spans.clear();
        self.focal_table = None;
        self.repair_args = None;
        let token = self.peek().clone();
        match token.value.as_str() {
            "action" => self.parse_action(),
            "route" => self.parse_route(),
            "use" => self.parse_use(),
            "table" => {
                let table = self.parse_table()?;
                self.document.tables.push(table);
                Ok(())
            }
            "view" => self.parse_view(),
            "maintain" => {
                if self.tokens.get(self.position + 3).is_some_and(|token| token.value == "timeline") {
                    let timeline = self.parse_timeline()?;
                    self.document.timelines.push(timeline);
                    return Ok(());
                }
                let maintain = self.parse_maintain()?;
                self.document.maintains.push(maintain);
                Ok(())
            }
            "query" | "mutation" | "job" => {
                let program = self.parse_program()?;
                self.document.programs.push(program);
                Ok(())
            }
            "effect" => {
                let effect = self.parse_effect()?;
                self.document.effects.push(effect);
                Ok(())
            }
            "shape" => self.parse_shape_declaration(),
            "fn" => self.parse_function_declaration(),
            "aggregate" => {
                let line = self.source[token.site.line as usize - 1].trim_start();
                let tail = line.strip_prefix("aggregate").unwrap_or(line);
                Err(unsupported(&token.site, "aggregate declaration", format!("view{tail}")).guide("from-sql"))
            },
            "proc" => Err(unsupported(&self.peek().site, "proc", "fn")),
            "cursor" => Err(unsupported(&token.site, "cursor as a declaration", "cursor is reserved for a future Quarry form; rename this declaration")),
            "channel" => Err(unsupported(&token.site, "channel", "ephemeral channels arrive after the first slice; keep presence and typing in the client for now")),
            "schedule" => {
                let schedule = self.parse_schedule()?;
                self.document.schedules.push(schedule);
                Ok(())
            }
            "deliver" => Err(syntax_with(&token.site, "deliver is a table line spelled sync in Snapback 4", "sync to memberships[.conversationId] last 500 by .at")),
            "index" | "unique" => Err(syntax_with(&token.site, "top-level indexes are invalid; place by/unique inside the table block", "move the index line into its table block")),
            "device" | "oblivious" => Err(unsupported(&token.site, &token.value, "pass an explicit bounded argument to the operation")),
            other => Err(syntax(&token.site, format!("unexpected top-level {other:?}"))),
        }
    }

    fn parse_use(&mut self) -> Fallible<()> {
        let site = self.take("use")?.site;
        let kind = self.word()?;
        match kind.value.as_str() {
            "server" => self.document.server = true,
            "identity" => {
                let mut password = true;
                let mut guests = true;
                if self.at("password") {
                    self.position += 1;
                    guests = false;
                } else if self.at("guests") {
                    self.position += 1;
                    password = false;
                }
                self.document.identity = Some((password, guests));
            }
            "personas" => {
                let first = self.word()?;
                self.document.personas.push(first.value);
                while self.maybe(",") {
                    let next = self.word()?;
                    self.document.personas.push(next.value);
                }
            }
            other => return Err(unsupported(&kind.site, &format!("use {other}"), "use server, use identity, use identity password, use identity guests, or use personas alice, bob")),
        }
        self.end_line(&site)
    }

    fn parse_table(&mut self) -> Fallible<TableDecl> {
        let site = self.take("table")?.site;
        let name = self.binding_name()?;
        self.take(":")?;
        self.newline()?;
        self.take_kind(Kind::Indent)?;
        let mut table = TableDecl { receipts: None, ephemeral: None, search: Vec::new(), name: name.clone(), columns: Vec::new(), indexes: Vec::new(), rules: Vec::new(), immutable: Vec::new(), caps: Vec::new(), final_exists: Vec::new(), retain: None, expire: None, public: None, sync: None, online_only: false, site };
        while !self.at_kind(Kind::Dedent) && !self.at_kind(Kind::Eof) {
            self.skip_newlines();
            if self.at_kind(Kind::Dedent) {
                break;
            }
            let result = self.table_line(&mut table);
            if let Err(diagnostic) = result {
                self.diagnostics.push(diagnostic);
                self.recover_line();
            }
        }
        self.take_kind(Kind::Dedent)?;
        Ok(table)
    }

    fn table_line(&mut self, table: &mut TableDecl) -> Fallible<()> {
        let token = self.peek().clone();
        // @ref LLP 3000.036#11 — a table keyword spelled as a column names the reserved word.
        if self.peek_at(1).value == ":" && token.kind == Kind::Word && reserved::TABLE_WORDS.contains(&token.value.as_str()) {
            return Err(reserved::column(&token.site, &token.value));
        }
        match token.value.as_str() {
            "receipts" if self.peek_at(1).value != ":" => {
                let site = self.take("receipts")?.site;
                if table.receipts.is_some() {
                    return Err(Diagnostic::new(&site, "E_RECEIPTS_CLAUSE", "duplicate receipts clause", "keep one receipts clause").guide("receipts"));
                }
                let name = self.word()?.value;
                self.take("by")?; self.take(".")?;
                let group = self.word()?.value;
                self.take(",")?; self.take(".")?;
                let position = self.word()?.value;
                self.take("from")?; self.take(".")?;
                let sender = self.word()?.value;
                self.take("to")?;
                let members = self.word()?.value;
                self.take(":")?; self.newline()?; self.take_kind(Kind::Indent)?;
                let mut clause = ReceiptsDecl {
                    member_group: group.clone(), principal: "principal".into(),
                    counter: String::new(), floor: String::new(), count: String::new(),
                    delivered_field: format!("{name}DeliveredOrdinal"), seen_field: format!("{name}SeenOrdinal"),
                    runs: format!("{name}Runs"),
                    operations: ["Receipt", "Delivered", "Seen", "Member", "Progress", "Compact"].iter().map(|suffix|format!("{name}{suffix}")).collect(),
                    name, group, position, sender, members, site: site.clone(),
                };
                let mut keys = std::collections::BTreeSet::new();
                while !self.at_kind(Kind::Dedent) {
                    let key = self.word()?.value;
                    if !keys.insert(key.clone()) { return Err(Diagnostic::new(&site,"E_RECEIPTS_CLAUSE","duplicate receipt mapping","keep each mapping once").guide("receipts")); }
                    match key.as_str() {
                        "member" => { self.take(".")?; clause.member_group = self.word()?.value; self.take(",")?; self.take(".")?; clause.principal = self.word()?.value; }
                        "counter" | "floor" | "count" => {
                            self.take(".")?; let value = self.word()?.value;
                            match key.as_str() { "counter" => clause.counter = value, "floor" => clause.floor = value, _ => clause.count = value }
                        }
                        "watermarks" => { self.take(".")?; clause.delivered_field = self.word()?.value; self.take(",")?; self.take(".")?; clause.seen_field = self.word()?.value; }
                        "runs" => clause.runs = self.word()?.value,
                        "operations" => { clause.operations.clear(); for i in 0..6 { if i > 0 { self.take(",")?; } clause.operations.push(self.word()?.value); } }
                        _ => return Err(Diagnostic::new(&site,"E_RECEIPTS_CLAUSE","unknown receipt mapping","use member, counter, floor, count, watermarks, runs or operations").guide("receipts")),
                    }
                    self.newline()?;
                }
                self.take_kind(Kind::Dedent)?;
                table.receipts = Some(clause);
                Ok(())
            }
            "public" => {
                let site = self.take("public")?.site;
                let reason = if self.at_kind(Kind::Str) { self.take_kind(Kind::Str)?.value } else { format!("{} is public", table.name) };
                table.public = Some((reason, site));
                self.newline()
            }
            "by" => {
                let index = self.parse_index(false)?;
                table.indexes.push(index);
                Ok(())
            }
            "search" => {
                self.take("search")?;
                table.search.push(self.word()?.value);
                while self.maybe(",") { table.search.push(self.word()?.value); }
                self.newline()
            }
            "unique" => {
                let index = self.parse_index(true)?;
                table.indexes.push(index);
                Ok(())
            }
            "immutable" => {
                let site = self.take("immutable")?.site;
                let mut columns = vec![self.word()?.value];
                while self.maybe(",") {
                    columns.push(self.word()?.value);
                }
                self.newline()?;
                table.immutable.push((columns, site));
                Ok(())
            }
            "cap" => {
                let cap = self.parse_cap()?;
                table.caps.push(cap);
                Ok(())
            }
            "retain" => {
                if table.retain.is_some() {
                    return Err(Diagnostic::new(&token.site, "E_QUARRY_RETAIN", format!("table {} has more than one retain line", table.name), "retain until-revoked  -- alternatively: retain delivered-history"));
                }
                let retain = self.parse_retention()?;
                table.retain = Some(retain);
                Ok(())
            }
            "ephemeral" => {
                let site = self.take("ephemeral")?.site;
                let refuse = || Diagnostic::new(&site, "E_QUARRY_EPHEMERAL", "ephemeral requires one life between 1 second and 60 seconds inclusive", "use one ephemeral 4s line").guide("ephemeral");
                if table.ephemeral.is_some() { return Err(refuse()); }
                let amount = self.peek().value.parse::<u64>().map_err(|_| refuse())?;
                self.position += 1;
                let unit = self.peek().value.clone();
                let unit = views::duration_unit(&unit).ok_or_else(refuse)? as u64;
                self.position += 1;
                let life_ms = amount.checked_mul(unit).filter(|ms| (1000..=60000).contains(ms)).ok_or_else(refuse)?;
                self.end_line(&site)?;
                table.ephemeral = Some(EphemeralDecl { life_ms, site });
                Ok(())
            }
            "expire" => {
                // `expire at .column`: a row past the time in `column` is
                // absent to every reader and swept from the store.
                if table.expire.is_some() {
                    return Err(syntax_with(&token.site, format!("table {} has more than one expire line", table.name), "one expire line per table"));
                }
                let site = self.take("expire")?.site;
                if !self.maybe("at") || !self.at(".") || self.peek_at(1).kind != Kind::Word {
                    return Err(syntax_with(&site, "expire names the time column that ends a row's life: expire at .column", "expire at .expiresAt"));
                }
                self.take(".")?;
                let column = self.word()?.value;
                self.end_line(&site)?;
                table.expire = Some((column, site));
                Ok(())
            }
            "online" => {
                self.take("online")?;
                self.take("only")?;
                if table.online_only || table.sync.is_some() {
                    return Err(crate::diag::sync_error(&token.site, "choose one residency line", "online only  -- or: sync"));
                }
                table.online_only = true;
                self.end_line(&token.site)
            }
            "sync" => {
                if table.online_only { return Err(crate::diag::sync_error(&token.site, "online only cannot also sync", "choose online only or sync")); }
                if table.sync.is_some() {
                    return Err(syntax_with(&token.site, format!("table {} has more than one sync line", table.name), "keep one sync line matching the read rule; use sync to members[.conversation] for one membership audience, or online only when the audience cannot be inverted"));
                }
                let sync = self.parse_sync()?;
                table.sync = Some(sync);
                Ok(())
            }
            "deliver" => Err(syntax_with(&token.site, "deliver is spelled sync in Snapback 4: the engine maintains each member's partition", "sync to memberships[.conversationId] last 500 by .at")),
            "after" => {
                let site = self.take("after")?.site;
                self.take("insert")?;
                let value = self.parse_focal_rule_value("after insert", &site)?;
                if !matches!(value, Expr::Exists { .. }) {
                    return Err(syntax_with(value.site(), "after insert requires exactly one exists predicate; it states what the same mutation must also insert",
                        "after insert <- exists memberships[conversation = .id, principal = .creator]  -- other conditions belong in the insert rule or in the mutation's require"));
                }
                if self.at("else") {
                    let code = self.peek_at(1).value.clone();
                    return Err(crate::bind::rule_operator::rule_else(&self.peek().site.clone(), "after insert", &value, &code));
                }
                self.newline()?;
                table.final_exists.push((value, site));
                Ok(())
            }
            "read" | "insert" | "update" | "delete" => {
                let rule = self.parse_rule()?;
                table.rules.push(rule);
                Ok(())
            }
            _ => {
                if self.peek_at(1).value == "<-" {
                    let spelling = match token.value.as_str() {
                        "select" | "view" => Some("read"),
                        "create" => Some("insert"),
                        "modify" | "edit" => Some("update"),
                        "remove" => Some("delete"),
                        "write" => Some("insert, update and delete"),
                        _ => None,
                    };
                    if let Some(spelling) = spelling {
                        let rewrite = if token.value == "write" {
                            "write separate `insert <- predicate`, `update <- predicate` and `delete <- predicate` rules for the intended operations".to_owned()
                        } else { format!("replace `{} <-` with `{spelling} <-`, keeping the predicate", token.value) };
                        return Err(Diagnostic::new(&token.site, "E_QUARRY_RULE_SPELLING",
                            format!("{} is not a table rule; Quarry spells this {spelling}", token.value), rewrite).guide("rules"));
                    }
                }
                if self.peek_at(1).value != ":" {
                    return Err(crate::diag::unknown(&token.site, format!("unknown table declaration {}", token.value), "remove this unknown table declaration, or write `name: type` for a column"));
                }
                let column = self.parse_column()?;
                table.columns.push(column);
                Ok(())
            }
        }
    }

    /// `sync public [last N by index]`, `sync to .column [...]`, or
    /// `sync to table[.a, .b] [by .principal] [last N by index]`.
    fn parse_sync(&mut self) -> Fallible<SyncDecl> {
        let site = self.take("sync")?.site;
        let rewrite = "sync public, sync to .ownerColumn, or sync to members[.groupColumn]; then optionally last N by .column, .id";
        let audience = if self.maybe("public") {
            SyncAudience::Public
        } else if self.at("last") || self.at("by") || self.at_kind(Kind::Newline) || self.at_kind(Kind::Eof) {
            let principal = if self.maybe("by") { self.take(".")?; Some(self.word()?.value) } else { None };
            SyncAudience::Inferred { principal }
        } else {
            if !self.maybe("to") {
                return Err(syntax_with(&site, "sync takes public, to .column, or to table[.column, ...]", rewrite));
            }
            // @ref LLP 3000.036.000.000#2.1 — `sync to ARM or ARM`: a union of audiences, each arm a whole disjunct of the read rule.
            let first = self.parse_sync_arm(&site, rewrite)?;
            let mut arms = vec![first];
            while self.maybe("or") { arms.push(self.parse_sync_arm(&site, rewrite)?); }
            if arms.len() == 1 { arms.pop().expect("one arm") } else { SyncAudience::Union(arms) }
        };
        self.parse_sync_rest(site, audience, rewrite)
    }

    /// One `sync to` arm: `.column` or `table[.a, .b] [by .principal]`.
    fn parse_sync_arm(&mut self, site: &Site, rewrite: &str) -> Fallible<SyncAudience> {
        let site = site.clone();
        Ok({
            if self.at(".") {
                self.take(".")?;
                SyncAudience::Column(self.word()?.value)
            } else {
                let table = self.word()?.value;
                if !self.at("[") {
                    return Err(syntax_with(&site, format!("sync to {table} needs the columns that pin one group of {table}: {table}[.column]"), rewrite));
                }
                self.take("[")?;
                let mut prefix = Vec::new();
                loop {
                    if !self.at(".") || self.peek_at(1).kind != Kind::Word {
                        // @ref LLP 3000.036#12 — wave 2 (039): a whole roster is the inferred audience, not a keyed one.
                        if self.peek_at(1).value == "=" || self.at("viewer") || self.peek_at(2).value == "viewer" {
                            return Err(syntax_with(&site, format!("sync to {table}[...] names this row's group columns, never the viewer; a roster every member reads is the inferred audience"),
                                format!("read <- exists {table}[viewer] (a unique principal roster), then a bare `sync` line; or sync to {table}[.groupColumn] for a roster per group (guide sharing)")).guide("sharing"));
                        }
                        return Err(syntax_with(&site, format!("sync to {table}[...] takes .column keys of this table"), rewrite));
                    }
                    self.take(".")?;
                    let mut path = self.word()?.value;
                    while self.maybe(".") { path.push('.'); path.push_str(&self.word()?.value); }
                    prefix.push(path);
                    if !self.maybe(",") {
                        break;
                    }
                }
                self.take("]")?;
                let mut principal = None;
                if self.at("by") && self.peek_at(1).value == "." {
                    self.take("by")?;
                    self.take(".")?;
                    principal = Some(self.word()?.value);
                }
                SyncAudience::Target { table, prefix, principal }
            }
        })
    }

    fn parse_sync_rest(&mut self, site: Site, audience: SyncAudience, rewrite: &str) -> Fallible<SyncDecl> {
        let mut horizon = None;
        if self.maybe("last") {
            let n = self.number()?;
            if !self.maybe("by") {
                return Err(syntax_with(&site, "a horizon is `last N by index`", rewrite));
            }
            // @ref LLP 3000.019#3.1 — a window can state several ordered columns.
            let order = if self.at(".") {
                let mut columns = Vec::new();
                let mut duplicate = None;
                loop {
                    if !self.maybe(".") || !self.at_kind(Kind::Word) {
                        return Err(syntax_with(&self.peek().site, "each window order column needs a leading dot", "last 500 by .at, .id"));
                    }
                    let column = self.word()?;
                    if columns.contains(&column.value) { duplicate.get_or_insert(column); }
                    else { columns.push(column.value); }
                    if !self.maybe(",") { break; }
                }
                let order = SyncOrder::Columns(columns);
                if let Some(column) = duplicate {
                    return Err(syntax_with(&column.site, format!("window order names .{} twice", column.value), format!("last {n} by {order}")).guide("sync"));
                }
                order
            } else {
                let index = self.word()?;
                if self.at(",") {
                    // `by createdAt, id`: columns written without their dots.
                    let mut columns = vec![index.value.clone()];
                    let mut at = 0;
                    while self.peek_at(at).value == "," && matches!(self.peek_at(at + 1).kind, Kind::Word | Kind::Symbol) {
                        let next = self.peek_at(at + 1);
                        let column = if next.value == "." { self.peek_at(at + 2).value.clone() } else { next.value.clone() };
                        columns.push(column);
                        at += if next.value == "." { 3 } else { 2 };
                    }
                    return Err(syntax_with(&index.site, format!("a window names one index, or columns each with a leading dot; `{}` is followed by an unexpected comma", index.value),
                        format!("last {n} by {}", SyncOrder::Columns(columns))).guide("sync"));
                }
                SyncOrder::Index(index.value)
            };
            horizon = Some((n, order));
        }
        let own_keys = if self.maybe("with") {
            self.take("own")?;
            self.take("keys")?;
            self.take(".")?;
            Some(self.word()?.value)
        } else { None };
        // @ref LLP 3000.036.000.000#2.1 — `sync to .a, .b` is spelled `sync to .a or .b`: the window's columns use commas.
        if matches!(audience, SyncAudience::Column(_) | SyncAudience::Target { .. } | SyncAudience::Union(_)) && horizon.is_none() && self.at(",") {
            let mut arms = vec![audience.arm()];
            let mut at = 1;
            while self.peek_at(at).value == "." && self.peek_at(at + 1).kind == Kind::Word {
                arms.push(format!(".{}", self.peek_at(at + 1).value));
                if self.peek_at(at + 2).value != "," { break; }
                at += 3;
            }
            return Err(syntax_with(&self.peek().site.clone(), format!("the arms of a union audience are joined with `or`, not a comma: `sync to {}`", arms.join(", ")),
                format!("sync to {}  -- each arm is one whole disjunct of the read rule (guide sharing)", arms.join(" or "))).guide("sharing"));
        }
        if !self.at_kind(Kind::Newline) && !self.at_kind(Kind::Eof) {
            let audience_text = match &audience {
                SyncAudience::Public => "sync public".to_owned(),
                SyncAudience::Inferred { .. } => audience.arm(),
                other => format!("sync to {}", other.arm()),
            };
            let written = format!("{audience_text}{}", horizon.as_ref().map(|(n, order)| format!(" last {n} by {order}")).unwrap_or_default());
            return Err(syntax_with(&self.peek().site.clone(), format!("unexpected {} after `{written}`", self.peek().value), format!("end the sync line after `{written}`; a window is `last N by .column, .id` or `last N by indexName`")));
        }
        self.newline()?;
        Ok(SyncDecl { audience, horizon, own_keys, site, windows: Default::default() })
    }

    fn parse_retention(&mut self) -> Fallible<(String, Site)> {
        let site = self.take("retain")?.site;
        let retention = |message: String| Diagnostic::new(&site, "E_QUARRY_RETAIN", message, "retain until-revoked  -- alternatively: retain delivered-history");
        if !self.at_kind(Kind::Word) {
            return Err(retention("retain requires a policy word".into()));
        }
        let policy = self.word()?;
        if policy.value != "until-revoked" && policy.value != "delivered-history" {
            return Err(retention(format!("unknown retention policy {}", policy.value)));
        }
        if !self.at_kind(Kind::Newline) {
            return Err(retention("retain accepts exactly one policy word".into()));
        }
        self.newline()?;
        Ok((policy.value, site))
    }

    fn parse_cap(&mut self) -> Fallible<CapDecl> {
        let site = self.take("cap")?.site;
        let rewrite = "cap 50 by <columns>";
        let token = self.peek().clone();
        if token.kind != Kind::Number || !token.value.bytes().all(|b| b.is_ascii_digit()) {
            return Err(syntax_with(&site, "cap requires an integer literal from 1 through 4294967295", rewrite));
        }
        let max: u64 = self.take_kind(Kind::Number)?.value.parse().unwrap_or(0);
        if !(1..=0xffff_ffff).contains(&max) {
            return Err(syntax_with(&site, "cap requires an integer literal from 1 through 4294967295", rewrite));
        }
        // @ref LLP 3000.007#20.3 — a whole-table cap bounds a fully replicated public broadcast projection.
        if self.at_kind(Kind::Newline) {
            self.newline()?;
            return Ok(CapDecl { max: max as u32, by: Vec::new(), site });
        }
        if !self.maybe("by") || !self.at_kind(Kind::Word) {
            return Err(syntax_with(&site, "cap requires non-empty grouping columns", rewrite));
        }
        let mut by = vec![self.word()?.value];
        while self.maybe(",") {
            if !self.at_kind(Kind::Word) {
                return Err(syntax_with(&site, "cap requires a column after the comma", rewrite));
            }
            by.push(self.word()?.value);
        }
        self.newline()?;
        Ok(CapDecl { max: max as u32, by, site })
    }

    fn parse_column(&mut self) -> Fallible<ColumnDecl> {
        let name = self.word()?;
        self.take(":")?;
        if self.at("sequence") && self.peek_at(1).value == "by" {
            self.take("sequence")?;
            self.take("by")?;
            let parent = if self.at_kind(Kind::Word) { self.word()?.value } else {
                return Err(crate::diag::Diagnostic::new(&name.site, "E_SEQUENCE_PARENT", "sequence by needs a parent reference column", "ordinal: sequence by conversationId; declare conversationId: conversations").guide("types"));
            };
            self.newline()?;
            return Ok(ColumnDecl { written_by: None, readable_by_audience: false, sequence: Some(parent), maintained: None, name: name.value,
                type_: ScalarType { kind: TypeKind::Int, optional: false }, default: None, site: name.site });
        }
        let aggregate = (self.peek_at(2).kind == Kind::Word
            && ((self.at("count") && matches!(self.peek_at(2).value.as_str(), "by" | "where"))
                || (self.at("sum") && self.peek_at(2).value == "of")))
            || (self.at("count") && self.peek_at(2).kind == Kind::Newline);
        if aggregate && self.peek_at(1).kind == Kind::Word {
            let sum = self.word()?.value == "sum";
            let source = self.word()?.value;
            let of = if sum { self.take("of")?; self.maybe("."); Some(self.word()?.value) } else { None };
            let filter = if self.maybe("where") { Some(self.filtered_predicate(&source, &[], true)?) } else { None };
            let by = if self.maybe("by") { self.maybe("."); self.word()?.value } else { String::new() };
            self.newline()?;
            return Ok(ColumnDecl { sequence: None, written_by: None, readable_by_audience: false, maintained: Some(ColumnAggregate { source, of, filter, by }),
                name: name.value, type_: ScalarType { kind: TypeKind::Int, optional: false }, default: None, site: name.site });
        }
        let type_ = self.parse_type(true)?;
        if matches!(type_.kind, TypeKind::Cursor) {
            return Err(syntax_with(&name.site, "cursor is an operation argument type, not a table column", "use c: cursor ? on a query"));
        }
        let default = if self.maybe("default") { Some(self.expression(0, &["written", "readable"])?) } else { None };
        let mut written_by = None;
        let mut readable_by_audience = false;
        let authority_error = || crate::diag::Diagnostic::new(&name.site, "E_FIELD_AUTHORITY",
            "expected one `written by .principal` followed by optional `readable by audience`",
            format!("{}: int default 0 written by .principal", name.value)).guide("rules");
        if self.maybe("written") {
            if !self.maybe("by") || !self.maybe(".") || !self.at_kind(Kind::Word) { return Err(authority_error()); }
            written_by = Some(self.word()?.value);
        }
        if self.maybe("readable") {
            if written_by.is_none() || !self.maybe("by") || !self.maybe("audience") { return Err(authority_error()); }
            readable_by_audience = true;
        }
        if self.at("written") || self.at("readable") { return Err(authority_error()); }
        self.newline()?;
        Ok(ColumnDecl { sequence: None, written_by, readable_by_audience, maintained: None, name: name.value, type_, default, site: name.site })
    }

    fn parse_index(&mut self, unique: bool) -> Fallible<IndexDecl> {
        let site = self.take(if unique { "unique" } else { "by" })?.site;
        let mut explicit = None;
        if self.at_kind(Kind::Word) && self.peek_at(1).value == ":" {
            explicit = Some(self.word()?.value);
            self.take(":")?;
        }
        let mut columns = Vec::new();
        let mut words = None;
        let mut computed = std::collections::BTreeMap::new();
        loop {
            let component = self.word()?;
            if self.at(".") {
                return Err(syntax_with(&component.site, "table index columns cannot be reference paths", "index a column of this table; use recorded paths only on a maintain").guide("indexes"));
            }
            if component.value == "words" && self.at("(") {
                // `words(body, caption)`: one entry per distinct word of the
                // named text columns, in this position.
                if words.is_some() {
                    return Err(syntax_with(&component.site, "an index has one words(..) component", "words(body)"));
                }
                self.take("(")?;
                let mut fields = vec![self.word()?.value];
                while self.maybe(",") {
                    fields.push(self.word()?.value);
                }
                self.take(")")?;
                words = Some((columns.len(), fields));
            } else if matches!(component.value.as_str(), "day" | "hour" | "bucket") && self.at("(") {
                self.position -= 1;
                let expression = self.expression(0, &[",", "else", "<newline>"]).map_err(|error| {
                    if error.code == "E_QUARRY_MAINTAIN" { crate::diag::type_error(&error.site, error.message, "day(at), hour(at, 30m), or bucket(at, 2h, 30m); declare at: time on this table").guide("indexes") }
                    else { error }
                })?;
                if computed.insert(component.value.clone(), expression).is_some() {
                    return Err(syntax_with(&component.site, format!("index repeats {}(..); each time function occurs at most once per index", component.value), "keep one day, hour and bucket component per index; declare another index for another period").guide("indexes"));
                }
                columns.push(component.value);
            } else {
                columns.push(component.value);
            }
            if !self.maybe(",") {
                break;
            }
        }
        let explicit = explicit.or_else(|| unique.then(|| {
            let descriptor = (&columns, &words, computed.iter().map(|(name, value)| (name, crate::print::expression(value))).collect::<Vec<_>>(), true);
            let hash = snapback4_core::value::digest(&descriptor);
            format!("$intent:by{}:{}", columns.iter().map(|c| title(c)).collect::<String>(), &hash[..16])
        }));
        let Some(name) = explicit else {
            let inferred = format!("by{}", columns.iter().map(|c| title(c)).collect::<String>());
            return Err(syntax_with(&site, "index declarations require an explicit name", format!("{} {inferred}: {}", if unique { "unique" } else { "by" }, columns.join(", "))));
        };
        if let Some((position, fields)) = &words {
            if unique {
                return Err(syntax_with(&site, "a words(..) index cannot be unique: a row has one entry per word", format!("by {name}: {}", columns.iter().take(*position).cloned().chain(std::iter::once(format!("words({})", fields.join(", ")))).chain(columns.iter().skip(*position).cloned()).collect::<Vec<_>>().join(", "))));
            }
            if *position == columns.len() {
                return Err(syntax_with(&site, "words(..) is followed by the columns a search page is ordered by, ending in id", format!("by {name}: {}words({}), at, id", columns.iter().map(|c| format!("{c}, ")).collect::<String>(), fields.join(", "))));
            }
        }
        let refusal = if unique && self.maybe("else") {
            let code = self.word()?.value;
            let message = if self.at_kind(Kind::Str) { Some(self.take_kind(Kind::Str)?.value) } else { None };
            Some((code, message))
        } else { None };
        self.newline()?;
        Ok(IndexDecl { name, columns, unique, refusal, words, computed, site })
    }

    fn parse_maintain(&mut self) -> Fallible<MaintainDecl> {
        let keyword = self.word()?;
        let site = keyword.site.clone();
        let name = self.binding_name()?;
        self.take(":")?;
        let aggregate = self.word()?;
        if aggregate.value != "count" && aggregate.value != "sum" {
            return Err(unsupported(&aggregate.site, &format!("maintain {}", aggregate.value), "use maintain name: count table by columns, or maintain name: sum table of intColumn by columns"));
        }
        let source = self.word()?.value;
        let mut column = None;
        if aggregate.value == "sum" && self.at("where") {
            // `sum t where … of .x`: count's clause order; a sum names its value first.
            let where_site = self.take("where")?.site;
            let start = self.position;
            while !self.at("of") && !self.at_kind(Kind::Newline) && !self.at_kind(Kind::Eof) { self.position += 1; }
            let predicate = (self.position > start).then(|| self.source_text(start, self.position));
            let of = if self.maybe("of") { self.maybe("."); self.word().ok().map(|t| t.value) } else { None };
            let rest_start = self.position;
            while !self.at_kind(Kind::Newline) && !self.at_kind(Kind::Eof) { self.position += 1; }
            let rest = if self.position > rest_start { self.source_text(rest_start, self.position) } else { "by …".to_owned() };
            return Err(syntax_with(&where_site, "a sum names its value before its filter: sum source of .column where predicate by keys",
                format!("{} {name}: sum {source} of .{} where {} {rest}", keyword.value, of.as_deref().unwrap_or("column"), predicate.as_deref().unwrap_or("…"))));
        }
        if aggregate.value == "sum" {
            self.take("of")?;
            self.maybe(".");
            column = Some(self.word()?.value);
        }
        let mut filter = if self.maybe("where") { Some(self.filtered_predicate(&source, &[], true)?) } else { None };
        self.take("by")?;
        let row_key = if self.peek().kind == Kind::Word && self.peek_at(1).kind == Kind::Word && self.peek_at(1).value != "where" {
            Some((self.word()?.value, self.word()?.value))
        } else { None };
        let mut keys = Vec::new();
        let keys_start = self.position;
        while row_key.is_none() {
            let mut key = self.expression(0, &[",", "<newline>", "where"])?;
            views::unfocal_key(&mut key);
            keys.push(key);
            if !self.maybe(",") { break; }
        }
        // @ref LLP 3000.036#15.7 — lane 034: `sum drives of .minutes by .teen where …` reported
        // two E_QUARRY_MAINTAIN causes; the fault is clause order, so name it with the reordered view.
        if row_key.is_none() && self.at("where") {
            let by = self.source_text(keys_start, self.position);
            let where_site = self.take("where")?.site;
            let start = self.position;
            while !self.at_kind(Kind::Newline) && !self.at_kind(Kind::Eof) { self.position += 1; }
            let predicate = self.source_text(start, self.position);
            let value = column.as_ref().map(|column| format!(" of .{column}")).unwrap_or_default();
            let earlier = filter.as_ref().map(|_| "; keep one where").unwrap_or_default();
            return Err(syntax_with(&where_site, format!("a view's where comes before its group keys: {} source{} where predicate by keys{earlier}", aggregate.value, if aggregate.value == "sum" { " of .column" } else { "" }),
                format!("{} {name}: {} {source}{value} where {} by {}", keyword.value, aggregate.value, predicate.trim(), by.trim())));
        }
        if row_key.is_some() {
            if self.maybe("where") { filter = Some(self.filtered_predicate(&source, &[], true)?); }
            keys.push(Expr::Name { name: "member".into(), site: site.clone() });
        }
        let by = keys.iter().map(|key| match key {
            Expr::Name { name, .. } | Expr::Call { name, .. } => name.clone(),
            _ => print::expression(key),
        }).collect();
        self.newline()?;
        let block = self.at_kind(Kind::Indent);
        if block { self.take_kind(Kind::Indent)?; }
        let mut indexes = Vec::new();
        let mut read = None;
        let mut online_only = false;
        while block && !self.at_kind(Kind::Dedent) && !self.at_kind(Kind::Eof) {
            self.skip_newlines();
            if self.at_kind(Kind::Dedent) {
                break;
            }
            let result: Fallible<()> = (|| {
                let effect = self.word()?;
                if effect.value == "where" && row_key.is_some() {
                    filter = Some(self.filtered_predicate(&source, &[], true)?);
                    return self.newline();
                }
                if effect.value == "online" {
                    self.take("only")?;
                    if online_only { return Err(syntax_with(&effect.site, "duplicate online only", "keep one online only line")); }
                    online_only = true;
                    return self.end_line(&effect.site);
                }
                if effect.value == "by" {
                    let name = self.word()?.value;
                    self.take(":")?;
                    let mut columns = vec![self.maintain_column()?];
                    while self.maybe(",") { columns.push(self.maintain_column()?); }
                    self.newline()?;
                    indexes.push(IndexDecl { name, columns, unique: false, refusal: None, words: None, computed: std::collections::BTreeMap::new(), site: effect.site });
                    return Ok(());
                }
                if effect.value == "readable" {
                    return Err(unsupported(&effect.site, "readable on a maintain", "read <- rule  -- a maintain has one rule; the engine delivers it to its source's audience"));
                }
                if effect.value == "sync" {
                    return Err(crate::bind::audience_diagnostics::sync_syntax(&name, &source, &effect.site));
                }
                if effect.value != "read" && effect.value != "public" {
                    return Err(syntax_with(&effect.site, format!("unknown maintain property {}", effect.value), "read <- rule"));
                }
                // @ref LLP 3000.007#23 — public has the same read authority on tables and aggregate views.
                let value = if effect.value == "public" {
                    if self.at_kind(Kind::Str) { self.take_kind(Kind::Str)?; }
                    Expr::Name { name: "allow".into(), site: effect.site.clone() }
                } else { self.parse_focal_rule_value(&effect.value, &effect.site)? };
                self.newline()?;
                if read.is_some() {
                    return Err(syntax_with(&effect.site, format!("maintain {name} has more than one read rule"), "keep one read <- rule"));
                }
                read = Some(RuleDecl { effect: Effect::Read, bindings: Vec::new(), value, site: effect.site.clone() });
                Ok(())
            })();
            if let Err(diagnostic) = result {
                self.diagnostics.push(diagnostic);
                self.recover_line();
            }
        }
        if block { self.take_kind(Kind::Dedent)?; }
        Ok(MaintainDecl { row_key, filter, keys, indexes, name, aggregate: aggregate.value, source, column, by, read, online_only, site })
    }

    fn maintain_duration(&mut self, offset: bool) -> Fallible<Expr> {
        let site = self.peek().site.clone();
        let negative = self.maybe("-");
        let number = self.take_kind(Kind::Number)?;
        let unit = self.word()?;
        let multiplier: i64 = match unit.value.as_str() { "ms" => 1, "s" => 1_000, "m" => 60_000, "h" => 3_600_000, "d" => 86_400_000, _ => 0 };
        let value = number.value.parse::<i64>().ok().and_then(|n| n.checked_mul(multiplier))
            .filter(|n| !negative && multiplier > 0 && (*n > 0 || (offset && *n == 0)) && *n <= snapback4_core::value::I53_MAX);
        let Some(value) = value else {
            let (message, rewrite) = if offset { ("calendar offset must be a nonnegative representable literal duration", "day(.at, 8h) or bucket(.at, 1d, 8h)") }
                else { ("bucket duration must be a positive representable literal duration", "bucket(.at, 2m)") };
            return Err(Diagnostic::new(&site, "E_QUARRY_MAINTAIN", message, rewrite).guide("maintains"));
        };
        Ok(Expr::Literal { value: Literal::Number(value.to_string()), site })
    }

    /// `effect notify`: a name a mutation or job may `emit` under; the
    /// engine queues it and an external worker performs it (`from module`
    /// is accepted for Snapback 2 sources and means nothing here).
    fn parse_effect(&mut self) -> Fallible<EffectDecl> {
        let site = self.take("effect")?.site;
        let name = self.binding_name()?;
        let module = if self.maybe("from") { self.word()?.value } else { String::new() };
        let mut work = WorkDecl::default();
        let mut clauses = std::collections::BTreeSet::new();
        while self.parse_work_clause(&mut work, &mut clauses)? {}
        self.newline()?;
        Ok(EffectDecl { name, module, work, site })
    }

    fn parse_rule(&mut self) -> Fallible<RuleDecl> {
        let effect_token = self.word()?;
        let effect = match effect_token.value.as_str() {
            "read" => Effect::Read,
            "insert" => Effect::Insert,
            "update" => Effect::Update,
            _ => Effect::Delete,
        };
        let mut bindings = Vec::new();
        let value;
        if self.maybe("through") {
            let fail = || Diagnostic::new(&effect_token.site, "E_READ_THROUGH", "read through .ref is the whole read rule of an application table", "read through .parent  -- put additional write conditions on insert/update/delete").guide("rules");
            if effect != Effect::Read || !self.maybe(".") { return Err(fail()); }
            let reference = self.word()?;
            if !self.at("<newline>") { return Err(fail()); }
            value = Expr::Call { name: "$readThrough".into(), args: vec![Expr::Name { name: reference.value, site: reference.site }], site: effect_token.site.clone() };
        } else if self.at("(") {
            self.take("(")?;
            bindings.push(self.binding_name()?);
            while self.maybe(",") {
                bindings.push(self.binding_name()?);
            }
            self.take(")")?;
            if effect != Effect::Update || bindings.len() != 2 {
                return Err(syntax_with(&effect_token.site, format!("{} rules use <- for one row; only update (old, next) has named bindings", effect.word()), format!("rewrite the {} rule with <- and direct .field terms", effect.word())));
            }
            self.take("<-")?;
            value = self.expression(0, &["<newline>"])?;
        } else {
            value = self.parse_focal_rule_value(effect.word(), &effect_token.site)?;
        }
        if self.at("else") {
            let code = self.peek_at(1).value.clone();
            return Err(crate::bind::rule_operator::rule_else(&self.peek().site.clone(), effect.word(), &value, &code));
        }
        self.newline()?;
        current_rule(&value)?;
        Ok(RuleDecl { effect, bindings, value, site: effect_token.site })
    }

    fn parse_focal_rule_value(&mut self, label: &str, site: &Site) -> Fallible<Expr> {
        if self.maybe("<-") {
            // `read <- public 'reason'`: the table line's spelling, allowed on
            // the rule too; the reason rides as the call's one argument.
            if self.peek().value == "public" && self.peek_at(1).kind == Kind::Str {
                let site = self.take("public")?.site;
                let reason = self.take_kind(Kind::Str)?;
                return Ok(Expr::Call { name: "public".into(), args: vec![Expr::Literal { value: Literal::Str(reason.value), site: reason.site }], site });
            }
            let value = self.expression(0, &["<newline>"])?;
            current_rule(&value)?;
            return Ok(value);
        }
        let binding = self.word()?.value;
        self.take("<-")?;
        let value = self.expression(0, &["<newline>"])?;
        Err(syntax_with(site, format!("{label} rules use the focal row . and do not take a named single-row binding"), format!("{label} <- {}", print::expression(&focalize(&value, &binding)))))
    }

    fn parse_shape_declaration(&mut self) -> Fallible<()> {
        let site = self.take("shape")?.site;
        let name = self.binding_name()?;
        if self.at("from") {
            return Err(unsupported(&self.peek().site.clone(), "imports", format!("every .q file beside schema.q shares one namespace: declare `shape {name}` once, in any file, and use it anywhere")));
        }
        if self.at("on") && self.peek_at(1).kind == Kind::Word && self.peek_at(2).value == "=" {
            let at = self.peek().site.clone();
            return Err(syntax_with(&at, "shapes infer their row type; omit on table", "=").mechanical());
        }
        self.take("=")?;
        self.take("{")?;
        let fields = self.parse_shape_fields()?;
        self.take("}")?;
        self.newline()?;
        self.document.shapes.push(ShapeDecl { name, fields, site });
        Ok(())
    }

    fn parse_function_declaration(&mut self) -> Fallible<()> {
        let site = self.take("fn")?.site;
        let name = self.binding_name()?;
        if self.at("from") {
            return Err(unsupported(&self.peek().site.clone(), "imports", format!("every .q file beside schema.q shares one namespace: declare `fn {name}` once, in any file, and use it anywhere")));
        }
        let args_site = self.peek().site.clone();
        let args = self.parse_args()?;
        self.repair_args = Some((args_site, args.clone()));
        self.take(":")?;
        let body = if self.at_kind(Kind::Newline) {
            self.newline()?;
            let mut statements = self.parse_block()?;
            if !matches!(statements.last(), Some(Stmt::Return { .. })) {
                // @ref LLP 3000.007#23 — falling through a block helper returns null, as a bare return does.
                statements.push(Stmt::Return { value: Expr::Literal { value: Literal::Null, site: site.clone() }, site: site.clone() });
            }
            FunctionBody::Block(statements)
        } else {
            let expression = self.expression(0, &["<newline>"])?;
            self.newline()?;
            FunctionBody::Expression(expression)
        };
        self.document.functions.push(FunctionDecl { name, args, body, site });
        Ok(())
    }

    /// A parameter, local or loop variable: a keyword cannot be one.
    fn local_name(&mut self) -> Fallible<String> {
        if self.peek().kind == Kind::Word && reserved::BINDING_WORDS.contains(&self.peek().value.as_str()) {
            let token = self.peek().clone();
            return Err(reserved::binding(&token.site, &token.value));
        }
        self.binding_name()
    }

    fn binding_name(&mut self) -> Fallible<String> {
        let token = self.word()?;
        if token.value == "until-revoked" || token.value == "delivered-history" {
            return Err(syntax_with(&token.site, "retention policy words cannot name bindings", "use an identifier without a hyphen"));
        }
        Ok(token.value)
    }

    fn parse_args(&mut self) -> Fallible<Vec<ArgDecl>> {
        self.take("(")?;
        let mut args = Vec::new();
        while !self.at(")") {
            let name = self.peek().clone();
            let binding = self.local_name()?;
            self.take(":")?;
            let type_site = self.peek().site.clone();
            let type_ = self.parse_type(false).map_err(|mut d| {
                if d.mechanical && d.message.starts_with("once is a column modifier") {
                    // Nested element types need a whole-list rewrite, not an argument fragment.
                    if d.site == type_site { d.site = name.site.clone(); d.rewrite = format!("{binding}: {}", d.rewrite); }
                    else { d.mechanical = false; }
                }
                d
            })?;
            args.push(ArgDecl { name: binding, type_, site: name.site });
            if !self.maybe(",") {
                break;
            }
        }
        self.take(")")?;
        Ok(args)
    }

    fn parse_type(&mut self, column: bool) -> Fallible<ScalarType> {
        let site = self.peek().site.clone();
        let mut kind;
        if self.maybe("[") {
            let item = self.parse_type(column)?;
            self.take("]")?;
            // @ref LLP 3000.007#5.4 — list ranges share text's inclusive spelling.
            let bounds_error = |site: &Site| syntax_with(site, "list bounds require <=N or an inclusive a..b range", "write [T] <=N or [T] a..b, for example [int] 1..8").guide("types");
            let number = |parser: &mut Self| -> Fallible<u32> {
                if parser.at("-") {
                    return Err(syntax(&parser.peek().site, "list bounds must be nonnegative integers"));
                }
                if !parser.at_kind(Kind::Number) { return Err(bounds_error(&parser.peek().site)); }
                let token = parser.take_kind(Kind::Number)?;
                if token.value.contains('.') {
                    return Err(syntax(&token.site, "list bounds must be integers; fractional bounds are not allowed"));
                }
                token.value.parse::<u32>().map_err(|_| syntax(&token.site, "list bounds must be integers from 0 through 4294967295"))
            };
            let (min, max) = if self.maybe("<=") {
                (0, number(self)?)
            } else {
                let min = number(self)?;
                if !self.maybe(".") || !self.maybe(".") { return Err(bounds_error(&self.peek().site)); }
                (min, number(self)?)
            };
            if min > max {
                return Err(syntax(&site, "list minimum must not exceed its maximum"));
            }
            if item.optional {
                return Err(syntax(&site, "list element types cannot be optional"));
            }
            kind = TypeKind::List { item: Box::new(item), min, max };
        } else {
            let name = self.word()?;
            kind = match name.value.as_str() {
                "text" => {
                    let (min, max) = if self.maybe("<=") {
                        (None, self.number()?)
                    } else if self.at_kind(Kind::Number) {
                        let min = self.number()?;
                        self.take(".")?;
                        self.take(".")?;
                        (Some(min), self.number()?)
                    } else {
                        // The default is normalized here; every downstream
                        // validator and resource calculation sees the same bound.
                        (None, 10_000)
                    };
                    let mut format = None;
                    if self.maybe("format") {
                        let value = self.word()?;
                        if value.value != "handle" && value.value != "url" {
                            let bound = match min {
                                Some(min) => format!("{min}..{max}"),
                                None => format!("<={max}"),
                            };
                            return Err(syntax_with(&value.site, format!("unknown text format {}", value.value), format!("use text {bound} format handle or text {bound} format url")));
                        }
                        format = Some(value.value);
                    }
                    TypeKind::Text { min, max, format }
                }
                "decimal" => TypeKind::Decimal { scale: self.scale("decimal 12")? },
                "money" => {
                    let currency = self.word()?;
                    if currency.value.len() != 3 || !currency.value.bytes().all(|b| b.is_ascii_uppercase()) {
                        return Err(syntax_with(&currency.site, "money currency must be exactly three uppercase letters", "use money USD or money USD 2"));
                    }
                    let scale = if self.at_kind(Kind::Number) { self.scale(&format!("money {} 12", currency.value))? } else { 2 };
                    TypeKind::Money { currency: currency.value, scale }
                }
                "json" => {
                    self.take("<=")?;
                    TypeKind::Json { max: self.number()? }
                }
                "bytes" => {
                    self.take("<=")?;
                    TypeKind::Bytes { max: self.number()? }
                }
                "image" => {
                    self.take("<=")?;
                    TypeKind::Image { max: self.number()?, once: false }
                }
                "video" => {
                    self.take("<=")?;
                    TypeKind::Video { max: self.number()? }
                }
                "cursor" => TypeKind::Cursor,
                "id" => TypeKind::Id,
                "principal" => TypeKind::Principal,
                "int" if self.at_kind(Kind::Number) || matches!(self.peek().value.as_str(), "<=" | ">=" | "<" | ">" | "-") => {
                    return Err(self.int_range(&name.site, column));
                }
                "int" => TypeKind::Int,
                "time" => TypeKind::Time,
                "bool" => TypeKind::Bool,
                "enum" => {
                    self.take("(")?;
                    let mut variants = Vec::new();
                    while !self.at(")") {
                        variants.push(self.take_kind(Kind::Str)?.value);
                        if !self.maybe(",") {
                            break;
                        }
                    }
                    self.take(")")?;
                    if variants.is_empty() {
                        return Err(syntax_with(&site, "enum needs at least one variant", "enum('draft', 'published')"));
                    }
                    TypeKind::Enum { variants }
                }
                other => TypeKind::Ref { table: other.to_owned() },
            };
        }
        if self.maybe("once") {
            if !column {
                let optional = self.maybe("?");
                return Err(syntax_with(&site, "once is a column modifier, not an argument constraint; declare it on the owning table column", print::scalar_type(&ScalarType { kind, optional })).mechanical());
            }
            match &mut kind {
                TypeKind::Image { once, .. } => *once = true,
                TypeKind::Video { .. } => return Err(syntax_with(&site, "once is only specified for image columns; video ranges are unspecified", "use photo: image <=10000000 once, or remove once from the video column")),
                _ => return Err(syntax_with(&site, "once is only specified for image columns", "remove once from this column; use image <=10000000 once for one-use images")),
            }
        }
        let optional = self.maybe("?");
        Ok(ScalarType { kind, optional })
    }

    /// `n: int 1..10`: ints take no bound in the type (text's `1..80` is a
    /// length). Name the supported forms with the author's bound, instead of
    /// "expected the end of the line, got 1" (wave 5 #5, 11 lanes).
    // @ref LLP 3000.036#15.7 — a bounded int is a require or a rule, not a type (see §15.7 for why).
    fn int_range(&mut self, site: &Site, column: bool) -> Diagnostic {
        let name = (self.position >= 3 && self.tokens[self.position - 2].value == ":" && self.tokens[self.position - 3].kind == Kind::Word)
            .then(|| self.tokens[self.position - 3].value.clone()).unwrap_or_else(|| "n".into());
        let start = self.position;
        while !self.at_kind(Kind::Newline) && !self.at_kind(Kind::Eof) && !matches!(self.peek().value.as_str(), "," | ")" | "?" | ":") { self.position += 1; }
        let bound = self.source_text(start, self.position).split_whitespace().collect::<String>();
        let (low, high) = match bound.split_once("..") {
            Some((low, high)) => (Some(low.to_owned()), Some(high.to_owned())),
            None if bound.starts_with("<=") => (None, Some(bound[2..].to_owned())),
            None if bound.starts_with(">=") => (Some(bound[2..].to_owned()), None),
            None if bound.starts_with('<') => (None, bound[1..].parse::<i64>().ok().map(|n| (n - 1).to_string())),
            None if bound.starts_with('>') => (bound[1..].parse::<i64>().ok().map(|n| (n + 1).to_string()), None),
            None => (None, None),
        };
        let optional = self.at("?");
        let test = |prefix: &str| {
            let test = [low.as_ref().map(|low| format!("{prefix}{name} >= {low}")), high.as_ref().map(|high| format!("{prefix}{name} <= {high}"))]
                .into_iter().flatten().collect::<Vec<_>>().join(" and ");
            if optional { format!("({prefix}{name} = null or {test})") } else { test }
        };
        let ty = if optional { "int ?" } else { "int" };
        let rewrite = if column {
            format!("declare `{name}: {ty}` and bound it in the table's rules (`insert <- … and {}`, `update (old, next) <- … and {}`) and in each mutation that writes it (`require {} else OUT_OF_RANGE`)", test("."), test("next."), test(""))
        } else {
            format!("declare `{name}: {ty}` and refuse other values first in the body: `require {} else OUT_OF_RANGE`", test(""))
        };
        syntax_with(site, format!("int takes no range in its type (`text 1..80` bounds a length); `{bound}` is a check on the value"), rewrite).guide("types")
    }

    fn parse_block(&mut self) -> Fallible<Vec<Stmt>> {
        self.take_kind(Kind::Indent)?;
        self.parse_block_contents()
    }

    fn parse_block_contents(&mut self) -> Fallible<Vec<Stmt>> {
        let mut body = Vec::new();
        while !self.at_kind(Kind::Dedent) && !self.at_kind(Kind::Eof) {
            self.skip_newlines();
            if self.at_kind(Kind::Dedent) {
                break;
            }
            match self.parse_statement() {
                Ok(statement) => body.push(statement),
                Err(diagnostic) => {
                    self.diagnostics.push(diagnostic);
                    self.recover_line();
                }
            }
        }
        self.take_kind(Kind::Dedent)?;
        Ok(body)
    }

    fn parse_statement(&mut self) -> Fallible<Stmt> {
        let token = self.peek().clone();
        if token.kind == Kind::Word && self.peek_at(1).value == "=" && self.peek_at(2).value != "=" && reserved::BINDING_WORDS.contains(&token.value.as_str()) {
            return Err(reserved::binding(&token.site, &token.value));
        }
        match token.value.as_str() {
            "while" => return Err(unsupported(&token.site, "while", "use a bounded for domain or walk")),
            "break" => {
                let site = self.take("break")?.site;
                self.newline()?;
                return Ok(Stmt::Break { site });
            }
            "continue" => {
                let site = self.take("continue")?.site;
                self.newline()?;
                return Ok(Stmt::Continue { site });
            }
            "if" => return self.parse_if(),
            "elif" => return Err(unsupported(&token.site, "elif", "else if cond:")),
            "as" => {
                let site = self.take("as")?.site;
                let principal = self.expression(0, &[":"])?;
                self.take(":")?;
                self.newline()?;
                let body = self.parse_block()?;
                return Ok(Stmt::As { principal, body, site });
            }
            "for" => return self.parse_for(),
            "require" => return self.parse_require(),
            "return" => {
                let site = self.take("return")?.site;
                if self.at_kind(Kind::Newline) {
                    self.newline()?;
                    return Ok(Stmt::Return { value: Expr::Literal { value: Literal::Null, site: site.clone() }, site });
                }
                let value = self.expression(0, &["<newline>"])?;
                if !matches!(value, Expr::Merge(_)) {
                    self.newline()?;
                }
                return Ok(Stmt::Return { value, site });
            }
            "emit" => {
                let site = self.take("emit")?.site;
                let effect = self.word()?.value;
                let payload = self.expression(0, &["once", "<newline>"])?;
                let once = if self.maybe("once") { Some(self.expression(0, &["<newline>"])?) } else { None };
                self.newline()?;
                return Ok(Stmt::Emit { effect, payload, once, site });
            }
            "device" | "oblivious" => return Err(unsupported(&token.site, &token.value, "pass an explicit bounded argument to the operation")),
            _ => {}
        }
        if self.at_kind(Kind::Word) && self.peek_at(1).value == "=" {
            let name = self.peek().clone();
            let binding = self.local_name()?;
            self.take("=")?;
            let value = self.expression(0, &["<newline>"])?;
            if !matches!(value, Expr::Merge(_)) {
                self.newline()?;
            }
            return Ok(Stmt::Bind { names: vec![binding], value, site: name.site });
        }
        if self.at("(") && self.tuple_binding_ahead() {
            let site = self.take("(")?.site;
            let mut names = vec![self.local_name()?];
            while self.maybe(",") {
                names.push(self.local_name()?);
            }
            self.take(")")?;
            self.take("=")?;
            let value = self.expression(0, &["<newline>"])?;
            self.newline()?;
            return Ok(Stmt::Bind { names, value, site });
        }
        let value = self.expression(0, &["<newline>"])?;
        if !matches!(value, Expr::Merge(_)) {
            self.newline()?;
        }
        let site = value.site().clone();
        Ok(Stmt::Expr { value, site })
    }

    fn parse_if(&mut self) -> Fallible<Stmt> {
        let site = self.take("if")?.site;
        let condition = self.expression(0, &[":"])?;
        self.take(":")?;
        self.newline()?;
        let then_body = self.parse_block()?;
        let mut else_body = Vec::new();
        if self.at("else") {
            self.take("else")?;
            // @ref LLP 3000.007#5.1 — else if is a nested conditional with the same scope and flow rules.
            if self.at("if") {
                else_body.push(self.parse_if()?);
            } else {
                self.take(":")?;
                self.newline()?;
                else_body = self.parse_block()?;
            }
        } else if self.at("elif") {
            return Err(unsupported(&self.peek().site, "elif", "else if cond:"));
        }
        Ok(Stmt::If { condition, then_body, else_body, site })
    }

    fn parse_for(&mut self) -> Fallible<Stmt> {
        let site = self.take("for")?.site;
        let name = self.local_name()?;
        self.take("in")?;
        let domain = self.expression(0, &[":"])?;
        self.take(":")?;
        self.newline()?;
        let body = self.parse_block()?;
        Ok(Stmt::For { name, domain, body, site })
    }

    fn parse_require(&mut self) -> Fallible<Stmt> {
        let site = self.take("require")?.site;
        let condition = self.expression(0, &["else"])?;
        // @ref LLP 3000.036#14.5 — `require url like 'https://%' else BAD_URL` (wave 4 #20): name the
        // operator Quarry lacks, not a missing code the author already wrote.
        // `url like 'x'` parses as the shape use `url like`, then a string.
        let pattern = match &condition {
            Expr::ShapeUse { base, name, site } if TEXT_PATTERN_WORDS.contains(&name.to_ascii_lowercase().as_str()) => Some((name.clone(), print::expression(base), site.clone())),
            _ => {
                let next = self.peek();
                (next.kind == Kind::Word && TEXT_PATTERN_WORDS.contains(&next.value.to_ascii_lowercase().as_str()))
                    .then(|| (next.value.clone(), print::expression(&condition), next.site.clone()))
            }
        };
        if let Some((word, operand, at)) = pattern {
            return Err(syntax_with(&at, format!("Quarry has no `{word}` operator; `{operand} {word} …` is not a condition"),
                format!("compare whole text with `=` or `!=`; bound its length in the type (`{operand}: text 3..80`); declare a link `text <=200 format url` (http or https; anything else refuses E_INPUT before the program runs) or a handle `format handle`; or check the pattern in the client")).guide("types"));
        }
        if !self.at("else") {
            return Err(syntax_with(&site, "require needs a refusal code: require <condition> else CODE", format!("require {} else NOT_ALLOWED", print::expression(&condition))));
        }
        self.take("else")?;
        let code = self.word()?.value;
        // @ref LLP 3000.036#11 — the same optional message `unique … else CODE 'message'` takes.
        let message = if self.at_kind(Kind::Str) { Some(self.take_kind(Kind::Str)?.value) } else { None };
        self.newline()?;
        Ok(Stmt::Require { condition, code, message, site })
    }

    fn tuple_binding_ahead(&self) -> bool {
        let mut cursor = self.position + 1;
        if self.tokens.get(cursor).is_none_or(|t| t.kind != Kind::Word) {
            return false;
        }
        cursor += 1;
        while self.tokens.get(cursor).is_some_and(|t| t.value == ",") {
            cursor += 1;
            if self.tokens.get(cursor).is_none_or(|t| t.kind != Kind::Word) {
                return false;
            }
            cursor += 1;
        }
        self.tokens.get(cursor).is_some_and(|t| t.value == ")") && self.tokens.get(cursor + 1).is_some_and(|t| t.value == "=")
    }

    fn is_stop(&self, token: &Token, stops: &[&str]) -> bool {
        if matches!(token.kind, Kind::Newline | Kind::Dedent | Kind::Eof) {
            return true;
        }
        stops.contains(&token.value.as_str())
    }

    fn end_line(&mut self, site: &Site) -> Fallible<()> {
        if !self.at_kind(Kind::Newline) {
            return Err(syntax(&self.peek().site.clone(), format!("unexpected token after declaration from line {}", site.line)));
        }
        self.newline()
    }

    fn newline(&mut self) -> Fallible<()> {
        self.take_kind(Kind::Newline).map(|_| ())
    }

    fn skip_newlines(&mut self) {
        while self.at_kind(Kind::Newline) {
            self.position += 1;
        }
    }

    fn number(&mut self) -> Fallible<u32> {
        let token = self.take_kind(Kind::Number)?;
        if !token.value.bytes().all(|b| b.is_ascii_digit()) {
            return Err(syntax(&token.site, "this position takes an integer literal"));
        }
        token.value.parse().map_err(|_| syntax(&token.site, "this integer literal is too large"))
    }

    fn scale(&mut self, rewrite: &str) -> Fallible<u8> {
        let token = self.peek().clone();
        let scale = self.number()?;
        if scale > 12 {
            return Err(syntax_with(&token.site, "decimal and money scales must be integers from 0 through 12", format!("use {rewrite}")));
        }
        Ok(scale as u8)
    }

    /// The tokens `[from, to)` of one line as written, spacing kept by column.
    fn source_text(&self, from: usize, to: usize) -> String {
        let mut text = String::new();
        let mut end: Option<u32> = None;
        for token in &self.tokens[from..to.min(self.tokens.len())] {
            if matches!(token.kind, Kind::Newline | Kind::Indent | Kind::Dedent | Kind::Eof) { break; }
            if end.is_some_and(|end| token.site.col > end) { text.push(' '); }
            let written = if token.kind == Kind::Str { print::quote(&token.value) } else { token.value.clone() };
            end = Some(token.site.col + written.chars().count() as u32);
            text.push_str(&written);
        }
        text
    }

    fn word(&mut self) -> Fallible<Token> {
        self.take_kind(Kind::Word)
    }

    fn at(&self, value: &str) -> bool {
        self.peek().value == value
    }

    fn at_kind(&self, kind: Kind) -> bool {
        self.peek().kind == kind
    }

    fn maybe(&mut self, value: &str) -> bool {
        if !self.at(value) {
            return false;
        }
        self.position += 1;
        true
    }

    fn take(&mut self, value: &str) -> Fallible<Token> {
        let token = self.peek().clone();
        if token.value != value {
            return Err(syntax_with(&token.site, format!("expected {value:?}, got {:?}", token.value), expected::token(value)));
        }
        self.position += 1;
        Ok(token)
    }

    fn take_kind(&mut self, kind: Kind) -> Fallible<Token> {
        let token = self.peek().clone();
        if token.kind != kind {
            let expected = match kind {
                Kind::Word => "a name",
                Kind::Number => "a number",
                Kind::Str => "a string",
                Kind::Symbol => "a symbol",
                Kind::Newline => "the end of the line",
                Kind::Indent => "an indented block",
                Kind::Dedent => "the end of the block",
                Kind::Eof => "the end of the file",
            };
            return Err(syntax_with(&token.site, format!("expected {expected}, got {:?}", token.value), expected::kind(kind)));
        }
        self.position += 1;
        Ok(token)
    }

    fn peek(&self) -> &Token {
        &self.tokens[self.position.min(self.tokens.len() - 1)]
    }

    fn peek_at(&self, offset: usize) -> &Token {
        &self.tokens[(self.position + offset).min(self.tokens.len() - 1)]
    }

    fn recover_line(&mut self) {
        while !self.at_kind(Kind::Newline) && !self.at_kind(Kind::Dedent) && !self.at_kind(Kind::Eof) {
            self.position += 1;
        }
        if self.at_kind(Kind::Newline) {
            self.position += 1;
        }
    }

    fn recover_top_level(&mut self) {
        self.recover_line();
        let mut depth = 0i32;
        while !self.at_kind(Kind::Eof) {
            if self.at_kind(Kind::Indent) {
                depth += 1;
                self.position += 1;
                continue;
            }
            if self.at_kind(Kind::Dedent) {
                depth = (depth - 1).max(0);
                self.position += 1;
                continue;
            }
            if depth == 0 && self.at_kind(Kind::Word) && TOP_LEVEL.contains(&self.peek().value.as_str()) {
                return;
            }
            self.position += 1;
        }
    }
}

/// `system` is never a rule word: the system principal consults no rules.
/// Text-pattern words from SQL and other languages that Quarry does not have.
const TEXT_PATTERN_WORDS: &[&str] = &["like", "ilike", "starts", "startswith", "starts_with", "ends", "endswith", "ends_with", "contains", "matches", "regexp", "glob", "similar"];

fn current_rule(expr: &Expr) -> Fallible<()> {
    match expr {
        Expr::Name { name, site } if name == "system" => Err(unsupported(site, "the system principal in a rule", "deny")),
        Expr::Unary { value, .. } => current_rule(value),
        Expr::Binary { left, right, .. } => {
            current_rule(left)?;
            current_rule(right)
        }
        Expr::Member { base, .. } => current_rule(base),
        Expr::Exists { read, .. } | Expr::Created { read, .. } => read.keys.iter().try_for_each(|key| current_rule(&key.value)),
        Expr::Read(read) => read.keys.iter().try_for_each(|key| current_rule(&key.value)),
        _ => Ok(()),
    }
}

fn focalize(expr: &Expr, binding: &str) -> Expr {
    match expr {
        Expr::Name { name, site } if name == binding => Expr::Focal { site: site.clone() },
        Expr::Unary { op, value, site } => Expr::Unary { op: op.clone(), value: Box::new(focalize(value, binding)), site: site.clone() },
        Expr::Binary { op, left, right, site } => Expr::Binary { op: op.clone(), left: Box::new(focalize(left, binding)), right: Box::new(focalize(right, binding)), site: site.clone() },
        Expr::Member { base, name, site } => Expr::Member { base: Box::new(focalize(base, binding)), name: name.clone(), site: site.clone() },
        Expr::Call { name, args, site } => Expr::Call { name: name.clone(), args: args.iter().map(|a| focalize(a, binding)).collect(), site: site.clone() },
        Expr::Read(read) => Expr::Read(focalize_read(read, binding)),
        Expr::Exists { read, site } => Expr::Exists { read: focalize_read(read, binding), site: site.clone() },
        Expr::Created { read, site } => Expr::Created { read: focalize_read(read, binding), site: site.clone() },
        other => other.clone(),
    }
}

fn focalize_read(read: &ReadExpr, binding: &str) -> ReadExpr {
    ReadExpr { keys: read.keys.iter().map(|key| KeyPart { column: key.column.clone(), value: focalize(&key.value, binding), site: key.site.clone() }).collect(), ..read.clone() }
}

fn title(value: &str) -> String {
    let mut chars = value.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CHAT: &str = include_str!("../../../apps/chat/snapback/schema.q");

    #[test]
    fn parses_the_chat_schema() {
        let (document, diagnostics) = parse_document("schema.q", CHAT);
        assert!(diagnostics.is_empty(), "{diagnostics:#?}");
        assert_eq!(document.tables.iter().map(|table| table.name.as_str()).collect::<Vec<_>>(), ["profiles", "conversations", "memberships", "messages", "readMarkers"]);
        assert_eq!(document.maintains.len(), 1);
        assert_eq!(document.programs.iter().map(|program| program.name.as_str()).collect::<Vec<_>>(), ["thread", "inbox", "addMember", "leave", "send", "sendPhoto", "edit", "unsend", "myMembership", "room", "markRead"]);
        let messages = &document.tables[3];
        assert_eq!(messages.name, "messages");
        let sync = messages.sync.as_ref().unwrap();
        assert_eq!(sync.audience, SyncAudience::Inferred { principal: None });
        assert_eq!(sync.horizon, Some((500, SyncOrder::Index("byConvTime".into()))));
        assert_eq!(messages.retain.as_ref().unwrap().0, "delivered-history");
        let markers = document.tables.iter().find(|table| table.name == "readMarkers").unwrap();
        assert!(markers.sync.is_none(), "the starter's read marker is not replicated");
        let key = markers.indexes.iter().find(|index| index.name == "byConversationPrincipal").unwrap();
        assert!(key.unique);
        assert_eq!(key.columns, ["conversationId", "principal"]);
        assert_eq!(document.programs.iter().find(|program| program.name == "room").unwrap().kind, ProgramKind::Query);
        assert_eq!(document.programs.iter().find(|program| program.name == "markRead").unwrap().kind, ProgramKind::Mutation);
    }

    #[test]
    fn refuses_with_a_rewrite() {
        let (_, diagnostics) = parse_document("t.q", "table todos:\n  by ownerId\n");
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].code, "E_QUARRY_SYNTAX");
        assert_eq!(diagnostics[0].rewrite, "by byOwnerId: ownerId");
    }
}
