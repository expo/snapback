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

// @ref LLP 0284#38-authority-discriminators — this is the deliberately narrow
// direct-signature sink-name registry. It is a ratchet for known shapes, not
// data-flow analysis: wrapper/helper indirection and renamed sinks are recorded
// as residual evasions in LLP 0284 §3.7.
const PRIVILEGE_SINKS: &[&str] = &[
    "plan_privileged_membership_insert",
    "plan_membership_insert",
    "plan_membership_set_role",
    "plan_membership_remove",
    "plan_membership_remove_principal",
    "plan_membership_transfer_owner",
    "plan_membership_patch",
    "plan_membership_bootstrap",
    "plan_membership_teardown",
    "plan_membership_sweep_expired",
    "user_transition",
    "commit_membership_plan",
    "sanctioned",
    "is_privileged_noninvocation",
    "membership_write_provenance",
    "write_membership_creation_provenance",
    "record_membership_transition",
    "provenance",
];

// @ref LLP 0284#38-authority-discriminators — `ChangeOp` selects the
// transition journal's operation label; it does not
// select a privileged lane or authoritative actor/effective/grant provenance.
// The adjacent `MembershipWriter` input is the authority discriminator this
// registered sink exists to ratchet.
const NON_AUTHORITY_SINK_TYPES: &[(&str, &str)] = &[("record_membership_transition", "ChangeOp")];

const SYMBOLIC_CALLER_FEATURES: &str = "__SNAPBACK_SYMBOLIC_CALLER_FEATURES__";

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
    #[serde(skip_serializing_if = "Option::is_none")]
    generated_expression: Option<String>,
}

#[derive(Default, Clone)]
struct ModuleNames {
    sql_imports: BTreeSet<String>,
    raw_aliases: BTreeSet<String>,
    seed_aliases: BTreeMap<String, String>,
    public_types: BTreeSet<String>,
    public_api_macros: BTreeSet<String>,
    include_macro_aliases: BTreeSet<String>,
    generated_include_macros: BTreeSet<String>,
}

struct PrivilegeScanner {
    crate_name: String,
    crate_root: PathBuf,
    crate_lib: PathBuf,
    active_features: BTreeSet<String>,
    findings: Vec<Finding>,
    visited: HashSet<(PathBuf, bool, String)>,
    reexport_visits: HashSet<(PathBuf, String, String, String)>,
    private_public_types: BTreeSet<String>,
    heuristic_returns: Vec<HeuristicCandidate>,
    heuristic_accepts: BTreeSet<String>,
    constructible_types: BTreeSet<String>,
    constructible_declarations: Vec<ConstructibleDeclaration>,
    obtainability_edges: Vec<ObtainabilityEdge>,
    seed_returns: Vec<SeedReturnCandidate>,
    discriminator_sinks: Vec<DiscriminatorSinkCandidate>,
}

struct HeuristicCandidate {
    type_name: String,
    item: String,
    file: PathBuf,
    span: Span,
}

struct ConstructibleDeclaration {
    type_name: String,
    item: String,
    file: PathBuf,
    span: Span,
}

struct ObtainabilityEdge {
    receiver_type: Option<String>,
    requires_receiver: bool,
    requires_seed_input: bool,
    returned_types: BTreeSet<String>,
}

struct SeedReturnCandidate {
    seed_type: String,
    receiver_type: Option<String>,
    requires_receiver: bool,
    item: String,
    file: PathBuf,
    span: Span,
}

struct DiscriminatorSinkCandidate {
    type_names: BTreeSet<String>,
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

        // Public obtainability is a closure over constructors, free/associated
        // functions, receiver methods, and public containers. A wrapper that
        // can only be obtained by consuming the same seed is not an egress
        // mint; this is what keeps take-once containers such as
        // ManagedAuthorizationReservationScope from becoming permanent noise.
        let mut obtainable = self.constructible_types.clone();
        loop {
            let mut changed = false;
            for edge in &self.obtainability_edges {
                if edge.requires_seed_input {
                    continue;
                }
                if edge.requires_receiver {
                    let Some(receiver) = &edge.receiver_type else {
                        continue;
                    };
                    if !obtainable.contains(receiver) {
                        continue;
                    }
                }
                for returned in &edge.returned_types {
                    if obtainable.insert(returned.clone()) {
                        changed = true;
                    }
                }
            }
            if !changed {
                break;
            }
        }

        for candidate in std::mem::take(&mut self.seed_returns) {
            if candidate.requires_receiver
                && !candidate
                    .receiver_type
                    .as_ref()
                    .is_some_and(|receiver| obtainable.contains(receiver))
            {
                continue;
            }
            self.push_finding(
                "seed-obtain",
                candidate.item,
                &candidate.file,
                candidate.span,
                format!("returns privilege seed {}", candidate.seed_type),
                Some(candidate.seed_type),
            );
        }

