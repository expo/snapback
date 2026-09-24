//! Programs, chunks and schedules: `query`, `mutation`, `job` (Quarry
//! chunks or `native`, LLP 3000.005; a query may be `native` too, §9) and `schedule`. Split from the parser
//! so each file stays under the line budget.

use super::Parser;
use crate::ast::*;
use crate::diag::{Diagnostic, Fallible, syntax, syntax_with, unsupported};
use crate::lexer::Kind;

impl Parser {
    /// `schedule name every <N>m|h|d [at HH:MM]: job`.
    pub(super) fn parse_schedule(&mut self) -> Fallible<ScheduleDecl> {
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
                // `s` and `ms` are real Quarry units elsewhere (work durations in
                // `actions.rs`, route waits in `routes.rs`), so naming the valid set
                // alone reads as "`s` is not a unit" and hides the actual constraint:
                // a schedule has a one-minute floor, which the next branch enforces
                // but a sub-minute unit returns before ever reaching.
                _ => return Err(syntax_with(&unit.site, "a schedule period is a whole number and m, h or d, from 1m up; a schedule cannot fire more often than once a minute (`s` and `ms` are work and wait units, not schedule periods)", rewrite)),
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
        let service = if self.maybe("as") {
            let namespace = self.word()?;
            if namespace.value != "service" {
                return Err(syntax_with(&namespace.site, "a scheduled action runs as a service seat", "as service:billing").guide("actions"));
            }
            self.take(":")?;
            let mut name = self.service_name_part()?;
            while self.maybe("-") {
                name.push('-');
                name.push_str(&self.service_name_part()?);
            }
            Some(format!("service:{name}"))
        } else { None };
        self.take(":")?;
        // @ref LLP 3000.007#10 — module jobs use the same qualified name in schedules as in the compiled program.
        let mut target = self.word()?.value;
        if self.maybe(".") { target.push('.'); target.push_str(&self.word()?.value); }
        self.end_line(&site)?;
        Ok(ScheduleDecl { name, every_ms, offset_ms, target, service, site })
    }

    fn service_name_part(&mut self) -> Fallible<String> {
        if self.at_kind(Kind::Number) { Ok(self.take_kind(Kind::Number)?.value) } else { Ok(self.word()?.value) }
    }

    pub(super) fn parse_program(&mut self) -> Fallible<ProgramDecl> {
        let kind_token = self.word()?;
        let kind = match kind_token.value.as_str() {
            "query" => ProgramKind::Query,
            "mutation" => ProgramKind::Mutation,
            _ => ProgramKind::Job,
        };
        let name = self.binding_name()?;
        if kind == ProgramKind::Job && self.at("every") {
            let mut period = String::new();
            let mut end = 0;
            while !matches!(self.peek().kind, Kind::Newline | Kind::Eof) {
                let token = self.peek().clone();
                if !period.is_empty() && token.site.col > end { period.push(' '); }
                period.push_str(&token.value);
                end = token.site.col + token.value.len() as u32;
                self.position += 1;
            }
            let period = period.trim_end_matches(':').trim_end();
            return Err(Diagnostic::new(&kind_token.site, "E_QUARRY_JOB_SCHEDULE",
                format!("job {name} declares work; a separate schedule declares when it runs"),
                format!("job {name}():  -- keep the existing indented body\nschedule {name}Every {period}: {name}")).guide("jobs"));
        }
        if self.at(":") {
            return Err(syntax_with(&kind_token.site, "an operation with no arguments still needs parentheses", format!("{} {name}():", kind_token.value)).mechanical());
        }
        let args = self.parse_args()?;
        if self.at("->") {
            return Err(unsupported(&self.peek().site.clone(), "result annotations", "results are inferred; remove the annotation"));
        }
        let held = kind == ProgramKind::Query && self.maybe("held");
        let predicts = kind == ProgramKind::Mutation && self.maybe("predicts");
        self.take(":")?;
        if self.at("native") {
            // `job name(): native` — the body is the app's Rust (LLP 3000.005).
            let native = self.take("native")?;
            self.end_line(&native.site)?;
            if kind == ProgramKind::Mutation {
                return Err(Diagnostic::new(&native.site, "E_NATIVE", format!("only a job or a query can be native; a mutation runs in the interpreter so a device can predict it and the server can replay it"), format!("job {name}(): native  -- or: query {name}(): native")).guide("native"));
            }
            return Ok(ProgramDecl { held, predicts, server: false, kind, name, args, prelude: Vec::new(), body: Vec::new(), native: true, site: kind_token.site });
        }
        let server = kind == ProgramKind::Mutation && self.maybe("server");
        self.newline()?;
        let before_body = self.diagnostics.len();
        let (prelude, body) = if kind == ProgramKind::Job { self.parse_chunks(&args)? } else { (Vec::new(), self.parse_block()?) };
        if body.is_empty() {
            // @ref LLP 3000.007#20.19 — default `check` hides a recovery diagnostic only
            // when an earlier error in the same operation's own body already explains it.
            let mut diagnostic = syntax(&kind_token.site, format!("{} {name} has an empty body", kind_token.value));
            // A job's parsed prelude cannot explain missing chunks; that repair is independent.
            if kind != ProgramKind::Job {
                diagnostic.cascade_of = self.diagnostics[before_body..].iter().find(|d| d.code.starts_with("E_")).map(|d| d.site.clone());
            }
            return Err(diagnostic);
        }
        Ok(ProgramDecl { held, predicts, server, kind, name, args, prelude, body, native: false, site: kind_token.site })
    }

