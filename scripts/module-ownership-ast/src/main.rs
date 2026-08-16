use std::io::{self, Read};

use proc_macro2::{Delimiter, Spacing, Span, TokenStream, TokenTree};
use quote::ToTokens;
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use syn::spanned::Spanned;
use syn::visit::{self, Visit};

// @ref LLP 0273#3.1 — item identity is a pinned-syn, token-preserving SHA-256
// serialization; literals, doc attributes, delimiters, and punct jointness bind.
const AST_VERSION: &str = "syn-2.0.118+proc-macro2-1.0.106";

fn hash_field(hasher: &mut Sha256, kind: &str, bytes: &[u8], joint: bool) {
    hasher.update((kind.len() as u64).to_be_bytes());
    hasher.update(kind.as_bytes());
    hasher.update((bytes.len() as u64).to_be_bytes());
    hasher.update(bytes);
    hasher.update([u8::from(joint)]);
}

fn hash_stream(hasher: &mut Sha256, stream: TokenStream) {
    for token in stream {
        match token {
            TokenTree::Group(group) => {
                let delimiter = match group.delimiter() {
                    Delimiter::Parenthesis => "parenthesis",
                    Delimiter::Brace => "brace",
                    Delimiter::Bracket => "bracket",
                    Delimiter::None => "none",
                };
                hash_field(hasher, "group-open", delimiter.as_bytes(), false);
                hash_stream(hasher, group.stream());
                hash_field(hasher, "group-close", delimiter.as_bytes(), false);
            }
            TokenTree::Ident(ident) => {
                hash_field(hasher, "ident", ident.to_string().as_bytes(), false);
            }
            TokenTree::Punct(punct) => {
                let text = punct.as_char().to_string();
                hash_field(
                    hasher,
                    "punct",
                    text.as_bytes(),
                    punct.spacing() == Spacing::Joint,
                );
            }
            TokenTree::Literal(literal) => {
                hash_field(hasher, "literal", literal.to_string().as_bytes(), false);
            }
        }
    }
}

fn fingerprint<T: ToTokens>(node: &T) -> String {
    let mut hasher = Sha256::new();
    hash_stream(&mut hasher, node.to_token_stream());
    format!("{:x}", hasher.finalize())
}

fn span_with_attributes(span: Span, attributes: &[syn::Attribute]) -> Span {
    attributes
        .first()
        .and_then(|attribute| attribute.span().join(span))
        .unwrap_or(span)
}

struct ItemInventory<'a> {
    lines: Vec<&'a str>,
    line_offsets: Vec<usize>,
    utf16_len: usize,
    items: Vec<Value>,
}

impl<'a> ItemInventory<'a> {
    fn new(source: &'a str) -> Self {
        let lines: Vec<_> = source.split_inclusive('\n').collect();
        let mut line_offsets = Vec::with_capacity(lines.len());
        let mut offset = 0usize;
        for line in &lines {
            line_offsets.push(offset);
            offset += line.encode_utf16().count();
        }
        Self {
            lines,
            line_offsets,
            utf16_len: offset,
            items: Vec::new(),
        }
    }

    // Node regex indices use UTF-16 code units. proc-macro2 reports a
    // one-based line and a byte column, so bind the line-start conversion once
    // per source rather than rescanning the whole file for every nested item.
    fn javascript_offset(&self, span: Span, end: bool) -> usize {
        let position = if end { span.end() } else { span.start() };
        let Some(line) = self.lines.get(position.line.saturating_sub(1)) else {
            return self.utf16_len;
        };
        let mut column = position.column.min(line.len());
        while column > 0 && !line.is_char_boundary(column) {
            column -= 1;
        }
        self.line_offsets[position.line - 1] + line[..column].encode_utf16().count()
    }

    fn push<T: ToTokens>(&mut self, node: &T, span: Span, attributes: &[syn::Attribute]) {
        let span = span_with_attributes(span, attributes);
        let start = self.javascript_offset(span, false);
        let end = self.javascript_offset(span, true);
        if start >= end || end > self.utf16_len {
            return;
        }
        self.items.push(json!({
            "start": start,
            "end": end,
            "fingerprint": fingerprint(node),
        }));
    }
}

