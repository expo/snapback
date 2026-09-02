//! Idempotent project adoption and the two first-party templates.
// @ref LLP 1002#10-init — the scaffold is additive, version-pinned, and ends in a real check.

use crate::protocol::Refusal;
use crate::{check, owner, verbs};
use serde_json::{Map, Value as Json, json};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

const BLOCK_START: &str = "<!-- snapback2:start -->";
const BLOCK_END: &str = "<!-- snapback2:end -->";
const AGENT_BLOCK: &str = r#"<!-- snapback2:start -->
## Snapback 2

- `snapback2 check` compiles, certifies, and refreshes `.snapback/build/api.d.ts`.
- `snapback2 dev` starts or attaches to the one local owner and prints `SNAPBACK_URL`.
- `snapback2 test` proves derived checks and authored journeys with a receipt.
- `snapback2 why <query> --as <persona>` explains rows, rules, and bounds.
- `snapback2 trace latest` follows commit → invalidation → delivery.
- Backends are `snapback/*.q`; `snapback2 guide quarry` is the language reference.
- Effects, seeds, and journeys are TypeScript.

Gotchas: authentication is always on; use `--as <persona>` only in development.
Every scan names `take`; empty, capped, denied, and stale are distinct states.
Generated files stay under `.snapback/` and are never committed.
<!-- snapback2:end -->"#;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Client {
    React,
    None,
}

pub fn run(args: &[String]) -> ExitCode {
    let options = match verbs::parse_options(args, &["--template", "--client"], &["--json", "--ts"])
    {
        Ok(options) => options,
        Err(code) => return code,
    };
    let json_output = options.has("--json");
    let positional = options.positionals();
    if positional.len() > 2 {
        return usage();
    }
    let requested_template = options.value("--template").unwrap_or("todos");
    if !matches!(requested_template, "todos" | "chat" | "ts") {
        return usage();
    }
    let template = if requested_template == "ts" {
        "todos"
    } else {
        requested_template
    };
    let typescript = options.has("--ts") || requested_template == "ts";
    let rendering = if typescript {
        format!("{template}-ts")
    } else {
        template.to_owned()
    };
    let client = match options.value("--client").unwrap_or("react") {
        "react" => Client::React,
        "none" => Client::None,
        _ => return usage(),
    };
    let root = match target_root(positional.get(1).copied()) {
        Ok(root) => root,
        Err(error) => return owner::print_refusal(error, json_output, 2),
    };
    if let Err(error) = scaffold(&root, &rendering, client) {
        return owner::print_refusal(error, json_output, 1);
    }
    let checked = check::run_project(&root, json_output);
    if checked != ExitCode::SUCCESS {
        return checked;
    }
    if json_output {
        println!(
            "{}",
            json!({ "ok": true, "project": root, "next": "snapback2 dev" })
        );
    } else {
        println!("next: cd {} && snapback2 dev", root.display());
    }
    ExitCode::SUCCESS
}

fn target_root(value: Option<&str>) -> Result<PathBuf, Refusal> {
    let root = match value {
        Some(value) => PathBuf::from(value),
        None => std::env::current_dir().map_err(|error| conflict(error.to_string()))?,
    };
    fs::create_dir_all(&root).map_err(|error| conflict(error.to_string()))?;
    root.canonicalize()
        .map_err(|error| conflict(error.to_string()))
}

fn scaffold(root: &Path, template: &str, client: Client) -> Result<(), Refusal> {
    ensure_directory_or_absent(&root.join("snapback"))?;
    ensure_file_or_absent(&root.join("AGENTS.md"))?;
    ensure_file_or_absent(&root.join(".gitignore"))?;
    ensure_file_or_absent(&root.join("tsconfig.json"))?;
    ensure_file_or_absent(&root.join("package.json"))?;

    let templates = template_root()?;
    let backend = templates.join(template).join("snapback");
    if !backend.join("schema.ts").is_file() && !backend.join("schema.q").is_file() {
        return Err(Refusal::owner(
            "E_OWNER_TEMPLATE",
            format!("template {template} is incomplete at {}", backend.display()),
            "reinstall snapback2 or set SNAPBACK2_TEMPLATES to the shipped templates directory",
        ));
    }
    copy_absent(&backend, &root.join("snapback"))?;
    if client == Client::React {
        copy_absent(&templates.join("react"), root)?;
    }
    update_agents(&root.join("AGENTS.md"))?;
    update_gitignore(&root.join(".gitignore"))?;
    update_tsconfig(&root.join("tsconfig.json"))?;
    update_package(&root.join("package.json"), client)?;
    Ok(())
}

