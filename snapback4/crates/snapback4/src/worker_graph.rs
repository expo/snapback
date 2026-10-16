//! Low-level worker capture needs Node, without imposing a TypeScript toolchain.
// @ref LLP 3000.000.000.000.000#7 — capture the runtime closure while keeping the Node-only worker toolchain.
use crate::project::Project;
use std::{collections::{BTreeMap, BTreeSet}, path::{Path, PathBuf}, process::{Command, Stdio}, io::Read, time::{Duration, Instant}};
use oxc_ast::ast::{Argument, CallExpression, ExportAllDeclaration, ExportFromDeclaration, Expression, ImportDeclaration, ImportExpression, ImportOrExportKind, TSType};
use oxc_ast_visit::{Visit, walk};

fn imports(source: &str, path: &Path) -> Result<Vec<(String, &'static str)>, String> {
    struct Imports(Vec<(String, &'static str)>);
    impl<'a> Visit<'a> for Imports {
        fn visit_ts_type(&mut self, _: &TSType<'a>) {}
        fn visit_import_declaration(&mut self, node: &ImportDeclaration<'a>) {
            if node.import_kind != ImportOrExportKind::Type { self.0.push((node.source.value.to_string(), "import")); }
        }
        fn visit_export_from_declaration(&mut self, node: &ExportFromDeclaration<'a>) {
            if node.export_kind != ImportOrExportKind::Type { self.0.push((node.source.value.to_string(), "import")); }
        }
        fn visit_export_all_declaration(&mut self, node: &ExportAllDeclaration<'a>) {
            if node.export_kind != ImportOrExportKind::Type { self.0.push((node.source.value.to_string(), "import")); }
        }
        fn visit_import_expression(&mut self, node: &ImportExpression<'a>) {
            match &node.source {
                Expression::StringLiteral(value) => self.0.push((value.value.to_string(), "import")),
                Expression::TemplateLiteral(value) if value.expressions.is_empty() => { if let Some(text)=value.quasis.first().and_then(|part|part.value.cooked.as_ref()) {self.0.push((text.to_string(), "import"));} }
                _=>{}
            }
            walk::walk_import_expression(self, node);
        }
        fn visit_call_expression(&mut self, node: &CallExpression<'a>) {
            if matches!(&node.callee, Expression::Identifier(name) if name.name == "require") {
                match node.arguments.first() {
                    Some(Argument::StringLiteral(value)) => self.0.push((value.value.to_string(), "require")),
                    Some(Argument::TemplateLiteral(value)) if value.expressions.is_empty() => {if let Some(text)=value.quasis.first().and_then(|part|part.value.cooked.as_ref()){self.0.push((text.to_string(), "require"));}}
                    _=>{}
                }
            }
            walk::walk_call_expression(self, node);
        }
    }
    let allocator = oxc_allocator::Allocator::default();
    let kind = oxc_span::SourceType::from_path(path).unwrap_or_else(|_| oxc_span::SourceType::mjs());
    if kind.is_typescript_definition() { return Ok(Vec::new()); }
    let parsed = oxc_parser::Parser::new(&allocator, source, kind).parse();
    if !parsed.diagnostics.is_empty() { return Err(format!("E_SERVER_TYPECHECK: worker {} has invalid JavaScript/TypeScript syntax: {:?}", path.display(), parsed.diagnostics)); }
    let mut imports = Imports(Vec::new()); imports.visit_program(&parsed.program); Ok(imports.0)
}

pub(crate) fn check(project: &Project, entry: &Path) -> Result<(), String> {
    type State = Option<(String, String)>;
    let root = project.root.canonicalize().map_err(|e| e.to_string())?;
    let mut graph = BTreeMap::<PathBuf, State>::new();
    let mut pending = vec![entry.to_owned()]; let mut seen = BTreeSet::new();
    let deadline = Instant::now() + Duration::from_secs(30);
    while let Some(path) = pending.pop() {
        let path = path.canonicalize().map_err(|e| format!("E_SERVER_TYPECHECK: worker source: {e}"))?;
        if !seen.insert(path.clone()) { continue; }
        let metadata = std::fs::metadata(&path).map_err(|e| e.to_string())?;
        graph.insert(path.clone(), Some((metadata.modified().ok().and_then(|at| at.duration_since(std::time::UNIX_EPOCH).ok()).map(|at|at.as_nanos()).unwrap_or(0).to_string(), metadata.len().to_string())));
        if !path.extension().is_some_and(|ext| matches!(ext.to_str(), Some("js"|"mjs"|"cjs"|"ts"|"mts"|"cts"))) { continue; }
        let source = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let imports = imports(&source, &path)?;
        let mut child = Command::new(crate::project::node()).args(["--experimental-import-meta-resolve", "--input-type=module", "-e", include_str!("worker_graph.mjs")])
            .arg(&root).arg(&path).args(imports.iter().map(|item|serde_json::to_string(item).unwrap())).env_remove("NODE_OPTIONS").env_remove("NODE_PATH")
            .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e|format!("E_SERVER_TOOLCHAIN: worker capture needs Node 24: {e}"))?;
        fn drain(mut pipe: impl Read + Send + 'static) -> std::thread::JoinHandle<Vec<u8>> { std::thread::spawn(move || { let mut bytes=Vec::new();let _=pipe.read_to_end(&mut bytes);bytes }) }
        let stdout=drain(child.stdout.take().unwrap());let stderr=drain(child.stderr.take().unwrap());
        let status=loop { match child.try_wait() { Ok(Some(status))=>break Some(status), Ok(None) if Instant::now()<deadline=>std::thread::sleep(Duration::from_millis(10)), _=>{let _=child.kill();let _=child.wait();break None;} } };
        let stdout=stdout.join().unwrap_or_default();let stderr=stderr.join().unwrap_or_default();
        if !status.is_some_and(|status|status.success()) {
            // Keep missing-path hints even when the graph refuses, so dev can recover.
            if let Ok(result)=serde_json::from_slice::<serde_json::Value>(&stdout) { if let Some(paths)=result["watch"].as_array() { for path in paths.iter().filter_map(|path|path.as_str()) {graph.insert(path.into(),None);} } }
            write(project,&graph)?;
            return Err(format!("E_SERVER_TYPECHECK: worker dependency capture refused: {}", if status.is_none(){"exceeded 30 seconds".into()}else{String::from_utf8_lossy(&stderr).into_owned()}));
        }
        let result: serde_json::Value=serde_json::from_slice(&stdout).map_err(|e|format!("E_SERVER_TYPECHECK: invalid worker dependency graph: {e}"))?;
        for item in result["files"].as_array().ok_or("E_SERVER_TYPECHECK: missing worker files")? {
            let path=PathBuf::from(item.as_str().ok_or("E_SERVER_TYPECHECK: invalid worker path")?);
            if !seen.contains(&path) { pending.push(path); }
        }
    }
    write(project,&graph)
}
fn write(project:&Project,graph:&BTreeMap<PathBuf,Option<(String,String)>>)->Result<(),String>{
    std::fs::create_dir_all(project.generated_dir()).map_err(|e|e.to_string())?;
    let path=project.generated_dir().join("server-watch.json");
    let bytes=serde_json::to_vec(&graph.iter().collect::<Vec<_>>()).map_err(|e|e.to_string())?;
    let temporary=path.with_extension(format!("json.{}.tmp",std::process::id()));
    std::fs::write(&temporary,bytes).and_then(|_|std::fs::rename(temporary,path)).map_err(|e|e.to_string())
}
