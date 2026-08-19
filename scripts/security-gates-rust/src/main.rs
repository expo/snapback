use proc_macro2::{Span, TokenStream};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use syn::parse::Parser;
use syn::punctuated::Punctuated;
use syn::spanned::Spanned;
use syn::visit::{self, Visit};
use syn::{
    Attribute, Expr, ExprLit, Fields, FnArg, ImplItem, Item, ItemImpl, ItemMod, Lit, Meta,
    ReturnType, Stmt, Token, Type, UseTree, Visibility,
};

// @ref LLP 0284#31-capability-obtainability-the-closure-not-the-spellings —
// these are privilege seeds, not a list of function spellings to grep.
const SEED_TYPES: &[&str] = &[
    "KernelCommitAuthority",
    "AuthorizationCommitCarrierFactory",
    "AuthorizationCommitReservation",
    "PreparedAuthorizationCommit",
    "ServiceAuthorityCommitInterlock",
    "ServiceAuthorityTerminalFactory",
    "PreparedServiceAuthorityTerminal",
    "PushStorageAuthority",
    "ProtectedRecordErasureAuthorityV1",
    "ProtectedRecordErasureRequestV1",
    "CreatePendingEffectCommand",
    "DecidePendingEffectCommand",
    "SettlePendingEffectCommand",
    "RefusePendingEffectCommand",
    "PromotionContentionReservation",
    "AskSpendReservation",
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Finding {
    kind: String,
    item: String,
    file: String,
    line: usize,
    detail: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    seed_type: Option<String>,
}

#[derive(Default, Clone)]
struct ModuleNames {
    sql_imports: BTreeSet<String>,
    raw_aliases: BTreeSet<String>,
    seed_aliases: BTreeMap<String, String>,
    public_types: BTreeSet<String>,
}

struct PrivilegeScanner {
    crate_name: String,
    crate_root: PathBuf,
    active_features: BTreeSet<String>,
    findings: Vec<Finding>,
    visited: HashSet<(PathBuf, bool, String)>,
    private_public_types: BTreeSet<String>,
    heuristic_returns: Vec<HeuristicCandidate>,
    heuristic_accepts: BTreeSet<String>,
}

struct HeuristicCandidate {
    type_name: String,
    item: String,
    file: PathBuf,
    span: Span,
}

impl PrivilegeScanner {
    fn scan(mut self, lib: &Path) -> Result<Vec<Finding>, String> {
        let module_dir = lib
            .parent()
            .ok_or_else(|| format!("library root has no parent: {}", lib.display()))?;
        self.scan_file(lib, Vec::new(), true, module_dir.to_path_buf())?;
        let heuristic_returns = std::mem::take(&mut self.heuristic_returns);
        for candidate in heuristic_returns {
            if self.private_public_types.contains(&candidate.type_name)
                && self.heuristic_accepts.contains(&candidate.type_name)
                && !SEED_TYPES.contains(&candidate.type_name.as_str())
            {
                self.push_finding(
                    "seed-obtain",
                    candidate.item,
                    &candidate.file,
                    candidate.span,
                    format!(
                        "new seed-type heuristic: private-field {} leaves and re-enters LocalDatabase",
                        candidate.type_name
                    ),
                    Some(candidate.type_name),
                );
            }
        }
        self.findings.sort_by(|left, right| {
            (&left.file, left.line, &left.kind, &left.item, &left.detail).cmp(&(
                &right.file,
                right.line,
                &right.kind,
                &right.item,
                &right.detail,
            ))
        });
        self.findings.dedup_by(|left, right| {
            left.file == right.file
                && left.line == right.line
                && left.kind == right.kind
                && left.item == right.item
                && left.detail == right.detail
        });
        Ok(self.findings)
    }

    fn scan_file(
        &mut self,
        path: &Path,
        module: Vec<String>,
        module_public: bool,
        module_dir: PathBuf,
    ) -> Result<(), String> {
        let canonical = fs::canonicalize(path)
            .map_err(|error| format!("cannot resolve Rust source {}: {error}", path.display()))?;
        if !self
            .visited
            .insert((canonical.clone(), module_public, module.join("::")))
        {
            return Ok(());
        }
        let source = fs::read_to_string(&canonical)
            .map_err(|error| format!("cannot read Rust source {}: {error}", canonical.display()))?;
        let syntax = syn::parse_file(&source).map_err(|error| {
            format!("cannot parse Rust source {}: {error}", canonical.display())
        })?;
        self.scan_items(
            &syntax.items,
            &canonical,
            &module,
            module_public,
            &module_dir,
            canonical.parent().unwrap_or(&module_dir),
        )
    }

    fn scan_items(
        &mut self,
        items: &[Item],
        source: &Path,
        module: &[String],
        module_public: bool,
        module_dir: &Path,
        attribute_dir: &Path,
    ) -> Result<(), String> {
        let names = self.collect_names(items);
        for item in items {
            if !attrs_active(item_attrs(item), &self.active_features) {
                continue;
            }
            match item {
                Item::Fn(function) if module_public && public(&function.vis) => {
                    let item_name = self.item_name(module, &function.sig.ident.to_string());
                    self.scan_signature(
                        &function.sig,
                        &names,
                        source,
                        &item_name,
                        function.sig.ident.span(),
                    );
                }
                Item::Struct(structure) if module_public && public(&structure.vis) => {
                    let item_name = self.item_name(module, &structure.ident.to_string());
                    self.scan_seed_derives(
                        &structure.ident.to_string(),
                        &structure.attrs,
                        source,
                        &item_name,
                        structure.ident.span(),
                    );
                    self.scan_fields(&structure.fields, &names, source, &item_name, false);
                    if structure.fields.iter().all(|field| !public(&field.vis)) {
                        self.private_public_types
                            .insert(structure.ident.to_string());
                    }
                }
                Item::Enum(enumeration) if module_public && public(&enumeration.vis) => {
                    let item_name = self.item_name(module, &enumeration.ident.to_string());
                    self.scan_seed_derives(
                        &enumeration.ident.to_string(),
                        &enumeration.attrs,
                        source,
                        &item_name,
                        enumeration.ident.span(),
                    );
                    for variant in &enumeration.variants {
                        self.scan_fields(
                            &variant.fields,
                            &names,
                            source,
                            &format!("{item_name}::{}", variant.ident),
                            true,
                        );
                    }
                }
                Item::Union(item_union) if module_public && public(&item_union.vis) => {
                    let item_name = self.item_name(module, &item_union.ident.to_string());
                    self.scan_seed_derives(
                        &item_union.ident.to_string(),
                        &item_union.attrs,
                        source,
                        &item_name,
                        item_union.ident.span(),
                    );
                    self.scan_fields(
                        &Fields::Named(item_union.fields.clone()),
                        &names,
                        source,
                        &item_name,
                        false,
                    );
                    if item_union
                        .fields
                        .named
                        .iter()
                        .all(|field| !public(&field.vis))
                    {
                        self.private_public_types
                            .insert(item_union.ident.to_string());
                    }
                }
                Item::Type(alias) if module_public && public(&alias.vis) => {
                    let item_name = self.item_name(module, &alias.ident.to_string());
                    let type_info = inspect_type(&alias.ty, &names);
                    self.report_type_exposure(
                        &type_info,
                        source,
                        alias.ident.span(),
                        &item_name,
                        "public type alias",
                        false,
                    );
                }
                Item::Static(item_static) if module_public && public(&item_static.vis) => {
                    let item_name = self.item_name(module, &item_static.ident.to_string());
                    let type_info = inspect_type(&item_static.ty, &names);
                    self.report_type_exposure(
                        &type_info,
                        source,
                        item_static.ident.span(),
                        &item_name,
                        "public static",
                        false,
                    );
                }
                Item::Const(item_const) if module_public && public(&item_const.vis) => {
                    let item_name = self.item_name(module, &item_const.ident.to_string());
                    let type_info = inspect_type(&item_const.ty, &names);
                    self.report_type_exposure(
                        &type_info,
                        source,
                        item_const.ident.span(),
                        &item_name,
                        "public const",
                        false,
                    );
                }
                Item::Trait(item_trait) if module_public && public(&item_trait.vis) => {
                    let item_name = self.item_name(module, &item_trait.ident.to_string());
                    for member in &item_trait.items {
                        match member {
                            syn::TraitItem::Fn(function) => self.scan_signature(
                                &function.sig,
                                &names,
                                source,
                                &format!("{item_name}::{}", function.sig.ident),
                                function.sig.ident.span(),
                            ),
                            syn::TraitItem::Type(item_type) => {
                                if let Some((_, ty)) = &item_type.default {
                                    let info = inspect_type(ty, &names);
                                    self.report_type_exposure(
                                        &info,
                                        source,
                                        item_type.ident.span(),
                                        &format!("{item_name}::{}", item_type.ident),
                                        "public trait associated type",
                                        false,
                                    );
                                }
                            }
                            syn::TraitItem::Const(item_const) => {
                                let info = inspect_type(&item_const.ty, &names);
                                self.report_type_exposure(
                                    &info,
                                    source,
                                    item_const.ident.span(),
                                    &format!("{item_name}::{}", item_const.ident),
                                    "public trait associated const",
                                    false,
                                );
                            }
                            _ => {}
                        }
                    }
                }
                Item::Use(item_use) if module_public && public(&item_use.vis) => {
                    for path in flatten_use_tree(&item_use.tree) {
                        self.scan_reexport(source, module, item_use.span(), &path);
                    }
                }
                Item::ExternCrate(extern_crate)
                    if module_public
                        && public(&extern_crate.vis)
                        && extern_crate.ident == "rusqlite" =>
                {
                    self.push_finding(
                        "reexport",
                        self.item_name(module, "rusqlite"),
                        source,
                        extern_crate.ident.span(),
                        "pub extern crate rusqlite".to_owned(),
                        None,
                    );
                }
                Item::Impl(item_impl) if module_public => {
                    self.scan_impl(item_impl, &names, source, module);
                }
                Item::Macro(item_macro)
                    if matches!(
                        self.crate_name.as_str(),
                        "snapback-kernel" | "snapback-services"
                    ) && attr_present(&item_macro.attrs, "macro_export") =>
                {
                    let name = item_macro
                        .ident
                        .as_ref()
                        .map(ToString::to_string)
                        .unwrap_or_else(|| "<anonymous-macro>".to_owned());
                    self.push_finding(
                        "macro-export",
                        self.item_name(module, &name),
                        source,
                        item_macro.span(),
                        "#[macro_export] is fail-closed in privilege-owning crates".to_owned(),
                        None,
                    );
                }
                Item::Mod(item_mod) => {
                    self.scan_module(
                        item_mod,
                        source,
                        module,
                        module_public,
                        module_dir,
                        attribute_dir,
                    )?;
                }
                _ => {}
            }
        }
        Ok(())
    }

    fn collect_names(&self, items: &[Item]) -> ModuleNames {
        let mut names = ModuleNames::default();
        let mut aliases = Vec::new();
        for item in items {
            if !attrs_active(item_attrs(item), &self.active_features) {
                continue;
            }
            match item {
                Item::Use(item_use) => {
                    for path in flatten_use_tree(&item_use.tree) {
                        if path.iter().any(|segment| segment == "rusqlite") {
                            if let Some(last) = path.last() {
                                if matches!(last.as_str(), "Connection" | "Transaction") {
                                    names.sql_imports.insert(last.clone());
                                }
                            }
                        }
                    }
                }
                Item::Type(alias) => {
                    aliases.push(alias);
                }
                Item::Struct(structure) if public(&structure.vis) => {
                    names.public_types.insert(structure.ident.to_string());
                }
                Item::Enum(enumeration) if public(&enumeration.vis) => {
                    names.public_types.insert(enumeration.ident.to_string());
                }
                Item::Union(item_union) if public(&item_union.vis) => {
                    names.public_types.insert(item_union.ident.to_string());
                }
                _ => {}
            }
        }
        // Rust aliases may refer forward and may form trivial chains. Iterate
        // to a fixed point instead of depending on source order.
        loop {
            let mut changed = false;
            for alias in &aliases {
                let info = inspect_type(&alias.ty, &names);
                if info.raw_handle.is_some() && names.raw_aliases.insert(alias.ident.to_string()) {
                    changed = true;
                }
                if let Some(seed) = info.seed_type {
                    if !names.seed_aliases.contains_key(&alias.ident.to_string()) {
                        names.seed_aliases.insert(alias.ident.to_string(), seed);
                        changed = true;
                    }
                }
            }
            if !changed {
                break;
            }
        }
        names
    }

    fn scan_module(
        &mut self,
        item_mod: &ItemMod,
        source: &Path,
        module: &[String],
        parent_public: bool,
        module_dir: &Path,
        attribute_dir: &Path,
    ) -> Result<(), String> {
        let mut child_module = module.to_vec();
        child_module.push(item_mod.ident.to_string());
        let child_public = parent_public && public(&item_mod.vis);
        if let Some((_, items)) = &item_mod.content {
            return self.scan_items(
                items,
                source,
                &child_module,
                child_public,
                &module_dir.join(item_mod.ident.to_string()),
                &attribute_dir.join(item_mod.ident.to_string()),
            );
        }
        let explicit = path_attributes(&item_mod.attrs).into_iter().next();
        let target = if let Some(value) = explicit {
            attribute_dir.join(value)
        } else {
            let flat = module_dir.join(format!("{}.rs", item_mod.ident));
            let nested = module_dir.join(item_mod.ident.to_string()).join("mod.rs");
            if flat.exists() { flat } else { nested }
        };
        if !target.exists() {
            return Ok(());
        }
        let next_dir = module_directory_for_file(&target, module_dir, &item_mod.ident.to_string());
        self.scan_file(&target, child_module, child_public, next_dir)
    }

    fn scan_fields(
        &mut self,
        fields: &Fields,
        names: &ModuleNames,
        source: &Path,
        item_name: &str,
        enum_fields_public: bool,
    ) {
        for (index, field) in fields.iter().enumerate() {
            if !enum_fields_public && !public(&field.vis) {
                continue;
            }
            let info = inspect_type(&field.ty, names);
            let field_name = field
                .ident
                .as_ref()
                .map(ToString::to_string)
                .unwrap_or_else(|| index.to_string());
            self.report_type_exposure(
                &info,
                source,
                field.span(),
                &format!("{item_name}::{field_name}"),
                "public field",
                false,
            );
        }
    }

    fn scan_seed_derives(
        &mut self,
        type_name: &str,
        attrs: &[Attribute],
        source: &Path,
        item_name: &str,
        span: Span,
    ) {
        if !SEED_TYPES.contains(&type_name) {
            return;
        }
        for derived in derive_names(attrs) {
            if matches!(
                derived.as_str(),
                "Clone" | "Copy" | "Default" | "Deserialize"
            ) {
                self.push_finding(
                    "seed-clone",
                    item_name.to_owned(),
                    source,
                    span,
                    format!("{type_name} derives {derived}"),
                    Some(type_name.to_owned()),
                );
            }
        }
    }

    fn scan_impl(
        &mut self,
        item_impl: &ItemImpl,
        names: &ModuleNames,
        source: &Path,
        module: &[String],
    ) {
        let self_type = inspect_type(&item_impl.self_ty, names);
        let self_name = last_type_name(&item_impl.self_ty).unwrap_or_else(|| "<impl>".to_owned());
        let impl_public = names.public_types.contains(&self_name)
            || SEED_TYPES.contains(&self_name.as_str())
            || self_name == "LocalDatabase";
        if let Some((_, trait_path, _)) = &item_impl.trait_ {
            let trait_name = trait_path
                .segments
                .last()
                .map(|segment| segment.ident.to_string())
                .unwrap_or_default();
            if let Some(seed) = self_type.seed_type.clone() {
                if matches!(
                    trait_name.as_str(),
                    "Clone" | "Copy" | "Default" | "Deserialize"
                ) {
                    self.push_finding(
                        "seed-clone",
                        self.item_name(module, &self_name),
                        source,
                        item_impl.span(),
                        format!("{self_name} implements {trait_name}"),
                        Some(seed.clone()),
                    );
                }
                if matches!(
                    trait_name.as_str(),
                    "From" | "Into" | "TryFrom" | "FromIterator"
                ) {
                    self.push_finding(
                        "seed-obtain",
                        self.item_name(module, &self_name),
                        source,
                        item_impl.span(),
                        format!("{self_name} implements public constructor trait {trait_name}"),
                        Some(seed),
                    );
                }
            }
            for member in &item_impl.items {
                if let ImplItem::Type(item_type) = member {
                    let info = inspect_type(&item_type.ty, names);
                    self.report_type_exposure(
                        &info,
                        source,
                        item_type.ident.span(),
                        &format!(
                            "{}::{trait_name}::{}",
                            self.item_name(module, &self_name),
                            item_type.ident
                        ),
                        "public trait implementation associated type",
                        false,
                    );
                }
            }
        }
        if !impl_public {
            return;
        }
        let owner = self.item_name(module, &self_name);
        for member in &item_impl.items {
            if !attrs_active(impl_item_attrs(member), &self.active_features) {
                continue;
            }
            match member {
                ImplItem::Fn(function) if public(&function.vis) => self.scan_signature(
                    &function.sig,
                    names,
                    source,
                    &format!("{owner}::{}", function.sig.ident),
                    function.sig.ident.span(),
                ),
                ImplItem::Const(item_const) if public(&item_const.vis) => {
                    let info = inspect_type(&item_const.ty, names);
                    self.report_type_exposure(
                        &info,
                        source,
                        item_const.ident.span(),
                        &format!("{owner}::{}", item_const.ident),
                        "public associated const",
                        false,
                    );
                }
                ImplItem::Type(item_type) if public(&item_type.vis) => {
                    let info = inspect_type(&item_type.ty, names);
                    self.report_type_exposure(
                        &info,
                        source,
                        item_type.ident.span(),
                        &format!("{owner}::{}", item_type.ident),
                        "public associated type",
                        false,
                    );
                }
                _ => {}
            }
        }
    }

    fn scan_signature(
        &mut self,
        signature: &syn::Signature,
        names: &ModuleNames,
        source: &Path,
        item_name: &str,
        span: Span,
    ) {
        if let ReturnType::Type(_, ty) = &signature.output {
            let info = inspect_type(ty, names);
            self.report_type_exposure(&info, source, span, item_name, "public return type", true);
            if self.crate_name == "snapback-kernel" && contains_impl_trait(ty) {
                self.push_finding(
                    "impl-trait-return",
                    item_name.to_owned(),
                    source,
                    span,
                    "public kernel function returns opaque impl Trait".to_owned(),
                    None,
                );
            }
            if item_name.contains("::KernelCommitAuthority::")
                || item_name.contains("::LocalDatabase::")
            {
                for type_name in &info.type_names {
                    self.heuristic_returns.push(HeuristicCandidate {
                        type_name: type_name.clone(),
                        item: item_name.to_owned(),
                        file: source.to_path_buf(),
                        span,
                    });
                }
            }
        }
        for argument in &signature.inputs {
            let FnArg::Typed(argument) = argument else {
                continue;
            };
            let info = inspect_type(&argument.ty, names);
            if let Some(raw) = info.raw_handle {
                self.push_finding(
                    "sql-ingress",
                    item_name.to_owned(),
                    source,
                    span,
                    format!("public parameter names rusqlite::{raw}"),
                    None,
                );
            }
            if let Some(seed) = info.seed_type {
                self.push_finding(
                    "seed-ingress-candidate",
                    item_name.to_owned(),
                    source,
                    span,
                    format!("public parameter accepts privilege seed {seed}"),
                    Some(seed),
                );
            }
            if item_name.contains("::LocalDatabase::") {
                self.heuristic_accepts.extend(info.type_names);
            }
        }
    }

    fn report_type_exposure(
        &mut self,
        info: &TypeInfo,
        source: &Path,
        span: Span,
        item_name: &str,
        context: &str,
        returning: bool,
    ) {
        if let Some(raw) = &info.raw_handle {
            self.push_finding(
                "sql-egress",
                item_name.to_owned(),
                source,
                span,
                format!("{context} exposes rusqlite::{raw}"),
                None,
            );
        }
        if let Some(seed) = &info.seed_type {
            self.push_finding(
                "seed-obtain",
                item_name.to_owned(),
                source,
                span,
                if returning {
                    format!("returns privilege seed {seed}")
                } else {
                    format!("{context} exposes privilege seed {seed}")
                },
                Some(seed.clone()),
            );
        }
    }

    fn scan_reexport(&mut self, source: &Path, module: &[String], span: Span, path: &[String]) {
        if path.is_empty() {
            return;
        }
        let rendered = path.join("::");
        if path.iter().any(|segment| segment == "rusqlite") {
            self.push_finding(
                "reexport",
                self.item_name(module, path.last().unwrap()),
                source,
                span,
                format!("publicly re-exports {rendered}"),
                None,
            );
            return;
        }
        if let Some(seed) = path
            .iter()
            .find(|segment| SEED_TYPES.contains(&segment.as_str()))
        {
            self.push_finding(
                "reexport",
                self.item_name(module, path.last().unwrap()),
                source,
                span,
                format!("publicly re-exports privilege seed {rendered}"),
                Some(seed.clone()),
            );
            return;
        }
        let source_is_privilege_crate = path.first().is_some_and(|first| {
            matches!(
                first.as_str(),
                "snapback_kernel"
                    | "snapback_auth"
                    | "snapback_activation"
                    | "snapback_engine"
                    | "snapback_server"
                    | "snapback_services"
            )
        });
        if self.crate_name != "snapback-kernel"
            && source_is_privilege_crate
            && path
                .last()
                .is_some_and(|segment| segment == "storage" || segment == "LocalDatabase")
        {
            self.push_finding(
                "reexport",
                self.item_name(module, path.last().unwrap()),
                source,
                span,
                format!("publicly re-exports privilege module/type {rendered}"),
                None,
            );
        }
    }

    fn item_name(&self, module: &[String], leaf: &str) -> String {
        let mut parts = vec![self.crate_name.replace('-', "_")];
        parts.extend(module.iter().cloned());
        parts.push(leaf.to_owned());
        parts.join("::")
    }

    fn push_finding(
        &mut self,
        kind: &str,
        item: String,
        source: &Path,
        span: Span,
        detail: String,
        seed_type: Option<String>,
    ) {
        let file = source
            .strip_prefix(&self.crate_root)
            .unwrap_or(source)
            .to_string_lossy()
            .replace('\\', "/");
        self.findings.push(Finding {
            kind: kind.to_owned(),
            item,
            file,
            line: span.start().line,
            detail,
            seed_type,
        });
    }
}

#[derive(Default)]
struct TypeInfo {
    raw_handle: Option<String>,
    seed_type: Option<String>,
    type_names: BTreeSet<String>,
}

fn inspect_type(ty: &Type, names: &ModuleNames) -> TypeInfo {
    struct Inspector<'a> {
        names: &'a ModuleNames,
        info: TypeInfo,
    }
    impl<'ast> Visit<'ast> for Inspector<'_> {
        fn visit_type_path(&mut self, node: &'ast syn::TypePath) {
            let segments = node
                .path
                .segments
                .iter()
                .map(|segment| segment.ident.to_string())
                .collect::<Vec<_>>();
            let has_rusqlite = segments.iter().any(|segment| segment == "rusqlite");
            for segment in &segments {
                self.info.type_names.insert(segment.clone());
                if matches!(segment.as_str(), "Connection" | "Transaction")
                    && (has_rusqlite
                        || self.names.sql_imports.contains(segment)
                        || segments.len() == 1)
                {
                    self.info.raw_handle.get_or_insert_with(|| segment.clone());
                }
                if self.names.raw_aliases.contains(segment) {
                    self.info
                        .raw_handle
                        .get_or_insert_with(|| format!("alias {segment}"));
                }
                if SEED_TYPES.contains(&segment.as_str()) {
                    self.info.seed_type.get_or_insert_with(|| segment.clone());
                }
                if let Some(seed) = self.names.seed_aliases.get(segment) {
                    self.info.seed_type.get_or_insert_with(|| seed.clone());
                }
            }
            visit::visit_type_path(self, node);
        }
    }
    let mut inspector = Inspector {
        names,
        info: TypeInfo::default(),
    };
    inspector.visit_type(ty);
    inspector.info
}

