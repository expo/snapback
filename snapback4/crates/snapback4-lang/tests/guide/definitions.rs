//! Editorial regressions exercise rendered cards and the actual `why` selector.
use snapback4_lang::guide::{KEYWORDS, card, explain_code};
#[path = "refusal_actions.rs"]
mod refusal_actions;

fn normalize(text: &str) -> String { text.split_whitespace().collect::<Vec<_>>().join(" ") }

#[test]
fn heaviest_account_aliases_reach_the_executable_acquisition_recipe() {
    for alias in ["envelope", "heaviest", "1000", "cold start", "cold restart", "acquire"] {
        assert_eq!(card(alias), card("bounds"));
    }
    let text = card("bounds").unwrap();
    for fact in ["Prove the envelope's heaviest account", "witness acquire", "18.609 s", "19.522 s", "groupsByTable", "SQLite pages"] {
        assert!(text.contains(fact), "missing {fact}");
    }
}

// Exclude the registered one-line explanation: the card excerpt must carry
// the definition independently, including when printed by repeated diagnostics.
fn excerpt(text: &str) -> String {
    normalize(&text.lines().skip_while(|line| !line.starts_with('#'))
        .take_while(|line| !line.starts_with("Full card:")).collect::<Vec<_>>().join("\n"))
}

#[test]
fn why_bound_defines_the_ceiling_and_withheld_count() {
    let text = excerpt(&explain_code("E_BOUND").unwrap());
    for fact in ["8,192 rows examined", "1,024 rows written per mutation", "a mutation aborts with E_BOUND naming the meter, the ceiling and the site", "never the count: it would measure rows the viewer may not read"] {
        assert!(text.contains(fact), "why E_BOUND excerpt omits {fact}: {text}");
    }
    assert!(!text.contains("as above"));
}

#[test]
fn why_rule_carries_the_target_visibility_contract() {
    let text = excerpt(&explain_code("E_RULE").unwrap());
    // Each sentence is paired with a write-executing test in rules.rs.
    let facts = [
        // [rules::insert_rule_refusals](rules.rs)
        "`insert` and `insert ... if absent` return E_RULE when the insert rule denies the viewer.",
        // [rules::insert_collision_visibility](rules.rs)
        "A unique clash with a hidden row returns E_RULE for either insert form.",
        // [rules::insert_collision_visibility](rules.rs)
        "For a readable secondary unique clash without a custom refusal, ordinary insert returns E_CONSTRAINT naming the index, while `insert ... if absent` succeeds with null.",
        // [rules::update_rule_refusals](rules.rs)
        "If the update rule denies an update or upsert-patch, it returns E_RULE for a readable target and NOT_FOUND for an unreadable target.",
        // [rules::admitted_hidden_updates](rules.rs)
        "A valid update or upsert-patch admitted by the update rule can change a hidden row; if the resulting row remains hidden, it returns null.",
        // [rules::update_collision_visibility](rules.rs)
        "Without a custom unique refusal, an update or upsert-patch with a secondary unique clash returns NOT_FOUND if its target is unreadable, E_RULE if only the colliding row is unreadable, and E_CONSTRAINT naming the index if both are readable.",
        // [rules::update_rule_refusals / update_conditions / update_collision_visibility](rules.rs)
        "For rule denial, an update condition or a secondary unique clash on an unreadable target, NOT_FOUND carries no row, index, column or branch detail.",
        // [rules::missing_update_and_incomplete_upsert](rules.rs)
        "A missing update target or an incomplete upsert insert patch returns NOT_FOUND.",
        // [rules::update_conditions](rules.rs)
        "An update condition on an unreadable target returns NOT_FOUND even if it would match; on a readable target, a false condition returns E_CONFLICT with a read-rule `current`.",
        // [rules::delete_rule_refusals](rules.rs)
        "Delete returns NOT_FOUND for a missing id or an unreadable refused target, and E_RULE for a readable row whose delete rule refuses.",
        // [rules::admitted_hidden_updates](rules.rs)
        "Reading a hidden row returns null.",
        // [rules::update_rule_refusals / admitted_hidden_updates / missing_update_and_incomplete_upsert](rules.rs)
        "Use a write admitted by its rule; NOT_FOUND on an update or upsert-patch does not prove absence.",
    ];
    assert!(text.starts_with(&format!("# Rules {}", facts.join(" "))), "the original write-executing witness paragraph must stay intact: {text}");
}

#[test]
fn search_membership_heading_is_a_separate_output_line() {
    assert!(card("search").unwrap().lines().any(|line| line == "## Search every chat I'm in"));
}

#[test]
// @ref LLP 3000.023#12 — a retained once handle discloses metadata, never permission to fetch bytes again.
fn assets_once_contract_retains_metadata_and_renders_opened() {
    let text = normalize(&card("assets").unwrap());
    for fact in [
        "`once` is a bytes-once contract.",
        "The handle and metadata (id, type, dimensions, byte size) may remain after viewing.",
        "A visible handle is never permission to show content.",
        "When `useAsset` or a fetch refuses with E_ASSET_VIEWED, render \"Opened\" (or similar):",
    ] {
        assert!(text.contains(fact), "assets card omits {fact}");
    }
}

#[test]
fn every_card_separates_headings_from_prose() {
    for name in KEYWORDS {
        let mut fence = None;
        let mut previous_blank = true;
        for line in card(name).unwrap().lines() {
            let trimmed = line.trim_start();
            if let Some(marker) = fence {
                if trimmed.starts_with(marker) { fence = None; }
            } else if let Some(marker) = ["```", "~~~"].into_iter().find(|m| trimmed.starts_with(m)) {
                fence = Some(marker);
            } else if let Some(at) = line.find("# ") {
                assert!(line[..at].chars().all(|c| c == '#' || c.is_whitespace()), "{name}: heading glued to prose: {line}");
                assert!(previous_blank, "{name}: blank line missing before heading: {line}");
            }
            previous_blank = trimmed.is_empty();
        }
    }
}

