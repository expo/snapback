//! The Quarry parser, ported from Snapback 2. Every refusal is a located
//! diagnostic with a rewrite; the parser recovers per line and per
//! declaration so one document yields every problem at once.

use crate::ast::*;
use crate::diag::{Diagnostic, Fallible, Site, syntax, syntax_with, unsupported};
use crate::lexer::{Kind, Token, lex};
use crate::print;

fn precedence(op: &str) -> Option<u8> {
    Some(match op {
        "??" => 1,
        "or" => 2,
        "and" => 3,
        "=" | "!=" | "<" | "<=" | ">" | ">=" => 4,
        "+" | "-" => 5,
        "*" | "/" | "%" => 6,
        _ => return None,
    })
}

pub fn parse_document(file: &str, source: &str) -> (Document, Vec<Diagnostic>) {
    let (tokens, diagnostics) = lex(file, source);
    let mut parser = Parser { tokens, position: 0, diagnostics, document: Document { file: file.to_owned(), ..Document::default() } };
    parser.document();
    (parser.document, parser.diagnostics)
}

struct Parser {
    tokens: Vec<Token>,
    position: usize,
    diagnostics: Vec<Diagnostic>,
    document: Document,
}

const TOP_LEVEL: [&str; 16] = ["use", "table", "maintain", "channel", "query", "mutation", "job", "effect", "shape", "fn", "proc", "cursor", "schedule", "index", "unique", "deliver"];

impl Parser {
    fn document(&mut self) {
        while !self.at_kind(Kind::Eof) {
            self.skip_newlines();
            if self.at_kind(Kind::Eof) {
                break;
            }
            let result = self.top_level();
            if let Err(diagnostic) = result {
                self.diagnostics.push(diagnostic);
                self.recover_top_level();
            }
        }
    }