fn contains_impl_trait(ty: &Type) -> bool {
    struct Finder(bool);
    impl<'ast> Visit<'ast> for Finder {
        fn visit_type_impl_trait(&mut self, _node: &'ast syn::TypeImplTrait) {
            self.0 = true;
        }
    }
    let mut finder = Finder(false);
    finder.visit_type(ty);
    finder.0
}

fn last_type_name(ty: &Type) -> Option<String> {
    match ty {
        Type::Path(path) => path
            .path
            .segments
            .last()
            .map(|segment| segment.ident.to_string()),
        Type::Reference(reference) => last_type_name(&reference.elem),
        _ => None,
    }
}

fn public(visibility: &Visibility) -> bool {
    matches!(visibility, Visibility::Public(_))
}

fn attr_present(attrs: &[Attribute], name: &str) -> bool {
    attrs
        .iter()
        .any(|attribute| attribute.path().is_ident(name))
}

fn derive_names(attrs: &[Attribute]) -> Vec<String> {
    attrs
        .iter()
        .filter(|attribute| attribute.path().is_ident("derive"))
        .flat_map(|attribute| {
            attribute
                .parse_args_with(Punctuated::<syn::Path, Token![,]>::parse_terminated)
                .unwrap_or_default()
                .into_iter()
                .filter_map(|path| {
                    path.segments
                        .last()
                        .map(|segment| segment.ident.to_string())
                })
        })
        .collect()
}