        let mut direct_sink_discriminants = BTreeSet::new();
        for candidate in std::mem::take(&mut self.discriminator_sinks) {
            let matching_types = candidate
                .type_names
                .intersection(&self.constructible_types)
                .cloned()
                .collect::<Vec<_>>();
            for type_name in matching_types {
                direct_sink_discriminants.insert(type_name.clone());
                self.push_finding(
                    "caller-discriminant",
                    candidate.item.clone(),
                    &candidate.file,
                    candidate.span,
                    format!(
                        "caller-constructible {type_name} is named directly in a registered privilege-sink signature"
                    ),
                    Some(type_name),
                );
            }
        }
        for declaration in std::mem::take(&mut self.constructible_declarations) {
            if !direct_sink_discriminants.contains(&declaration.type_name) {
                continue;
            }
            self.push_finding(
                "caller-discriminant",
                declaration.item,
                &declaration.file,
                declaration.span,
                format!(
                    "{} is caller-constructible and is named directly in a registered privilege-sink signature",
                    declaration.type_name
                ),
                Some(declaration.type_name),
            );
        }
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
            if let Item::Fn(function) = item {
                self.record_discriminator_sink(
                    &function.sig,
                    None,
                    source,
                    &self.item_name(module, &function.sig.ident.to_string()),
                    function.sig.ident.span(),
                );
            }
            if let Item::Impl(item_impl) = item {
                let self_name =
                    last_type_name(&item_impl.self_ty).unwrap_or_else(|| "<impl>".to_owned());
                let owner = self.item_name(module, &self_name);
                for member in &item_impl.items {
                    if let ImplItem::Fn(function) = member {
                        self.record_discriminator_sink(
                            &function.sig,
                            Some(&self_name),
                            source,
                            &format!("{owner}::{}", function.sig.ident),
                            function.sig.ident.span(),
                        );
                    }
                }
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
                        None,
                    );
                }
                Item::Struct(structure) if module_public && public(&structure.vis) => {
                    let item_name = self.item_name(module, &structure.ident.to_string());
                    if public_structure_constructor(&structure.fields) {
                        self.record_constructible(
                            &structure.ident.to_string(),
                            &item_name,
                            source,
                            structure.ident.span(),
                        );
                    }
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
                    self.record_constructible(
                        &enumeration.ident.to_string(),
                        &item_name,
                        source,
                        enumeration.ident.span(),
                    );
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
                    if item_union
                        .fields
                        .named
                        .iter()
                        .all(|field| public(&field.vis))
                    {
                        self.record_constructible(
                            &item_union.ident.to_string(),
                            &item_name,
                            source,
                            item_union.ident.span(),
                        );
                    }
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
                        true,
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
                        true,
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
                        true,
                    );
                }
                Item::Trait(item_trait) if module_public && public(&item_trait.vis) => {
                    let item_name = self.item_name(module, &item_trait.ident.to_string());
                    let mut trait_module = module.to_vec();
                    trait_module.push(item_trait.ident.to_string());
                    for member in &item_trait.items {
                        if !attrs_active(trait_item_attrs(member), &self.active_features) {
                            continue;
                        }
                        match member {
                            syn::TraitItem::Fn(function) => self.scan_signature(
                                &function.sig,
                                &names,
                                source,
                                &format!("{item_name}::{}", function.sig.ident),
                                function.sig.ident.span(),
                                None,
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
                                        true,
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
                                    true,
                                );
                            }
                            syn::TraitItem::Macro(item_macro) => self.scan_generated_api(
                                &item_macro.mac,
                                None,
                                item_macro.span(),
                                &names,
                                source,
                                &trait_module,
                            )?,
                            _ => {}
                        }
                    }
                }
                Item::Use(item_use) if module_public && public(&item_use.vis) => {
                    for path in flatten_use_tree(&item_use.tree) {
                        self.scan_reexport(source, module, item_use.span(), &path);
                        self.scan_local_reexport(
                            items,
                            source,
                            module,
                            module_dir,
                            attribute_dir,
                            &path,
                            &names,
                        )?;
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
                Item::ForeignMod(foreign_mod) if module_public => {
                    for member in &foreign_mod.items {
                        if !attrs_active(foreign_item_attrs(member), &self.active_features) {
                            continue;
                        }
                        if let syn::ForeignItem::Macro(item_macro) = member {
                            self.scan_generated_api(
                                &item_macro.mac,
                                None,
                                item_macro.span(),
                                &names,
                                source,
                                module,
                            )?;
                        }
                    }
                }
                Item::Impl(item_impl) if module_public => {
                    self.scan_impl(item_impl, &names, source, module, None)?;
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
                Item::Macro(item_macro) if module_public => {
                    self.scan_generated_api(
                        &item_macro.mac,
                        item_macro.ident.as_ref(),
                        item_macro.span(),
                        &names,
                        source,
                        module,
                    )?;
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
        let mut macro_definitions = Vec::new();
        for item in items {
            if !attrs_active(item_attrs(item), &self.active_features) {
                continue;
            }
            match item {
                Item::Use(item_use) => {
                    for path in flatten_use_tree(&item_use.tree) {
                        if path.segments.iter().any(|segment| segment == "rusqlite") {
                            if let Some(last) = path.segments.last() {
                                if matches!(last.as_str(), "Connection" | "Transaction") {
                                    names.sql_imports.insert(path.exposed.clone());
                                }
                            }
                        }
                        if path
                            .segments
                            .last()
                            .is_some_and(|segment| segment == "include")
                            && path
                                .segments
                                .iter()
                                .any(|segment| matches!(segment.as_str(), "std" | "core"))
                        {
                            names.include_macro_aliases.insert(path.exposed.clone());
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
                Item::Macro(item_macro) if item_macro.mac.path.is_ident("macro_rules") => {
                    macro_definitions.push(item_macro);
                    if token_ident_present(&item_macro.mac.tokens, "pub") {
                        if let Some(ident) = &item_macro.ident {
                            names.public_api_macros.insert(ident.to_string());
                        }
                    }
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
        // @ref LLP 0284#37-what-is-not-an-invariant-honest-limits — a
        // module-local macro_rules wrapper around include! is still a Rust
        // source include. Resolve direct, imported-alias, and wrapper-to-wrapper
        // spellings to a fixed point; literal parameter forwarding is handled
        // at invocation scan time, while synthesized/procedural expansion
        // remains an explicit LLP 0284 §3.7 limit.
        loop {
            let mut changed = false;
            let mut include_names = names.include_macro_aliases.clone();
            include_names.insert("include".to_owned());
            include_names.extend(names.generated_include_macros.iter().cloned());
            for definition in &macro_definitions {
                let Some(ident) = &definition.ident else {
                    continue;
                };
                if tokens_contain_any_ident(&definition.mac.tokens, &include_names)
                    && names.generated_include_macros.insert(ident.to_string())
                {
                    changed = true;
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
                true,
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
        exported_owner: Option<&str>,
    ) -> Result<(), String> {
        let self_type = inspect_type(&item_impl.self_ty, names);
        let self_name = last_type_name(&item_impl.self_ty).unwrap_or_else(|| "<impl>".to_owned());
        let owner = exported_owner
            .map(str::to_owned)
            .unwrap_or_else(|| self.item_name(module, &self_name));
        let mut impl_public = names.public_types.contains(&self_name)
            || SEED_TYPES.contains(&self_name.as_str())
            || self_name == "LocalDatabase";
        if let Some((_, trait_path, _)) = &item_impl.trait_ {
            let trait_name = trait_path
                .segments
                .last()
                .map(|segment| segment.ident.to_string())
                .unwrap_or_default();
            let trait_type = Type::Path(syn::TypePath {
                qself: None,
                path: trait_path.clone(),
            });
            let trait_info = inspect_type(&trait_type, names);
            // @ref LLP 0284#32-raw-sqlite — a conversion impl can expose a
            // foreign raw handle from either side (`Into<Connection>` or
            // `From<Local> for Connection`). Both positions make the impl part
            // of the dependent-visible egress surface.
            impl_public |= self_type.raw_handle.is_some()
                || trait_info.raw_handle.is_some()
                || self_type.seed_type.is_some()
                || trait_info.seed_type.is_some();
            if matches!(
                trait_name.as_str(),
                "From" | "Into" | "TryFrom" | "Deref" | "AsRef" | "AsMut"
            ) {
                if let Some(raw) = trait_info
                    .raw_handle
                    .as_ref()
                    .or(self_type.raw_handle.as_ref())
                {
                    self.push_finding(
                        "sql-egress",
                        format!("{owner}::{trait_name}"),
                        source,
                        item_impl.span(),
                        format!("public trait implementation exposes rusqlite::{raw}"),
                        None,
                    );
                }
            }
            if let Some(seed) = self_type.seed_type.clone() {
                if matches!(
                    trait_name.as_str(),
                    "Clone" | "Copy" | "Default" | "Deserialize"
                ) {
                    self.push_finding(
                        "seed-clone",
                        owner.clone(),
                        source,
                        item_impl.span(),
                        format!("{self_name} implements {trait_name}"),
                        Some(seed.clone()),
                    );
                }
            }
            if matches!(
                trait_name.as_str(),
                "From" | "Into" | "TryFrom" | "FromIterator"
            ) && let Some(seed) = self_type
                .seed_type
                .clone()
                .or_else(|| trait_info.seed_type.clone())
            {
                self.push_finding(
                    "seed-obtain",
                    owner.clone(),
                    source,
                    item_impl.span(),
                    format!("{self_name} implements public constructor trait {trait_name}"),
                    Some(seed),
                );
            }
            for member in &item_impl.items {
                if let ImplItem::Type(item_type) = member {
                    let info = inspect_type(&item_type.ty, names);
                    self.report_type_exposure(
                        &info,
                        source,
                        item_type.ident.span(),
                        &format!("{}::{trait_name}::{}", owner, item_type.ident),
                        "public trait implementation associated type",
                        false,
                        true,
                    );
                }
            }
        }
        if !impl_public {
            return Ok(());
        }
        let mut impl_module = module.to_vec();
        impl_module.push(self_name.clone());
        for member in &item_impl.items {
            if !attrs_active(impl_item_attrs(member), &self.active_features) {
                continue;
            }
            if let ImplItem::Fn(function) = member {
                self.record_discriminator_sink(
                    &function.sig,
                    Some(&self_name),
                    source,
                    &format!("{owner}::{}", function.sig.ident),
                    function.sig.ident.span(),
                );
            }
            match member {
                ImplItem::Fn(function) if public(&function.vis) || item_impl.trait_.is_some() => {
                    self.scan_signature(
                        &function.sig,
                        names,
                        source,
                        &format!("{owner}::{}", function.sig.ident),
                        function.sig.ident.span(),
                        Some(&self_name),
                    )
                }
                ImplItem::Const(item_const) if public(&item_const.vis) => {
                    let info = inspect_type(&item_const.ty, names);
                    self.report_type_exposure(
                        &info,
                        source,
                        item_const.ident.span(),
                        &format!("{owner}::{}", item_const.ident),
                        "public associated const",
                        false,
                        true,
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
                        true,
                    );
                }
                ImplItem::Macro(item_macro) => self.scan_generated_api(
                    &item_macro.mac,
                    None,
                    item_macro.span(),
                    names,
                    source,
                    &impl_module,
                )?,
                _ => {}
            }
        }
        Ok(())
    }

    fn scan_signature(
        &mut self,
        signature: &syn::Signature,
        names: &ModuleNames,
        source: &Path,
        item_name: &str,
        span: Span,
        receiver_type: Option<&str>,
    ) {
        let requires_receiver = signature
            .inputs
            .iter()
            .any(|argument| matches!(argument, FnArg::Receiver(_)));
        let requires_seed_input = signature.inputs.iter().any(|argument| {
            let FnArg::Typed(argument) = argument else {
                return false;
            };
            inspect_type(&argument.ty, names).seed_type.is_some()
        });
        if let ReturnType::Type(_, ty) = &signature.output {
            let info = inspect_type(ty, names);
            self.report_type_exposure(
                &info,
                source,
                span,
                item_name,
                "public return type",
                true,
                false,
            );
            let mut returned_types = info.type_names.clone();
            if returned_types.remove("Self") {
                if let Some(receiver) = receiver_type {
                    returned_types.insert(receiver.to_owned());
                }
            }
            self.obtainability_edges.push(ObtainabilityEdge {
                receiver_type: receiver_type.map(str::to_owned),
                requires_receiver,
                requires_seed_input,
                returned_types,
            });
            if let Some(seed_type) = &info.seed_type {
                self.seed_returns.push(SeedReturnCandidate {
                    seed_type: seed_type.clone(),
                    receiver_type: receiver_type.map(str::to_owned),
                    requires_receiver,
                    item: item_name.to_owned(),
                    file: source.to_path_buf(),
                    span,
                });
            }
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
        report_seed: bool,
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
        if report_seed && let Some(seed) = &info.seed_type {
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

    fn scan_reexport(&mut self, source: &Path, module: &[String], span: Span, path: &UseBinding) {
        if path.segments.is_empty() {
            return;
        }
        let rendered = path.segments.join("::");
        if path.segments.iter().any(|segment| segment == "rusqlite") {
            self.push_finding(
                "reexport",
                self.item_name(module, &path.exposed),
                source,
                span,
                format!("publicly re-exports {rendered}"),
                None,
            );
            return;
        }
        if let Some(seed) = path
            .segments
            .iter()
            .find(|segment| SEED_TYPES.contains(&segment.as_str()))
        {
            self.push_finding(
                "reexport",
                self.item_name(module, &path.exposed),
                source,
                span,
                format!("publicly re-exports privilege seed {rendered}"),
                Some(seed.clone()),
            );
            return;
        }
        let source_is_privilege_crate = path.segments.first().is_some_and(|first| {
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
                .segments
                .last()
                .is_some_and(|segment| segment == "storage" || segment == "LocalDatabase")
        {
            self.push_finding(
                "reexport",
                self.item_name(module, &path.exposed),
                source,
                span,
                format!("publicly re-exports privilege module/type {rendered}"),
                None,
            );
        }
    }

    fn record_constructible(&mut self, type_name: &str, item: &str, source: &Path, span: Span) {
        self.constructible_types.insert(type_name.to_owned());
        self.constructible_declarations
            .push(ConstructibleDeclaration {
                type_name: type_name.to_owned(),
                item: item.to_owned(),
                file: source.to_path_buf(),
                span,
            });
    }

    fn record_discriminator_sink(
        &mut self,
        signature: &syn::Signature,
        receiver_type: Option<&str>,
        source: &Path,
        item: &str,
        span: Span,
    ) {
        let sink_name = signature.ident.to_string();
        if !PRIVILEGE_SINKS.contains(&sink_name.as_str()) {
            return;
        }
        self.push_finding(
            "sink-registry-observed",
            item.to_owned(),
            source,
            span,
            format!("registered privilege sink {sink_name} resolves in the scanned corpus"),
            None,
        );
        let names = ModuleNames::default();
        let mut type_names = BTreeSet::new();
        for input in &signature.inputs {
            match input {
                FnArg::Receiver(_) => {
                    if let Some(receiver) = receiver_type {
                        type_names.insert(receiver.to_owned());
                    }
                }
                FnArg::Typed(argument) => {
                    type_names.extend(inspect_type(&argument.ty, &names).type_names);
                }
            }
        }
        type_names.retain(|type_name| {
            !NON_AUTHORITY_SINK_TYPES.contains(&(sink_name.as_str(), type_name.as_str()))
        });
        self.discriminator_sinks.push(DiscriminatorSinkCandidate {
            type_names,
            item: item.to_owned(),
            file: source.to_path_buf(),
            span,
        });
    }

    // @ref LLP 0284#37-what-is-not-an-invariant-honest-limits — generated
    // includes are a syntactic ratchet across every public item-expanding AST
    // position syn exposes, including literal parameter-forwarded include
    // identifiers; this is deliberately not a macro-expansion proof.
    fn scan_generated_api(
        &mut self,
        mac: &syn::Macro,
        definition_ident: Option<&syn::Ident>,
        span: Span,
        names: &ModuleNames,
        source: &Path,
        module: &[String],
    ) -> Result<(), String> {
        let macro_path = macro_path_label(&mac.path);
        let macro_name = mac
            .path
            .segments
            .last()
            .map(|segment| segment.ident.to_string())
            .unwrap_or_else(|| "<anonymous-macro>".to_owned());
        let is_direct_generated_include = macro_name == "include"
            || names.include_macro_aliases.contains(&macro_name)
            || names.generated_include_macros.contains(&macro_name);
        let parameterized_include = if is_direct_generated_include {
            None
        } else {
            parameterized_include_argument(&mac.tokens, names)
        };
        if is_direct_generated_include || parameterized_include.is_some() {
            let evaluated = if is_direct_generated_include {
                evaluate_include(&mac.tokens)
            } else {
                top_level_macro_arguments(&mac.tokens)
                    .iter()
                    .find_map(evaluate_include)
            };
            match evaluated {
                Some((value, true)) => {
                    self.push_finding(
                        "generated-api",
                        self.item_name(module, &format!("{value} via {macro_path}")),
                        source,
                        span,
                        if let Some(include_path) = &parameterized_include {
                            format!(
                                "public item-position macro receives literal {include_path} and build-generated Rust from OUT_DIR; exact review is required"
                            )
                        } else {
                            "public item position includes build-generated Rust from OUT_DIR; exact review is required".to_owned()
                        },
                        None,
                    );
                    if let Some(finding) = self.findings.last_mut() {
                        finding.generated_expression =
                            Some(format!("{macro_path}!({})", mac.tokens));
                    }
                }
                Some((value, false)) => {
                    let target = source.parent().unwrap_or(&self.crate_root).join(value);
                    if target.exists() {
                        self.scan_file(
                            &target,
                            module.to_vec(),
                            true,
                            target.parent().unwrap_or(&self.crate_root).to_path_buf(),
                        )?;
                    }
                }
                None => {
                    self.push_finding(
                        "generated-api",
                        self.item_name(module, &format!("{macro_path}!")),
                        source,
                        span,
                        "public item-position macro has an unevaluable direct, aliased, module-local wrapped, or literal parameter-forwarded Rust include; expansion is fail-closed".to_owned(),
                        None,
                    );
                    if let Some(finding) = self.findings.last_mut() {
                        finding.generated_expression =
                            Some(format!("{macro_path}!({})", mac.tokens));
                    }
                }
            }
            return Ok(());
        }

        let macro_name = definition_ident
            .map(ToString::to_string)
            .unwrap_or(macro_name);
        let emits_public =
            mac.path.is_ident("macro_rules") && token_ident_present(&mac.tokens, "pub");
        let invocation_of_public_macro = names.public_api_macros.contains(&macro_name);
        if (emits_public || invocation_of_public_macro)
            && tokens_name_sensitive_type(&mac.tokens, names)
        {
            self.push_finding(
                "macro-generated-api",
                self.item_name(module, &macro_name),
                source,
                span,
                "ordinary macro tokens can generate a public privilege-bearing API".to_owned(),
                None,
            );
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn scan_local_reexport(
        &mut self,
        items: &[Item],
        source: &Path,
        module: &[String],
        module_dir: &Path,
        attribute_dir: &Path,
        binding: &UseBinding,
        names: &ModuleNames,
    ) -> Result<(), String> {
        let segments = binding
            .segments
            .iter()
            .filter(|segment| segment.as_str() != "self")
            .cloned()
            .collect::<Vec<_>>();
        if segments.is_empty() || segments[0].contains('-') {
            return Ok(());
        }
        let exported_item = self.item_name(module, &binding.exposed);
        self.scan_local_reexport_segments(
            items,
            source,
            module,
            module_dir,
            attribute_dir,
            &segments,
            &exported_item,
            names,
            module,
        )
    }

    // @ref LLP 0284#41-kernel-raw-sql-api--privilege-surface-scanner — local
    // re-export chains include ordinary Rust `crate::` and `super::` paths;
    // resolve them from the crate root instead of treating them as foreign.
    #[allow(clippy::too_many_arguments)]
    fn scan_local_reexport_segments(
        &mut self,
        items: &[Item],
        source: &Path,
        module: &[String],
        module_dir: &Path,
        attribute_dir: &Path,
        segments: &[String],
        exported_item: &str,
        names: &ModuleNames,
        exported_module: &[String],
    ) -> Result<(), String> {
        if !self.reexport_visits.insert((
            source.to_path_buf(),
            module.join("::"),
            segments.join("::"),
            exported_item.to_owned(),
        )) {
            return Ok(());
        }
        let mut remaining = segments;
        let mut rooted_module = module.to_vec();
        let mut from_root = false;
        if remaining.first().is_some_and(|segment| segment == "crate") {
            rooted_module.clear();
            remaining = &remaining[1..];
            from_root = true;
        } else {
            while remaining.first().is_some_and(|segment| segment == "super") {
                if rooted_module.pop().is_none() {
                    return Ok(());
                }
                remaining = &remaining[1..];
                from_root = true;
            }
        }
        if remaining.is_empty() {
            return Ok(());
        }
        if !from_root {
            return self.scan_local_reexport_path(
                items,
                source,
                module,
                module_dir,
                attribute_dir,
                remaining,
                exported_item,
                names,
                exported_module,
            );
        }

        let mut rooted_segments = rooted_module;
        rooted_segments.extend_from_slice(remaining);
        let root_source = fs::canonicalize(&self.crate_lib).map_err(|error| {
            format!(
                "cannot resolve Rust library root {}: {error}",
                self.crate_lib.display()
            )
        })?;
        let root_text = fs::read_to_string(&root_source).map_err(|error| {
            format!(
                "cannot read Rust library root {}: {error}",
                root_source.display()
            )
        })?;
        let root_syntax = syn::parse_file(&root_text).map_err(|error| {
            format!(
                "cannot parse Rust library root {}: {error}",
                root_source.display()
            )
        })?;
        let root_dir = root_source
            .parent()
            .ok_or_else(|| format!("library root has no parent: {}", root_source.display()))?;
        let root_names = self.collect_names(&root_syntax.items);
        self.scan_local_reexport_path(
            &root_syntax.items,
            &root_source,
            &[],
            root_dir,
            root_dir,
            &rooted_segments,
            exported_item,
            &root_names,
            exported_module,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn scan_local_reexport_path(
        &mut self,
        items: &[Item],
        source: &Path,
        module: &[String],
        module_dir: &Path,
        attribute_dir: &Path,
        segments: &[String],
        exported_item: &str,
        names: &ModuleNames,
        exported_module: &[String],
    ) -> Result<(), String> {
        let Some((head, tail)) = segments.split_first() else {
            return Ok(());
        };
        if tail.is_empty() {
            if head == "*" {
                return self.scan_items(
                    items,
                    source,
                    exported_module,
                    true,
                    module_dir,
                    attribute_dir,
                );
            }
            for item in items {
                match item {
                    Item::Use(item_use) if public(&item_use.vis) => {
                        for nested in flatten_use_tree(&item_use.tree) {
                            if nested.exposed == *head {
                                self.scan_local_reexport_segments(
                                    items,
                                    source,
                                    module,
                                    module_dir,
                                    attribute_dir,
                                    &nested.segments,
                                    exported_item,
                                    names,
                                    exported_module,
                                )?;
                            }
                        }
                    }
                    _ if attrs_active(item_attrs(item), &self.active_features)
                        && item_ident(item).as_deref() == Some(head.as_str())
                        && public_item(item) =>
                    {
                        self.scan_named_reexport(
                            item,
                            items,
                            names,
                            source,
                            module,
                            exported_item,
                        )?;
                    }
                    _ => {}
                }
            }
            return Ok(());
        }

        let Some(item_mod) = items.iter().find_map(|item| match item {
            Item::Mod(item_mod) if item_mod.ident == head.as_str() => Some(item_mod),
            _ => None,
        }) else {
            return Ok(());
        };
        let mut child_module = module.to_vec();
        child_module.push(item_mod.ident.to_string());
        if let Some((_, child_items)) = &item_mod.content {
            let child_names = self.collect_names(child_items);
            return self.scan_local_reexport_path(
                child_items,
                source,
                &child_module,
                &module_dir.join(head),
                &attribute_dir.join(head),
                tail,
                exported_item,
                &child_names,
                exported_module,
            );
        }
        let explicit = path_attributes(&item_mod.attrs).into_iter().next();
        let target = if let Some(value) = explicit {
            attribute_dir.join(value)
        } else {
            let flat = module_dir.join(format!("{head}.rs"));
            let nested = module_dir.join(head).join("mod.rs");
            if flat.exists() { flat } else { nested }
        };
        if !target.exists() {
            return Ok(());
        }
        let child_source = fs::read_to_string(&target)
            .map_err(|error| format!("cannot read Rust source {}: {error}", target.display()))?;
        let syntax = syn::parse_file(&child_source)
            .map_err(|error| format!("cannot parse Rust source {}: {error}", target.display()))?;
        let child_names = self.collect_names(&syntax.items);
        let next_dir = module_directory_for_file(&target, module_dir, head);
        self.scan_local_reexport_path(
            &syntax.items,
            &target,
            &child_module,
            &next_dir,
            target.parent().unwrap_or(attribute_dir),
            tail,
            exported_item,
            &child_names,
            exported_module,
        )
    }

    fn scan_named_reexport(
        &mut self,
        item: &Item,
        sibling_items: &[Item],
        names: &ModuleNames,
        source: &Path,
        module: &[String],
        exported_item: &str,
    ) -> Result<(), String> {
        match item {
            Item::Fn(function) => self.scan_signature(
                &function.sig,
                names,
                source,
                exported_item,
                function.sig.ident.span(),
                None,
            ),
            Item::Struct(structure) => {
                if public_structure_constructor(&structure.fields) {
                    self.record_constructible(
                        &structure.ident.to_string(),
                        exported_item,
                        source,
                        structure.ident.span(),
                    );
                }
                self.scan_seed_derives(
                    &structure.ident.to_string(),
                    &structure.attrs,
                    source,
                    exported_item,
                    structure.ident.span(),
                );
                self.scan_fields(&structure.fields, names, source, exported_item, false);
                if structure.fields.iter().all(|field| !public(&field.vis)) {
                    self.private_public_types
                        .insert(structure.ident.to_string());
                }
            }
            Item::Enum(enumeration) => {
                self.record_constructible(
                    &enumeration.ident.to_string(),
                    exported_item,
                    source,
                    enumeration.ident.span(),
                );
                self.scan_seed_derives(
                    &enumeration.ident.to_string(),
                    &enumeration.attrs,
                    source,
                    exported_item,
                    enumeration.ident.span(),
                );
                for variant in &enumeration.variants {
                    self.scan_fields(
                        &variant.fields,
                        names,
                        source,
                        &format!("{exported_item}::{}", variant.ident),
                        true,
                    );
                }
            }
            Item::Union(item_union) => {
                if item_union
                    .fields
                    .named
                    .iter()
                    .all(|field| public(&field.vis))
                {
                    self.record_constructible(
                        &item_union.ident.to_string(),
                        exported_item,
                        source,
                        item_union.ident.span(),
                    );
                }
                self.scan_seed_derives(
                    &item_union.ident.to_string(),
                    &item_union.attrs,
                    source,
                    exported_item,
                    item_union.ident.span(),
                );
                self.scan_fields(
                    &Fields::Named(item_union.fields.clone()),
                    names,
                    source,
                    exported_item,
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
            Item::Type(alias) => {
                let info = inspect_type(&alias.ty, names);
                self.report_type_exposure(
                    &info,
                    source,
                    alias.ident.span(),
                    exported_item,
                    "publicly re-exported type alias",
                    false,
                    true,
                );
            }
            Item::Static(item_static) => {
                let info = inspect_type(&item_static.ty, names);
                self.report_type_exposure(
                    &info,
                    source,
                    item_static.ident.span(),
                    exported_item,
                    "publicly re-exported static",
                    false,
                    true,
                );
            }
            Item::Const(item_const) => {
                let info = inspect_type(&item_const.ty, names);
                self.report_type_exposure(
                    &info,
                    source,
                    item_const.ident.span(),
                    exported_item,
                    "publicly re-exported const",
                    false,
                    true,
                );
            }
            Item::Trait(item_trait) => {
                let mut trait_module = module.to_vec();
                trait_module.push(item_trait.ident.to_string());
                for member in &item_trait.items {
                    if !attrs_active(trait_item_attrs(member), &self.active_features) {
                        continue;
                    }
                    match member {
                        syn::TraitItem::Fn(function) => self.scan_signature(
                            &function.sig,
                            names,
                            source,
                            &format!("{exported_item}::{}", function.sig.ident),
                            function.sig.ident.span(),
                            None,
                        ),
                        syn::TraitItem::Type(item_type) => {
                            if let Some((_, ty)) = &item_type.default {
                                let info = inspect_type(ty, names);
                                self.report_type_exposure(
                                    &info,
                                    source,
                                    item_type.ident.span(),
                                    &format!("{exported_item}::{}", item_type.ident),
                                    "publicly re-exported trait associated type",
                                    false,
                                    true,
                                );
                            }
                        }
                        syn::TraitItem::Const(item_const) => {
                            let info = inspect_type(&item_const.ty, names);
                            self.report_type_exposure(
                                &info,
                                source,
                                item_const.ident.span(),
                                &format!("{exported_item}::{}", item_const.ident),
                                "publicly re-exported trait associated const",
                                false,
                                true,
                            );
                        }
                        syn::TraitItem::Macro(item_macro) => self.scan_generated_api(
                            &item_macro.mac,
                            None,
                            item_macro.span(),
                            names,
                            source,
                            &trait_module,
                        )?,
                        _ => {}
                    }
                }
            }
            _ => {}
        }

        let Some(reexported_type) = item_ident(item) else {
            return Ok(());
        };
        for sibling in sibling_items {
            let Item::Impl(item_impl) = sibling else {
                continue;
            };
            if attrs_active(&item_impl.attrs, &self.active_features)
                && last_type_name(&item_impl.self_ty).as_deref() == Some(reexported_type.as_str())
            {
                self.scan_impl(item_impl, names, source, module, Some(exported_item))?;
            }
        }
        Ok(())
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
            generated_expression: None,
        });
    }
}

fn public_structure_constructor(fields: &Fields) -> bool {
    match fields {
        Fields::Unit => true,
        Fields::Named(fields) => fields.named.iter().all(|field| public(&field.vis)),
        Fields::Unnamed(fields) => fields.unnamed.iter().all(|field| public(&field.vis)),
    }
}

fn token_ident_present(tokens: &TokenStream, sought: &str) -> bool {
    tokens.clone().into_iter().any(|token| match token {
        proc_macro2::TokenTree::Ident(ident) => ident == sought,
        proc_macro2::TokenTree::Group(group) => token_ident_present(&group.stream(), sought),
        _ => false,
    })
}

fn tokens_contain_any_ident(tokens: &TokenStream, sought: &BTreeSet<String>) -> bool {
    tokens.clone().into_iter().any(|token| match token {
        proc_macro2::TokenTree::Ident(ident) => sought.contains(&ident.to_string()),
        proc_macro2::TokenTree::Group(group) => tokens_contain_any_ident(&group.stream(), sought),
        _ => false,
    })
}

fn top_level_macro_arguments(tokens: &TokenStream) -> Vec<TokenStream> {
    let mut arguments = vec![TokenStream::new()];
    for token in tokens.clone() {
        if matches!(&token, proc_macro2::TokenTree::Punct(punct) if punct.as_char() == ',') {
            arguments.push(TokenStream::new());
        } else if let Some(argument) = arguments.last_mut() {
            argument.extend([token]);
        }
    }
    arguments
}

fn parameterized_include_argument(tokens: &TokenStream, names: &ModuleNames) -> Option<String> {
    top_level_macro_arguments(tokens)
        .into_iter()
        .filter_map(|argument| syn::parse2::<syn::Path>(argument).ok())
        .find_map(|path| {
            let name = path.segments.last()?.ident.to_string();
            (name == "include"
                || names.include_macro_aliases.contains(&name)
                || names.generated_include_macros.contains(&name))
            .then(|| macro_path_label(&path))
        })
}

fn macro_path_label(path: &syn::Path) -> String {
    let prefix = if path.leading_colon.is_some() {
        "::"
    } else {
        ""
    };
    format!(
        "{prefix}{}",
        path.segments
            .iter()
            .map(|segment| segment.ident.to_string())
            .collect::<Vec<_>>()
            .join("::")
    )
}

fn tokens_name_sensitive_type(tokens: &TokenStream, names: &ModuleNames) -> bool {
    tokens.clone().into_iter().any(|token| match token {
        proc_macro2::TokenTree::Ident(ident) => {
            let ident = ident.to_string();
            matches!(ident.as_str(), "Connection" | "Transaction" | "rusqlite")
                || SEED_TYPES.contains(&ident.as_str())
                || names.raw_aliases.contains(&ident)
                || names.sql_imports.contains(&ident)
                || names.seed_aliases.contains_key(&ident)
        }
        proc_macro2::TokenTree::Group(group) => tokens_name_sensitive_type(&group.stream(), names),
        _ => false,
    })
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
                if self.names.sql_imports.contains(segment) {
                    self.info
                        .raw_handle
                        .get_or_insert_with(|| format!("import alias {segment}"));
                } else if matches!(segment.as_str(), "Connection" | "Transaction")
                    && (has_rusqlite || segments.len() == 1)
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

fn item_ident(item: &Item) -> Option<String> {
    match item {
        Item::Const(item) => Some(item.ident.to_string()),
        Item::Enum(item) => Some(item.ident.to_string()),
        Item::Fn(item) => Some(item.sig.ident.to_string()),
        Item::Static(item) => Some(item.ident.to_string()),
        Item::Struct(item) => Some(item.ident.to_string()),
        Item::Trait(item) => Some(item.ident.to_string()),
        Item::Type(item) => Some(item.ident.to_string()),
        Item::Union(item) => Some(item.ident.to_string()),
        _ => None,
    }
}

fn public_item(item: &Item) -> bool {
    match item {
        Item::Const(item) => public(&item.vis),
        Item::Enum(item) => public(&item.vis),
        Item::Fn(item) => public(&item.vis),
        Item::Static(item) => public(&item.vis),
        Item::Struct(item) => public(&item.vis),
        Item::Trait(item) => public(&item.vis),
        Item::Type(item) => public(&item.vis),
        Item::Union(item) => public(&item.vis),
        _ => false,
    }
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

#[derive(Clone)]
struct UseBinding {
    segments: Vec<String>,
    exposed: String,
}

fn flatten_use_tree(tree: &UseTree) -> Vec<UseBinding> {
    fn walk(tree: &UseTree, prefix: Vec<String>, output: &mut Vec<UseBinding>) {
        match tree {
            UseTree::Path(path) => {
                let mut next = prefix;
                next.push(path.ident.to_string());
                walk(&path.tree, next, output);
            }
            UseTree::Name(name) => {
                let mut next = prefix;
                next.push(name.ident.to_string());
                output.push(UseBinding {
                    segments: next,
                    exposed: name.ident.to_string(),
                });
            }
            UseTree::Rename(rename) => {
                let mut next = prefix;
                next.push(rename.ident.to_string());
                output.push(UseBinding {
                    segments: next,
                    exposed: rename.rename.to_string(),
                });
            }
            UseTree::Glob(_) => {
                let mut next = prefix;
                next.push("*".to_owned());
                output.push(UseBinding {
                    segments: next,
                    exposed: "*".to_owned(),
                });
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
    // @ref LLP 0284#44-caller-feature-predicate-coverage — cfg(test) stays
    // private to owner tests; caller feature atoms are symbolic in the
    // conservative coverage cell.
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
        // Security coverage is platform-symbolic: both `unix`/`windows` and
        // their negations remain visible instead of inheriting the scanner
        // host's target. Like symbolic caller features, contradictory target
        // formulas are retained conservatively.
        Meta::Path(path) if path.is_ident("unix") || path.is_ident("windows") => Truth::Unknown,
        Meta::Path(_) => Truth::Unknown,
        Meta::NameValue(value) if value.path.is_ident("feature") => match &value.value {
            Expr::Lit(ExprLit {
                lit: Lit::Str(feature),
                ..
            }) => {
                if features.contains(SYMBOLIC_CALLER_FEATURES) {
                    Truth::Unknown
                } else if features.contains(&feature.value()) {
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
    // — cfg_attr paths are ownership-relevant at every nesting depth, even
    // when an enclosing predicate is false.
    fn collect(meta: &Meta, values: &mut Vec<String>) {
        match meta {
            Meta::NameValue(value) if value.path.is_ident("path") => {
                if let Expr::Lit(ExprLit {
                    lit: Lit::Str(path),
                    ..
                }) = &value.value
                {
                    values.push(path.value());
                }
            }
            Meta::List(list) if list.path.is_ident("cfg_attr") => {
                let nested = Punctuated::<Meta, Token![,]>::parse_terminated
                    .parse2(list.tokens.clone())
                    .unwrap_or_default();
                for child in nested.iter().skip(1) {
                    collect(child, values);
                }
            }
            _ => {}
        }
    }

    let mut values = Vec::new();
    for attribute in attrs {
        collect(&attribute.meta, &mut values);
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

fn trait_item_attrs(item: &syn::TraitItem) -> &[Attribute] {
    match item {
        syn::TraitItem::Const(item) => &item.attrs,
        syn::TraitItem::Fn(item) => &item.attrs,
        syn::TraitItem::Type(item) => &item.attrs,
        syn::TraitItem::Macro(item) => &item.attrs,
        _ => &[],
    }
}

fn foreign_item_attrs(item: &syn::ForeignItem) -> &[Attribute] {
    match item {
        syn::ForeignItem::Fn(item) => &item.attrs,
        syn::ForeignItem::Static(item) => &item.attrs,
        syn::ForeignItem::Type(item) => &item.attrs,
        syn::ForeignItem::Macro(item) => &item.attrs,
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

// @ref LLP 0284#36-inventory-honesty — an attack's parsed source must name the
// dependency crate it claims to mount; the free-form mount field is not proof.
fn source_crate_references(path: &Path) -> Result<Vec<String>, String> {
    struct CrateReferenceVisitor {
        references: BTreeSet<String>,
    }
    impl<'ast> Visit<'ast> for CrateReferenceVisitor {
        fn visit_path(&mut self, node: &'ast syn::Path) {
            if let Some(first) = node.segments.first() {
                self.references.insert(first.ident.to_string());
            }
            visit::visit_path(self, node);
        }

        fn visit_item_use(&mut self, node: &'ast syn::ItemUse) {
            for binding in flatten_use_tree(&node.tree) {
                if let Some(first) = binding.segments.first() {
                    self.references.insert(first.clone());
                }
            }
            visit::visit_item_use(self, node);
        }
    }

    let source = fs::read_to_string(path)
        .map_err(|error| format!("cannot read Rust source {}: {error}", path.display()))?;
    let syntax = syn::parse_file(&source)
        .map_err(|error| format!("cannot parse Rust source {}: {error}", path.display()))?;
    let mut visitor = CrateReferenceVisitor {
        references: BTreeSet::new(),
    };
    visitor.visit_file(&syntax);
    Ok(visitor.references.into_iter().collect())
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
                crate_lib: lib.clone(),
                active_features: features,
                findings: Vec::new(),
                visited: HashSet::new(),
                reexport_visits: HashSet::new(),
                private_public_types: BTreeSet::new(),
                heuristic_returns: Vec::new(),
                heuristic_accepts: BTreeSet::new(),
                constructible_types: BTreeSet::new(),
                constructible_declarations: Vec::new(),
                obtainability_edges: Vec::new(),
                seed_returns: Vec::new(),
                discriminator_sinks: Vec::new(),
            }
            .scan(&lib)?;
            println!(
                "{}",
                serde_json::to_string(&findings)
                    .map_err(|error| format!("cannot serialize privilege findings: {error}"))?
            );
        }
        "privilege-sinks" => {
            println!(
                "{}",
                serde_json::to_string(PRIVILEGE_SINKS)
                    .map_err(|error| format!("cannot serialize privilege sinks: {error}"))?
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
        "crate-references" => {
            let path = PathBuf::from(required_arg(&args, "--file")?);
            println!(
                "{}",
                serde_json::to_string(&source_crate_references(&path)?)
                    .map_err(|error| format!("cannot serialize crate references: {error}"))?
            );
        }
        _ => {
            return Err(
                "usage: security-gates-rust <privilege|privilege-sinks|units|attack-span|crate-references> ..."
                    .to_owned(),
            );
        }
    }
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("SNAPBACK_SECURITY_GATE_AST: {error}");
        std::process::exit(2);
    }
}
