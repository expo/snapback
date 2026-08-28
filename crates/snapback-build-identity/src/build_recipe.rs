use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

pub const BUILD_RECIPE_SCHEMA_VERSION: &str = "snapback.cargo-build-recipe.v1";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CargoBuildRecipe {
    pub cargo_profile: String,
    pub inherits: Option<String>,
    pub incremental: Option<bool>,
    pub lto: Option<String>,
    pub codegen_units: Option<u32>,
    pub opt_level: Option<u32>,
    pub strip: Option<String>,
}

impl CargoBuildRecipe {
    pub fn for_profile(profile: &str, root_manifest: &str) -> Result<Self, String> {
        if profile != "production" {
            return Ok(Self {
                cargo_profile: profile.to_owned(),
                inherits: None,
                incremental: None,
                lto: None,
                codegen_units: None,
                opt_level: None,
                strip: None,
            });
        }

        let values = profile_section(root_manifest, "profile.production")?;
        let expected_keys = BTreeSet::from([
            "codegen-units",
            "incremental",
            "inherits",
            "lto",
            "opt-level",
            "strip",
        ]);
        let actual_keys = values.keys().map(String::as_str).collect::<BTreeSet<_>>();
        if actual_keys != expected_keys {
            return Err(format!(
                "[profile.production] must declare exactly {}; observed {}",
                expected_keys.into_iter().collect::<Vec<_>>().join(", "),
                actual_keys.into_iter().collect::<Vec<_>>().join(", "),
            ));
        }

        let recipe = Self {
            cargo_profile: profile.to_owned(),
            inherits: Some(toml_string(&values, "inherits")?),
            incremental: Some(toml_bool(&values, "incremental")?),
            lto: Some(toml_string(&values, "lto")?),
            codegen_units: Some(toml_u32(&values, "codegen-units")?),
            opt_level: Some(toml_u32(&values, "opt-level")?),
            strip: Some(toml_string(&values, "strip")?),
        };
        recipe.assert_ship_recipe()?;
        Ok(recipe)
    }

    pub fn assert_ship_recipe(&self) -> Result<(), String> {
        if self.cargo_profile != "production"
            || self.inherits.as_deref() != Some("release")
            || self.incremental != Some(false)
            || self.lto.as_deref() != Some("fat")
            || self.codegen_units != Some(1)
            || self.opt_level != Some(3)
            || self.strip.as_deref() != Some("symbols")
        {
            return Err(format!(
                "public-package builds require production/release, incremental=false, lto=fat, codegen-units=1, opt-level=3, strip=symbols; observed {self:?}",
            ));
        }
        Ok(())
    }

    pub fn json(&self) -> String {
        format!(
            concat!(
                "{{\"schemaVersion\":\"{}\",\"cargoProfile\":{},",
                "\"inherits\":{},\"incremental\":{},\"lto\":{},",
                "\"codegenUnits\":{},\"optLevel\":{},\"strip\":{}}}"
            ),
            BUILD_RECIPE_SCHEMA_VERSION,
            json_string(&self.cargo_profile),
            json_optional_string(self.inherits.as_deref()),
            json_optional_bool(self.incremental),
            json_optional_string(self.lto.as_deref()),
            json_optional_u32(self.codegen_units),
            json_optional_u32(self.opt_level),
            json_optional_string(self.strip.as_deref()),
        )
    }
}

