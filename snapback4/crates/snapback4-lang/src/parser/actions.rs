//! An action declares admission; its body lives in the application's worker.
use super::Parser;
use crate::ast::{ActionDecl, ArgDecl, Expr, WorkDecl};
use crate::diag::{Fallible, syntax_with};
use std::collections::BTreeSet;

impl Parser {
    // @ref LLP 3000.009#5.1 — one declaration supplies admission, result validation and handler signatures.
    pub(super) fn parse_action(&mut self) -> Fallible<()> {
        let site = self.take("action")?.site;
        let name = self.binding_name()?;
        let args = self.parse_args()?;
        let mut returns = None;
        let mut work = WorkDecl::default();
        let mut clauses = BTreeSet::new();
        loop {
            if self.at("returns") {
                let token = self.take("returns")?;
                if !clauses.insert(token.value) {
                    return Err(syntax_with(&token.site, "duplicate returns clause", "declare returns once").guide("actions"));
                }
                self.take("{")?;
                let mut fields = Vec::new();
                while !self.at("}") {
                    let site = self.peek().site.clone();
                    let name = self.binding_name()?;
                    self.take(":")?;
                    let type_ = self.parse_type(false)?;
                    fields.push(ArgDecl { name, type_, site });
                    if !self.maybe(",") { break; }
                }
                self.take("}")?;
                returns = Some(fields);
            } else if !self.parse_work_clause(&mut work, &mut clauses)? {
                break;
            }
        }
        let rule = if self.maybe("<-") { self.expression(0, &[])? } else { Expr::Name { name: "allow".into(), site: site.clone() } };
        if self.at(":") {
            return Err(syntax_with(&site, "an action has no Quarry body; its handler is in snapback/server.ts", format!("action {name}(..) <- allow")).guide("actions"));
        }
        self.end_line(&site)?;
        self.document.actions.push(ActionDecl { name, args, returns, work, rule, site });
        Ok(())
    }

    // @ref LLP 3000.009#5.2 — actions and effects declare the same per-operation policy.
    pub(super) fn parse_work_clause(&mut self, work: &mut WorkDecl, clauses: &mut BTreeSet<String>) -> Fallible<bool> {
        let token = self.peek().clone();
        if !matches!(token.value.as_str(), "secrets" | "retry" | "backoff" | "deadline" | "cancellation") { return Ok(false); }
        self.position += 1;
        if !clauses.insert(token.value.clone()) {
            return Err(syntax_with(&token.site, format!("duplicate {} clause", token.value), "declare each work setting once").guide("actions"));
        }
        match token.value.as_str() {
            "secrets" => {
                self.take("[")?;
                while !self.at("]") {
                    work.secrets.push(self.word()?.value);
                    if !self.maybe(",") { break; }
                }
                self.take("]")?;
            }
            "retry" => work.max_attempts = Some(self.number()?),
            "backoff" => work.backoff_ms = Some(self.work_duration()?),
            "deadline" => work.deadline_ms = Some(self.work_duration()?),
            "cancellation" => {
                let value = self.word()?;
                work.cancellable = Some(match value.value.as_str() {
                    "allow" => true,
                    "deny" => false,
                    _ => return Err(syntax_with(&value.site, "cancellation takes allow or deny", "cancellation allow").guide("actions")),
                });
            }
            _ => unreachable!(),
        }
        Ok(true)
    }

    fn work_duration(&mut self) -> Fallible<u64> {
        let amount = self.number()?;
        let unit = self.word()?;
        let factor = match unit.value.as_str() {
            "s" => 1_000,
            "m" => 60_000,
            "h" => 3_600_000,
            "d" => 86_400_000,
            _ => return Err(syntax_with(&unit.site, "a work duration is a whole number and s, m, h or d", "backoff 2s deadline 1h").guide("actions")),
        };
        Ok(u64::from(amount) * factor)
    }
}
