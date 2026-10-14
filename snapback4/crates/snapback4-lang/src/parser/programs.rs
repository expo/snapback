//! Programs, chunks and schedules: `query`, `mutation`, `job` (Quarry
//! chunks or `native`, LLP 3000.005; a query may be `native` too, §9) and `schedule`. Split from the parser
//! so each file stays under the line budget.

use super::Parser;
use crate::ast::*;
use crate::diag::{Diagnostic, Fallible, syntax, syntax_with, unsupported};
use crate::lexer::Kind;
use crate::print;

impl Parser {
    pub(super) fn parse_require(&mut self) -> Fallible<Stmt> {
        let site = self.take("require")?.site;
        let condition = self.expression(0, &["else"])?;
        // @ref LLP 3000.036#14.5 — name an unsupported text-pattern
        // operator before diagnosing a refusal code the author already wrote.
        let pattern = match &condition {
            Expr::ShapeUse { base, name, site }
                if super::TEXT_PATTERN_WORDS.contains(&name.to_ascii_lowercase().as_str()) =>
            {
                Some((name.clone(), print::expression(base), site.clone()))
            }
            _ => {
                let next = self.peek();
                (next.kind == Kind::Word
                    && super::TEXT_PATTERN_WORDS.contains(&next.value.to_ascii_lowercase().as_str()))
                .then(|| (next.value.clone(), print::expression(&condition), next.site.clone()))
            }
        };
        if let Some((word, operand, at)) = pattern {
            return Err(syntax_with(
                &at,
                format!("Quarry has no `{word}` operator; `{operand} {word} …` is not a condition"),
                format!("compare whole text with `=` or `!=`; bound its length in the type (`{operand}: text 3..80`); declare a link `text <=200 format url` (http or https; anything else refuses E_INPUT before the program runs) or a handle `format handle`; or check the pattern in the client"),
            )
            .guide("types"));
        }
        // @ref LLP 3000.036.002#9 — a multiline require refusal preserves the author's code in its repair.
        if self.at_kind(Kind::Newline) {
            let mut at = 1;
            while matches!(self.peek_at(at).kind, Kind::Newline | Kind::Indent | Kind::Dedent) {
                at += 1;
            }
            if self.peek_at(at).value == "else" {
                let code = self.peek_at(at + 1).value.clone();
                return Err(syntax_with(
                    &site,
                    "a require's else must be on the condition's closing line",
                    format!("put `else {code}` on the closing line: `require {} else {code}`", print::expression(&condition)),
                )
                .guide("programs"));
            }
        }
        if !self.at("else") {
            return Err(syntax_with(
                &site,
                "require needs a refusal code: require <condition> else CODE",
                format!("require {} else NOT_ALLOWED", print::expression(&condition)),
            ));
        }
        self.take("else")?;
        let code = self.word()?.value;
        let message = if self.at_kind(Kind::Str) { Some(self.take_kind(Kind::Str)?.value) } else { None };
        self.newline()?;
        Ok(Stmt::Require { condition, code, message, site })
    }

