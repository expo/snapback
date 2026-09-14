//! An action declares admission; its body lives in the application's worker.
use super::Parser;
use crate::ast::{ActionDecl, Expr};
use crate::diag::{Fallible, syntax_with};

impl Parser {
    // @ref LLP 3000.007#9.2 — Quarry declares the action; TypeScript performs it outside the data plane.
    pub(super) fn parse_action(&mut self) -> Fallible<()> {
        let site = self.take("action")?.site;
        let name = self.binding_name()?;
        let args = self.parse_args()?;
        let rule = if self.maybe("<-") { self.expression(0, &[])? } else { Expr::Name { name: "allow".into(), site: site.clone() } };
        if self.at(":") {
            return Err(syntax_with(&site, "an action has no Quarry body; its handler is in snapback/worker.ts", format!("action {name}(..) <- allow")).guide("actions"));
        }
        self.end_line(&site)?;
        self.document.actions.push(ActionDecl { name, args, rule, site });
        Ok(())
    }
}