#[test]
// @ref LLP 3000.007#20.19 — the first matching paragraph must define the code, not merely mention it.
fn w11_every_registered_code_quotes_its_definition() {
    use std::collections::BTreeSet;
    let registered = snapback4_lang::guide::codes().into_iter().collect::<BTreeSet<_>>();
    let pinned = DEFINITIONS.iter().map(|(code, _)| *code).collect::<BTreeSet<_>>();
    assert_eq!(registered, pinned, "review a defining fact for each registered code");
    assert_eq!(pinned.len(), DEFINITIONS.len(), "duplicate definition pin");
    let actionable = refusal_actions::ACTIONS.iter().map(|(code, _)| *code).collect::<BTreeSet<_>>();
    assert_eq!(registered, actionable, "review recovery and boundary facts for every code");
    assert_eq!(actionable.len(), refusal_actions::ACTIONS.len(), "duplicate action pin");
    let mut missing = Vec::new();
    for &(code, fact) in DEFINITIONS {
        let why = explain_code(code).unwrap();
        let inline = snapback4_lang::Diagnostic::new(&Default::default(), code, "", "")
            .explanation_section().unwrap();
        assert_eq!(why, inline, "{code}: CLI and repeated diagnostics must agree");
        if !excerpt(&why).contains(fact) { missing.push(format!("{code}: {fact}")); }
    }
    for &(code, facts) in refusal_actions::ACTIONS {
        assert!(!facts.is_empty(), "{code}: no recovery facts");
        let text = excerpt(&explain_code(code).unwrap());
        for fact in facts {
            if !text.contains(fact) { missing.push(format!("{code} action/boundary: {fact}")); }
        }
    }
    assert!(missing.is_empty(), "first card paragraph lacks its defining fact:\n{}", missing.join("\n"));
}

