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

    pub(super) fn parse_program(&mut self) -> Fallible<ProgramDecl> {
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
        if self.at("native") {
            // `job name(): native` — the body is the app's Rust (LLP 3000.005).
            let native = self.take("native")?;
            self.end_line(&native.site)?;
            if kind == ProgramKind::Mutation {
                return Err(Diagnostic::new(&native.site, "E_NATIVE", format!("only a job or a query can be native; a mutation runs in the interpreter so a device can predict it and the server can replay it"), format!("job {name}(): native  -- or: query {name}(): native")).guide("native"));
            }
            return Ok(ProgramDecl { kind, name, args, prelude: Vec::new(), body: Vec::new(), native: true, site: kind_token.site });
        }
        self.newline()?;
        let (prelude, body) = if kind == ProgramKind::Job { self.parse_chunks()? } else { (Vec::new(), self.parse_block()?) };
        if body.is_empty() {
            return Err(syntax(&kind_token.site, format!("{} {name} has an empty body", kind_token.value)));
        }
        Ok(ProgramDecl { kind, name, args, prelude, body, native: false, site: kind_token.site })
    }

    pub(super) fn parse_chunks(&mut self) -> Fallible<(Vec<Stmt>, Vec<Stmt>)> {
        self.take_kind(Kind::Indent)?;
        let mut prelude = Vec::new();
        let mut chunks = Vec::new();
        while !self.at_kind(Kind::Dedent) && !self.at_kind(Kind::Eof) {
            self.skip_newlines();
            if self.at_kind(Kind::Dedent) {
                break;
            }
            if !self.at("chunk") && chunks.is_empty() {
                prelude.push(self.parse_statement()?);
                continue;
            }
            let site = self.take("chunk")?.site;
            let name = self.binding_name()?;
            self.take("in")?;
            let table = self.word()?;
            let mut domain = if self.at("[") { self.parse_read(&table.value, &table.site)? } else { ReadExpr { table: table.value.clone(), keys: Vec::new(), index: None, range: None, matching: None, filter: None, seeks: Vec::new(), site: table.site.clone() } };
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
        Ok((prelude, chunks))
    }
}