    /// `schedule name every <duration> [at HH:MM]: job`, at least one minute,
    /// or `every N month[s]|year[s] [at [day D] HH:MM]`.
    pub(super) fn parse_schedule(&mut self) -> Fallible<ScheduleDecl> {
        let site = self.take("schedule")?.site;
        let rewrite = "schedule digest every 1d at 08:00: sendDigests";
        let name = self.binding_name()?;
        if !self.maybe("every") {
            return Err(syntax_with(&site, "a schedule fires every so often: schedule name every 2m: job", rewrite));
        }
        let amount = self.take_kind(Kind::Number)?;
        let unit = self.word()?;
        // @ref LLP 3000.040#24-monthly-and-yearly-schedules — calendar months and years, UTC, anchored at 1970-01.
        let calendar = match unit.value.as_str() { "month" | "months" => Some(1), "year" | "years" => Some(12), _ => None };
        if let Some(per) = calendar {
            let rewrite = "schedule billing every 1 month at day 1 09:00: bill";
            let months = amount.value.parse::<u32>().ok().filter(|n| *n >= 1).and_then(|n| n.checked_mul(per))
                .filter(|n| *n <= snapback4_core::schema::CALENDAR_MONTHS_LIMIT)
                .ok_or_else(|| syntax_with(&amount.site, "a calendar schedule fires every 1 to 1200 months (100 years)", rewrite).guide("jobs"))?;
            let mut offset_ms = 0;
            if self.maybe("at") {
                let mut day = 1;
                if self.maybe("day") {
                    let token = self.peek().clone();
                    day = self.number()?;
                    if !(1..=28).contains(&day) {
                        return Err(syntax_with(&token.site, format!("day {day} is not in every month; a calendar schedule's day is 1 through 28"),
                            "at day 28 09:00, or a daily schedule whose job tests month(periodStart) != month(periodEnd): that daily period crosses a month's end").guide("jobs"));
                    }
                }
                let hours = self.number()?;
                self.take(":")?;
                let minutes = self.number()?;
                if hours > 23 || minutes > 59 {
                    return Err(syntax_with(&site, "at takes a day of the month and a time of day: at day 1 09:00", rewrite));
                }
                offset_ms = (u64::from(day - 1) * 86_400 + u64::from(hours) * 3_600 + u64::from(minutes) * 60) * 1_000;
            }
            return self.schedule_tail(name, 0, offset_ms, months, site);
        }
        let multiplier = super::views::duration_unit(&unit.value).ok_or_else(|| syntax_with(&unit.site,
            "a schedule period is a whole number followed by ms, s, m, h or d, or a number of months or years", "every 2m, every 1d, or every 1 month"))?;
        // Integer millisecond boundaries need no rounding to whole minutes.
        // Retain the range of previously accepted m/h/d schedule periods.
        let every_ms = amount.value.parse::<i64>().ok().and_then(|value| value.checked_mul(multiplier))
            .ok_or_else(|| syntax_with(&amount.site, "schedule period exceeds the representable millisecond range", "every 1d"))? as u64;
        if every_ms < 60_000 {
            return Err(syntax_with(&amount.site, "a schedule fires at most once a minute", "every 1m"));
        }
        let mut offset_ms = 0;
        if self.maybe("at") {
            if self.at("day") {
                return Err(syntax_with(&site, "at day D names a day of a calendar month; it needs every 1 month (or N months or years)", "schedule billing every 1 month at day 1 09:00: bill").guide("jobs"));
            }
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
        self.schedule_tail(name, every_ms, offset_ms, 0, site)
    }

    fn schedule_tail(&mut self, name: String, every_ms: u64, offset_ms: u64, months: u32, site: crate::Site) -> Fallible<ScheduleDecl> {
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
        Ok(ScheduleDecl { name, every_ms, offset_ms, target, service, months, site })
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
            let module = std::path::Path::new(&kind_token.site.file).file_stem().and_then(|stem| stem.to_str()).unwrap_or("schema");
            let target = if module == "schema" { name.clone() } else { format!("{module}.{name}") };
            return Err(Diagnostic::new(&kind_token.site, "E_QUARRY_JOB_SCHEDULE",
                format!("job {name} declares work; a separate schedule declares when it runs"),
                format!("job {name}():  -- keep the existing indented body\nschedule {name}Every {period}: {target}")).guide("jobs"));
        }
        if self.at(":") {
            return Err(syntax_with(&kind_token.site, "an operation with no arguments still needs parentheses", format!("{} {name}():", kind_token.value)).mechanical());
        }
        let args_site = self.peek().site.clone();
        let args = self.parse_args()?;
        self.repair_args = Some((args_site, args.clone()));
        if self.at("->") {
            return Err(unsupported(&self.peek().site.clone(), "result annotations", "results are inferred; remove the annotation"));
        }
        let held = kind == ProgramKind::Query && self.maybe("held");
        let predicts = kind == ProgramKind::Mutation && self.maybe("predicts");
        // A clause may continue the header on the body's indentation level.
        let continued = self.at_kind(Kind::Newline) && self.peek_at(1).kind == Kind::Indent && self.peek_at(2).value == "reports";
        if continued { self.newline()?; self.take_kind(Kind::Indent)?; }
        let delivery = if self.at("reports") { Some(self.parse_delivery()?) } else { None };
        if delivery.is_some() && !self.at(":") {
            return Err(Diagnostic::new(&self.peek().site, "E_DELIVERY_CLAUSE",
                "a mutation header has one delivery clause, followed by its body colon",
                "keep one reports delivery of messages by .conversation, .ordinal: clause").guide("receipts"));
        }
        self.take(":")?;
        if self.at("native") {
            // `job name(): native` — the body is the app's Rust (LLP 3000.005).
            let native = self.take("native")?;
            self.end_line(&native.site)?;
            if kind == ProgramKind::Mutation {
                return Err(Diagnostic::new(&native.site, "E_NATIVE", format!("only a job or a query can be native; a mutation runs in the interpreter so a device can predict it and the server can replay it"), format!("job {name}(): native  -- or: query {name}(): native")).guide("native"));
            }
            return Ok(ProgramDecl { delivery, held, predicts, server: false, kind, name, args, prelude: Vec::new(), body: Vec::new(), native: true, site: kind_token.site });
        }
        let server = kind == ProgramKind::Mutation && self.maybe("server");
        self.newline()?;
        let before_body = self.diagnostics.len();
        let (prelude, body) = if kind == ProgramKind::Job { self.parse_chunks(&args)? } else { (Vec::new(), if continued { self.parse_block_contents()? } else { self.parse_block()? }) };
        if body.is_empty() {
            // @ref LLP 3000.007#20.19 — default `check` hides a recovery diagnostic only
            // when an earlier error in the same operation's own body already explains it.
            // A job's parsed prelude cannot explain missing chunks; that repair is independent.
            if kind == ProgramKind::Job { return Err(job_without_sweep(&kind_token.site, &name, &prelude)); }
            let mut diagnostic = syntax(&kind_token.site, format!("{} {name} has an empty body", kind_token.value));
            diagnostic.cascade_of = self.diagnostics[before_body..].iter().find(|d| d.code.starts_with("E_")).map(|d| d.site.clone());
            return Err(diagnostic);
        }
        Ok(ProgramDecl { delivery, held, predicts, server, kind, name, args, prelude, body, native: false, site: kind_token.site })
    }

