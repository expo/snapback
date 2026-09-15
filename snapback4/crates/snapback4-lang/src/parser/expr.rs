//! Expressions: precedence climbing over Quarry's operators, the postfix
//! forms (reads, ranges, shapes, presence assertions), merges, writes, walks
//! and the refusals for forms Snapback 4 does not have.

use super::*;

impl Parser {
    pub(super) fn expression(&mut self, minimum: u8, stops: &[&str]) -> Fallible<Expr> {
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
            // @ref LLP 3000.007#19.3 — recover through guessed equality without admitting an alias or cascading through its block.
            let adjacent_equals = |next: &Token, col| next.kind == Kind::Symbol && next.value == "=" && next.site.line == token.site.line && next.site.col == col;
            if token.kind == Kind::Symbol && token.value == "=" && adjacent_equals(self.peek(), token.site.col + 1)
                && !adjacent_equals(self.peek_at(1), token.site.col + 2) {
                self.diagnostics.push(syntax_with(&token.site, "equality is = in Quarry", "=").mechanical());
                self.position += 1;
            }
            let right = self.expression(precedence + u8::from(token.value != "??"), stops)?;
            left = Expr::Binary { op: token.value, left: Box::new(left), right: Box::new(right), site: token.site };
        }
        if minimum == 0 && self.at("?") {
            let site = self.take("?")?.site;
            let yes = self.expression(0, &[":"])?;
            self.take(":")?;
            let no = self.expression(0, stops)?;
            return Err(unsupported(&site, "? :", format!("{} if {} else {}", print::expression(&yes), print::expression(&left), print::expression(&no))));
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

    pub(super) fn prefix(&mut self, stops: &[&str]) -> Fallible<Expr> {
        let token = self.peek().clone();
        if token.kind == Kind::Str {
            self.position += 1;
            return self.postfix(Expr::Literal { value: Literal::Str(token.value), site: token.site }, stops);
        }
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
            if read.range.is_some() || !read.seeks.is_empty() || read.filter.is_some() {
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

    pub(super) fn postfix(&mut self, initial: Expr, stops: &[&str]) -> Fallible<Expr> {
        let mut value = initial;
        loop {
            if self.is_stop(self.peek(), stops) { break; }
            if self.at("?") && self.peek_at(1).value == "." {
                let site = self.take("?")?.site;
                self.take(".")?;
                let name = self.word()?.value;
                let base = print::expression(&value);
                return Err(unsupported(&site, "?.", format!("{base}.{name} if {base} != null else null")));
            } else if self.at(".") && self.peek_at(1).kind == Kind::Word {
                let site = self.take(".")?.site;
                let name = self.word()?.value;
                value = Expr::Member { base: Box::new(value), name, site };
            } else if self.at("(") && matches!(value, Expr::Name { .. }) {
                let Expr::Name { name, site: name_site } = value else { unreachable!() };
                let site = self.take("(")?.site;
                let mut args = Vec::new();
                while !self.at(")") {
                    args.push(if name == "bucket" && args.len() == 1 { self.maintain_duration()? } else { self.expression(0, &[",", ")"])? });
                    if !self.maybe(",") {
                        break;
                    }
                }
                self.take(")")?;
                if name == "len" { return Err(unsupported(&name_site, "len", format!("count({})", args.iter().map(print::expression).collect::<Vec<_>>().join(", ")))); }
                value = Expr::Call { name, args, site };
            } else if self.at("[") && matches!(value, Expr::Name { .. }) {
                let Expr::Name { name, site } = value else { unreachable!() };
                value = Expr::Read(self.parse_read(&name, &site)?);
            } else if matches!(value, Expr::Name { .. }) && matches!(self.peek().value.as_str(), "first" | "after" | "last" | "matching") && !stops.contains(&self.peek().value.as_str()) {
                // `t first N by index`: the whole table's page, the empty
                // prefix spelled without brackets, as `chunk` takes it.
                let Expr::Name { name, site } = value else { unreachable!() };
                value = Expr::Read(ReadExpr { table: name, keys: Vec::new(), index: None, range: None, matching: None, filter: None, seeks: Vec::new(), site });
            } else if matches!(value, Expr::Read(_)) && self.at("where") {
                let site = self.take("where")?.site;
                let predicate = self.expression(0, &["<newline>", "{", ",", "}", ")", ":"])?;
                let Expr::Read(read) = &mut value else { unreachable!() };
                if read.range.is_none() || read.filter.is_some() {
                    return Err(syntax_with(&site, "where follows one bounded page", "t[prefix] first 50 by index where .col = value"));
                }
                read.filter = Some(Box::new(predicate));
            } else if matches!(value, Expr::Read(_)) && self.at("before") {
                return Err(unsupported(&self.peek().site.clone(), "before", "use after c; reverse display order in the client when needed"));
            } else if matches!(value, Expr::Read(_)) && matches!(self.peek().value.as_str(), "matching" | "after" | "first" | "last" | "by") {
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

    pub(super) fn parse_read(&mut self, table: &str, site: &Site) -> Fallible<ReadExpr> {
        self.take("[")?;
        let mut keys = Vec::new();
        let mut seeks = Vec::new();
        while !self.at("]") {
            let key_site = self.peek().site.clone();
            let mut column = None;
            if self.at_kind(Kind::Word) && self.peek_at(1).value == "=" {
                column = Some(self.word()?.value);
                self.take("=")?;
            }
            if column.is_none() && self.at_kind(Kind::Word) && matches!(self.peek_at(1).value.as_str(), ">" | ">=" | "<" | "<=") {
                let column = self.word()?.value;
                let op = self.peek().value.clone();
                self.position += 1;
                let value = self.expression(0, &[",", "]"])?;
                seeks.push(SeekBound { column, op, value, site: key_site });
            } else {
                if !seeks.is_empty() { return Err(syntax_with(&key_site, "pin the prefix before the seek comparisons", "t[prefix, col >= start, col < end] first 50 by index")); }
                let value = self.expression(0, &[",", "]"])?;
                keys.push(KeyPart { column, value, site: key_site });
            }
            if !self.maybe(",") {
                break;
            }
        }
        self.take("]")?;
        Ok(ReadExpr { table: table.to_owned(), keys, index: None, range: None, filter: None, matching: None, seeks, site: site.clone() })
    }

    pub(super) fn parse_range(&mut self, mut read: ReadExpr) -> Fallible<ReadExpr> {
        let mut order = None;
        let mut take = None;
        let mut cursor: Option<Box<Expr>> = None;
        let site = self.peek().site.clone();
        let mut highest: i32 = -1;
        let mut seen = std::collections::BTreeSet::new();
        let mut violation: Option<Token> = None;
        while matches!(self.peek().value.as_str(), "matching" | "after" | "first" | "last" | "by") {
            let key = self.word()?;
            let rank = match key.value.as_str() {
                "matching" => -1,
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
                "matching" => {
                    // The search text: a page over the words of a `words(..)`
                    // index the text's terms are prefixes of.
                    let candidate = self.expression(0, &["after", "first", "last", "by", "where", "<newline>", ":", "{", ",", "}"])?;
                    if read.matching.is_none() {
                        read.matching = Some(Box::new(candidate));
                    }
                }
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
        if take.is_none() && cursor.is_none() && read.matching.is_none() {
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

    pub(super) fn parse_merge(&mut self) -> Fallible<MergeExpr> {
        let site = self.take("merge")?.site;
        let table = self.word()?.value;
        let matching = if self.maybe("matching") { Some(Box::new(self.expression(0, &["after", "first", "last", "by", ":"])?)) } else { None };
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
            return Err(syntax_with(&bound.site, "merge modifiers use [matching q] [after cursor] first|last N by index", format!("merge {table}{} first 20 by index:", if matching.is_some() { " matching q" } else { "" })));
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
            let lane_table = if self.at("[") { None } else { Some(self.word()?.value) };
            let read = self.parse_read(lane_table.as_deref().unwrap_or(&table), &lane_site)?;
            if !read.seeks.is_empty() { return Err(syntax(&lane_site, "a merge lane takes a pinned prefix; use a bounded page for a seek")); }
            let keys = read.keys;
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
            lanes.push(MergeLane { table: lane_table, prefix, columns, loop_, site: lane_site });
        }
        self.take_kind(Kind::Dedent)?;
        if lanes.is_empty() {
            return Err(syntax_with(&site, "merge requires at least one lane", "[viewer]"));
        }
        Ok(MergeExpr { table, matching, index, order, take, cursor, lanes, site })
    }

    pub(super) fn parse_shape_fields(&mut self) -> Fallible<Vec<ShapeField>> {
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

    pub(super) fn parse_write(&mut self) -> Fallible<Expr> {
        let op_token = self.word()?;
        let table = self.word()?.value;
        let op = match op_token.value.as_str() {
            "insert" => WriteOp::Insert,
            "update" => WriteOp::Update,
            "upsert" => WriteOp::Upsert,
            _ => WriteOp::Delete,
        };
        let keys = if op == WriteOp::Insert { Vec::new() } else {
            let read = self.parse_read(&table, &op_token.site)?;
            if !read.seeks.is_empty() { return Err(syntax(&op_token.site, "a write needs an exact key; use a bounded page for a seek")); }
            read.keys
        };
        let fields = if op == WriteOp::Delete { Vec::new() } else { self.parse_object_fields()? };
        let mut if_absent = false;
        let mut condition = None;
        if self.maybe("if") {
            match op {
                WriteOp::Insert => {
                    self.take("absent")?;
                    if_absent = true;
                }
                WriteOp::Update | WriteOp::Upsert => condition = Some(Box::new(self.expression(0, &["<newline>"])?)),
                _ => return Err(syntax_with(&op_token.site, "if follows insert or update", "use insert ... if absent or update ... if condition")),
            }
        }
        Ok(Expr::Write { op, table, keys, fields, if_absent, condition, site: op_token.site })
    }

    pub(super) fn parse_object_fields(&mut self) -> Fallible<Vec<ObjectField>> {
        self.take("{")?;
        let mut fields = Vec::new();
        while !self.at("}") {
            if self.at(".") && self.peek_at(1).value == "." && self.peek_at(2).value == "." {
                let site = self.peek().site.clone();
                let name = &self.peek_at(3).value;
                return Err(syntax_with(&site, format!("expected an object field name, got spread ...{name}; objects list fields explicitly"), format!("replace ...{name} with field: {name}.field for each payload field")));
            }
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

    pub(super) fn parse_walk(&mut self) -> Fallible<Expr> {
        let site = self.take("walk")?.site;
        let table = self.word()?.value;
        let read = self.parse_read(&table, &site)?;
        if read.keys.len() != 1 || read.keys[0].column.is_some() || !read.seeks.is_empty() {
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
}