fn flatten_use_tree(tree: &UseTree) -> Vec<Vec<String>> {
    fn walk(tree: &UseTree, prefix: Vec<String>, output: &mut Vec<Vec<String>>) {
        match tree {
            UseTree::Path(path) => {
                let mut next = prefix;
                next.push(path.ident.to_string());
                walk(&path.tree, next, output);
            }
            UseTree::Name(name) => {
                let mut next = prefix;
                next.push(name.ident.to_string());
                output.push(next);
            }
            UseTree::Rename(rename) => {
                let mut next = prefix;
                next.push(rename.ident.to_string());
                output.push(next);
            }
            UseTree::Glob(_) => {
                let mut next = prefix;
                next.push("*".to_owned());
                output.push(next);
            }
            UseTree::Group(group) => {
                for item in &group.items {
                    walk(item, prefix.clone(), output);
                }
            }
        }
    }
    let mut output = Vec::new();
    walk(tree, Vec::new(), &mut output);
    output
}

fn attrs_active(attrs: &[Attribute], features: &BTreeSet<String>) -> bool {
    // @ref LLP 0284#44-feature-matrix-all-three-gates-that-inspect-api —
    // cfg(test) stays private to owner tests; caller features are inspected.
    for attribute in attrs {
        if !attribute.path().is_ident("cfg") {
            continue;
        }
        let Ok(meta) = attribute.parse_args::<Meta>() else {
            continue;
        };
        if matches!(eval_cfg(&meta, features), Truth::False) {
            return false;
        }
    }
    true
}