fn template_root() -> Result<PathBuf, Refusal> {
    let candidates = [
        std::env::var_os("SNAPBACK2_TEMPLATES").map(PathBuf::from),
        std::env::var_os("SNAPBACK2_GUIDE")
            .map(PathBuf::from)
            .and_then(|path| path.parent().map(|parent| parent.join("templates"))),
        std::env::current_exe()
            .ok()
            .and_then(|path| path.parent().map(|parent| parent.join("templates"))),
        Some(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/snapback2/dist/templates")),
    ];
    candidates
        .into_iter()
        .flatten()
        .find(|path| {
            path.join("todos/snapback/schema.ts").is_file()
                || path.join("todos/snapback/schema.q").is_file()
        })
        .ok_or_else(|| {
            Refusal::owner(
                "E_OWNER_TEMPLATE",
                "the installed package templates were not found",
                "run the snapback2 package build or set SNAPBACK2_TEMPLATES",
            )
        })
}

fn copy_absent(source: &Path, target: &Path) -> Result<(), Refusal> {
    if source.is_dir() {
        if target.exists() && !target.is_dir() {
            return Err(conflict(format!(
                "{} must be a directory",
                target.display()
            )));
        }
        fs::create_dir_all(target).map_err(|error| conflict(error.to_string()))?;
        let mut entries = fs::read_dir(source)
            .map_err(|error| conflict(error.to_string()))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| conflict(error.to_string()))?;
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            copy_absent(&entry.path(), &target.join(entry.file_name()))?;
        }
    } else if !target.exists() {
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| conflict(error.to_string()))?;
        }
        fs::copy(source, target).map_err(|error| conflict(error.to_string()))?;
    } else if !target.is_file() {
        return Err(conflict(format!("{} must be a file", target.display())));
    }
    Ok(())
}

fn update_agents(path: &Path) -> Result<(), Refusal> {
    let current = fs::read_to_string(path).unwrap_or_default();
    let next = match (current.find(BLOCK_START), current.find(BLOCK_END)) {
        (Some(start), Some(end)) if start <= end => {
            let after = end + BLOCK_END.len();
            format!("{}{}{}", &current[..start], AGENT_BLOCK, &current[after..])
        }
        (None, None) if current.trim().is_empty() => format!("{AGENT_BLOCK}\n"),
        (None, None) => format!("{}\n\n{AGENT_BLOCK}\n", current.trim_end()),
        _ => {
            return Err(conflict(format!(
                "{} has an incomplete Snapback 2 managed block",
                path.display()
            )));
        }
    };
    if next != current {
        fs::write(path, next).map_err(|error| conflict(error.to_string()))?;
    }
    Ok(())
}

fn update_gitignore(path: &Path) -> Result<(), Refusal> {
    let current = fs::read_to_string(path).unwrap_or_default();
    if current.lines().any(|line| line.trim() == ".snapback/") {
        return Ok(());
    }
    let prefix = if current.is_empty() || current.ends_with('\n') {
        current
    } else {
        format!("{current}\n")
    };
    fs::write(path, format!("{prefix}.snapback/\n")).map_err(|error| conflict(error.to_string()))
}

fn update_tsconfig(path: &Path) -> Result<(), Refusal> {
    let mut value = if path.is_file() {
        serde_json::from_slice::<Json>(
            &fs::read(path).map_err(|error| conflict(error.to_string()))?,
        )
        .map_err(|error| {
            conflict(format!(
                "{} is not JSON: {error}; remove comments before init",
                path.display()
            ))
        })?
    } else {
        json!({
            "compilerOptions": {
                "target": "ES2022",
                "module": "ESNext",
                "moduleResolution": "Bundler",
                "strict": true,
                "jsx": "react-jsx"
            },
            "include": ["src", "snapback"]
        })
    };
    let object = value
        .as_object_mut()
        .ok_or_else(|| conflict("tsconfig.json must contain an object"))?;
    let include = object
        .entry("include")
        .or_insert_with(|| json!([]))
        .as_array_mut()
        .ok_or_else(|| conflict("tsconfig.json include must be an array"))?;
    let generated = ".snapback/build/api.d.ts";
    if !include.iter().any(|item| item.as_str() == Some(generated)) {
        include.push(Json::String(generated.to_owned()));
    }
    write_json_if_changed(path, &value)
}

