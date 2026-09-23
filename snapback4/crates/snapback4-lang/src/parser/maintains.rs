//! The maintain predicate has its own restricted boolean grammar.
use super::*;

impl Parser {
    pub(super) fn maintain_column(&mut self) -> Fallible<String> {
        let mut column = self.word()?.value;
        while self.maybe(".") { column.push('.'); column.push_str(&self.word()?.value); }
        Ok(column)
    }

    // @ref LLP 3000.007#20.9 — not binds to a predicate, including a scalar comparison.
    pub(super) fn maintain_predicate(&mut self, minimum: u8) -> Fallible<Expr> {
        let mut left = if self.at("not") {
            let site = self.take("not")?.site;
            Expr::Unary { op: "not".into(), value: Box::new(self.maintain_predicate(4)?), site }
        } else if self.maybe("(") {
            let value = self.maintain_predicate(0)?;
            self.take(")")?;
            value
        } else {
            // Keep invalid reads, calls and arithmetic in the AST so the binder
            // can refuse the offending expression with the maintain rewrite.
            self.expression(4, &["and", "or", "by", ")"])?
        };
        loop {
            let precedence = match self.peek().value.as_str() { "or" => 2, "and" => 3, _ => break };
            if precedence < minimum { break; }
            let token = self.word()?;
            let right = self.maintain_predicate(precedence + 1)?;
            left = Expr::Binary { op: token.value, left: Box::new(left), right: Box::new(right), site: token.site };
        }
        Ok(left)
    }
}