    fn parse_delivery(&mut self) -> Fallible<DeliveryDecl> {
        let site = self.take("reports")?.site;
        let parsed = (|| {
            self.take("delivery")?;
            self.take("of")?;
            let table = self.word()?.value;
            self.take("by")?;
            self.take(".")?;
            let group = self.word()?.value;
            self.take(",")?;
            self.take(".")?;
            let position = self.word()?.value;
            Ok(DeliveryDecl { table, group, position, site: site.clone() })
        })();
        parsed.map_err(|_: Diagnostic| Diagnostic::new(&site, "E_DELIVERY_CLAUSE",
            "a delivery clause names one table and its group and position columns",
            "mutation delivered(conversation: conversations, from: int, through: int) reports delivery of messages by .conversation, .ordinal:").guide("receipts"))
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
            let name = self.local_name()?;
            self.take("in")?;
            let start = self.position;
            let table = self.word()?;
            let mut domain = if self.at("[") { self.parse_read(&table.value, &table.site)? } else { ReadExpr { cursor_prefix: None, computed: Default::default(), order_keys: Vec::new(), table: table.value.clone(), keys: Vec::new(), index: None, range: None, matching: None, filter: None, seeks: Vec::new(), site: table.site.clone() } };
            if !self.at("first") {
                return Err(syntax(&self.peek().site.clone(), "chunk requires first N by index"));
            }
            domain = self.parse_range(domain, start, false)?;
            self.document.source.record(&Expr::Read(domain.clone()), &self.source, &self.tokens[start..self.position]);
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

/// A job body is a sweep (`guide jobs`): name the loop to write, over the
/// table the prelude already writes or pages when there is one.
fn job_without_sweep(site: &crate::Site, name: &str, prelude: &[Stmt]) -> crate::Diagnostic {
    fn table(statements: &[Stmt]) -> Option<(&str, bool)> {
        statements.iter().find_map(|statement| match statement {
            Stmt::Expr { value: Expr::Write { table, .. }, .. } | Stmt::Bind { value: Expr::Write { table, .. }, .. } | Stmt::Return { value: Expr::Write { table, .. }, .. } => Some((table.as_str(), false)),
            Stmt::For { domain: Expr::Read(read), .. } => Some((read.table.as_str(), true)),
            Stmt::For { body, .. } | Stmt::As { body, .. } => table(body),
            Stmt::If { then_body, else_body, .. } => table(then_body).or_else(|| table(else_body)),
            _ => None,
        })
    }
    let found = table(prelude);
    let swept = found.map_or("<table>", |(table, _)| table);
    let seen = match found {
        Some((_, true)) => format!("; a paged `for … in {swept} first N` only reads ahead of a sweep"),
        Some(_) => "; its writes are outside any sweep".to_owned(),
        None => String::new(),
    };
    syntax_with(site, format!("job {name} has an empty body: a job body is a sweep, one top-level `for row in table:` loop with every write inside it{seen}"),
        format!("for row in {swept}:  -- then indent the writes under it, address the row as row.id and test mutable columns with `if` (or bound it: for row in {swept} where .<id or immutable column> >= periodStart by .<that column>:)")).guide("jobs")
}
