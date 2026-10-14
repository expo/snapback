//! Column and parameter types, including precise unsupported-default repairs.
use super::Parser;
use crate::{ast::*, diag::{Fallible, Site, syntax, syntax_with}, lexer::Kind, print};
impl Parser {
    pub(super) fn parse_args(&mut self) -> Fallible<Vec<ArgDecl>> {
        self.take("(")?;
        let mut args = Vec::new();
        while !self.at(")") {
            let name = self.peek().clone();
            let binding = self.local_name()?;
            self.take(":")?;
            let type_site = self.peek().site.clone();
            let type_ = self.parse_type(false).map_err(|mut d| {
                if d.mechanical && d.message.starts_with("once is a column modifier") {
                    // Nested element types need a whole-list rewrite, not an argument fragment.
                    if d.site == type_site { d.site = name.site.clone(); d.rewrite = format!("{binding}: {}", d.rewrite); }
                    else { d.mechanical = false; }
                }
                d
            })?;
            if self.at("=") || self.at("default") {
                let at = self.peek().site.clone();
                self.position += 1;
                let fallback = self.expression(0, &[",", ")"])?;
                let mut optional = type_.clone(); optional.optional = true;
                return Err(syntax_with(&at, "operation parameters have no literal defaults; omission is null for an optional parameter",
                    format!("declare `{binding}: {}` and bind `{binding}Value = {binding} ?? {}` at the start of the body", print::scalar_type(&optional), print::expression(&fallback))).guide("types"));
            }
            args.push(ArgDecl { name: binding, type_, site: name.site });
            if !self.maybe(",") {
                break;
            }
        }
        self.take(")")?;
        Ok(args)
    }