macro_rules! visit_item_kind {
    ($method:ident, $kind:ty, $attrs:expr, $walk:path) => {
        fn $method(&mut self, node: &'ast $kind) {
            self.push(node, node.span(), $attrs(node));
            $walk(self, node);
        }
    };
}

impl<'ast> Visit<'ast> for ItemInventory<'_> {
    visit_item_kind!(visit_item, syn::Item, item_attributes, visit::visit_item);
    visit_item_kind!(
        visit_impl_item,
        syn::ImplItem,
        impl_item_attributes,
        visit::visit_impl_item
    );
    visit_item_kind!(
        visit_trait_item,
        syn::TraitItem,
        trait_item_attributes,
        visit::visit_trait_item
    );
    visit_item_kind!(
        visit_foreign_item,
        syn::ForeignItem,
        foreign_item_attributes,
        visit::visit_foreign_item
    );
}

fn item_attributes(item: &syn::Item) -> &[syn::Attribute] {
    match item {
        syn::Item::Const(value) => &value.attrs,
        syn::Item::Enum(value) => &value.attrs,
        syn::Item::ExternCrate(value) => &value.attrs,
        syn::Item::Fn(value) => &value.attrs,
        syn::Item::ForeignMod(value) => &value.attrs,
        syn::Item::Impl(value) => &value.attrs,
        syn::Item::Macro(value) => &value.attrs,
        syn::Item::Mod(value) => &value.attrs,
        syn::Item::Static(value) => &value.attrs,
        syn::Item::Struct(value) => &value.attrs,
        syn::Item::Trait(value) => &value.attrs,
        syn::Item::TraitAlias(value) => &value.attrs,
        syn::Item::Type(value) => &value.attrs,
        syn::Item::Union(value) => &value.attrs,
        syn::Item::Use(value) => &value.attrs,
        syn::Item::Verbatim(_) => &[],
        _ => &[],
    }
}

fn impl_item_attributes(item: &syn::ImplItem) -> &[syn::Attribute] {
    match item {
        syn::ImplItem::Const(value) => &value.attrs,
        syn::ImplItem::Fn(value) => &value.attrs,
        syn::ImplItem::Macro(value) => &value.attrs,
        syn::ImplItem::Type(value) => &value.attrs,
        syn::ImplItem::Verbatim(_) => &[],
        _ => &[],
    }
}

fn trait_item_attributes(item: &syn::TraitItem) -> &[syn::Attribute] {
    match item {
        syn::TraitItem::Const(value) => &value.attrs,
        syn::TraitItem::Fn(value) => &value.attrs,
        syn::TraitItem::Macro(value) => &value.attrs,
        syn::TraitItem::Type(value) => &value.attrs,
        syn::TraitItem::Verbatim(_) => &[],
        _ => &[],
    }
}

fn foreign_item_attributes(item: &syn::ForeignItem) -> &[syn::Attribute] {
    match item {
        syn::ForeignItem::Fn(value) => &value.attrs,
        syn::ForeignItem::Macro(value) => &value.attrs,
        syn::ForeignItem::Static(value) => &value.attrs,
        syn::ForeignItem::Type(value) => &value.attrs,
        syn::ForeignItem::Verbatim(_) => &[],
        _ => &[],
    }
}

fn main() {
    let mut input = String::new();
    io::stdin()
        .read_to_string(&mut input)
        .expect("read JSON input");
    let sources: Map<String, Value> = serde_json::from_str(&input).expect("parse source map JSON");
    let mut files = Map::new();
    for (path, value) in sources {
        let source = value.as_str().expect("source map values must be strings");
        let syntax = syn::parse_file(source).unwrap_or_else(|error| {
            panic!("SNAPBACK_MODULE_OWNERSHIP_AST_PARSE_FAILED {path}: {error}")
        });
        let mut inventory = ItemInventory::new(source);
        inventory.visit_file(&syntax);
        inventory.items.sort_by_key(|item| {
            (
                item["start"].as_u64().unwrap_or(0),
                item["end"].as_u64().unwrap_or(0),
            )
        });
        files.insert(path, Value::Array(inventory.items));
    }
    println!("{}", json!({ "astVersion": AST_VERSION, "files": files }));
}
