//! A route publishes a static HTTP path, never a public data-plane program.
use super::Parser;
use crate::ast::{RouteDecl, WorkDecl};
use crate::diag::{Fallible, syntax_with};
use crate::lexer::Kind;
use std::collections::BTreeSet;

impl Parser {
    // @ref LLP 3000.009#5.1 — session authority is the default; provider routes name a service seat.
    pub(super) fn parse_route(&mut self) -> Fallible<()> {
        self.route_declaration().map_err(|mut diagnostic| {
            diagnostic.code = "E_ROUTE_DECLARATION".into();
            diagnostic.guide = "routes".into();
            diagnostic
        })
    }

    fn route_declaration(&mut self) -> Fallible<()> {
        let site = self.take("route")?.site;
        let name = self.binding_name()?;
        self.take(":")?;
        let method = self.word()?;
        if method.value != "post" {
            return Err(syntax_with(&method.site, "a route supports only post", format!("route {name}: post \"/hooks/{name}\"")));
        }
        let path = self.take_kind(Kind::Str)?.value;
        let mut service = None;
        let mut work = WorkDecl::default();
        let mut wait_ms = 5_000;
        let mut clauses = BTreeSet::new();
        loop {
            if self.at("as") || self.at("wait") {
                let clause = self.peek().clone();
                self.position += 1;
                if !clauses.insert(clause.value.clone()) {
                    return Err(syntax_with(&clause.site, format!("duplicate {} clause", clause.value), "declare each route setting once"));
                }
                if clause.value == "as" {
                    let namespace = self.word()?;
                    if namespace.value != "service" {
                        return Err(syntax_with(&namespace.site, "a provider route runs as an explicit service seat", "as service:billing; omit as for a session-authorized route"));
                    }
                    self.take(":")?;
                    service = Some(format!("service:{}", self.route_service_name()?));
                } else {
                    let amount = self.number()?;
                    let unit = self.word()?;
                    let factor = match unit.value.as_str() {
                        "ms" => 1,
                        "s" => 1_000,
                        _ => return Err(syntax_with(&unit.site, "route wait is a whole number of ms or s, from 1ms through 25s", "wait 5s")),
                    };
                    wait_ms = u64::from(amount) * factor;
                }
            } else if !self.parse_work_clause(&mut work, &mut clauses)? {
                break;
            }
        }
        if !self.at_kind(Kind::Newline) {
            return Err(syntax_with(&self.peek().site, "a route has no Quarry body, arguments, returns or <- rule; its TypeScript handler receives the request and context", "use only as service:<seat>, secrets [...], retry N, backoff, deadline, cancellation and wait after the path"));
        }
        self.end_line(&site)?;
        self.document.routes.push(RouteDecl { name, path, service, work, wait_ms, site });
        Ok(())
    }

    fn route_service_name(&mut self) -> Fallible<String> {
        // A seat may start with a digit or contain hyphens; adjacent lexer
        // tokens compose one seat, but whitespace cannot join two names.
        let first = self.peek().clone();
        let mut end = first.site.col;
        let mut name = String::new();
        loop {
            let token = self.peek();
            if token.site.line != first.site.line || token.site.col != end
                || !(matches!(token.kind, Kind::Word | Kind::Number) || token.value == "-") { break; }
            name.push_str(&token.value);
            end += token.value.len() as u32;
            self.position += 1;
        }
        if name.is_empty() {
            return Err(syntax_with(&first.site, "a provider route needs a service seat name", "as service:billing"));
        }
        Ok(name)
    }
}