#[derive(Clone, Copy)]
enum Truth {
    True,
    False,
    Unknown,
}

fn eval_cfg(meta: &Meta, features: &BTreeSet<String>) -> Truth {
    match meta {
        Meta::Path(path) if path.is_ident("test") => Truth::False,
        Meta::Path(path) if path.is_ident("unix") => Truth::True,
        Meta::Path(_) => Truth::Unknown,
        Meta::NameValue(value) if value.path.is_ident("feature") => match &value.value {
            Expr::Lit(ExprLit {
                lit: Lit::Str(feature),
                ..
            }) => {
                if features.contains(&feature.value()) {
                    Truth::True
                } else {
                    Truth::False
                }
            }
            _ => Truth::Unknown,
        },
        Meta::NameValue(_) => Truth::Unknown,
        Meta::List(list) => {
            let entries = Punctuated::<Meta, Token![,]>::parse_terminated
                .parse2(list.tokens.clone())
                .unwrap_or_default()
                .into_iter()
                .map(|entry| eval_cfg(&entry, features))
                .collect::<Vec<_>>();
            if list.path.is_ident("all") {
                if entries.iter().any(|entry| matches!(entry, Truth::False)) {
                    Truth::False
                } else if entries.iter().all(|entry| matches!(entry, Truth::True)) {
                    Truth::True
                } else {
                    Truth::Unknown
                }
            } else if list.path.is_ident("any") {
                if entries.iter().any(|entry| matches!(entry, Truth::True)) {
                    Truth::True
                } else if entries.iter().all(|entry| matches!(entry, Truth::False)) {
                    Truth::False
                } else {
                    Truth::Unknown
                }
            } else if list.path.is_ident("not") && entries.len() == 1 {
                match entries[0] {
                    Truth::True => Truth::False,
                    Truth::False => Truth::True,
                    Truth::Unknown => Truth::Unknown,
                }
            } else {
                Truth::Unknown
            }
        }
    }
}