fn update_package(path: &Path, client: Client) -> Result<(), Refusal> {
    let mut value = if path.is_file() {
        serde_json::from_slice::<Json>(
            &fs::read(path).map_err(|error| conflict(error.to_string()))?,
        )
        .map_err(|error| conflict(format!("{} is not JSON: {error}", path.display())))?
    } else {
        json!({ "name": project_name(path), "private": true, "type": "module" })
    };
    let object = value
        .as_object_mut()
        .ok_or_else(|| conflict("package.json must contain an object"))?;
    let dependencies = object
        .entry("dependencies")
        .or_insert_with(|| Json::Object(Map::new()))
        .as_object_mut()
        .ok_or_else(|| conflict("package.json dependencies must be an object"))?;
    dependencies.insert(
        "snapback2".to_owned(),
        Json::String(crate::VERSION.to_owned()),
    );
    if client == Client::React {
        dependencies
            .entry("react")
            .or_insert_with(|| Json::String("^19.1.1".to_owned()));
        dependencies
            .entry("react-dom")
            .or_insert_with(|| Json::String("^19.1.1".to_owned()));
        let development = object
            .entry("devDependencies")
            .or_insert_with(|| Json::Object(Map::new()))
            .as_object_mut()
            .ok_or_else(|| conflict("package.json devDependencies must be an object"))?;
        development
            .entry("@types/react")
            .or_insert_with(|| Json::String("^19.1.10".to_owned()));
        development
            .entry("@types/react-dom")
            .or_insert_with(|| Json::String("^19.1.7".to_owned()));
        development
            .entry("typescript")
            .or_insert_with(|| Json::String("^5.9.2".to_owned()));
        development
            .entry("vite")
            .or_insert_with(|| Json::String("^7.1.4".to_owned()));
        let scripts = object
            .entry("scripts")
            .or_insert_with(|| Json::Object(Map::new()))
            .as_object_mut()
            .ok_or_else(|| conflict("package.json scripts must be an object"))?;
        scripts
            .entry("dev")
            .or_insert_with(|| Json::String("vite".to_owned()));
    }
    write_json_if_changed(path, &value)
}

fn project_name(path: &Path) -> String {
    path.parent()
        .and_then(Path::file_name)
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("snapback2-app")
        .to_owned()
}

fn write_json_if_changed(path: &Path, value: &Json) -> Result<(), Refusal> {
    let mut next = serde_json::to_string_pretty(value)
        .map_err(|error| conflict(format!("cannot serialize {}: {error}", path.display())))?;
    next.push('\n');
    if fs::read_to_string(path).ok().as_deref() != Some(&next) {
        fs::write(path, next).map_err(|error| conflict(error.to_string()))?;
    }
    Ok(())
}

fn ensure_directory_or_absent(path: &Path) -> Result<(), Refusal> {
    if path.exists() && !path.is_dir() {
        Err(conflict(format!("{} must be a directory", path.display())))
    } else {
        Ok(())
    }
}

fn ensure_file_or_absent(path: &Path) -> Result<(), Refusal> {
    if path.exists() && !path.is_file() {
        Err(conflict(format!("{} must be a file", path.display())))
    } else {
        Ok(())
    }
}

fn conflict(message: impl Into<String>) -> Refusal {
    Refusal::new(
        "E_INIT_CONFLICT",
        "input",
        message,
        "move the conflicting path aside or run init in another directory",
        "input/init",
    )
}

fn usage() -> ExitCode {
    eprintln!(
        "usage: snapback2 init [dir] [--template todos|chat|ts] [--ts] [--client react|none] [--json]"
    );
    ExitCode::from(2)
}
