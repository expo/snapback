//! Mounted Exact apps carry their actual wasm engine stamp, not the npm pin.
// @ref LLP 3000.001.000#build-stamp — inspect the bytes mounted by app.json.
use snapback4_core::{
    Schema,
    device_protocol::{self, DeviceEngine},
};
use std::{
    fs,
    path::{Path, PathBuf},
};
fn leb(bytes: &[u8], at: &mut usize) -> Option<usize> {
    let mut n = 0usize;
    for shift in (0..35).step_by(7) {
        let b = *bytes.get(*at)?;
        *at += 1;
        n |= ((b & 127) as usize) << shift;
        if b & 128 == 0 {
            return Some(n);
        }
    }
    None
}
pub fn stamp(bytes: &[u8]) -> Option<DeviceEngine> {
    if bytes.get(..8)? != b"\0asm\x01\0\0\0" {
        return None;
    }
    let mut at = 8;
    let mut found = None;
    while at < bytes.len() {
        let kind = bytes[at];
        at += 1;
        let size = leb(bytes, &mut at)?;
        let end = at.checked_add(size)?;
        let section = bytes.get(at..end)?;
        if kind == 0 {
            let mut pos = 0;
            let len = leb(section, &mut pos)?;
            let name = section.get(pos..pos.checked_add(len)?)?;
            pos += len;
            if name == b"snapback4.engine" {
                if found.is_some() {
                    return None;
                }
                let engine: DeviceEngine = serde_json::from_slice(&section[pos..]).ok()?;
                // The crate emits canonical JSON. Reject alternate lexical forms
                // (duplicates, floats, unknown fields, lossy UTF-8) on every preflight.
                if serde_json::to_vec(&engine).ok()? != section[pos..] {
                    return None;
                }
                found = Some(engine);
            }
        }
        at = end;
    }
    found
}
fn apps(root: &Path) -> Vec<PathBuf> {
    let mut roots = vec![root.to_owned()];
    if let Ok(entries) = fs::read_dir(root) {
        roots.extend(
            entries
                .flatten()
                .filter(|e| {
                    e.file_type().is_ok_and(|t| t.is_dir())
                        && e.file_name() != "node_modules"
                        && !e.file_name().to_string_lossy().starts_with('.')
                })
                .map(|e| e.path()),
        );
    }
    roots
}
// @ref LLP 3000.001.000#build-stamp — parse runtime declarations, excluding erased types.
fn literals(source: &str, path: &Path) -> Vec<String> {
    source_literals(source, path, false)
}
fn imports(source: &str, path: &Path) -> Vec<String> {
    source_literals(source, path, true)
}
fn source_literals(source: &str, path: &Path, imports_only: bool) -> Vec<String> {
    use oxc_ast::ast::{
        AccessorProperty, AccessorPropertyType, Declaration, ExportAllDeclaration,
        ExportFromDeclaration, Expression, ImportDeclaration, ImportDeclarationSpecifier,
        ImportExpression, ImportOrExportKind, MethodDefinition, MethodDefinitionType,
        PropertyDefinition, PropertyDefinitionType, TSImportEqualsDeclaration,
        TSInterfaceDeclaration, TSModuleReference, TSType,
    };
    use oxc_ast_visit::{Visit, walk};
    struct Declarations {
        imports_only: bool,
        paths: Vec<String>,
    }
    impl<'a> Visit<'a> for Declarations {
        fn visit_expression(&mut self, expression: &Expression<'a>) {
            if !self.imports_only {
                match expression {
                    Expression::StringLiteral(s) => self.paths.push(s.value.to_string()),
                    Expression::TemplateLiteral(t) if t.expressions.is_empty() => {
                        if let Some(q) = t.quasis.first() {
                            if !q.lone_surrogates {
                                if let Some(value) = &q.value.cooked {
                                    self.paths.push(value.to_string());
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }
            walk::walk_expression(self, expression);
        }
        fn visit_declaration(&mut self, declaration: &Declaration<'a>) {
            if declaration.declare()
                || declaration.is_type()
                || matches!(
                    declaration,
                    Declaration::TSExternalModuleDeclaration(_)
                        | Declaration::TSGlobalDeclaration(_)
                )
            {
                return;
            }
            walk::walk_declaration(self, declaration);
        }
        fn visit_ts_interface_declaration(&mut self, _: &TSInterfaceDeclaration<'a>) {}
        fn visit_ts_import_equals_declaration(&mut self, import: &TSImportEqualsDeclaration<'a>) {
            if import.import_kind == ImportOrExportKind::Value {
                if let TSModuleReference::ExternalModuleReference(source) = &import.module_reference
                {
                    self.paths.push(source.expression.value.to_string());
                }
            }
        }
        fn visit_property_definition(&mut self, property: &PropertyDefinition<'a>) {
            if !property.declare
                && property.r#type != PropertyDefinitionType::TSAbstractPropertyDefinition
            {
                walk::walk_property_definition(self, property);
            }
        }
        fn visit_accessor_property(&mut self, property: &AccessorProperty<'a>) {
            if property.r#type != AccessorPropertyType::TSAbstractAccessorProperty {
                walk::walk_accessor_property(self, property);
            }
        }
        fn visit_method_definition(&mut self, method: &MethodDefinition<'a>) {
            if method.r#type != MethodDefinitionType::TSAbstractMethodDefinition
                && method.value.body.is_some()
            {
                walk::walk_method_definition(self, method);
            }
        }

        fn visit_import_expression(&mut self, import: &ImportExpression<'a>) {
            match &import.source {
                Expression::StringLiteral(source) => self.paths.push(source.value.to_string()),
                Expression::TemplateLiteral(t) if t.expressions.is_empty() => {
                    if let Some(q) = t.quasis.first() {
                        if !q.lone_surrogates {
                            if let Some(value) = &q.value.cooked {
                                self.paths.push(value.to_string());
                            }
                        }
                    }
                }
                _ => {}
            }
            walk::walk_import_expression(self, import);
        }
        fn visit_ts_type(&mut self, _: &TSType<'a>) {} // erased type literals/import queries
        fn visit_import_declaration(&mut self, import: &ImportDeclaration<'a>) {
            if import.import_kind == ImportOrExportKind::Type {
                return;
            }
            let value_import = import.specifiers.as_ref().is_none_or(|specifiers| {
                specifiers.is_empty()
                    || specifiers.iter().any(|specifier| match specifier {
                        ImportDeclarationSpecifier::ImportSpecifier(s) => {
                            s.import_kind == ImportOrExportKind::Value
                        }
                        _ => true,
                    })
            });
            if value_import {
                self.paths.push(import.source.value.to_string());
            }
        }
        fn visit_export_from_declaration(&mut self, export: &ExportFromDeclaration<'a>) {
            if export.export_kind == ImportOrExportKind::Value
                && (export.specifiers.is_empty()
                    || export
                        .specifiers
                        .iter()
                        .any(|s| s.export_kind == ImportOrExportKind::Value))
            {
                self.paths.push(export.source.value.to_string());
            }
        }
        fn visit_export_all_declaration(&mut self, export: &ExportAllDeclaration<'a>) {
            if export.export_kind == ImportOrExportKind::Value {
                self.paths.push(export.source.value.to_string());
            }
        }
    }
    let allocator = oxc_allocator::Allocator::default();
    let source_type =
        oxc_span::SourceType::from_path(path).unwrap_or_else(|_| oxc_span::SourceType::ts());
    if source_type.is_typescript_definition() {
        return Vec::new();
    }
    let parsed = oxc_parser::Parser::new(&allocator, source, source_type).parse();
    if !parsed.diagnostics.is_empty() {
        return Vec::new();
    }
    let mut declarations = Declarations {
        imports_only,
        paths: Vec::new(),
    };
    declarations.visit_program(&parsed.program);
    declarations.paths
}
fn declared_path(base: &Path, app: &Path, declaration: &str) -> PathBuf {
    let (base, name) = if let Some(asset) = declaration.strip_prefix("/assets/") {
        (app.join("assets"), asset)
    } else {
        let direct = base.join(declaration);
        // Relative declarations may be file paths or browser URLs. Preserve a
        // real literal filename first, otherwise resolve URL suffixes/escapes.
        if direct.exists() || declaration.contains("://") {
            return direct;
        }
        (base.to_owned(), declaration)
    };
    let name = name.split(['?', '#']).next().unwrap_or(name);
    let mut bytes = Vec::new();
    let mut input = name.as_bytes().iter().copied();
    while let Some(c) = input.next() {
        if c == b'%' {
            let pair = [input.next().unwrap_or(0), input.next().unwrap_or(0)];
            if let Some(n) = std::str::from_utf8(&pair)
                .ok()
                .and_then(|s| u8::from_str_radix(s, 16).ok())
            {
                bytes.push(n);
            } else {
                bytes.extend([c, pair[0], pair[1]]);
            }
        } else {
            bytes.push(c);
        }
    }
    base.join(String::from_utf8(bytes).unwrap_or_else(|_| name.to_owned()))
}
fn config_literals(value: &serde_json::Value, out: &mut Vec<String>) {
    match value {
        serde_json::Value::String(s) => out.push(s.clone()),
        serde_json::Value::Array(values) => {
            for v in values {
                config_literals(v, out);
            }
        }
        serde_json::Value::Object(values) => {
            for v in values.values() {
                config_literals(v, out);
            }
        }
        _ => {}
    }
}
fn device_artifacts(app: &Path, config: &serde_json::Value) -> Vec<PathBuf> {
    let mut artifacts = Vec::new();
    let mut declared = Vec::new();
    config_literals(config, &mut declared);
    let mut candidates: Vec<PathBuf> = declared
        .into_iter()
        .map(|path| declared_path(app, app, &path))
        .collect();
    let mut sources = vec![app.join("app.ts")];
    if let Some(mounts) = config
        .pointer("/typescript/sources")
        .and_then(serde_json::Value::as_object)
    {
        for mount in mounts.values().filter_map(serde_json::Value::as_str) {
            // Exact writes this explicit adapter declaration. The online sibling
            // is deliberately absent; a backend mount says nothing about a device.
            let path = Path::new(mount);
            if path.ends_with("snapback4/ts") {
                artifacts.push(app.join("assets/snapback4.wasm"));
            }
            let path = app.join(path);
            let entry = if path.is_dir() {
                path.join("snapback.ts")
            } else {
                path
            };
            if let Ok(source) = fs::read_to_string(&entry) {
                // A relocated adapter retains its web-device import even when
                // the mount's name/path changes. Inspect declarations, not comments.
                if imports(&source, &entry).iter().any(|s| s == "./web.ts")
                    && fs::read_to_string(entry.with_file_name("web.ts")).is_ok_and(|web| {
                        imports(&web, &entry.with_file_name("web.ts"))
                            .iter()
                            .any(|s| s == "./generated/device.ts")
                    })
                {
                    artifacts.push(app.join("assets/snapback4.wasm"));
                }
            }
            sources.push(entry);
        }
    }
    for source in sources {
        if let Ok(text) = fs::read_to_string(&source) {
            // App URLs beginning /assets/ are served from the app directory;
            // relative declarations resolve beside their declaring source file.
            for literal in literals(&text, &source) {
                let path = declared_path(source.parent().unwrap_or(app), app, &literal);
                candidates.push(path);
            }
        }
    }
    for path in candidates {
        if fs::read(&path).is_ok_and(|bytes| has_engine_section(&bytes)) {
            artifacts.push(path);
        }
    }
    artifacts.sort();
    artifacts.dedup();
    artifacts
}
// Identify even a malformed identity payload as a device, then let stamp/check
// refuse it. Unrelated wasm and diagnostic sidecars never establish consumption.
fn has_engine_section(bytes: &[u8]) -> bool {
    if bytes.get(..8) != Some(b"\0asm\x01\0\0\0") {
        return false;
    }
    let mut at = 8;
    while let Some(&kind) = bytes.get(at) {
        at += 1;
        let Some(size) = leb(bytes, &mut at) else {
            return false;
        };
        let Some(end) = at.checked_add(size) else {
            return false;
        };
        let Some(section) = bytes.get(at..end) else {
            return false;
        };
        if kind == 0 {
            let mut pos = 0;
            if let Some(len) = leb(section, &mut pos) {
                if pos.checked_add(len).and_then(|end| section.get(pos..end))
                    == Some(b"snapback4.engine")
                {
                    return true;
                }
            }
        }
        at = end;
    }
    false
}
pub fn inspect(root: &Path, schema: &Schema) -> Vec<Result<String, String>> {
    let required = device_protocol::compatibility(&schema.public_projection());
    apps(root)
        .into_iter()
        .flat_map(|app| {
            let inspect = || -> Option<Vec<Result<String, String>>> {
                let config: serde_json::Value =
                    serde_json::from_slice(&fs::read(app.join("app.json")).ok()?).ok()?;
                let mount = config
                    .pointer("/typescript/sources/backend")
                    .and_then(serde_json::Value::as_str)?;
                let resolve = |path: PathBuf| {
                    path.canonicalize().ok().or_else(|| {
                        Some(path.parent()?.canonicalize().ok()?.join(path.file_name()?))
                    })
                };
                let mounted = resolve(app.join(mount))?;
                if mounted != resolve(root.join("snapback/generated"))? {
                    return None;
                }
                Some(
                    device_artifacts(&app, &config)
                        .into_iter()
                        .map(|wasm| {
                            let bytes = fs::read(&wasm).map_err(|error| {
                                let state = if error.kind() == std::io::ErrorKind::NotFound { "missing".to_owned() } else { format!("unreadable ({error})") };
                                format!("E_DEVICE_VERSION: device engine file is {state} [{}]; build it from the Exact app directory with `bun exact.mjs snapback --rebuild` before running check", wasm.display())
                            })?;
                            let device = stamp(&bytes);
                            device_protocol::check(device.as_ref(), &required)
                                .map(|_| {
                                    format!(
                                        "device    {} engine {} compatible (server {}, floor {})",
                                        wasm.display(),
                                        device.as_ref().unwrap().version,
                                        required.server_version,
                                        required.minimum_version
                                    )
                                })
                                .map_err(|why| {
                                    format!("{}: {} [{}]", why.code, why.message, wasm.display())
                                })
                        })
                        .collect(),
                )
            };
            inspect().unwrap_or_default()
        })
        .collect()
}
pub fn check(root: &Path, schema: &Schema, json: bool) -> bool {
    for result in inspect(root, schema) {
        if let Err(error) = result {
            if json {
                println!(
                    "{}",
                    serde_json::json!({ "ok": false, "denied": { "code": "E_DEVICE_VERSION", "message": error } })
                );
            } else {
                eprintln!("{error}");
            }
            return false;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unstamped_corrupt_and_duplicate_stamps_are_unknown() {
        assert!(stamp(b"not wasm").is_none());
        assert!(stamp(b"\0asm\x01\0\0\0").is_none());
        assert!(stamp(b"\0asm\x01\0\0\0\0\x80").is_none());
        let wrap = |text: &[u8]| {
            let mut bytes = b"\0asm\x01\0\0\0\0".to_vec();
            let name = b"snapback4.engine";
            let size = text.len() + name.len() + 1;
            assert!(size < 128);
            bytes.push(size as u8);
            bytes.push(name.len() as u8);
            bytes.extend(name);
            bytes.extend(text);
            bytes
        };
        let good = br#"{"format":1,"version":"0.4.25","capabilities":[]}"#;
        assert!(stamp(&wrap(good)).is_some());
        for bad in [
            br#"{"format":0,"format":1,"version":"0.4.25","capabilities":[]}"#.as_slice(),
            br#"{"format":1.0,"version":"0.4.25","capabilities":[]}"#.as_slice(),
            br#"{"format":1,"version":"0.4.25","capabilities":[],"extra":1}"#.as_slice(),
        ] {
            assert!(stamp(&wrap(bad)).is_none());
        }
        let mut bom = vec![0xef, 0xbb, 0xbf];
        bom.extend_from_slice(good);
        assert!(stamp(&wrap(&bom)).is_none());
        let mut invalid = good.to_vec();
        invalid[23] = 0xff;
        assert!(stamp(&wrap(&invalid)).is_none());
        let once = wrap(good);
        let mut twice = once.clone();
        twice.extend_from_slice(&once[8..]);
        assert!(stamp(&twice).is_none());
    }
}
