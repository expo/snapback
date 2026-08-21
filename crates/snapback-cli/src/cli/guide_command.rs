use super::*;

pub(crate) const DEFAULT_SERVED_GUIDE_URL: &str = "http://127.0.0.1:4287/_snapback/guide";

pub(crate) fn parse_guide_slice(value: &str) -> Result<usize, String> {
    value
        .parse::<usize>()
        .ok()
        .filter(|slice| *slice > 0)
        .ok_or_else(|| "--slice must be a positive integer".to_owned())
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct GuideSectionMatch {
    pub(crate) path: String,
    pub(crate) heading: String,
    pub(crate) anchor: String,
}

fn markdown_heading(line: &str) -> Option<&str> {
    let trimmed = line.trim_start();
    let level = trimmed.bytes().take_while(|byte| *byte == b'#').count();
    if !(1..=6).contains(&level) || trimmed.as_bytes().get(level) != Some(&b' ') {
        return None;
    }
    let heading = trimmed[level + 1..].trim();
    (!heading.is_empty()).then_some(heading)
}

fn markdown_anchor(heading: &str) -> String {
    let mut anchor = String::new();
    for character in heading.chars().flat_map(char::to_lowercase) {
        if character.is_alphanumeric() || character == '_' || character == '-' {
            anchor.push(character);
        } else if character.is_whitespace() {
            anchor.push('-');
        }
    }
    if anchor.is_empty() {
        "section".to_owned()
    } else {
        anchor
    }
}

pub(crate) fn search_guide_sections_in(
    files: &[crate::guide::EmbeddedGuideFile],
    query: &str,
) -> Vec<GuideSectionMatch> {
    let query = query.to_lowercase();
    let mut matches = Vec::new();

    for file in files {
        if !file.path.ends_with(".md") || file.path == crate::guide::FLAT_PATH {
            continue;
        }
        let Ok(markdown) = std::str::from_utf8(file.bytes) else {
            continue;
        };
        let mut anchor_counts = HashMap::<String, usize>::new();
        let mut current: Option<(String, String, String)> = None;
        let mut active_fence = None;

        let finish_section = |current: Option<(String, String, String)>,
                              matches: &mut Vec<GuideSectionMatch>| {
            if let Some((heading, anchor, text)) = current
                && text.to_lowercase().contains(&query)
            {
                matches.push(GuideSectionMatch {
                    path: file.path.to_owned(),
                    heading,
                    anchor,
                });
            }
        };

        for line in markdown.lines() {
            let trimmed = line.trim_start();
            let fence = if trimmed.starts_with("```") {
                Some('`')
            } else if trimmed.starts_with("~~~") {
                Some('~')
            } else {
                None
            };
            if let Some(fence) = fence {
                match active_fence {
                    Some(active) if active == fence => active_fence = None,
                    None => active_fence = Some(fence),
                    _ => {}
                }
            }

            if active_fence.is_none()
                && let Some(heading) = markdown_heading(line)
            {
                finish_section(current.take(), &mut matches);
                let base_anchor = markdown_anchor(heading);
                let count = anchor_counts.entry(base_anchor.clone()).or_default();
                let anchor = if *count == 0 {
                    base_anchor
                } else {
                    format!("{base_anchor}-{count}")
                };
                *count += 1;
                current = Some((heading.to_owned(), anchor, format!("{heading}\n")));
            } else if let Some((_, _, text)) = &mut current {
                text.push_str(line);
                text.push('\n');
            }
        }
        finish_section(current, &mut matches);
    }

    matches
}

fn search_guide_sections(query: &str) -> Vec<GuideSectionMatch> {
    search_guide_sections_in(*crate::guide::EMBEDDED_GUIDE_FILES, query)
}

pub(crate) const GUIDE_SEARCH_SCHEMA_VERSION: &str = "snapback.guide-search.v1";

// @ref LLP 0024#dated-amendment-native-machine-mode-2026-08-08 — one total
// JSON grammar covers every Guide branch, including misses and channel help.
fn guide_search_json(
    query: &str,
    slice: usize,
    mode: &str,
    matches: Value,
    result: Value,
) -> anyhow::Result<String> {
    let count = matches.as_array().map_or(0, Vec::len);
    Ok(format!(
        "{}\n",
        serde_json::to_string_pretty(&json!({
            "schemaVersion": GUIDE_SEARCH_SCHEMA_VERSION,
            "ok": true,
            "query": query,
            "slice": slice,
            "mode": mode,
            "count": count,
            "matches": matches,
            "result": result,
        }))?
    ))
}

pub(crate) fn render_guide_command(
    query_words: &[String],
    slice: usize,
    json_output: bool,
) -> anyhow::Result<String> {
    let query = query_words.join(" ");
    let query = query.trim();
    if query.is_empty() {
        if json_output {
            return guide_search_json(
                query,
                slice,
                "channels",
                json!([]),
                // @ref LLP 0259#1-first-read-contract — start packets lead
                // the channel listing; the capability index stays a lookup
                // channel, not the lead item.
                json!({
                    "startPackets": format!("{DEFAULT_SERVED_GUIDE_URL}/start/index.md"),
                    "mentalModel": format!("{DEFAULT_SERVED_GUIDE_URL}/start/mental-model.md"),
                    "capabilityIndex": format!("{DEFAULT_SERVED_GUIDE_URL}/capabilities.md"),
                    "surfaceMap": format!("{DEFAULT_SERVED_GUIDE_URL}/surface-map.md"),
                    "guide": DEFAULT_SERVED_GUIDE_URL,
                    "referenceIndex": format!("{DEFAULT_SERVED_GUIDE_URL}/reference/index.md"),
                    "symbolRegistry": format!("{DEFAULT_SERVED_GUIDE_URL}/reference/registry.json"),
                    "sectionProjections": format!("{DEFAULT_SERVED_GUIDE_URL}/guide-flat.<section>.generated.md"),
                    "wholeCorpusFlat": format!("{DEFAULT_SERVED_GUIDE_URL}/flat.md"),
                    "mcpResource": "snapback-guide://manifest",
                }),
            );
        }
        return Ok(format!(
            "Snapback Guide documentation channels\n\
             \n\
             The URLs below use the first default dev port. If Snapback selected another port, replace the origin with the one printed by snapback dev or snapback start.\n\
             \n\
             Start with your template's start packet: {DEFAULT_SERVED_GUIDE_URL}/start/index.md\n\
             No template? The mental model:  {DEFAULT_SERVED_GUIDE_URL}/start/mental-model.md\n\
             Capability index (lookup, not a linear read): {DEFAULT_SERVED_GUIDE_URL}/capabilities.md\n\
             Surface map:                  {DEFAULT_SERVED_GUIDE_URL}/surface-map.md\n\
             Browse the Guide:             {DEFAULT_SERVED_GUIDE_URL}\n\
             API reference index:           {DEFAULT_SERVED_GUIDE_URL}/reference/index.md\n\
             API symbol registry:           {DEFAULT_SERVED_GUIDE_URL}/reference/registry.json\n\
             Diagnostic code registry:      {DEFAULT_SERVED_GUIDE_URL}/reference/diagnostics.md\n\
             Section projection pattern:    {DEFAULT_SERVED_GUIDE_URL}/guide-flat.<section>.generated.md\n\
             Whole-corpus bulk export:       {DEFAULT_SERVED_GUIDE_URL}/flat.md (about 2.5 MiB; prefer the tiers above)\n\
             Exact symbol or Guide search:  snapback guide <query> [--slice <n>]\n\
             Read through MCP:              snapback mcp\n\
             MCP entry resource:            snapback-guide://manifest\n\
             \n\
             Operate it:\n\
             snapback mcp serves read-only Guide resources; snapback mcp-control adds typed control tools with local admin authority.\n\
             Preview with: snapback agent setup --print <client> --server mcp-control\n"
        ));
    }

    // @ref LLP 0194#design — exact registry lookup precedes Markdown search;
    // a miss, rather than an independently interpreted near-match, falls back.
    if let Some(result) = crate::guide_reference::lookup(query, slice)? {
        if json_output {
            let match_kind = result.get("match").cloned().unwrap_or(Value::Null);
            let matched_query = result.get("query").cloned().unwrap_or(Value::Null);
            return guide_search_json(
                query,
                slice,
                "exact-symbol",
                json!([{
                    "kind": match_kind,
                    "query": matched_query,
                }]),
                result,
            );
        }
        return Ok(format!(
            "{}\n",
            crate::guide_reference::format_lookup(&result)?
        ));
    }
    let matches = search_guide_sections(query);
    if json_output {
        let projected = matches
            .iter()
            .map(|matched| {
                json!({
                    "path": matched.path,
                    "heading": matched.heading,
                    "anchor": matched.anchor,
                    "url": format!(
                        "{DEFAULT_SERVED_GUIDE_URL}/{}#{}",
                        matched.path, matched.anchor
                    ),
                })
            })
            .collect::<Vec<_>>();
        return guide_search_json(
            query,
            slice,
            "section-search",
            json!(projected),
            if matches.is_empty() {
                json!({
                    "matched": false,
                    "next": format!("{DEFAULT_SERVED_GUIDE_URL}/capabilities.md"),
                })
            } else {
                json!({ "matched": true })
            },
        );
    }
    if matches.is_empty() {
        return Ok(format!(
            "No embedded Guide sections matched {query:?}.\nTry a shorter term, look it up in the capability index (a registry, not a first read): {DEFAULT_SERVED_GUIDE_URL}/capabilities.md\nStart packets: {DEFAULT_SERVED_GUIDE_URL}/start/index.md\n"
        ));
    }

    let mut output = format!("Embedded Guide sections matching {query:?}:\n");
    for matched in &matches {
        output.push_str(&format!(
            "- {}#{} — {}\n  {DEFAULT_SERVED_GUIDE_URL}/{}#{}\n",
            matched.path, matched.anchor, matched.heading, matched.path, matched.anchor
        ));
    }
    output.push_str(&format!("{} section(s) matched.\n", matches.len()));
    Ok(output)
}

pub(crate) fn guide_command(query: &[String], slice: usize, json: bool) -> anyhow::Result<()> {
    use std::io::Write as _;

    std::io::stdout()
        .write_all(render_guide_command(query, slice, json)?.as_bytes())
        .context("failed to write Guide output")
}