fn path_attributes(attrs: &[Attribute]) -> Vec<String> {
    // @ref LLP 0284#43-cross-crate-path-includes--compilation-unit-ownership
    // — cfg_attr paths are ownership-relevant even when their cfg is false.
    let mut values = Vec::new();
    for attribute in attrs {
        if attribute.path().is_ident("path") {
            if let Meta::NameValue(value) = &attribute.meta {
                if let Expr::Lit(ExprLit {
                    lit: Lit::Str(path),
                    ..
                }) = &value.value
                {
                    values.push(path.value());
                }
            }
        } else if attribute.path().is_ident("cfg_attr") {
            let nested = attribute
                .parse_args_with(Punctuated::<Meta, Token![,]>::parse_terminated)
                .unwrap_or_default();
            for meta in nested.into_iter().skip(1) {
                if let Meta::NameValue(value) = meta {
                    if value.path.is_ident("path") {
                        if let Expr::Lit(ExprLit {
                            lit: Lit::Str(path),
                            ..
                        }) = value.value
                        {
                            values.push(path.value());
                        }
                    }
                }
            }
        }
    }
    values
}

fn module_directory_for_file(target: &Path, parent: &Path, module_name: &str) -> PathBuf {
    if target.file_name().is_some_and(|name| name == "mod.rs") {
        target.parent().unwrap_or(parent).to_path_buf()
    } else {
        parent.join(module_name)
    }
}