// Hand-reviewed defining facts from every default-card excerpt. Keep these
// independent of the paragraph selector: do not regenerate them to bless a new
// first mention. Whitespace may change; the reason for the code must survive.
const DEFINITIONS: &[(&str, &str)] = &[
    ("E_JOB_VIEWER_CONTEXT", "as belongs inside a job sweep and cannot nest"),
    ("E_JOB_VIEWER_PRINCIPAL", "as requires a present non-system principal"),
    ("E_JOB_VIEWER_READ_ONLY", "as refuses writes, emits, new ids and once asset consumption"),
    ("E_JOB_VIEWER_FLOW", "return cannot leave an as block"),
    ("E_JOB_VIEWER_QUERY", "a job viewer call requires a declared durable Quarry query"),
    ("E_JOB_VIEWER_READ", "the viewer query is unavailable or cannot certify exhaustion"),

    ("N_RECEIPT_PREDICTION", "N_RECEIPT_PREDICTION identifies the first static receipt dependency in a mutation; the whole mutation queues without a predicted row."),
    ("E_RECEIPTS_CLAUSE", "malformed declarations refuse `E_RECEIPTS_CLAUSE`"),
    ("E_RECEIPTS_OWNED", "Progress fields and runs refuse ordinary writes with `E_RECEIPTS_OWNED`"),
    ("EMPTY_READ", "EMPTY_READ is optional local evidence"),
    ("E_DELIVERY_BINDING", "a report's binding changed or was removed"),
    ("E_DELIVERY_CLAUSE", "requires exactly a reference to the group table and two `int` arguments"),
    ("RUNS_FULL", "`RUNS_FULL` refuses a disjoint 65th run"),
    ("E_SEARCH_OPEN", "Its membership count includes only authorized discovered keys."),
    ("N_SEARCH_OPEN", "every membership and its authorized head must fit one read"),
    ("N_SEARCH_UNSCOPED", "the read rule varies within the searched index"),
    ("N_SEARCH_WORDS", "first-term expansion and further-term misses consume the meters"),
    ("N_SEARCH_SHAPE", "repeats a group read per hit"),
    ("E_FIELD_AUTHORITY", "E_FIELD_AUTHORITY means an owner declaration is invalid, or a supplied/updated field is not yours."),
    ("N_SEQUENCE_READ", "N_SEQUENCE_READ locates a sequence whose read authority depends on an existing"),
    ("E_SEQUENCE_PARENT", "E_SEQUENCE_PARENT names a missing, optional or non-reference parent column"),
    ("E_SEQUENCE_SUPPLIED", "`sequence by` refuses such values with E_SEQUENCE_SUPPLIED, including on updates and upserts."),
    ("E_SEQUENCE_EXHAUSTED", "E_SEQUENCE_EXHAUSTED refuses a transaction that would exceed the maximum int."),
    ("E_VIEW_KEY", "Every member-row reader must be able to read the whole counted parent group."),

    ("E_QUARRY_EPHEMERAL", "E_QUARRY_EPHEMERAL refuses a declaration or operation that gives ephemeral rows durable custody"),
    ("E_EPHEMERAL_FULL", "`E_EPHEMERAL_FULL` is retryable at 1,000 rows or 4 MiB per principal"),
    ("N_EPHEMERAL_SERVER", "A query reading ephemeral rows runs on the server"),
    ("E_QUARRY_SELF_EQUALITY", "E_QUARRY_SELF_EQUALITY refuses comparisons of a filtered row column with itself"),
    ("E_READ_THROUGH", "read through .ref"),
    ("E_READ_THROUGH_ADOPT", "Reconcile the named table before adoption."),
    ("E_PARENT_HAS_CHILDREN", "deleting live children and sweeping expired children"),
    ("E_READ_THROUGH_SCAN", "complete key"),
    ("E_QUARRY_DUPLICATE_FIELD", "E_QUARRY_DUPLICATE_FIELD refuses two explicit fields with the same name"),
    ("E_QUARRY_SPREAD", "E_QUARRY_SPREAD refuses nullable operands and values without statically known fields"),
    ("E_QUARRY_SHAPE_JOIN", "E_QUARRY_SHAPE_JOIN refuses joining different row kinds"),
    ("E_QUARRY_RULE_SPELLING", "E_QUARRY_RULE_SPELLING locates a guessed table rule"),
    ("E_QUARRY_JOB_SCHEDULE", "E_QUARRY_JOB_SCHEDULE separates work from its clock"),
    ("E_QUARRY_KEY_ORDER", "E_QUARRY_KEY_ORDER means a positional component followed a named one"),
    ("E_QUARRY_WRITE_TESTS", "E_QUARRY_WRITE_TESTS means a write target includes tests beyond its unique key"),
    ("E_INIT_CONFLICT", "E_INIT_CONFLICT means `init` found files or package entries it would overwrite, and wrote nothing."),
    ("E_JOB_SWEEP", "E_JOB_SWEEP parks stored job IR with no recorded table sweep or an unsupported top-level work loop before running a chunk, including when valid sweeps appear alongside that loop."),
    ("N_OPTIONAL_FILTER_LIMIT", "At most three optional inputs expand; N_OPTIONAL_FILTER_LIMIT names any extra residual filters, which can stay metered or move into separate queries."),
    ("DIGEST_CHAT_BOUND", "DIGEST_CHAT_BOUND belongs to the older bounded digest recipe. That refusal rolled back the recipient without an effect or marker."),
    ("E_ACTION_ATTEMPTS", "E_ACTION_ATTEMPTS means every admitted attempt was used, including the first."),
    ("E_ACTION_AUTHORITY", "Before a claim, revoking that session, logout-all, principal revocation or expiry fails the request terminally with `E_ACTION_AUTHORITY`: \"the authority that admitted this action was revoked or has expired\"."),
    ("E_ACTION_CANCELLATION", "E_ACTION_CANCELLATION means the admitted operation forbids cancellation."),
    ("E_ACTION_CANCELLED", "E_ACTION_CANCELLED means this invocation has been cancelled and cannot continue."),
    ("E_ACTION_CLOSED", "E_ACTION_CLOSED means code tried to use the invocation context after its handler finished."),
    ("E_ACTION_DEADLINE", "E_ACTION_DEADLINE means the invocation reached its admitted deadline and cannot run again."),
    ("E_ACTION_FAILED", "E_ACTION_FAILED means the handler gave up or finished its last permitted attempt with an error; `why.message` carries the recorded reason."),
    ("E_ACTION_GENERATION", "E_ACTION_GENERATION means the queued declaration changed or the worker's manifest differs from the admitted contract."),
    ("E_ACTION_LEASE", "Stale claims get `E_ACTION_LEASE`; user tokens get HTTP 401 `E_AUTH`."),
    ("E_ACTION_PENDING", "Otherwise HTTP 202 carries `{ state: \"pending\", id, why }`, with retryable `E_ACTION_PENDING`."),
    ("E_ACTION_RESULT", "E_ACTION_RESULT means the handler returned a value outside its declared result type or output bound."),
    ("E_ACTION_UNKNOWN", "Another principal gets `E_ACTION_UNKNOWN`."),
    ("E_ADOPT", "New required `default now` or `default viewer` columns adopt only an empty table; otherwise use an optional column or a literal default."),
    ("E_ASSET_BOUNDS", "Images must be nonzero, at most 16,384 pixels on either side and at most 40 million pixels total; video must have a positive duration no longer than one hour (E_ASSET_BOUNDS)."),
    ("E_ASSET_PLACED", "One asset, one home: the uploader's own upload, placed once (E_ASSET_UNKNOWN, E_ASSET_PLACED)."),
    ("E_ASSET_RANGE", "A Range request against a once asset is refused before consuming a view (E_ASSET_RANGE)."),
    ("E_ASSET_TOO_LARGE", "A client uploads the bytes first (`client.upload(file)` → `{ id, type, bytes, width, height, duration }`; the server sniffs JPEG, PNG, WebP and MP4 and refuses the rest with E_ASSET_TYPE, and anything over the largest column's bound with E_ASSET_TOO_LARGE)."),
    ("E_ASSET_TYPE", "A client uploads the bytes first (`client.upload(file)` → `{ id, type, bytes, width, height, duration }`; the server sniffs JPEG, PNG, WebP and MP4 and refuses the rest with E_ASSET_TYPE, and anything over the largest column's bound with E_ASSET_TOO_LARGE)."),
    ("E_ASSET_UNKNOWN", "a row that is deleted, whose column is cleared, that expired, or that the viewer may not read answers 404 E_ASSET_UNKNOWN."),
    ("E_ASSET_VIEWED", "`once`: the second fetch by the same principal is 410 E_ASSET_VIEWED, and the uploader is counted after placement; before placement the uploader may preview."),
    ("E_AUTH", "E_AUTH means the request has no live principal or uses the wrong authority for its endpoint."),
    ("E_WORKER_REFRESH", "E_WORKER_REFRESH means this token belongs to a supervised worker family."),
    ("E_BOUND", "A query past a ceiling returns what it found with `complete: false`; a mutation aborts with E_BOUND naming the meter, the ceiling and the site (never the count: it would measure rows the viewer may not read)."),
    ("E_CLIENT", "E_CLIENT means a client exception prevented the expected write or asset outcome."),
    ("E_CLOCK_DEV_ONLY", "`serve` refuses clock flags and the control endpoint with E_CLOCK_DEV_ONLY."),
    ("E_CLOCK_INPUT", "Backward/zero advances and invalid values refuse E_CLOCK_INPUT."),
    ("E_CLOSED", "E_CLOSED means the client closed while a request was in flight."),
    ("E_CONFLICT", "E_CONFLICT means a conditional update found that the row changed."),
    ("E_CONSTRAINT", "E_CONSTRAINT means a unique key, product cap, immutable field, format or postcondition rejected the write."),
    ("E_CURSOR_INDEX", "E_CURSOR_INDEX concerns an older explicit index that lacks a total order."),
    ("E_DEVICE_VERSION", "E_DEVICE_VERSION means JavaScript opened a device module missing the required sync receipt protocol."),
    ("E_DIV_ZERO", "`/` and `%` give the Euclidean quotient and remainder of ints or times; zero refuses `E_DIV_ZERO`."),
    ("E_EFFECT_ATTEMPTS", "E_EFFECT_ATTEMPTS means an expired lease exhausted the effect's admitted attempt limit."),
    ("E_EFFECT_CANCELLATION", "E_EFFECT_CANCELLATION means the admitted effect declares cancellation deny."),
    ("E_EFFECT_CANCELLED", "Explicit policy-allowed cancellation may move one to failed with E_EFFECT_CANCELLED; it never resumes the effect."),
    ("E_EFFECT_CLOSED", "E_EFFECT_CLOSED means a private generated effect context closed with its handler lifetime or an authority loss."),
    ("E_EFFECT_DEADLINE", "E_EFFECT_DEADLINE means this effect's admitted deadline passed; it is terminal and no worker will claim it again."),
    ("E_EFFECT_GENERATION", "The server authenticates and compares it before queue expiry, selection or claim mutation; a missing current declaration or mismatch returns E_EFFECT_GENERATION without changing rows, attempts or steps."),
    ("E_EFFECT_LEASE", "A worker that dies loses its lease and the effect is claimed again (E_EFFECT_LEASE for the one that settles late)."),
    ("E_EFFECT_UNKNOWN", "E_EFFECT_UNKNOWN means this server has no queued effect under that ID."),
    ("E_EMIT_IN_QUERY", "E_EMIT_IN_QUERY means a query tried to enqueue an external effect."),
    ("E_FANOUT", "E_FANOUT means a loop received more items than its declared bound."),
    ("E_FIELD", "E_FIELD means a runtime field selection has no such field."),
    ("E_GENERATION", "E_GENERATION means the caller's assumed backend differs from the store's active backend."),
    ("E_HOST_UNICODE", "The web device folds through the browser's normalization, keeps Rust lowercase, and refuses to open with `E_HOST_UNICODE` when the browser's NFC disagrees with the contract's startup canaries."),
    ("E_ID_REUSED", "E_ID_REUSED means the request ID already belongs to another operation or different arguments."),
    ("E_INDEX_KEY_BYTES", "E_INDEX_KEY_BYTES means an encoded key exceeds 2048 bytes, including its components and row id."),
    ("E_INPUT", "E_INPUT means an argument or row value does not fit its declared type."),
    ("E_INTERNAL", "E_INTERNAL means the interpreter reached an undefined compiler temporary."),
    ("E_JOB_CURSOR_INDEX", "E_JOB_CURSOR_INDEX means a chunk's scan key can move while the job writes."),
    ("E_JOB_GENERATION", "E_JOB_GENERATION means a queued job's definition changed or disappeared before its next chunk."),
    ("E_MAINTAINED_COLUMN", "Tables the timeline owns refuse E_MAINTAINED_COLUMN."),
    ("E_MAINTAINED_COLUMN_PRIVATE", "E_MAINTAINED_COLUMN_PRIVATE refuses addressing the column's private storage."),
    ("E_MAINTAINED_COLUMN_REFERENCE", "With no reference or several, E_MAINTAINED_COLUMN_REFERENCE lists the candidates: declare a reference if needed, then select it with `likeCount: count likes by .postId`."),
    ("E_MAINTAINED_COLUMN_RESULT", "Read the row under its read rule to see the aggregate; selecting the field from a write result refuses with E_MAINTAINED_COLUMN_RESULT."),
    ("E_MAINTAIN_READ_EXPIRE", "E_MAINTAIN_READ_EXPIRE means an aggregate over an expiring source has a read rule that uses fields its group keys do not determine."),
    ("E_MAINTAIN_READ_RULE", "E_MAINTAIN_READ_RULE names missing fields; state an explicit `read <-` when the aggregate needs its own audience."),
    ("E_NATIVE", "E_NATIVE means a native declaration or loaded module cannot perform the requested operation."),
    ("E_NATIVE_BUILD", "E_NATIVE_BUILD means the native crate could not be built or its generated files could not be written or loaded."),
    ("E_NATIVE_TOOLCHAIN", "E_NATIVE_TOOLCHAIN means the native build cannot find Cargo or the `wasm32-unknown-unknown` target."),
    ("E_NATIVE_TRAP", "The first refusal — a bound, a constraint, a bad value — parks the job with it (`snapback4 doctor` lists runs); a panic parks it as E_NATIVE_TRAP with the panic's text; 2,000,000,000 units of fuel per chunk (about 90,000 per host call) is the step ceiling, so the row ceilings usually bind first."),
    ("E_NOT_PREDICTABLE", "`mutation name(args) predicts:` asserts this eligibility: `check` refuses `E_NOT_PREDICTABLE` at the header if a server site makes it `never`, with the reason and rewrite."),
    ("E_OFFLINE", "Offline it returns its last server answer, held in memory for this client's lifetime, with fresh: false and since. Without one it refuses E_OFFLINE (family link, retryable)."),
    ("E_HTTP_LIMIT", "E_HTTP_LIMIT warns below 1024"),
    ("E_HTTP_LISTENER", "E_HTTP_LISTENER names an OS accept failure, including descriptor exhaustion"),
    ("E_HTTP_RESPONSE", "E_HTTP_RESPONSE means a request received HTTP with an invalid response envelope"),
    ("E_OIDC_BINDING", "E_OIDC_BINDING means begin did not receive a 43-character base64url SHA-256 binding hash."),
    ("E_OIDC_CALLBACK", "E_OIDC_CALLBACK means the provider returned an error, required callback values are missing, or state, browser binding or transaction admission did not match."),
    ("E_OIDC_CONFIG", "E_OIDC_CONFIG means a fixed issuer, redirect URL, client secret-name, scope, transaction TTL or session setting is invalid."),
    ("E_OIDC_EXCHANGE", "E_OIDC_EXCHANGE means authorization-code exchange or ID-token verification failed."),
    ("E_OIDC_HANDOFF", "E_OIDC_HANDOFF means the live handler cannot deliver the minted session, or its recovered session disagrees with recorded completion metadata."),
    ("E_OIDC_MINT", "E_OIDC_MINT means the private session endpoint returned an invalid session shape or value."),
    ("E_OIDC_PROVIDER", "E_OIDC_PROVIDER means discovered or durable provider metadata does not match the fixed secure configuration."),
    ("E_OIDC_RECIPE", "E_OIDC_RECIPE means a configured generated query or mutation handle is invalid, the identity query returned no data, or a private transaction row has an invalid shape."),
    ("E_OIDC_REPLAY", "E_OIDC_REPLAY means the transaction is already completing elsewhere or cannot be completed by this invocation."),
    ("E_OIDC_TRANSACTION", "E_OIDC_TRANSACTION means the stored transaction is invalid or mismatched, or the verified transaction did not settle as expected."),
    ("E_OP", "E_OP means the requested operation or route does not exist, or was called through the wrong door."),
    ("E_OP_RESERVED", "E_OP_RESERVED means an application's refusal code starts with the platform's reserved `E_` prefix."),
    ("E_OVERFLOW", "E_OVERFLOW means integer arithmetic left the value model's range of −9,007,199,254,740,991 through 9,007,199,254,740,991."),
    ("E_POSTGRES_MAINTAINED_COLUMN", "The Postgres evaluation backend refuses maintained columns and their private maintains with E_POSTGRES_MAINTAINED_COLUMN."),
    ("E_PREDICT", "E_PREDICT means the device cannot establish this call's prediction from its held facts or submission IDs."),
    ("E_QUARRY_AMBIGUOUS", "E_QUARRY_AMBIGUOUS means an older positional read matches several keys."),
    ("E_QUARRY_BOUND", "E_QUARRY_BOUND means a boundless prefix is not valid in this position: no schema cap covers the group, its cap exceeds the examined ceiling, or a meter-bounded query prefix has a non-uniform read rule."),
    ("E_QUARRY_LIVE_MAINTAIN_PROBE", "A rule equality on its `value` is refused at `check` (E_QUARRY_LIVE_MAINTAIN_PROBE): read the view in the program; its live value cannot be probed at one unit."),
    ("E_QUARRY_MAINTAIN", "Private targets, mutable references/columns, unknown columns and further hops refuse with E_QUARRY_MAINTAIN and a rewrite."),
    ("E_QUARRY_MAINTAIN_EXPIRE", "Value-order indexes over expiring sources are refused by check (E_QUARRY_MAINTAIN_EXPIRE) and raw schema adoption: use the fresh live bounded query on guide feeds."),
    ("E_QUARRY_MODIFIER_SCOPE", "E_QUARRY_MODIFIER_SCOPE means a nested read's modifiers are ambiguous."),
    ("E_QUARRY_PLACEMENT", "E_QUARRY_PLACEMENT means a statement is valid only in another context."),
    ("E_QUARRY_POSITIONAL_SCAN", "E_QUARRY_POSITIONAL_SCAN means a positional key would scan a population."),
    ("E_QUARRY_POINT_KEY", "E_QUARRY_POINT_KEY refuses a point probe whose key can match several rows."),
    ("E_QUARRY_NULL_KEY", "arguments for nullable columns of the selected unique key must be provably non-null"),
    ("E_QUARRY_RETAIN", "E_QUARRY_RETAIN means a table repeats its retention declaration or uses an unknown policy."),
    ("E_QUARRY_SYNTAX", "E_QUARRY_SYNTAX means the parser could not read the form at the reported file, line and column."),
    ("E_QUARRY_TYPE", "E_QUARRY_TYPE means the expression's type does not fit its position."),
    ("E_QUARRY_UNKNOWN", "E_QUARRY_UNKNOWN means a name cannot be resolved in this scope: a local, argument, table, column, index or helper may be misspelled or undeclared."),
    ("E_QUARRY_UNSUPPORTED", "E_QUARRY_UNSUPPORTED means the guessed construct is not a Quarry form."),
    ("E_QUERY_RETRY", "exhaustion refuses retryable `E_QUERY_RETRY`"),
    ("E_QUERY_HELD", "If the server cannot answer the query, declare `query … held:` to answer from the device; the server refuses it with E_QUERY_HELD."),
    ("E_RATE_LIMIT", "Under `serve`, guest, login and signup share 30 attempts per socket peer per minute, while login and signup also share 10 per normalized email per minute (E_RATE_LIMIT)."),
    ("E_RECIPE_RETIRED", "E_RECIPE_RETIRED means the installer wrote nothing; use the new view for a new app."),
    ("E_RECORDED_FIELD", "Recorded fields belong to the engine. Any payload naming one refuses with E_RECORDED_FIELD"),
    ("E_REPLAY_DEV_ONLY", "`serve` and release commands refuse `--replay` with E_REPLAY_DEV_ONLY; production always emits normally."),
    ("E_ROUTE_DECLARATION", "Empty and dot segments, trailing slashes, escapes, captures, queries and core endpoint paths (including `/probe`) refuse E_ROUTE_DECLARATION."),
    ("E_ROUTE_GENERATION", "A changed route declaration refuses E_ROUTE_GENERATION; unavailable work or authority refuses E_ROUTE_UNKNOWN."),
    ("E_ROUTE_INPUT", "A malformed envelope refuses E_ROUTE_INPUT."),
    ("E_ROUTE_LEASE", "An expired or mismatched verifier claim refuses E_ROUTE_LEASE."),
    ("E_ROUTE_PENDING", "An exception or unavailable verifier answers 503 with E_ROUTE_PENDING; that response alone does not prove admission."),
    ("E_ROUTE_PRIVATE", "Work cannot be invoked through the public action API (E_ROUTE_PRIVATE)."),
    ("E_ROUTE_REFUSED", "Application `GiveUp` refusals are recorded as E_ROUTE_REFUSED and acknowledged with a bare 204."),
    ("E_ROUTE_RESULT", "Invalid responses refuse E_ROUTE_RESULT terminally, because external effects may already have happened."),
    ("E_ROUTE_UNKNOWN", "A changed route declaration refuses E_ROUTE_GENERATION; unavailable work or authority refuses E_ROUTE_UNKNOWN."),
    ("E_ROUTE_VERIFY", "Return `false` for an invalid signature: HTTP 403 with E_ROUTE_VERIFY, with no durable admission."),
    ("E_RULE", "`insert` and `insert ... if absent` return E_RULE when the insert rule denies the viewer."),
    ("E_RUN_BUSY", "E_RUN_BUSY means local `run` spent its 15-second contention deadline waiting for SQLite BUSY/LOCKED during store opening or schema adoption."),
    ("E_RUN_SOURCE_CHANGED", "E_RUN_SOURCE_CHANGED means `run` saw a source edit or could no longer read its source before admission."),
    ("E_SCHEDULE", "E_SCHEDULE means the clock cannot call the named target with its supplied authority and arguments."),
    ("E_SCHEMA", "E_SCHEMA means the runtime's schema or stored backend is inconsistent."),
    ("E_SCHEMA_CAPABILITY", "Current engines and devices refuse unknown requirements with `E_SCHEMA_CAPABILITY`, including when an explicit backend would replace an unsupported kept backend."),
    ("E_SCHEMA_CONSTRAINT", "E_SCHEMA_CONSTRAINT means the named declaration violates a schema constraint."),
    ("E_SECRET_MISSING", "The child environment is constructed explicitly, with runtime variables and the declared secrets; a missing secret refuses startup with E_SECRET_MISSING."),
    ("E_SERVER_CONFIG", "E_SERVER_CONFIG means the runtime lacks its URL or service token, or has an invalid status interval."),
    ("E_SERVER_HANDLERS", "E_SERVER_HANDLERS means the registry does not match the declared operations."),
    ("E_SERVER_REQUIRED", "Actions, routes and schedules naming an action require it."),
    ("E_SERVER_TOOLCHAIN", "E_SERVER_TOOLCHAIN means `check` cannot start Node 24 or load the app's local TypeScript compiler."),
    ("E_SERVER_TYPECHECK", "E_SERVER_TYPECHECK means the server entry or an imported module fails TypeScript checking."),
    ("E_SHAPE_EXCEEDS_METER", "If the same first shape cannot fit on retry, E_SHAPE_EXCEEDS_METER refuses instead of repeating an empty page forever."),
    ("E_SQL_INTERNAL", "E_SQL_INTERNAL means inspection tried to read engine-private storage."),
    ("E_SQL_READ_ONLY", "E_SQL_READ_ONLY means inspection received something other than one read-only `SELECT` or `WITH ... SELECT`."),
    ("E_STEP_BUSY", "E_STEP_BUSY means this attempt has already begun the named external step."),
    ("E_STEP_INPUT", "E_STEP_INPUT means the step name or JSON input is invalid, too large, or changed for a name already used in this invocation."),
    ("E_STEP_PARKED", "E_STEP_PARKED means an external outcome is uncertain and the invocation needs reconciliation."),
    ("E_STEP_RESULT", "E_STEP_RESULT means the external step returned invalid or oversized JSON, or settlement conflicts with its recorded outcome."),
    ("E_STEP_UNKNOWN", "E_STEP_UNKNOWN means settlement or parking named a step that was never begun in this invocation."),
    ("E_STORE_BUSY", "E_STORE_BUSY at store.sqlite means a live host or another CLI owns this database."),
    ("E_STORE", "E_STORE means the database operation failed, such as a SQLite writer lock held by another process."),
    ("E_STORE_REPLACED", "The online client permanently denies reads and fails queued and in-flight writes on an identity change (`E_STORE_REPLACED`)"),
    ("E_STORE_RESTORE", "The client adopts `/schema` only when that watermark is a finite, nonnegative integer at or above its retained image-head evidence (equal adopts); a lower head halts with `E_STORE_RESTORE`, and a missing or invalid head is a retryable failure that neither adopts nor clears the evidence."),
    ("E_STRUCTURAL_FANOUT", "`matching` and merges stay refused, and predicting mutations still cannot scan expiring tables."),
    ("E_SYNC", "E_SYNC means the sync declaration cannot deliver exactly its authorized audience."),
    ("E_SYNC_GENERATION", "The client sends its device generation. A mismatch returns HTTP 200 `E_SYNC_GENERATION`"),
    ("E_TIMELINE_ACTIVATE", "Dev adopts automatically. Deploy needs `--allow-feed-adoption`"),
    ("E_TIMELINE_FILTER", "Selection is not stable. Make selection columns immutable; use `.parentId = null and not .removed`"),
    ("E_TIMELINE_FOLLOWS", "The edge key is invalid. Declare the immutable unique follower/followed pair"),
    ("E_TIMELINE_IMPORT", "Import cannot reconstruct delivery history. Use application mutations or a trusted complete restore"),
    ("E_TIMELINE_OWNED", "Derived rows belong to the engine. Write posts, reposts or follows"),
    ("E_TIMELINE_READ", "The read is not one viewer's newest-first page. Read `following last 20 by .at after c`, then shape the rows"),
    ("E_TIMELINE_REDEFINE", "A declaration changed or experimental reconstruction remains. Retire it, deploy and add with a fresh name"),
    ("E_TIMELINE_REMOVAL", "Removal must be one-way. Insert false, change only false → true and retain the original card"),
    ("E_TIMELINE_SERVER", "The mutation needs server-only state. Queue it without predicted rows"),
    ("E_TIMELINE_SHAPE", "The sources do not fit Following. Keep three distinct public sources and owner rules"),
    ("E_TIMELINE_SIZE", "Remove them; N_TIMELINE_COMPAT reports their presence and E_TIMELINE_SIZE rejects invalid old sizing syntax."),
    ("E_TYPE", "E_TYPE means a runtime value has the wrong kind for the operation using it."),
    ("E_UNBOUND_LOOP", "E_UNBOUND_LOOP means the compiler cannot establish an accepted loop domain or walk depth."),
    ("E_UNBOUND_SCAN", "E_UNBOUND_SCAN means a compiled scan names a table or index absent from its schema."),
    ("E_VIEW_FEED_SHAPE", "The projection or viewer predicate is unsupported. Use the activity and Following views above"),
    ("E_WITNESS_APP", "Quit the named app before starting: an already running instance is refused with `E_WITNESS_APP`, and termination targets only the PID reported by the driver's own launch, leaving a replacement instance running."),
    ("E_WITNESS_ARTIFACT", "E_WITNESS_ARTIFACT means an expected artifact is absent, empty, changed containers or would overwrite an earlier run."),
    ("E_WITNESS_BACKEND", "E_WITNESS_BACKEND means the owned backend failed to become ready, exited early, or did not leave its port refusing connections after stop."),
    ("E_WITNESS_BUILD", "E_WITNESS_BUILD means own Release preparation failed or is outside the bounded adapter."),
    ("E_WITNESS_NATIVE_COMPAT", "E_WITNESS_NATIVE_COMPAT means the requested inputs cannot support the recorded preparation claim."),
    ("E_WITNESS_HERMES", "E_WITNESS_HERMES means the embedded bundle is not the expected Hermes bytecode or its compiler/version differs."),
    ("E_WITNESS_PROOF", "E_WITNESS_PROOF means recorded bytes or native startup identity did not match."),
    ("E_WITNESS_ORIGIN", "E_WITNESS_ORIGIN means the smoke client used a different backend origin."),
    ("E_WITNESS_INPUT", "E_WITNESS_INPUT means a flag, launch configuration or signal label is invalid."),
    ("E_WITNESS_INTERRUPTED", "E_WITNESS_INTERRUPTED means the run was interrupted before completion."),
    ("E_WITNESS_PLATFORM", "E_WITNESS_PLATFORM means the iOS witness lacks its required host tools."),
    ("E_WITNESS_PORT", "E_WITNESS_PORT means the requested backend port is occupied."),
    ("E_WITNESS_PROCESS", "E_WITNESS_PROCESS means a child command could not start, exited early or could not be stopped."),
    ("E_WITNESS_RECEIPT", "E_WITNESS_RECEIPT means a receipt is not a complete valid JSON object with the expected witness envelope, changed after observation, or could not be written."),
    ("E_WITNESS_SCENE_LIFECYCLE", "E_WITNESS_SCENE_LIFECYCLE means the owned app stopped before its priming receipt. The detector filters reports by bundle, launch PID, simulator and mtime since launch, then selects the newest with `NoSceneLifecycleAdoption` in its faulting thread."),
    ("E_WITNESS_SIMULATOR", "E_WITNESS_SIMULATOR means the explicit device is unavailable or simctl failed."),
    ("E_WITNESS_STEP", "E_WITNESS_STEP means an application assertion failed, milestones arrived out of order, or steps overlapped."),
    ("E_WITNESS_TIMEOUT", "E_WITNESS_TIMEOUT means a step, child command or signal did not arrive within its timeout, 120 seconds by default per driver step."),
    ("E_ADMISSION_STORE", "`E_ADMISSION_STORE` means the backend changed or revalidation failed."),
    ("E_ADMISSION_TIMEOUT", "`E_ADMISSION_TIMEOUT` means identity I/O exceeded 15 seconds."),
    ("E_ADMISSION", "A browser call that cannot synchronously keep its intent refuses `E_ADMISSION` with a site and rewrite: no new intent is accepted."),
    ("E_WRITE_ID", "The id must have the `mintId()` form: 26 uppercase Crockford base32 digits (0123456789ABCDEFGHJKMNPQRSTVWXYZ), with the first digit 0–7; malformed ids return local `failed` with `E_WRITE_ID`."),
    ("E_WRITE_ID_REUSE", "Reusing an id with different operation names or JSON arguments returns local `E_WRITE_ID_REUSE` while the client knows the input: unresolved submissions, its last 256 terminal input identities, or its recovered outbox."),
    ("E_WRITE_LABEL", "E_WRITE_LABEL means `ctx.writeIdFor(label)` received an invalid label."),
    ("E_WRITE_RECEIPT_EXPIRED", "A client remembers used ids for its lifetime (ids only after the bounded input/receipt window); if a known id has lost its receipt and left the outbox, it refuses `E_WRITE_RECEIPT_EXPIRED` instead of admitting it again."),
    ("FEED_APP_EVENT", "FEED_APP_EVENT means a bridge disagrees with its card's author or time: stop adoption and reconcile the mapping."),
    ("FEED_APP_NOT_FOUND", "FEED_APP_NOT_FOUND means a mapped profile, card or repost is absent."),
    ("FEED_APP_OWNER", "FEED_APP_OWNER requires the mapped row's owner."),
    ("FEED_AUTHOR_NOT_FOUND", "FEED_PULL_COUNT_MISSING requires a consistent trusted restore of routes/counts; FEED_AUTHOR_NOT_FOUND requires the author's registered profile."),
    ("FEED_CANNOT_FOLLOW_SELF", "Self-follow is refused. Own events already appear without it"),
    ("FEED_EVENT_REMOVED", "A removed event cannot be resurrected. Use a fresh event id"),
    ("FEED_NOT_AUTHOR", "FEED_ORIGINAL_REQUIRED needs an original event; FEED_NOT_AUTHOR needs its author."),
    ("FEED_ORIGINAL_REQUIRED", "FEED_ORIGINAL_REQUIRED needs an original event; FEED_NOT_AUTHOR needs its author."),
    ("FEED_POST_NOT_FOUND", "A new repost needs a live original. Refresh the source"),
    ("FEED_PROMOTION_PULL_CAP", "FEED_PROMOTION_PULL_CAP means another follower is full: the follow and promotion roll back."),
    ("FEED_PULL_CAP", "FEED_PULL_CAP means the caller uses all 32 shared-author slots."),
    ("FEED_PULL_COUNT_MISSING", "FEED_PULL_COUNT_MISSING requires a consistent trusted restore of routes/counts; FEED_AUTHOR_NOT_FOUND requires the author's registered profile."),
    ("NOT_FOUND", "NOT_FOUND means a point write has no target, or a write to an unreadable target was refused without disclosing its existence."),
    ("N_HORIZON_GUARD", "`require not exists notes[id] else DUPLICATE` on an argument id also gets a persistent `N_HORIZON_GUARD` note: remove it only if its purpose is retry dedupe."),
    ("N_MAINTAINED_COLUMN_DISCLOSURE", "N_MAINTAINED_COLUMN_DISCLOSURE prints when source readability is not proven for those readers."),
    ("N_MAINTAINED_COLUMN_STREAM", "A contributing commit streams the whole parent image to each parent partition, coalesced once per row. N_MAINTAINED_COLUMN_STREAM names that cost on the parent's sync line."),
    ("N_MAINTAIN_DELTA", "A readable aggregate view over a hidden source is a declared read channel: its delta can disclose the old contribution."),
    ("N_MAINTAIN_SYNCED", "N_MAINTAIN_SYNCED names public inherited aggregates and group audiences with unbounded recipients or multiple values per group."),
    ("N_NEVER_COMPLETE", "A page's read rule is checked once when the prefix decides it, else per row, and a page whose rule still depends on a column the scan does not pin is never `complete` (N_NEVER_COMPLETE names the missing equality columns and an existing compatible index when one is available)."),
    ("N_NOT_PREDICTABLE", "N_NOT_PREDICTABLE groups distinct root causes and deduplicated sites into one note per mutation for lost eligibility or an added horizon risk, explicitly distinguishing a call that may queue from an operation that never predicts."),
    ("N_NOW_SERVER", "N_NOW_SERVER names a newly server-run query."),
    ("N_SHAPE_METER", "candidate population can outgrow the default 8,192-row examined meter"),
    ("N_NO_CURSOR", "N_NO_CURSOR: a returned page cannot continue"),
    ("N_SYNC_ORDER", "Ascending reads and other indexes have unknown coverage."),
    ("N_NO_HORIZON", "A synced table with no horizon delivers every row of every group a device holds, at every cold start, as the table grows; `check` notes it (N_NO_HORIZON) unless the group cannot grow (one row per group, or a `cap` over the group), or its whole partition supplies an eligible mutation's reads or insert proof (`guide prediction`)."),
    ("N_PUBLIC_AGGREGATE_COPY", "N_PUBLIC_AGGREGATE_COPY names a public derived column whose ordinary write rules allow arbitrary values."),
    ("N_HELD_UNKNOWN", "N_HELD_UNKNOWN means a held query may read a table or view with no `sync`, including a `read through` parent, or `connected[...]` server presence."),
    ("N_SEEK", "N_SEEK is advice for an older explicit-index read whose residual filter can seek."),
    ("N_SPARSE_FILTER", "A residual predicate may reject many rows. Narrow the read; the planned `home` in `guide feeds` can fail closed with `complete: false` and no `next`. Materialized Following can adopt retained sources"),
    ("N_TIMELINE_ADOPT", "`check` previews automatic dev launch, copies and lock time; deploy requires `--allow-feed-adoption`"),
    ("N_TIMELINE_COMPAT", "`authors` and `size` lines are unused compatibility inputs. Remove them; N_TIMELINE_COMPAT reports their presence"),
    ("N_TIMELINE_PROFILE_CAP", "N_TIMELINE_PROFILE_CAP means an older profile cap is below the declared author count; raise it or keep the intentional application limit."),
    ("N_WIDE_MERGE", "Its uniform lane source runs under the examined meter: `check --cost` prints `lanes ≤ meter`; an explicit `first N` above 50 still emits N_WIDE_MERGE."),
    ("SNAPBACK4_EXIT", "`dev` and `serve` also report process events on stderr: SNAPBACK4_EXIT (a returned startup/listener error or normal stop), SNAPBACK4_PANIC (any thread, with its name, location and abort/unwind action), SNAPBACK4_SIGNAL (signal name and number), and SNAPBACK4_THREAD_EXIT (watcher/maintenance stopped; an unexpected stop ends the server)."),
    ("SNAPBACK4_PANIC", "`dev` and `serve` also report process events on stderr: SNAPBACK4_EXIT (a returned startup/listener error or normal stop), SNAPBACK4_PANIC (any thread, with its name, location and abort/unwind action), SNAPBACK4_SIGNAL (signal name and number), and SNAPBACK4_THREAD_EXIT (watcher/maintenance stopped; an unexpected stop ends the server)."),
    ("SNAPBACK4_SIGNAL", "`dev` and `serve` also report process events on stderr: SNAPBACK4_EXIT (a returned startup/listener error or normal stop), SNAPBACK4_PANIC (any thread, with its name, location and abort/unwind action), SNAPBACK4_SIGNAL (signal name and number), and SNAPBACK4_THREAD_EXIT (watcher/maintenance stopped; an unexpected stop ends the server)."),
    ("SNAPBACK4_THREAD_EXIT", "`dev` and `serve` also report process events on stderr: SNAPBACK4_EXIT (a returned startup/listener error or normal stop), SNAPBACK4_PANIC (any thread, with its name, location and abort/unwind action), SNAPBACK4_SIGNAL (signal name and number), and SNAPBACK4_THREAD_EXIT (watcher/maintenance stopped; an unexpected stop ends the server)."),
];

