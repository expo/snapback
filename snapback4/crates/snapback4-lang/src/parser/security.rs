use super::*;
impl Parser {
    // @ref LLP 3000.036.004#2-surface — one existing expression grammar.
    pub(super) fn parse_invariant(&mut self) -> Fallible<()> {
        let site = self.take("invariant")?.site;
        let table = self.word()?.value;
        let (target, column) = if self.maybe(".") {
            let mut field = self.word()?.value;
            while self.maybe(".") {field.push('.');field.push_str(&self.word()?.value);}
            if self.maybe("write") { ("write".into(), Some(field)) }
            else if self.maybe("read") { ("read".into(), Some(field)) }
            else { (field, None) }
        } else { (self.take("always")?.value, None) };
        if target != "always" { self.take("only")?; }
        let value = self.expression(0, &[])?;
        self.end_line(&site)?;
        self.document.invariants.push(InvariantDecl { table, target, column, value, site });
        Ok(())
    }

}