    fn top_level(&mut self) -> Fallible<()> {
        let token = self.peek().clone();
        match token.value.as_str() {
            "use" => self.parse_use(),
            "table" => {
                let table = self.parse_table()?;
                self.document.tables.push(table);
                Ok(())
            }
            "maintain" => {
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
            "proc" => self.parse_proc_declaration(),
            "cursor" => Err(unsupported(&token.site, "cursor as a declaration", "cursor is reserved for a future Quarry form; rename this declaration")),
            "channel" => Err(unsupported(&token.site, "channel", "ephemeral channels arrive after the first slice; keep presence and typing in the client for now")),
            "schedule" => {
                let schedule = self.parse_schedule()?;
                self.document.schedules.push(schedule);
                Ok(())
            }
            "deliver" => Err(syntax_with(&token.site, "deliver is a table line spelled sync in Snapback 4", "sync to memberships[.conversationId] last 500 by byConvTime")),
            "index" | "unique" => Err(syntax_with(&token.site, "top-level indexes are invalid; place by/unique inside the table block", "move the index line into its table block")),
            "device" | "oblivious" => Err(unsupported(&token.site, &token.value, "pass an explicit bounded argument to the operation")),
            other => Err(syntax(&token.site, format!("unexpected top-level {other:?}"))),
        }
    }

    fn parse_use(&mut self) -> Fallible<()> {
        let site = self.take("use")?.site;
        let kind = self.word()?;
        match kind.value.as_str() {
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
            other => return Err(unsupported(&kind.site, &format!("use {other}"), "use identity, use identity password, use identity guests, or use personas alice, bob")),
        }
        self.end_line(&site)
    }

    fn parse_table(&mut self) -> Fallible<TableDecl> {
        let site = self.take("table")?.site;
        let name = self.binding_name()?;
        self.take(":")?;
        self.newline()?;
        self.take_kind(Kind::Indent)?;
        let mut table = TableDecl { name: name.clone(), columns: Vec::new(), indexes: Vec::new(), rules: Vec::new(), immutable: Vec::new(), caps: Vec::new(), final_exists: Vec::new(), retain: None, expire: None, public: None, sync: None, site };
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
        match token.value.as_str() {
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
            "sync" => {
                if table.sync.is_some() {
                    return Err(syntax_with(&token.site, format!("table {} has more than one sync line", table.name), "one sync line per table"));
                }
                let sync = self.parse_sync()?;
                table.sync = Some(sync);
                Ok(())
            }
            "deliver" => Err(syntax_with(&token.site, "deliver is spelled sync in Snapback 4: the engine maintains each member's partition", "sync to memberships[.conversationId] last 500 by byConvTime")),
            "after" => {
                let site = self.take("after")?.site;
                self.take("insert")?;
                let value = self.parse_focal_rule_value("after insert", &site)?;
                if !matches!(value, Expr::Exists { .. }) {
                    return Err(syntax(value.site(), "after insert requires exactly one exists predicate"));
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
        let rewrite = "sync to memberships[.conversationId] last 500 by byConvTime";
        let audience = if self.maybe("public") {
            SyncAudience::Public
        } else {
            if !self.maybe("to") {
                return Err(syntax_with(&site, "sync takes public, to .column, or to table[.column, ...]", rewrite));
            }
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
                        return Err(syntax_with(&site, format!("sync to {table}[...] takes .column keys of this table"), rewrite));
                    }
                    self.take(".")?;
                    prefix.push(self.word()?.value);
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
        };
        let mut horizon = None;
        if self.maybe("last") {
            let n = self.number()?;
            if !self.maybe("by") {
                return Err(syntax_with(&site, "a horizon is `last N by index`", rewrite));
            }
            let index = self.word()?.value;
            horizon = Some((n, index));
        }
        if !self.at_kind(Kind::Newline) && !self.at_kind(Kind::Eof) {
            return Err(syntax_with(&site, format!("unexpected {} after the sync line", self.peek().value), rewrite));
        }
        self.newline()?;
        Ok(SyncDecl { audience, horizon, site })
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
        let type_ = self.parse_type(true)?;
        if matches!(type_.kind, TypeKind::Cursor) {
            return Err(syntax_with(&name.site, "cursor is an operation argument type, not a table column", "use c: cursor ? on a query"));
        }
        self.newline()?;
        Ok(ColumnDecl { name: name.value, type_, site: name.site })
    }

    fn parse_index(&mut self, unique: bool) -> Fallible<IndexDecl> {
        let site = self.take(if unique { "unique" } else { "by" })?.site;
        let mut explicit = None;
        if self.at_kind(Kind::Word) && self.peek_at(1).value == ":" {
            explicit = Some(self.word()?.value);
            self.take(":")?;
        }
        let mut columns = vec![self.word()?.value];
        while self.maybe(",") {
            columns.push(self.word()?.value);
        }
        let Some(name) = explicit else {
            let inferred = format!("by{}", columns.iter().map(|c| title(c)).collect::<String>());
            return Err(syntax_with(&site, "index declarations require an explicit name", format!("{} {inferred}: {}", if unique { "unique" } else { "by" }, columns.join(", "))));
        };
        self.newline()?;
        Ok(IndexDecl { name, columns, unique, site })
    }

    fn parse_maintain(&mut self) -> Fallible<MaintainDecl> {
        let site = self.take("maintain")?.site;
        let name = self.binding_name()?;
        self.take(":")?;
        let aggregate = self.word()?;
        if aggregate.value != "count" && aggregate.value != "sum" {
            return Err(unsupported(&aggregate.site, &format!("maintain {}", aggregate.value), "use maintain name: count table by columns, or maintain name: sum table of intColumn by columns"));
        }
        let source = self.word()?.value;
        let mut column = None;
        if aggregate.value == "sum" {
            self.take("of")?;
            column = Some(self.word()?.value);
        }
        self.take("by")?;
        let mut by = vec![self.word()?.value];
        while self.maybe(",") {
            by.push(self.word()?.value);
        }
        self.newline()?;
        self.take_kind(Kind::Indent)?;
        let mut read = None;
        let mut readable = None;
        while !self.at_kind(Kind::Dedent) && !self.at_kind(Kind::Eof) {
            self.skip_newlines();
            if self.at_kind(Kind::Dedent) {
                break;
            }
            let result: Fallible<()> = (|| {
                let effect = self.word()?;
                if effect.value != "read" && effect.value != "readable" {
                    let rewrite = if effect.value == "public" { "read <- allow  -- maintain has no public property" } else { "use read <- rule; add readable <- rule only for non-uniform source disclosure" };
                    return Err(syntax_with(&effect.site, format!("unknown maintain property {}", effect.value), rewrite));
                }
                let value = self.parse_focal_rule_value(&effect.value, &effect.site)?;
                self.newline()?;
                let declaration = RuleDecl { effect: Effect::Read, bindings: Vec::new(), value, site: effect.site.clone() };
                if effect.value == "read" {
                    read = Some(declaration);
                } else {
                    readable = Some(declaration);
                }
                Ok(())
            })();
            if let Err(diagnostic) = result {
                self.diagnostics.push(diagnostic);
                self.recover_line();
            }
        }
        self.take_kind(Kind::Dedent)?;
        let Some(read) = read else {
            return Err(syntax_with(&site, format!("maintain {name} requires read <- rule"), "read <- exists memberships[.conversationId, viewer]"));
        };
        Ok(MaintainDecl { name, aggregate: aggregate.value, source, column, by, read, readable, site })
    }

    /// `schedule name every <N>m|h|d [at HH:MM]: job`.
    fn parse_schedule(&mut self) -> Fallible<ScheduleDecl> {
        let site = self.take("schedule")?.site;
        let rewrite = "schedule digest every 1d at 08:00: sendDigests";
        let name = self.binding_name()?;
        if !self.maybe("every") {
            return Err(syntax_with(&site, "a schedule fires every so often: schedule name every 2m: job", rewrite));
        }
        let amount = self.number()?;
        let unit = self.word()?;
        let every_ms = u64::from(amount)
            * match unit.value.as_str() {
                "m" => 60_000,
                "h" => 3_600_000,
                "d" => 86_400_000,
                _ => return Err(syntax_with(&unit.site, "a period is a number and m, h or d: 2m, 1h, 1d", rewrite)),
            };
        if every_ms < 60_000 {
            return Err(syntax_with(&unit.site, "the shortest period is 1m", rewrite));
        }
        let mut offset_ms = 0;
        if self.maybe("at") {
            let hours = self.number()?;
            self.take(":")?;
            let minutes = self.number()?;
            if hours > 23 || minutes > 59 {
                return Err(syntax_with(&site, "at takes a time of day, HH:MM", rewrite));
            }
            offset_ms = (u64::from(hours) * 60 + u64::from(minutes)) * 60_000;
            if offset_ms >= every_ms {
                return Err(syntax_with(&site, "at names a time of day inside the period; it needs every 1d (or longer)", rewrite));
            }
        }
        self.take(":")?;
        let target = self.word()?.value;
        self.end_line(&site)?;
        Ok(ScheduleDecl { name, every_ms, offset_ms, target, site })
    }

    fn parse_effect(&mut self) -> Fallible<EffectDecl> {
        let site = self.take("effect")?.site;
        let name = self.binding_name()?;
        self.take("from")?;
        let module = self.word()?.value;
        self.newline()?;
        Ok(EffectDecl { name, module, site })
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
        if self.at("(") {
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

    fn parse_program(&mut self) -> Fallible<ProgramDecl> {
        let kind_token = self.word()?;
        let kind = match kind_token.value.as_str() {
            "query" => ProgramKind::Query,
            "mutation" => ProgramKind::Mutation,
            _ => ProgramKind::Job,
        };
        let name = self.binding_name()?;
        let args = self.parse_args()?;
        if self.at("->") {
            return Err(unsupported(&self.peek().site.clone(), "result annotations", "results are inferred; remove the annotation"));
        }
        self.take(":")?;
        self.newline()?;
        let body = if kind == ProgramKind::Job { self.parse_chunks()? } else { self.parse_block()? };
        if body.is_empty() {
            return Err(syntax(&kind_token.site, format!("{} {name} has an empty body", kind_token.value)));
        }
        Ok(ProgramDecl { kind, name, args, body, site: kind_token.site })
    }

    fn parse_chunks(&mut self) -> Fallible<Vec<Stmt>> {
        self.take_kind(Kind::Indent)?;
        let mut chunks = Vec::new();
        while !self.at_kind(Kind::Dedent) && !self.at_kind(Kind::Eof) {
            self.skip_newlines();
            if self.at_kind(Kind::Dedent) {
                break;
            }
            let site = self.take("chunk")?.site;
            let name = self.binding_name()?;
            self.take("in")?;
            let table = self.word()?;
            let mut domain = if self.at("[") { self.parse_read(&table.value, &table.site)? } else { ReadExpr { table: table.value.clone(), keys: Vec::new(), index: None, range: None, site: table.site.clone() } };
            if !self.at("first") {
                return Err(syntax(&self.peek().site.clone(), "chunk requires first N by index"));
            }
            domain = self.parse_range(domain)?;
            if domain.index.is_none() || domain.range.as_ref().is_none_or(|r| r.order != Order::Asc || r.cursor.is_some()) {
                return Err(syntax(&site, "chunk requires table[prefix] first N by index"));
            }
            self.take(":")?;
            self.newline()?;
            let body = self.parse_block()?;
            if body.is_empty() {
                return Err(syntax(&site, "chunk body cannot be empty"));
            }
            chunks.push(Stmt::For { name, domain: Expr::Read(domain), body, site });
        }
        self.take_kind(Kind::Dedent)?;
        Ok(chunks)
    }

    fn parse_shape_declaration(&mut self) -> Fallible<()> {
        let site = self.take("shape")?.site;
        let name = self.binding_name()?;
        if self.maybe("from") {
            let module = self.word()?.value;
            self.newline()?;
            self.document.shape_imports.push(Import { name, module, site });
            return Ok(());
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
        if self.maybe("from") {
            let module = self.word()?.value;
            self.newline()?;
            self.document.function_imports.push(Import { name, module, site });
            return Ok(());
        }
        let args = self.parse_args()?;
        self.take(":")?;
        let body = self.expression(0, &["<newline>"])?;
        self.newline()?;
        self.document.functions.push(FunctionDecl { name, args, body, site });
        Ok(())
    }

    fn parse_proc_declaration(&mut self) -> Fallible<()> {
        let site = self.take("proc")?.site;
        let name = self.binding_name()?;
        if self.maybe("from") {
            let module = self.word()?.value;
            self.newline()?;
            self.document.proc_imports.push(Import { name, module, site });
            return Ok(());
        }
        let args = self.parse_args()?;
        self.take(":")?;
        self.newline()?;
        let body = self.parse_block()?;
        self.document.procs.push(ProcDecl { name, args, body, site });
        Ok(())
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
            let binding = self.binding_name()?;
            self.take(":")?;
            let type_ = self.parse_type(false)?;
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
            self.take("<=")?;
            let max = self.number()?;
            if item.optional {
                return Err(syntax(&site, "list element types cannot be optional"));
            }
            kind = TypeKind::List { item: Box::new(item), max };
        } else {
            let name = self.word()?;
            kind = match name.value.as_str() {
                "text" => {
                    let (min, max) = if self.maybe("<=") {
                        (None, self.number()?)
                    } else {
                        let min = self.number()?;
                        self.take(".")?;
                        self.take(".")?;
                        (Some(min), self.number()?)
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
                    TypeKind::Enum { variants }
                }
                other => TypeKind::Ref { table: other.to_owned() },
            };
        }
        if self.maybe("once") {
            if !column {
                return Err(syntax_with(&site, "once is a column modifier, not an argument constraint", "remove once from this argument; declare image <=10000000 once on the owning table column"));
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

    fn parse_block(&mut self) -> Fallible<Vec<Stmt>> {
        self.take_kind(Kind::Indent)?;
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
        match token.value.as_str() {
            "while" => return Err(unsupported(&token.site, "while", "use a bounded for domain or walk")),
            "if" => return self.parse_if(),
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
                let payload = self.expression(0, &["<newline>"])?;
                self.newline()?;
                return Ok(Stmt::Emit { effect, payload, site });
            }
            "device" | "oblivious" => return Err(unsupported(&token.site, &token.value, "pass an explicit bounded argument to the operation")),
            _ => {}
        }
        if self.at_kind(Kind::Word) && self.peek_at(1).value == "=" {
            let name = self.peek().clone();
            let binding = self.binding_name()?;
            self.take("=")?;
            let value = self.expression(0, &["<newline>"])?;
            if !matches!(value, Expr::Merge(_)) {
                self.newline()?;
            }
            return Ok(Stmt::Bind { names: vec![binding], value, site: name.site });
        }
        if self.at("(") && self.tuple_binding_ahead() {
            let site = self.take("(")?.site;
            let mut names = vec![self.binding_name()?];
            while self.maybe(",") {
                names.push(self.binding_name()?);
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
            self.take(":")?;
            self.newline()?;
            else_body = self.parse_block()?;
        }
        Ok(Stmt::If { condition, then_body, else_body, site })
    }

    fn parse_for(&mut self) -> Fallible<Stmt> {
        let site = self.take("for")?.site;
        let name = self.binding_name()?;
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
        if !self.at("else") {
            return Err(syntax_with(&site, "require needs a refusal code: require <condition> else CODE", format!("require {} else NOT_ALLOWED", print::expression(&condition))));
        }
        self.take("else")?;
        let code = self.word()?.value;
        self.newline()?;
        Ok(Stmt::Require { condition, code, site })
    }

    fn expression(&mut self, minimum: u8, stops: &[&str]) -> Fallible<Expr> {
        let mut left = self.prefix(stops)?;
        loop {
            let token = self.peek().clone();
            if self.is_stop(&token, stops) {
                break;
            }
            let Some(precedence) = precedence(&token.value) else { break };
            if precedence < minimum {
                break;
            }
            self.position += 1;
            let right = self.expression(precedence + u8::from(token.value != "??"), stops)?;
            left = Expr::Binary { op: token.value, left: Box::new(left), right: Box::new(right), site: token.site };
        }
        // `a if cond else b`, below every operator: the value is one of the
        // two, and the other is never evaluated.
        if minimum == 0 && self.at("if") && !stops.contains(&"if") && self.peek_at(1).value != "absent" {
            let site = self.take("if")?.site;
            let mut inner: Vec<&str> = stops.to_vec();
            inner.push("else");
            let condition = self.expression(0, &inner)?;
            if !self.maybe("else") {
                return Err(syntax_with(&site, "a conditional value takes both arms: value if condition else other", format!("{} if {} else null", print::expression(&left), print::expression(&condition))));
            }
            let otherwise = self.expression(0, stops)?;
            left = Expr::If { then: Box::new(left), condition: Box::new(condition), otherwise: Box::new(otherwise), site };
        }
        Ok(left)
    }

    fn prefix(&mut self, stops: &[&str]) -> Fallible<Expr> {
        let token = self.peek().clone();
        if token.value == "not" {
            self.position += 1;
            let value = self.expression(7, stops)?;
            return self.postfix(Expr::Unary { op: "not".into(), value: Box::new(value), site: token.site }, stops);
        }
        if token.value == "-" && !(self.peek_at(1).kind == Kind::Word && self.peek_at(2).value == "[") {
            self.position += 1;
            let value = self.expression(7, stops)?;
            return self.postfix(Expr::Unary { op: "-".into(), value: Box::new(value), site: token.site }, stops);
        }
        if token.value == "exists" || token.value == "created" {
            self.position += 1;
            let value = self.prefix(stops)?;
            let Expr::Read(read) = value else {
                return Err(syntax(value.site(), format!("{} requires an indexed read t[key]", token.value)));
            };
            if read.range.is_some() {
                return Err(syntax(&read.site, format!("{} requires an indexed read t[key]", token.value)));
            }
            return Ok(if token.value == "exists" { Expr::Exists { read, site: token.site } } else { Expr::Created { read, site: token.site } });
        }
        if token.value == "walk" {
            return self.parse_walk();
        }
        if matches!(token.value.as_str(), "insert" | "update" | "upsert" | "delete") {
            return self.parse_write();
        }
        if (token.value == "+" && (self.peek_at(1).kind == Kind::Word || self.peek_at(1).value == "~")) || token.value == "~" || (token.value == "-" && self.peek_at(1).kind == Kind::Word && self.peek_at(2).value == "[") {
            return Err(syntax_with(&token.site, "write sigils are invalid; use insert, update, upsert, or delete", "use insert, update, upsert, or delete"));
        }
        if token.value == "merge" {
            return self.parse_merge().map(Expr::Merge);
        }
        if token.value == "device" || token.value == "oblivious" {
            return Err(unsupported(&token.site, &token.value, "pass an explicit bounded argument to the operation"));
        }
        let value = match token.kind {
            Kind::Str => {
                self.position += 1;
                Expr::Literal { value: Literal::Str(token.value.clone()), site: token.site }
            }
            Kind::Number => {
                self.position += 1;
                Expr::Literal { value: Literal::Number(token.value.clone()), site: token.site }
            }
            _ if token.value == "true" || token.value == "false" || token.value == "null" => {
                self.position += 1;
                Expr::Literal { value: match token.value.as_str() { "true" => Literal::Bool(true), "false" => Literal::Bool(false), _ => Literal::Null }, site: token.site }
            }
            _ if token.value == "." => {
                self.position += 1;
                let focal = Expr::Focal { site: token.site.clone() };
                if self.at_kind(Kind::Word) {
                    let name = self.word()?.value;
                    Expr::Member { base: Box::new(focal), name, site: token.site }
                } else {
                    focal
                }
            }
            _ if token.value == "[" => {
                self.position += 1;
                let mut items = Vec::new();
                while !self.at("]") {
                    items.push(self.expression(0, &[",", "]"])?);
                    if !self.maybe(",") {
                        break;
                    }
                }
                self.take("]")?;
                Expr::Array { items, site: token.site }
            }
            _ if token.value == "{" => {
                let fields = self.parse_object_fields()?;
                Expr::Object { fields, site: token.site }
            }
            _ if token.value == "(" => {
                self.position += 1;
                let first = self.expression(0, &[",", ")"])?;
                let value = if self.maybe(",") {
                    let mut items = vec![first];
                    loop {
                        items.push(self.expression(0, &[",", ")"])?);
                        if !self.maybe(",") {
                            break;
                        }
                    }
                    Expr::Array { items, site: token.site }
                } else {
                    first
                };
                self.take(")")?;
                value
            }
            Kind::Word => {
                self.position += 1;
                Expr::Name { name: token.value.clone(), site: token.site }
            }
            _ => return Err(syntax(&token.site, format!("expected expression, got {:?}", token.value))),
        };
        self.postfix(value, stops)
    }

    fn postfix(&mut self, initial: Expr, stops: &[&str]) -> Fallible<Expr> {
        let mut value = initial;
        loop {
            if self.at(".") && self.peek_at(1).kind == Kind::Word {
                let site = self.take(".")?.site;
                let name = self.word()?.value;
                value = Expr::Member { base: Box::new(value), name, site };
            } else if self.at("(") && matches!(value, Expr::Name { .. }) {
                let Expr::Name { name, .. } = value else { unreachable!() };
                let site = self.take("(")?.site;
                let mut args = Vec::new();
                while !self.at(")") {
                    args.push(self.expression(0, &[",", ")"])?);
                    if !self.maybe(",") {
                        break;
                    }
                }
                self.take(")")?;
                value = Expr::Call { name, args, site };
            } else if self.at("[") && matches!(value, Expr::Name { .. }) {
                let Expr::Name { name, site } = value else { unreachable!() };
                value = Expr::Read(self.parse_read(&name, &site)?);
            } else if matches!(value, Expr::Name { .. }) && matches!(self.peek().value.as_str(), "first" | "after" | "last") {
                // `t first N by index`: the whole table's page, the empty
                // prefix spelled without brackets, as `chunk` takes it.
                let Expr::Name { name, site } = value else { unreachable!() };
                value = Expr::Read(ReadExpr { table: name, keys: Vec::new(), index: None, range: None, site });
            } else if matches!(value, Expr::Read(_)) && self.at("where") {
                let site = self.take("where")?.site;
                let predicate = self.expression(0, &["<newline>", "{", ",", "}"])?;
                let Expr::Read(read) = &value else { unreachable!() };
                let mut repaired = read.clone();
                if repaired.range.is_none() {
                    repaired.range = Some(RangeSpec { order: Order::Asc, take: 50, cursor: None, site: site.clone() });
                }
                return Err(Diagnostic::new(&site, "E_QUARRY_UNSUPPORTED", format!("where is not a Quarry filter; index the predicate {} or check it in the read rule", print::expression(&predicate)), format!("declare an index whose prefix pins `{}`, then read {}", print::expression(&predicate), print::read_expr(&repaired))).guide("indexes"));
            } else if matches!(value, Expr::Read(_)) && self.at("before") {
                return Err(unsupported(&self.peek().site.clone(), "before", "use after c; reverse display order in the client when needed"));
            } else if matches!(value, Expr::Read(_)) && matches!(self.peek().value.as_str(), "after" | "first" | "last" | "by") {
                let Expr::Read(read) = value else { unreachable!() };
                value = Expr::Read(self.parse_range(read)?);
            } else if self.maybe("!") {
                let assertion = self.tokens[self.position - 1].site.clone();
                if !self.maybe("else") {
                    return Err(syntax_with(&assertion, "presence assertions require a refusal code", format!("{} ! else NOT_FOUND", print::expression(&value))));
                }
                let code = self.word()?.value;
                value = Expr::Assert { value: Box::new(value), code, site: assertion };
            } else if self.at("{") {
                let site = self.take("{")?.site;
                let fields = self.parse_shape_fields()?;
                self.take("}")?;
                value = Expr::Shape { base: Box::new(value), fields, site };
            } else if self.at_kind(Kind::Word) && precedence(&self.peek().value).is_none() && !stops.contains(&self.peek().value.as_str()) && !matches!(self.peek().value.as_str(), "else" | "for" | "in" | "if" | "absent") {
                let named = self.word()?;
                value = Expr::ShapeUse { base: Box::new(value), name: named.value, site: named.site };
            } else {
                break;
            }
        }
        Ok(value)
    }

    fn parse_read(&mut self, table: &str, site: &Site) -> Fallible<ReadExpr> {
        self.take("[")?;
        let mut keys = Vec::new();
        while !self.at("]") {
            let key_site = self.peek().site.clone();
            let mut column = None;
            if self.at_kind(Kind::Word) && self.peek_at(1).value == "=" {
                column = Some(self.word()?.value);
                self.take("=")?;
            }
            let value = self.expression(0, &[",", "]"])?;
            keys.push(KeyPart { column, value, site: key_site });
            if !self.maybe(",") {
                break;
            }
        }
        self.take("]")?;
        Ok(ReadExpr { table: table.to_owned(), keys, index: None, range: None, site: site.clone() })
    }

    fn parse_range(&mut self, mut read: ReadExpr) -> Fallible<ReadExpr> {
        let mut order = None;
        let mut take = None;
        let mut cursor: Option<Box<Expr>> = None;
        let site = self.peek().site.clone();
        let mut highest: i32 = -1;
        let mut seen = std::collections::BTreeSet::new();
        let mut violation: Option<Token> = None;
        while matches!(self.peek().value.as_str(), "after" | "first" | "last" | "by") {
            let key = self.word()?;
            let rank = match key.value.as_str() {
                "after" => 0,
                "first" | "last" => 1,
                _ => 2,
            };
            if violation.is_none() && (seen.contains(&rank) || rank < highest) {
                violation = Some(key.clone());
            }
            seen.insert(rank);
            highest = highest.max(rank);
            match key.value.as_str() {
                "after" => {
                    let candidate = self.expression(0, &["after", "first", "last", "by", "where", "<newline>", ":", "{", ",", "}"])?;
                    if cursor.is_none() {
                        cursor = Some(Box::new(candidate));
                    }
                }
                "first" | "last" => {
                    let candidate = self.number()?;
                    if take.is_none() {
                        order = Some(if key.value == "first" { Order::Asc } else { Order::Desc });
                        take = Some(candidate);
                    }
                }
                _ => {
                    let candidate = self.word()?.value;
                    if read.index.is_none() {
                        read.index = Some(candidate);
                    }
                }
            }
        }
        if take.is_none() && cursor.is_none() {
            if let Some(violation) = violation {
                return Err(syntax_with(&violation.site, "read modifiers may appear once and only in canonical order", print::read_expr(&read)));
            }
            return Ok(read);
        }
        let (Some(take), Some(order)) = (take, order) else {
            return Err(syntax_with(&site, "range reads require first N or last N", format!("{} first 50", print::read_expr(&read))));
        };
        read.range = Some(RangeSpec { order, take, cursor, site: site.clone() });
        if let Some(violation) = violation {
            return Err(syntax_with(&violation.site, "read modifiers may appear once and only in canonical order", print::read_expr(&read)));
        }
        Ok(read)
    }

    fn parse_merge(&mut self) -> Fallible<MergeExpr> {
        let site = self.take("merge")?.site;
        let table = self.word()?.value;
        let mut cursor = None;
        if self.at("before") {
            return Err(unsupported(&self.peek().site.clone(), "before", "use after c in the merge header"));
        }
        if self.at("after") {
            self.take("after")?;
            cursor = Some(Box::new(self.expression(0, &["first", "last", "by", ":"])?));
        }
        let bound = self.peek().clone();
        if !self.at("first") && !self.at("last") {
            return Err(syntax_with(&bound.site, "merge modifiers use [after cursor] first|last N by index", format!("merge {table} first 20 by index:")));
        }
        let order = if self.word()?.value == "first" { Order::Asc } else { Order::Desc };
        let take = self.number()?;
        if !self.at("by") {
            return Err(syntax_with(&self.peek().site.clone(), "merge requires by <index> in its header", format!("merge {table} {} {take} by index:", if order == Order::Asc { "first" } else { "last" })));
        }
        self.take("by")?;
        let index = self.word()?.value;
        self.take(":")?;
        self.newline()?;
        if !self.at_kind(Kind::Indent) {
            return Err(syntax_with(&self.peek().site.clone(), "merge requires an indented block with at least one [prefix] lane", "[viewer]"));
        }
        self.take_kind(Kind::Indent)?;
        let mut lanes = Vec::new();
        while !self.at_kind(Kind::Dedent) && !self.at_kind(Kind::Eof) {
            self.skip_newlines();
            if self.at_kind(Kind::Dedent) {
                break;
            }
            let lane_site = self.peek().site.clone();
            let keys = self.parse_read(&table, &lane_site)?.keys;
            let columns = if keys.iter().any(|key| key.column.is_some()) { Some(keys.iter().map(|key| key.column.clone()).collect()) } else { None };
            let prefix = keys.into_iter().map(|key| key.value).collect();
            let mut loop_ = None;
            if self.maybe("for") {
                let name = self.binding_name()?;
                self.take("in")?;
                let domain = self.expression(0, &["<newline>"])?;
                match domain {
                    Expr::Read(read) if read.range.is_some() => loop_ = Some((name, read)),
                    other => return Err(syntax_with(other.site(), "a merge for lane requires a bounded range read", "for row in table[prefix] first 50 by index")),
                }
            }
            self.newline()?;
            lanes.push(MergeLane { prefix, columns, loop_, site: lane_site });
        }
        self.take_kind(Kind::Dedent)?;
        if lanes.is_empty() {
            return Err(syntax_with(&site, "merge requires at least one lane", "[viewer]"));
        }
        Ok(MergeExpr { table, index, order, take, cursor, lanes, site })
    }

    fn parse_shape_fields(&mut self) -> Fallible<Vec<ShapeField>> {
        let mut fields = Vec::new();
        while !self.at("}") {
            let field_site = self.peek().site.clone();
            if self.maybe("*") {
                fields.push(ShapeField::Spread { site: field_site });
            } else if self.at(".") && self.peek_at(1).value == "." && self.peek_at(2).value == "." {
                self.take(".")?;
                self.take(".")?;
                self.take(".")?;
                fields.push(ShapeField::NamedSpread { name: self.word()?.value, site: field_site });
            } else {
                let name = self.word()?.value;
                if self.maybe(":") {
                    let value = self.expression(0, &[",", "}"])?;
                    fields.push(ShapeField::Field { name, value, site: field_site });
                } else {
                    fields.push(ShapeField::Bare { name, site: field_site });
                }
            }
            if !self.maybe(",") {
                break;
            }
        }
        Ok(fields)
    }

    fn parse_write(&mut self) -> Fallible<Expr> {
        let op_token = self.word()?;
        let table = self.word()?.value;
        let op = match op_token.value.as_str() {
            "insert" => WriteOp::Insert,
            "update" => WriteOp::Update,
            "upsert" => WriteOp::Upsert,
            _ => WriteOp::Delete,
        };
        let keys = if op == WriteOp::Insert { Vec::new() } else { self.parse_read(&table, &op_token.site)?.keys };
        let fields = if op == WriteOp::Delete { Vec::new() } else { self.parse_object_fields()? };
        let mut if_absent = false;
        let mut condition = None;
        if self.maybe("if") {
            match op {
                WriteOp::Insert => {
                    self.take("absent")?;
                    if_absent = true;
                }
                WriteOp::Update => condition = Some(Box::new(self.expression(0, &["<newline>"])?)),
                _ => return Err(syntax_with(&op_token.site, "if follows insert or update", "use insert ... if absent or update ... if condition")),
            }
        }
        Ok(Expr::Write { op, table, keys, fields, if_absent, condition, site: op_token.site })
    }

    fn parse_object_fields(&mut self) -> Fallible<Vec<ObjectField>> {
        self.take("{")?;
        let mut fields = Vec::new();
        while !self.at("}") {
            let name = self.word()?;
            let value = if self.maybe(":") { Some(self.expression(0, &[",", "}"])?) } else { None };
            fields.push(ObjectField { name: name.value, value, site: name.site });
            if !self.maybe(",") {
                break;
            }
        }
        self.take("}")?;
        Ok(fields)
    }

    fn parse_walk(&mut self) -> Fallible<Expr> {
        let site = self.take("walk")?.site;
        let table = self.word()?.value;
        let read = self.parse_read(&table, &site)?;
        if read.keys.len() != 1 || read.keys[0].column.is_some() {
            return Err(syntax(&read.site, "walk seed must be one positional reference t[seed]"));
        }
        self.take("up")?;
        self.take(".")?;
        let column = self.word()?.value;
        self.take("depth")?;
        let depth = self.number()?;
        let seed = read.keys.into_iter().next().unwrap().value;
        Ok(Expr::Walk { table, seed: Box::new(seed), column, depth, site })
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
            return Err(syntax(&token.site, format!("expected {value:?}, got {:?}", token.value)));
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
            return Err(syntax(&token.site, format!("expected {expected}, got {:?}", token.value)));
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
        assert_eq!(document.tables.len(), 4);
        assert_eq!(document.maintains.len(), 1);
        assert_eq!(document.programs.len(), 8);
        let messages = &document.tables[3];
        assert_eq!(messages.name, "messages");
        let sync = messages.sync.as_ref().unwrap();
        assert_eq!(sync.audience, SyncAudience::Target { table: "memberships".into(), prefix: vec!["conversationId".into()], principal: None });
        assert_eq!(sync.horizon, Some((500, "byConvTime".into())));
        assert_eq!(messages.retain.as_ref().unwrap().0, "delivered-history");
    }

    #[test]
    fn refuses_with_a_rewrite() {
        let (_, diagnostics) = parse_document("t.q", "table todos:\n  by ownerId\n");
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].code, "E_QUARRY_SYNTAX");
        assert_eq!(diagnostics[0].rewrite, "by byOwnerId: ownerId");
    }
}