#[test]
fn receipts_teaches_sdk_delivery_and_keeps_only_the_seen_hook() {
    let text = normalize(&card("receipts").unwrap());
    for fact in ["SDK reports debt collected from publications and accepted answer manifests", "`progress` remains a catch-up read", "retires them on committed success", "local client persists debt", "online client keeps its queue in memory", "RUNS_FULL", "at least 30 seconds", "useSeen(api.receiptFamilies.chat"] {
        assert!(text.contains(fact), "missing {fact}: {text}");
    }
    for obsolete in ["the pages it has walked", "client.mutate(api.delivered", "server's own rows cover it", "A reload forgets what is owed"] {
        assert!(!text.contains(obsolete), "obsolete: {obsolete}");
    }
}

#[test]
fn receipts_migrates_the_history_walking_hook_that_does_not_scale() {
    let text = normalize(&card("receipts").unwrap());
    assert!(text.contains("history-walking hook does not scale to a large group"));
    for migration in ["remove its delivery debt", "automatic history `loadMore()`", "background `progress` polling writers",
        "adding `reports delivery`", "Keep the visible screen's `seen` report", "Replace the mounted `progress` read with `receiptMember`"] {
        assert!(text.contains(migration), "missing migration step: {migration}");
    }
    let hook = text.split("function useReceipts(").nth(1).expect("worked migrated hook");
    assert!(hook.contains("visibleIds.has(m.id) && !m.pending"), "{hook}");
    assert!(hook.contains("useSeen(api.receiptFamilies.chat"));
    for history_writer in ["loadMore(", "api.progress", "api.delivered"] {
        assert!(!hook.contains(history_writer), "migrated hook still uses {history_writer}");
    }
}