    pub(super) fn parse_type(&mut self, column: bool) -> Fallible<ScalarType> {
        let site = self.peek().site.clone();
        let mut kind;
        if self.maybe("[") {
            let item = self.parse_type(column)?;
            self.take("]")?;
            // @ref LLP 3000.007#5.4 — list ranges share text's inclusive spelling.
            let bounds_error = |site: &Site| syntax_with(site, "list bounds require <=N or an inclusive a..b range", "write [T] <=N or [T] a..b, for example [int] 1..8").guide("types");
            let number = |parser: &mut Self| -> Fallible<u32> {
                if parser.at("-") {
                    return Err(syntax(&parser.peek().site, "list bounds must be nonnegative integers"));
                }
                if !parser.at_kind(Kind::Number) { return Err(bounds_error(&parser.peek().site)); }
                let token = parser.take_kind(Kind::Number)?;
                if token.value.contains('.') {
                    return Err(syntax(&token.site, "list bounds must be integers; fractional bounds are not allowed"));
                }
                token.value.parse::<u32>().map_err(|_| syntax(&token.site, "list bounds must be integers from 0 through 4294967295"))
            };
            let (min, max) = if self.maybe("<=") {
                (0, number(self)?)
            } else {
                let min = number(self)?;
                if !self.maybe(".") || !self.maybe(".") { return Err(bounds_error(&self.peek().site)); }
                (min, number(self)?)
            };
            if min > max {
                return Err(syntax(&site, "list minimum must not exceed its maximum"));
            }
            if item.optional {
                return Err(syntax(&site, "list element types cannot be optional"));
            }
            kind = TypeKind::List { item: Box::new(item), min, max };
        } else {
            let name = self.word()?;
            kind = match name.value.as_str() {
                "text" => {
                    let (min, max) = if self.maybe("<=") {
                        (None, self.number()?)
                    } else if self.at_kind(Kind::Number) {
                        let min = self.number()?;
                        self.take(".")?;
                        self.take(".")?;
                        (Some(min), self.number()?)
                    } else {
                        // The default is normalized here; every downstream
                        // validator and resource calculation sees the same bound.
                        (None, 10_000)
                    };
                    let mut format = None;
                    if self.maybe("format") {
                        let value = self.word()?;
                        if value.value != "handle" && value.value != "url" {
                            let bound = match min {
                                Some(min) => format!("{min}..{max}"),
                                None => format!("<={max}"),
                            };
                            return Err(syntax_with(&value.site, format!("unknown text format {}", value.value), format!("use text {bound} format handle or text {bound} format url")));
                        }
                        format = Some(value.value);
                    }
                    TypeKind::Text { min, max, format }
                }
                "decimal" => TypeKind::Decimal { scale: self.scale("decimal 12")? },
                "money" => {
                    let currency = self.word()?;
                    if currency.value.len() != 3 || !currency.value.bytes().all(|b| b.is_ascii_uppercase()) {
                        return Err(syntax_with(&currency.site, "money currency must be exactly three uppercase letters", "use money USD or money USD 2"));
                    }
                    let scale = if self.at_kind(Kind::Number) { self.scale(&format!("money {} 12", currency.value))? } else { 2 };
                    TypeKind::Money { currency: currency.value, scale }
                }
                "json" => {
                    self.take("<=")?;
                    TypeKind::Json { max: self.number()? }
                }
                "bytes" => {
                    self.take("<=")?;
                    TypeKind::Bytes { max: self.number()? }
                }
                "image" => {
                    if !self.maybe("<=") { return Err(syntax_with(&site, "image needs a maximum upload size in bytes", "write `image <=5MB` (5,000,000 bytes), optionally followed by once or ?").guide("types")); }
                    TypeKind::Image { max: self.media_size()?, once: false }
                }
                "video" => {
                    self.take("<=")?;
                    TypeKind::Video { max: self.media_size()? }
                }
                // `file` is a type only before `<=`: a table named `file` stays a reference.
                // @ref LLP 3000.038#1 — the allow-list names only types the server can verify against the bytes.
                "file" if self.at("<=") => {
                    self.take("<=")?;
                    let max = self.number()?;
                    let mut types = Vec::new();
                    if self.maybe("(") {
                        while !self.at(")") {
                            let value = self.take_kind(Kind::Str)?;
                            if let Some(why) = snapback4_core::assets::file_type_refusal(&value.value) {
                                return Err(syntax_with(&value.site, why, format!("file <={max} ('application/pdf', 'text/plain')")).guide("assets"));
                            }
                            if types.contains(&value.value) {
                                return Err(syntax_with(&value.site, format!("'{}' is listed twice", value.value), "list each media type once"));
                            }
                            types.push(value.value);
                            if !self.maybe(",") { break; }
                        }
                        self.take(")")?;
                        if types.is_empty() {
                            return Err(syntax_with(&site, "a file allow-list needs at least one media type", format!("file <={max} ('application/pdf'), or file <={max} for every verifiable type")).guide("assets"));
                        }
                    }
                    TypeKind::File { max, types }
                }
                "cursor" => TypeKind::Cursor,
                "id" => TypeKind::Id,
                "principal" => TypeKind::Principal,
                "int" if self.at_kind(Kind::Number) || matches!(self.peek().value.as_str(), "<=" | ">=" | "<" | ">" | "-" | ".") => {
                    let (min, max) = self.int_range(&name.site)?;
                    TypeKind::IntRange { min, max }
                }
                "int" => TypeKind::Int,
                "time" => TypeKind::Time,
                "bool" => TypeKind::Bool,
                "enum" => {
                    self.take("(")?;
                    let mut variants = Vec::new();
                    while !self.at(")") {
                        variants.push(self.take_kind(Kind::Str)?.value);
                        if !self.maybe(",") {
                            break;
                        }
                    }
                    self.take(")")?;
                    if variants.is_empty() {
                        return Err(syntax_with(&site, "enum needs at least one variant", "enum('draft', 'published')"));
                    }
                    TypeKind::Enum { variants }
                }
                other => TypeKind::Ref { table: other.to_owned() },
            };
        }
        if self.maybe("once") {
            if !column {
                let optional = self.maybe("?");
                return Err(syntax_with(&site, "once is a column modifier, not an argument constraint; declare it on the owning table column", print::scalar_type(&ScalarType { kind, optional })).mechanical());
            }
            match &mut kind {
                TypeKind::Image { once, .. } => *once = true,
                TypeKind::Video { .. } => return Err(syntax_with(&site, "once is only specified for image columns; video ranges are unspecified", "use photo: image <=10000000 once, or remove once from the video column")),
                TypeKind::File { .. } => return Err(syntax_with(&site, "once is only specified for image columns; a downloaded file is saved by the browser, so one view cannot be kept", "remove once from the file column; use image <=10000000 once for one-view photos").guide("assets")),
                _ => return Err(syntax_with(&site, "once is only specified for image columns", "remove once from this column; use image <=10000000 once for one-use images")),
            }
        }
        let optional = self.maybe("?");
        Ok(ScalarType { kind, optional })
    }

    pub(super) fn media_size(&mut self) -> Fallible<u32> {
        let site = self.peek().site.clone();
        let size = self.number()?;
        let multiplier = match self.peek().value.as_str() { "KB" => 1_000, "MB" => 1_000_000, "GB" => 1_000_000_000, _ => return Ok(size) };
        self.position += 1;
        size.checked_mul(multiplier).ok_or_else(|| syntax_with(&site, "upload bound exceeds 4,294,967,295 bytes", "use image <=5MB or a byte count fitting u32").guide("types"))
    }
}