pub fn validate_public_package_environment(
    profile: &str,
    environment: &[(String, String)],
    cargo_command: Option<&str>,
    ambient_configs: &[PathBuf],
) -> Result<(), String> {
    if profile != "production" {
        return Err(format!(
            "public-package build used Cargo profile {profile:?}; expected \"production\"",
        ));
    }

    for (name, value) in environment {
        if name.starts_with("CARGO_PROFILE_PRODUCTION_")
            || name.starts_with("CARGO_PROFILE_RELEASE_")
            || matches!(
                name.as_str(),
                "CARGO_INCREMENTAL" | "RUSTC_WRAPPER" | "RUSTC_WORKSPACE_WRAPPER"
            )
        {
            return Err(format!(
                "public-package build forbids the recipe override channel {name}",
            ));
        }
        if is_rustflags_channel(name) && touches_ship_recipe(value) {
            return Err(format!(
                "public-package build forbids recipe-changing flags in {name}",
            ));
        }
    }

    if !ambient_configs.is_empty() {
        return Err(format!(
            "public-package build forbids ambient Cargo configuration: {}",
            ambient_configs
                .iter()
                .map(|path| path.display().to_string())
                .collect::<Vec<_>>()
                .join(", "),
        ));
    }

    let command = cargo_command
        .ok_or_else(|| "public-package build could not inspect its Cargo invocation".to_owned())?;
    let tokens = command.split_ascii_whitespace().collect::<Vec<_>>();
    if tokens
        .iter()
        .any(|token| *token == "--config" || token.starts_with("--config="))
    {
        return Err("public-package build forbids cargo --config".to_owned());
    }
    if tokens.contains(&"rustc") {
        return Err("public-package build forbids trailing cargo rustc flags".to_owned());
    }
    if !tokens.contains(&"build") {
        return Err(format!(
            "public-package build requires cargo build; observed parent command {command:?}",
        ));
    }
    Ok(())
}

pub fn ambient_cargo_configs(repo_root: &Path, environment: &[(String, String)]) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    roots.push(repo_root.to_path_buf());
    if let Some((_, pwd)) = environment.iter().find(|(name, _)| name == "PWD") {
        roots.push(PathBuf::from(pwd));
    }
    let mut candidates = BTreeSet::new();
    for root in roots {
        for ancestor in root.ancestors() {
            candidates.insert(ancestor.join(".cargo/config"));
            candidates.insert(ancestor.join(".cargo/config.toml"));
        }
    }
    if let Some((_, home)) = environment.iter().find(|(name, _)| name == "HOME") {
        candidates.insert(PathBuf::from(home).join(".cargo/config"));
        candidates.insert(PathBuf::from(home).join(".cargo/config.toml"));
    }
    if let Some((_, cargo_home)) = environment.iter().find(|(name, _)| name == "CARGO_HOME") {
        candidates.insert(PathBuf::from(cargo_home).join("config"));
        candidates.insert(PathBuf::from(cargo_home).join("config.toml"));
    }
    candidates
        .into_iter()
        .filter(|path| path.exists())
        .collect()
}

fn profile_section(manifest: &str, section: &str) -> Result<BTreeMap<String, String>, String> {
    let wanted = format!("[{section}]");
    let mut inside = false;
    let mut values = BTreeMap::new();
    for raw_line in manifest.lines() {
        let line = raw_line.split('#').next().unwrap_or("").trim();
        if line.starts_with('[') {
            if inside {
                break;
            }
            inside = line == wanted;
            continue;
        }
        if !inside || line.is_empty() {
            continue;
        }
        let (key, value) = line
            .split_once('=')
            .ok_or_else(|| format!("malformed {wanted} entry {line:?}"))?;
        if values
            .insert(key.trim().to_owned(), value.trim().to_owned())
            .is_some()
        {
            return Err(format!("duplicate {wanted} key {:?}", key.trim()));
        }
    }
    if !inside && values.is_empty() {
        return Err(format!("root Cargo.toml does not declare {wanted}"));
    }
    Ok(values)
}

fn toml_string(values: &BTreeMap<String, String>, key: &str) -> Result<String, String> {
    let value = values
        .get(key)
        .ok_or_else(|| format!("[profile.production] is missing {key}"))?;
    value
        .strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'))
        .map(str::to_owned)
        .ok_or_else(|| format!("[profile.production].{key} must be a string"))
}

fn toml_bool(values: &BTreeMap<String, String>, key: &str) -> Result<bool, String> {
    match values.get(key).map(String::as_str) {
        Some("true") => Ok(true),
        Some("false") => Ok(false),
        _ => Err(format!("[profile.production].{key} must be a boolean")),
    }
}

fn toml_u32(values: &BTreeMap<String, String>, key: &str) -> Result<u32, String> {
    values
        .get(key)
        .ok_or_else(|| format!("[profile.production] is missing {key}"))?
        .parse::<u32>()
        .map_err(|_| format!("[profile.production].{key} must be an unsigned integer"))
}