#[test]
fn expiring_mutation_programs_card_states_prediction_class() {
    let programs = card("programs").unwrap();
    assert!(programs.contains("Mutation scans of expiring tables require `predicts: \"never\"`"));
    assert!(programs.contains("inferred from server-only work, or declared with `: server`"));
}

#[test]
fn expiring_cap_why_states_live_occupancy_and_bounded_recount() {
    let predict = explain_code("E_PREDICT").unwrap();
    assert!(predict.contains("live occupancy") && predict.contains("bounded recount"), "{predict}");
    assert!(!predict.contains("cap counts unswept physical rows"));
}

#[test]
fn expiring_scalar_why_states_null_query_cut_and_atomic_mutation_refusal() {
    let fanout = explain_code("E_STRUCTURAL_FANOUT").unwrap();
    assert!(fanout.contains("query cut is an incomplete null"), "{fanout}");
    assert!(fanout.contains("mutation cut is `E_BOUND` with no write"), "{fanout}");
    assert!(!fanout.contains("returns false on an already capped answer"));
}

#[test]
fn delivery_bound_guidance_requires_start_only_recovery() {
    let why = explain_code("E_BOUND").unwrap();
    for (name, text) in [
        ("why E_BOUND", why.as_str()),
        ("refusals", card("refusals").unwrap()),
        ("sequences", card("sequences").unwrap()),
        ("bounds", card("bounds").unwrap()),
    ] {
        let text = text.replace('`', "").split_whitespace().collect::<Vec<_>>().join(" ");
        for required in [
            "E_BOUND is an ordinary non-retryable refusal",
            "calls onDeliveryRefused once",
            "until the next start",
            "with a new id",
            "no retry within the session",
            "committed report that runs again is a no-op report",
        ] {
            assert!(text.contains(required), "{name}: missing {required}");
        }
        let lower = text.to_lowercase();
        for obsolete in [
            "replay the same id first", "only a recorded failure",
            "retry a recorded failure with a new id after cleanup",
            "fresh-id recovery", "bare denied stays uncertain",
        ] {
            assert!(!lower.contains(obsolete), "{name}: obsolete {obsolete}");
        }
    }
}

