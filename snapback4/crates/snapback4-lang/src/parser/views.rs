//! `view` shares the aggregate AST; planned and feed views have distinct nodes.
use super::*;

impl Parser {
    pub(super) fn parse_view(&mut self) -> Fallible<()> {
        if matches!(self.peek_at(3).value.as_str(), "count" | "sum") {
            let maintain = self.parse_maintain()?;
            self.document.maintains.push(maintain);
            return Ok(());
        }
        let site = self.take("view")?.site;
        let name = self.binding_name()?;
        self.take(":")?;
        if !self.at_kind(Kind::Newline) {
            let source = self.word()?.value;
            self.take("where")?;
            let predicate = self.filtered_predicate(&source, &["<newline>"], false)?;
            self.newline()?;
            self.document.feed_views.push(FeedView { name, source, predicate, site });
            return Ok(());
        }
        self.newline()?;
        self.take_kind(Kind::Indent)?;
        let mut branches = Vec::new();
        while !self.at_kind(Kind::Dedent) && !self.at_kind(Kind::Eof) {
            self.skip_newlines();
            if self.at_kind(Kind::Dedent) { break; }
            let source = self.word()?;
            let predicate = if self.maybe("where") {
                let predicate = self.filtered_predicate(&source.value, &["{"], false)?;
                Some(predicate)
            } else { None };
            self.take("{")?;
            let fields = self.with_focal(&source.value, |parser| parser.parse_shape_fields())?;
            self.take("}")?;
            self.newline()?;
            branches.push(ViewBranch { source: source.value, predicate, fields, site: source.site });
        }
        self.take_kind(Kind::Dedent)?;
        self.document.views.push(ViewDecl { name, branches, site });
        Ok(())
    }
}

pub(super) fn duration_unit(unit: &str) -> Option<i64> {
    Some(match unit { "ms" => 1, "s" => 1_000, "m" => 60_000, "h" => 3_600_000, "d" => 86_400_000, _ => return None })
}

pub(super) fn unfocal_key(key: &mut Expr) {
    match key {
        Expr::Member { base, name, site } if matches!(base.as_ref(), Expr::Focal { .. }) => {
            *key = Expr::Name { name: name.clone(), site: site.clone() };
        }
        Expr::Member { base, .. } => unfocal_key(base),
        _ => {}
    }
}