fn is_rustflags_channel(name: &str) -> bool {
    matches!(
        name,
        "RUSTFLAGS" | "CARGO_ENCODED_RUSTFLAGS" | "CARGO_BUILD_RUSTFLAGS"
    ) || (name.starts_with("CARGO_TARGET_") && name.ends_with("_RUSTFLAGS"))
}

fn touches_ship_recipe(value: &str) -> bool {
    let normalized = value
        .replace('\u{1f}', " ")
        .replace("-C ", "-C")
        .to_ascii_lowercase();
    ["lto", "strip", "codegen-units", "opt-level", "incremental"]
        .iter()
        .any(|setting| {
            normalized.contains(&format!("-c{setting}"))
                || normalized.contains(&format!("-c{setting}="))
        })
}

fn json_string(value: &str) -> String {
    format!("{value:?}")
}

fn json_optional_string(value: Option<&str>) -> String {
    value.map(json_string).unwrap_or_else(|| "null".to_owned())
}

fn json_optional_bool(value: Option<bool>) -> &'static str {
    match value {
        Some(true) => "true",
        Some(false) => "false",
        None => "null",
    }
}

fn json_optional_u32(value: Option<u32>) -> String {
    value
        .map(|value| value.to_string())
        .unwrap_or_else(|| "null".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    const MANIFEST: &str = r#"
[profile.release]
incremental = true

[profile.production]
inherits = "release"
incremental = false
lto = "fat"
codegen-units = 1
opt-level = 3
strip = "symbols"
"#;

    #[test]
    fn parses_the_closed_ship_recipe() {
        let recipe = CargoBuildRecipe::for_profile("production", MANIFEST).unwrap();
        recipe.assert_ship_recipe().unwrap();
        assert_eq!(recipe.cargo_profile, "production");
        assert!(recipe.json().contains("\"strip\":\"symbols\""));
    }

    #[test]
    fn refuses_recipe_drift_and_ordinary_release() {
        assert!(
            CargoBuildRecipe::for_profile(
                "production",
                &MANIFEST.replace("lto = \"fat\"", "lto = false"),
            )
            .is_err()
        );
        assert!(
            validate_public_package_environment(
                "release",
                &[],
                Some("cargo build --release --bin snapback"),
                &[],
            )
            .is_err()
        );
    }

    #[test]
    fn refuses_every_ambient_recipe_override_class() {
        for (name, value) in [
            ("CARGO_PROFILE_PRODUCTION_STRIP", "none"),
            ("CARGO_PROFILE_RELEASE_LTO", "off"),
            ("CARGO_INCREMENTAL", "1"),
            ("RUSTC_WRAPPER", "/tmp/wrapper"),
            ("RUSTC_WORKSPACE_WRAPPER", "/tmp/workspace-wrapper"),
            ("RUSTFLAGS", "-C strip=none"),
            ("CARGO_ENCODED_RUSTFLAGS", "-C\u{1f}lto=off"),
            ("CARGO_BUILD_RUSTFLAGS", "-Ccodegen-units=16"),
            (
                "CARGO_TARGET_AARCH64_APPLE_DARWIN_RUSTFLAGS",
                "-C opt-level=0",
            ),
        ] {
            assert!(
                validate_public_package_environment(
                    "production",
                    &[(name.to_owned(), value.to_owned())],
                    Some("cargo build --profile production --bin snapback"),
                    &[],
                )
                .is_err(),
                "{name} must be refused",
            );
        }
        assert!(
            validate_public_package_environment(
                "production",
                &[],
                Some("cargo --config profile.production.strip='none' build --profile production"),
                &[],
            )
            .is_err()
        );
        assert!(
            validate_public_package_environment(
                "production",
                &[],
                Some("cargo rustc --profile production -- -C strip=none"),
                &[],
            )
            .is_err()
        );
        assert!(
            validate_public_package_environment(
                "production",
                &[],
                Some("cargo build --profile production --bin snapback"),
                &[PathBuf::from("/tmp/.cargo/config.toml")],
            )
            .is_err()
        );
    }

    #[test]
    fn permits_unrelated_rust_flags() {
        validate_public_package_environment(
            "production",
            &[("RUSTFLAGS".to_owned(), "-C target-cpu=apple-m1".to_owned())],
            Some("cargo build --profile production --bin snapback"),
            &[],
        )
        .unwrap();
    }
}