    pub(super) fn parse_chunks(&mut self, args: &[ArgDecl]) -> Fallible<(Vec<Stmt>, Vec<Stmt>)> {
        self.take_kind(Kind::Indent)?;
        let mut prelude = Vec::new();
        let mut chunks = Vec::new();
        let mut locals: std::collections::BTreeSet<String> = args.iter().map(|arg| arg.name.clone()).collect();
        while !self.at_kind(Kind::Dedent) && !self.at_kind(Kind::Eof) {
            self.skip_newlines();
            if self.at_kind(Kind::Dedent) {
                break;
            }
            if self.at("for") {
                let sweep = self.parse_for()?;
                let automatic = match &sweep {
                    Stmt::For { domain: Expr::Read(read), .. } => read.range.is_none(),
                    Stmt::For { domain: Expr::Name { name, .. }, .. } => !locals.contains(name),
                    _ => false,
                };
                if !automatic && chunks.is_empty() {
                    prelude.push(sweep);
                    continue;
                }
                if let Stmt::For { domain: Expr::Read(read), site, .. } = &sweep
                    && (read.range.is_some() || read.matching.is_some()) {
                    return Err(syntax_with(site, "an automatic sweep needs a plain table or prefix domain, without a page or matching clause", format!("for row in {}:  -- the engine chooses each batch", read.table)));
                }
                chunks.push(sweep);
                continue;
            }
            if !self.at("chunk") && chunks.is_empty() {
                let statement = self.parse_statement()?;
                if let Stmt::Bind { names, .. } = &statement { locals.extend(names.iter().cloned()); }
                prelude.push(statement);
                continue;
            }
            let site = self.take("chunk")?.site;
            let name = self.binding_name()?;
            self.take("in")?;
            let table = self.word()?;
            let mut domain = if self.at("[") { self.parse_read(&table.value, &table.site)? } else { ReadExpr { computed: Default::default(), order_keys: Vec::new(), table: table.value.clone(), keys: Vec::new(), index: None, range: None, matching: None, filter: None, seeks: Vec::new(), site: table.site.clone() } };
            if !self.at("first") {
                return Err(syntax(&self.peek().site.clone(), "chunk requires first N by index"));
            }
            domain = self.parse_range(domain, false)?;
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
        Ok((prelude, chunks))
    }
}