fn item_attrs(item: &Item) -> &[Attribute] {
    match item {
        Item::Const(item) => &item.attrs,
        Item::Enum(item) => &item.attrs,
        Item::ExternCrate(item) => &item.attrs,
        Item::Fn(item) => &item.attrs,
        Item::ForeignMod(item) => &item.attrs,
        Item::Impl(item) => &item.attrs,
        Item::Macro(item) => &item.attrs,
        Item::Mod(item) => &item.attrs,
        Item::Static(item) => &item.attrs,
        Item::Struct(item) => &item.attrs,
        Item::Trait(item) => &item.attrs,
        Item::TraitAlias(item) => &item.attrs,
        Item::Type(item) => &item.attrs,
        Item::Union(item) => &item.attrs,
        Item::Use(item) => &item.attrs,
        _ => &[],
    }
}

fn impl_item_attrs(item: &ImplItem) -> &[Attribute] {
    match item {
        ImplItem::Const(item) => &item.attrs,
        ImplItem::Fn(item) => &item.attrs,
        ImplItem::Type(item) => &item.attrs,
        ImplItem::Macro(item) => &item.attrs,
        _ => &[],
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UnitReference {
    kind: String,
    line: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    value: Option<String>,
    #[serde(default)]
    out_dir: bool,
    #[serde(default)]
    module_path: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    module_name: Option<String>,
}

struct UnitVisitor {
    references: Vec<UnitReference>,
    inline_path: Vec<String>,
}

impl<'ast> Visit<'ast> for UnitVisitor {
    fn visit_item_mod(&mut self, node: &'ast ItemMod) {
        if node.content.is_none() {
            let paths = path_attributes(&node.attrs);
            if paths.is_empty() {
                self.references.push(UnitReference {
                    kind: "module".to_owned(),
                    line: node.ident.span().start().line,
                    value: Some(node.ident.to_string()),
                    out_dir: false,
                    module_path: self.inline_path.clone(),
                    module_name: Some(node.ident.to_string()),
                });
            } else {
                for path in paths {
                    self.references.push(UnitReference {
                        kind: "path".to_owned(),
                        line: node.ident.span().start().line,
                        value: Some(path),
                        out_dir: false,
                        module_path: self.inline_path.clone(),
                        module_name: Some(node.ident.to_string()),
                    });
                }
            }
        } else {
            self.inline_path.push(node.ident.to_string());
            visit::visit_item_mod(self, node);
            self.inline_path.pop();
        }
    }

    fn visit_macro(&mut self, node: &'ast syn::Macro) {
        if node.path.is_ident("include") {
            match evaluate_include(&node.tokens) {
                Some((value, out_dir)) => self.references.push(UnitReference {
                    kind: "include".to_owned(),
                    line: node.path.span().start().line,
                    value: Some(value),
                    out_dir,
                    module_path: self.inline_path.clone(),
                    module_name: None,
                }),
                None => self.references.push(UnitReference {
                    kind: "include-unevaluable".to_owned(),
                    line: node.path.span().start().line,
                    value: None,
                    out_dir: false,
                    module_path: self.inline_path.clone(),
                    module_name: None,
                }),
            }
        }
        visit::visit_macro(self, node);
    }
}

fn evaluate_include(tokens: &TokenStream) -> Option<(String, bool)> {
    let expression = syn::parse2::<Expr>(tokens.clone()).ok()?;
    match expression {
        Expr::Lit(ExprLit {
            lit: Lit::Str(value),
            ..
        }) => Some((value.value(), false)),
        Expr::Macro(macro_expression) if macro_expression.mac.path.is_ident("concat") => {
            let expressions = Punctuated::<Expr, Token![,]>::parse_terminated
                .parse2(macro_expression.mac.tokens)
                .ok()?;
            let mut value = String::new();
            let mut out_dir = false;
            for expression in expressions {
                match expression {
                    Expr::Lit(ExprLit {
                        lit: Lit::Str(part),
                        ..
                    }) => value.push_str(&part.value()),
                    Expr::Macro(environment) if environment.mac.path.is_ident("env") => {
                        let variable = syn::parse2::<syn::LitStr>(environment.mac.tokens).ok()?;
                        if variable.value() != "OUT_DIR" {
                            return None;
                        }
                        out_dir = true;
                        value.push_str("__SNAPBACK_OUT_DIR__");
                    }
                    _ => return None,
                }
            }
            Some((value, out_dir))
        }
        _ => None,
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AttackSpan {
    start_line: usize,
    start_column: usize,
    end_line: usize,
    end_column: usize,
}

fn attack_span(path: &Path) -> Result<AttackSpan, String> {
    // @ref LLP 0284#42-security-boundaries--compile-fail-witnesses-with-span-assertions
    // — the witness is the next syn node, never an error-message substring.
    let source = fs::read_to_string(path)
        .map_err(|error| format!("cannot read attack fixture {}: {error}", path.display()))?;
    if source.matches("// @attack").count() != 1 {
        return Err(format!(
            "{} must contain exactly one // @attack marker",
            path.display()
        ));
    }
    let marker_offset = source
        .find("// @attack")
        .ok_or_else(|| format!("{} has no // @attack marker", path.display()))?;
    let marker_line = source[..marker_offset]
        .bytes()
        .filter(|byte| *byte == b'\n')
        .count()
        + 1;
    let syntax = syn::parse_file(&source)
        .map_err(|error| format!("cannot parse attack fixture {}: {error}", path.display()))?;
    let mut candidates = Vec::<Span>::new();
    collect_attack_candidates(&syntax.items, &mut candidates);
    let selected = candidates
        .into_iter()
        .filter(|span| span.start().line > marker_line)
        .min_by_key(|span| {
            let start = span.start();
            let end = span.end();
            (start.line, start.column, end.line - start.line, end.column)
        })
        .ok_or_else(|| {
            format!(
                "{} has no Rust expression/item after @attack",
                path.display()
            )
        })?;
    let start = selected.start();
    let end = selected.end();
    Ok(AttackSpan {
        start_line: start.line,
        start_column: start.column + 1,
        end_line: end.line,
        end_column: end.column + 1,
    })
}

fn collect_attack_candidates(items: &[Item], output: &mut Vec<Span>) {
    for item in items {
        output.push(item.span());
        match item {
            Item::Fn(function) => collect_block_candidates(&function.block.stmts, output),
            Item::Impl(item_impl) => {
                for member in &item_impl.items {
                    output.push(member.span());
                    if let ImplItem::Fn(function) = member {
                        collect_block_candidates(&function.block.stmts, output);
                    }
                }
            }
            Item::Mod(item_mod) => {
                if let Some((_, nested)) = &item_mod.content {
                    collect_attack_candidates(nested, output);
                }
            }
            _ => {}
        }
    }
}

fn collect_block_candidates(statements: &[Stmt], output: &mut Vec<Span>) {
    struct StatementVisitor<'a> {
        output: &'a mut Vec<Span>,
    }
    impl<'ast> Visit<'ast> for StatementVisitor<'_> {
        fn visit_stmt(&mut self, statement: &'ast Stmt) {
            self.output.push(statement.span());
            visit::visit_stmt(self, statement);
        }
    }
    let mut visitor = StatementVisitor { output };
    for statement in statements {
        visitor.visit_stmt(statement);
    }
}

fn required_arg(args: &[String], flag: &str) -> Result<String, String> {
    let index = args
        .iter()
        .position(|argument| argument == flag)
        .ok_or_else(|| format!("missing required argument {flag}"))?;
    args.get(index + 1)
        .cloned()
        .ok_or_else(|| format!("missing value for {flag}"))
}

fn run() -> Result<(), String> {
    let args = env::args().skip(1).collect::<Vec<_>>();
    let mode = args.first().map(String::as_str).unwrap_or("");
    match mode {
        "privilege" => {
            let crate_name = required_arg(&args, "--crate-name")?;
            let crate_root = PathBuf::from(required_arg(&args, "--crate-root")?);
            let lib = PathBuf::from(required_arg(&args, "--lib")?);
            let features = required_arg(&args, "--features")?
                .split(',')
                .filter(|feature| !feature.is_empty())
                .map(str::to_owned)
                .collect::<BTreeSet<_>>();
            let findings = PrivilegeScanner {
                crate_name,
                crate_root,
                active_features: features,
                findings: Vec::new(),
                visited: HashSet::new(),
                private_public_types: BTreeSet::new(),
                heuristic_returns: Vec::new(),
                heuristic_accepts: BTreeSet::new(),
            }
            .scan(&lib)?;
            println!(
                "{}",
                serde_json::to_string(&findings)
                    .map_err(|error| format!("cannot serialize privilege findings: {error}"))?
            );
        }
        "units" => {
            let path = PathBuf::from(required_arg(&args, "--file")?);
            let source = fs::read_to_string(&path)
                .map_err(|error| format!("cannot read Rust source {}: {error}", path.display()))?;
            let syntax = syn::parse_file(&source)
                .map_err(|error| format!("cannot parse Rust source {}: {error}", path.display()))?;
            let mut visitor = UnitVisitor {
                references: Vec::new(),
                inline_path: Vec::new(),
            };
            visitor.visit_file(&syntax);
            println!(
                "{}",
                serde_json::to_string(&visitor.references)
                    .map_err(|error| format!("cannot serialize unit references: {error}"))?
            );
        }
        "attack-span" => {
            let path = PathBuf::from(required_arg(&args, "--file")?);
            println!(
                "{}",
                serde_json::to_string(&attack_span(&path)?)
                    .map_err(|error| format!("cannot serialize attack span: {error}"))?
            );
        }
        _ => return Err("usage: security-gates-rust <privilege|units|attack-span> ...".to_owned()),
    }
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("SNAPBACK_SECURITY_GATE_AST: {error}");
        std::process::exit(2);
    }
}