#[test]
fn delivery_bound_rfc_acceptance_requires_start_only_recovery() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../llp/3000.025-expiring-mutation-read-prefix.rfc.md");
    let rfc = std::fs::read_to_string(path).unwrap();
    for (number, required) in [
        (5, vec!["onDeliveryRefused once", "next start sends a new id", "delivery-refusal.test.mjs"]),
        (6, vec!["E_BOUND is an ordinary non-retryable refusal", "calls onDeliveryRefused once",
            "until the next start", "with a new id"]),
        (7, vec!["start-only queue witnesses prove §3's policy", "one onDeliveryRefused",
            "a new id only at the next start"]),
    ] {
        let section = rfc.split_once(&format!("\n## {number}. ")).unwrap().1
            .split("\n## ").next().unwrap();
        let text = section.replace(['`', '*'], "").split_whitespace().collect::<Vec<_>>().join(" ");
        for phrase in required.into_iter().chain([
            "no retry within the session", "committed report that runs again is a no-op report",
        ]) {
            assert!(text.contains(phrase), "LLP 3000.025 §{number}: missing {phrase}");
        }
        let lower = text.to_lowercase();
        for obsolete in ["fresh id without restart", "replay the same id first", "replay-confirmed"] {
            assert!(!lower.contains(obsolete), "LLP 3000.025 §{number}: obsolete {obsolete}");
        }
    }
}
