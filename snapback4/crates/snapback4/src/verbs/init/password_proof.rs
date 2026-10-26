//! Password proofs share the same real staging host as probe:serve.
// @ref LLP 3000.000.000.001#13-wave-26-developer-loop-repairs-dx9 — no persona/dev fixture dependency in password-only proofs.

pub(super) fn files(sources:&[(String,String)], proof:String)->Vec<(&'static str,String)> {
    let bound=snapback4_lang::compile(sources);
    let plan=bound.programs.iter().find_map(|p|{
        use snapback4_core::ir::ArgType;
        if p.program.name!="provision"||p.program.args.len()!=2||!matches!(p.program.args.get("principal"),Some(ArgType::Principal)){return None;}
        let Some(ArgType::Enum{variants})=p.program.args.get("role") else{return None;};
        if variants.len()>50{return None;}
        Some(serde_json::json!({"roles":variants.iter().map(|r|(r,2)).collect::<std::collections::BTreeMap<_,_>>(),"provision":{"name":"provision"}}).to_string())
    }).unwrap_or_else(||"null".into());
    let staging=include_str!("password-staging.mjs").replace("SEED_PLAN",&plan);
    let proof=proof.replace("command, startDev,", "command,")
        .replace("import assert from", "import { startStaging } from './staging.mjs';\nimport assert from")
        .replace("const dev = await startDev({ ...options, args: [\"--memory\", \"--unsafe-dev-doors\"] });", "const dev = await startStaging(options);")
        .replace("const personas = (await (await fetch(`${dev.url}/dev/status`, { signal: AbortSignal.timeout(5000) })).json()).personas;", "const personas = []; // Real staging accounts, never development personas.")
        .replace("await fillRN(page.getByLabel(\"Email\", { exact: true }), `proof-${randomUUID()}@example.test`);", "const account = Object.values(dev.sessions).flat()[0];\n      await fillRN(page.getByLabel(\"Email\", { exact: true }), account.email);")
        .replace("await fillRN(page.getByLabel(\"Password\", { exact: true }), \"Proof-password-928!\");", "await fillRN(page.getByLabel(\"Password\", { exact: true }), account.password);")
        .replace("name: \"Sign up\", exact: true", "name: \"Sign in\", exact: true");
    vec![("scripts/probe-check.mjs",include_str!("password-probe-check.mjs").into()),("scripts/staging.mjs",staging),("scripts/probe-serve.mjs",include_str!("password-probe.mjs").into()),("scripts/frontend-proof.mjs",proof)]
}
