use super::*;

const MAX_CONFIG_CLI_VALUE_BYTES: u64 = 1024 * 1024;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfigSetCliRequest<'a> {
    entry: &'a str,
    value: &'a str,
    append: bool,
    source: &'static str,
}

fn read_config_value<R: std::io::Read>(reader: R) -> anyhow::Result<zeroize::Zeroizing<String>> {
    use zeroize::{Zeroize as _, Zeroizing};

    let mut bytes = Zeroizing::new(Vec::new());
    reader
        .take(MAX_CONFIG_CLI_VALUE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| {
            anyhow::anyhow!(
                "SNAPBACK_CONFIG_VALUE_READ_FAILED: config value carrier could not be read"
            )
        })?;
    if bytes.len() as u64 > MAX_CONFIG_CLI_VALUE_BYTES {
        anyhow::bail!(
            "SNAPBACK_CONFIG_VALUE_TOO_LARGE: config value carrier exceeds the 1048576-byte CLI limit"
        );
    }
    match String::from_utf8(std::mem::take(&mut *bytes)) {
        Ok(value) => Ok(Zeroizing::new(value)),
        Err(error) => {
            let mut rejected = error.into_bytes();
            rejected.zeroize();
            anyhow::bail!(
                "SNAPBACK_CONFIG_VALUE_INVALID: config value carrier must contain valid UTF-8"
            )
        }
    }
}

fn read_config_value_carrier(
    value_stdin: bool,
    value_fd: Option<u32>,
) -> anyhow::Result<zeroize::Zeroizing<String>> {
    if value_stdin {
        return read_config_value(std::io::stdin().lock());
    }
    let descriptor = value_fd.context(
        "SNAPBACK_CONFIG_SET_USAGE_INVALID: choose exactly one of --value-stdin or --value-fd N",
    )?;
    #[cfg(unix)]
    {
        use std::os::fd::FromRawFd as _;

        let descriptor = i32::try_from(descriptor).map_err(|_| {
            anyhow::anyhow!(
                "SNAPBACK_CONFIG_VALUE_FD_INVALID: config value descriptor is outside the supported range"
            )
        })?;
        // SAFETY: dup reads the caller-provided descriptor without taking
        // ownership of it. A nonnegative result is a new descriptor owned by
        // the File constructed immediately below.
        let duplicate = unsafe { libc::dup(descriptor) };
        if duplicate < 0 {
            return Err(anyhow::anyhow!(
                "SNAPBACK_CONFIG_VALUE_FD_INVALID: config value descriptor is not readable"
            ));
        }
        // SAFETY: duplicate is a fresh owned descriptor returned by dup and
        // is converted into exactly one File.
        let file = unsafe { std::fs::File::from_raw_fd(duplicate) };
        read_config_value(file)
    }
    #[cfg(not(unix))]
    {
        let _ = descriptor;
        anyhow::bail!(
            "SNAPBACK_CONFIG_VALUE_FD_UNSUPPORTED: inherited config value descriptors are unavailable on this host; use --value-stdin"
        )
    }
}

fn config_set_refusal(status: u16, response: ureq::Response) -> anyhow::Error {
    let code = response
        .into_json::<Value>()
        .ok()
        .and_then(|body| {
            body.pointer("/diagnostic/code")
                .or_else(|| body.pointer("/diagnostics/0/code"))
                .and_then(Value::as_str)
                .filter(|code| code.starts_with("SNAPBACK_"))
                .map(ToOwned::to_owned)
        })
        .unwrap_or_else(|| "SNAPBACK_CONFIG_SET_FAILED".to_owned());
    anyhow::anyhow!(
        "{code}: config.set failed with HTTP {status}; response body omitted to protect the submitted value"
    )
}

// @ref LLP 0184#product-contract-what-agent-accessible-means — config.set is
//   `(cliOnly, direct)` and its only v1 value carriers are stdin/fd; there is
//   deliberately no MCP projection.
// @ref LLP 0036#operations-and-projections-llp-0024 — reuse the existing
//   config.set route, ordinary admin credential, value-free write envelope,
//   and `source: cli` audit fact.
fn config_set_post(
    target: &TargetArgs,
    entry: &str,
    value: &str,
    append: bool,
) -> anyhow::Result<crate::local::ConfigWriteOutcome> {
    let resolved = resolve_http_target_for_operation(target, false, false)?;
    let token = target
        .token
        .clone()
        .or_else(|| std::env::var("SNAPBACK_ADMIN_TOKEN").ok())
        .filter(|token| !token.is_empty())
        .or(resolved.minted_token);
    let path = "/_snapback/api/config/set";
    let mut request = ureq::post(&format!("{}{path}", resolved.server_url));
    if let Some(token) = token {
        request = request.set("x-snapback-admin-token", &token);
    }
    let body = ConfigSetCliRequest {
        entry,
        value,
        append,
        source: "cli",
    };
    match request.send_json(&body) {
        Ok(response) => response.into_json().map_err(|_| {
            anyhow::anyhow!(
                "SNAPBACK_CONFIG_SET_RESPONSE_INVALID: config.set response was not the expected value-free envelope"
            )
        }),
        Err(ureq::Error::Status(status, response)) => {
            Err(config_set_refusal(status, response))
        }
        Err(_) => Err(anyhow::anyhow!(
            "SNAPBACK_CONFIG_SET_REQUEST_FAILED: config.set request failed before a response was received"
        )),
    }
}

pub(crate) fn config_command(command: ConfigCommand) -> anyhow::Result<()> {
    match command {
        ConfigCommand::Status { target } => {
            let response = admin_json_get(&target, "/_snapback/api/config/status", Vec::new())?;
            println!("{}", serde_json::to_string_pretty(&response)?);
            Ok(())
        }
        ConfigCommand::Plan { target, entry } => {
            let mut query = Vec::new();
            if let Some(entry) = entry {
                query.push(("entry", entry));
            }
            let response = admin_json_get(&target, "/_snapback/api/config/plan", query)?;
            println!("{}", serde_json::to_string_pretty(&response)?);
            Ok(())
        }
        ConfigCommand::Set {
            target,
            entry,
            value_stdin,
            value_fd,
            append,
        } => {
            let value = read_config_value_carrier(value_stdin, value_fd)?;
            let response = config_set_post(&target, &entry, value.as_str(), append)?;
            println!("{}", serde_json::to_string_pretty(&response)?);
            Ok(())
        }
        ConfigCommand::Verify { target, entry } => {
            let response = admin_json_post(
                &target,
                "/_snapback/api/config/verify",
                json!({ "entry": entry }),
            )?;
            println!("{}", serde_json::to_string_pretty(&response)?);
            Ok(())
        }
        ConfigCommand::Unset { target, entry } => {
            let response = admin_json_post(
                &target,
                "/_snapback/api/config/unset",
                json!({ "entry": entry, "source": "cli" }),
            )?;
            println!("{}", serde_json::to_string_pretty(&response)?);
            Ok(())
        }
    }
}
